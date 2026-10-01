import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Bloque final — Home y Viví SIM con la oferta VIGENTE.
// Ejecutar: npx tsx --env-file=.env.local lib/ofertaPublicaFinal.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA y `fetch`
// queda bloqueado. La modalidad se cambia con el override de la base falsa (nunca
// la real) y las fechas de los precios se derivan de CORTE_MODALIDAD_V2_MS.

type Fila = Record<string, unknown>;
type Res = { data: unknown; error: { message: string } | null };
const TABLAS: Record<string, Fila[]> = {};
const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let romperPlanes = false;

class Q implements PromiseLike<Res> {
  private f: Array<(r: Fila) => boolean> = [];
  private uno = false;
  private orden: string | null = null;
  constructor(private t: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.f.push((r) => String(r[c]) === String(v)); return this; }
  in(c: string, v: unknown[]) { this.f.push((r) => v.map(String).includes(String(r[c]))); return this; }
  order(c: string) { this.orden ??= c; return this; }
  maybeSingle() { this.uno = true; return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run(): Res {
    if (romperPlanes && this.t === "mensualidad_planes") return { data: null, error: { message: "caída simulada" } };
    const l = (TABLAS[this.t] ?? []).filter((r) => this.f.every((fn) => fn(r))).map(clon);
    if (this.orden) { const c = this.orden; l.sort((a, b) => Number(a[c]) - Number(b[c])); }
    if (this.uno) return { data: l[0] ?? null, error: null };
    return { data: l, error: null };
  }
}
const cli = supabaseAdmin as unknown as { from: (t: string) => unknown };
cli.from = (t: string) => new Q(t);
globalThis.fetch = (async (u: unknown) => { throw new Error(`sin red (${String(u).slice(0, 40)})`); }) as typeof fetch;

function override(m: "legacy" | "v2_10" | null) {
  TABLAS.modalidad_comercial_config = [{ id: 1, modalidad_override: m, motivo: null, actualizado_por: null, updated_at: null }];
}

async function main() {
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const { CORTE_MODALIDAD_V2_MS } = await import("@/lib/modalidadComercial");
  const T = await import("@/lib/ofertaPublicaTexto");
  const { ofertaPublicaVigente } = await import("@/lib/ofertaPublica");

  // Planes y versiones de precio como los reales: legacy antes del corte, v2 desde el corte.
  const antes = new Date(CORTE_MODALIDAD_V2_MS - 30 * 86_400_000).toISOString();
  const corte = new Date(CORTE_MODALIDAD_V2_MS).toISOString();
  TABLAS.mensualidad_planes = [
    { id: "p1", slug: "1h", nombre: "1 hora", minutos: 60, precio: 30000, vigencia_dias: 30, etiqueta: null, orden: 1, activo: true },
    { id: "p2", slug: "2h", nombre: "2 horas", minutos: 120, precio: 55000, vigencia_dias: 30, etiqueta: null, orden: 2, activo: true },
    { id: "p4", slug: "4h", nombre: "4 horas", minutos: 240, precio: 100000, vigencia_dias: 30, etiqueta: null, orden: 3, activo: true },
  ];
  TABLAS.mensualidad_plan_precios = [
    { plan_id: "p1", precio: 30000, vigente_desde: antes }, { plan_id: "p2", precio: 55000, vigente_desde: antes }, { plan_id: "p4", precio: 100000, vigente_desde: antes },
    { plan_id: "p1", precio: 38000, vigente_desde: corte }, { plan_id: "p2", precio: 70000, vigente_desde: corte }, { plan_id: "p4", precio: 128000, vigente_desde: corte },
  ];

  // ── 1. Textos (puros) ────────────────────────────────────────────────────────
  {
    assert.equal(T.listaDuraciones([15, 30]), "15 y 30");
    assert.equal(T.listaDuraciones([30, 10, 20]), "10, 20 y 30");
    assert.equal(T.listaDuraciones([30]), "30");
    assert.equal(T.listaDuraciones([]), "");
    assert.equal(T.duracionesCompactas([15, 30]), "15 / 30", "legacy: exactamente lo que mostraba Viví SIM");
    assert.equal(T.duracionesCompactas([10, 20, 30]), "10/20/30");
    assert.equal(T.precioDesde([55000, 30000, 100000]), 30000);
    assert.equal(T.precioDesde([0, -1]), null);
    assert.deepEqual([T.formatoPrecio(30000), T.formatoPrecio(12000), T.formatoPrecio(38000), T.formatoPrecio(10000), T.formatoPrecio(128000)],
      ["$30.000", "$12.000", "$38.000", "$10.000", "$128.000"]);
  }

  // ── 2. Viví SIM: legacy hoy, v2 en el request siguiente (sin caché) ──────────
  const ahora = new Date(CORTE_MODALIDAD_V2_MS + 3_600_000); // ya pasó el corte, como hoy
  const textos = async () => {
    const o = await ofertaPublicaVigente({ conMensualidades: true, ahora });
    return {
      modalidad: o.modalidad,
      duracion: T.duracionesCompactas(o.reservas.duraciones),
      mensualidades: o.mensualidades?.desde != null ? T.formatoPrecio(o.mensualidades.desde) : "—",
      giftCards: o.giftCards.desde != null ? T.formatoPrecio(o.giftCards.desde) : "—",
    };
  };
  {
    override("legacy");
    assert.deepEqual(await textos(), { modalidad: "legacy", duracion: "15 / 30", mensualidades: "$30.000", giftCards: "$12.000" },
      "con override legacy, exactamente lo de hoy");
    // Se quita el override: el request SIGUIENTE ya es v2 (nada retiene lo anterior).
    override(null);
    assert.deepEqual(await textos(), { modalidad: "v2_10", duracion: "10/20/30", mensualidades: "$38.000", giftCards: "$10.000" },
      "sin override: v2 inmediatamente");
    // Rollback: vuelve a legacy en el request siguiente.
    override("legacy");
    assert.equal((await textos()).mensualidades, "$30.000", "rollback inmediato");
    // Antes del corte y sin override: legacy (calendario).
    override(null);
    const previo = await ofertaPublicaVigente({ conMensualidades: true, ahora: new Date(CORTE_MODALIDAD_V2_MS - 1) });
    assert.deepEqual([previo.modalidad, previo.mensualidades?.desde], ["legacy", 30000]);
    // Sin la flag de Mensualidades, ni se consulta.
    assert.equal((await ofertaPublicaVigente({ conMensualidades: false, ahora })).mensualidades, null);
    // Una caída de la base no rompe la página: la tarjeta muestra "—".
    romperPlanes = true;
    assert.equal((await textos()).mensualidades, "—");
    romperPlanes = false;
  }

  // ── 3. Home: la fuente dinámica de las sesiones cambia en el request siguiente ─
  {
    const ruta = await import("@/app/api/reservas/catalogo/route");
    const pedir = async () => {
      const res = await ruta.GET(new Request("https://simexperience.com.ar/api/reservas/catalogo"));
      assert.equal(res.headers.get("cache-control"), "no-store, max-age=0", "nada en el camino puede retenerla");
      const d = await res.json();
      return `${T.listaDuraciones(d.duraciones)} minutos`;
    };
    override("legacy");
    assert.equal(await pedir(), "15 y 30 minutos", "Home con override legacy");
    override(null);
    assert.equal(await pedir(), "10, 20 y 30 minutos", "Home sin override: v2 en el request siguiente");
    override("legacy");
    assert.equal(await pedir(), "15 y 30 minutos");
  }

  // ── 4. Fuentes: ningún valor comercial escrito a mano ni retenido por caché ───
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const home = sinComentarios(leer("app/page.tsx"));
    assert.ok(!/15 y 30|10, 20 y 30|\d+ minutos/.test(home), "la Home no escribe las duraciones");
    assert.ok(home.includes("<SesionesVigentes />"));
    const componente = leer("components/SesionesVigentes.tsx");
    assert.ok(/^"use client"/.test(componente) && componente.includes('fetch("/api/reservas/catalogo", { cache: "no-store" })'));
    assert.ok(!/["']@\/lib\/(modalidadComercial|catalogoComercial)["']/.test(componente), "el navegador no resuelve la modalidad");
    assert.ok(!/\b(10|15|20|30)\b/.test(sinComentarios(componente)), "ni duraciones fijas");
    const vivi = sinComentarios(leer("app/vivi-sim/page.tsx"));
    assert.ok(/export const dynamic = "force-dynamic"/.test(vivi) && !/export const revalidate/.test(vivi), "Viví SIM se arma en cada request");
    assert.ok(vivi.includes("ofertaPublicaVigente("));
    assert.ok(!/\$\s?\d{1,3}\.\d{3}|15 \/ 30|10\/20\/30/.test(vivi), "Viví SIM no escribe precios ni duraciones");
    const ruta = sinComentarios(leer("app/api/reservas/catalogo/route.ts"));
    assert.ok(/export const dynamic = "force-dynamic"/.test(ruta) && ruta.includes("no-store"), "la fuente de la Home no se cachea");
  }

  console.log("OK — Bloque final: Home y Viví SIM desde los catálogos vigentes (legacy 15/30 · $30.000 · $12.000; v2 10/20/30 · $38.000 · $10.000), cambio y rollback en el request siguiente, sin caché que retenga, sin textos comerciales fijos.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
