import { strict as assert } from "node:assert";
import {
  ESTADOS_FILTRO, esEstadoFiltro, POR_PAGINA, POR_PAGINA_MAX,
} from "@/lib/mensualidadesAdmin";
import {
  ajustarSaldo, cambiarBloqueo, cambiarTelefono, cancelarReservaAdmin,
  extenderVencimiento, regenerarCodigo, reprogramarReservaAdmin, MOTIVO_MAX,
} from "@/lib/mensualidadesAdminAcciones";

// Test PURO del Bloque M7: lo que se rechaza ANTES de llegar a la base.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM7.test.ts
// (necesita el env solo porque el módulo importa supabaseAdmin.)
//
// Todas estas validaciones cortan y devuelven sin hacer una sola consulta. Es a
// propósito: una solicitud sin motivo, sin clave de idempotencia o con minutos
// imposibles no tiene por qué llegar a tomar un lock sobre una billetera.
//
// Lo que NO se prueba acá es si la regla se cumple de verdad: eso lo decide la
// base y lo prueba mensualidadesM7.integration.ts. Acá se prueba que la puerta
// de entrada no deja pasar basura.

const ID = "00000000-0000-4000-8000-000000000001";
const CLAVE = "k".repeat(24);
const CTX = { actor: "admin", rol: "admin" as const, idempotencyKey: CLAVE };
const ctxCon = (clave: string) => ({ ...CTX, idempotencyKey: clave });

const codigoDe = async (p: Promise<{ ok: boolean } & Record<string, unknown>>) => {
  const r = await p;
  return r.ok ? "ok" : String(r.codigo);
};

async function main() {
  // ── 1) El motivo es obligatorio en TODAS las acciones ──
  // Sin motivo no hay acción: es lo que convierte un cambio en algo explicable.
  const sinMotivo: Array<[string, Promise<never>]> = [
    ["extender", extenderVencimiento(ID, "2026-12-31", "", CTX) as never],
    ["ajustar", ajustarSaldo(ID, "agregar", 60, "   ", CTX) as never],
    ["bloquear", cambiarBloqueo(ID, true, "", CTX) as never],
    ["telefono", cambiarTelefono(ID, "3515123456", "", CTX) as never],
    ["codigo", regenerarCodigo(ID, "", CTX) as never],
    ["cancelar", cancelarReservaAdmin(ID, "RES-ABCD-2345", "", CTX) as never],
    ["reprogramar", reprogramarReservaAdmin(ID, "RES-ABCD-2345", "2026-12-30", "10:00", "", CTX) as never],
  ];
  for (const [nota, p] of sinMotivo) {
    assert.equal(await codigoDe(p), "motivo_requerido", `${nota}: sin motivo no se ejecuta`);
  }

  // Y tiene un tope: un motivo no es un lugar donde pegar un archivo.
  assert.equal(
    await codigoDe(extenderVencimiento(ID, "2026-12-31", "x".repeat(MOTIVO_MAX + 1), CTX) as never),
    "motivo_demasiado_largo",
  );
  assert.equal(
    await codigoDe(extenderVencimiento(ID, "2026-12-31", "x".repeat(MOTIVO_MAX), ctxCon("")) as never),
    "idempotency_invalida",
    "un motivo en el límite exacto pasa la validación de longitud",
  );

  // ── 2) La clave de idempotencia es obligatoria y opaca ──
  // Es lo que hace que un doble clic no aplique dos veces.
  for (const mala of ["", "corta", "a".repeat(15), "a".repeat(65), "clave con espacios 1234", "ñññññññññññññññññ"]) {
    assert.equal(
      await codigoDe(cambiarBloqueo(ID, true, "motivo", ctxCon(mala)) as never),
      "idempotency_invalida",
      `clave inválida: ${JSON.stringify(mala)}`,
    );
  }
  for (const buena of ["a".repeat(16), "a".repeat(64), "A-b_0123456789abcdef"]) {
    assert.notEqual(
      await codigoDe(cambiarBloqueo(ID, true, "motivo", ctxCon(buena)) as never),
      "idempotency_invalida",
      `clave válida: ${buena}`,
    );
  }

  // ── 3) Ajuste de saldo: cantidad POSITIVA y múltiplo de 15 ──
  // La dirección viaja aparte, así que no existe "agregar -60".
  assert.equal(await codigoDe(ajustarSaldo(ID, "agregar", 0, "m", CTX) as never), "minutos_invalidos",
    "cero minutos no es una operación");
  assert.equal(await codigoDe(ajustarSaldo(ID, "agregar", -60, "m", CTX) as never), "minutos_invalidos",
    "una cantidad negativa no descuenta: para eso está 'descontar'");
  assert.equal(await codigoDe(ajustarSaldo(ID, "descontar", -60, "m", CTX) as never), "minutos_invalidos");
  assert.equal(await codigoDe(ajustarSaldo(ID, "agregar", 7, "m", CTX) as never), "minutos_no_multiplo_15",
    "el modelo entero trabaja en múltiplos de 15");
  assert.equal(await codigoDe(ajustarSaldo(ID, "agregar", 22.5 as number, "m", CTX) as never), "minutos_invalidos",
    "fraccionario tampoco");
  assert.equal(
    await codigoDe(ajustarSaldo(ID, "invalida" as "agregar", 60, "m", CTX) as never),
    "operacion_invalida",
    "solo existen agregar y descontar",
  );

  // ── 4) Extender vencimiento: la fecha tiene que ser una fecha ──
  for (const mala of ["", "31/12/2026", "2026-13-01", "20261231", "mañana"]) {
    assert.equal(
      await codigoDe(extenderVencimiento(ID, mala, "m", CTX) as never),
      "fecha_invalida",
      `fecha inválida: ${mala}`,
    );
  }

  // ── 5) Teléfono: se exige algo, y con un largo razonable ──
  assert.equal(await codigoDe(cambiarTelefono(ID, "", "m", CTX) as never), "telefono_invalido");
  assert.equal(await codigoDe(cambiarTelefono(ID, "   ", "m", CTX) as never), "telefono_invalido");
  assert.equal(await codigoDe(cambiarTelefono(ID, "9".repeat(41), "m", CTX) as never), "telefono_invalido");

  // ── 6) Reservas: la referencia tiene la forma pública o no existe ──
  // Mismo 404 para una referencia mal escrita que para una ajena: no se puede
  // enumerar probando.
  for (const mala of ["", "RES-0000-0000", "res-abcd-2345", "RES-ABCD", "ABCD-2345"]) {
    assert.equal(
      await codigoDe(cancelarReservaAdmin(ID, mala, "m", CTX) as never),
      "reserva_inexistente",
      `referencia inválida: ${JSON.stringify(mala)}`,
    );
    assert.equal(
      await codigoDe(reprogramarReservaAdmin(ID, mala, "2026-12-30", "10:00", "m", CTX) as never),
      "reserva_inexistente",
    );
  }
  // El alfabeto público no tiene 0, O, 1 ni I: por eso RES-0000-0000 no vale.

  // ── 7) El motivo se valida ANTES que la referencia ──
  // Si faltan los dos, el primer reclamo es el motivo: es el dato que la
  // persona tiene que escribir, no uno que el sistema pueda deducir.
  assert.equal(await codigoDe(cancelarReservaAdmin(ID, "mala", "", CTX) as never), "motivo_requerido");

  // ── 8) Filtros del listado ──
  assert.deepEqual([...ESTADOS_FILTRO], ["todas", "vigente", "agotada", "vencida", "bloqueada"]);
  for (const v of ESTADOS_FILTRO) assert.equal(esEstadoFiltro(v), true, `${v} es un filtro válido`);
  for (const v of ["", "activa", "TODAS", "vigentes", null, 3, {}]) {
    assert.equal(esEstadoFiltro(v), false, `${JSON.stringify(v)} no es un filtro`);
  }
  assert.ok(POR_PAGINA > 0 && POR_PAGINA <= POR_PAGINA_MAX);
  assert.equal(POR_PAGINA_MAX, 100, "el tope de página es el mismo que aplica la base");

  // ── 9) La vista previa del ajuste no puede prometer un resultado imposible ──
  // Salió de la pasada visual: descontar más de lo que hay mostraba
  // "→ resultante: 0 min" porque la cuenta se recortaba con Math.max(..., 0).
  // El servidor rechaza esa operación, así que la pantalla estaba anunciando
  // algo que no iba a pasar. La cuenta tiene que poder dar negativo para que la
  // interfaz pueda decir que no alcanza.
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "app/admin/(panel)/mensualidades/[id]/DetalleMensualidadCliente.tsx", "utf8",
    );
    const panel = src.slice(src.indexOf("Saldo actual:"), src.indexOf("Es un ajuste administrativo"));
    assert.ok(!/Math\.max\(/.test(panel),
      "el resultado del ajuste NO se recorta a cero: eso prometía un resultado que el servidor rechaza");
    assert.ok(/no alcanza/.test(panel),
      "cuando el descuento supera al saldo, la vista previa lo dice");
  }

  console.log("mensualidadesM7.test.ts OK (validaciones previas a la base)");
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
