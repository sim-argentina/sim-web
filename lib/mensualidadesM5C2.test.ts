import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

// Guarda PURA del hotfix M7.3 / M5C.2. Sin DB, sin red.
// Ejecutar: npx tsx lib/mensualidadesM5C2.test.ts
//
// Las dos correcciones se prueban de verdad contra la base en
// mensualidadesM5C2.integration.ts. Esto es lo que evita que vuelvan:
//
//   · que el actor de la cancelación se elija en el SERVIDOR según la puerta y
//     no se acepte nunca del cuerpo de la solicitud;
//   · que no reaparezca la frase invertida en ningún texto que vea una persona.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── 1) El actor sale de la puerta, no del navegador ─────────────────────────
{
  const helper = read("lib/mensualidadesGestionReserva.ts");

  // Tipo cerrado: no se puede pasar cualquier cosa.
  assert.match(helper, /export type ActorCancelacion = "titular" \| "admin"/,
    "el actor es un tipo cerrado de dos valores");

  // Default seguro: quien no lo pasa cancela como el titular, que es el flujo
  // público. Nadie se vuelve admin por omisión.
  assert.match(helper, /actor: ActorCancelacion = "titular"/,
    "el default del helper es 'titular'");
  assert.match(helper, /p_actor: actor/, "el actor viaja a la RPC");

  // La ruta PÚBLICA no lee ningún actor del cuerpo.
  const rutaPublica = read("app/api/mensualidades/reservas/cancelar/route.ts");
  for (const prohibido of ["body.actor", "body.p_actor", "body.actor_rol", "body.rol", "body.admin"]) {
    assert.ok(!rutaPublica.includes(prohibido),
      `la ruta pública NO puede leer ${prohibido} del cuerpo`);
  }
  assert.ok(!/cancelarReserva\([^)]*"admin"/.test(rutaPublica),
    "la ruta pública nunca cancela como admin");

  // La ruta ADMINISTRATIVA fija 'admin' en el servidor, después del guard.
  const acciones = read("lib/mensualidadesAdminAcciones.ts");
  assert.match(acciones, /cancelarReserva\(mensualidadId, referencia, ctx\.idempotencyKey, "admin"\)/,
    "la administración pasa 'admin' explícitamente");
  for (const prohibido of ["body.actor", "body.p_actor", "body.actor_rol"]) {
    assert.ok(!acciones.includes(prohibido), `la capa admin NO lee ${prohibido}`);
  }
  const rutaAdmin = read("app/api/admin/mensualidades/[id]/acciones/route.ts");
  assert.match(rutaAdmin, /requireAdmin\(\)/, "la escritura administrativa exige admin");
  assert.match(rutaAdmin, /actor: auth\.role/, "el actor sale de la sesión firmada");

  // Y la base tiene la última palabra: lista cerrada dentro de la RPC.
  const migracion = read("db/mensualidades-m5c2-actor-cancelacion.sql");
  assert.match(migracion, /p_actor text default 'titular'/,
    "el parámetro va al final y con default seguro");
  assert.match(migracion, /p_actor not in \('titular', 'admin'\)/,
    "la RPC valida contra una lista cerrada");
  assert.match(migracion, /raise exception 'actor_invalido'/);
  assert.match(migracion, /p_actor, 'cancel:' \|\| v_reserva\.id/,
    "el movimiento escribe el actor recibido, no una constante");
  // Aditiva: no se edita la migración histórica de M5C.
  assert.match(migracion, /drop function if exists public\.cancelar_reserva_mensualidad\(uuid, text, text\)/,
    "DROP + CREATE para no dejar una sobrecarga ambigua");
  assert.ok(read("db/mensualidades-m5c-cancelar-reprogramar.sql").includes("'titular', 'cancel:'"),
    "la migración histórica de M5C queda intacta: la corrección es aditiva");
  // Permisos, en la migración nueva.
  assert.match(migracion, /security definer/);
  assert.match(migracion, /set search_path = public/);
  assert.match(migracion, /revoke all on function public\.cancelar_reserva_mensualidad\(uuid, text, text, text\)\s*\n?\s*from public, anon, authenticated/);
  assert.match(migracion, /grant execute on function public\.cancelar_reserva_mensualidad\(uuid, text, text, text\)\s*\n?\s*to service_role/);
}

// ── 2) El mensaje de las 24 h dice la regla, no lo contrario ────────────────
{
  const helper = read("lib/mensualidadesGestionReserva.ts");
  const bloque = helper.slice(helper.indexOf("fuera_de_plazo:"), helper.indexOf("fuera_de_plazo:") + 400);
  assert.match(bloque, /al menos 24 horas de anticipación/,
    "el mensaje enuncia la regla");
  assert.ok(!/error: "[^"]*faltan más de 24/.test(bloque),
    "y ya no dice lo contrario de la situación");
}

// ── 3) La frase invertida no vuelve por ningún texto visible ────────────────
// Se buscan LITERALES de cadena, no comentarios: el comentario que explica el
// arreglo la menciona a propósito y no tiene por qué hacer fallar la guarda.
{
  const sospechosas: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { recorrer(p); continue; }
      if (![".ts", ".tsx", ".sql"].includes(extname(e.name))) continue;
      if (e.name === "mensualidadesM5C2.test.ts") continue;  // esta guarda cita la frase
      const src = readFileSync(p, "utf8");
      for (const linea of src.split("\n")) {
        // Sin el \r los archivos CRLF esquivan el recorte: en JS el "." no cruza
        // un retorno de carro, así que ^\s*//.* no llega al final de la línea.
        const sinComentario = linea.replace(/\r$/, "").replace(/^\s*(\/\/|--).*$/, "");
        if (/["'`][^"'`]*faltan m[áa]s de 24[^"'`]*["'`]/.test(sinComentario)) {
          sospechosas.push(`${p}: ${linea.trim()}`);
        }
      }
    }
  };
  recorrer(join(ROOT, "lib"));
  recorrer(join(ROOT, "app"));
  recorrer(join(ROOT, "db"));
  assert.deepEqual(sospechosas, [],
    "no puede quedar ningún texto que diga 'faltan más de 24' cuando faltan menos");
}

// ── 4) Un solo lugar decide el MENSAJE DE ERROR ─────────────────────────────
// Si el texto se duplicara, una corrección futura arreglaría una copia y
// dejaría la otra. Mi Plan y el panel muestran lo que responde el servidor.
//
// (M8A) Se busca el mensaje dentro de un `error:`, no la frase suelta: desde que
// las condiciones públicas explican la regla de las 24 h, la frase aparece
// legítimamente en otro lado, y eso no es una duplicación del mensaje de error.
{
  const copias: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { recorrer(p); continue; }
      if (![".ts", ".tsx"].includes(extname(e.name))) continue;
      if (/M5C2\.(test|integration)\.ts$/.test(e.name)) continue;  // las pruebas lo citan
      const src = readFileSync(p, "utf8");
      if (/error:\s*"[^"]*al menos 24 horas de anticipación/.test(src)) copias.push(p);
    }
  };
  recorrer(join(ROOT, "lib"));
  recorrer(join(ROOT, "app"));
  assert.equal(copias.length, 1,
    `el mensaje de error vive en UN solo archivo, no duplicado (${copias.join(", ")})`);
}

console.log("mensualidadesM5C2.test.ts OK (actor por la puerta, mensaje correcto y sin duplicar)");
