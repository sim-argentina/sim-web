// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS } from "@/lib/modalidadComercial";
import { CATALOGO_ACTUALIZADO } from "@/lib/catalogoComercial";
import { GIFT_CARD_VIGENCIA_DIAS, productoGiftCardDe, productosGiftCardDe } from "@/lib/giftCards";
import {
  MENSAJE_GIFT_CARDS_ACTUALIZADAS, MENSAJE_GIFT_CARDS_ACTUALIZADAS_ADMIN, catalogoGiftCardsVigente,
  modalidadParaNuevaGiftCard,
} from "@/lib/giftCardsComercial";

// Gift Cards 10/20/30 por modalidad (Bloque B5).
// Ejecutar: npx tsx --env-file=.env.local lib/giftCardsComercial.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA (con los
// CHECK y el UNIQUE de gift_cards simulados), `fetch` queda bloqueado (ni
// Upstash, ni Mercado Pago, ni Supabase), la preferencia y la consulta de pago
// de Mercado Pago se interceptan, el reloj se inyecta y la sesión admin y la
// firma del webhook se hacen con secretos DESCARTABLES generados acá. Las rutas
// se prueban de verdad: compra web, alta del panel, webhook, canje, renovación
// y archivado.

// ── Base en memoria ─────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type ErrorDb = { code?: string; message: string };
type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Resultado = { data: unknown; error: ErrorDb | null; count: number | null };

const TABLAS: Record<string, Fila[]> = {};
const operaciones: string[] = [];
const GC = "gift_cards";

const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clonar = (f: Fila): Fila => JSON.parse(JSON.stringify(f));

function reiniciar(filas: Record<string, Fila[]> = {}) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  for (const [k, v] of Object.entries(filas)) TABLAS[k] = v.map(clonar);
  TABLAS.modalidad_comercial_config ??= [
    { id: 1, modalidad_override: null, motivo: null, actualizado_por: null, updated_at: null },
  ];
  operaciones.length = 0;
}
/** Override de ESTA base falsa (nunca el de producción). */
function override(valor: "legacy" | "v2_10" | null) {
  tabla("modalidad_comercial_config")[0].modalidad_override = valor;
}
const escrituras = () => operaciones.filter((o) => !o.startsWith("select:"));

// Los CHECK reales de gift_cards (canal y coherencia del cobro, estados) y el
// UNIQUE(codigo_unico).
function violaChecks(t: string, f: Fila, existentes: Fila[], propia: Fila = f): ErrorDb | null {
  if (t !== GC) return null;
  const chk = (code: string, message: string) => ({ code, message });
  if (!["web", "admin"].includes(String(f.canal))) return chk("23514", "gift_cards_canal_chk");
  if (f.canal === "web" && (f.medio_pago != null || f.procesador != null || f.registrado_por != null)) {
    return chk("23514", "gift_cards_canal_coherencia_chk (web)");
  }
  if (f.canal === "admin") {
    const conPosnet = ["qr", "debito", "credito"].includes(String(f.medio_pago));
    if (f.medio_pago == null || (f.procesador != null) !== conPosnet || f.mercado_pago_payment_id != null || f.mercado_pago_preference_id != null) {
      return chk("23514", "gift_cards_canal_coherencia_chk (admin)");
    }
  }
  if (!["pendiente_pago", "pagado", "rechazado", "cancelado"].includes(String(f.estado_pago))) return chk("23514", "estado_pago");
  if (!["pendiente", "lista", "usada", "vencida", "cancelada"].includes(String(f.estado_uso))) return chk("23514", "estado_uso");
  if (!["juntas", "separadas"].includes(String(f.modo_uso))) return chk("23514", "modo_uso");
  if (existentes.some((e) => e !== propia && e.codigo_unico === f.codigo_unico)) return chk("23505", "gift_cards_codigo_unico_key");
  return null;
}
const defaults = (t: string): Fila =>
  t === GC
    ? {
      id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      destinatario_nombre: null, estado_pago: "pendiente_pago", estado_uso: "pendiente",
      mercado_pago_payment_id: null, mercado_pago_preference_id: null, fecha_pago: null, fecha_uso: null,
      observaciones: null, codigo_descuento: null, monto_original: null, descuento_aplicado: 0, cantidad: 1,
      modo_uso: "separadas", grupo_compra_id: null, usos_totales: 1, usos_disponibles: 1, fecha_vencimiento: null,
      deleted_at: null, deleted_by: null, canal: "web", medio_pago: null, procesador: null, registrado_por: null,
    }
    : { id: randomUUID(), created_at: new Date().toISOString() };

class Consulta implements PromiseLike<Resultado> {
  private op: Op = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private valores: Fila | Fila[] | null = null;
  private conflicto: string | null = null;
  private devolver = false;
  private uno: "single" | "maybe" | null = null;
  private orden: { col: string; asc: boolean } | null = null;
  constructor(private readonly t: string) {}

  select() { if (this.op !== "select") this.devolver = true; return this; }
  insert(v: Fila | Fila[]) { this.op = "insert"; this.valores = v; return this; }
  update(v: Fila) { this.op = "update"; this.valores = v; return this; }
  upsert(v: Fila | Fila[], opts?: { onConflict?: string }) {
    this.op = "upsert"; this.valores = v; this.conflicto = opts?.onConflict ?? "id"; return this;
  }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filtros.push((f) => vs.includes(f[c])); return this; }
  is(c: string, v: null) { this.filtros.push((f) => (f[c] ?? null) === v); return this; }
  not(c: string, op: string, v: null) {
    if (op !== "is") throw new Error(`not(${op}) no soportado`);
    this.filtros.push((f) => (f[c] ?? null) !== v);
    return this;
  }
  gte(c: string, v: string) { this.filtros.push((f) => String(f[c]) >= v); return this; }
  lt(c: string, v: string) { this.filtros.push((f) => String(f[c]) < v); return this; }
  ilike(c: string, patron: string) {
    const re = new RegExp(`^${patron.replace(/%/g, ".*")}$`, "i");
    this.filtros.push((f) => re.test(String(f[c] ?? "")));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orden = { col, asc: opts?.ascending !== false }; return this; }
  single() { this.uno = "single"; return this; }
  maybeSingle() { this.uno = "maybe"; return this; }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(ok, ko);
  }

  private forma(filas: Fila[] | null): Resultado {
    if (this.uno === null) return { data: filas, error: null, count: null };
    const lista = filas ?? [];
    if (this.uno === "single" && lista.length !== 1) return { data: null, error: { code: "PGRST116", message: "no es una fila" }, count: null };
    if (lista.length > 1) return { data: null, error: { code: "PGRST116", message: "más de una fila" }, count: null };
    return { data: lista[0] ?? null, error: null, count: null };
  }

  private ejecutar(): Resultado {
    operaciones.push(`${this.op}:${this.t}`);
    const filas = tabla(this.t);
    const coincide = (f: Fila) => this.filtros.every((fn) => fn(f));
    const lista = Array.isArray(this.valores) ? this.valores : this.valores ? [this.valores] : [];
    switch (this.op) {
      case "select": {
        let out = filas.filter(coincide);
        if (this.orden) {
          const { col, asc } = this.orden;
          out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        return this.forma(out.map(clonar));
      }
      case "insert": {
        const nuevas = lista.map((v) => ({ ...defaults(this.t), ...clonar(v) }));
        const todas = [...filas, ...nuevas];
        for (const n of nuevas) {
          const err = violaChecks(this.t, n, todas);
          if (err) return { data: null, error: err, count: null };
        }
        filas.push(...nuevas);
        return this.forma(this.devolver ? nuevas.map(clonar) : null);
      }
      case "upsert": {
        const c = this.conflicto as string;
        const out: Fila[] = [];
        for (const v of lista) {
          const existente = filas.find((f) => f[c] === v[c]);
          if (existente) Object.assign(existente, clonar(v));
          else filas.push({ ...defaults(this.t), ...clonar(v) });
          out.push(clonar(existente ?? filas[filas.length - 1]));
        }
        return this.forma(this.devolver ? out : null);
      }
      case "update": {
        const afectadas = filas.filter(coincide);
        for (const f of afectadas) {
          const err = violaChecks(this.t, { ...f, ...(this.valores as Fila) }, filas, f);
          if (err) return { data: null, error: err, count: null };
        }
        for (const f of afectadas) Object.assign(f, clonar(this.valores as Fila));
        return this.forma(this.devolver ? afectadas.map(clonar) : null);
      }
      case "delete": {
        TABLAS[this.t] = filas.filter((f) => !coincide(f));
        return { data: null, error: null, count: null };
      }
    }
  }
}

const rpcs: string[] = [];
const cliente = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (fn: string, a?: Record<string, unknown>) => unknown };
cliente.from = (t: string) => new Consulta(t);
cliente.rpc = (fn: string, args: Record<string, unknown> = {}) => {
  rpcs.push(fn);
  if (fn === "consumir_codigo_descuento") {
    const c = tabla("codigos_descuento").find((x) => x.codigo === args.p_codigo);
    const agotado = c && c.usos_maximos != null && Number(c.usos_actuales ?? 0) >= Number(c.usos_maximos);
    if (!c || !c.activo || agotado) return Promise.resolve({ data: false, error: null });
    c.usos_actuales = Number(c.usos_actuales ?? 0) + 1;
    return Promise.resolve({ data: true, error: null });
  }
  throw new Error(`el test no espera la RPC ${fn}`);
};

// Nada sale a la red.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`el test no usa la red (${String(input).slice(0, 30)}…)`);
}) as typeof fetch;

// ── Reloj y datos ───────────────────────────────────────────────────────────
/** 30/09/2026 23:59:59.999 ART. */
const ANTES = new Date(CORTE_MODALIDAD_V2_MS - 1);
/** 01/10/2026 00:00:00.000 ART: el corte. */
const CORTE = new Date(CORTE_MODALIDAD_V2_MS);
const DESPUES = new Date(CORTE_MODALIDAD_V2_MS + 60 * 60_000);
const DIA_MS = 24 * 60 * 60 * 1000;

const comprador = (extra: Record<string, unknown> = {}) => ({
  comprador_nombre: "Prueba B5",
  comprador_telefono: "3510000000",
  destinatario_nombre: "Destino B5",
  cantidad: 1,
  modo_uso: "separadas",
  ...extra,
});

const venceA30Dias = (f: Fila) =>
  Date.parse(String(f.fecha_vencimiento)) - Date.parse(String(f.fecha_pago)) === GIFT_CARD_VIGENCIA_DIAS * DIA_MS;

async function main() {
  // ── 1. Catálogo y corte exacto ────────────────────────────────────────────
  {
    reiniciar();
    const a = await catalogoGiftCardsVigente(ANTES);
    assert.equal(a.modalidad, "legacy", "23:59:59.999 → legacy");
    assert.deepEqual(a.productos.map((p) => [p.duracion, p.monto]), [[15, 12000], [30, 20000]]);
    assert.deepEqual(a.productos.map((p) => p.descripcion), [
      "Una sesión de simulador de Fórmula 1 de 15 minutos.",
      "Una sesión doble de 30 minutos (dos turnos consecutivos).",
    ], "legacy: los textos de siempre");
    assert.equal(a.vigencia_dias, 30);
    assert.equal(a.max_cantidad, 10);

    const v = await catalogoGiftCardsVigente(CORTE);
    assert.equal(v.modalidad, "v2_10", "00:00:00.000 → v2_10");
    assert.deepEqual(v.productos.map((p) => [p.duracion, p.monto]), [[10, 10000], [20, 17000], [30, 23000]]);
    assert.deepEqual(v.productos.map((p) => p.titulo), ["Gift Card · 10 min", "Gift Card · 20 min", "Gift Card · 30 min"]);
    for (const p of v.productos) {
      assert.ok(!/dos turnos|15 minutos|15 y 30/.test(p.descripcion), `v2 no habla de la grilla vieja: ${p.descripcion}`);
    }
    assert.equal(v.vigencia_dias, 30, "la vigencia no cambia");

    override("legacy");
    assert.equal((await catalogoGiftCardsVigente(DESPUES)).modalidad, "legacy", "rollback: override legacy");
    override("v2_10");
    assert.equal((await catalogoGiftCardsVigente(ANTES)).modalidad, "v2_10", "contingencia: override v2");

    // La modalidad para CREAR: 409 si la pestaña vio otro catálogo.
    reiniciar();
    const web = { mensaje: MENSAJE_GIFT_CARDS_ACTUALIZADAS };
    let m = await modalidadParaNuevaGiftCard({ modalidad_vista: "legacy" }, { ...web, ahora: ANTES });
    assert.ok(m.ok && m.modalidad === "legacy");
    m = await modalidadParaNuevaGiftCard({}, { ...web, ahora: ANTES });
    assert.ok(m.ok && m.modalidad === "legacy", "un cliente anterior a B5 vio legacy");
    for (const [body, ahora, caso] of [
      [{ modalidad_vista: "legacy" }, CORTE, "pestaña legacy a las 00:00"],
      [{}, CORTE, "cliente viejo a las 00:00"],
      [{ modalidad_vista: "v2_10" }, ANTES, "no se fuerza v2 antes del corte"],
    ] as const) {
      const r = await modalidadParaNuevaGiftCard(body, { ...web, ahora });
      assert.ok(!r.ok && r.status === 409 && r.codigo === CATALOGO_ACTUALIZADO.codigo, caso);
      assert.equal(!r.ok && r.error, MENSAJE_GIFT_CARDS_ACTUALIZADAS);
    }
    const inventada = await modalidadParaNuevaGiftCard({ modalidad_vista: "v3" }, { ...web, ahora: CORTE });
    assert.ok(!inventada.ok && inventada.status === 400, "modalidad inventada → 400");
    assert.equal(MENSAJE_GIFT_CARDS_ACTUALIZADAS, "Actualizamos nuestras Gift Cards y precios. Revisá las nuevas opciones para continuar.");
    assert.equal(MENSAJE_GIFT_CARDS_ACTUALIZADAS_ADMIN, "Cambió la modalidad comercial. Revisá las nuevas Gift Cards antes de registrar la venta.");

    // Productos por modalidad: 15 no existe en v2 ni 10/20 en legacy.
    assert.equal(productoGiftCardDe("v2_10", 15), null);
    assert.equal(productoGiftCardDe("legacy", 10), null);
    assert.equal(productoGiftCardDe("legacy", 20), null);
    assert.equal(productoGiftCardDe("v2_10", 20)?.monto, 17000);
  }

  // ── Rutas reales (con secretos descartables) ──────────────────────────────
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) {
    delete process.env[k];
  }
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-B5-SIN-RED";
  process.env.NEXT_PUBLIC_BASE_URL = "https://b5.invalid";
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  const SECRETO_WEBHOOK = randomBytes(24).toString("hex");
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO_WEBHOOK;

  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: {
      cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }),
    },
  } as unknown as NodeJS.Module;

  const { Preference, Payment } = await import("mercadopago");
  const preferencias: Array<{ body: { items: Array<{ unit_price: number; title: string }>; external_reference: string } }> = [];
  (Preference.prototype as unknown as { create: (a: unknown) => Promise<unknown> }).create = async (a: unknown) => {
    preferencias.push(a as (typeof preferencias)[number]);
    return { id: `pref-${preferencias.length}`, init_point: "https://b5.invalid/pagar", sandbox_init_point: null };
  };
  const pagosMp: Record<string, Record<string, unknown>> = {};
  (Payment.prototype as unknown as { get: (a: { id: string }) => Promise<unknown> }).get = async ({ id }: { id: string }) => {
    const p = pagosMp[String(id)];
    if (!p) throw new Error(`pago ${id} desconocido`);
    return p;
  };

  const { createSessionToken } = await import("@/lib/adminSession");
  const tokenAdmin = await createSessionToken("admin");
  const tokenStaff = await createSessionToken("staff");
  const rutaPref = await import("@/app/api/gift-cards/preference/route");
  const rutaCat = await import("@/app/api/gift-cards/catalogo/route");
  const rutaAdmin = await import("@/app/api/admin/gift-cards/route");
  const rutaAdminId = await import("@/app/api/admin/gift-cards/[id]/route");
  const rutaWebhook = await import("@/app/api/gift-cards/webhook/route");

  const ORIGEN = "https://simexperience.com.ar";
  let ip = 0;
  const post = (ruta: string, body: unknown, origin = ORIGEN) =>
    new Request(`${ORIGEN}${ruta}`, {
      method: "POST", headers: { "content-type": "application/json", origin, "x-real-ip": `10.5.0.${++ip}` },
      body: JSON.stringify(body),
    });
  const gcs = () => tabla(GC);
  const grupo = (g: string) => gcs().filter((f) => f.grupo_compra_id === g);

  // ── 2. Catálogo público: sin caché, sin PII ───────────────────────────────
  {
    reiniciar();
    override("v2_10");
    assert.equal(rutaCat.dynamic, "force-dynamic");
    const res = await rutaCat.GET(new Request(`${ORIGEN}/api/gift-cards/catalogo`, { headers: { "x-real-ip": "10.6.0.1" } }));
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    const json = await res.json();
    assert.equal(json.modalidad, "v2_10");
    assert.deepEqual(json.productos.map((p: { duracion: number }) => p.duracion), [10, 20, 30]);
    assert.deepEqual(Object.keys(json).sort(), ["max_cantidad", "modalidad", "productos", "resuelto_en", "vigencia_dias"]);
  }

  // ── 3. Compra web: legacy exacta, v2 con precio del servidor ──────────────
  {
    reiniciar();
    override("legacy");
    let res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 30, modalidad_vista: "legacy", monto: 1, precio: 1 })));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    let json = await res.json();
    let filas = grupo(json.grupo_compra_id);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].duracion_minutos, 30);
    assert.equal(filas[0].monto, 20000, "legacy 30 = $20.000, el monto del cuerpo se ignora");
    assert.equal(filas[0].estado_pago, "pendiente_pago");
    assert.equal(filas[0].canal, "web");
    assert.equal(preferencias.at(-1)?.body.items[0].unit_price, 20000);
    assert.equal(preferencias.at(-1)?.body.external_reference, `gift_card_${json.grupo_compra_id}`);
    res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 15 })));
    json = await res.json();
    assert.equal(grupo(json.grupo_compra_id)[0].monto, 12000, "legacy 15 = $12.000 (cliente sin modalidad_vista)");

    override("v2_10");
    for (const [d, precio] of [[10, 10000], [20, 17000], [30, 23000]]) {
      res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: d, modalidad_vista: "v2_10", monto: 1 })));
      assert.equal(res.status, 200);
      json = await res.json();
      filas = grupo(json.grupo_compra_id);
      assert.equal(filas[0].duracion_minutos, d, "minutos COMERCIALES: nada de buffer");
      assert.equal(filas[0].monto, precio, `v2 ${d} = ${precio}`);
      assert.equal(preferencias.at(-1)?.body.items[0].unit_price, precio);
      assert.ok(preferencias.at(-1)?.body.items[0].title.includes(`${d} min`));
    }
    // Separadas: una fila por Gift Card; juntas: una fila con N usos.
    res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 20, cantidad: 3, modo_uso: "separadas", modalidad_vista: "v2_10" })));
    json = await res.json();
    filas = grupo(json.grupo_compra_id);
    assert.deepEqual(filas.map((f) => [f.monto, f.usos_totales, f.modo_uso]), [[17000, 1, "separadas"], [17000, 1, "separadas"], [17000, 1, "separadas"]]);
    assert.equal(new Set(filas.map((f) => f.codigo_unico)).size, 3, "un código por Gift Card");
    assert.equal(preferencias.at(-1)?.body.items[0].unit_price, 51000);
    res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 10, cantidad: 2, modo_uso: "juntas", modalidad_vista: "v2_10" })));
    json = await res.json();
    filas = grupo(json.grupo_compra_id);
    assert.deepEqual(filas.map((f) => [f.monto, f.monto_original, f.usos_totales, f.usos_disponibles, f.cantidad]), [[20000, 20000, 2, 2, 2]]);

    // Duración de la otra modalidad → 400, nada creado.
    const antes = gcs().length;
    res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 15, modalidad_vista: "v2_10" })));
    assert.equal(res.status, 400);
    assert.equal(gcs().length, antes);
  }

  // ── 4. Pestaña vieja (web): 409 y nada creado ─────────────────────────────
  {
    reiniciar();
    override("v2_10");
    const prefAntes = preferencias.length;
    for (const body of [
      comprador({ duracion_minutos: 30, modalidad_vista: "legacy" }),
      comprador({ duracion_minutos: 30 }),
    ]) {
      const res = await rutaPref.POST(post("/api/gift-cards/preference", body));
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.codigo, "catalogo_actualizado");
      assert.equal(json.error, MENSAJE_GIFT_CARDS_ACTUALIZADAS);
    }
    assert.deepEqual(escrituras(), [], "0 gift_cards, 0 fin_pagos_web, 0 Finanzas");
    assert.equal(preferencias.length, prefAntes, "0 preferencias");
    const res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 30, modalidad_vista: "v3" })));
    assert.equal(res.status, 400, "modalidad inventada");
    assert.equal((await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 30 }), "https://otro.example"))).status, 403);
    assert.deepEqual(escrituras(), []);
  }

  // ── 5. 100% bonificada: catálogo al crear, pagada y 30 días ───────────────
  {
    reiniciar({ codigos_descuento: [{
      id: 1, codigo: "B5-GRATIS", activo: true, fecha_inicio: null, fecha_fin: null, usos_maximos: 5, usos_actuales: 0,
      dias_permitidos: null, solo_dias_habiles: false, fechas_bloqueadas: null, duraciones_permitidas: [15],
      tipo_descuento: "porcentaje", valor_descuento: 100,
    }] });
    override("v2_10");
    const prefAntes = preferencias.length;
    const res = await rutaPref.POST(post("/api/gift-cards/preference", comprador({ duracion_minutos: 20, modalidad_vista: "v2_10", codigo_descuento: "B5-GRATIS" })));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const json = await res.json();
    assert.equal(json.free, true);
    const [f] = grupo(json.grupo_compra_id);
    assert.equal(f.duracion_minutos, 20);
    assert.equal(f.monto, 0);
    assert.equal(f.monto_original, 17000);
    assert.equal(f.estado_pago, "pagado");
    assert.ok(venceA30Dias(f), "bonificada: 30 días desde el pago");
    assert.equal(tabla("codigos_descuento")[0].usos_actuales, 1, "el código se consume");
    assert.equal(preferencias.length, prefAntes, "sin Mercado Pago");
    // Gift Cards nunca validó la duración del código (no le pasa duración): no se
    // reinterpreta nada, el código [15] sigue sirviendo igual que antes.
  }

  // ── 6. Alta del panel: mismo catálogo, 409 y medios de pago ───────────────
  {
    const alta = (body: Record<string, unknown>, origin = ORIGEN) => rutaAdmin.POST(post("/api/admin/gift-cards", body, origin));
    const base = (extra: Record<string, unknown>) => comprador({ medio_pago: "efectivo", ...extra });

    reiniciar();
    override("legacy");
    cookie = undefined;
    assert.equal((await alta(base({ duracion_minutos: 15, modalidad_vista: "legacy" }))).status, 401, "sin sesión");
    cookie = tokenStaff;
    assert.equal((await alta(base({ duracion_minutos: 15, modalidad_vista: "legacy" }))).status, 403, "staff no emite");
    cookie = tokenAdmin;
    assert.equal((await alta(base({ duracion_minutos: 15, modalidad_vista: "legacy" }), "https://otro.example")).status, 403, "origen ajeno");
    assert.deepEqual(escrituras(), []);

    let res = await alta(base({ duracion_minutos: 15, modalidad_vista: "legacy", monto: 1, canal: "web" }));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    let json = await res.json();
    let [f] = grupo(json.grupo_compra_id);
    assert.deepEqual([f.duracion_minutos, f.monto, f.canal, f.medio_pago, f.procesador, f.registrado_por], [15, 12000, "admin", "efectivo", null, "admin"]);
    assert.ok(venceA30Dias(f), "manual: 30 días");
    assert.ok(tabla("gift_card_logs").some((l) => l.gift_card_id === f.id), "queda en el historial");

    override("v2_10");
    for (const [d, precio, medio, procesador] of [
      [10, 10000, "efectivo", null], [20, 17000, "transferencia", null], [30, 23000, "qr", "mercado_pago"],
      [30, 23000, "debito", "payway"], [20, 17000, "credito", "mercado_pago"],
    ] as const) {
      res = await alta(base({ duracion_minutos: d, modalidad_vista: "v2_10", medio_pago: medio, procesador: procesador ?? "", monto: 1 }));
      assert.equal(res.status, 200, `${d}/${medio}: ${JSON.stringify(await res.clone().json())}`);
      json = await res.json();
      [f] = grupo(json.grupo_compra_id);
      assert.deepEqual([f.duracion_minutos, f.monto, f.medio_pago, f.procesador], [d, precio, medio, procesador], `v2 manual ${d} ${medio}`);
    }
    // Pestaña vieja del panel: 409 con el mensaje del panel, 0 filas.
    const antes = gcs().length;
    for (const body of [base({ duracion_minutos: 15, modalidad_vista: "legacy" }), base({ duracion_minutos: 30 })]) {
      res = await alta(body);
      assert.equal(res.status, 409);
      json = await res.json();
      assert.equal(json.codigo, "catalogo_actualizado");
      assert.equal(json.error, MENSAJE_GIFT_CARDS_ACTUALIZADAS_ADMIN);
    }
    assert.equal((await alta(base({ duracion_minutos: 30, modalidad_vista: "v3" }))).status, 400, "modalidad inventada");
    assert.equal(gcs().length, antes, "0 filas");
    // Separadas/juntas en el panel, igual que siempre.
    res = await alta(base({ duracion_minutos: 30, cantidad: 2, modo_uso: "juntas", modalidad_vista: "v2_10" }));
    json = await res.json();
    assert.deepEqual(grupo(json.grupo_compra_id).map((x) => [x.monto, x.usos_totales]), [[46000, 2]]);
  }

  // ── 7. Webhook: la fila es la verdad (pago tardío, idempotencia, firma) ───
  {
    const pendiente = (id: string, g: string, d: number, monto: number) => ({
      id, codigo_unico: `SIM-B5${id.slice(0, 2).toUpperCase()}-TEST`, comprador_nombre: "Prueba B5", comprador_telefono: "3510000000",
      duracion_minutos: d, monto, monto_original: monto, estado_pago: "pendiente_pago", estado_uso: "pendiente",
      grupo_compra_id: g, canal: "web", cantidad: 1, usos_totales: 1, usos_disponibles: 1, modo_uso: "separadas",
      created_at: new Date(CORTE_MODALIDAD_V2_MS - 5 * 60_000).toISOString(), // 30/09 23:55 ART
    });
    const gLegacy = randomUUID();
    const gV2 = randomUUID();
    // Creada legacy 30/09 23:55; se paga después del corte (con v2 vigente).
    reiniciar({ [GC]: [pendiente("aa" + randomUUID().slice(2), gLegacy, 30, 20000), pendiente("bb" + randomUUID().slice(2), gV2, 20, 17000)] });
    override("v2_10");
    const firmar = (dataId: string) => {
      const ts = String(Date.now());
      const rid = randomUUID();
      const v1 = createHmac("sha256", SECRETO_WEBHOOK).update(`id:${dataId.toLowerCase()};request-id:${rid};ts:${ts};`).digest("hex");
      return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid };
    };
    const notificar = (paymentId: string, headers?: Record<string, string>) =>
      rutaWebhook.POST(new Request(`${ORIGEN}/api/gift-cards/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": `10.7.0.${++ip}`, ...(headers ?? firmar(paymentId)) },
        body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
      }));
    pagosMp["9001"] = { id: 9001, status: "approved", external_reference: `gift_card_${gLegacy}`, transaction_amount: 20000, currency_id: "ARS", date_approved: new Date(CORTE_MODALIDAD_V2_MS + 5 * 60_000).toISOString() };
    pagosMp["9002"] = { id: 9002, status: "approved", external_reference: `gift_card_${gV2}`, transaction_amount: 17000, currency_id: "ARS", date_approved: DESPUES.toISOString() };

    assert.equal((await notificar("9001", { "x-signature": "ts=1,v1=00", "x-request-id": "x" })).status, 401, "firma inválida");
    assert.deepEqual(escrituras(), [], "sin firma válida no se toca nada");

    let res = await notificar("9001");
    assert.equal(res.status, 200);
    let [f] = grupo(gLegacy);
    assert.deepEqual([f.duracion_minutos, f.monto, f.estado_pago, f.mercado_pago_payment_id], [30, 20000, "pagado", "9001"],
      "pendiente legacy pagada después del corte: sigue 30 min / $20.000");
    assert.ok(venceA30Dias(f), "web: 30 días desde el pago");
    assert.equal(tabla("fin_pagos_web").filter((p) => p.payment_id === "9001").length, 1);
    assert.equal(tabla("fin_pagos_web")[0].producto, "gift_cards");
    const fechaPago = f.fecha_pago;
    // Misma notificación otra vez: nada nuevo.
    res = await notificar("9001");
    assert.equal(res.status, 200);
    [f] = grupo(gLegacy);
    assert.equal(f.fecha_pago, fechaPago, "una sola activación");
    assert.equal(tabla("fin_pagos_web").length, 1, "un solo fin_pagos_web");
    // v2 pagada: 20 / $17.000 tal cual.
    await notificar("9002");
    [f] = grupo(gV2);
    assert.deepEqual([f.duracion_minutos, f.monto, f.estado_pago], [20, 17000, "pagado"]);
    assert.equal(tabla("fin_pagos_web").length, 2);
    assert.ok(!tabla("fin_movimientos").length, "0 fin_movimientos");
  }

  // ── 8. Canje, multiuso, renovación y archivado: todo desde la fila ────────
  {
    const pagada = (d: number, monto: number, usos = 1) => ({
      id: randomUUID(), codigo_unico: `SIM-${randomUUID().slice(0, 4).toUpperCase()}-CANJ`, comprador_nombre: "Prueba B5",
      comprador_telefono: "3510000000", duracion_minutos: d, monto, estado_pago: "pagado", estado_uso: "pendiente", canal: "web",
      cantidad: usos, usos_totales: usos, usos_disponibles: usos, modo_uso: usos > 1 ? "juntas" : "separadas",
      fecha_pago: "2026-10-02T15:00:00.000Z", fecha_vencimiento: "2026-11-01T15:00:00.000Z",
    });
    const cartas = [pagada(15, 12000), pagada(30, 20000), pagada(10, 10000), pagada(20, 17000), pagada(30, 23000), pagada(20, 51000, 3)];
    reiniciar({ [GC]: cartas });
    override("legacy"); // el canje no mira el catálogo: da igual cuál rija
    cookie = tokenStaff; // el canje lo hace también staff
    const patch = (id: string, body: Record<string, unknown>) =>
      rutaAdminId.PATCH(new Request(`${ORIGEN}/api/admin/gift-cards/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json", origin: ORIGEN }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ id }) });
    for (const c of cartas.slice(0, 5)) {
      const res = await patch(String(c.id), { accion: "registrar_uso" });
      assert.equal(res.status, 200, `canje ${c.duracion_minutos}`);
      const f = gcs().find((x) => x.id === c.id)!;
      assert.deepEqual([f.estado_uso, f.usos_disponibles, f.duracion_minutos, f.monto], ["usada", 0, c.duracion_minutos, c.monto],
        `canje ${c.duracion_minutos} min: usada, sin tocar duración ni monto`);
    }
    // Multiuso (juntas, 3 usos de 20): cada canje descuenta uno.
    const multi = cartas[5];
    await patch(String(multi.id), { accion: "registrar_uso" });
    let f = gcs().find((x) => x.id === multi.id)!;
    assert.deepEqual([f.usos_disponibles, f.estado_uso, f.duracion_minutos], [2, "pendiente", 20]);
    // Renovar: solo el vencimiento.
    cookie = tokenAdmin;
    const antes = clonar(f);
    await patch(String(multi.id), { accion: "renovar", fecha_vencimiento: "2026-12-15" });
    f = gcs().find((x) => x.id === multi.id)!;
    assert.equal(f.fecha_vencimiento, "2026-12-15T12:00:00");
    for (const k of ["duracion_minutos", "monto", "usos_totales", "usos_disponibles", "codigo_unico", "estado_pago", "canal"]) {
      assert.deepEqual(f[k], antes[k], `renovar no toca ${k}`);
    }
    // Archivar y restaurar una v2.
    const v2 = cartas[3];
    let res = await rutaAdminId.DELETE(new Request(`${ORIGEN}/api/admin/gift-cards/${v2.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(v2.id) }) });
    assert.equal(res.status, 200);
    assert.ok(gcs().find((x) => x.id === v2.id)!.deleted_at, "archivada");
    res = await patch(String(v2.id), { accion: "restaurar" });
    assert.equal(res.status, 200);
    assert.equal(gcs().find((x) => x.id === v2.id)!.deleted_at, null, "restaurada");
    assert.equal(gcs().find((x) => x.id === v2.id)!.duracion_minutos, 20);
  }

  // ── 9. Guardas de fuente ──────────────────────────────────────────────────
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    // Una Gift Card emitida NUNCA vuelve a mirar el catálogo.
    for (const f of [
      "app/api/gift-cards/webhook/route.ts", "app/api/admin/gift-cards/[id]/route.ts", "components/GiftCardDownloadable.tsx",
      "app/gift-cards/exito/page.tsx", "app/api/gift-cards/grupo/[grupoId]/route.ts", "app/api/gift-cards/[id]/route.ts",
      "app/admin/(panel)/gift-cards/page.tsx",
    ]) {
      const src = leer(f);
      for (const prohibido of ["productosGiftCardDe", "productoGiftCardDe", "@/lib/catalogoComercial", "@/lib/modalidadComercial", "@/lib/giftCardsComercial"]) {
        assert.ok(!src.includes(prohibido), `${f} lee la fila, no el catálogo (${prohibido})`);
      }
    }
    // Web y panel: productos del servidor, sin catálogo propio ni precios fijos.
    for (const f of ["app/gift-cards/page.tsx", "app/admin/(panel)/gift-cards/CrearGiftCardModal.tsx"]) {
      const src = leer(f);
      for (const prohibido of ["GIFT_CARD_PRODUCTOS", "12000", "20000", "12.000", "20.000", "dos turnos", "15 min", "30 min", "@/lib/catalogoComercial"]) {
        assert.ok(!src.includes(prohibido), `${f} no define la oferta: aparece ${prohibido}`);
      }
      assert.ok(src.includes('"/api/gift-cards/catalogo", { cache: "no-store" }'), `${f} pide el catálogo sin caché`);
      assert.ok(src.includes("modalidad_vista: catalogo.modalidad"), `${f} manda la modalidad que vio`);
    }
    const lib = leer("lib/giftCards.ts");
    assert.ok(!/GIFT_CARD_PRODUCTOS|getProductoPorDuracion/.test(lib), "no queda una lista fija legacy como fuente");
    // Gift Cards no usa los precios especiales de Reservas.
    for (const f of ["lib/giftCards.ts", "lib/giftCardsComercial.ts", "lib/giftCardsAdminAlta.ts", "app/api/gift-cards/preference/route.ts"]) {
      assert.ok(!/reservas_precios_especiales|preciosEspeciales|reservasPricing/.test(leer(f)), `${f} no usa precios especiales de Reservas`);
    }
    const cat = leer("app/api/gift-cards/catalogo/route.ts");
    assert.ok(/force-dynamic/.test(cat) && /no-store/.test(cat) && !/revalidate|s-maxage|max-age=[1-9]/.test(cat), "catálogo sin caché");
    // La compra web sigue sin leer montos del cuerpo.
    const pref = leer("app/api/gift-cards/preference/route.ts");
    for (const prohibido of ["body.monto", "body?.monto", "body.precio", "body.total", "body.canal"]) {
      assert.ok(!pref.includes(prohibido), `la compra web no lee ${prohibido}`);
    }
    assert.ok(pref.indexOf("modalidadParaNuevaGiftCard") < pref.indexOf(".insert(rows)"), "el 409 va antes de crear filas");
    assert.equal(productosGiftCardDe("legacy").length, 2);
  }

  console.log("OK — giftCardsComercial (B5): corte exacto, legacy intacta, v2 10/20/30 con precio del servidor, 409 web y panel, pago tardío legacy, idempotencia, canje/multiuso/renovación/archivado desde la fila.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
