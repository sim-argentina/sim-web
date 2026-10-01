import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS } from "@/lib/modalidadComercial";
import { hoyEnSim, sumarDias } from "@/lib/agenda";
import { estadoEfectivo } from "@/lib/empresas";

// Empresas B7.1 — "hoy" es la fecha calendario de ARGENTINA, nunca la UTC.
// Ejecutar: npx tsx --env-file=.env.local lib/empresasFechaArgentina.test.ts
//
// Base EN MEMORIA, `fetch` bloqueado y RPC interceptadas: no toca nada real.
// Los instantes salen de CORTE_MODALIDAD_V2_MS (la medianoche del 30/09 al
// 01/10 en Argentina): son los bordes pedidos, sin escribir la fecha del corte.

type Fila = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };
const TABLAS: Record<string, Fila[]> = {};
const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rpcs: string[] = [];

class Q implements PromiseLike<Res> {
  private f: Array<(r: Fila) => boolean> = [];
  private uno: "s" | "m" | null = null;
  private orden: { c: string; asc: boolean } | null = null;
  private rango: [number, number] | null = null;
  constructor(private t: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  is(c: string, v: null) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, v: unknown[]) { this.f.push((r) => v.includes(r[c])); return this; }
  gte(c: string, v: string) { this.f.push((r) => String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.f.push((r) => String(r[c]) <= v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orden ??= { c, asc: o?.ascending !== false }; return this; }
  range(a: number, b: number) { this.rango = [a, b]; return this; }
  maybeSingle() { this.uno = "m"; return this; }
  single() { this.uno = "s"; return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run(): Res {
    let l = tabla(this.t).filter((r) => this.f.every((fn) => fn(r))).map(clon);
    if (this.orden) {
      const { c, asc } = this.orden;
      l.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rango) l = l.slice(this.rango[0], this.rango[1] + 1);
    if (!this.uno) return { data: l, error: null };
    if (l.length > 1 || (this.uno === "s" && l.length === 0)) return { data: null, error: { code: "PGRST116", message: "filas" } };
    return { data: l[0] ?? null, error: null };
  }
}
const cli = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (fn: string, a?: Record<string, unknown>) => unknown };
cli.from = (t: string) => new Q(t);
cli.rpc = (fn: string) => {
  rpcs.push(fn);
  return Promise.resolve({ data: [{ reserva_id: 7001, codigo_id: "c", campania_id: "k" }], error: null });
};
globalThis.fetch = (async (u: unknown) => { throw new Error(`sin red (${String(u).slice(0, 40)})`); }) as typeof fetch;

// ── Instantes ───────────────────────────────────────────────────────────────
const MIN = 60_000;
const C = new Date(CORTE_MODALIDAD_V2_MS);              // 03:00:00Z = 01/10 00:00:00 ART
const B = new Date(CORTE_MODALIDAD_V2_MS - 1000);       // 02:59:59Z = 30/09 23:59:59 ART
const A = new Date(CORTE_MODALIDAD_V2_MS - 90 * MIN);   // 01:30:00Z = 30/09 22:30 ART
const D = new Date(CORTE_MODALIDAD_V2_MS - 12 * 60 * MIN); // 15:00:00Z = 30/09 12:00 ART
const DIEZ_PM = new Date(CORTE_MODALIDAD_V2_MS - 2 * 60 * MIN); // 30/09 22:00 ART
const ONCE_59 = new Date(CORTE_MODALIDAD_V2_MS - MIN);          // 30/09 23:59 ART
const D0 = "2026-09-30";
const D1 = sumarDias(D0, 1);
const utcHoy = (t: Date) => t.toISOString().slice(0, 10); // la fórmula VIEJA, solo para mostrar el error

const CAMP = {
  desdeLegacy: "00000000-0000-4000-8000-0000000b7101", desdeV2: "00000000-0000-4000-8000-0000000b7102",
  hastaLegacy: "00000000-0000-4000-8000-0000000b7103", hastaV2: "00000000-0000-4000-8000-0000000b7104",
};
const COD: Record<keyof typeof CAMP, string> = {
  desdeLegacy: "EMP-TF71-DSDL01", desdeV2: "EMP-TF71-DSDV01", hastaLegacy: "EMP-TF71-HSTL01", hastaV2: "EMP-TF71-HSTV01",
};
const campania = (id: string, modalidad_comercial: string | null, duracion: number, inicio: string, vence: string): Fila => ({
  id, empresa: "Empresa Test B7.1", nombre_campania: null, modalidad: "unica", modalidad_comercial,
  cantidad_contratada: 1, duracion_minutos: duracion, usos_por_codigo: 1, precio_neto: 0, iva_porcentaje: 21,
  estado: "activa", estado_pago: "pagado", fecha_pago: sumarDias(inicio, -1), fecha_inicio: inicio, fecha_vencimiento: vence,
  deleted_at: null, codigos_generados: true, created_at: D0,
});
function reiniciar() {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  TABLAS.modalidad_comercial_config = [{ id: 1, modalidad_override: "legacy", motivo: null, actualizado_por: null, updated_at: null }];
  TABLAS.empresa_campanias = [
    // Vigencia DESDE el 01/10 (inclusive).
    campania(CAMP.desdeLegacy, null, 15, D1, sumarDias(D1, 30)),
    campania(CAMP.desdeV2, "v2_10", 20, D1, sumarDias(D1, 30)),
    // Vigencia HASTA el 30/09 (inclusive).
    campania(CAMP.hastaLegacy, null, 30, sumarDias(D0, -20), D0),
    campania(CAMP.hastaV2, "v2_10", 30, sumarDias(D0, -20), D0),
  ];
  TABLAS.empresa_codigos = (Object.keys(CAMP) as Array<keyof typeof CAMP>).map((k) => ({
    id: randomUUID(), campania_id: CAMP[k], codigo: COD[k], estado: "disponible", usos_actuales: 0, usos_maximos: 1, created_at: D0,
  }));
  TABLAS.empresa_codigo_usos = [];
  TABLAS.reservas = [];
  TABLAS.reserva_slots = [];
  TABLAS.bloqueos_reservas = [];
  rpcs.length = 0;
}

async function main() {
  const server = await import("@/lib/empresasServer");
  type R = { ok: boolean; status?: number; data?: unknown };

  // ── 1. Casos A–D: fecha de Argentina, no UTC ────────────────────────────────
  {
    // Los instantes son exactamente los pedidos (la parte de fecha UTC es D1).
    assert.deepEqual([A, B, C].map((t) => [utcHoy(t), t.toISOString().slice(11, 19)]),
      [[D1, "01:30:00"], [D1, "02:59:59"], [D1, "03:00:00"]]);
    assert.equal(hoyEnSim(A), D0, "A · 01:30Z = 30/09 22:30 ART → 30/09");
    assert.equal(hoyEnSim(B), D0, "B · 02:59:59Z = 30/09 23:59:59 ART → 30/09");
    assert.equal(hoyEnSim(C), D1, "C · 03:00Z = 01/10 00:00 ART → 01/10");
    assert.equal(hoyEnSim(D), D0, "D · mediodía en Argentina → el mismo día");
    // La fórmula vieja (UTC) se equivocaba en A y B.
    assert.equal(utcHoy(A), D1);
    assert.equal(utcHoy(B), D1);
    // Córdoba (la zona de hoyEnSim) y Buenos Aires dan la misma fecha: cada hora
    // durante dos años alrededor de este borde.
    const ba = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" });
    for (let h = -365 * 24; h <= 365 * 24; h++) {
      const t = new Date(CORTE_MODALIDAD_V2_MS + h * 60 * MIN - 30 * MIN);
      assert.equal(hoyEnSim(t), ba.format(t), `Córdoba = Buenos Aires en ${t.toISOString()}`);
    }
  }

  // ── 2. Vigencia DESDE 01/10: no a las 22:00 del 30/09, sí desde las 00:00 ───
  {
    reiniciar();
    for (const k of ["desdeLegacy", "desdeV2"] as const) {
      const campaniaFila = tabla("empresa_campanias").find((c) => c.id === CAMP[k])!;
      assert.equal(estadoEfectivo(campaniaFila, utcHoy(DIEZ_PM)), "activa", "con la fecha UTC se activaba un día antes");
      let r = (await server.validarCodigo(COD[k], DIEZ_PM)) as R;
      assert.equal(r.status, 409, `${k}: 30/09 22:00 ART todavía no rige`);
      r = (await server.disponibilidadConCodigo(COD[k], sumarDias(D1, 7), DIEZ_PM)) as R;
      assert.equal(r.status, 409, `${k}: sin disponibilidad antes de rigir`);
      r = (await server.reservarConCodigo(COD[k], { nombre: "T" }, sumarDias(D1, 7), "12:00", ["Ferrari"], null, DIEZ_PM)) as R;
      assert.equal(r.status, 409, `${k}: no canjea antes de rigir`);
      assert.deepEqual(rpcs, [], "no llega a la base");
      r = (await server.validarCodigo(COD[k], C)) as R;
      assert.ok(r.ok, `${k}: 01/10 00:00 ART ya rige`);
      assert.equal((r.data as { hoy: string }).hoy, D1);
      r = (await server.disponibilidadConCodigo(COD[k], sumarDias(D1, 7), C)) as R;
      assert.ok(r.ok, `${k}: disponibilidad desde las 00:00`);
    }
    // El canje a las 00:00 va a la RPC de la modalidad de cada campaña (la fecha no la cambia).
    let r = (await server.reservarConCodigo(COD.desdeLegacy, { nombre: "T" }, sumarDias(D1, 7), "12:00", ["Ferrari"], null, C)) as R;
    assert.ok(r.ok);
    r = (await server.reservarConCodigo(COD.desdeV2, { nombre: "T" }, sumarDias(D1, 7), "12:10", ["Ferrari"], null, C)) as R;
    assert.ok(r.ok);
    assert.deepEqual(rpcs, ["crear_reserva_empresa", "crear_reserva_empresa_v2"]);
  }

  // ── 3. Vigencia HASTA 30/09: sí a las 23:59 del 30/09, no desde las 00:00 ───
  {
    reiniciar();
    for (const k of ["hastaLegacy", "hastaV2"] as const) {
      const campaniaFila = tabla("empresa_campanias").find((c) => c.id === CAMP[k])!;
      assert.equal(estadoEfectivo(campaniaFila, utcHoy(ONCE_59)), "vencida", "con la fecha UTC vencía tres horas antes");
      for (const t of [A, ONCE_59, B]) {
        const r = (await server.validarCodigo(COD[k], t)) as R;
        assert.ok(r.ok, `${k}: ${t.toISOString()} sigue siendo 30/09 en Argentina`);
        assert.equal((r.data as { hoy: string }).hoy, D0);
      }
      let r = (await server.disponibilidadConCodigo(COD[k], sumarDias(D1, 7), ONCE_59)) as R;
      assert.ok(r.ok, `${k}: disponibilidad hasta las 23:59`);
      r = (await server.validarCodigo(COD[k], C)) as R;
      assert.equal(r.status, 409, `${k}: 01/10 00:00 ART queda fuera de vigencia`);
      r = (await server.reservarConCodigo(COD[k], { nombre: "T" }, sumarDias(D1, 7), "12:00", ["Ferrari"], null, C)) as R;
      assert.equal(r.status, 409, `${k}: no canjea vencida`);
    }
    assert.deepEqual(rpcs, []);
    // A las 23:59 sí canjea, por la RPC de su modalidad.
    let r = (await server.reservarConCodigo(COD.hastaLegacy, { nombre: "T" }, sumarDias(D1, 7), "12:00", ["Ferrari"], null, ONCE_59)) as R;
    assert.ok(r.ok);
    r = (await server.reservarConCodigo(COD.hastaV2, { nombre: "T" }, sumarDias(D1, 7), "12:10", ["Ferrari"], null, ONCE_59)) as R;
    assert.ok(r.ok);
    assert.deepEqual(rpcs, ["crear_reserva_empresa", "crear_reserva_empresa_v2"]);
  }

  // ── 4. Panel: listado y detalle con la misma fecha ──────────────────────────
  {
    reiniciar();
    const estados = async (t: Date) => {
      const r = (await server.listarCampanias({}, t)) as { ok: true; data: Array<{ id: string; estado_efectivo: string }> };
      return Object.fromEntries(r.data.map((c) => [c.id, c.estado_efectivo]));
    };
    assert.deepEqual(await estados(ONCE_59), {
      [CAMP.desdeLegacy]: "programada", [CAMP.desdeV2]: "programada", [CAMP.hastaLegacy]: "activa", [CAMP.hastaV2]: "activa",
    }, "30/09 23:59 ART");
    assert.deepEqual(await estados(C), {
      [CAMP.desdeLegacy]: "activa", [CAMP.desdeV2]: "activa", [CAMP.hastaLegacy]: "vencida", [CAMP.hastaV2]: "vencida",
    }, "01/10 00:00 ART");
    const metricas = async (id: string, t: Date) => ((await server.getCampania(id, t)) as { ok: true; data: { metricas: { estado: string } } }).data.metricas.estado;
    assert.equal(await metricas(CAMP.hastaV2, A), "activa");
    assert.equal(await metricas(CAMP.hastaV2, C), "vencida");
    assert.equal(await metricas(CAMP.desdeLegacy, A), "programada");
    assert.equal(await metricas(CAMP.desdeLegacy, C), "activa");
  }

  // ── 5. Fuentes: ningún "hoy" UTC en Empresas; la base mide igual ────────────
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const HOY_UTC = /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/;
    for (const f of [
      "lib/empresasServer.ts", "lib/empresasComercial.ts", "lib/empresas.ts",
      "app/api/admin/empresas/campanias/route.ts", "app/api/admin/empresas/campanias/[id]/route.ts",
      "app/api/admin/empresas/campanias/[id]/acciones/route.ts", "app/api/admin/empresas/campanias/[id]/codigos/route.ts",
      "app/api/admin/empresas/campanias/[id]/informe/route.ts", "app/api/empresas/validar/route.ts",
      "app/api/empresas/disponibilidad/route.ts", "app/api/empresas/canje/route.ts",
      "app/reservas-empresa/page.tsx", "app/admin/(panel)/codigos/EmpresasTab.tsx",
    ]) {
      assert.ok(!HOY_UTC.test(leer(f)), `${f}: sin "hoy" en UTC`);
      assert.ok(!leer(f).includes("hoyIso"), `${f}: sin hoyIso`);
    }
    assert.ok(leer("app/api/admin/empresas/campanias/[id]/codigos/route.ts").includes("hoyEnSim()"));
    assert.ok(leer("app/admin/(panel)/codigos/EmpresasTab.tsx").includes("fecha_pago: hoyEnSim()"));

    // Las tres RPC de vigencia: sin CURRENT_DATE en los cuerpos y con la fecha de Argentina.
    const sql = leer("db/empresas-b7-1-fecha.sql");
    const cuerpos = [...sql.matchAll(/AS \$function\$([\s\S]*?)\$function\$/gi)].map((m) => m[1]);
    assert.equal(cuerpos.length, 3);
    for (const c of cuerpos) {
      assert.ok(!/current_date/i.test(c), "sin CURRENT_DATE");
      assert.ok(/v_hoy date := \(now\(\) at time zone 'America\/Argentina\/Buenos_Aires'\)::date;/i.test(c), "v_hoy = fecha de Argentina");
      assert.equal((c.match(/v_hoy/g) ?? []).length, 3, "v_hoy declarada y usada para inicio y vencimiento");
    }
    for (const f of ["consumir_empresa_codigo", "crear_reserva_empresa", "crear_reserva_empresa_v2"]) {
      assert.ok(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`).test(sql), `${f}: revoke`);
      assert.ok(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`).test(sql), `${f}: grant`);
    }
  }

  console.log("OK — Empresas B7.1: \"hoy\" con la fecha de Argentina (22:30 y 23:59:59 del 30/09 siguen siendo 30/09; 00:00 es 01/10), vigencia desde/hasta inclusiva en legacy y v2 por validar, disponibilidad, canje, listado y detalle, y RPC sin CURRENT_DATE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
