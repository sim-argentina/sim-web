// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// B9 — Códigos de descuento, Promociones, GA4 y compatibilidad final web.
// Ejecutar: npx tsx --env-file=.env.local lib/codigosPromocionesB9.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA, `fetch`
// queda bloqueado y la sesión del panel se firma con un secreto DESCARTABLE. La
// modalidad vigente se fija con el override de la base falsa (nunca la real).
// Las fechas del borde se derivan de CORTE_MODALIDAD_V2_MS (no se escriben).

type Fila = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };
const TABLAS: Record<string, Fila[]> = {};
const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const escrituras: string[] = [];
let siguienteId = 7000;

class Q implements PromiseLike<Res> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private f: Array<(r: Fila) => boolean> = [];
  private val: Fila | Fila[] | null = null;
  private uno: "s" | "m" | null = null;
  private orden: { c: string; asc: boolean } | null = null;
  private rango: [number, number] | null = null;
  constructor(private t: string) {}
  select() { return this; }
  insert(v: Fila | Fila[]) { this.op = "insert"; this.val = v; return this; }
  update(v: Fila) { this.op = "update"; this.val = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.f.push((r) => String(r[c]) === String(v)); return this; }
  neq(c: string, v: unknown) { this.f.push((r) => r[c] !== null && r[c] !== undefined && String(r[c]) !== String(v)); return this; }
  not(c: string, op: string, v: unknown) { if (op === "is" && v === null) this.f.push((r) => r[c] !== null && r[c] !== undefined); return this; }
  is(c: string, v: null) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, v: unknown[]) { this.f.push((r) => v.map(String).includes(String(r[c]))); return this; }
  gte(c: string, v: string) { this.f.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.f.push((r) => String(r[c]) <= v); return this; }
  lt(c: string, v: string) { this.f.push((r) => String(r[c]) < v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orden ??= { c, asc: o?.ascending !== false }; return this; }
  range(a: number, b: number) { this.rango = [a, b]; return this; }
  limit() { return this; }
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
      const nuevas = (Array.isArray(this.val) ? this.val : [this.val as Fila]).map((v) => ({ id: ++siguienteId, created_at: new Date().toISOString(), ...clon(v) }));
      filas.push(...nuevas);
      return this.forma(nuevas.map(clon));
    }
    if (this.op === "update") {
      escrituras.push(`update:${this.t}`);
      const tocadas = filas.filter(ok);
      for (const r of tocadas) Object.assign(r, clon(this.val as Fila));
      return this.forma(tocadas.map(clon));
    }
    if (this.op === "delete") { escrituras.push(`delete:${this.t}`); return this.forma([]); }
    let l = filas.filter(ok).map(clon);
    if (this.orden) {
      const { c, asc } = this.orden;
      l.sort((a, b) => (Number(a[c]) - Number(b[c]) || (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0)) * (asc ? 1 : -1));
    }
    // PostgREST: como mucho 1000 filas por respuesta, pida lo que pida.
    if (this.rango) l = l.slice(this.rango[0], Math.min(this.rango[1] + 1, this.rango[0] + 1000));
    else l = l.slice(0, 1000);
    return this.forma(l);
  }
}
const cli = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (fn: string, a?: Fila) => unknown };
cli.from = (t: string) => new Q(t);
cli.rpc = (fn: string) => Promise.resolve({ data: null, error: { message: `rpc no esperada ${fn}` } });
globalThis.fetch = (async (u: unknown) => { throw new Error(`sin red (${String(u).slice(0, 40)})`); }) as typeof fetch;

function reiniciar(override: "legacy" | "v2_10" | null, extra: Record<string, Fila[]> = {}) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  TABLAS.modalidad_comercial_config = [{ id: 1, modalidad_override: override, motivo: null, actualizado_por: null, updated_at: null }];
  for (const [k, v] of Object.entries(extra)) TABLAS[k] = clon(v);
  escrituras.length = 0;
}

const codigo = (id: number, cod: string, extra: Fila = {}): Fila => ({
  id, codigo: cod, descripcion: null, tipo_descuento: "monto_fijo", valor_descuento: 1000, usos_maximos: null, usos_actuales: 0,
  fecha_inicio: null, fecha_fin: null, activo: true, creado_para: null, deleted_at: null, solo_dias_habiles: false,
  dias_permitidos: null, fechas_bloqueadas: null, duraciones_permitidas: null, created_at: "2026-09-01T12:00:00Z", ...extra,
});

async function main() {
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const { CORTE_MODALIDAD_V2_MS } = await import("@/lib/modalidadComercial");
  const { hoyEnSim, sumarDias } = await import("@/lib/agenda");
  const { validarCodigoDescuento } = await import("@/lib/codigosDescuento");
  const { catalogoCodigosPara } = await import("@/lib/codigosComercial");

  // ── 1. Catálogo de duraciones para códigos NUEVOS ───────────────────────────
  {
    const ahora = new Date();
    assert.deepEqual(catalogoCodigosPara("legacy", ahora).duraciones, [15, 30]);
    assert.deepEqual(catalogoCodigosPara("v2_10", ahora).duraciones, [10, 20, 30]);
  }

  // ── 2. Validación: duraciones guardadas, sin reinterpretar ───────────────────
  {
    reiniciar("v2_10", {
      codigos_descuento: [
        codigo(1, "SOLO15", { duraciones_permitidas: [15] }),
        codigo(2, "SOLO30", { duraciones_permitidas: [30] }),
        codigo(3, "LIBRE"),
        codigo(4, "V2", { duraciones_permitidas: [10, 20, 30] }),
      ],
    });
    for (const d of [10, 20]) {
      const r = await validarCodigoDescuento("SOLO15", 10000, null, d);
      assert.equal(r.valido, false, `[15] no vale para ${d}`);
      assert.equal(r.error, "Este código no está disponible para la duración seleccionada.");
    }
    assert.equal((await validarCodigoDescuento("SOLO15", 12000, null, 15)).valido, true, "[15] sigue valiendo para 15 (producto anterior)");
    assert.equal((await validarCodigoDescuento("SOLO30", 23000, null, 30)).valido, true, "[30] vale para una operación v2 de 30");
    assert.equal((await validarCodigoDescuento("SOLO30", 18000, null, 30)).valido, true, "[30] vale para una operación legacy de 30");
    assert.equal((await validarCodigoDescuento("SOLO30", 17000, null, 20)).valido, false, "[30] no vale para 20");
    for (const d of [10, 15, 20, 30]) assert.equal((await validarCodigoDescuento("LIBRE", 10000, null, d)).valido, true, `sin restricción vale para ${d}`);
    assert.equal((await validarCodigoDescuento("V2", 10000, null, 15)).valido, false, "un código v2 no vale para 15");
    // Gift Cards no pasa duración: la restricción no aplica (como siempre).
    assert.equal((await validarCodigoDescuento("SOLO15", 23000)).valido, true);
  }

  // ── 3. turno_gratis es un descuento MONETARIO ───────────────────────────────
  {
    reiniciar("v2_10", { codigos_descuento: [codigo(1, "GRATIS", { tipo_descuento: "turno_gratis", valor_descuento: 12000 })] });
    const r20 = await validarCodigoDescuento("GRATIS", 17000, null, 20);
    assert.deepEqual([r20.valido, r20.descuento, 17000 - r20.descuento], [true, 12000, 5000], "v2 20 min ($17.000) − $12.000 = $5.000");
    const r10 = await validarCodigoDescuento("GRATIS", 10000, null, 10);
    assert.deepEqual([r10.descuento, 10000 - r10.descuento], [10000, 0], "con tope en el total");
    const r15 = await validarCodigoDescuento("GRATIS", 12000, null, 15);
    assert.deepEqual([r15.descuento, 12000 - r15.descuento], [12000, 0], "legacy 15: como siempre");
  }

  // ── 4. Vigencia con la fecha de Argentina; eliminados no valen ──────────────
  {
    const antes = new Date(CORTE_MODALIDAD_V2_MS - 1000); // 23:59:59 de Argentina
    const borde = new Date(CORTE_MODALIDAD_V2_MS); // 00:00:00 de Argentina
    const DIA_ANTERIOR = hoyEnSim(antes);
    const DIA = hoyEnSim(borde);
    assert.equal(sumarDias(DIA_ANTERIOR, 1), DIA);
    assert.notEqual(antes.toISOString().slice(0, 10), DIA_ANTERIOR, "en UTC ya era el día siguiente: el bug viejo");
    reiniciar("legacy", {
      codigos_descuento: [
        codigo(1, "VENCE", { fecha_fin: DIA_ANTERIOR }),
        codigo(2, "EMPIEZA", { fecha_inicio: DIA }),
        codigo(3, "BORRADO", { deleted_at: "2026-09-02T00:00:00Z" }),
      ],
    });
    assert.equal((await validarCodigoDescuento("VENCE", 12000, null, 15, antes)).valido, true, "vence ese día: vale hasta las 23:59:59 de Argentina");
    assert.equal((await validarCodigoDescuento("VENCE", 12000, null, 15, borde)).error, "El código está vencido", "a las 00:00 de Argentina ya venció");
    assert.equal((await validarCodigoDescuento("EMPIEZA", 12000, null, 15, antes)).error, "El código todavía no está vigente");
    assert.equal((await validarCodigoDescuento("EMPIEZA", 12000, null, 15, borde)).valido, true);
    const borrado = await validarCodigoDescuento("BORRADO", 12000, null, 15);
    assert.deepEqual([borrado.valido, borrado.error], [false, "El código no existe"], "un código eliminado (activo y vigente) ya no vale");
  }

  // ── 5. Panel de códigos: rutas reales ──────────────────────────────────────
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }) },
  } as unknown as NodeJS.Module;
  const { createSessionToken } = await import("@/lib/adminSession");
  const tokenAdmin = await createSessionToken("admin");
  const tokenStaff = await createSessionToken("staff");
  const rutaCodigos = await import("@/app/api/codigos-descuento/route");
  const rutaCodigo = await import("@/app/api/codigos-descuento/[id]/route");
  const ORIGEN = "https://simexperience.com.ar";
  const req = (url: string, metodo: string, body?: unknown, origen = ORIGEN) =>
    new Request(`${ORIGEN}${url}`, { method: metodo, headers: { "content-type": "application/json", origin: origen }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
  const alta = (extra: Fila) => ({ codigo: "", tipo_descuento: "porcentaje", valor_descuento: 20, usos_maximos: 1, ...extra });
  const MENSAJE_409 = "Cambió la modalidad comercial. Revisá las duraciones antes de guardar el código.";
  {
    // Sin sesión, staff y origen ajeno: nada se escribe.
    reiniciar("legacy");
    cookie = undefined;
    assert.equal((await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({})))).status, 401);
    cookie = tokenStaff;
    assert.equal((await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({})))).status, 403, "códigos: solo admin");
    cookie = tokenAdmin;
    assert.equal((await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({}), "https://otro.example"))).status, 403, "origen ajeno");
    assert.equal((await rutaCodigo.PATCH(req("/api/codigos-descuento/1", "PATCH", { activo: false }, "https://otro.example"), ctx(1))).status, 403);
    assert.equal((await rutaCodigo.DELETE(req("/api/codigos-descuento/1", "DELETE", undefined, "https://otro.example"), ctx(1))).status, 403);
    assert.deepEqual(escrituras, []);

    // Legacy vigente: el catálogo del panel es 15/30 y un código nuevo guarda eso.
    let res = await rutaCodigos.GET();
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    let json = await res.json();
    assert.deepEqual([json.catalogo.modalidad, json.catalogo.duraciones], ["legacy", [15, 30]]);
    res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ modalidad_vista: "legacy", duraciones_permitidas: [30, 15, 15] })));
    assert.equal(res.status, 201);
    assert.deepEqual(tabla("codigos_descuento").at(-1)!.duraciones_permitidas, [15, 30], "ordenadas y sin repetidos");
    // Pestaña anterior a B9 (sin modalidad_vista) con legacy vigente: igual que siempre.
    res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ duraciones_permitidas: [15] })));
    assert.equal(res.status, 201);
    res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ modalidad_vista: "legacy", duraciones_permitidas: [10] })));
    assert.equal(res.status, 422, "10 no existe en legacy");
    res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ modalidad_vista: "legacy" })));
    assert.equal(res.status, 201);
    assert.equal(tabla("codigos_descuento").at(-1)!.duraciones_permitidas, null, "sin duraciones = sin restricción, como siempre");

    // v2 vigente: 10/20/30; 15 ya no se ofrece para códigos nuevos.
    reiniciar("v2_10");
    json = await (await rutaCodigos.GET()).json();
    assert.deepEqual([json.catalogo.modalidad, json.catalogo.duraciones], ["v2_10", [10, 20, 30]]);
    res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ modalidad_vista: "v2_10", duraciones_permitidas: [10, 20, 30] })));
    assert.equal(res.status, 201);
    assert.deepEqual(tabla("codigos_descuento").at(-1)!.duraciones_permitidas, [10, 20, 30]);
    escrituras.length = 0;
    res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ modalidad_vista: "v2_10", duraciones_permitidas: [15] })));
    assert.equal(res.status, 422, "15 no es una duración de la oferta v2");

    // Pestaña vieja: formulario armado en legacy, guardado con v2 vigente → 409, 0 escrituras.
    for (const vista of ["legacy", undefined]) {
      res = await rutaCodigos.POST(req("/api/codigos-descuento", "POST", alta({ ...(vista ? { modalidad_vista: vista } : {}), duraciones_permitidas: [15] })));
      assert.equal(res.status, 409);
      json = await res.json();
      assert.deepEqual([json.codigo, json.error, json.catalogo.duraciones], ["catalogo_actualizado", MENSAJE_409, [10, 20, 30]]);
    }
    assert.deepEqual(escrituras, [], "ningún rechazo escribe");

    // Edición: otros campos no tocan las duraciones; una legacy se conserva.
    reiniciar("v2_10", { codigos_descuento: [codigo(50, "LEG15", { duraciones_permitidas: [15] }), codigo(51, "LEG30", { duraciones_permitidas: [30] })] });
    res = await rutaCodigo.PATCH(req("/api/codigos-descuento/50", "PATCH", { fecha_fin: "2026-12-31", usos_maximos: 5 }), ctx(50));
    assert.equal(res.status, 200);
    assert.deepEqual(tabla("codigos_descuento")[0].duraciones_permitidas, [15], "editar la fecha o el límite no toca la duración legacy");
    res = await rutaCodigo.PATCH(req("/api/codigos-descuento/50", "PATCH", { duraciones_permitidas: [15, 20] }), ctx(50));
    assert.equal(res.status, 200, "la legacy que ya tenía + una de la oferta vigente");
    assert.deepEqual(tabla("codigos_descuento")[0].duraciones_permitidas, [15, 20]);
    res = await rutaCodigo.PATCH(req("/api/codigos-descuento/51", "PATCH", { duraciones_permitidas: [15] }), ctx(51));
    assert.equal(res.status, 422, "15 no era de este código ni es de la oferta vigente");
    res = await rutaCodigo.PATCH(req("/api/codigos-descuento/51", "PATCH", { duraciones_permitidas: [45] }), ctx(51));
    assert.equal(res.status, 422);
    assert.deepEqual(tabla("codigos_descuento")[1].duraciones_permitidas, [30], "los rechazos no escriben");
    res = await rutaCodigo.PATCH(req("/api/codigos-descuento/999", "PATCH", { duraciones_permitidas: [10] }), ctx(999));
    assert.equal(res.status, 404);
  }

  // ── 6. Promociones: ranking por minutos comerciales ────────────────────────
  const { rankingPromociones, minutosPromoDeRegistro } = await import("@/lib/promocionesRanking");
  {
    const t = (nombre: string, telefono: string, turnos: number | null, extra: Fila = {}): Fila => ({
      nombre, telefono, fecha: "2026-09-10", total: 1000, cantidad_turnos: turnos, cantidad_personas: 1, cantidad_minutos: 15, modalidad: null, ...extra,
    });
    // Referencia: el algoritmo VIEJO (SUM(cantidad_turnos || 1), sin minutos).
    const viejo = (filas: Fila[]) => {
      const m = new Map<string, { nombre: string; turnos: number }>();
      for (const f of filas) {
        const nombre = String(f.nombre ?? "").trim().replace(/\s+/g, " ");
        const tel = String(f.telefono ?? "").trim();
        if (!nombre || !tel) continue;
        const k = `${nombre.toLowerCase()}|${tel.replace(/\D/g, "") || tel.toLowerCase()}`;
        const a = m.get(k) ?? { nombre, turnos: 0 };
        a.turnos += Number(f.cantidad_turnos) || 1;
        m.set(k, a);
      }
      return [...m.values()].sort((a, b) => b.turnos - a.turnos).slice(0, 10).map((c) => [c.nombre, c.turnos]);
    };
    const legacy = [
      t("Ana", "351 111", 2), t("Beto", "351-222", 3), t("Ana", "351111", 4), t("Caro", "351 333", null),
      t("Dani", "351 444", 1), t("Beto", "351 222", 2), t("  ", "351 555", 9), t("Eva", "", 9),
    ];
    assert.deepEqual(rankingPromociones(legacy).map((c) => [c.nombre, c.cantidad_turnos]), viejo(legacy),
      "con datos legacy el ranking y los turnos son EXACTAMENTE los de antes");
    assert.deepEqual(rankingPromociones(legacy).map((c) => c.minutos), [90, 75, 15, 15], "minutos = turnos × 15");
    // Mixto: 30 legacy (2 turnos de 15) y 30 v2 (3 bloques de 10) pesan lo mismo.
    const mixto = [
      t("Leg", "1", 2, { cantidad_minutos: 30 }),
      t("Nue", "2", 3, { cantidad_minutos: 30, modalidad: "v2_10" }),
      t("Par", "3", 4, { cantidad_minutos: 20, cantidad_personas: 2, modalidad: "v2_10" }),
    ];
    const r = rankingPromociones(mixto);
    assert.deepEqual(r.map((c) => [c.nombre, c.minutos, c.turnos_equivalentes]), [["Par", 40, 2.7], ["Leg", 30, 2], ["Nue", 30, 2]],
      "v2 20×2 = 40 min; 30 legacy = 30 v2; SUM(cantidad_turnos) habría dado Par 4 > Nue 3 > Leg 2");
    assert.equal(minutosPromoDeRegistro({ cantidad_turnos: 0, modalidad: "legacy" }), 15, "fallback histórico: 1 turno");
    // Umbral "5 turnos" = 75 minutos: con datos legacy, mismo resultado que comparar turnos.
    const umbralMin = 5 * 15;
    assert.deepEqual(rankingPromociones(legacy).map((c) => c.minutos >= umbralMin), viejo(legacy).map(([, n]) => Number(n) >= 5));

    // Ruta real: lee TODO (más de 1000 filas) y la ventana sale de la fecha de Argentina.
    cookie = tokenStaff;
    const rutaPromos = await import("@/app/api/promociones/clientes/route");
    const desde = sumarDias(hoyEnSim(), -30);
    const muchas: Fila[] = [];
    for (let i = 0; i < 1500; i++) muchas.push({ id: i + 1, estado: "activo", ...t(`C${i % 7}`, `35100${i % 7}`, 1, { fecha: desde }) });
    muchas.push({ id: 5000, estado: "activo", ...t("Viejo", "999", 50, { fecha: sumarDias(desde, -1) }) });
    muchas.push({ id: 5001, estado: "cancelado", ...t("Cancelado", "998", 50, { fecha: desde }) });
    reiniciar("legacy", { turnos_stand: muchas });
    let json = await (await rutaPromos.GET(new Request(`${ORIGEN}/api/promociones/clientes?dias=30`))).json();
    assert.equal(json.clientes.reduce((a: number, c: { minutos: number }) => a + c.minutos, 0), 1500 * 15,
      "las 1500 filas de la ventana (antes, PostgREST cortaba en 1000)");
    assert.ok(!json.clientes.some((c: { nombre: string }) => c.nombre === "Viejo" || c.nombre === "Cancelado"), "fuera de la ventana y cancelados no cuentan");
    json = await (await rutaPromos.GET(new Request(`${ORIGEN}/api/promociones/clientes?historico=true`))).json();
    const viejoCliente = json.clientes.find((c: { nombre: string }) => c.nombre === "Viejo");
    assert.equal(viejoCliente?.minutos, 50 * 15, "con Histórico entra también lo de fuera de la ventana");
    assert.equal(json.clientes.reduce((a: number, c: { minutos: number }) => a + c.minutos, 0), 1500 * 15 + 50 * 15, "todas las filas, sin el corte de 1000");
  }

  // ── 7. /api/disponibilidad: la rama genérica de Mensualidades está retirada ──
  {
    const rutaDisp = await import("@/app/api/disponibilidad/route");
    const flag = process.env.MENSUALIDADES_ENABLED;
    process.env.MENSUALIDADES_ENABLED = "true";
    let res = await rutaDisp.GET(new Request(`${ORIGEN}/api/disponibilidad?producto=mensualidad&fecha=2026-11-16&duracion=20`));
    assert.equal(res.status, 410);
    assert.equal((await res.json()).codigo, "producto_retirado");
    delete process.env.MENSUALIDADES_ENABLED;
    res = await rutaDisp.GET(new Request(`${ORIGEN}/api/disponibilidad?producto=mensualidad&fecha=2026-11-16`));
    assert.equal(res.status, 404, "con la flag apagada, el 404 de siempre");
    res = await rutaDisp.GET(new Request(`${ORIGEN}/api/disponibilidad?producto=otro`));
    assert.equal(res.status, 400);
    if (flag !== undefined) process.env.MENSUALIDADES_ENABLED = flag;
  }
  delete require.cache[rutaHeaders];

  // ── 8. GA4: duración comercial real, valor real, ids dinámicos, sin buffer ───
  {
    const A = await import("@/lib/analytics");
    class Mem { private m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
    const g = globalThis as unknown as { window?: { location: { hostname: string; pathname: string }; dataLayer: Fila[] }; sessionStorage?: Mem };
    g.window = { location: { hostname: "simexperience.com.ar", pathname: "/reservas" }, dataLayer: [] };
    g.sessionStorage = new Mem();
    for (const [d, v] of [[10, 10000], [20, 34000], [30, 23000], [15, 12000]] as const) {
      A.trackPaymentRedirect({ funnel: "reserva", value: v, duration_minutes: d, quantity: 1 });
      assert.deepEqual([g.window.dataLayer.at(-1)!.duration_minutes, g.window.dataLayer.at(-1)!.value], [d, v], `GA4 recibe ${d} min, no ${d + 10}`);
    }
    A.trackMensualidadPlan({ plan: "2h", minutos: 120, value: 70000 });
    assert.deepEqual([g.window.dataLayer.at(-1)!.duration_minutes, g.window.dataLayer.at(-1)!.value], [120, 70000]);
    delete g.window;
    delete g.sessionStorage;

    const ROOT = process.cwd();
    const leer = (f: string) => readFileSync(join(ROOT, f), "utf8");
    const ga = [leer("lib/analytics.ts"), leer("app/reservas/page.tsx"), leer("app/gift-cards/page.tsx"), leer("app/mensualidades/CompraMensualidad.tsx")];
    for (const src of ga) {
      const bloques = [...src.matchAll(/(gaEvent|track[A-Z]\w*)\(\{?[\s\S]{0,400}?\}\)?;/g)].map((m) => m[0]);
      assert.ok(bloques.every((b) => !/buffer|ocupacion/i.test(b)), "ningún evento GA4 lleva buffer ni ocupación");
    }
    assert.ok(/item_id: `gift_card_\$\{p\.duracion\}`/.test(ga[2]) && /item_name: `Gift Card \$\{p\.duracion\} min`/.test(ga[2]), "Gift Cards: item_id/item_name dinámicos");
    assert.ok(/duration_minutes: duracion,/.test(ga[1]) && /oferta\?\.precios\[String\(duracion\)\]/.test(ga[1]), "Reservas: duración y precio del catálogo del servidor");
    assert.ok(/value: plan\.precio/.test(ga[3]) && /duration_minutes: plan\.minutos/.test(ga[3]), "Mensualidades: precio y minutos del plan");
    assert.ok(!/gift_card_15|gift_card_30|"15 min"|"30 min"/.test(ga[2]), "Gift Cards sin ids fijos de 15/30");

    // Panel: Métricas y Códigos sin 15/30 fijos.
    const metricas = leer("app/admin/(panel)/metricas/page.tsx");
    assert.ok(!/title="Reservas 15 min"|title="Reservas 30 min"/.test(metricas) && metricas.includes("reservasPorDuracion.map("), "tarjetas por duración real");
    const panelCodigos = leer("app/admin/(panel)/codigos/page.tsx");
    assert.ok(!/\[15, 30\]\.map/.test(panelCodigos) && panelCodigos.includes("catalogo?.duraciones") && panelCodigos.includes("modalidad_vista"), "el panel de códigos usa el catálogo del servidor");
    const rutaAlta = leer("app/api/codigos-descuento/route.ts");
    assert.ok(!/n === 15 \|\| n === 30/.test(rutaAlta), "el alta ya no descarta en silencio lo que no sea 15/30");
    assert.ok(!/toISOString\(\)\.slice\(0, 10\)/.test(leer("lib/codigosDescuento.ts")), "la vigencia no usa la fecha UTC");
    assert.ok(!/toISOString\(\)\.slice\(0, 10\)/.test(leer("app/api/promociones/clientes/route.ts")), "la ventana de Promociones no usa la fecha UTC");
  }

  console.log("OK — B9: códigos nuevos con la oferta vigente (15/30 o 10/20/30), códigos existentes sin reinterpretar, 409 de pestaña vieja, vigencia con fecha de Argentina, eliminados inválidos, turno_gratis monetario; Promociones por minutos comerciales sin corte de 1000 filas; /api/disponibilidad sin la rama de Mensualidades; GA4 con duración y valor reales.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
