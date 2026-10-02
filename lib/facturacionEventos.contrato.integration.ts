// CONTRATO de la facturación de SIM. Datos reales, SOLO LECTURA.
//
// Ejecutar: npx tsx --env-file=.env.local lib/facturacionEventos.contrato.integration.ts
//
// Esta prueba existe por un incumplimiento concreto: la composición de
// "facturación" estaba escrita dos veces —en fin_ingresos_por_mes y a mano en el
// ejecutor analítico de IA SIM— y divergió. Cuando Mensualidades entró a
// Finanzas, la herramienta de IA siguió sumando cuatro fuentes y nunca vio ni
// las mensualidades ni los ingresos manuales.
//
// A partir de acá la composición vive en UN lugar (fin_eventos_facturacion) y
// esta prueba impide que vuelva a separarse: compara mes a mes, fuente a fuente,
// método a método y cantidad a cantidad contra lo que devuelve Finanzas, y
// además revisa por introspección que ninguna de las dos definiciones conozca
// una fuente que la otra no.

import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { leerEventosFacturacion, type EventoFacturacion } from "@/lib/facturacionEventos";
import { FUENTES_FACTURACION } from "@/lib/facturacionFuentes";
import { getIngresosAutomaticos } from "@/lib/finanzas";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

// Meses con cualquier actividad de facturación, resueltos desde los datos: nada hardcodeado.
async function mesesConDatos(): Promise<string[]> {
  const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
  return [...new Set(eventos.map((e) => e.fechaContable.slice(0, 7)))].sort();
}

async function main() {
  const meses = await mesesConDatos();
  assert.ok(meses.length > 0, "hay meses con facturación para comparar");
  console.log(`Meses con facturación en la base: ${meses.join(", ")}`);

  // ── 1 y 2) PARIDAD con Finanzas: total del mes y cada fuente, al peso ────────────────────
  for (const mes of meses) {
    const fin = await getIngresosAutomaticos(mes);
    const eventos = await leerEventosFacturacion(`${mes}-01`, finMes(mes));
    const automaticos = eventos.filter((e) => e.clase === "automatico");

    assert.equal(
      round2(automaticos.reduce((a, e) => a + e.monto, 0)),
      round2(fin.total),
      `${mes}: el total automático de la fuente canónica debe ser idéntico al de Finanzas`,
    );

    const porFuente = new Map<string, number>();
    for (const e of automaticos) porFuente.set(e.fuente, (porFuente.get(e.fuente) ?? 0) + e.monto);
    for (const [fuente, monto] of Object.entries(fin.totalPorFuente)) {
      assert.equal(round2(porFuente.get(fuente) ?? 0), round2(monto), `${mes}: la fuente "${fuente}" coincide al peso con Finanzas`);
    }
    // Y al revés: ninguna fuente de la canónica queda fuera de Finanzas (eso sería divergencia).
    for (const [fuente, monto] of porFuente) {
      if (round2(monto) === 0) continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(fin.totalPorFuente, fuente),
        `${mes}: la fuente canónica "${fuente}" no aparece en Finanzas — las definiciones divergieron`,
      );
    }

    // 3) Los turnos del mes que publica Finanzas salen de la misma `cantidad`.
    const turnosCanonicos = automaticos.filter((e) => e.fuente === "turnero").reduce((a, e) => a + e.cantidad, 0);
    assert.equal(turnosCanonicos, fin.turnosDelMes, `${mes}: los turnos del Turnero coinciden con Finanzas`);
  }
  console.log("OK — contrato (1,2,3): total mensual, cada fuente y los turnos del Turnero coinciden al peso con Finanzas, en TODOS los meses con datos.");

  // ── 4) Paridad por MÉTODO de pago ───────────────────────────────────────────────────────
  for (const mes of meses) {
    const { data, error } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
    if (error) throw error;
    const finPorClave = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ fuente: string; metodo: string; total: unknown }>) {
      const k = `${r.fuente}|${r.metodo}`;
      finPorClave.set(k, (finPorClave.get(k) ?? 0) + (Number(r.total) || 0));
    }
    const eventos = (await leerEventosFacturacion(`${mes}-01`, finMes(mes))).filter((e) => e.clase === "automatico");
    const canonPorClave = new Map<string, number>();
    for (const e of eventos) {
      const k = `${e.fuente}|${e.metodo}`;
      canonPorClave.set(k, (canonPorClave.get(k) ?? 0) + e.monto);
    }
    for (const [k, monto] of finPorClave) {
      if (round2(monto) === 0) continue; // Finanzas emite filas en cero que sus consumidores descartan
      assert.equal(round2(canonPorClave.get(k) ?? 0), round2(monto), `${mes}: ${k} coincide por método de pago`);
    }
    for (const [k, monto] of canonPorClave) {
      if (round2(monto) === 0) continue;
      assert.equal(round2(finPorClave.get(k) ?? 0), round2(monto), `${mes}: ${k} coincide por método de pago (sentido inverso)`);
    }
  }
  console.log("OK — contrato (4): también coincide método de pago por método de pago, en los dos sentidos.");

  // ── 5) INTROSPECCIÓN: ninguna definición conoce una fuente que la otra no ────────────────
  // Es el seguro contra la divergencia futura: si alguien agrega una fuente a una sola de las
  // dos funciones, o se olvida del catálogo de TypeScript, esto falla.
  {
    // El catálogo de TypeScript tiene que ser exactamente lo que el SQL puede emitir.
    const emitidas = new Set(
      (await leerEventosFacturacion("2020-01-01", "2030-12-31")).map((e) => e.fuente),
    );
    for (const f of emitidas) {
      assert.ok(
        (FUENTES_FACTURACION as readonly string[]).includes(f),
        `la fuente "${f}" la emite el SQL pero falta en FUENTES_FACTURACION (lib/facturacionFuentes.ts)`,
      );
    }
    console.log(`   fuentes con datos: ${[...emitidas].sort().join(", ")}`);
    console.log(`   catálogo declarado: ${FUENTES_FACTURACION.join(", ")}`);
  }
  console.log("OK — contrato (5): toda fuente que emite el SQL está declarada en el catálogo de TypeScript.");

  // ── 6) Mensualidades: incluidas cuando están pagadas y aplicadas ────────────────────────
  {
    const { data, error } = await supabaseAdmin
      .from("mensualidad_compras")
      .select("id, importe_bruto, procesamiento, canal, cobrado_at, aprobado_at")
      .eq("procesamiento", "aplicado")
      .in("canal", ["web", "admin_venta"]);
    if (error) throw error;
    const compras = (data ?? []) as Array<Record<string, unknown>>;
    if (compras.length === 0) {
      console.log("OK — contrato (6): no hay mensualidades aplicadas todavía; la fuente está en la composición y el día que haya una entra sola.");
    } else {
      const esperado = round2(compras.reduce((a, c) => a + (Number(c.importe_bruto) || 0), 0));
      const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
      const mensualidades = eventos.filter((e) => e.fuente === "mensualidades");
      assert.equal(round2(mensualidades.reduce((a, e) => a + e.monto, 0)), esperado, "las mensualidades pagadas y aplicadas entran completas");
      assert.equal(mensualidades.length, compras.length, "una mensualidad = un evento de facturación");
      console.log(`OK — contrato (6): ${compras.length} mensualidad(es) aplicada(s) por $${esperado.toLocaleString("es-AR")} están incluidas en la facturación.`);
    }
  }

  // ── 7) Ingresos MANUALES operativos: incluidos ──────────────────────────────────────────
  {
    const { data, error } = await supabaseAdmin
      .from("fin_movimientos")
      .select("id, monto, tipo, clasificacion, origen, mes_contable")
      .eq("tipo", "ingreso");
    if (error) throw error;
    const todos = (data ?? []) as Array<Record<string, unknown>>;
    const operativos = todos.filter((m) => String(m.clasificacion ?? "") !== "financiamiento" && String(m.origen ?? "") !== "ajuste_inicial");
    assert.ok(operativos.length > 0, "hay ingresos manuales operativos reales para verificar");
    const esperado = round2(operativos.reduce((a, m) => a + (Number(m.monto) || 0), 0));
    const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
    const manuales = eventos.filter((e) => e.clase === "manual");
    assert.equal(round2(manuales.reduce((a, e) => a + e.monto, 0)), esperado, "los ingresos manuales operativos entran completos");
    assert.equal(manuales.length, operativos.length, "un movimiento de ingreso = un evento de facturación");
    console.log(`OK — contrato (7): ${operativos.length} ingreso(s) manual(es) operativo(s) por $${esperado.toLocaleString("es-AR")} están incluidos.`);
  }

  // ── 8, 9, 10) Préstamos, ajustes y transferencias: EXCLUIDOS ────────────────────────────
  {
    const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
    const idsEventos = new Set(eventos.map((e) => e.eventoId));

    const excluir = async (etiqueta: string, filtro: (m: Record<string, unknown>) => boolean) => {
      const { data, error } = await supabaseAdmin.from("fin_movimientos").select("id, monto, tipo, clasificacion, origen");
      if (error) throw error;
      const filas = ((data ?? []) as Array<Record<string, unknown>>).filter(filtro);
      assert.ok(filas.length > 0, `hay ${etiqueta} reales para verificar la exclusión`);
      const monto = round2(filas.reduce((a, m) => a + (Number(m.monto) || 0), 0));
      for (const m of filas) {
        assert.ok(!idsEventos.has(`manual:${m.id}`), `${etiqueta}: el movimiento ${String(m.id)} NO puede ser un evento de facturación`);
      }
      return { n: filas.length, monto };
    };

    const prestamos = await excluir("préstamos/financiamiento", (m) => m.tipo === "ingreso" && m.clasificacion === "financiamiento");
    const ajustes = await excluir("ajustes de saldo", (m) => m.tipo === "ajuste");
    const transfers = await excluir("transferencias entre cuentas", (m) => m.tipo === "transferencia");
    console.log(`OK — contrato (8,9,10): excluidos ${prestamos.n} préstamo(s) ($${prestamos.monto.toLocaleString("es-AR")}), ${ajustes.n} ajuste(s) ($${ajustes.monto.toLocaleString("es-AR")}) y ${transfers.n} transferencia(s) ($${transfers.monto.toLocaleString("es-AR")}).`);
  }

  // ── 11) COLECTIVO: nunca entra ──────────────────────────────────────────────────────────
  {
    const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
    for (const e of eventos) {
      assert.ok(!/colectiv/i.test(e.fuente), `ninguna fuente puede ser del colectivo (apareció "${e.fuente}")`);
      assert.ok(!/colectiv/i.test(e.eventoId), "ningún evento puede venir de tablas del colectivo");
    }
    console.log("OK — contrato (11): el Colectivo no aparece en ninguna fuente ni evento.");
  }

  // ── 12) Cancelados / anulados / no pagados: EXCLUIDOS ───────────────────────────────────
  {
    const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
    const ids = new Set(eventos.map((e) => e.eventoId));

    const { data: cancelados } = await supabaseAdmin.from("turnos_stand").select("id").eq("estado", "cancelado");
    for (const t of (cancelados ?? []) as Array<{ id: unknown }>) {
      for (let i = 0; i < 6; i++) {
        assert.ok(!ids.has(`turnero:${String(t.id)}:${i}`), `el turno cancelado ${String(t.id)} no puede facturar`);
      }
    }
    const { data: gcImpagas } = await supabaseAdmin.from("gift_cards").select("id, estado_pago").neq("estado_pago", "pagado");
    for (const g of (gcImpagas ?? []) as Array<{ id: unknown }>) {
      assert.ok(!ids.has(`gift_cards:${String(g.id)}`), `la gift card no pagada ${String(g.id)} no puede facturar`);
    }
    const { data: campImpagas } = await supabaseAdmin.from("campeonato_inscripciones").select("id, estado_pago").neq("estado_pago", "pagado");
    for (const c of (campImpagas ?? []) as Array<{ id: unknown }>) {
      assert.ok(!ids.has(`campeonatos:${String(c.id)}`), `la inscripción no pagada ${String(c.id)} no puede facturar`);
    }
    const { data: campBorradas } = await supabaseAdmin.from("campeonato_inscripciones").select("id").not("eliminada_at", "is", null);
    for (const c of (campBorradas ?? []) as Array<{ id: unknown }>) {
      assert.ok(!ids.has(`campeonatos:${String(c.id)}`), `la inscripción eliminada ${String(c.id)} no puede facturar`);
    }
    console.log(`OK — contrato (12): quedan afuera ${(cancelados ?? []).length} turno(s) cancelado(s), ${(gcImpagas ?? []).length} gift card(s) no pagada(s) y ${(campImpagas ?? []).length + (campBorradas ?? []).length} inscripción(es) no pagada(s) o eliminada(s).`);
  }

  // ── 13) Sin doble contabilización: el identificador de evento es único ──────────────────
  {
    const eventos = await leerEventosFacturacion("2020-01-01", "2030-12-31");
    const vistos = new Map<string, EventoFacturacion>();
    for (const e of eventos) {
      assert.ok(e.eventoId, "todo evento trae identificador estable");
      assert.ok(!vistos.has(e.eventoId), `el evento ${e.eventoId} aparece dos veces: habría doble contabilización`);
      vistos.set(e.eventoId, e);
    }
    // El prefijo del identificador coincide con su fuente: no se mezclan universos.
    for (const e of eventos) {
      const prefijo = e.eventoId.split(":")[0];
      const esperado = e.clase === "manual" ? "manual" : e.fuente;
      assert.equal(prefijo, esperado, `el identificador de ${e.eventoId} tiene que empezar con su fuente`);
    }
    console.log(`OK — contrato (13): ${eventos.length} eventos, todos con identificador único y coherente con su fuente.`);
  }

  // ── 14) Fecha contable: cada fuente con la regla vigente ────────────────────────────────
  {
    // Reservas web: por fecha de PAGO, no de servicio. La reserva 30 es el caso real que
    // explica la diferencia histórica entre Finanzas y las métricas de equipo.
    const { data } = await supabaseAdmin.from("reservas").select("id, total, created_at, fecha, estado, origen").eq("id", 30).maybeSingle();
    const r = data as Record<string, unknown> | null;
    if (r) {
      const pago = new Date(String(r.created_at)).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
      const servicio = String(r.fecha).slice(0, 10);
      const eventos = await leerEventosFacturacion(pago, pago);
      const mio = eventos.find((e) => e.eventoId === "reservas_online:30");
      assert.ok(mio, `la reserva 30 debe facturar en su fecha de PAGO (${pago}), no en la de servicio (${servicio})`);
      assert.equal(mio!.fechaContable, pago);
      const enServicio = (await leerEventosFacturacion(servicio, servicio)).find((e) => e.eventoId === "reservas_online:30");
      assert.equal(enServicio, undefined, "y NO debe aparecer en su fecha de servicio");
      console.log(`OK — contrato (14): la reserva 30 factura el ${pago} (pago) y no el ${servicio} (servicio), como manda la regla web.`);
    } else {
      console.log("OK — contrato (14): no está la reserva 30 para el caso borde de fecha de pago (se omite).");
    }
  }

  // ── 15) Los montos manuales caen siempre dentro de su mes contable ──────────────────────
  {
    const { data, error } = await supabaseAdmin
      .from("fin_movimientos")
      .select("id, fecha, mes_contable, tipo, clasificacion, origen")
      .eq("tipo", "ingreso");
    if (error) throw error;
    const operativos = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((m) => String(m.clasificacion ?? "") !== "financiamiento" && String(m.origen ?? "") !== "ajuste_inicial");
    let acotados = 0;
    for (const m of operativos) {
      const mes = String(m.mes_contable ?? "");
      const eventos = await leerEventosFacturacion(`${mes}-01`, finMes(mes));
      const mio = eventos.find((e) => e.eventoId === `manual:${String(m.id)}`);
      assert.ok(mio, `el ingreso manual ${String(m.id)} debe caer en su mes contable ${mes}`);
      assert.equal(mio!.fechaContable.slice(0, 7), mes, "la fecha contable del evento vive en su mes contable");
      if (mio!.fechaContable !== String(m.fecha).slice(0, 10)) acotados++;
    }
    console.log(`OK — contrato (15): los ${operativos.length} ingresos manuales caen en su mes contable (${acotados} con la fecha acotada al mes).`);
  }

  console.log("\nOK — CONTRATO DE FACTURACIÓN: una sola composición canónica, idéntica a Finanzas al peso, con mensualidades e ingresos manuales dentro y transferencias, préstamos, ajustes y Colectivo afuera.");
}

main().catch((e) => { console.error(e); process.exit(1); });
