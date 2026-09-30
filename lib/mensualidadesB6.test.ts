import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS } from "@/lib/modalidadComercial";
import { fechasPublicasPara } from "@/lib/agenda";

// Mensualidades B6 — modalidad 10/20/30, precios versionados y corte automático.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesB6.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA, `fetch`
// queda bloqueado y la preferencia de Mercado Pago se intercepta. Se prueban
// los módulos y las RUTAS reales (disponibilidad y reservar, con una sesión de
// Mi Plan simulada por su hash), con el reloj inyectado donde la modalidad
// depende del instante.

type Fila = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };
const TABLAS: Record<string, Fila[]> = {};
const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const escrituras: string[] = [];
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
const prefs: Array<Record<string, unknown>> = [];

class Q implements PromiseLike<Res> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private f: Array<(r: Fila) => boolean> = [];
  private val: Fila | Fila[] | null = null;
  private uno: "s" | "m" | null = null;
  private orden: { c: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private rango: [number, number] | null = null;
  constructor(private t: string) {}
  select() { return this; }
  insert(v: Fila | Fila[]) { this.op = "insert"; this.val = v; return this; }
  update(v: Fila) { this.op = "update"; this.val = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  is(c: string, v: null) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, v: unknown[]) { this.f.push((r) => v.includes(r[c])); return this; }
  gte(c: string, v: string) { this.f.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.f.push((r) => String(r[c]) <= v); return this; }
  lt(c: string, v: string) { this.f.push((r) => String(r[c]) < v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orden ??= { c, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.tope = n; return this; }
  range(a: number, b: number) { this.rango = [a, b]; return this; }
  maybeSingle() { this.uno = "m"; return this; }
  single() { this.uno = "s"; return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private forma(l: Fila[]): Res {
    if (!this.uno) return { data: l, error: null };
    if (l.length > 1 || (this.uno === "s" && l.length === 0)) return { data: null, error: { code: "PGRST116", message: "filas" } };
    return { data: l[0] ?? null, error: null };
  }
  private run(): Res {
    const filas = tabla(this.t);
    const ok = (r: Fila) => this.f.every((fn) => fn(r));
    if (this.op === "insert") {
      escrituras.push(`insert:${this.t}`);
      const nuevas: Fila[] = (Array.isArray(this.val) ? this.val : [this.val as Fila]).map((v) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...clon(v) }));
      if (this.t === "mensualidad_compras" && nuevas.some((n) => filas.some((f) => f.idempotency_key === n.idempotency_key))) {
        return { data: null, error: { code: "23505", message: "mensualidad_compras_idem_uq" } };
      }
      filas.push(...nuevas);
      return this.forma(nuevas.map((n) => ({ id: n.id })));
    }
    if (this.op === "update") {
      if (this.t !== "mensualidad_sesiones") escrituras.push(`update:${this.t}`);
      for (const r of filas.filter(ok)) Object.assign(r, clon(this.val as Fila));
      return this.forma([]);
    }
    if (this.op === "delete") { escrituras.push(`delete:${this.t}`); return this.forma([]); }
    let l = filas.filter(ok).map(clon);
    if (this.orden) {
      const { c, asc } = this.orden;
      l.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rango) l = l.slice(this.rango[0], this.rango[1] + 1);
    if (this.tope !== null) l = l.slice(0, this.tope);
    return this.forma(l);
  }
}

const RESPUESTAS_RPC: Record<string, (a: Record<string, unknown>) => Res> = {};
const cli = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (fn: string, a?: Record<string, unknown>) => unknown };
cli.from = (t: string) => new Q(t);
cli.rpc = (fn: string, args: Record<string, unknown> = {}) => {
  rpcs.push({ fn, args: clon(args) });
  const h = RESPUESTAS_RPC[fn];
  return Promise.resolve(h ? h(args) : { data: null, error: { message: `rpc no esperada ${fn}` } });
};
globalThis.fetch = (async (u: unknown) => { throw new Error(`sin red (${String(u).slice(0, 40)})`); }) as typeof fetch;

// ── Datos base ──────────────────────────────────────────────────────────────
const CORTE = new Date(CORTE_MODALIDAD_V2_MS);
const ANTES = new Date(CORTE_MODALIDAD_V2_MS - 1);            // 30/09 23:59:59.999 ART
const DESPUES = new Date(CORTE_MODALIDAD_V2_MS + 60_000);     // 01/10 00:01 ART
const LEGACY_DESDE = new Date(CORTE_MODALIDAD_V2_MS - 26 * 86_400_000).toISOString();
const PLANES = [
  { id: "p1", slug: "1h", nombre: "1 hora", minutos: 60, precio: 30000, vigencia_dias: 30, etiqueta: null, orden: 1, activo: true },
  { id: "p2", slug: "2h", nombre: "2 horas", minutos: 120, precio: 55000, vigencia_dias: 30, etiqueta: null, orden: 2, activo: true },
  { id: "p4", slug: "4h", nombre: "4 horas", minutos: 240, precio: 100000, vigencia_dias: 30, etiqueta: null, orden: 3, activo: true },
];
const VERSIONES = [
  { plan_id: "p1", precio: 30000, vigente_desde: LEGACY_DESDE }, { plan_id: "p1", precio: 38000, vigente_desde: CORTE.toISOString() },
  { plan_id: "p2", precio: 55000, vigente_desde: LEGACY_DESDE }, { plan_id: "p2", precio: 70000, vigente_desde: CORTE.toISOString() },
  { plan_id: "p4", precio: 100000, vigente_desde: LEGACY_DESDE }, { plan_id: "p4", precio: 128000, vigente_desde: CORTE.toISOString() },
];

function reiniciar(extra: Record<string, Fila[]> = {}, override: string | null = null) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  TABLAS.modalidad_comercial_config = [{ id: 1, modalidad_override: override, motivo: null, actualizado_por: null, updated_at: CORTE.toISOString() }];
  TABLAS.mensualidad_planes = clon(PLANES);
  TABLAS.mensualidad_plan_precios = clon(VERSIONES);
  for (const [k, v] of Object.entries(extra)) TABLAS[k] = clon(v);
  escrituras.length = 0; rpcs.length = 0; prefs.length = 0;
  for (const k of Object.keys(RESPUESTAS_RPC)) delete RESPUESTAS_RPC[k];
}

async function main() {
  process.env.MENSUALIDADES_ENABLED = "true";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-B6-SIN-RED";
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];

  const { Preference } = await import("mercadopago");
  (Preference.prototype as unknown as { create: (a: { body: Record<string, unknown> }) => Promise<unknown> }).create =
    async ({ body }) => { prefs.push(clon(body)); return { id: `pref-${prefs.length}`, init_point: `https://mp.test/${prefs.length}` }; };

  const comercial = await import("@/lib/mensualidadesComercial");
  const compra = await import("@/lib/mensualidadesCompra");
  const pago = await import("@/lib/mensualidadesPago");
  const reserva = await import("@/lib/mensualidadesReserva");
  const cond = await import("@/lib/mensualidadesCondiciones");
  const acciones = await import("@/lib/mensualidadesAdminAcciones");
  const alta = await import("@/lib/mensualidadesAdminAlta");
  const rutaDisp = await import("@/app/api/mensualidades/disponibilidad/route");
  const rutaReservar = await import("@/app/api/mensualidades/reservar/route");

  // ── 1. Corte de precios (función pura) ─────────────────────────────────────
  {
    const precios = (m: "legacy" | "v2_10", ahora: Date) => PLANES.map((p) => comercial.precioDePlan(VERSIONES, p.id, m, ahora));
    assert.deepEqual(precios("legacy", ANTES), [30000, 55000, 100000], "23:59:59.999 → 30/55/100");
    assert.deepEqual(precios("v2_10", CORTE), [38000, 70000, 128000], "00:00:00.000 → 38/70/128");
    assert.deepEqual(precios("legacy", DESPUES), [30000, 55000, 100000], "rollback (override legacy) después del corte → 30/55/100");
    assert.deepEqual(precios("v2_10", ANTES), [38000, 70000, 128000], "override v2 antes del corte → la versión del corte");
    const futura = [...VERSIONES, { plan_id: "p1", precio: 41000, vigente_desde: new Date(CORTE_MODALIDAD_V2_MS + 90 * 86_400_000).toISOString() }];
    assert.equal(comercial.precioDePlan(futura, "p1", "v2_10", DESPUES), 38000, "una versión futura no rige antes de su fecha");
    // Catálogo vigente resuelto por request (override NULL = calendario).
    reiniciar();
    const cAntes = await comercial.catalogoMensualidadesVigente(ANTES);
    const cDespues = await comercial.catalogoMensualidadesVigente(CORTE);
    assert.equal(cAntes.modalidad, "legacy");
    assert.deepEqual(cAntes.planes.map((p) => [p.slug, p.minutos, p.precio]), [["1h", 60, 30000], ["2h", 120, 55000], ["4h", 240, 100000]]);
    assert.deepEqual(cAntes.duraciones, [15, 30, 45, 60]);
    assert.equal(cDespues.modalidad, "v2_10");
    assert.deepEqual(cDespues.planes.map((p) => [p.slug, p.minutos, p.precio]), [["1h", 60, 38000], ["2h", 120, 70000], ["4h", 240, 128000]]);
    assert.deepEqual(cDespues.duraciones, [10, 20, 30]);
    // Rollback: override legacy después del corte vuelve a 30/55/100 legacy.
    reiniciar({}, "legacy");
    const cRollback = await comercial.catalogoMensualidadesVigente(DESPUES);
    assert.equal(cRollback.modalidad, "legacy");
    assert.deepEqual(cRollback.planes.map((p) => p.precio), [30000, 55000, 100000]);
    // mensualidad_planes.precio NO se usa ni se toca.
    assert.ok(!escrituras.some((e) => e.includes("mensualidad_planes")), "mensualidad_planes no se escribe");
  }

  // ── 2. Condiciones por modalidad ───────────────────────────────────────────
  {
    const txt = (m: "legacy" | "v2_10") => cond.condicionesMensualidad(m).map((c) => `${c.titulo}: ${c.texto}`).join(" ");
    assert.ok(txt("legacy").includes("15, 30, 45 o 60 minutos") && txt("legacy").includes("como máximo 60 minutos"));
    assert.ok(txt("v2_10").includes("10, 20 o 30 minutos") && txt("v2_10").includes("como máximo 30 minutos por simulador"));
    assert.ok(!/\b(45|60) minutos\b/.test(cond.condicionesMensualidad("v2_10").find((c) => c.titulo === "Duración y simuladores")!.texto));
    assert.equal(cond.versionCondicionesMensualidad("legacy"), "2026-09-m8c1", "la versión legacy no cambia");
    assert.equal(cond.versionCondicionesMensualidad("v2_10"), "2026-10-v2");
    assert.equal(cond.condicionesMensualidad("v2_10").length, 8, "siguen siendo ocho");
    for (const t of ["Vigencia", "Reservas", "Cancelaciones y cambios", "Renovación", "Titular y participantes", "Disponibilidad y promociones"]) {
      assert.equal(cond.condicionesMensualidad("v2_10").find((c) => c.titulo === t)!.texto,
        cond.condicionesMensualidad("legacy").find((c) => c.titulo === t)!.texto, `"${t}" no cambia`);
    }
    assert.ok(!/buffer/i.test(txt("v2_10")), "el buffer no se menciona: no es tiempo vendido");
  }

  // ── 3. Compra web: snapshot, 409 stale, pago tardío, reintento ─────────────
  const datos = (plan: string, key: string = randomUUID()) => {
    const v = compra.validarDatosCompra({
      nombre: "Test", apellido: "B6", telefono: "351 000 0000", email: "b6@test.local",
      plan_slug: plan, acepto_condiciones: true, idempotency_key: key,
    });
    assert.ok(v.ok, "datos válidos");
    return v.ok ? v.data : (null as never);
  };
  const BASE = "https://simexperience.com.ar";
  {
    // Antes del corte: legacy a $30.000.
    reiniciar();
    let r = await compra.crearCompraYPreferencia(datos("1h"), BASE, { body: { modalidad_vista: "legacy" }, ahora: ANTES });
    assert.ok(r.ok);
    let c = tabla("mensualidad_compras")[0];
    assert.deepEqual([c.plan_precio, c.importe_bruto, c.plan_minutos, c.modalidad, c.condiciones_version], [30000, 30000, 60, "legacy", "2026-09-m8c1"]);
    assert.equal((prefs[0].items as Array<{ unit_price: number }>)[0].unit_price, 30000);

    // Desde el corte: v2 a 38/70/128 con 60/120/240 minutos.
    for (const [slug, precio, minutos] of [["1h", 38000, 60], ["2h", 70000, 120], ["4h", 128000, 240]] as const) {
      reiniciar();
      r = await compra.crearCompraYPreferencia(datos(slug), BASE, { body: { plan_slug: slug, modalidad_vista: "v2_10", precio_visto: precio }, ahora: DESPUES });
      assert.ok(r.ok, `${slug} v2`);
      c = tabla("mensualidad_compras")[0];
      assert.deepEqual([c.plan_precio, c.importe_bruto, c.plan_minutos, c.modalidad, c.condiciones_version], [precio, precio, minutos, "v2_10", "2026-10-v2"]);
      assert.equal((prefs[0].items as Array<{ unit_price: number }>)[0].unit_price, precio);
    }

    // Pestaña abierta 23:59 (vio legacy), envío 00:01 → 409, NADA creado.
    for (const body of [{ modalidad_vista: "legacy" }, {}, { modalidad_vista: "V2_10" }]) {
      reiniciar();
      r = await compra.crearCompraYPreferencia(datos("1h"), BASE, { body, ahora: DESPUES });
      assert.ok(!r.ok && r.status === 409 && r.codigo === "catalogo_actualizado", "stale → 409");
      assert.equal(r.ok ? "" : r.error, "Actualizamos nuestras Mensualidades y precios. Revisá los nuevos planes antes de continuar.");
      assert.deepEqual([escrituras.length, prefs.length], [0, 0], "0 compra, 0 preferencia (y por lo tanto 0 pago y 0 Finanzas)");
    }
    // Precio visto distinto del vigente → 409 también.
    reiniciar();
    r = await compra.crearCompraYPreferencia(datos("1h"), BASE, { body: { plan_slug: "1h", modalidad_vista: "v2_10", precio_visto: 30000 }, ahora: DESPUES });
    assert.ok(!r.ok && r.status === 409);
    assert.deepEqual([escrituras.length, prefs.length], [0, 0]);

    // Reintento de una compra que ya existe (creada 23:55 legacy, sin preferencia
    // por un error de MP): usa SU snapshot aunque ya rija v2.
    reiniciar({ mensualidad_compras: [{
      id: "c-vieja", idempotency_key: "k-reintento-b6", plan_slug: "1h", plan_nombre: "1 hora", plan_minutos: 60,
      plan_precio: 30000, plan_vigencia_dias: 30, importe_bruto: 30000, modalidad: "legacy",
      external_reference: "mensualidad_b6reintento", token_publico: "tok_b6_reintento_0123456789abcdef", mp_init_point: null,
      procesamiento: "pendiente", estado_pago: "pendiente",
    }] });
    r = await compra.crearCompraYPreferencia(datos("1h", "k-reintento-b6"), BASE, { body: { modalidad_vista: "v2_10" }, ahora: DESPUES });
    assert.ok(r.ok && r.data.precio === 30000, "el reintento conserva el precio del snapshot");
    assert.equal((prefs[0].items as Array<{ unit_price: number }>)[0].unit_price, 30000, "la preferencia sale con el precio del snapshot");
    assert.equal(prefs[0].external_reference, "mensualidad_b6reintento");
    assert.ok(!escrituras.includes("insert:mensualidad_compras"), "no se crea otra compra");
    assert.equal(tabla("mensualidad_compras")[0].modalidad, "legacy", "ni cambia su modalidad");
    // Y con preferencia ya creada devuelve la misma, sin llamar a MP.
    const n = prefs.length;
    r = await compra.crearCompraYPreferencia(datos("1h", "k-reintento-b6"), BASE, { body: {}, ahora: DESPUES });
    assert.ok(r.ok && prefs.length === n, "segundo reintento: misma preferencia");

    // Pago tardío: compra legacy 23:55 a $30.000, aprobada 00:05 → se acredita
    // con SU snapshot. Un importe v2 no coincide.
    const aprobar = (monto: number) => pago.procesarPagoVerificado("pay-b6", {
      id: "pay-b6", status: "approved", external_reference: "mensualidad_b6reintento", currency_id: "ARS",
      transaction_amount: monto, date_approved: new Date(CORTE_MODALIDAD_V2_MS + 5 * 60_000).toISOString(),
    });
    RESPUESTAS_RPC.mensualidad_aplicar_compra = () => ({ data: {}, error: null });
    rpcs.length = 0;
    const malo = await aprobar(38000);
    assert.ok(!malo.ok && malo.motivo === "importe_no_coincide", "un pago a precio v2 no acredita una compra legacy");
    assert.equal(rpcs.length, 0);
    const bueno = await aprobar(30000);
    assert.ok(bueno.ok && bueno.estado === "aplicado");
    assert.equal(rpcs[0].fn, "mensualidad_aplicar_compra");
    assert.equal(rpcs[0].args.p_importe_bruto, 30000, "Finanzas registra el bruto real del snapshot");
  }

  // ── 4. Reservas: la modalidad es la DEL PLAN ───────────────────────────────
  const fechas = fechasPublicasPara("mensualidad");
  const dow = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();
  const HABIL = fechas.find((f) => dow(f) >= 1 && dow(f) <= 5)!;
  const FINDE = fechas.find((f) => dow(f) === 0 || dow(f) === 6)!;
  {
    const sel = (m: "legacy" | "v2_10", extra: Fila) => reserva.validarSeleccion({
      fecha: HABIL, hora: "12:00", duracion_minutos: 20, simuladores: ["Ferrari"], acepto_condiciones: true,
      idempotency_key: "b6-sel-0123456789abcdef", ...extra,
    }, undefined, m);
    for (const d of [15, 30, 45, 60]) assert.ok(sel("legacy", { duracion_minutos: d }).ok, `legacy ${d} aceptada`);
    for (const d of [10, 20]) {
      const r = sel("legacy", { duracion_minutos: d });
      assert.ok(!r.ok && r.codigo === "duracion_invalida" && r.error === "Elegí una duración de 15, 30, 45 o 60 minutos.", `legacy ${d} rechazada`);
    }
    for (const d of [10, 20, 30]) assert.ok(sel("v2_10", { duracion_minutos: d }).ok, `v2 ${d} aceptada`);
    for (const d of [15, 45, 60, 40, 50]) {
      const r = sel("v2_10", { duracion_minutos: d });
      assert.ok(!r.ok && r.codigo === "duracion_invalida" && r.error === "Elegí una duración de 10, 20 o 30 minutos.", `v2 ${d} rechazada`);
    }
    // Grilla v2: paso de 10; L-V el tiempo comercial termina a las 22:00.
    assert.ok(sel("v2_10", { hora: "12:10", duracion_minutos: 10 }).ok, "12:10 existe en v2");
    assert.ok(!sel("legacy", { hora: "12:10", duracion_minutos: 15 }).ok, "12:10 no existe en legacy");
    for (const [d, h, ok] of [[10, "21:50", true], [20, "21:40", true], [30, "21:30", true], [30, "21:40", false], [20, "21:50", false], [10, "22:00", false]] as const) {
      assert.equal(sel("v2_10", { hora: h, duracion_minutos: d }).ok, ok, `L-V ${d} a ${h}`);
    }
    // Fin de semana: último inicio 14:00 para las tres.
    for (const d of [10, 20, 30]) {
      assert.ok(sel("v2_10", { fecha: FINDE, hora: "14:00", duracion_minutos: d }).ok, `S-D ${d} a 14:00`);
      assert.ok(!sel("v2_10", { fecha: FINDE, hora: "14:10", duracion_minutos: d }).ok, `S-D ${d} a 14:10 no`);
    }
    const ok = sel("v2_10", { duracion_minutos: 20 });
    assert.ok(ok.ok && ok.value.modalidad === "v2_10" && ok.value.bloques.length === 0, "v2 no usa bloques");
    assert.equal(reserva.minutosRequeridos(20, 2), 40, "20 × 2 = 40: el buffer no cuenta");
  }

  // Rutas reales con sesión simulada.
  const TOKEN = "b6TokenDePruebaDeMiPlan0123456789abcdefABCDEFGH";
  const sesion = (mensualidadId: string) => ({
    id: "ses-b6", mensualidad_id: mensualidadId, token_hash: createHash("sha256").update(TOKEN, "utf8").digest("hex"),
    expira_at: new Date(Date.now() + 600_000).toISOString(), revocada_at: null,
  });
  const plan = (id: string, modalidad: string | null, saldo: number) => ({
    id, codigo: "MEN-TEST-B6ZZ", titular_nombre: "Test", saldo_minutos: saldo, vence_el: "2099-01-01", bloqueada: false, modalidad,
  });
  const H = { cookie: `sim_mensualidad_session=${TOKEN}`, "x-real-ip": "10.60.0.1" };
  const disp = async (qs: string) => {
    const res = await rutaDisp.GET(new Request(`https://simexperience.com.ar/api/mensualidades/disponibilidad?${qs}`, { headers: H }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  let ip = 0;
  const reservar = async (body: Fila) => {
    const res = await rutaReservar.POST(new Request("https://simexperience.com.ar/api/mensualidades/reservar", {
      method: "POST",
      headers: { ...H, "x-real-ip": `10.61.0.${++ip}`, "content-type": "application/json", origin: "https://simexperience.com.ar" },
      body: JSON.stringify({ acepto_condiciones: true, idempotency_key: `b6-${randomUUID().replace(/-/g, "")}`, ...body }),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const filaRpc = (a: Record<string, unknown>) => ({
    data: [{ reserva_id: 99, referencia_publica: "RES-TEST-B6ZZ", minutos_consumidos: Number(a.p_duracion) * (a.p_simuladores as unknown[]).length,
      saldo_anterior: 60, saldo_posterior: 60 - Number(a.p_duracion) * (a.p_simuladores as unknown[]).length, idempotente: false }],
    error: null,
  });

  {
    // Plan v2: disponibilidad v2 (10/20/30, grilla de 10) sin mirar el reloj.
    reiniciar({ mensualidades: [plan("m-v2", "v2_10", 60)], mensualidad_sesiones: [sesion("m-v2")] });
    let d = await disp(`fecha=${HABIL}`);
    assert.equal(d.status, 200);
    assert.deepEqual([d.body.modalidad, d.body.duracion, d.body.duraciones], ["v2_10", 10, [10, 20, 30]], "sin duración: la primera del plan");
    const horas10 = (d.body.horarios as Array<{ hora: string }>).map((h) => h.hora);
    assert.deepEqual([horas10[0], horas10[1], horas10[horas10.length - 1]], ["10:00", "10:10", "21:50"], "grilla de 10; 10 min termina 22:00");
    d = await disp(`fecha=${HABIL}&duracion=30`);
    const horas30 = (d.body.horarios as Array<{ hora: string }>).map((h) => h.hora);
    assert.equal(horas30[horas30.length - 1], "21:30", "30 min: último inicio 21:30");
    d = await disp(`fecha=${FINDE}&duracion=20`);
    const finde = (d.body.horarios as Array<{ hora: string }>).map((h) => h.hora);
    assert.equal(finde[finde.length - 1], "14:00", "fin de semana: último inicio 14:00");
    // Una duración que el plan no tiene → 409 (pantalla armada con otra modalidad).
    d = await disp(`fecha=${HABIL}&duracion=15`);
    assert.equal(d.status, 409);
    assert.equal(d.body.codigo, "catalogo_actualizado");

    // Reservar v2: RPC v2, sin bloques; la modalidad del cuerpo no manda.
    RESPUESTAS_RPC.crear_reserva_mensualidad_v2 = filaRpc;
    let r = await reservar({ fecha: HABIL, hora: "12:10", duracion_minutos: 20, simuladores: ["Ferrari", "McLaren"], modalidad_vista: "v2_10" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const llamada = rpcs.find((x) => x.fn === "crear_reserva_mensualidad_v2")!;
    assert.ok(llamada && !("p_slots" in llamada.args), "v2 no manda bloques");
    assert.deepEqual([llamada.args.p_duracion, llamada.args.p_hora], [20, "12:10"]);
    assert.equal(r.body.minutos_consumidos, 40, "20 min × 2 sims = 40: el buffer no consume");
    assert.ok(!rpcs.some((x) => x.fn === "crear_reserva_mensualidad"), "nunca la RPC legacy");

    // La pestaña quedó con legacy y el plan ya es v2 → 409, nada creado.
    rpcs.length = 0;
    r = await reservar({ fecha: HABIL, hora: "12:00", duracion_minutos: 15, simuladores: ["Ferrari"], modalidad_vista: "legacy" });
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, "catalogo_actualizado");
    assert.equal(rpcs.length, 0, "no se llamó a ninguna RPC");
    // Sin modalidad_vista (cliente viejo) = vio legacy → también 409.
    r = await reservar({ fecha: HABIL, hora: "12:00", duracion_minutos: 15, simuladores: ["Ferrari"] });
    assert.equal(r.status, 409);
    // Plan v2 con 15 min aunque diga v2 → 422 duración.
    r = await reservar({ fecha: HABIL, hora: "12:00", duracion_minutos: 15, simuladores: ["Ferrari"], modalidad_vista: "v2_10" });
    assert.deepEqual([r.status, r.body.codigo, r.body.error], [422, "duracion_invalida", "Elegí una duración de 10, 20 o 30 minutos."]);
    // El 409 de la RPC (plan cambió entre la lectura y el lock) llega como catalogo_actualizado.
    RESPUESTAS_RPC.crear_reserva_mensualidad_v2 = () => ({ data: null, error: { code: "22023", message: "modalidad_no_corresponde" } });
    r = await reservar({ fecha: HABIL, hora: "12:20", duracion_minutos: 20, simuladores: ["Alpine"], modalidad_vista: "v2_10" });
    assert.deepEqual([r.status, r.body.codigo], [409, "catalogo_actualizado"]);
  }

  {
    // Saldo insuficiente: 10 de saldo, 20 × 1 → 422 con saldo y faltan; nada de MP.
    reiniciar({ mensualidades: [plan("m-v2", "v2_10", 10)], mensualidad_sesiones: [sesion("m-v2")] });
    const r = await reservar({ fecha: HABIL, hora: "12:00", duracion_minutos: 20, simuladores: ["Ferrari"], modalidad_vista: "v2_10" });
    assert.deepEqual([r.status, r.body.codigo, r.body.saldo_minutos, r.body.minutos_faltantes], [422, "saldo_insuficiente", 10, 10]);
    assert.equal(rpcs.filter((x) => x.fn.startsWith("crear_reserva")).length, 0, "no se intenta la reserva");
    assert.equal(prefs.length, 0, "no existe pago de diferencia: 0 Checkout Pro");
  }

  {
    // Legacy + v2 en la misma agenda: legacy 30 min a las 13:00 (bloques 13:00 y
    // 13:20 → ocupa 13:00–13:40) en Ferrari. v2 20 min a las 13:20 (13:20–13:50):
    // Ferrari choca, McLaren no.
    reiniciar({
      mensualidades: [plan("m-v2", "v2_10", 60)], mensualidad_sesiones: [sesion("m-v2")],
      reservas: [{ id: 501, fecha: HABIL, hora: "13:00", duracion_minutos: 30, simuladores: ["Ferrari"], estado: "activa", created_at: "2026-09-01T00:00:00Z", modalidad: null, origen: "web" }],
      reserva_slots: [
        { reserva_id: 501, fecha: HABIL, hora: "13:00", simulador: "Ferrari", estado: "activa", ocupacion_min: null },
        { reserva_id: 501, fecha: HABIL, hora: "13:20", simulador: "Ferrari", estado: "activa", ocupacion_min: null },
      ],
    });
    RESPUESTAS_RPC.crear_reserva_mensualidad_v2 = filaRpc;
    let r = await reservar({ fecha: HABIL, hora: "13:20", duracion_minutos: 20, simuladores: ["Ferrari"], modalidad_vista: "v2_10" });
    assert.deepEqual([r.status, r.body.codigo], [409, "turno_ocupado"], "mismo recurso: conflicto");
    r = await reservar({ fecha: HABIL, hora: "13:20", duracion_minutos: 20, simuladores: ["McLaren"], modalidad_vista: "v2_10" });
    assert.equal(r.status, 201, "otro recurso libre: permitido");
    // Y un v2 existente (13:40 + 30) le tapa a Ferrari el inicio 13:40 a un plan LEGACY.
    TABLAS.reserva_slots.push({ reserva_id: 502, fecha: HABIL, hora: "14:00", simulador: "Alpine", estado: "activa", ocupacion_min: 30 });
    TABLAS.mensualidades = [plan("m-leg", null, 60)];
    TABLAS.mensualidad_sesiones = [sesion("m-leg")];
    const d = await disp(`fecha=${HABIL}&duracion=15`);
    assert.equal(d.body.modalidad, "legacy");
    const h1400 = (d.body.horarios as Array<{ hora: string; simuladores: string[] }>).find((h) => h.hora === "14:00");
    assert.ok(h1400 && !h1400.simuladores.includes("Alpine"), "la ocupación v2 (14:00–14:30) tapa el bloque legacy de 14:00");
    const h1420 = (d.body.horarios as Array<{ hora: string; simuladores: string[] }>).find((h) => h.hora === "14:20");
    assert.ok(h1420 && !h1420.simuladores.includes("Alpine"), "y el de 14:20 también (el v2 termina 14:30)");
    const h1440 = (d.body.horarios as Array<{ hora: string; simuladores: string[] }>).find((h) => h.hora === "14:40");
    assert.ok(h1440 && h1440.simuladores.includes("Alpine"), "14:40 queda libre");
  }

  {
    // Plan legacy: RPC legacy con sus bloques de 20; 10/20 rechazados.
    reiniciar({ mensualidades: [plan("m-leg", null, 60)], mensualidad_sesiones: [sesion("m-leg")] });
    RESPUESTAS_RPC.crear_reserva_mensualidad = filaRpc;
    let r = await reservar({ fecha: HABIL, hora: "12:00", duracion_minutos: 45, simuladores: ["Ferrari"], modalidad_vista: "legacy" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const l = rpcs.find((x) => x.fn === "crear_reserva_mensualidad")!;
    assert.deepEqual(l.args.p_slots, ["12:00", "12:20", "12:40"], "45 min legacy = 3 bloques de 20");
    r = await reservar({ fecha: HABIL, hora: "12:00", duracion_minutos: 20, simuladores: ["Ferrari"], modalidad_vista: "legacy" });
    assert.deepEqual([r.status, r.body.codigo], [422, "duracion_invalida"]);
    // El plan legacy sigue legacy después del corte: la disponibilidad no mira el reloj.
    const d = await disp(`fecha=${HABIL}`);
    assert.deepEqual([d.body.modalidad, d.body.duracion, d.body.duraciones], ["legacy", 15, [15, 30, 45, 60]]);
    const horas = (d.body.horarios as Array<{ hora: string }>).map((h) => h.hora);
    assert.deepEqual(horas.slice(0, 3), ["10:00", "10:20", "10:40"], "grilla de 20");
  }

  {
    // Reprogramar: la RESERVA conserva su modalidad aunque el plan haya renovado.
    reiniciar({
      mensualidades: [plan("m-v2", "v2_10", 60)], mensualidad_sesiones: [sesion("m-v2")],
      reservas: [{ id: 601, referencia_publica: "RES-LEGA-CY22", mensualidad_id: "m-v2", origen: "mensualidad", estado: "activa",
        fecha: HABIL, hora: "15:00", duracion_minutos: 30, simuladores: ["Ferrari"], created_at: "2026-09-29T00:00:00Z", modalidad: "legacy" }],
      reserva_slots: [
        { reserva_id: 601, fecha: HABIL, hora: "15:00", simulador: "Ferrari", estado: "activa", ocupacion_min: null },
        { reserva_id: 601, fecha: HABIL, hora: "15:20", simulador: "Ferrari", estado: "activa", ocupacion_min: null },
      ],
    });
    const d = await disp(`fecha=${HABIL}&referencia=RES-LEGA-CY22`);
    assert.deepEqual([d.body.modalidad, d.body.duracion], ["legacy", 30], "legacy con su duración");
    const h1500 = (d.body.horarios as Array<{ hora: string; simuladores: string[] }>).find((h) => h.hora === "15:00");
    assert.ok(h1500?.simuladores.includes("Ferrari"), "su propio lugar le sirve (se excluye de la ocupación)");
    const ajena = await disp(`fecha=${HABIL}&referencia=RES-AJEN-A222`);
    assert.equal(ajena.status, 404, "una referencia ajena o inexistente: 404");

    const gestion = await import("@/lib/mensualidadesGestionReserva");
    RESPUESTAS_RPC.reprogramar_reserva_mensualidad = (a) => ({ data: [{ reserva_id: 601, referencia_publica: a.p_referencia, fecha: a.p_fecha, hora: a.p_hora, duracion_minutos: 30, minutos_consumidos: 30, sin_cambios: false }], error: null });
    RESPUESTAS_RPC.reprogramar_reserva_mensualidad_v2 = RESPUESTAS_RPC.reprogramar_reserva_mensualidad;
    rpcs.length = 0;
    let g = await gestion.reprogramarReserva("m-v2", "RES-LEGA-CY22", HABIL, "16:20", "b6-repro-0123456789abcdef");
    assert.ok(g.ok, JSON.stringify(g));
    assert.equal(rpcs[0].fn, "reprogramar_reserva_mensualidad", "legacy se mueve con la RPC legacy");
    assert.deepEqual(rpcs[0].args.p_slots, ["16:20", "16:40"]);
    g = await gestion.reprogramarReserva("m-v2", "RES-LEGA-CY22", HABIL, "16:10", "b6-repro-1123456789abcdef");
    assert.ok(!g.ok && g.codigo === "hora_invalida", "y con la grilla de 20");
    // Una v2 se mueve con la RPC v2 y la grilla de 10.
    TABLAS.reservas[0].modalidad = "v2_10"; TABLAS.reservas[0].duracion_minutos = 20;
    rpcs.length = 0;
    g = await gestion.reprogramarReserva("m-v2", "RES-LEGA-CY22", HABIL, "16:10", "b6-repro-2123456789abcdef");
    assert.ok(g.ok, JSON.stringify(g));
    assert.equal(rpcs[0].fn, "reprogramar_reserva_mensualidad_v2");
    assert.ok(!("p_slots" in rpcs[0].args));
  }

  // ── 5. Panel: ajuste de saldo en múltiplos de 5 y alta con modalidad ───────
  {
    reiniciar();
    RESPUESTAS_RPC.mensualidad_admin_ajustar_saldo = (a) => ({ data: [{ saldo_anterior: 60, saldo_posterior: 60 + Number(a.p_minutos), minutos_aplicados: a.p_minutos, estado_resultante: "vigente", idempotente: false }], error: null });
    const CTX = { actor: "admin", rol: "admin" as const, idempotencyKey: "b6-ajuste-0123456789abcdef" };
    for (const m of [5, 10, 15, 35]) {
      for (const op of ["agregar", "descontar"] as const) {
        const r = await acciones.ajustarSaldo("m1", op, m, "ajuste B6", CTX);
        assert.ok(r.ok, `${op} ${m} aceptado`);
      }
    }
    const codigo = async (p: Promise<unknown>) => { const r = await p as { ok: boolean; codigo?: string }; return r.ok ? "ok" : r.codigo; };
    assert.equal(await codigo(acciones.ajustarSaldo("m1", "agregar", 7, "m", CTX)), "minutos_no_multiplo_5");
    assert.equal(await codigo(acciones.ajustarSaldo("m1", "agregar", 12.5, "m", CTX)), "minutos_invalidos");
    assert.equal(await codigo(acciones.ajustarSaldo("m1", "agregar", 10, "   ", CTX)), "motivo_requerido");
    // El saldo negativo lo rechaza la RPC (la autoridad): se traduce.
    RESPUESTAS_RPC.mensualidad_admin_ajustar_saldo = () => ({ data: null, error: { message: "saldo_insuficiente" } });
    assert.equal(await codigo(acciones.ajustarSaldo("m1", "descontar", 500, "m", CTX)), "saldo_insuficiente");

    // Alta del panel después del corte: RPC v2 con modalidad y precio de la versión.
    RESPUESTAS_RPC.mensualidad_admin_alta_v2 = () => ({ data: [{ compra_id: "c", mensualidad_id: "m", codigo: "MEN-TEST-B6ZZ", tipo: "alta", canal: "admin_venta", minutos_plan: 60, saldo_anterior: 0, saldo_posterior: 60, vence_anterior: null, vence_el: "2026-10-31", codigo_conservado: false, importe_bruto: 38000, comision: 0, importe_neto: 38000, idempotente: false }], error: null });
    const catalogo = await comercial.catalogoMensualidadesPara("v2_10", DESPUES);
    const v = alta.validarAlta({ nombre: "T", apellido: "B6", telefono: "3510000000", email: "b6@test.local", plan_slug: "1h", modalidad: "venta", medio_pago: "efectivo", motivo: "venta mostrador", declaracion: true });
    assert.ok(v.ok);
    const r = await alta.registrarAltaAdministrativa(v.ok ? v.data : (null as never), { actor: "admin", rol: "admin", idempotencyKey: "b6-alta-0123456789abcdef", catalogo });
    assert.ok(r.ok);
    const a = rpcs.find((x) => x.fn === "mensualidad_admin_alta_v2")!;
    assert.deepEqual([a.args.p_modalidad_comercial, a.args.p_precio, a.args.p_plan_slug], ["v2_10", 38000, "1h"]);
    assert.ok(!rpcs.some((x) => x.fn === "mensualidad_admin_alta"), "la alta legacy ya no se llama");
    // Formulario viejo del panel (vio legacy) después del corte → 409 sin escribir.
    const stale = await comercial.catalogoParaCrear({ modalidad_vista: "legacy" }, { ahora: DESPUES, mensaje: comercial.MENSAJE_MENSUALIDADES_ACTUALIZADAS_ADMIN });
    assert.ok(!stale.ok && stale.status === 409);
  }

  // ── 6. Guardas de fuente ───────────────────────────────────────────────────
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    assert.match(leer("lib/mensualidadesPago.ts"), /const esperado = Number\(compra\.plan_precio\)/, "el webhook valida contra el snapshot");
    assert.match(leer("app/mensualidades/page.tsx"), /export const dynamic = "force-dynamic"/);
    assert.match(leer("app/mensualidades/page.tsx"), /catalogoMensualidadesVigente\(\)/, "la landing resuelve el catálogo por request");
    assert.match(leer("app/api/mensualidades/catalogo/route.ts"), /no-store/);
    assert.match(leer("app/api/mensualidades/catalogo/route.ts"), /export const dynamic = "force-dynamic"/);
    // Sin comentarios: M8B.1.1 explica el ancho de "$100.000" en uno, y eso no
    // es un precio escrito en el código.
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    for (const f of ["app/mensualidades/CompraMensualidad.tsx", "app/mensualidades/page.tsx", "app/mensualidades/reservar/ReservarConMensualidad.tsx"]) {
      assert.ok(!/\b(30000|55000|100000|38000|70000|128000|30\.000|55\.000|100\.000|38\.000|70\.000|128\.000)\b/.test(sinComentarios(leer(f))), `${f}: sin precios escritos a mano`);
    }
    assert.match(leer("app/mensualidades/CompraMensualidad.tsx"), /modalidad_vista: catalogo\.modalidad/);
    assert.match(leer("app/mensualidades/reservar/ReservarConMensualidad.tsx"), /modalidad_vista: disp\?\.modalidad/);
    // No existe pago de diferencia: ninguna ruta de Mensualidades crea preferencias salvo la compra.
    const conPreferencia = ["app/api/mensualidades/reservar/route.ts", "app/api/mensualidades/disponibilidad/route.ts",
      "lib/mensualidadesReserva.ts", "lib/mensualidadesAgenda.ts"].filter((f) => /Preference/.test(leer(f)));
    assert.deepEqual(conPreferencia, [], "reservar con saldo nunca crea un Checkout Pro");
    // Las RPC legacy siguen existiendo y siguen siendo las de los planes legacy.
    assert.match(leer("lib/mensualidadesReserva.ts"), /rpc\("crear_reserva_mensualidad", \{/);
    assert.match(leer("lib/mensualidadesReserva.ts"), /rpc\("crear_reserva_mensualidad_v2", \{/);
  }

  console.log("mensualidadesB6.test.ts OK — precios versionados en el corte, 409 stale, snapshot en reintento y pago tardío, reservas por modalidad del plan (legacy/v2, grilla, buffer sin saldo, agenda mixta), reprogramación por modalidad de la reserva, ajuste %5 y alta del panel con modalidad.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
