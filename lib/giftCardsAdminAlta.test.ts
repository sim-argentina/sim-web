import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validarAltaGiftCard } from "@/lib/giftCardsAdminAlta";
import {
  GIFT_CARD_CONDICIONES,
  GIFT_CARD_MAX_CANTIDAD,
  GIFT_CARD_OBSERVACIONES_MAX,
  GIFT_CARD_PRODUCTOS,
  GIFT_CARD_VIGENCIA_DIAS,
  MEDIOS_PAGO_GIFT_CARD,
  PROCESADORES_GIFT_CARD,
  requiereProcesador,
  calcularVencimientoGiftCard,
  generarCodigoGiftCard,
} from "@/lib/giftCards";
import {
  METODOS_CON_COMISION, METODOS_PAGO, METODOS_SIN_COMISION,
  PROCESADORES, calcularComisionesPagos, claveComision, porcentajeTotalComision,
  type ComisionConfig,
} from "@/lib/finanzasComisiones";

// Pruebas PURAS de la emisión administrativa de Gift Cards. No consultan la base
// ni la red: solo necesitan el entorno porque el módulo construye el cliente de
// Supabase al importarse, igual que el resto de los tests puros del proyecto.
// Ejecutar: npx tsx --env-file=.env.local lib/giftCardsAdminAlta.test.ts
//
// El comportamiento contra la base lo prueba giftCardsAdminAlta.integration.ts.
// Acá vive lo que se puede afirmar sin ella: qué entradas se aceptan, qué se
// rechaza, que el precio no venga del navegador, y que el cableado de permisos
// del endpoint sea el correcto.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const base = (over: Record<string, unknown> = {}) => ({
  duracion_minutos: 15,
  cantidad: 1,
  modo_uso: "separadas",
  comprador_nombre: "Ana Gómez",
  comprador_telefono: "3512520927",
  destinatario_nombre: "Juan",
  medio_pago: "efectivo",
  observaciones: "Venta de mostrador",
  ...over,
});

// ── 1) El camino feliz ──────────────────────────────────────────────────────
{
  const r = validarAltaGiftCard(base());
  assert.ok(r.ok, "una emisión válida pasa");
  assert.equal(r.data.producto.duracion, 15);
  assert.equal(r.data.producto.monto, GIFT_CARD_PRODUCTOS[0].monto);
  assert.equal(r.data.medioPago, "efectivo");
  assert.equal(r.data.cantidad, 1);
  assert.equal(r.data.modoUso, "separadas");
  assert.equal(r.data.destinatarioNombre, "Juan");
  assert.equal(r.data.observaciones, "Venta de mostrador");
}

// ── 2) El producto sale del catálogo, no del cuerpo ─────────────────────────
{
  for (const p of GIFT_CARD_PRODUCTOS) {
    const r = validarAltaGiftCard(base({ duracion_minutos: p.duracion }));
    assert.ok(r.ok, `la duración ${p.duracion} del catálogo se acepta`);
    assert.equal(r.data.producto.monto, p.monto, "el monto es el del catálogo");
  }
  // Una duración inventada no existe como producto.
  for (const invalida of [20, 45, 0, -15, "15; drop", null, undefined]) {
    const r = validarAltaGiftCard(base({ duracion_minutos: invalida }));
    assert.ok(!r.ok && r.status === 422, `la duración ${String(invalida)} se rechaza`);
    assert.ok(!r.ok && r.campo === "duracion_minutos");
  }
}

// ── 3) TEST G · el monto que manda el navegador NO se lee ───────────────────
{
  const r = validarAltaGiftCard(
    base({
      monto: 1,
      monto_original: 1,
      descuento_aplicado: 999999,
      codigo_descuento: "REGALADO",
      // Y tampoco nada de lo que define el estado o la identidad de la fila.
      codigo_unico: "SIM-HACK-HACK",
      estado_pago: "pendiente_pago",
      estado_uso: "usada",
      fecha_pago: "2000-01-01T00:00:00.000Z",
      fecha_vencimiento: "2099-01-01T00:00:00.000Z",
      canal: "web",
      registrado_por: "root",
      mercado_pago_payment_id: "123456",
      usos_disponibles: 99,
      deleted_at: null,
    }),
  );
  assert.ok(r.ok, "el cuerpo con campos de más igual se acepta");
  // Lo validado contiene SOLO lo que el servidor deja decidir al navegador.
  assert.deepEqual(
    Object.keys(r.data).sort(),
    [
      "cantidad", "compradorNombre", "compradorTelefono", "destinatarioNombre",
      "medioPago", "modoUso", "observaciones", "procesador", "producto",
    ],
    "la validación no arrastra ningún campo extra del cuerpo",
  );
  assert.equal(r.data.producto.monto, GIFT_CARD_PRODUCTOS[0].monto, "el precio es el del catálogo");
}

// ── 4) Comprador y teléfono ─────────────────────────────────────────────────
{
  for (const nombre of ["", "   ", "x".repeat(81), 42, null]) {
    const r = validarAltaGiftCard(base({ comprador_nombre: nombre }));
    assert.ok(!r.ok && r.campo === "comprador_nombre", `nombre ${String(nombre)} rechazado`);
  }
  for (const tel of ["", "123", "x".repeat(31), "351-abc-123", "351@252"]) {
    const r = validarAltaGiftCard(base({ comprador_telefono: tel }));
    assert.ok(!r.ok && r.campo === "comprador_telefono", `teléfono ${tel} rechazado`);
  }
  // El destinatario es opcional, pero tiene tope.
  const sinDest = validarAltaGiftCard(base({ destinatario_nombre: "  " }));
  assert.ok(sinDest.ok && sinDest.data.destinatarioNombre === null, "destinatario vacío → null");
  const destLargo = validarAltaGiftCard(base({ destinatario_nombre: "y".repeat(81) }));
  assert.ok(!destLargo.ok && destLargo.campo === "destinatario_nombre");
}

// ── 5) Cantidad, modo de uso y medio de pago ────────────────────────────────
{
  for (const c of [0, -1, GIFT_CARD_MAX_CANTIDAD + 1, "muchas", NaN]) {
    const r = validarAltaGiftCard(base({ cantidad: c }));
    assert.ok(!r.ok && r.campo === "cantidad", `cantidad ${String(c)} rechazada`);
  }
  const tope = validarAltaGiftCard(base({ cantidad: GIFT_CARD_MAX_CANTIDAD }));
  assert.ok(tope.ok && tope.data.cantidad === GIFT_CARD_MAX_CANTIDAD, "el tope se acepta");

  const juntas = validarAltaGiftCard(base({ cantidad: 3, modo_uso: "juntas" }));
  assert.ok(juntas.ok && juntas.data.modoUso === "juntas");
  const raro = validarAltaGiftCard(base({ modo_uso: "cualquiera" }));
  assert.ok(raro.ok && raro.data.modoUso === "separadas", "un modo desconocido cae en separadas");

  for (const m of MEDIOS_PAGO_GIFT_CARD) {
    const r = validarAltaGiftCard(
      base({ medio_pago: m, procesador: requiereProcesador(m) ? "mercado_pago" : "" }),
    );
    assert.ok(r.ok && r.data.medioPago === m, `el medio ${m} se acepta`);
  }
  for (const m of ["", "bitcoin", "mercadopago", "cheque", null, 7]) {
    const r = validarAltaGiftCard(base({ medio_pago: m }));
    assert.ok(!r.ok && r.campo === "medio_pago", `el medio ${String(m)} se rechaza`);
  }
}

// ── 5 bis) Medios y procesadores: los de Finanzas, no una lista propia ──────
{
  // La lista del formulario ES la de Finanzas. Si mañana aparece un medio nuevo
  // en el modelo financiero, esta prueba obliga a que Gift Cards lo vea.
  assert.deepEqual(
    [...MEDIOS_PAGO_GIFT_CARD],
    [...METODOS_PAGO],
    "los medios de Gift Card son exactamente los de Finanzas",
  );
  assert.deepEqual([...MEDIOS_PAGO_GIFT_CARD], ["efectivo", "transferencia", "qr", "debito", "credito"]);
  assert.deepEqual([...PROCESADORES_GIFT_CARD], [...PROCESADORES]);
  assert.deepEqual([...PROCESADORES_GIFT_CARD], ["mercado_pago", "payway"]);

  // La regla de qué medio lleva posnet es la de Finanzas, no una copia.
  for (const m of METODOS_CON_COMISION) assert.ok(requiereProcesador(m), `${m} lleva posnet`);
  for (const m of METODOS_SIN_COMISION) assert.ok(!requiereProcesador(m), `${m} no lleva posnet`);

  // TEST F · combinación inválida: un medio sin posnet no puede traer procesador.
  for (const m of METODOS_SIN_COMISION) {
    for (const p of PROCESADORES) {
      const r = validarAltaGiftCard(base({ medio_pago: m, procesador: p }));
      assert.ok(!r.ok && r.campo === "procesador", `${m} + ${p} se rechaza`);
      assert.ok(!r.ok && r.codigo === "procesador_no_corresponde");
    }
    const ok = validarAltaGiftCard(base({ medio_pago: m }));
    assert.ok(ok.ok && ok.data.procesador === null, `${m} queda sin procesador`);
  }

  // Y un medio con posnet NO puede quedarse sin él, ni traer uno inventado.
  for (const m of METODOS_CON_COMISION) {
    for (const p of ["", "  ", "payway_2", "posnet", "visa", null, 3]) {
      const r = validarAltaGiftCard(base({ medio_pago: m, procesador: p }));
      assert.ok(!r.ok && r.campo === "procesador", `${m} + "${String(p)}" se rechaza`);
      assert.ok(!r.ok && r.codigo === "procesador_invalido");
    }
    for (const p of PROCESADORES) {
      const r = validarAltaGiftCard(base({ medio_pago: m, procesador: p }));
      assert.ok(r.ok && r.data.procesador === p, `${m} + ${p} se acepta`);
    }
  }
}

// ── 5 ter) TESTS A–E · bruto, comisión y neto de cada medio ────────────────
// El cálculo NO es de Gift Cards: es calcularComisionesPagos, el mismo del
// turnero, alimentado con la misma configuración. Acá se comprueba que una Gift
// Card manual entre por ese camino y dé los números correctos.
{
  // Config con la forma real de fin_comisiones_cobro (porcentajes de ejemplo).
  const cfg = (procesador: string, metodo: string, base_: number): ComisionConfig => ({
    procesador, metodo_pago: metodo, porcentaje_base: base_,
    aplica_iva: true, iva_porcentaje: 21, activa: true,
  });
  const tasas: Record<string, ComisionConfig> = {};
  for (const [proc, met, pct] of [
    ["mercado_pago", "qr", 0.8], ["mercado_pago", "debito", 3.25], ["mercado_pago", "credito", 6.29],
    ["payway", "qr", 0.8], ["payway", "debito", 1.0], ["payway", "credito", 1.8],
  ] as const) {
    tasas[claveComision(proc, met)] = cfg(proc, met, pct);
  }

  const MONTO = 12000;
  const cobro = (metodo: string, procesador: string | null) =>
    calcularComisionesPagos([{ metodo_pago: metodo, monto: MONTO, posnet_pago: procesador }], tasas);

  // A · Efectivo: bruto = neto, comisión 0.
  const a = cobro("efectivo", null);
  assert.equal(a.bruto, MONTO, "A · bruto 12.000");
  assert.equal(a.comision, 0, "A · efectivo no paga comisión");
  assert.equal(a.neto, MONTO, "A · neto 12.000");
  assert.equal(a.advertencias.length, 0, "A · sin advertencias");

  // B · Transferencia: idéntico a efectivo.
  const b = cobro("transferencia", null);
  assert.equal(b.bruto, MONTO, "B · bruto 12.000");
  assert.equal(b.comision, 0, "B · transferencia no paga comisión");
  assert.equal(b.neto, MONTO, "B · neto 12.000");
  assert.equal(b.advertencias.length, 0, "B · sin advertencias");

  // C/D/E · con posnet: comisión = monto × (base × (1 + IVA)) y neto = bruto − comisión.
  const esperado = (pct: number) =>
    Math.round(((MONTO * (pct * 1.21)) / 100 + Number.EPSILON) * 100) / 100;

  for (const [nombre, metodo, proc, pct] of [
    ["C", "qr", "mercado_pago", 0.8],
    ["D", "debito", "mercado_pago", 3.25],
    ["D", "debito", "payway", 1.0],
    ["E", "credito", "mercado_pago", 6.29],
    ["E", "credito", "payway", 1.8],
  ] as const) {
    const r = cobro(metodo, proc);
    assert.equal(r.bruto, MONTO, `${nombre} · ${metodo}/${proc} bruto`);
    assert.equal(r.comision, esperado(pct), `${nombre} · ${metodo}/${proc} comisión`);
    assert.equal(r.neto, Math.round((MONTO - esperado(pct) + Number.EPSILON) * 100) / 100, `${nombre} · ${metodo}/${proc} neto`);
    assert.equal(r.detalle[0].procesador, proc, `${nombre} · el procesador queda registrado`);
    // El % informado es el de la configuración (base + IVA), no uno inventado.
    assert.ok(
      Math.abs(r.detalle[0].porcentaje_total - porcentajeTotalComision(tasas[claveComision(proc, metodo)])) < 1e-4,
      `${nombre} · el % total sale de la configuración`,
    );
    assert.ok(Math.abs(r.detalle[0].porcentaje_total - pct * 1.21) < 1e-4, `${nombre} · base × IVA`);
    assert.equal(r.advertencias.length, 0, `${nombre} · sin advertencias`);
  }

  // Payway cobra menos que Mercado Pago en débito y crédito: no es la misma tasa
  // repetida, sale de verdad de la configuración de cada procesador.
  assert.ok(cobro("credito", "payway").comision < cobro("credito", "mercado_pago").comision);
  assert.ok(cobro("debito", "payway").comision < cobro("debito", "mercado_pago").comision);

  // Sin tasa configurada NO se asume comisión 0 en silencio: queda advertido,
  // igual que en el stand.
  const sinCfg = calcularComisionesPagos(
    [{ metodo_pago: "credito", monto: MONTO, posnet_pago: "payway" }],
    {},
  );
  assert.equal(sinCfg.comision, 0);
  assert.equal(sinCfg.advertencias[0]?.motivo, "sin_config", "sin configuración → advertencia");
}

// ── 6) Observación administrativa ───────────────────────────────────────────
{
  const justo = validarAltaGiftCard(base({ observaciones: "o".repeat(GIFT_CARD_OBSERVACIONES_MAX) }));
  assert.ok(justo.ok, "el tope exacto de la observación se acepta");
  const pasado = validarAltaGiftCard(base({ observaciones: "o".repeat(GIFT_CARD_OBSERVACIONES_MAX + 1) }));
  assert.ok(!pasado.ok && pasado.campo === "observaciones");
  const vacia = validarAltaGiftCard(base({ observaciones: "   " }));
  assert.ok(vacia.ok && vacia.data.observaciones === null, "observación vacía → null");
}

// ── 7) TEST D · la vigencia es una sola regla ───────────────────────────────
{
  assert.equal(GIFT_CARD_VIGENCIA_DIAS, 30, "la vigencia publicada de SIM es de 30 días");

  const pago = "2026-09-22T15:30:00.000Z";
  const vence = calcularVencimientoGiftCard(pago);
  assert.ok(vence, "con una fecha válida hay vencimiento");
  const diff = new Date(vence!).getTime() - new Date(pago).getTime();
  assert.equal(diff, GIFT_CARD_VIGENCIA_DIAS * 24 * 60 * 60 * 1000, "vence exactamente a los N días");

  assert.equal(calcularVencimientoGiftCard("no es una fecha"), null, "una fecha basura no inventa vencimiento");

  // La condición IMPRESA en la Gift Card se arma con la constante: el papel que
  // recibe el cliente y la fila de la base no pueden divergir.
  assert.ok(
    GIFT_CARD_CONDICIONES[0].includes(String(GIFT_CARD_VIGENCIA_DIAS)),
    "la condición impresa usa la misma vigencia",
  );
  assert.equal(GIFT_CARD_CONDICIONES[0], "Válida por 30 días desde la fecha de compra.");
  // Y está publicada en los Términos: si cambia una, tiene que cambiar la otra.
  assert.ok(
    read("app/legales/terminos/page.tsx").includes(`vigencia de ${GIFT_CARD_VIGENCIA_DIAS} días`),
    "los Términos publican la misma vigencia",
  );
}

// ── 8) TEST C · el código es el del flujo público ───────────────────────────
{
  const FORMATO = /^SIM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
  const vistos = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const c = generarCodigoGiftCard();
    assert.ok(FORMATO.test(c), `formato del código: ${c}`);
    vistos.add(c);
  }
  assert.equal(vistos.size, 5000, "5000 códigos generados, 5000 distintos");

  // El alta administrativa NO tiene su propio generador.
  const alta = read("lib/giftCardsAdminAlta.ts");
  assert.ok(alta.includes("generarCodigoGiftCard"), "usa el generador compartido");
  assert.ok(!/randomInt|Math\.random/.test(alta), "no genera códigos por su cuenta");
}

// ── 9) TEST B (cableado) · el endpoint es solo-admin ────────────────────────
{
  const src = read("app/api/admin/gift-cards/route.ts");
  const post = src.slice(src.indexOf("export async function POST"));
  assert.ok(post.length > 0, "el endpoint tiene POST");
  assert.ok(/requireAdmin\(\)/.test(post), "POST usa requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(post), "POST NO usa requireStaffOrAdmin");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(post), "POST corta si el guard falla");
  assert.ok(/isAllowedOrigin\(req\)/.test(post), "POST valida el origen");
  // El GET sigue siendo de consulta para admin y staff: no se endurece de más.
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  assert.ok(/requireStaffOrAdmin\(\)/.test(get), "el GET sigue abierto a staff");

  // Anti mass-assignment: el rol sale de la sesión, nunca del cuerpo.
  assert.ok(/auth\.role/.test(post), "el rol registrado sale de la sesión");
  for (const prohibido of [
    "body.monto", "body.estado_pago", "body.estado_uso", "body.codigo_unico",
    "body.fecha_pago", "body.fecha_vencimiento", "body.canal", "body.procesador",
    "body.registrado_por", "body.mercado_pago_payment_id", "body.rol", "body.role",
  ]) {
    assert.ok(!src.includes(prohibido), `el endpoint NO lee ${prohibido}`);
  }
}

// ── 10) El flujo público no se convirtió en otra cosa ───────────────────────
{
  const pref = read("app/api/gift-cards/preference/route.ts");
  assert.ok(/new Preference\(client\)/.test(pref), "la compra pública sigue creando la preference");
  assert.ok(/notification_url/.test(pref), "sigue avisando al webhook");
  assert.ok(/external_reference: `gift_card_\$\{grupoId\}`/.test(pref), "el external_reference no cambió");

  const wh = read("app/api/gift-cards/webhook/route.ts");
  assert.ok(/verifyMpWebhook\(req, paymentId\)/.test(wh), "el webhook sigue verificando la firma");
  assert.ok(/registrarPagoWebSeguro/.test(wh), "el webhook sigue registrando el cargo real de MP");
  assert.ok(/estado_pago: "pagado"/.test(wh), "el webhook sigue activando la Gift Card");

  // Los dos caminos usan la MISMA función de vencimiento: no hay regla paralela.
  for (const [nombre, src] of [["preference", pref], ["webhook", wh], ["alta admin", read("lib/giftCardsAdminAlta.ts")]] as const) {
    assert.ok(src.includes("calcularVencimientoGiftCard"), `${nombre} usa la vigencia compartida`);
  }
  // Y el alta administrativa no llama a Mercado Pago por ningún lado: no importa
  // el SDK, no crea preferencias y no devuelve un link de checkout.
  const alta = read("lib/giftCardsAdminAlta.ts");
  assert.ok(!/from "mercadopago"/.test(alta), "el alta admin no importa el SDK de Mercado Pago");
  assert.ok(!/new Preference|preference\.create|init_point/.test(alta), "el alta admin no crea checkout");
  assert.ok(!/MERCADOPAGO_ACCESS_TOKEN/.test(alta), "el alta admin no usa credenciales de MP");
}

// ── 11) Finanzas: el alta NO escribe un movimiento financiero ───────────────
// El ingreso lo lee fin_ingresos_por_mes de la propia fila de gift_cards. Si
// además se insertara un fin_movimientos, la venta entraría dos veces.
{
  const alta = read("lib/giftCardsAdminAlta.ts");
  const route = read("app/api/admin/gift-cards/route.ts");
  // Solo se tocan gift_cards y su historial: ninguna tabla ni RPC de Finanzas.
  const tablas = [alta, route].flatMap((s) => [...s.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(tablas)].sort(), ["gift_card_logs", "gift_cards"]);
  for (const src of [alta, route]) {
    assert.ok(!/\.from\("fin_/.test(src), "no escribe en ninguna tabla de Finanzas");
    assert.ok(!/\.rpc\(/.test(src), "no llama a ninguna RPC");
  }
}

console.log(
  "OK — giftCardsAdminAlta (puro): catálogo, monto server-side, vigencia única de " +
    `${GIFT_CARD_VIGENCIA_DIAS} días, código compartido, endpoint solo-admin, flujo público intacto.`,
);
