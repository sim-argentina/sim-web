import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIRMACION_REINICIO } from "@/lib/bracketConfirmacion";

// Ejecutar: npx tsx lib/bracketResetAuth.test.ts
//
// El reinicio de un campeonato borra TODO el progreso deportivo: la API es la
// autoridad de permisos y de confirmación, no la UI. Este test verifica el cableado
// (misma técnica que el resto de los *Auth.test.ts del proyecto).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 1) Endpoint de reinicio: SOLO admin, en su propia ruta.
{
  const src = read("app/api/admin/campeonatos/[id]/bracket/reiniciar/route.ts");
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers, ["POST"], "reiniciar: solo POST");
  assert.ok(/requireAdmin\(\)/.test(src), "reiniciar: usa requireAdmin (staff → 403)");
  assert.ok(!/requireStaffOrAdmin/.test(src), "reiniciar: NO acepta staff");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), "reiniciar: corta si el guard falla");
  // Confirmación explícita: el endpoint la toma del body y la valida el server.
  assert.ok(/body\.confirmacion/.test(src), "reiniciar: lee la confirmación del body");
  assert.ok(/reiniciarCampeonato\(\s*id,\s*String\(body\.confirmacion/.test(src),
    "reiniciar: pasa la confirmación a la capa que la valida");
  // Auditoría con la infraestructura existente y sin PII.
  assert.ok(/logSecurityEvent\("bracket_reset"/.test(src), "reiniciar: audita la acción");
  for (const pii of ["nombre", "apellido", "telefono", "dni", "payment_id", "email"]) {
    assert.ok(!new RegExp(`${pii}:`).test(src), `reiniciar: el log no incluye ${pii}`);
  }
}

// 2) El endpoint de acciones NORMALES no puede disparar el reinicio.
{
  const src = read("app/api/admin/campeonatos/[id]/bracket/acciones/route.ts");
  assert.ok(/requireAdmin\(\)/.test(src), "acciones: sigue siendo admin-only");
  assert.ok(!/reiniciarCampeonato/.test(src), "acciones: NO importa el reinicio");
  assert.ok(!/reiniciar_campeonato/.test(src), "acciones: no expone una acción de reinicio");
  // La reapertura segura sigue existiendo por separado.
  assert.ok(/case "reabrir_clasificacion"/.test(src), "acciones: conserva reabrir_clasificacion");
}

// 3) La protección de la reapertura normal NO se tocó.
{
  const src = read("lib/bracketServer.ts");
  assert.ok(
    /No se puede reabrir: ya hay carreras iniciadas\./.test(src),
    "reabrirClasificacion: conserva el bloqueo por carreras iniciadas",
  );
  // El reinicio valida la confirmación server-side.
  assert.ok(/confirmacion !== CONFIRMACION_PALABRA/.test(src), "reiniciarCampeonato: exige la palabra exacta");
  // Y delega el borrado en la función transaccional, no en deletes sueltos.
  assert.ok(/rpc\("campeonato_bracket_reiniciar"/.test(src), "reiniciarCampeonato: usa el RPC atómico");
  assert.ok(
    !/from\("campeonato_inscripciones"\)\s*\.delete\(\)/.test(src),
    "bracketServer: nunca borra inscripciones",
  );
}

// 4) La UI exige escribir la palabra; no alcanza con un confirm().
{
  const src = read("app/admin/(panel)/campeonatos/TabBracket.tsx");
  assert.ok(/CONFIRMACION_REINICIO/.test(src), "UI: usa la misma constante que el backend");
  assert.ok(/bracket\/reiniciar/.test(src), "UI: pega a la ruta separada de reinicio");
  assert.ok(/esAdmin && \(/.test(src), "UI: la zona de acciones administrativas es solo para admin");
  assert.ok(/disabled=\{!habilitado\}/.test(src), "UI: el botón arranca deshabilitado");
  assert.ok(/texto\.trim\(\)\.toUpperCase\(\) === CONFIRMACION_REINICIO/.test(src),
    "UI: se habilita solo al escribir la palabra");
  assert.ok(/Las inscripciones y pagos/.test(src), "UI: avisa que inscripciones y pagos no se borran");
}

// 5) La palabra es la esperada y viene de un módulo puro compartido.
assert.equal(CONFIRMACION_REINICIO, "REINICIAR");
{
  const src = read("lib/bracketConfirmacion.ts");
  assert.ok(!/^import /m.test(src), "la constante vive en un módulo puro, sin imports ni acceso a la base");
}

// 6) El RPC no toca nada que no sea del bracket.
{
  const sql = read("db/campeonatos-bracket-reiniciar.sql");
  assert.ok(/delete from public\.campeonato_bracket where id = v_br\.id;/.test(sql),
    "SQL: un único delete sobre la raíz (el resto sale por cascade)");
  for (const tabla of ["campeonato_inscripciones", "campeonato_checkouts", "campeonato_registros", "reservas", "mensualidad"]) {
    assert.ok(
      !new RegExp(`delete from public\\.${tabla}`).test(sql),
      `SQL: no borra ${tabla}`,
    );
    assert.ok(
      !new RegExp(`update public\\.${tabla}`).test(sql),
      `SQL: no modifica ${tabla}`,
    );
  }
  assert.ok(/modalidad.*<> 'eliminacion'/.test(sql), "SQL: valida la modalidad");
  assert.ok(/pg_advisory_xact_lock/.test(sql), "SQL: toma lock por campeonato");
  assert.ok(/set search_path = public, pg_temp/.test(sql), "SQL: search_path fijo");
}

console.log("OK — bracket reset (auth/wiring): admin-only en ruta separada, confirmación server-side, UI con palabra exacta, RPC acotado al bracket y reapertura segura intacta.");
