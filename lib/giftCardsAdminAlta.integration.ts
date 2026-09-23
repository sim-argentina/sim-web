import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { emitirGiftCardAdmin, validarAltaGiftCard, type DatosAltaGiftCard } from "@/lib/giftCardsAdminAlta";
import { GIFT_CARD_PRODUCTOS, GIFT_CARD_VIGENCIA_DIAS } from "@/lib/giftCards";
import {
  getComisionesGiftCardsManualesMes, getComisionesStandMes, getComisionesWebMes, rangoMesAr,
} from "@/lib/finanzas";
import { claveComision, porcentajeTotalComision } from "@/lib/finanzasComisiones";

// Integración de la emisión administrativa de Gift Cards contra la DB REAL, con
// datos TEMPORALES marcados y eliminados al final.
//
// Lo que se prueba es lo que una Gift Card emitida a mano no puede equivocar:
//   · que quede exactamente igual de usable que una comprada por web;
//   · que su vencimiento salga de la MISMA regla, sin fórmula paralela;
//   · que el precio lo ponga el catálogo y no el navegador;
//   · que entre en Finanzas UNA sola vez, con el medio de pago real;
//   · que su comisión salga de la MISMA tasa vigente que la del turnero, y que
//     bruto − comisión = neto para cada medio y cada procesador;
//   · que no se mezcle con los cargos reales de Checkout Pro ni toque al stand;
//   · que el canje y el archivado se comporten igual que en una web;
//   · que archivar no borre nada.
//
// NO se crea ninguna Gift Card real: todas llevan la marca de abajo y se
// eliminan físicamente al terminar, junto con su historial. Al no quedar
// ninguna fila, tampoco queda ningún ingreso de prueba en Finanzas.
//
// Ejecutar: npx tsx --env-file=.env.local lib/giftCardsAdminAlta.integration.ts

const MARCA = `ZZ GC-ADMIN ${Date.now()}`;
const creadas = new Set<string>();

const P15 = GIFT_CARD_PRODUCTOS.find((p) => p.duracion === 15)!;
const P30 = GIFT_CARD_PRODUCTOS.find((p) => p.duracion === 30)!;

function cuerpo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    duracion_minutos: 15,
    cantidad: 1,
    modo_uso: "separadas",
    comprador_nombre: MARCA,
    comprador_telefono: "3512520927",
    destinatario_nombre: "Probe",
    medio_pago: "efectivo",
    observaciones: "fixture de prueba",
    ...over,
  };
}

async function emitir(over: Record<string, unknown> = {}) {
  const v = validarAltaGiftCard(cuerpo(over));
  assert.ok(v.ok, `el cuerpo de prueba es válido: ${!v.ok ? v.error : ""}`);
  const r = await emitirGiftCardAdmin(v.data as DatosAltaGiftCard, { rol: "admin" });
  assert.ok(r.ok, `la emisión funciona: ${!r.ok ? r.error : ""}`);
  for (const c of r.data.cards) creadas.add(c.id);
  return r.data;
}

/** Fila completa, tal cual la ve el panel. */
async function fila(id: string) {
  const { data } = await supabaseAdmin.from("gift_cards").select("*").eq("id", id).maybeSingle();
  return data as Record<string, unknown> | null;
}

/** Ingreso de gift cards del mes, por método, tal cual lo lee Finanzas. */
async function ingresosGiftCards(mes: string): Promise<Record<string, { total: number; cantidad: number }>> {
  const { data, error } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
  if (error) throw error;
  const out: Record<string, { total: number; cantidad: number }> = {};
  for (const r of (data ?? []) as Array<{ fuente: string; metodo: string; total: unknown; cantidad: unknown }>) {
    if (r.fuente !== "gift_cards") continue;
    out[r.metodo] = { total: Number(r.total) || 0, cantidad: Number(r.cantidad) || 0 };
  }
  return out;
}

function mesAR(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(iso)).slice(0, 7);
}

async function limpiar() {
  const ids = [...creadas];
  if (ids.length === 0) return;
  await supabaseAdmin.from("gift_card_logs").delete().in("gift_card_id", ids);
  await supabaseAdmin.from("gift_cards").delete().in("id", ids);
  const { count } = await supabaseAdmin
    .from("gift_cards")
    .select("id", { count: "exact", head: true })
    .in("id", ids);
  assert.equal(count ?? 0, 0, "no queda ninguna Gift Card de prueba");
  const { count: logs } = await supabaseAdmin
    .from("gift_card_logs")
    .select("id", { count: "exact", head: true })
    .in("gift_card_id", ids);
  assert.equal(logs ?? 0, 0, "no queda ningún log de prueba");
  creadas.clear();
}

async function main() {
  // ── TEST A · creación ─────────────────────────────────────────────────────
  {
    const antes = Date.now();
    const alta = await emitir();
    assert.equal(alta.cantidad, 1, "A · se emite UNA Gift Card");
    assert.equal(alta.monto_total, P15.monto, "A · el total es el del catálogo");

    const f = (await fila(alta.cards[0].id))!;
    assert.ok(f, "A · la fila existe");
    assert.match(String(f.codigo_unico), /^SIM-[A-Z2-9]{4}-[A-Z2-9]{4}$/, "A · código con el formato de siempre");
    assert.equal(f.estado_pago, "pagado", "A · queda paga, como una web con el pago aprobado");
    assert.equal(f.estado_uso, "pendiente", "A · queda pendiente de usar");
    assert.equal(Number(f.monto), P15.monto, "A · el monto es el del catálogo");
    assert.equal(Number(f.usos_disponibles), 1, "A · con su uso disponible");
    assert.equal(f.canal, "admin", "A · el origen queda registrado");
    assert.equal(f.medio_pago, "efectivo", "A · con el medio real");
    assert.equal(f.procesador, null, "A · efectivo no tiene procesador");
    assert.equal(f.registrado_por, "admin", "A · queda quién la emitió");
    assert.equal(f.mercado_pago_payment_id, null, "A · no hay pago de Mercado Pago");
    assert.equal(f.mercado_pago_preference_id, null, "A · no hay preferencia de Mercado Pago");
    assert.equal(f.deleted_at, null, "A · no nace archivada");
    assert.ok(new Date(String(f.fecha_pago)).getTime() >= antes - 5000, "A · la fecha de pago es de ahora");

    // Aparece en el listado del panel con el MISMO filtro que usa el endpoint.
    const { data: listado } = await supabaseAdmin
      .from("gift_cards").select("id")
      .eq("estado_pago", "pagado").is("deleted_at", null).eq("estado_uso", "pendiente")
      .ilike("codigo_unico", `%${String(f.codigo_unico)}%`);
    assert.equal((listado ?? []).length, 1, "A · aparece en el listado administrativo");

    // Y su historial dice cómo nació.
    const { data: logs } = await supabaseAdmin
      .from("gift_card_logs").select("accion, rol").eq("gift_card_id", alta.cards[0].id);
    assert.equal((logs ?? []).length, 1, "A · deja una entrada de historial");
    assert.equal((logs ?? [])[0]?.accion, "Creada manualmente");
    assert.equal((logs ?? [])[0]?.rol, "admin");
    console.log("A · creación OK");
  }

  // ── TEST C · códigos únicos con varias emisiones ──────────────────────────
  {
    const codigos: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await emitir({ duracion_minutos: i % 2 === 0 ? 15 : 30 });
      codigos.push(a.cards[0].codigo_unico);
    }
    // Y una compra de varias separadas, que genera un código por fila.
    const multi = await emitir({ cantidad: 5, modo_uso: "separadas", duracion_minutos: 30 });
    assert.equal(multi.cards.length, 5, "C · separadas genera una fila por gift card");
    codigos.push(...multi.cards.map((c) => c.codigo_unico));

    assert.equal(new Set(codigos).size, codigos.length, "C · todos los códigos son distintos");
    // Únicos contra TODA la tabla, no solo entre ellos.
    const { data: choques } = await supabaseAdmin
      .from("gift_cards").select("codigo_unico").in("codigo_unico", codigos);
    assert.equal((choques ?? []).length, codigos.length, "C · no hay códigos repetidos en la tabla");

    // El reparto de montos en "separadas" suma exactamente el total.
    const suma = multi.cards.reduce((s, c) => s + Number(c.monto), 0);
    assert.equal(suma, P30.monto * 5, "C · el reparto suma el total del catálogo");

    // "juntas": un solo código con N usos.
    const juntas = await emitir({ cantidad: 3, modo_uso: "juntas" });
    assert.equal(juntas.cards.length, 1, "C · juntas emite un solo código");
    assert.equal(juntas.cards[0].usos_totales, 3, "C · con los tres usos adentro");
    assert.equal(Number(juntas.cards[0].monto), P15.monto * 3, "C · por el valor de las tres");
    console.log("C · códigos únicos OK");
  }

  // ── TEST D · vigencia ─────────────────────────────────────────────────────
  {
    const alta = await emitir();
    const f = (await fila(alta.cards[0].id))!;
    const pago = new Date(String(f.fecha_pago)).getTime();
    const vence = new Date(String(f.fecha_vencimiento)).getTime();
    assert.equal(
      vence - pago,
      GIFT_CARD_VIGENCIA_DIAS * 24 * 60 * 60 * 1000,
      `D · vence exactamente a los ${GIFT_CARD_VIGENCIA_DIAS} días del pago`,
    );

    // La MISMA regla que las Gift Cards ya emitidas por web: ninguna paga queda
    // sin vencimiento, y todas guardan la misma distancia contra su pago.
    const { data: web } = await supabaseAdmin
      .from("gift_cards")
      .select("fecha_pago, fecha_vencimiento")
      .eq("canal", "web").eq("estado_pago", "pagado").not("fecha_pago", "is", null);
    for (const w of (web ?? []) as Array<{ fecha_pago: string; fecha_vencimiento: string | null }>) {
      assert.ok(w.fecha_vencimiento, "D · ninguna Gift Card web paga quedó sin vencimiento");
      const d = new Date(w.fecha_vencimiento!).getTime() - new Date(w.fecha_pago).getTime();
      assert.equal(d, GIFT_CARD_VIGENCIA_DIAS * 24 * 60 * 60 * 1000, "D · misma regla que la web");
    }
    console.log(`D · vigencia OK (${(web ?? []).length} gift cards web comparadas)`);
  }

  // ── TEST E · canje ────────────────────────────────────────────────────────
  // El canje de SIM es administrativo: se busca el código en el panel y se
  // registra el uso. Se ejecutan acá las MISMAS escrituras que hace el PATCH.
  {
    const simple = await emitir();
    const idSimple = simple.cards[0].id;

    // Se encuentra buscando por código, igual que en el mostrador.
    const { data: buscada } = await supabaseAdmin
      .from("gift_cards").select("id, usos_totales, usos_disponibles, deleted_at")
      .eq("estado_pago", "pagado").is("deleted_at", null)
      .ilike("codigo_unico", `%${simple.cards[0].codigo_unico}%`).maybeSingle();
    assert.equal(buscada?.id, idSimple, "E · se encuentra por código como cualquier otra");

    // "Marcar usada".
    const ahora = new Date().toISOString();
    await supabaseAdmin.from("gift_cards")
      .update({ estado_uso: "usada", usos_disponibles: 0, fecha_uso: ahora, updated_at: ahora })
      .eq("id", idSimple);
    const usada = (await fila(idSimple))!;
    assert.equal(usada.estado_uso, "usada", "E · queda usada");
    assert.equal(Number(usada.usos_disponibles), 0, "E · sin usos disponibles");
    assert.ok(usada.fecha_uso, "E · con fecha de uso");
    assert.equal(usada.canal, "admin", "E · el canje no cambia el origen");
    assert.equal(Number(usada.monto), P15.monto, "E · el canje no toca el importe");

    // Y una "juntas" se descuenta de a un uso, igual que una web multiuso.
    const juntas = await emitir({ cantidad: 3, modo_uso: "juntas" });
    const idJ = juntas.cards[0].id;
    for (let restantes = 2; restantes >= 0; restantes--) {
      const t = new Date().toISOString();
      await supabaseAdmin.from("gift_cards")
        .update({
          usos_disponibles: restantes,
          estado_uso: restantes <= 0 ? "usada" : "pendiente",
          fecha_uso: restantes <= 0 ? t : null,
          updated_at: t,
        })
        .eq("id", idJ);
      const f = (await fila(idJ))!;
      assert.equal(Number(f.usos_disponibles), restantes);
      assert.equal(f.estado_uso, restantes <= 0 ? "usada" : "pendiente", "E · el estado sigue los usos");
    }
    console.log("E · canje OK");
  }

  // ── TEST F · Finanzas ─────────────────────────────────────────────────────
  {
    const mes = mesAR(new Date().toISOString());
    const antes = await ingresosGiftCards(mes);
    const efectivoAntes = antes.efectivo ?? { total: 0, cantidad: 0 };
    const mpAntes = antes.mercadopago ?? { total: 0, cantidad: 0 };

    const alta = await emitir({ duracion_minutos: 30, medio_pago: "efectivo" });
    const f = (await fila(alta.cards[0].id))!;

    const despues = await ingresosGiftCards(mes);
    const efectivoDespues = despues.efectivo ?? { total: 0, cantidad: 0 };
    assert.equal(
      efectivoDespues.total - efectivoAntes.total,
      P30.monto,
      "F · el ingreso entra por el monto del producto",
    );
    assert.equal(
      efectivoDespues.cantidad - efectivoAntes.cantidad, 1,
      "F · entra UNA sola vez",
    );
    // Y no se imputó además a Mercado Pago: sería contarla dos veces y en la
    // cuenta equivocada.
    assert.deepEqual(despues.mercadopago ?? { total: 0, cantidad: 0 }, mpAntes, "F · no toca Mercado Pago");

    // Un cobro con QR sí imputa a Mercado Pago, con su procesador.
    const conQr = await emitir({ duracion_minutos: 15, medio_pago: "qr", procesador: "mercado_pago" });
    const fq = (await fila(conQr.cards[0].id))!;
    assert.equal(fq.procesador, "mercado_pago", "F · qr lleva procesador Mercado Pago");
    const conQrMes = await ingresosGiftCards(mes);
    assert.equal(
      (conQrMes.qr?.total ?? 0) - (despues.qr?.total ?? 0), P15.monto,
      "F · el cobro con QR entra por su propio método",
    );

    // Y una transferencia entra por su propio método, sin comisión.
    const conTransf = await emitir({ duracion_minutos: 15, medio_pago: "transferencia" });
    const ft = (await fila(conTransf.cards[0].id))!;
    assert.equal(ft.procesador, null, "F · transferencia no lleva procesador");
    const conTransfMes = await ingresosGiftCards(mes);
    assert.equal(
      (conTransfMes.transferencia?.total ?? 0) - (conQrMes.transferencia?.total ?? 0), P15.monto,
      "F · la transferencia entra por su propio método",
    );

    // Nada de esto generó un movimiento financiero manual: el ingreso sale de la
    // fila de gift_cards y de ningún otro lado.
    const { count: movs } = await supabaseAdmin
      .from("fin_movimientos")
      .select("id", { count: "exact", head: true })
      .or(`descripcion.ilike.%${MARCA}%,observaciones.ilike.%${MARCA}%,referencia_externa.in.(${f.id},${fq.id})`);
    assert.equal(movs ?? 0, 0, "F · no se insertó ningún movimiento financiero");

    // Ni una comisión web fantasma: sin payment_id, no entra en Checkout Pro.
    const { data: com, error: comErr } = await supabaseAdmin
      .rpc("fin_comisiones_web_por_mes", { p_mes: mes });
    if (comErr) throw comErr;
    const refs = ((com ?? []) as Array<{ producto: string; referencia: string }>)
      .filter((c) => c.producto === "gift_cards")
      .map((c) => c.referencia);
    for (const id of [f.id, fq.id, ft.id]) {
      assert.ok(!refs.includes(String(id)), "F · una Gift Card manual no genera comisión de Checkout Pro");
    }
    console.log("F · Finanzas OK (un ingreso, método real, sin duplicación)");
  }

  // ── TESTS A–E · bruto, comisión y neto contra la configuración REAL ───────
  // El bruto ya entró por fin_ingresos_por_mes (test F). Acá se comprueba la otra
  // mitad: que la comisión salga, con la tasa vigente de fin_comisiones_cobro y
  // el mismo cálculo del turnero.
  {
    const mes = mesAR(new Date().toISOString());
    const { data: cfgRows } = await supabaseAdmin
      .from("fin_comisiones_cobro").select("*").eq("activa", true);
    const tasas: Record<string, { porcentaje_base: number; aplica_iva: boolean; iva_porcentaje: number }> = {};
    for (const c of cfgRows ?? []) {
      tasas[claveComision(c.procesador, c.metodo_pago)] = {
        porcentaje_base: Number(c.porcentaje_base) || 0,
        aplica_iva: Boolean(c.aplica_iva),
        iva_porcentaje: Number(c.iva_porcentaje) || 0,
      };
    }

    const antes = await getComisionesGiftCardsManualesMes(mes);

    // Un cobro de cada tipo, con los dos procesadores reales.
    const casos = [
      { etiqueta: "A · efectivo", medio_pago: "efectivo", procesador: null, duracion: 15, monto: P15.monto },
      { etiqueta: "B · transferencia", medio_pago: "transferencia", procesador: null, duracion: 15, monto: P15.monto },
      { etiqueta: "C · qr + Mercado Pago", medio_pago: "qr", procesador: "mercado_pago", duracion: 30, monto: P30.monto },
      { etiqueta: "D · débito + Mercado Pago", medio_pago: "debito", procesador: "mercado_pago", duracion: 30, monto: P30.monto },
      { etiqueta: "D · débito + Payway", medio_pago: "debito", procesador: "payway", duracion: 15, monto: P15.monto },
      { etiqueta: "E · crédito + Mercado Pago", medio_pago: "credito", procesador: "mercado_pago", duracion: 30, monto: P30.monto },
      { etiqueta: "E · crédito + Payway", medio_pago: "credito", procesador: "payway", duracion: 15, monto: P15.monto },
    ] as const;

    let brutoEsperado = 0;
    let comisionEsperada = 0;
    const porCodigo: Record<string, { etiqueta: string; monto: number; comision: number }> = {};

    for (const caso of casos) {
      const alta = await emitir({
        duracion_minutos: caso.duracion,
        medio_pago: caso.medio_pago,
        procesador: caso.procesador ?? "",
      });
      const codigo = alta.cards[0].codigo_unico;
      const cfg = caso.procesador ? tasas[claveComision(caso.procesador, caso.medio_pago)] : null;
      const pct = cfg ? porcentajeTotalComision(cfg) : 0;
      const comision = Math.round(((caso.monto * pct) / 100 + Number.EPSILON) * 100) / 100;
      brutoEsperado += caso.monto;
      comisionEsperada += comision;
      porCodigo[codigo] = { etiqueta: caso.etiqueta, monto: caso.monto, comision };
    }

    const despues = await getComisionesGiftCardsManualesMes(mes);
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    assert.equal(
      round2(despues.brutoStand - antes.brutoStand), round2(brutoEsperado),
      "el bruto de las gift cards manuales es la suma de los productos",
    );
    assert.equal(
      round2(despues.comisionStand - antes.comisionStand), round2(comisionEsperada),
      "la comisión sale de la configuración vigente de Finanzas",
    );
    assert.equal(
      round2(despues.netoStand - antes.netoStand), round2(brutoEsperado - comisionEsperada),
      "neto = bruto − comisión",
    );

    // Caso por caso, contra la fila del detalle que devuelve Finanzas.
    for (const [codigo, esperado] of Object.entries(porCodigo)) {
      const d = despues.detalle.find((x) => x.turno_id === codigo);
      assert.ok(d, `${esperado.etiqueta} · aparece en el detalle de comisiones`);
      assert.equal(d!.monto, esperado.monto, `${esperado.etiqueta} · bruto`);
      assert.equal(d!.comision, esperado.comision, `${esperado.etiqueta} · comisión`);
      assert.equal(d!.neto, round2(esperado.monto - esperado.comision), `${esperado.etiqueta} · neto`);
      assert.equal(d!.advertencia, null, `${esperado.etiqueta} · sin advertencia`);
      console.log(
        `   ${esperado.etiqueta}: bruto $${esperado.monto} · comisión $${d!.comision} · neto $${d!.neto}`,
      );
    }

    // A y B: sin comisión, el neto es el bruto.
    for (const codigo of Object.keys(porCodigo)) {
      const d = despues.detalle.find((x) => x.turno_id === codigo)!;
      if (d.metodo_pago === "efectivo" || d.metodo_pago === "transferencia") {
        assert.equal(d.comision, 0, `${d.metodo_pago} no paga comisión`);
        assert.equal(d.neto, d.monto, `${d.metodo_pago} neto = bruto`);
        assert.equal(d.procesador, null, `${d.metodo_pago} no tiene procesador`);
      } else {
        assert.ok(d.comision > 0, `${d.metodo_pago}/${d.procesador} sí paga comisión`);
      }
    }

    // Payway cobra menos que Mercado Pago con la config real: la tasa no es una
    // sola repetida, sale de verdad de cada procesador.
    const porProc = despues.porProcesador;
    assert.ok(porProc.mercado_pago && porProc.payway, "los dos procesadores aparecen por separado");

    // TEST H (mitad financiera) · Gift Cards WEB siguen por Checkout Pro y NO
    // entran acá: los dos caminos no se pisan.
    for (const d of despues.detalle) {
      const { data: g } = await supabaseAdmin
        .from("gift_cards").select("canal, mercado_pago_payment_id")
        .eq("codigo_unico", String(d.turno_id)).maybeSingle();
      assert.equal(g?.canal, "admin", "solo entran gift cards del canal admin");
      assert.equal(g?.mercado_pago_payment_id, null, "ninguna con payment_id de Checkout Pro");
    }
    const web = await getComisionesWebMes(mes);
    const idsManuales = new Set(despues.detalle.map((d) => String(d.turno_id)));
    for (const w of web.detalle.concat(web.sinDatos)) {
      assert.ok(!idsManuales.has(String(w.referencia)), "ninguna manual aparece en comisiones web");
    }
    // Las Gift Cards web del mes siguen entrando por Checkout Pro, con sus cargos
    // reales: emitir a mano no les cambió el camino.
    const { data: gcWeb } = await supabaseAdmin
      .from("gift_cards").select("id, mercado_pago_payment_id")
      .eq("canal", "web").eq("estado_pago", "pagado")
      .not("mercado_pago_payment_id", "is", null)
      .gte("fecha_pago", rangoMesAr(mes).desde).lt("fecha_pago", rangoMesAr(mes).hastaExclusivo);
    const refsWeb = new Set(
      web.detalle.concat(web.sinDatos).filter((w) => w.producto === "gift_cards").map((w) => String(w.referencia)),
    );
    for (const g of gcWeb ?? []) {
      assert.ok(refsWeb.has(String(g.id)), "cada Gift Card web del mes sigue en comisiones web");
    }

    // Y el bloque del stand no se contaminó: ahí solo hay turnos.
    const stand = await getComisionesStandMes(mes);
    for (const d of stand.detalle) {
      assert.ok(
        !idsManuales.has(String(d.turno_id)),
        "el detalle del stand no incluye gift cards",
      );
    }

    // El mes de la comisión es el mismo del bruto: los límites salen del helper
    // compartido, no de un cálculo propio.
    const { desde, hastaExclusivo } = rangoMesAr(mes);
    assert.ok(desde.endsWith("T00:00:00-03:00") && hastaExclusivo.endsWith("T00:00:00-03:00"));
    console.log("A–E · comisiones por medio y procesador OK");
  }

  // ── TEST G · monto manipulado desde el navegador ──────────────────────────
  {
    const v = validarAltaGiftCard(
      cuerpo({
        duracion_minutos: 15,
        monto: 1,
        monto_original: 1,
        descuento_aplicado: 999999,
        codigo_descuento: "GRATIS",
        estado_pago: "pendiente_pago",
        canal: "web",
        codigo_unico: "SIM-AAAA-AAAA",
        fecha_vencimiento: "2099-01-01T00:00:00.000Z",
      }),
    );
    assert.ok(v.ok, "G · el cuerpo manipulado no rompe, se ignora lo que sobra");
    const r = await emitirGiftCardAdmin(v.data as DatosAltaGiftCard, { rol: "admin" });
    assert.ok(r.ok, "G · se emite igual");
    for (const c of r.data.cards) creadas.add(c.id);

    const f = (await fila(r.data.cards[0].id))!;
    assert.equal(Number(f.monto), P15.monto, "G · el monto es el del catálogo, no el enviado");
    assert.equal(Number(f.monto_original), P15.monto, "G · el original tampoco viene del cuerpo");
    assert.equal(Number(f.descuento_aplicado), 0, "G · no se aplica el descuento inventado");
    assert.equal(f.codigo_descuento, null, "G · no se acepta un código de descuento");
    assert.equal(f.estado_pago, "pagado", "G · el estado lo pone el servidor");
    assert.equal(f.canal, "admin", "G · el canal lo pone el servidor");
    assert.notEqual(f.codigo_unico, "SIM-AAAA-AAAA", "G · el código lo genera el servidor");
    const d = new Date(String(f.fecha_vencimiento)).getTime() - new Date(String(f.fecha_pago)).getTime();
    assert.equal(d, GIFT_CARD_VIGENCIA_DIAS * 24 * 60 * 60 * 1000, "G · el vencimiento lo pone la regla");
    console.log("G · monto manipulado OK");
  }

  // ── TEST H · archivado ────────────────────────────────────────────────────
  {
    const alta = await emitir({ medio_pago: "debito", procesador: "payway" });
    const id = alta.cards[0].id;
    const antes = (await fila(id))!;

    // Se usa primero, para comprobar que el archivado conserva el canje.
    const t = new Date().toISOString();
    await supabaseAdmin.from("gift_cards")
      .update({ estado_uso: "usada", usos_disponibles: 0, fecha_uso: t, updated_at: t })
      .eq("id", id);

    // Archivar = eliminación lógica, exactamente lo que hace el DELETE del panel.
    const ahora = new Date().toISOString();
    const { data: archivada } = await supabaseAdmin
      .from("gift_cards")
      .update({ deleted_at: ahora, deleted_by: "admin", updated_at: ahora })
      .eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    assert.equal(archivada?.id, id, "H · se archiva");
    await supabaseAdmin.from("gift_card_logs")
      .insert([{ gift_card_id: id, accion: "Eliminada (archivada)", rol: "admin", detalle: {} }]);

    const f = (await fila(id))!;
    assert.ok(f, "H · la fila NO desaparece físicamente");
    assert.equal(f.codigo_unico, antes.codigo_unico, "H · conserva el código");
    assert.equal(f.canal, "admin", "H · conserva el origen");
    assert.equal(f.medio_pago, "debito", "H · conserva el medio de pago");
    assert.equal(f.procesador, "payway", "H · conserva el procesador");
    assert.equal(Number(f.monto), antes.monto, "H · conserva el importe");
    assert.equal(f.estado_pago, "pagado", "H · conserva el pago");
    assert.equal(f.fecha_pago, antes.fecha_pago, "H · conserva la fecha de pago");
    assert.equal(f.fecha_vencimiento, antes.fecha_vencimiento, "H · conserva el vencimiento");
    assert.equal(f.estado_uso, "usada", "H · conserva el canje");
    assert.ok(f.fecha_uso, "H · conserva la fecha de uso");
    assert.equal(f.observaciones, antes.observaciones, "H · conserva las observaciones");

    const { data: logs } = await supabaseAdmin
      .from("gift_card_logs").select("accion").eq("gift_card_id", id).order("created_at");
    const acciones = (logs ?? []).map((l) => l.accion);
    assert.ok(acciones.includes("Creada manualmente"), "H · conserva el historial de creación");
    assert.ok(acciones.includes("Eliminada (archivada)"), "H · registra el archivado");

    // Desaparece del listado normal, pero se ve en el de archivadas.
    const { data: normal } = await supabaseAdmin
      .from("gift_cards").select("id").eq("id", id).is("deleted_at", null);
    assert.equal((normal ?? []).length, 0, "H · sale del listado activo");
    const { data: arch } = await supabaseAdmin
      .from("gift_cards").select("id").eq("id", id).not("deleted_at", "is", null);
    assert.equal((arch ?? []).length, 1, "H · aparece en el listado de archivadas");
    console.log("H · archivado OK");
  }

  // ── La base defiende el modelo aunque alguien escriba por abajo ───────────
  {
    // Una Gift Card admin no puede quedarse sin medio de pago…
    const rotas = [
      { canal: "admin", medio_pago: null },
      { canal: "admin", medio_pago: "cheque" },
      { canal: "admin", medio_pago: "efectivo", procesador: "mercado_pago" },
      { canal: "admin", medio_pago: "transferencia", procesador: "payway" },
      { canal: "admin", medio_pago: "qr", procesador: null },
      { canal: "admin", medio_pago: "debito", procesador: null },
      { canal: "admin", medio_pago: "credito", procesador: "visa" },
      { canal: "admin", medio_pago: "qr", procesador: "mercado_pago", mercado_pago_payment_id: "999" },
      { canal: "web", medio_pago: "efectivo" },
      { canal: "otro", medio_pago: "efectivo" },
    ];
    for (const extra of rotas) {
      const { error } = await supabaseAdmin.from("gift_cards").insert([{
        codigo_unico: `SIM-ZZZZ-${String(Math.random()).slice(2, 6)}`,
        comprador_nombre: MARCA, comprador_telefono: "3510000000",
        duracion_minutos: 15, monto: P15.monto, cantidad: 1,
        usos_totales: 1, usos_disponibles: 1, estado_pago: "pagado",
        ...extra,
      }]);
      assert.ok(error, `la base rechaza la combinación inválida ${JSON.stringify(extra)}`);
    }
    console.log("constraints de la base OK");
  }
}

main()
  .then(async () => {
    await limpiar();
    console.log("\nOK — giftCardsAdminAlta (integración): A, C, D, E, F, G y H en verde. Fixtures eliminados.");
  })
  .catch(async (e) => {
    await limpiar().catch(() => {});
    console.error(e);
    process.exit(1);
  });
