import { strict as assert } from "node:assert";
import {
  MOTIVOS_FILA,
  MOTIVOS_TELEFONO,
  calcularAudiencia,
  destinoWhatsapp,
  enmascararDestino,
  enmascararTelefono,
  prefijoReporte,
  validarCodigosArea,
  validarConfigAudiencia,
  ventanaAudiencia,
  type ConfigAudiencia,
  type ContextoAudiencia,
  type ResultadoAudiencia,
  type TurnoAudiencia,
  type VentanaAudiencia,
} from "@/lib/marketing/audiencia";

// Marketing · audiencia del stand (Etapa 1). Puro: sin base y sin red.
// Ejecutar: npx tsx lib/marketing/audiencia.test.ts
// Argentina = UTC−3 todo el año: 03:00Z es la medianoche de SIM.
// Los teléfonos son sintéticos (55501xx): ningún envío sale de acá.

globalThis.fetch = (() => {
  throw new Error("red prohibida en las pruebas de audiencia");
}) as typeof fetch;

// 19/10/2026 23:30 en Argentina; en UTC ya es el 20/10.
const NOCHE_19 = new Date("2026-10-20T02:30:00Z");

let siguienteId = 1;
function turno(p: Partial<TurnoAudiencia> & { fecha: string }): TurnoAudiencia {
  return {
    id: siguienteId++,
    nombre: "Ana López",
    telefono: "351 555-0101",
    estado: "activo",
    total: 10000,
    metodo_pago: "qr",
    ...p,
  };
}

const sinConsentimiento: ContextoAudiencia = { ahora: NOCHE_19, consentimientos: new Set() };
const con = (telefonos: string[], extra: Partial<ContextoAudiencia> = {}): ContextoAudiencia => ({
  ahora: NOCHE_19,
  consentimientos: new Set(telefonos),
  ...extra,
});
const config = (ventanaDias: VentanaAudiencia, extra: Partial<ConfigAudiencia> = {}): ConfigAudiencia => ({ ventanaDias, ...extra });

/** Las cuentas de filas y de teléfonos son particiones: nada se pierde ni se cuenta dos veces. */
function invariantes(r: ResultadoAudiencia, filas: number) {
  const f = r.filas;
  assert.equal(f.leidas, filas, "se leyeron todas las filas");
  assert.equal(f.fechaInvalida + f.futuras + f.fueraDeVentana + f.deHoy + f.enVentana, f.leidas, "partición de filas");
  const excl = MOTIVOS_FILA.reduce((s, m) => s + f.excluidas[m], 0);
  assert.equal(excl + f.validas, f.enVentana, "partición de la ventana");
  const rech = Object.values(f.rechazosTelefono).reduce((s, n) => s + (n ?? 0), 0);
  assert.equal(rech, f.excluidas.telefono_no_normalizable, "cada no normalizable tiene su motivo");
  const exclTel = MOTIVOS_TELEFONO.reduce((s, m) => s + r.telefonos.excluidos[m], 0);
  assert.equal(r.telefonos.elegibles + exclTel, r.telefonos.unicos, "partición de teléfonos");
  assert.equal(r.elegibles.length, r.telefonos.elegibles);
  assert.equal(r.excluidos.length, exclTel);
  assert.equal(r.pendientesConsentimiento.length, r.telefonos.excluidos.sin_consentimiento);
}

// ── 1. Ventana por fecha de Argentina, en el borde de las 21:00–23:59 ────────
{
  assert.deepEqual(ventanaAudiencia(NOCHE_19, 14), { hoy: "2026-10-19", desde: "2026-10-05", hasta: "2026-10-18" });
  assert.deepEqual(ventanaAudiencia(NOCHE_19, 21), { hoy: "2026-10-19", desde: "2026-09-28", hasta: "2026-10-18" });
  assert.equal(ventanaAudiencia(new Date("2026-10-19T23:59:59Z"), 14).hoy, "2026-10-19", "20:59 ART sigue siendo el 19");
  assert.equal(ventanaAudiencia(new Date("2026-10-20T03:00:00Z"), 14).hoy, "2026-10-20", "medianoche de SIM");
  assert.throws(() => ventanaAudiencia(new Date("no es fecha"), 14), /Reloj inválido/);

  const filas = [
    turno({ fecha: "2026-10-19", telefono: "3515550101" }), // hoy: fuera de la ventana
    turno({ fecha: "2026-10-18", telefono: "3515550102" }), // ayer: adentro
    turno({ fecha: "2026-10-05", telefono: "3515550103" }), // hoy − 14: adentro
    turno({ fecha: "2026-10-04", telefono: "3515550104" }), // hoy − 15: afuera
    turno({ fecha: "2026-10-25", telefono: "3515550105" }), // futura
    turno({ fecha: "2026-02-30", telefono: "3515550106" }), // inexistente
    turno({ fecha: "19/10/2026", telefono: "3515550107" }), // otro formato
  ];
  const r = calcularAudiencia(filas, config(14), sinConsentimiento);
  invariantes(r, filas.length);
  assert.equal(r.filas.deHoy, 1, "con UTC el 19 habría entrado como ayer");
  assert.equal(r.filas.enVentana, 2);
  assert.equal(r.filas.fueraDeVentana, 1);
  assert.equal(r.filas.futuras, 1);
  assert.equal(r.filas.fechaInvalida, 2);
  assert.deepEqual(r.pendientesConsentimiento.map((d) => d.telefono), ["3515550102", "3515550103"]);
}

// ── 2. Sin consentimiento no hay nadie: hoy la audiencia elegible es 0 ───────
{
  const filas = [turno({ fecha: "2026-10-18" }), turno({ fecha: "2026-10-10", telefono: "3515550109" })];
  const r = calcularAudiencia(filas, config(14), sinConsentimiento);
  invariantes(r, filas.length);
  assert.equal(r.telefonos.elegibles, 0);
  assert.equal(r.telefonos.excluidos.sin_consentimiento, 2);
  assert.ok(r.advertencias.some((a) => /No hay consentimientos/.test(a)));

  const conUno = calcularAudiencia(filas, config(14), con(["3515550101"]));
  assert.deepEqual(conUno.elegibles.map((d) => d.telefono), ["3515550101"]);
  assert.equal(conUno.elegibles[0].destinoWhatsapp, "5493515550101");
  assert.ok(!conUno.advertencias.some((a) => /No hay consentimientos/.test(a)));
}

// ── 3. Deduplicación por teléfono canónico, en cualquier formato ─────────────
{
  const filas = [
    turno({ fecha: "2026-10-08", telefono: "351 555-0101", id: 10 }),
    turno({ fecha: "2026-10-15", telefono: "+54 9 351 555-0101", id: 30 }),
    turno({ fecha: "2026-10-15", telefono: "0351 15 555-0101", id: 20 }),
  ];
  const r = calcularAudiencia(filas, config(14), con(["3515550101"]));
  invariantes(r, filas.length);
  assert.equal(r.telefonos.unicos, 1);
  const d = r.elegibles[0];
  assert.equal(d.visitas, 3);
  assert.equal(d.diasConVisita, 2);
  assert.equal(d.ultimaVisita, "2026-10-15");
  assert.equal(d.turnoId, "30", "mismo día: gana el id mayor");
  assert.equal(d.nombre, "Ana López");
  // El consentimiento y la baja se reconocen aunque estén guardados en otro formato.
  assert.equal(calcularAudiencia(filas, config(14), con(["+54 9 351 555-0101"])).telefonos.elegibles, 1);
}

// ── 4. Varios nombres en un teléfono: no se personaliza ─────────────────────
{
  const mismo = [
    turno({ fecha: "2026-10-08", nombre: "ana  lopez" }),
    turno({ fecha: "2026-10-12", nombre: "Ana López" }),
    turno({ fecha: "2026-10-14", nombre: "  " }),
  ];
  const r1 = calcularAudiencia(mismo, config(14), con(["3515550101"]));
  assert.equal(r1.elegibles[0].nombre, "Ana López", "tildes y espacios no hacen otro nombre; gana el más reciente");
  assert.equal(r1.elegibles[0].variosNombres, false);

  const distintos = [turno({ fecha: "2026-10-08", nombre: "Ana López" }), turno({ fecha: "2026-10-12", nombre: "Carlos López" })];
  const r2 = calcularAudiencia(distintos, config(14), con(["3515550101"]));
  assert.equal(r2.elegibles[0].nombre, null);
  assert.equal(r2.elegibles[0].variosNombres, true);

  const sinNombre = calcularAudiencia([turno({ fecha: "2026-10-08", nombre: null })], config(14), con(["3515550101"]));
  assert.equal(sinNombre.elegibles[0].nombre, null);
  assert.equal(sinNombre.elegibles[0].variosNombres, false);
}

// ── 5. Teléfonos vacíos o que no normalizan: excluidos con motivo ───────────
{
  const filas = [
    turno({ fecha: "2026-10-10", telefono: null }),
    turno({ fecha: "2026-10-10", telefono: "   " }),
    turno({ fecha: "2026-10-10", telefono: "-" }),
    turno({ fecha: "2026-10-10", telefono: "12345" }),
    turno({ fecha: "2026-10-10", telefono: "351555010" }),
    turno({ fecha: "2026-10-10", telefono: "abc 351" }),
    turno({ fecha: "2026-10-10", telefono: "+1 305 555 0101" }),
    turno({ fecha: "2026-10-10", telefono: "3515550101" }),
  ];
  const r = calcularAudiencia(filas, config(14), sinConsentimiento);
  invariantes(r, filas.length);
  assert.equal(r.filas.excluidas.sin_telefono, 3);
  assert.equal(r.filas.excluidas.telefono_no_normalizable, 4);
  assert.deepEqual(r.filas.rechazosTelefono, { largo_invalido: 2, simbolos_invalidos: 1, prefijo_extranjero: 1 });
  assert.equal(r.telefonos.unicos, 1, "solo el legible");
}

// ── 6. Gratis: afuera por defecto, adentro si se pide ───────────────────────
{
  const filas = [
    turno({ fecha: "2026-10-10", telefono: "3515550101", total: 0, metodo_pago: "gratis" }),
    turno({ fecha: "2026-10-10", telefono: "3515550102", total: 5000, metodo_pago: "gratis" }), // contradictorio
    turno({ fecha: "2026-10-10", telefono: "3515550103", total: 0, metodo_pago: "qr" }), // contradictorio
    turno({ fecha: "2026-10-10", telefono: "3515550104", total: "12000", metodo_pago: "efectivo" }),
    turno({ fecha: "2026-10-10", telefono: "3515550105", estado: "cancelado" }),
  ];
  const r = calcularAudiencia(filas, config(14), sinConsentimiento);
  invariantes(r, filas.length);
  assert.equal(r.filas.excluidas.no_pago, 3, "un dato contradictorio no cuenta como pago");
  assert.equal(r.filas.excluidas.cancelado, 1);
  assert.deepEqual(r.pendientesConsentimiento.map((d) => d.telefono), ["3515550104"]);

  const conGratis = calcularAudiencia(filas, config(14, { incluirGratis: true }), sinConsentimiento);
  invariantes(conGratis, filas.length);
  assert.equal(conGratis.telefonos.unicos, 4, "el cancelado sigue afuera");
}

// ── 7. Segmento por códigos de área completos: 3 vs 4 dígitos ───────────────
{
  const v = validarCodigosArea(["351", "3543", "11", "351", " 358 "]);
  assert.deepEqual(v.codigos, ["11", "351", "3543", "358"]);
  assert.deepEqual(v.errores, []);
  assert.ok(v.advertencias.some((a) => a.includes("351, 358") && /4 que empiezan igual/.test(a)));
  assert.ok(v.advertencias.some((a) => a.includes("3543") && /solo la forma/.test(a)));
  for (const malo of ["35", "3", "999", "0351", "35x", "12345", "4123", ""]) {
    assert.equal(validarCodigosArea([malo]).errores.length, 1, `"${malo}" se rechaza`);
  }
  assert.match(validarCodigosArea(["35"]).errores[0], /no es un código de área/, "'empieza con 35' no es segmento");

  const filas = [
    turno({ fecha: "2026-10-10", telefono: "3515550101" }),
    turno({ fecha: "2026-10-10", telefono: "3543550101" }),
    turno({ fecha: "2026-10-10", telefono: "3585550101" }),
    turno({ fecha: "2026-10-10", telefono: "1155550101" }),
  ];
  const todos = ["3515550101", "3543550101", "3585550101", "1155550101"];
  const solo351 = calcularAudiencia(filas, config(14, { codigosArea: ["351"] }), con(todos));
  invariantes(solo351, filas.length);
  assert.deepEqual(solo351.elegibles.map((d) => d.telefono), ["3515550101"]);
  assert.equal(solo351.telefonos.excluidos.fuera_de_segmento, 3);
  assert.deepEqual(
    calcularAudiencia(filas, config(14, { codigosArea: ["3543", "11"] }), con(todos)).elegibles.map((d) => d.telefono),
    ["1155550101", "3543550101"],
  );
  assert.equal(calcularAudiencia(filas, config(14, { codigosArea: [] }), con(todos)).telefonos.elegibles, 4, "lista vacía = sin filtro");
  assert.throws(() => calcularAudiencia(filas, config(14, { codigosArea: ["35"] }), con(todos)), /Configuración de audiencia inválida/);
}

// ── 8. Bajas, exclusiones externas y quien ya volvió ────────────────────────
{
  const filas = [
    turno({ fecha: "2026-10-10", telefono: "3515550101" }),
    turno({ fecha: "2026-10-10", telefono: "3515550102" }),
    turno({ fecha: "2026-10-10", telefono: "3515550103" }),
    turno({ fecha: "2026-10-15", telefono: "3515550103" }), // volvió dentro de la ventana
    turno({ fecha: "2026-10-10", telefono: "3515550104" }),
    turno({ fecha: "2026-10-19", telefono: "3515550104", total: 0, metodo_pago: "gratis" }), // volvió hoy, gratis
  ];
  const ctx = con(["3515550101", "3515550102", "3515550103", "3515550104"], {
    bajas: new Set(["+54 9 351 555-0101", "no es un teléfono"]),
    otrasExclusiones: new Map([["3515550102", "titular_mensualidad"]]),
  });
  const r = calcularAudiencia(filas, config(14), ctx);
  invariantes(r, filas.length);
  assert.equal(r.telefonos.excluidos.con_baja, 1, "la baja gana aunque haya consentimiento");
  assert.equal(r.telefonos.excluidos.titular_mensualidad, 1);
  assert.deepEqual(r.elegibles.map((d) => [d.telefono, d.diasConVisita]), [["3515550103", 2], ["3515550104", 2]]);
  assert.ok(r.advertencias.some((a) => /1 baja\(s\)/.test(a)), "una baja ilegible se avisa, no se ignora en silencio");

  const sinRetornados = calcularAudiencia(filas, config(14, { excluirRetornados: true }), ctx);
  invariantes(sinRetornados, filas.length);
  assert.equal(sinRetornados.telefonos.excluidos.ya_volvio, 2);
  assert.equal(sinRetornados.telefonos.elegibles, 0);
}

// ── 9. El orden de las filas no cambia el resultado ─────────────────────────
{
  const filas = [
    turno({ fecha: "2026-10-12", telefono: "3515550101", nombre: "Ana" }),
    turno({ fecha: "2026-10-16", telefono: "3515550102", nombre: "Beto" }),
    turno({ fecha: "2026-10-16", telefono: "3515550103", nombre: "Caro" }),
    turno({ fecha: "2026-10-12", telefono: "3515550101", nombre: "Ana" }),
    turno({ fecha: "2026-10-07", telefono: "3515550104", nombre: "Dani" }),
  ];
  const ctx = con(["3515550101", "3515550102", "3515550103", "3515550104"]);
  const a = calcularAudiencia(filas, config(14), ctx);
  const b = calcularAudiencia([...filas].reverse(), config(14), ctx);
  assert.deepEqual(a, b);
  assert.deepEqual(a.elegibles.map((d) => d.telefono), ["3515550102", "3515550103", "3515550101", "3515550104"]);
}

// ── 10. Ventana de 21 días y configuración inválida ─────────────────────────
{
  const filas = [turno({ fecha: "2026-09-28", telefono: "3515550101" }), turno({ fecha: "2026-09-27", telefono: "3515550102" })];
  const r = calcularAudiencia(filas, config(21), sinConsentimiento);
  invariantes(r, filas.length);
  assert.equal(r.desde, "2026-09-28");
  assert.equal(r.filas.enVentana, 1);
  assert.deepEqual(validarConfigAudiencia({ ventanaDias: 30 as VentanaAudiencia }), ["La ventana tiene que ser de 14 o 21 días."]);
  assert.throws(() => calcularAudiencia(filas, { ventanaDias: 7 as VentanaAudiencia }, sinConsentimiento), /14 o 21/);
}

// ── 11. Máscaras y destino: nunca más de 5 dígitos a la vista ───────────────
{
  assert.equal(enmascararTelefono("3515550101"), "351*****01");
  assert.equal(enmascararDestino("3515550101"), "+54 9 351 ***** 01");
  assert.equal(enmascararTelefono("351555"), "**********");
  assert.equal(enmascararDestino("x"), "+54 9 ***");
  assert.equal(destinoWhatsapp("1155550101"), "5491155550101");
  assert.throws(() => destinoWhatsapp("05491155550101"), /no canónico/);
  assert.equal(prefijoReporte("1155550101"), "11");
  assert.equal(prefijoReporte("3543550101"), "354");
  const visibles = enmascararTelefono("3515550101").replace(/\D/g, "");
  assert.ok(visibles.length <= 5);
}

console.log("audiencia: ok");
