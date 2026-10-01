import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// B8 — Turnero + Métricas + IA + capacidad de Finanzas para 10/20/30.
// Ejecutar: npx tsx --env-file=.env.local lib/turneroMetricasB8.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA, `fetch`
// queda bloqueado y la sesión del panel se firma con un secreto DESCARTABLE.
// La modalidad vigente se fija con el override de la base falsa (nunca la real).

type Fila = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };
const TABLAS: Record<string, Fila[]> = {};
const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const escrituras: string[] = [];
let siguienteId = 5000;

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
  is(c: string, v: null) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, v: unknown[]) { this.f.push((r) => v.map(String).includes(String(r[c]))); return this; }
  gte(c: string, v: string) { this.f.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.f.push((r) => String(r[c]) <= v); return this; }
  lt(c: string, v: string) { this.f.push((r) => String(r[c]) < v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orden ??= { c, asc: o?.ascending !== false }; return this; }
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
      l.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rango) l = l.slice(this.rango[0], this.rango[1] + 1);
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

// Filas sintéticas.
const stand = (id: number, fecha: string, personas: number, minutos: number, turnos: number, modalidad: string | null, total = 10000): Fila => ({
  id, fecha, hora: "12:00", hora_subida: "12:00", estado: "activo", total, metodo_pago: "efectivo",
  pagos_detalle: [{ metodo_pago: "efectivo", monto: total, posnet_pago: null }],
  cantidad_personas: personas, cantidad_simuladores: 0, cantidad_minutos: minutos, cantidad_turnos: turnos, modalidad,
  created_at: `${fecha}T15:00:00Z`,
});
const reserva = (id: number, fecha: string, dur: number, sims: string[], modalidad: string | null, origen: string, total = 0): Fila => ({
  id, fecha, hora: "12:00", estado: "activa", total, duracion_minutos: dur, simuladores: sims,
  cantidad_turnos: sims.length, modalidad, origen, no_show: false, created_at: `${fecha}T15:00:00Z`,
});

async function main() {
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const mc = await import("@/lib/minutosComerciales");
  const ms = await import("@/lib/metricasStand");
  const fin = await import("@/lib/finanzas");
  const { ocupacionTeorica } = await import("@/lib/finanzasOcupacion");
  const { getTurnoTimerState } = await import("@/lib/turnoTimer");

  // ── 1. Stand: minutos comerciales por modalidad (legacy sin cambios) ─────────
  {
    // Legacy: turnos × 15, incluso en filas incoherentes (no se normalizan).
    assert.equal(ms.minutosComercialesStand(stand(1, "2026-09-10", 2, 15, 2, null)), 30);
    assert.equal(ms.minutosComercialesStand(stand(2, "2026-09-10", 2, 30, 2, null)), 30, "fila histórica incoherente: se conserva turnos × 15");
    assert.equal(ms.minutosComercialesStand(stand(3, "2026-09-10", 1, 25, 1, "legacy")), 15);
    // v2: minutos por persona × personas. Sin buffer.
    assert.equal(ms.minutosComercialesStand(stand(4, "2026-10-15", 1, 10, 1, "v2_10")), 10);
    assert.equal(ms.minutosComercialesStand(stand(5, "2026-10-15", 2, 20, 4, "v2_10")), 40, "2 personas · 20 = 40 (no 60)");
    assert.equal(ms.minutosComercialesStand(stand(6, "2026-10-15", 4, 30, 12, "v2_10")), 120, "4 personas · 30 = 120 (no 180)");
    const agg = ms.agregarStand([stand(1, "x", 2, 15, 2, null), stand(5, "x", 2, 20, 4, "v2_10"), stand(6, "x", 4, 30, 12, "v2_10")]);
    assert.equal(agg.turnos, 18, "turnos = Σ cantidad_turnos persistidos");
    assert.equal(agg.minutos, 30 + 40 + 120, "minutos = Σ por modalidad");
    assert.equal(agg.horas, 190 / 60);
    // Solo legacy: idéntico a turnos × 15.
    const soloLegacy = [stand(1, "x", 2, 15, 2, null), stand(2, "x", 2, 30, 2, null), stand(7, "x", 3, 30, 6, null)];
    assert.equal(ms.agregarStand(soloLegacy).minutos, ms.agregarStand(soloLegacy).turnos * 15);
  }

  // ── 2. Reservas: minutos y turnos por modalidad (todas las vías) ─────────────
  {
    const webLegacy30 = reserva(1, "2026-09-10", 30, ["Ferrari"], null, "web");
    assert.equal(mc.turnosComercialesReserva(webLegacy30, "calcular"), 1, "legacy: cantidad_turnos = simuladores");
    assert.equal(mc.minutosComercialesReserva(webLegacy30, "calcular"), 15, "legacy: el resultado histórico (30 min · 1 sim cuenta 15) NO se corrige");
    for (const origen of ["web", "mensualidad", "empresa"]) {
      const v2 = reserva(2, "2026-10-15", 20, ["Ferrari", "McLaren"], "v2_10", origen);
      assert.equal(mc.minutosComercialesReserva(v2, "calcular"), 40, `${origen} v2 20 × 2 = 40`);
      assert.equal(mc.turnosComercialesReserva(v2, "calcular"), 4, `${origen} v2: 4 bloques de 10`);
      assert.equal(mc.minutosComercialesReserva(v2, "cero"), 40);
    }
    const sinTurnos = { ...webLegacy30, cantidad_turnos: null };
    assert.equal(mc.turnosComercialesReserva(sinTurnos, "calcular"), 2, "fallback de Equipo/ejecutor: personas × 30 / 15");
    assert.equal(mc.turnosComercialesReserva(sinTurnos, "cero"), 0, "fallback de la herramienta operativa: 0");
  }

  // ── 3. Clasificación 10/15/20/30 (sin convertir 10/20 en 15) ─────────────────
  {
    const mix = [
      reserva(1, "x", 15, ["Ferrari"], null, "web"), reserva(2, "x", 30, ["Ferrari"], null, "web"),
      reserva(3, "x", 10, ["Ferrari"], "v2_10", "web"), reserva(4, "x", 20, ["Ferrari"], "v2_10", "web"),
      reserva(5, "x", 30, ["Ferrari"], "v2_10", "web"), reserva(6, "x", 20, ["Ferrari"], "v2_10", "mensualidad"),
    ];
    assert.deepEqual(mc.comparativoReservasPorDuracion(mix), [
      { label: "10 min", value: 1 }, { label: "15 min", value: 1 }, { label: "20 min", value: 2 }, { label: "30 min", value: 2 },
    ]);
    // Solo legacy: exactamente las dos categorías de siempre.
    assert.deepEqual(mc.comparativoReservasPorDuracion([reserva(1, "x", 15, ["F"], null, "web"), reserva(2, "x", 30, ["F"], null, "web")]),
      [{ label: "15 min", value: 1 }, { label: "30 min", value: 1 }]);
    assert.deepEqual(mc.comparativoReservasPorDuracion([]), [{ label: "15 min", value: 0 }, { label: "30 min", value: 0 }]);
    const standMix = [
      stand(1, "x", 1, 15, 1, null), stand(2, "x", 1, 30, 2, null), stand(3, "x", 1, 25, 1, null),
      stand(4, "x", 1, 10, 1, "v2_10"), stand(5, "x", 2, 20, 4, "v2_10"), stand(6, "x", 1, 30, 3, "v2_10"),
    ];
    assert.deepEqual(ms.comparativoStandPorDuracion(standMix), [
      { label: "10 min", value: 1 }, { label: "15 min", value: 2 }, { label: "20 min", value: 4 }, { label: "30 min", value: 5 },
    ], "legacy 25 → 15 (regla histórica); v2 10/20/30 reales");
    assert.equal(mc.etiquetaDuracion("v2_10", 20), "20 min");
    assert.equal(mc.etiquetaDuracion("legacy", 20), "15 min", "legacy conserva su regla");
  }

  // ── 4. Finanzas: capacidad y ocupación por modalidad persistida ──────────────
  {
    const config = { cantidad_simuladores: 4, horas_operativas_dia: 12, valor_activos: 0, inversion_inicial: 0, meta_facturacion: 0, meta_margen_operativo: 0, meta_ocupacion: 0, mes_inicio: "2026-07" };
    const exc = [
      { id: "a", fecha: "2026-10-05", cerrado: true, horas: null, simuladores: null, motivo: null },
      { id: "b", fecha: "2026-10-06", cerrado: false, horas: 6, simuladores: 2, motivo: null },
    ];
    const cap = fin.capacidadYDiasOperativos("2026-10", config, exc, 17);
    assert.equal(cap.minutosDisponibles, (29 * 4 * 12 + 2 * 6) * 60, "minutos-simulador del mes con sus excepciones");
    assert.equal(cap.capacidad, 29 * 4 * Math.floor(720 / 17) + 2 * Math.floor(360 / 17), "los slots de siempre");
    // Sin filas v2: EXACTAMENTE la fórmula anterior.
    for (const turnos of [0, 1, 777, 1311]) {
      const viejo = cap.capacidad ? Math.round((turnos / cap.capacidad) * 10000) / 10000 : null;
      assert.equal(ocupacionTeorica({ turnosDelMes: turnos, capacidad: cap.capacidad, minutosDisponibles: cap.minutosDisponibles, standV2: { turnos: 0, minutos: 0 } }), viejo);
    }
    assert.equal(ocupacionTeorica({ turnosDelMes: 5, capacidad: 0, minutosDisponibles: 0, standV2: { turnos: 0, minutos: 0 } }), null);
    // Solo v2: minutos vendidos / minutos disponibles. Ni ×15 ni slots.
    const v2 = ocupacionTeorica({ turnosDelMes: 12, capacidad: cap.capacidad, minutosDisponibles: cap.minutosDisponibles, standV2: { turnos: 12, minutos: 120 } });
    assert.equal(v2, Math.round((120 / cap.minutosDisponibles) * 10000) / 10000);
    const conOtraDemora = fin.capacidadYDiasOperativos("2026-10", config, exc, 25);
    assert.equal(ocupacionTeorica({ turnosDelMes: 12, capacidad: conOtraDemora.capacidad, minutosDisponibles: conOtraDemora.minutosDisponibles, standV2: { turnos: 12, minutos: 120 } }), v2,
      "la parte v2 no depende de la duración de slot legacy (15 + demora)");
    // Octubre mixto: legacy bajo override + v2 + legacy por rollback. Cada fila por SU modalidad.
    const filasOct = [
      stand(1, "2026-10-02", 2, 15, 2, "legacy"), stand(2, "2026-10-03", 1, 30, 2, "legacy"),
      stand(3, "2026-10-10", 2, 20, 4, "v2_10"), stand(4, "2026-10-11", 4, 30, 12, "v2_10"),
      stand(5, "2026-10-20", 1, 15, 1, "legacy"),
    ];
    const turnosDelMes = filasOct.reduce((a, t) => a + Number(t.cantidad_turnos), 0);
    const v2Filas = filasOct.filter((t) => t.modalidad === "v2_10");
    const standV2 = { turnos: v2Filas.reduce((a, t) => a + Number(t.cantidad_turnos), 0), minutos: v2Filas.reduce((a, t) => a + ms.minutosComercialesStand(t), 0) };
    const mixta = ocupacionTeorica({ turnosDelMes, capacidad: cap.capacidad, minutosDisponibles: cap.minutosDisponibles, standV2 });
    const esperado = Math.round(((2 + 2 + 1) / cap.capacidad + 160 / cap.minutosDisponibles) * 10000) / 10000;
    assert.equal(mixta, esperado, "legacy por slots + v2 por minutos, fila por fila");
    assert.notEqual(mixta, Math.round((turnosDelMes / cap.capacidad) * 10000) / 10000, "no suma bloques de 10 como si fueran de 15");
    // getStandV2DelMes: mismo filtro que fin_ingresos_por_mes (mes, estado ≠ cancelado), solo v2.
    reiniciar("legacy", { turnos_stand: [...filasOct, { ...stand(6, "2026-10-12", 2, 20, 4, "v2_10"), estado: "cancelado" }, stand(7, "2026-11-01", 1, 10, 1, "v2_10")] });
    assert.deepEqual(await fin.getStandV2DelMes("2026-10"), { turnos: 16, minutos: 160 });
  }

  // ── 5. Temporizador: minutos comerciales, sin buffer ─────────────────────────
  {
    const base = { fecha: "2026-10-15", horaSubida: "12:00", minutos: 20, listo: false };
    const t0 = new Date(2026, 9, 15, 12, 0, 0).getTime();
    assert.equal(getTurnoTimerState(base, t0 + 19 * 60_000).label, "Faltan 01:00", "termina a los 20, no a los 30");
    assert.equal(getTurnoTimerState(base, t0 + 21 * 60_000).status, "rojo");
  }

  // ── 6. Turnero: rutas reales (catálogo, alta, edición) ──────────────────────
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: { cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }) },
  } as unknown as NodeJS.Module;
  const { createSessionToken } = await import("@/lib/adminSession");
  const tokenStaff = await createSessionToken("staff");
  const rutaCatalogo = await import("@/app/api/turnos-stand/catalogo/route");
  const rutaTurnos = await import("@/app/api/turnos-stand/route");
  const rutaTurno = await import("@/app/api/turnos-stand/[id]/route");
  const ORIGEN = "https://simexperience.com.ar";
  const post = (body: unknown) => new Request(`${ORIGEN}/api/turnos-stand`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN }, body: JSON.stringify(body) });
  const patch = (id: number, body: unknown) => new Request(`${ORIGEN}/api/turnos-stand/${id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: ORIGEN }, body: JSON.stringify(body) });
  const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
  const altaBase = (extra: Fila) => ({
    nombre: "Test B8", telefono: "000", fecha: "2026-10-15", hora: "12:00", simuladores: [],
    pagos_detalle: [{ metodo_pago: "efectivo", monto: 17000 }], ...extra,
  });
  const filasStand = () => tabla("turnos_stand");

  {
    // Sin sesión.
    reiniciar("legacy");
    cookie = undefined;
    assert.equal((await rutaCatalogo.GET()).status, 401);
    assert.equal((await rutaTurnos.POST(post(altaBase({})))).status, 401);
    assert.equal(filasStand().length, 0);
    cookie = tokenStaff;

    // Catálogo legacy (override legacy): la pantalla de siempre.
    let res = await rutaCatalogo.GET();
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    let cat = await res.json();
    assert.equal(cat.modalidad, "legacy");
    assert.deepEqual(cat.duraciones, [15, 30]);
    assert.deepEqual(cat.precios, [], "en legacy no hay precios de referencia nuevos");
    assert.equal(cat.legacy, null);
    assert.deepEqual(cat.minutos_por_turno_por_modalidad, { legacy: 15, v2_10: 10 });

    // Alta legacy normal: EXACTAMENTE como antes (minutos libres, turnos a mano) + modalidad legacy.
    res = await rutaTurnos.POST(post(altaBase({ modalidad_vista: "legacy", cantidad_personas: 2, cantidad_minutos: 25, cantidad_turnos: 3 })));
    assert.equal(res.status, 200);
    let fila = filasStand().at(-1)!;
    assert.deepEqual([fila.modalidad, fila.cantidad_personas, fila.cantidad_minutos, fila.cantidad_turnos], ["legacy", 2, 25, 3]);
    // Pestaña anterior a B8 (sin modalidad_vista) con legacy vigente: igual que siempre.
    res = await rutaTurnos.POST(post(altaBase({ cantidad_personas: 1 })));
    assert.equal(res.status, 200);
    fila = filasStand().at(-1)!;
    assert.deepEqual([fila.modalidad, fila.cantidad_minutos, fila.cantidad_turnos], ["legacy", 15, 1], "defaults de siempre");

    // Catálogo v2 (override v2): 10/20/30 con referencia, y carga de productos anteriores.
    reiniciar("v2_10");
    cat = await (await rutaCatalogo.GET()).json();
    assert.equal(cat.modalidad, "v2_10");
    assert.deepEqual(cat.duraciones, [10, 20, 30]);
    assert.deepEqual(cat.precios, [{ duracion: 10, precio: 10000 }, { duracion: 20, precio: 17000 }, { duracion: 30, precio: 23000 }]);
    assert.deepEqual(cat.legacy, { duraciones: [15, 30], minutos_por_turno: 15 });

    // v2 10 · 20 · 30: el servidor calcula los turnos (bloques de 10 por persona).
    for (const [personas, minutos, turnosEsperados, minutosVendidos] of [[1, 10, 1, 10], [2, 20, 4, 40], [4, 30, 12, 120]] as const) {
      res = await rutaTurnos.POST(post(altaBase({ modalidad_vista: "v2_10", cantidad_personas: personas, cantidad_minutos: minutos, cantidad_turnos: 99 })));
      assert.equal(res.status, 200, `v2 ${personas}×${minutos}`);
      fila = filasStand().at(-1)!;
      assert.deepEqual([fila.modalidad, fila.cantidad_personas, fila.cantidad_minutos, fila.cantidad_turnos], ["v2_10", personas, minutos, turnosEsperados],
        "el cliente no decide cantidad_turnos");
      assert.equal(ms.minutosComercialesStand(fila), minutosVendidos, "minutos vendidos sin buffer");
    }
    // 15 (o cualquier no-múltiplo de 10) no existe en v2: 422 sin escribir.
    escrituras.length = 0;
    for (const minutos of [15, 25, 0, 130]) {
      res = await rutaTurnos.POST(post(altaBase({ modalidad_vista: "v2_10", cantidad_personas: 1, cantidad_minutos: minutos })));
      assert.equal(res.status, 422, `v2 ${minutos} → 422`);
    }
    res = await rutaTurnos.POST(post(altaBase({ modalidad_vista: "v2_10", cantidad_personas: 5, cantidad_minutos: 20 })));
    assert.equal(res.status, 422, "más de 4 personas");
    assert.deepEqual(escrituras, [], "ningún rechazo escribe");

    // Pestaña vieja: armada en legacy, confirmada con v2 vigente → 409 y 0 filas.
    const antes = filasStand().length;
    for (const vista of ["legacy", undefined]) {
      res = await rutaTurnos.POST(post(altaBase({ ...(vista ? { modalidad_vista: vista } : {}), cantidad_personas: 1, cantidad_minutos: 15, cantidad_turnos: 1 })));
      assert.equal(res.status, 409);
      const j = await res.json();
      assert.equal(j.codigo, "catalogo_actualizado");
      assert.equal(j.error, "Cambió la modalidad comercial. Actualizá el Turnero antes de registrar el turno.");
      assert.equal(j.catalogo.modalidad, "v2_10", "el 409 trae la oferta nueva");
    }
    assert.equal(filasStand().length, antes, "0 filas");
    assert.deepEqual(escrituras, []);

    // Producto anterior registrado A PROPÓSITO (Gift Card legacy de 15 y de 30).
    res = await rutaTurnos.POST(post(altaBase({ registro_legacy: true, cantidad_personas: 2, cantidad_minutos: 15, cantidad_turnos: 7 })));
    assert.equal(res.status, 200);
    fila = filasStand().at(-1)!;
    assert.deepEqual([fila.modalidad, fila.cantidad_minutos, fila.cantidad_turnos], ["legacy", 15, 2]);
    assert.equal(ms.minutosComercialesStand(fila), 30, "métrica legacy");
    res = await rutaTurnos.POST(post(altaBase({ registro_legacy: true, cantidad_personas: 1, cantidad_minutos: 30 })));
    fila = filasStand().at(-1)!;
    assert.deepEqual([fila.modalidad, fila.cantidad_minutos, fila.cantidad_turnos], ["legacy", 30, 2], "30 legacy explícito: 2 turnos de 15, no 3 de 10");
    res = await rutaTurnos.POST(post(altaBase({ registro_legacy: true, cantidad_personas: 1, cantidad_minutos: 20 })));
    assert.equal(res.status, 422, "un producto anterior es de 15 o 30");

    // Edición: la modalidad es la de la fila y no cambia.
    const v2Id = Number(filasStand().find((t) => t.modalidad === "v2_10" && t.cantidad_minutos === 20)!.id);
    res = await rutaTurno.PATCH(patch(v2Id, altaBase({ cantidad_personas: 2, cantidad_minutos: 30, cantidad_turnos: 1, modalidad: "legacy" })), ctx(v2Id));
    assert.equal(res.status, 200);
    fila = filasStand().find((t) => Number(t.id) === v2Id)!;
    assert.deepEqual([fila.modalidad, fila.cantidad_minutos, fila.cantidad_turnos], ["v2_10", 30, 6], "sigue v2 y recalcula sus turnos");
    res = await rutaTurno.PATCH(patch(v2Id, altaBase({ cantidad_personas: 1, cantidad_minutos: 15 })), ctx(v2Id));
    assert.equal(res.status, 422, "una fila v2 no pasa a 15");
    reiniciar("v2_10", { turnos_stand: [stand(900, "2026-09-10", 2, 25, 3, null)] });
    res = await rutaTurno.PATCH(patch(900, altaBase({ cantidad_personas: 2, cantidad_minutos: 25, cantidad_turnos: 3 })), ctx(900));
    assert.equal(res.status, 200);
    fila = tabla("turnos_stand")[0];
    assert.deepEqual([fila.modalidad, fila.cantidad_minutos, fila.cantidad_turnos], [null, 25, 3], "histórica: sin reinterpretar y sigue NULL");
    res = await rutaTurno.PATCH(patch(12345, altaBase({})), ctx(12345));
    assert.equal(res.status, 404);
    delete require.cache[rutaHeaders];
  }

  // ── 7. Métricas Equipo + IA sobre la misma agenda mixta ─────────────────────
  {
    const F = "2026-10-15";
    reiniciar("legacy", {
      turnos_stand: [stand(1, F, 2, 20, 4, "v2_10", 34000), stand(2, F, 2, 15, 2, "legacy", 24000)],
      reservas: [
        reserva(11, F, 20, ["Ferrari", "McLaren"], "v2_10", "web", 34000),
        reserva(12, F, 20, ["Alpine", "Red Bull"], "v2_10", "mensualidad"),
        reserva(13, F, 20, ["Ferrari", "McLaren"], "v2_10", "empresa"),
        reserva(14, F, 30, ["Alpine"], null, "web", 18000),
      ],
    });
    const { consultarMetricasEquipo } = await import("@/lib/metricasEquipoServer");
    const eq = await consultarMetricasEquipo({ desde: F, hasta: F, corte: "2026-12-31T12:00:00Z" });
    // Stand 40 + 30; reservas v2 40 × 3 + legacy 15 (la fórmula histórica).
    assert.equal(eq.totalesOrigen.minutos, 40 + 30 + 40 * 3 + 15);
    assert.equal(eq.totalesOrigen.turnos, 4 + 2 + 4 * 3 + 1);
    assert.ok(/v2/.test(eq.definiciones.minutos) && /buffer/.test(eq.definiciones.minutos), "la definición explica v2 y que no hay buffer");

    const { HERRAMIENTAS } = await import("@/lib/ia/tools");
    const op = JSON.parse((await HERRAMIENTAS.consultar_metricas_stand_reservas.ejecutar({ anio: 2026, mes: 10 })).contenido);
    assert.equal(op.stand.minutos, 70, "IA: minutos del Stand reales");
    assert.equal(op.reservas.minutos, 40 * 3 + 15, "IA: 20 min × 2 = 40 por reserva v2, sin buffer");
    assert.equal(op.reservas.turnos, 4 * 3 + 1);

    const { ejecutarPlanAnalitico } = await import("@/lib/ia/analisis/ejecutorAnalitico");
    const minutosIA = await ejecutarPlanAnalitico({ metrica: "minutos_actividad", ventana: { desde: F, hasta: F }, filtros: { diasSemana: null, fuentes: null, metodosPago: null }, agruparPor: "fuente", orden: "mayor_a_menor", limite: 50 });
    assert.ok(minutosIA.ok);
    if (minutosIA.ok) {
      // El ejecutor solo cuenta reservas web (como siempre): v2 40 + legacy 15; Stand 70.
      assert.deepEqual(minutosIA.porFuente.map((f) => [f.fuente, f.valor]).sort(), [["reservas", 55], ["stand", 70]]);
    }
    const { construirSerieDiaria } = await import("@/lib/ia/analisis/serieDiaria");
    const serie = await construirSerieDiaria(F, F);
    assert.equal(serie[0].turnos, 4 + 2 + 4 * 3 + 1, "serie diaria: turnos por modalidad");
  }

  // ── 8. Fuentes: sin ×15 suelto; el Turnero no fija la oferta ─────────────────
  {
    const ROOT = process.cwd();
    const leer = (f: string) => readFileSync(join(ROOT, f), "utf8");
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (/\.(ts|tsx)$/.test(e) && !/\.(test|integration|tmp)\.ts$/.test(e)) archivos.push(relative(ROOT, p).split(sep).join("/"));
      }
    };
    recorrer(join(ROOT, "lib", "ia"));
    for (const f of [...archivos, "lib/metricasEquipoServer.ts", "lib/finanzas.ts", "app/admin/(panel)/metricas/page.tsx"]) {
      const src = sinComentarios(leer(f));
      assert.ok(!/turnos \* 15|rTurnos \* 15|=== 30 \? 30 : 15/.test(src), `${f}: sin minutos = turnos × 15 ni 30-o-15 sueltos`);
    }
    const pagina = leer("app/admin/(panel)/turnero/page.tsx");
    assert.ok(pagina.includes("/api/turnos-stand/catalogo"), "la oferta viene del servidor");
    assert.ok(!/\[\s*10\s*,\s*20\s*,\s*30\s*\]/.test(pagina), "sin 10/20/30 fijos en el bundle");
    assert.ok(!/["']@\/lib\/(modalidadComercial|catalogoComercial)["']/.test(pagina), "la página no resuelve modalidad");
    assert.ok(/minutos:\s*turno\.cantidad_minutos\b/.test(pagina) && !/cantidad_minutos\)?\s*\+\s*10\b/.test(pagina), "el temporizador usa los minutos comerciales, sin buffer");
    const alta = sinComentarios(leer("app/api/turnos-stand/route.ts"));
    assert.ok(alta.includes("prepararAltaTurnero(") && alta.includes("modalidad: alta.campos.modalidad"));
    const edicion = sinComentarios(leer("app/api/turnos-stand/[id]/route.ts"));
    const update = /\.update\(\{([\s\S]*?)\}\)/.exec(edicion)![1];
    assert.ok(!/\bmodalidad\b/.test(update), "editar nunca escribe la modalidad");
    const quienResuelve = archivos.concat(["lib/turneroComercial.ts", "app/api/turnos-stand/route.ts", "app/api/turnos-stand/[id]/route.ts", "app/api/turnos-stand/catalogo/route.ts"])
      .filter((f) => sinComentarios(leer(f)).includes("modalidadVigente("));
    assert.deepEqual(quienResuelve, ["lib/turneroComercial.ts"], "el Turnero resuelve la vigente en un solo lugar");
  }

  console.log("OK — B8: Turnero legacy igual y v2 10/20/30 con turnos del servidor, producto anterior explícito, 409 de pestaña vieja, edición sin cambiar modalidad; minutos comerciales sin buffer en Stand, Reservas, Equipo e IA; clasificación 10/15/20/30; ocupación de Finanzas por modalidad persistida.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
