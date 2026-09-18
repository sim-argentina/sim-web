import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORTESIA_TIPOS, MEDIOS_PAGO, MODALIDADES, MOTIVO_MAX, validarAlta,
} from "@/lib/mensualidadesAdminAlta";
import { simularCompra, MAX_TRASLADO_MINUTOS } from "@/lib/mensualidades";

// Pruebas PURAS del alta administrativa (Bloque M7.4). No consultan la base ni
// la red: solo necesitan el entorno porque el módulo construye el cliente de
// Supabase al importarse, igual que el resto de los tests puros del proyecto.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM7_4.test.ts
//
// El comportamiento contra la base lo prueba mensualidadesM7_4.integration.ts.
// Acá vive lo que se puede afirmar sin ella: qué entradas se aceptan, qué se
// rechaza y con qué código, y que las listas sigan cerradas.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const base = (over: Record<string, unknown> = {}) => ({
  nombre: "Ana",
  apellido: "Gómez",
  telefono: "3515123456",
  email: "ana@example.com",
  plan_slug: "2h",
  modalidad: "venta",
  medio_pago: "efectivo",
  motivo: "Cobro en mostrador",
  declaracion: true,
  ...over,
});

// ── 1) El camino feliz de cada modalidad ────────────────────────────────────
{
  const venta = validarAlta(base());
  assert.ok(venta.ok, "una venta válida pasa");
  assert.equal(venta.data.modalidad, "venta");
  assert.equal(venta.data.medioPago, "efectivo");
  assert.equal(venta.data.cortesiaTipo, null, "una venta no lleva tipo de cortesía");
  assert.equal(venta.data.telefonoNorm, "3515123456", "el teléfono queda canónico");

  const cortesia = validarAlta(base({
    modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: "compensacion",
  }));
  assert.ok(cortesia.ok, "una cortesía válida pasa");
  assert.equal(cortesia.data.medioPago, null, "una cortesía no lleva medio de pago");
  assert.equal(cortesia.data.cortesiaTipo, "compensacion");

  // Un medio de pago colado en una cortesía se descarta, no se arrastra.
  const mezcla = validarAlta(base({
    modalidad: "cortesia", medio_pago: "credito", cortesia_tipo: "compensacion",
  }));
  assert.ok(mezcla.ok && mezcla.data.medioPago === null,
    "el medio de pago de una cortesía se ignora, no viaja a la base");
}

// ── 2) Listas cerradas ──────────────────────────────────────────────────────
{
  assert.deepEqual([...MODALIDADES], ["venta", "cortesia"]);
  // Payway y transferencia quedan FUERA a propósito: no tienen cuenta
  // inequívoca en el modelo financiero vigente.
  assert.deepEqual([...MEDIOS_PAGO], ["efectivo", "qr", "debito", "credito"]);
  assert.ok(!(MEDIOS_PAGO as readonly string[]).includes("transferencia"));
  assert.deepEqual([...CORTESIA_TIPOS],
    ["cortesia_comercial", "compensacion", "correccion_autorizada"]);

  for (const malo of ["", "regalo", "VENTA", "cortesía", "venta;cortesia"]) {
    const r = validarAlta(base({ modalidad: malo }));
    assert.ok(!r.ok && r.codigo === "modalidad_invalida", `modalidad "${malo}" se rechaza`);
  }
  // Los espacios alrededor sí se perdonan: el valor sigue siendo el mismo.
  assert.ok(validarAlta(base({ modalidad: "  venta  " })).ok, "los espacios se recortan");
  for (const malo of ["", "payway", "transferencia", "mixto", "gratis", "EFECTIVO"]) {
    const r = validarAlta(base({ medio_pago: malo }));
    assert.ok(!r.ok && r.codigo === "medio_pago_invalido", `medio "${malo}" se rechaza`);
  }
  for (const malo of ["", "porque_si", "cortesia"]) {
    const r = validarAlta(base({ modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: malo }));
    assert.ok(!r.ok && r.codigo === "cortesia_tipo_invalido", `tipo "${malo}" se rechaza`);
  }
}

// ── 3) El motivo: obligatorio y recortado ───────────────────────────────────
{
  for (const vacio of ["", "   ", "\t", "\n  \n"]) {
    const r = validarAlta(base({ motivo: vacio }));
    assert.ok(!r.ok && r.codigo === "motivo_requerido", `motivo ${JSON.stringify(vacio)} es vacío`);
  }
  const conEspacios = validarAlta(base({ motivo: "   Pagó en el mostrador   " }));
  assert.ok(conEspacios.ok && conEspacios.data.motivo === "Pagó en el mostrador",
    "el motivo se recorta antes de guardarse");

  const largo = validarAlta(base({ motivo: "x".repeat(MOTIVO_MAX + 1) }));
  assert.ok(!largo.ok && largo.codigo === "motivo_demasiado_largo");
  const justo = validarAlta(base({ motivo: "x".repeat(MOTIVO_MAX) }));
  assert.ok(justo.ok, "el tope es inclusivo");
}

// ── 4) La declaración administrativa es obligatoria y estricta ──────────────
// No es la aceptación del cliente: es el admin diciendo que informó. Por eso
// tiene que llegar true explícito, igual que la casilla pública.
{
  for (const falso of [false, undefined, null, "true", 1, "on", {}]) {
    const r = validarAlta(base({ declaracion: falso }));
    assert.ok(!r.ok && r.codigo === "declaracion_requerida",
      `declaración ${JSON.stringify(falso)} no alcanza`);
  }
  assert.ok(validarAlta(base({ declaracion: true })).ok);
}

// ── 5) Identidad: teléfono y correo ─────────────────────────────────────────
{
  // El teléfono se normaliza con la MISMA función que la compra pública.
  const variantes = ["3515123456", "0351 15 512-3456", "+54 9 351 512 3456", "(351) 512-3456"];
  for (const v of variantes) {
    const r = validarAlta(base({ telefono: v }));
    assert.ok(r.ok, `"${v}" es interpretable`);
    assert.equal(r.data.telefonoNorm, "3515123456", `"${v}" → canónico`);
  }
  for (const malo of ["", "123", "abc", "+1 555 0100", "99999999999999"]) {
    const r = validarAlta(base({ telefono: malo }));
    assert.ok(!r.ok && r.codigo === "telefono_invalido", `"${malo}" se rechaza`);
  }

  for (const malo of ["", "ana", "ana@", "@example.com", "ana@example"]) {
    const r = validarAlta(base({ email: malo }));
    assert.ok(!r.ok && r.codigo === "email_invalido", `correo "${malo}" se rechaza`);
  }
  const mayus = validarAlta(base({ email: "  ANA@Example.COM  " }));
  assert.ok(mayus.ok && mayus.data.email === "ana@example.com", "el correo se normaliza");

  for (const campo of ["nombre", "apellido"]) {
    assert.ok(!validarAlta(base({ [campo]: "" })).ok, `${campo} vacío se rechaza`);
    assert.ok(!validarAlta(base({ [campo]: "x".repeat(61) })).ok, `${campo} larguísimo se rechaza`);
    // Caracteres de control: rompen logs y pantallas.
    assert.ok(!validarAlta(base({ [campo]: "Ana\u0000" })).ok, `${campo} con control se rechaza`);
  }
}

// ── 6) Nada monetario se acepta del cuerpo ──────────────────────────────────
// Lo importante no es que se rechace: es que NO SE LEA. El cuerpo puede traer
// basura y la salida validada no la contiene.
{
  const r = validarAlta(base({
    precio: 1, plan_precio: 1, importe_bruto: 1, comision_mp: 0,
    minutos: 99999, plan_minutos: 99999, saldo_minutos: 99999,
    vence_el: "2099-12-31", codigo: "MEN-AAAA-AAAA", canal: "web",
    actor: "root", actor_rol: "admin", rol: "admin",
    mp_payment_id: "1", payment_id: "1", estado_pago: "aprobado", procesamiento: "aplicado",
  }));
  assert.ok(r.ok, "los campos de más no rompen la validación");
  assert.deepEqual(Object.keys(r.data).sort(), [
    "apellido", "cobradoEl", "cortesiaTipo", "declaracion", "email", "medioPago",
    "modalidad", "motivo", "nombre", "planSlug", "telefono", "telefonoNorm",
  ], "la salida validada es un conjunto CERRADO de campos");
}

// ── 7) La fecha de cobro, cuando viene ──────────────────────────────────────
{
  const sin = validarAlta(base());
  assert.ok(sin.ok && sin.data.cobradoEl === null, "sin fecha, la decide el servidor");
  const con = validarAlta(base({ cobrado_el: "2026-09-01" }));
  assert.ok(con.ok && con.data.cobradoEl === "2026-09-01");
  // Un mes 13 pasa el regex y no existe en el calendario.
  for (const malo of ["2026-13-01", "2026-02-31", "ayer", "01/09/2026"]) {
    const r = validarAlta(base({ cobrado_el: malo }));
    assert.ok(!r.ok, `fecha "${malo}" se rechaza`);
  }
  // Una cortesía no tiene fecha de cobro: no hubo cobro.
  const cor = validarAlta(base({
    modalidad: "cortesia", medio_pago: undefined, cortesia_tipo: "compensacion",
    cobrado_el: "2026-09-01",
  }));
  assert.ok(cor.ok && cor.data.cobradoEl === null, "una cortesía no arrastra fecha de cobro");
}

// ── 8) La previsualización usa las reglas del producto, no unas propias ─────
{
  // simularCompra es el espejo de la RPC y lo usa previsualizarAlta.
  const alta = simularCompra({ saldoActual: 0, venceActual: null, planMinutos: 120, hoy: "2026-09-18" });
  assert.equal(alta.tipo, "alta");
  assert.equal(alta.saldoResultante, 120, "un alta arranca con el plan");

  const renov = simularCompra({ saldoActual: 195, venceActual: "2026-10-01", planMinutos: 120, hoy: "2026-09-18" });
  assert.equal(renov.tipo, "renovacion");
  assert.equal(renov.trasladados, MAX_TRASLADO_MINUTOS, "el tope de traslado es una hora");
  assert.equal(renov.descartados, 135);
  assert.equal(renov.saldoResultante, 180);

  // Vencida ayer ⇒ alta, sin recuperar saldo.
  const vencida = simularCompra({ saldoActual: 300, venceActual: "2026-09-17", planMinutos: 60, hoy: "2026-09-18" });
  assert.equal(vencida.tipo, "alta");
  assert.equal(vencida.saldoResultante, 60, "el saldo vencido no vuelve");

  // El día del vencimiento todavía es vigente: se usa hasta las 23:59.
  const borde = simularCompra({ saldoActual: 30, venceActual: "2026-09-18", planMinutos: 60, hoy: "2026-09-18" });
  assert.equal(borde.tipo, "renovacion", "el día del vencimiento todavía renueva");

  const modulo = read("lib/mensualidadesAdminAlta.ts");
  assert.match(modulo, /simularCompra\(/, "la previa usa el simulador del producto");
  assert.ok(!/60\s*\)|MAX_TRASLADO/.test(modulo.split("simularCompra")[0] ?? ""),
    "la previa no reimplementa el tope por su cuenta");
}

// ── 9) La cortesía no es "precio cero" ──────────────────────────────────────
// Si el día de mañana un plan valiera 0, una venta seguiría siendo una venta y
// una cortesía seguiría siendo una cortesía: la diferencia es el CANAL.
{
  const sql = read("db/mensualidades-m7-4-alta-administrativa.sql");
  assert.match(sql, /canal in \('web', 'admin_venta'\)/,
    "Finanzas filtra por canal, no por importe");
  assert.ok(!/importe_bruto\s*>\s*0/.test(sql),
    "no se usa el importe para decidir si algo es un ingreso");
  assert.match(sql, /p_actor_rol, ''\) <> 'admin'/, "la RPC exige rol admin");
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /grant execute on function public\.mensualidad_admin_alta/);
  assert.match(sql, /from public, anon, authenticated/);
}

console.log("mensualidadesM7_4.test.ts OK (entradas cerradas, motivo, declaración y canal)");
