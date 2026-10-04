// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { GIFT_CARD_VIGENCIA_DIAS } from "@/lib/giftCards";

// Idempotencia ATÓMICA del consumo de códigos en el webhook de Gift Cards (B5.1).
// Ejecutar: npx tsx --env-file=.env.local lib/giftCardsWebhook.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA, `fetch`
// queda bloqueado, la consulta de pago de Mercado Pago se intercepta y la firma
// se hace con un secreto DESCARTABLE. Se prueba el webhook real.
//
// La base en memoria modela lo que garantiza Postgres: cada sentencia es
// atómica. En particular el UPDATE condicional (payment_id IS NULL) que activa
// la compra: dos UPDATE concurrentes se serializan por el bloqueo de filas y el
// segundo, al reevaluar la condición, no actualiza nada. Una BARRERA hace que
// todas las notificaciones concurrentes pasen primero la lectura inicial (el
// viejo chequeo "¿ya tiene payment_id?") antes de que ninguna escriba: el peor
// caso, sin serializarlas.

type Fila = Record<string, unknown>;
type Resultado = { data: unknown; error: { code?: string; message: string } | null; count: number | null };
type Op = "select" | "insert" | "update" | "upsert" | "delete";

const TABLAS: Record<string, Fila[]> = {};
const operaciones: string[] = [];
let fallas: Array<{ tabla: string; op: Op }> = [];
const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clonar = (f: Fila): Fila => JSON.parse(JSON.stringify(f));

// Barrera: la lectura inicial del webhook ("id, mercado_pago_payment_id, …")
// espera a que lleguen N lecturas antes de resolver cualquiera. Si no llegan
// todas en 5 s, las que esperan fallan (el test no puede colgarse en silencio).
type Barrera = { n: number; esperando: Array<{ ok: () => void; ko: (e: Error) => void }>; reloj: ReturnType<typeof setTimeout> };
let barrera: Barrera | null = null;
function ponerBarrera(n: number) {
  const b: Barrera = { n, esperando: [], reloj: setTimeout(() => {
    if (barrera !== b) return;
    barrera = null;
    for (const x of b.esperando) x.ko(new Error(`barrera: llegaron ${b.esperando.length} de ${n}`));
  }, 5000) };
  barrera = b;
}
function pasarBarrera(): Promise<void> {
  const b = barrera;
  if (!b) return Promise.resolve();
  return new Promise((ok, ko) => {
    b.esperando.push({ ok, ko });
    if (b.esperando.length >= b.n) {
      barrera = null;
      clearTimeout(b.reloj);
      for (const x of b.esperando) x.ok();
    }
  });
}

const rpcs: string[] = [];
function reiniciar(filas: Record<string, Fila[]> = {}) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  for (const [k, v] of Object.entries(filas)) TABLAS[k] = v.map(clonar);
  operaciones.length = 0;
  rpcs.length = 0;
  fallas = [];
  if (barrera) clearTimeout(barrera.reloj);
  barrera = null;
}

class Consulta implements PromiseLike<Resultado> {
  private op: Op = "select";
  private cols = "";
  private filtros: Array<(f: Fila) => boolean> = [];
  private valores: Fila | Fila[] | null = null;
  private conflicto = "id";
  private devolver = false;
  private uno: "single" | "maybe" | null = null;
  constructor(private readonly t: string) {}
  select(cols = "") { if (this.op === "select") this.cols = cols; else this.devolver = true; return this; }
  insert(v: Fila | Fila[]) { this.op = "insert"; this.valores = v; return this; }
  update(v: Fila) { this.op = "update"; this.valores = v; return this; }
  upsert(v: Fila, opts?: { onConflict?: string }) { this.op = "upsert"; this.valores = v; this.conflicto = opts?.onConflict ?? "id"; return this; }
  eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
  is(c: string, v: null) { this.filtros.push((f) => (f[c] ?? null) === v); return this; }
  maybeSingle() { this.uno = "maybe"; return this; }
  single() { this.uno = "single"; return this; }
  then<A = Resultado, B = never>(ok?: ((v: Resultado) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const lecturaInicial = this.t === "gift_cards" && this.op === "select" && this.cols.includes("mercado_pago_payment_id");
    return (lecturaInicial ? pasarBarrera() : Promise.resolve()).then(() => this.ejecutar()).then(ok, ko);
  }
  private forma(filas: Fila[] | null): Resultado {
    if (this.uno === null) return { data: filas, error: null, count: null };
    const l = filas ?? [];
    if (l.length > 1 || (this.uno === "single" && l.length !== 1)) return { data: null, error: { code: "PGRST116", message: "filas" }, count: null };
    return { data: l[0] ?? null, error: null, count: null };
  }
  private ejecutar(): Resultado {
    operaciones.push(`${this.op}:${this.t}`);
    const e = fallas.findIndex((x) => x.tabla === this.t && x.op === this.op);
    if (e >= 0) { fallas.splice(e, 1); return { data: null, error: { code: "XX000", message: "caída forzada" }, count: null }; }
    const filas = tabla(this.t);
    const coincide = (f: Fila) => this.filtros.every((fn) => fn(f));
    switch (this.op) {
      case "select": return this.forma(filas.filter(coincide).map(clonar));
      case "insert": {
        const nuevas = (Array.isArray(this.valores) ? this.valores : [this.valores as Fila]).map((v) => ({ id: filas.length + 1, created_at: new Date().toISOString(), ...clonar(v) }));
        filas.push(...nuevas);
        return this.forma(this.devolver ? nuevas.map(clonar) : null);
      }
      case "upsert": {
        const v = this.valores as Fila;
        const existente = filas.find((f) => f[this.conflicto] === v[this.conflicto]);
        if (existente) Object.assign(existente, clonar(v));
        else filas.push(clonar(v));
        return this.forma(null);
      }
      case "update": {
        // Atómico: filtra y escribe en el mismo paso (como el UPDATE de Postgres
        // con la condición reevaluada tras el bloqueo de fila).
        const afectadas = filas.filter(coincide);
        for (const f of afectadas) Object.assign(f, clonar(this.valores as Fila));
        return this.forma(this.devolver ? afectadas.map((f) => ({ id: f.id })) : null);
      }
      default: return this.forma(null);
    }
  }
}

const cliente = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (fn: string, a?: Record<string, unknown>) => unknown };
cliente.from = (t: string) => new Consulta(t);
// La RPC real: UN UPDATE atómico (usos + 1 solo si está activo y no llegó al tope).
cliente.rpc = (fn: string, args: Record<string, unknown> = {}) => {
  rpcs.push(fn);
  if (fn !== "consumir_codigo_descuento") throw new Error(`RPC inesperada ${fn}`);
  const c = tabla("codigos_descuento").find((x) => x.codigo === String(args.p_codigo).trim().toUpperCase());
  if (!c || c.activo !== true || (c.usos_maximos != null && Number(c.usos_actuales ?? 0) >= Number(c.usos_maximos))) {
    return Promise.resolve({ data: false, error: null });
  }
  c.usos_actuales = Number(c.usos_actuales ?? 0) + 1;
  if (c.usos_maximos != null && Number(c.usos_actuales) >= Number(c.usos_maximos)) c.activo = false;
  return Promise.resolve({ data: true, error: null });
};

globalThis.fetch = (async (input: unknown) => { throw new Error(`el test no usa la red (${String(input).slice(0, 30)}…)`); }) as typeof fetch;

const DIA_MS = 24 * 60 * 60 * 1000;
const CODIGO = "B51-DESC";

const codigo = (extra: Fila = {}) => ({
  id: 1, codigo: CODIGO, activo: true, usos_maximos: 5, usos_actuales: 0, tipo_descuento: "porcentaje", valor_descuento: 10,
  fecha_inicio: null, fecha_fin: null, ...extra,
});
const compra = (grupo: string, n: number, d: number, monto: number, opts: { codigo?: string | null; juntas?: boolean } = {}) =>
  Array.from({ length: opts.juntas ? 1 : n }, () => ({
    id: randomUUID(), codigo_unico: `SIM-${randomUUID().slice(0, 4).toUpperCase()}-B51X`, grupo_compra_id: grupo,
    duracion_minutos: d, monto: opts.juntas ? monto * n : monto, monto_original: opts.juntas ? monto * n : monto,
    estado_pago: "pendiente_pago", estado_uso: "pendiente", mercado_pago_payment_id: null, fecha_pago: null, fecha_vencimiento: null,
    codigo_descuento: opts.codigo === undefined ? CODIGO : opts.codigo, canal: "web",
    cantidad: opts.juntas ? n : 1, usos_totales: opts.juntas ? n : 1, usos_disponibles: opts.juntas ? n : 1, modo_uso: opts.juntas ? "juntas" : "separadas",
  }));

async function main() {
  const SECRETO = randomBytes(24).toString("hex");
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-B51-SIN-RED";
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];

  const { Payment } = await import("mercadopago");
  const pagos: Record<string, Fila> = {};
  (Payment.prototype as unknown as { get: (a: { id: string }) => Promise<unknown> }).get = async ({ id }) => {
    const p = pagos[String(id)];
    if (!p) throw new Error(`pago ${id} desconocido`);
    return p;
  };
  const ruta = await import("@/app/api/gift-cards/webhook/route");

  let ip = 0;
  const notificar = (paymentId: string) => {
    const ts = String(Date.now());
    const rid = randomUUID();
    const v1 = createHmac("sha256", SECRETO).update(`id:${paymentId.toLowerCase()};request-id:${rid};ts:${ts};`).digest("hex");
    return ruta.POST(new Request("https://simexperience.com.ar/api/gift-cards/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid, "x-real-ip": `10.51.0.${++ip}` },
      body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
    }));
  };
  const aprobado = (paymentId: string, grupo: string, monto: number) => {
    pagos[paymentId] = { id: paymentId, status: "approved", external_reference: `gift_card_${grupo}`, transaction_amount: monto, currency_id: "ARS" };
  };
  const del = (g: string) => tabla("gift_cards").filter((f) => f.grupo_compra_id === g);
  const usos = (paymentId: string) => tabla("usos_codigos_descuento").filter((u) => u.mercado_pago_payment_id === paymentId);
  const usosActuales = () => Number(tabla("codigos_descuento")[0]?.usos_actuales ?? 0);
  const finPagos = (paymentId: string) => tabla("fin_pagos_web").filter((p) => p.payment_id === paymentId);
  const venceA30 = (f: Fila) => Date.parse(String(f.fecha_vencimiento)) - Date.parse(String(f.fecha_pago)) === GIFT_CARD_VIGENCIA_DIAS * DIA_MS;
  const unaVezPagada = (g: string, paymentId: string) => {
    const filas = del(g);
    assert.ok(filas.length > 0);
    for (const f of filas) {
      assert.equal(f.estado_pago, "pagado");
      assert.equal(f.mercado_pago_payment_id, paymentId);
      assert.ok(venceA30(f), "vencimiento a 30 días del pago");
    }
    assert.equal(new Set(filas.map((f) => f.fecha_pago)).size, 1, "una sola activación (una sola fecha de pago)");
  };

  // ── 1. Mismo pago dos veces, en secuencia ─────────────────────────────────
  {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, 1, 30, 18000), codigos_descuento: [codigo()] });
    aprobado("5101", g, 18000);
    assert.equal((await notificar("5101")).status, 200);
    const fecha = del(g)[0].fecha_pago;
    assert.equal((await notificar("5101")).status, 200);
    unaVezPagada(g, "5101");
    assert.equal(del(g)[0].fecha_pago, fecha, "la segunda no reactiva");
    assert.equal(usosActuales(), 1, "código: +1");
    assert.equal(usos("5101").length, 1, "un solo registro de uso");
    assert.equal(finPagos("5101").length, 1, "Finanzas: un registro");
  }

  // ── 2. Dos notificaciones CONCURRENTES del mismo pago ─────────────────────
  {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, 1, 20, 17000), codigos_descuento: [codigo()] });
    aprobado("5102", g, 17000);
    ponerBarrera(2);
    const [a, b] = await Promise.all([notificar("5102"), notificar("5102")]);
    assert.deepEqual([a.status, b.status], [200, 200], "las dos responden 200 (idempotente)");
    assert.equal(operaciones.filter((o) => o === "upsert:fin_pagos_web").length, 2,
      "las dos pasaron el viejo chequeo: lo que evita el doble consumo es el UPDATE condicional");
    unaVezPagada(g, "5102");
    assert.equal(rpcs.length, 1, "solo la notificación que activó llama a la RPC de consumo");
    assert.equal(usosActuales(), 1, "código consumido EXACTAMENTE una vez");
    assert.equal(usos("5102").length, 1);
    assert.equal(finPagos("5102").length, 1, "fin_pagos_web: una fila");
  }

  // ── 3. Cinco reintentos: secuenciales y concurrentes ──────────────────────
  {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, 1, 15, 12000), codigos_descuento: [codigo()] });
    aprobado("5103", g, 12000);
    for (let i = 0; i < 5; i++) assert.equal((await notificar("5103")).status, 200);
    assert.equal(usosActuales(), 1, "5 reintentos secuenciales: +1");
    assert.equal(usos("5103").length, 1);
    assert.equal(finPagos("5103").length, 1);

    const g2 = randomUUID();
    reiniciar({ gift_cards: compra(g2, 1, 15, 12000), codigos_descuento: [codigo()] });
    aprobado("5104", g2, 12000);
    ponerBarrera(5);
    const r = await Promise.all(Array.from({ length: 5 }, () => notificar("5104")));
    assert.ok(r.every((x) => x.status === 200));
    unaVezPagada(g2, "5104");
    assert.equal(operaciones.filter((o) => o === "upsert:fin_pagos_web").length, 5, "las 5 pasaron el viejo chequeo");
    assert.equal(rpcs.length, 1, "una sola llamada a la RPC");
    assert.equal(usosActuales(), 1, "5 concurrentes: +1, no +5");
    assert.equal(usos("5104").length, 1);
    assert.equal(finPagos("5104").length, 1);
  }

  // ── 4. Dos compras distintas con el mismo código: cada una consume ────────
  {
    const g1 = randomUUID();
    const g2 = randomUUID();
    reiniciar({ gift_cards: [...compra(g1, 1, 30, 18000), ...compra(g2, 1, 20, 15300)], codigos_descuento: [codigo({ usos_maximos: 5 })] });
    aprobado("5105", g1, 18000);
    aprobado("5106", g2, 15300);
    ponerBarrera(4);
    await Promise.all([notificar("5105"), notificar("5106"), notificar("5105"), notificar("5106")]);
    unaVezPagada(g1, "5105");
    unaVezPagada(g2, "5106");
    assert.equal(rpcs.length, 2, "una RPC por compra");
    assert.equal(usosActuales(), 2, "dos pagos distintos: +2 (la idempotencia es por pago, no global)");
    assert.equal(usos("5105").length + usos("5106").length, 2);
    assert.equal(tabla("codigos_descuento")[0].activo, true, "sigue activo: le quedan usos");
    // Con tope 1, la segunda compra se activa igual, pero el consumo no se finge.
    const g3 = randomUUID();
    const g4 = randomUUID();
    reiniciar({ gift_cards: [...compra(g3, 1, 30, 18000), ...compra(g4, 1, 30, 18000)], codigos_descuento: [codigo({ usos_maximos: 1 })] });
    aprobado("5107", g3, 18000);
    aprobado("5108", g4, 18000);
    await notificar("5107");
    await notificar("5108");
    unaVezPagada(g3, "5107");
    unaVezPagada(g4, "5108");
    assert.equal(usosActuales(), 1, "tope 1: un solo consumo");
    assert.equal(tabla("codigos_descuento")[0].activo, false);
    assert.equal(usos("5108").length, 0, "no se inventa un uso que no ocurrió");
  }

  // ── 5. Sin código: idéntico a siempre ─────────────────────────────────────
  {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, 1, 10, 10000, { codigo: null }), codigos_descuento: [codigo()] });
    aprobado("5109", g, 10000);
    ponerBarrera(2);
    await Promise.all([notificar("5109"), notificar("5109")]);
    unaVezPagada(g, "5109");
    assert.equal(rpcs.length, 0, "sin código no se llama a la RPC");
    assert.equal(usosActuales(), 0, "sin código no se consume nada");
    assert.equal(tabla("usos_codigos_descuento").length, 0);
    assert.equal(finPagos("5109").length, 1);
  }

  // ── 6. Legacy y v2, separadas y juntas: la misma garantía ─────────────────
  for (const [d, monto, n, juntas, caso] of [
    [15, 12000, 1, false, "legacy 15"], [30, 20000, 3, false, "legacy 30 × 3 separadas"],
    [10, 10000, 2, true, "v2 10 × 2 juntas"], [20, 17000, 3, false, "v2 20 × 3 separadas"], [30, 23000, 1, false, "v2 30"],
  ] as const) {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, n, d, monto, { juntas }), codigos_descuento: [codigo()] });
    const pid = `52${d}${n}${juntas ? 1 : 0}`;
    aprobado(pid, g, monto * n);
    ponerBarrera(3);
    await Promise.all([notificar(pid), notificar(pid), notificar(pid)]);
    unaVezPagada(g, pid);
    assert.equal(del(g).length, juntas ? 1 : n);
    assert.ok(del(g).every((f) => f.duracion_minutos === d), `${caso}: la duración no cambia`);
    assert.equal(usosActuales(), 1, `${caso}: un consumo por COMPRA, como siempre`);
    assert.equal(usos(pid).length, 1);
    assert.equal(finPagos(pid).length, 1);
  }

  // ── 7. Si activar falla: 500, nada consumido; el reintento lo resuelve ────
  {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, 1, 20, 17000), codigos_descuento: [codigo()] });
    aprobado("5110", g, 17000);
    fallas.push({ tabla: "gift_cards", op: "update" });
    assert.equal((await notificar("5110")).status, 500, "Mercado Pago reintenta");
    assert.equal(del(g)[0].estado_pago, "pendiente_pago");
    assert.equal(usosActuales(), 0, "sin activación no se consume");
    assert.equal((await notificar("5110")).status, 200);
    unaVezPagada(g, "5110");
    assert.equal(usosActuales(), 1);
    assert.equal(finPagos("5110").length, 1, "fin_pagos_web sigue siendo una fila");
  }

  // ── 8. Firma inválida y pago rechazado: igual que siempre ─────────────────
  {
    const g = randomUUID();
    reiniciar({ gift_cards: compra(g, 1, 20, 17000), codigos_descuento: [codigo()] });
    aprobado("5111", g, 17000);
    const r = await ruta.POST(new Request("https://simexperience.com.ar/api/gift-cards/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-signature": "ts=1,v1=00", "x-request-id": "x", "x-real-ip": "10.51.9.9" },
      body: JSON.stringify({ type: "payment", data: { id: "5111" } }),
    }));
    assert.equal(r.status, 401);
    assert.deepEqual(operaciones, [], "sin firma válida no se toca nada");
    pagos["5112"] = { id: "5112", status: "rejected", external_reference: `gift_card_${g}` };
    await notificar("5112");
    assert.equal(del(g)[0].estado_pago, "rechazado");
    assert.equal(usosActuales(), 0, "un rechazo no consume");
  }

  // ── 9. Guarda de fuente: el consumo depende de la transición ──────────────
  {
    const src = readFileSync(join(process.cwd(), "app/api/gift-cards/webhook/route.ts"), "utf8");
    assert.ok(/\.is\("mercado_pago_payment_id", null\)\s*\.select\("id"\)/.test(src), "el UPDATE condicional devuelve las filas que activó");
    assert.ok(/if \(codigo && \(activadas\?\.length \?\? 0\) > 0\)/.test(src), "solo quien activó consume");
    assert.ok(src.indexOf("activadas") < src.indexOf("consumirCodigoDescuento(codigo"), "primero la transición, después el consumo");
    // La compra 100% bonificada ya era atómica: consume una vez dentro de su
    // propio pedido, antes de activar, y cada pedido es una compra nueva.
    const pref = readFileSync(join(process.cwd(), "app/api/gift-cards/preference/route.ts"), "utf8");
    assert.equal((pref.match(/consumirCodigoDescuento\(/g) ?? []).length, 1, "la bonificada consume una sola vez por pedido");
  }

  terminado = true;
  console.log("OK — giftCardsWebhook (B5.1): un pago consume su código exactamente una vez (secuencial, 2 y 5 concurrentes, reintentos), pagos distintos consumen cada uno, sin código igual que siempre, legacy y v2, separadas y juntas.");
}

// Si el loop de eventos se vacía sin llegar al final (una promesa que nunca se
// resolvió), el test FALLA: no puede pasar en silencio.
let terminado = false;
process.on("beforeExit", () => {
  if (!terminado) {
    console.error("giftCardsWebhook: el test terminó sin completar todas las secciones");
    process.exit(1);
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
