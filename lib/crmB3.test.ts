import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import type { VentaFila } from "@/lib/crmB3";

// Ejecutar: npx tsx lib/crmB3.test.ts
// CRM B3, puro (sin base):
//   1) importes: centavos sin coma flotante, lo que escribe una persona (miles y
//      decimales a la argentina), texto para la RPC y formato;
//   2) flujos de dinero de Pack 10 y Pack 25: anticipo 50%, cobros únicos y
//      parciales, estado derivado y cobro sugerido;
//   3) estados de comisión (no corresponde, prevista, generada, parcial, pagada,
//      a revisar) y su pendiente;
//   4) reglas: comisión propuesta (origen comercial aunque cierre Administración,
//      recompra espontánea, personalizado sin 0), qué pide confirmación;
//   5) campaña de Empresas: avisos de cantidad, duración y cobro sin modificar nada;
//   6) lista, totales y compras de la ficha (anuladas no suman; definiciones);
//   7) huellas estables;
//   8) aislamiento estático: nada de ventas llega a la interfaz comercial ni a staff.

async function main() {
  // crmB3Server crea el cliente de Supabase al importarse: destino inalcanzable, esta prueba no consulta nada.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sin-uso";
  const B = await import("@/lib/crmB3");
  const { huellaVenta, huellaGestionVenta, huellaRecompra } = await import("@/lib/crmB3Server");

  // ── 1) Importes ──────────────────────────────────────────────────────
  {
    const casos: Array<[string, number | null]> = [
      ["150000", 15_000_000], ["150.000", 15_000_000], ["150.000,50", 15_000_050], ["150000,5", 15_000_050], ["150000.50", 15_000_050],
      ["1.50", 150], ["1.500", 150_000], ["$ 360.000", 36_000_000], ["  40000 ", 4_000_000], ["0,01", 1], ["9999999999,99", 999_999_999_999],
      ["150,000.5", null], ["1.5.0", null], ["150.0000", null], ["12,345", null], ["abc", null], ["", null], ["-100", null], ["12345678901", null], ["1e5", null],
    ];
    for (const [t, c] of casos) assert.equal(B.leerImporte(t), c, `leerImporte(${JSON.stringify(t)})`);
    assert.equal(B.aCentavos(150000), 15_000_000);
    assert.equal(B.aCentavos("150000.10"), 15_000_010);
    assert.equal(B.aCentavos("150000.1"), 15_000_010);
    assert.equal(B.aCentavos(0.1 + 0.2), 30, "sin arrastre de coma flotante");
    assert.equal(B.aCentavos(null), null);
    assert.equal(B.aCentavos("12,5"), null, "la base no devuelve comas");
    assert.equal(B.aTextoImporte(15_000_050), "150000.50");
    assert.equal(B.aTextoImporte(5), "0.05");
    assert.equal(B.aTextoImporte(4_000_000), "40000.00");
    const suma = [10, 20, 30].map((x) => B.aCentavos(x / 100 + 0.001 - 0.001)!).reduce((a, b) => a + b, 0);
    assert.equal(suma, 60, "sumar en centavos no pierde ni gana");
    assert.match(B.formatoPesos(15_000_000), /^\$\s?150\.000$/);
    assert.match(B.formatoPesos(15_000_050), /^\$\s?150\.000,50$/);
    assert.equal(B.formatoPesos(null), "—");
  }

  // ── 2) Flujos de dinero ──────────────────────────────────────────────
  {
    const P10 = 15_000_000;
    const P25 = 36_000_000;
    assert.equal(B.anticipoEsperado(P10), 7_500_000, "Pack 10: anticipo $75.000");
    assert.equal(B.anticipoEsperado(P25), 18_000_000, "Pack 25: anticipo $180.000");
    assert.equal(B.anticipoEsperado(15_000_001), 7_500_001, "centavo impar: el anticipo redondea hacia arriba");
    assert.equal(B.estadoCobro(P10, 0), "sin_cobros");
    assert.equal(B.estadoCobro(P10, 5_000_000), "parcial");
    assert.equal(B.estadoCobro(P10, 7_500_000), "anticipo");
    assert.equal(B.estadoCobro(P10, 14_999_999), "anticipo");
    assert.equal(B.estadoCobro(P10, P10), "cobrada");
    assert.equal(B.estadoCobro(P25, P25), "cobrada", "cobro único por el total");
    assert.equal(B.cobroSugerido(P10, 0, "anticipo"), 7_500_000);
    assert.equal(B.cobroSugerido(P10, 7_500_000, "saldo"), 7_500_000);
    assert.equal(B.cobroSugerido(P10, 5_000_000, "anticipo"), 2_500_000, "completar el anticipo tras un parcial");
    assert.equal(B.cobroSugerido(P10, 9_000_000, "anticipo"), 0, "anticipo ya cubierto");
    assert.equal(B.cobroSugerido(P10, 0, "saldo"), P10, "sin anticipo: el saldo es el total");
    assert.equal(B.cobroSugerido(P10, P10, "otro"), 0);
  }

  // ── 3) Comisión ──────────────────────────────────────────────────────
  {
    type Base = { tipo: "pactada" | "no_corresponde"; pactada: number | null; beneficiario_id: string | null; importe: number };
    const base: Base = { tipo: "pactada", pactada: 4_000_000, beneficiario_id: "tob", importe: 15_000_000 };
    const e = (cobrado: number, pagos: Array<[number, string]> = [], extra: Partial<Base> = {}) =>
      B.estadoComision({ ...base, ...extra, cobrado, pagos: pagos.map(([importe, beneficiario_id]) => ({ importe, beneficiario_id })) });
    assert.deepEqual(e(0), { estado: "prevista", pagado: 0, pendiente: 0, motivos: [] });
    assert.equal(e(7_500_000).estado, "prevista", "con el anticipo sigue prevista");
    assert.deepEqual(e(15_000_000), { estado: "generada", pagado: 0, pendiente: 4_000_000, motivos: [] }, "cobrada por completo → generada");
    assert.deepEqual(e(15_000_000, [[1_500_000, "tob"]]), { estado: "pagada_parcial", pagado: 1_500_000, pendiente: 2_500_000, motivos: [] });
    assert.deepEqual(e(15_000_000, [[1_500_000, "tob"], [2_500_000, "tob"]]), { estado: "pagada", pagado: 4_000_000, pendiente: 0, motivos: [] });
    assert.deepEqual(e(15_000_000, [[4_000_001, "tob"]]).motivos, ["pagos_superan"]);
    assert.deepEqual(e(15_000_000, [[1_000_000, "otro"]]).motivos, ["otro_beneficiario"]);
    assert.equal(e(15_000_000, [[1_000_000, "otro"]]).estado, "a_revisar");
    assert.deepEqual(e(15_000_000, [[1_000_000, "tob"]], { importe: 16_000_000 }).motivos, ["pagos_sin_cobro_total"], "una corrección que sube el importe deja pagos sin cobro total");
    assert.deepEqual(e(0, [], { tipo: "no_corresponde", pactada: null, beneficiario_id: null }),
      { estado: "no_corresponde", pagado: 0, pendiente: 0, motivos: [] });
    assert.deepEqual(e(15_000_000, [[100, "tob"]], { tipo: "no_corresponde" }).motivos, ["pagos_sin_comision"]);
  }

  // ── 4) Reglas de la comisión ─────────────────────────────────────────
  {
    const p10 = { codigo: "pack_10" as const, precio: 15_000_000, comision_estandar: 4_000_000 };
    const p25 = { codigo: "pack_25" as const, precio: 36_000_000, comision_estandar: 9_000_000 };
    const pers = { codigo: "personalizado" as const, precio: null, comision_estandar: null };
    // Ramiro (Administración) cierra un lead de Tobías: la comisión es de quien lo originó.
    assert.deepEqual(B.comisionPropuesta({ esRecompra: false, origenUsuarioId: "tob" }, p10, p10.precio),
      { tipo: "pactada", fundamento: "origen_comercial", beneficiario_id: "tob", importe: 4_000_000 });
    assert.deepEqual(B.comisionPropuesta({ esRecompra: false, origenUsuarioId: "tob" }, p25, p25.precio).importe, 9_000_000);
    assert.equal(B.comisionPropuesta({ esRecompra: false, origenUsuarioId: "tob" }, p10, 14_000_000).importe, null, "con descuento no se asume la de lista");
    assert.equal(B.comisionPropuesta({ esRecompra: false, origenUsuarioId: "tob" }, pers, 52_000_000).importe, null, "personalizado: vacío, nunca 0");
    assert.deepEqual(B.comisionPropuesta({ esRecompra: true, origenUsuarioId: "tob" }, p10, p10.precio),
      { tipo: "no_corresponde", fundamento: "recompra_espontanea", beneficiario_id: null, importe: null }, "recompra: espontánea por defecto");

    const c = (tipo: "pactada" | "no_corresponde", fundamento: Parameters<typeof B.requiereConfirmarComision>[2]["fundamento"], importe: number | null) => ({ tipo, fundamento, importe });
    assert.equal(B.requiereConfirmarComision(p10, p10.precio, c("pactada", "origen_comercial", 4_000_000)), false, "estándar: sin confirmar");
    assert.equal(B.requiereConfirmarComision(p10, p10.precio, c("pactada", "recompra_trabajada", 4_000_000)), false, "recompra trabajada estándar");
    assert.equal(B.requiereConfirmarComision(p10, 14_000_000, c("pactada", "origen_comercial", 4_000_000)), true, "importe no estándar → confirmar comisión");
    assert.equal(B.requiereConfirmarComision(p10, p10.precio, c("pactada", "origen_comercial", 3_000_000)), true, "otra comisión → confirmar");
    assert.equal(B.requiereConfirmarComision(pers, 52_000_000, c("pactada", "origen_comercial", 12_000_000)), true, "personalizado → confirmar");
    assert.equal(B.requiereConfirmarComision(p10, p10.precio, c("no_corresponde", "acuerdo_especial", null)), true, "acuerdo especial sin comisión → confirmar");
    assert.equal(B.requiereConfirmarComision(p10, p10.precio, c("no_corresponde", "recompra_espontanea", null)), false);
    assert.equal(B.requiereConfirmarImporte(p10, 15_000_000), false);
    assert.equal(B.requiereConfirmarImporte(p10, 14_000_000), true);
    assert.equal(B.requiereConfirmarImporte(pers, 52_000_000), false, "personalizado no tiene importe de lista");
  }

  // ── 5) Campaña de Empresas ───────────────────────────────────────────
  {
    const k = {
      id: "k", empresa: "Gym", nombre: null, estado: "activa", estado_pago: "pendiente", modalidad: "unica", cantidad_contratada: 10, duracion_minutos: 20,
      usos_por_codigo: 1, codigo_comun: false, fecha_inicio: null, fecha_vencimiento: null, eliminada: false,
      codigos: { generados: 10, disponibles: 10, utilizados: 0, vencidos: 0, cancelados: 0 }, usos: 0,
      experiencias: { contratadas: 10, usadas: 0, restantes: 10 },
    };
    assert.deepEqual(B.avisosCampania({ experiencias: 10, duracion_minutos: 20, estado_cobro: "anticipo" }, k), [], "coincide: sin avisos");
    const a = B.avisosCampania({ experiencias: 25, duracion_minutos: 15, estado_cobro: "cobrada" }, k);
    assert.equal(a.length, 3, a.join(" | "));
    assert.ok(a[0].includes("10 turnos") && a[0].includes("25 experiencias"));
    assert.ok(a[1].includes("20 minutos"));
    assert.ok(a[2].includes("pago pendiente"), "discordancia de cobro informada");
    assert.ok(B.avisosCampania({ experiencias: 10, duracion_minutos: 20, estado_cobro: "parcial" }, { ...k, estado_pago: "pagado" })[0].includes("pagada"));
    assert.ok(B.avisosCampania({ experiencias: 10, duracion_minutos: 20, estado_cobro: "parcial" }, { ...k, eliminada: true })[0].includes("eliminada"));
  }

  // ── 6) Lista, totales y compras ──────────────────────────────────────
  {
    const venta = (id: string, x: Partial<VentaFila> & { cobrado?: number; importe?: number } = {}): VentaFila => {
      const importe = x.importe ?? 15_000_000;
      const cobrado = x.cobrado ?? 0;
      const com = x.comision ?? { tipo: "pactada", fundamento: "origen_comercial", detalle: null, pactada: 4_000_000, beneficiario: { id: "tob", nombre: "Tob" }, ...B.estadoComision({ tipo: "pactada", pactada: 4_000_000, beneficiario_id: "tob", importe, cobrado, pagos: [] }) };
      const v = {
        id, version: 1, oportunidad_id: `o${id}`, es_recompra: false, fecha_acuerdo: "2026-10-20", registrada_en: "2026-10-20T15:00:00Z",
        empresa: { id: "e1", nombre: "Gimnasio Central" }, producto: { codigo: "pack_10" as const, nombre: "Pack 10" }, experiencias: 10, duracion_minutos: 20,
        importe, cobrado, saldo: importe - cobrado, anticipo_esperado: B.anticipoEsperado(importe), estado_cobro: B.estadoCobro(importe, cobrado),
        comision: com, entrega: { estado: "pendiente" as const, fecha: null }, campania_id: null, anulada: null, pendientes: [] as VentaFila["pendientes"], ...x,
      };
      return { ...v, pendientes: B.pendientesDe(v) };
    };
    const filas = [
      venta("a", { cobrado: 15_000_000, entrega: { estado: "entregada", fecha: "2026-10-22" } }),
      venta("b", { cobrado: 7_500_000, fecha_acuerdo: "2026-10-25", producto: { codigo: "pack_25", nombre: "Pack 25" }, importe: 36_000_000, experiencias: 25 }),
      venta("c", { anulada: { en: "2026-10-26T10:00:00Z", motivo: "error" }, fecha_acuerdo: "2026-10-26" }),
    ];
    assert.deepEqual(filas[0].pendientes, ["comision"], "cobrada y entregada: queda pagar la comisión");
    assert.deepEqual(filas[1].pendientes, ["cobro", "entrega"]);
    assert.deepEqual(filas[2].pendientes, [], "anulada: sin pendientes");
    assert.deepEqual(B.filtrarVentas(filas, {}).map((v) => v.id), ["a", "b"], "las anuladas solo si se piden");
    assert.deepEqual(B.filtrarVentas(filas, { anuladas: true }).map((v) => v.id), ["a", "b", "c"]);
    assert.deepEqual(B.filtrarVentas(filas, { producto: "pack_25" }).map((v) => v.id), ["b"]);
    assert.deepEqual(B.filtrarVentas(filas, { cobro: "cobrada" }).map((v) => v.id), ["a"]);
    assert.deepEqual(B.filtrarVentas(filas, { comision: "generada" }).map((v) => v.id), ["a"]);
    assert.deepEqual(B.filtrarVentas(filas, { pendiente: "cobro" }).map((v) => v.id), ["b"]);
    assert.deepEqual(B.filtrarVentas(filas, { desde: "2026-10-21", hasta: "2026-10-25" }).map((v) => v.id), ["b"]);
    assert.deepEqual(B.filtrarVentas(filas, { q: "gimnasio CENTRAL" }).length, 2, "busca sin mayúsculas ni tildes");
    const t = B.totalesVentas(B.filtrarVentas(filas, { anuladas: true }));
    assert.deepEqual(t, {
      ventas: 2, acordado: 51_000_000, cobrado: 22_500_000, saldo: 28_500_000, comision_pactada: 8_000_000, comision_pagada: 0, comision_a_pagar: 4_000_000,
    }, "totales sin la anulada; a pagar = solo comisiones generadas");
    const r = B.resumenCompras(filas);
    assert.equal(r.compras, 2, "compras = acuerdos vigentes");
    assert.equal(r.cobradas, 1, "cobradas por completo, aparte");
    assert.equal(r.ultima, "2026-10-25", "última compra = acuerdo vigente más reciente (la anulada no cuenta)");
    assert.deepEqual([r.acordado, r.cobrado, r.saldo], [51_000_000, 22_500_000, 28_500_000]);
    assert.deepEqual(r.packs.map((p) => [p.codigo, p.compras, p.experiencias]), [["pack_10", 1, 10], ["pack_25", 1, 25]]);
    assert.deepEqual(B.resumenCompras([]), { compras: 0, cobradas: 0, ultima: null, acordado: 0, cobrado: 0, saldo: 0, packs: [] });
  }

  // ── 7) Huellas ───────────────────────────────────────────────────────
  {
    const a = huellaVenta("o", 3, { producto: "pack_10", comision: { tipo: "pactada", importe: "40000.00" } });
    assert.equal(a, huellaVenta("o", 3, { comision: { importe: "40000.00", tipo: "pactada" }, producto: "pack_10" }), "mismo contenido en otro orden → misma huella");
    assert.notEqual(a, huellaVenta("o", 4, { producto: "pack_10", comision: { tipo: "pactada", importe: "40000.00" } }), "otra versión → otra huella");
    assert.notEqual(huellaGestionVenta("v", 1, "cobro", { importe: "75000.00" }), huellaGestionVenta("v", 1, "cobro", { importe: "75000.00", confirmar_duplicado: true }),
      "confirmar un duplicado es otro envío");
    assert.match(huellaRecompra("e", { contacto_id: "c" }), /^[0-9a-f]{64}$/);
  }

  // ── 8) Aislamiento estático ──────────────────────────────────────────
  {
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = join(d, e.name);
        if (e.isDirectory()) walk(q, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(q.split(sep).join("/"));
      }
      return out;
    };
    const leer = (f: string) => readFileSync(f, "utf8");
    const PROHIBIDO = /crmB3Server|crmB3Rutas|crm_ventas|crm_cobros|crm_comision_pagos|crm_productos|components\/crm\/(Ventas|DetalleVenta|RegistrarVenta|ComprasNegocio|ventasCampos)/;
    const comercial = walk("app/comercial");
    assert.ok(comercial.every((f) => !PROHIBIDO.test(leer(f))), "el área comercial no toca ventas, cobros ni comisiones");
    const usanB3 = walk("app").filter((f) => /crmB3Rutas|crmB3Server/.test(leer(f)));
    assert.ok(usanB3.length >= 7 && usanB3.every((f) => f.startsWith("app/api/admin/crm/")), `solo rutas de administración usan B3: ${usanB3.join(", ")}`);
    for (const f of usanB3) {
      const t = leer(f);
      const handlers = t.match(/export async function (GET|POST|PATCH)/g) ?? [];
      const guardias = t.match(/const a = await actorAdmin\(\);\s*if \(!a\.ok\) return a\.response;/g) ?? [];
      assert.equal(guardias.length, handlers.length, `${f}: cada manejador exige admin`);
    }
    const b1 = leer("lib/crmB1Server.ts");
    assert.ok(!/crm_ventas|crm_cobros|crm_comision|crmB3/.test(b1), "las lecturas de B1 (también las comerciales) no leen ventas");
    assert.match(b1, /qo = qo\.or\("cerrada_en\.is\.null,cierre_motivo\.eq\.perdida"\)/, "el comercial no recibe oportunidades ganadas");
    const middleware = leer("middleware.ts");
    assert.ok(/\/admin\/crm/.test(middleware), "el middleware conoce /admin/crm (solo admin)");
  }

  console.log("OK — crmB3 puro: importes en centavos, flujos de Pack 10 y Pack 25, estados de comisión, reglas y confirmaciones, avisos de campaña, totales y compras, huellas y aislamiento.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
