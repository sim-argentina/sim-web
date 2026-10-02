import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim, sumarDias } from "@/lib/agenda";
import {
  MENSAJE_MONTO_INVALIDO, MONTO_CAMBIO_MAXIMO, guardarCambio, normalizarMonto, resolverFecha, vistaCambio,
} from "@/lib/turneroCambio";

// Turnero del Stand — cambio diario de caja.
// Ejecutar: npx tsx --env-file=.env.local lib/turneroCambio.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA que
// imita la tabla (UNIQUE(fecha), CHECK del monto) y la RPC turnero_cambio_guardar
// (upsert que conserva creado_por y created_at), `fetch` queda bloqueado, el
// reloj se inyecta y la sesión se firma con un secreto DESCARTABLE generado acá
// (nunca el real). Las rutas se prueban de verdad: next/headers se reemplaza por
// un almacén de cookies en memoria.

// ── Base en memoria ─────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type ErrorDb = { code?: string; message: string };
type Resultado = { data: unknown; error: ErrorDb | null };

const T = "turnero_cambio_diario";
const RPC = "turnero_cambio_guardar";
const filas: Fila[] = [];
const operaciones: string[] = [];
/** Todo lo que el código pidió a la base, en todo el test: tablas y RPC. */
const tablasTocadas = new Set<string>();
const rpcLlamadas = new Set<string>();
let fallaSelect: ErrorDb | null = null;
let segundo = 0;

const clonar = (f: Fila): Fila => JSON.parse(JSON.stringify(f));
const escrituras = () => operaciones.filter((o) => !o.startsWith("select:"));

function reiniciar(iniciales: Array<{ fecha: string; monto: number }> = []) {
  filas.length = 0;
  for (const f of iniciales) {
    filas.push({
      id: randomUUID(), fecha: f.fecha, monto: f.monto, creado_por: "staff", actualizado_por: "staff",
      created_at: "2026-09-01T12:00:00.000Z", updated_at: "2026-09-01T12:00:00.000Z",
    });
  }
  operaciones.length = 0;
  fallaSelect = null;
}

class Consulta implements PromiseLike<Resultado> {
  private columnas: string[] = [];
  private filtros: Array<(f: Fila) => boolean> = [];
  private orden: { col: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private uno = false;
  constructor(private readonly t: string) { tablasTocadas.add(t); }

  select(cols = "*") { this.columnas = cols === "*" ? [] : cols.split(",").map((c) => c.trim()); return this; }
  eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
  lt(c: string, v: string) { this.filtros.push((f) => String(f[c]) < v); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orden = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.tope = n; return this; }
  maybeSingle() { this.uno = true; return this; }
  // El módulo escribe SOLO por la RPC: una escritura directa es un error de diseño.
  insert(): never { operaciones.push(`insert:${this.t}`); throw new Error("escritura directa: usar la RPC"); }
  upsert(): never { operaciones.push(`upsert:${this.t}`); throw new Error("escritura directa: usar la RPC"); }
  update(): never { operaciones.push(`update:${this.t}`); throw new Error("escritura directa: usar la RPC"); }
  delete(): never { operaciones.push(`delete:${this.t}`); throw new Error("escritura directa: usar la RPC"); }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(ok, ko);
  }

  private ejecutar(): Resultado {
    operaciones.push(`select:${this.t}`);
    if (fallaSelect) { const e = fallaSelect; fallaSelect = null; return { data: null, error: e }; }
    let out = (this.t === T ? filas : []).filter((f) => this.filtros.every((fn) => fn(f)));
    if (this.orden) {
      const { col, asc } = this.orden;
      out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.tope !== null) out = out.slice(0, this.tope);
    const proyectar = (f: Fila) => (this.columnas.length ? Object.fromEntries(this.columnas.map((c) => [c, f[c]])) : clonar(f));
    if (!this.uno) return { data: out.map(proyectar), error: null };
    if (out.length > 1) return { data: null, error: { code: "PGRST116", message: "más de una fila" } };
    return { data: out[0] ? proyectar(out[0]) : null, error: null };
  }
}

/** La RPC como en db/turnero-cambio-diario.sql: valida y hace el upsert en un solo paso. */
function rpcGuardar(args: { p_fecha?: string; p_monto?: number; p_actor?: string }): Resultado {
  operaciones.push(`rpc:${RPC}:${args.p_fecha}:${args.p_monto}`);
  const actor = String(args.p_actor ?? "").trim();
  if (actor !== "admin" && actor !== "staff") return { data: null, error: { code: "42501", message: "actor_invalido" } };
  if (!args.p_fecha) return { data: null, error: { code: "22023", message: "fecha_requerida" } };
  const m = args.p_monto;
  if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > 10_000_000) {
    return { data: null, error: { code: "22023", message: "monto_invalido" } };
  }
  const ahora = new Date(Date.parse("2026-09-30T12:00:00.000Z") + 1000 * ++segundo).toISOString();
  const existente = filas.find((f) => f.fecha === args.p_fecha);
  if (existente) {
    Object.assign(existente, { monto: m, actualizado_por: actor, updated_at: ahora });
    return { data: clonar(existente), error: null };
  }
  const nueva = { id: randomUUID(), fecha: args.p_fecha, monto: m, creado_por: actor, actualizado_por: actor, created_at: ahora, updated_at: ahora };
  filas.push(nueva);
  return { data: clonar(nueva), error: null };
}

const cliente = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (fn: string, args: unknown) => unknown };
cliente.from = (t: string) => new Consulta(t);
cliente.rpc = (fn: string, args: unknown) => {
  rpcLlamadas.add(fn);
  if (fn !== RPC) throw new Error(`RPC inesperada: ${fn}`);
  return Promise.resolve().then(() => rpcGuardar(args as Parameters<typeof rpcGuardar>[0]));
};

// Nada sale a la red.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`el test no usa la red (${String(input).slice(0, 30)}…)`);
}) as typeof fetch;

const delDia = (fecha: string) => filas.filter((f) => f.fecha === fecha);

async function main() {
  // ── 1. Fecha comercial de Argentina ────────────────────────────────────────
  {
    const casiMedianoche = new Date("2026-10-02T02:59:59Z"); // 01/10 23:59:59 en Argentina
    const medianoche = new Date("2026-10-02T03:00:00Z"); //       02/10 00:00:00 en Argentina
    assert.equal(hoyEnSim(casiMedianoche), "2026-10-01", "02:59:59Z → 01/10");
    assert.equal(hoyEnSim(medianoche), "2026-10-02", "03:00:00Z → 02/10");
    // No depende de la zona del proceso (Vercel corre en UTC).
    const tzOriginal = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Argentina/Buenos_Aires", "Asia/Tokyo", "Etc/GMT+12"]) {
        process.env.TZ = tz;
        assert.equal(hoyEnSim(casiMedianoche), "2026-10-01", `TZ=${tz}`);
        assert.equal(hoyEnSim(medianoche), "2026-10-02", `TZ=${tz}`);
      }
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
    // El guardado usa ESA fecha: el navegador no la manda.
    reiniciar();
    let r = await guardarCambio({ monto: 1000 }, { rol: "staff", ahora: casiMedianoche });
    assert.ok(r.ok && r.data.fecha === "2026-10-01" && r.data.hoy === "2026-10-01");
    r = await guardarCambio({ monto: 2000 }, { rol: "staff", ahora: medianoche });
    assert.ok(r.ok && r.data.fecha === "2026-10-02");
    assert.deepEqual(filas.map((f) => [f.fecha, f.monto]), [["2026-10-01", 1000], ["2026-10-02", 2000]]);
  }

  const MEDIODIA_01 = new Date("2026-10-01T15:00:00Z"); // 01/10 12:00 en Argentina

  // ── 2. Creación: sin registro hoy, 50.000 → 1 fila ─────────────────────────
  {
    reiniciar();
    const r = await guardarCambio({ monto: 50000 }, { rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(r.ok);
    assert.equal(delDia("2026-10-01").length, 1);
    assert.equal(filas.length, 1);
    assert.deepEqual(
      { fecha: r.data.registro?.fecha, monto: r.data.registro?.monto, creado_por: r.data.registro?.creado_por, actualizado_por: r.data.registro?.actualizado_por },
      { fecha: "2026-10-01", monto: 50000, creado_por: "staff", actualizado_por: "staff" },
    );
    assert.equal(escrituras().length, 1, "una sola escritura: la RPC");

    // ── 3. Edición: mismo día 50.000 → 60.000, sigue 1 fila ──────────────────
    const creado = delDia("2026-10-01")[0].created_at;
    const e = await guardarCambio({ monto: 60000 }, { rol: "admin", ahora: MEDIODIA_01 });
    assert.ok(e.ok);
    assert.equal(delDia("2026-10-01").length, 1, "no se duplica");
    assert.equal(delDia("2026-10-01")[0].monto, 60000, "monto final 60.000");
    assert.equal(delDia("2026-10-01")[0].creado_por, "staff", "conserva quién lo creó");
    assert.equal(delDia("2026-10-01")[0].actualizado_por, "admin", "y anota quién lo cambió");
    assert.equal(delDia("2026-10-01")[0].created_at, creado, "conserva created_at");

    // ── 4. Monto 0: válido ───────────────────────────────────────────────────
    const z = await guardarCambio({ monto: 0 }, { rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(z.ok && z.data.registro?.monto === 0, "$0 es un cambio válido");
    assert.equal(filas.length, 1);
  }

  // ── 5. Monto negativo (y cualquier otro inválido): rechazado, 0 escrituras ──
  {
    reiniciar();
    for (const malo of [-1, "-1", 1.5, "1.5", "45.000", "abc", "", null, undefined, Number.NaN, Infinity, true, {}, [], MONTO_CAMBIO_MAXIMO + 1]) {
      const r = await guardarCambio({ monto: malo }, { rol: "admin", ahora: MEDIODIA_01 });
      assert.ok(!r.ok && r.status === 422 && r.codigo === "monto_invalido", `monto ${JSON.stringify(malo)} rechazado`);
      assert.equal(r.ok ? "" : r.error, MENSAJE_MONTO_INVALIDO);
    }
    for (const cuerpo of [null, "50000", 50000, [50000]]) {
      const r = await guardarCambio(cuerpo, { rol: "admin", ahora: MEDIODIA_01 });
      assert.ok(!r.ok && r.status === 400, `cuerpo ${JSON.stringify(cuerpo)} rechazado`);
    }
    assert.deepEqual(escrituras(), [], "ningún inválido escribió");
    assert.equal(filas.length, 0);
    // Lo que sí se acepta.
    assert.equal(normalizarMonto(0), 0);
    assert.equal(normalizarMonto(-0), 0);
    assert.equal(normalizarMonto(45000), 45000);
    assert.equal(normalizarMonto(" 45000 "), 45000);
    assert.equal(normalizarMonto(MONTO_CAMBIO_MAXIMO), MONTO_CAMBIO_MAXIMO);
  }

  // ── 6. Cierre anterior: 29/09 = 30.000, 30/09 = 45.000 → el 01/10, 45.000 ───
  {
    reiniciar([{ fecha: "2026-09-29", monto: 30000 }, { fecha: "2026-09-30", monto: 45000 }]);
    let v = await vistaCambio({ rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(v.ok);
    assert.deepEqual(v.data.anterior, { fecha: "2026-09-30", monto: 45000 }, "el más reciente anterior a hoy");
    assert.equal(v.data.registro, null, "hoy todavía no se registró");
    assert.equal(v.data.fecha, "2026-10-01");
    // Guardar hoy no cambia cuál es el anterior.
    await guardarCambio({ monto: 50000 }, { rol: "staff", ahora: MEDIODIA_01 });
    v = await vistaCambio({ rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(v.ok && v.data.registro?.monto === 50000 && v.data.anterior?.monto === 45000);
    // Con días sin registro en el medio, sigue siendo el más reciente anterior.
    reiniciar([{ fecha: "2026-09-25", monto: 10000 }]);
    v = await vistaCambio({ rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(v.ok);
    assert.deepEqual(v.data.anterior, { fecha: "2026-09-25", monto: 10000 });
    // Un registro de un día POSTERIOR (corrección de admin) no es "anterior".
    reiniciar([{ fecha: "2026-09-30", monto: 45000 }, { fecha: "2026-10-01", monto: 50000 }]);
    v = await vistaCambio({ rol: "admin", fecha: "2026-09-30", ahora: MEDIODIA_01 });
    assert.ok(v.ok && v.data.registro?.monto === 45000 && v.data.anterior === null);
  }

  // ── 7. Sin cambio anterior: estado vacío, no error ─────────────────────────
  {
    reiniciar();
    const v = await vistaCambio({ rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(v.ok);
    assert.equal(v.data.anterior, null);
    assert.equal(v.data.registro, null);
    const ui = readFileSync(join(process.cwd(), "app/admin/(panel)/turnero/CambioEnCaja.tsx"), "utf8");
    assert.ok(ui.includes("Sin cambio anterior registrado."), "la sección lo dice así");
    assert.ok(ui.includes("Cambio del cierre anterior") && ui.includes("Cambio registrado hoy") && ui.includes("Cambio que queda en caja"));
  }

  // ── 8. Concurrencia: dos guardados del mismo día → 1 fila, prevalece el último ─
  {
    reiniciar();
    await Promise.all([
      guardarCambio({ monto: 70000 }, { rol: "staff", ahora: MEDIODIA_01 }),
      guardarCambio({ monto: 80000 }, { rol: "admin", ahora: MEDIODIA_01 }),
    ]);
    assert.equal(delDia("2026-10-01").length, 1, "una sola fila");
    const ultima = escrituras().filter((o) => o.startsWith("rpc:")).at(-1)!;
    assert.equal(String(delDia("2026-10-01")[0].monto), ultima.split(":").at(-1), "prevalece el último guardado");
  }

  // ── 9. Fecha pedida: staff solo hoy; admin otro día, nunca futuro ──────────
  {
    const ok = (r: ReturnType<typeof resolverFecha>) => (r.ok ? r.fecha : `${r.status}:${r.codigo}`);
    assert.equal(ok(resolverFecha(undefined, "staff", MEDIODIA_01)), "2026-10-01");
    assert.equal(ok(resolverFecha("", "staff", MEDIODIA_01)), "2026-10-01");
    assert.equal(ok(resolverFecha("2026-10-01", "staff", MEDIODIA_01)), "2026-10-01", "mandar hoy es inocuo");
    assert.equal(ok(resolverFecha("2026-09-30", "staff", MEDIODIA_01)), "403:fecha_no_permitida");
    assert.equal(ok(resolverFecha("2026-09-30", "admin", MEDIODIA_01)), "2026-09-30");
    assert.equal(ok(resolverFecha("2026-10-02", "admin", MEDIODIA_01)), "400:fecha_futura");
    for (const mala of ["2026-02-30", "2026-10-1", "01/10/2026", "hoy", 20261001, {}]) {
      assert.equal(ok(resolverFecha(mala, "admin", MEDIODIA_01)), "400:fecha_invalida", `${JSON.stringify(mala)}`);
    }
    reiniciar();
    const s = await guardarCambio({ monto: 1, fecha: "2026-09-30" }, { rol: "staff", ahora: MEDIODIA_01 });
    assert.ok(!s.ok && s.status === 403);
    const f = await guardarCambio({ monto: 1, fecha: "2026-10-02" }, { rol: "admin", ahora: MEDIODIA_01 });
    assert.ok(!f.ok && f.status === 400);
    assert.deepEqual(escrituras(), [], "ni el staff con otro día ni un día futuro escriben");
    const a = await guardarCambio({ monto: 46000, fecha: "2026-09-30" }, { rol: "admin", ahora: MEDIODIA_01 });
    assert.ok(a.ok && a.data.fecha === "2026-09-30" && a.data.registro?.monto === 46000, "un admin corrige otro día");
    assert.ok(a.ok && a.data.puede_elegir_fecha === true);
  }

  // ── 10. Rutas reales: sesión, permisos, origen y sin caché ─────────────────
  {
    process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
    let cookie: string | undefined;
    const rutaHeaders = require.resolve("next/headers");
    require.cache[rutaHeaders] = {
      id: rutaHeaders, filename: rutaHeaders, loaded: true,
      exports: {
        cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }),
      },
    } as unknown as NodeJS.Module;
    const { createSessionToken } = await import("@/lib/adminSession");
    const tokenAdmin = await createSessionToken("admin");
    const tokenStaff = await createSessionToken("staff");
    const ruta = await import("@/app/api/turnos-stand/cambio/route");
    assert.equal(ruta.dynamic, "force-dynamic");

    // La ruta usa el reloj real: las fechas se calculan igual que el servidor.
    const hoy = hoyEnSim();
    const ayer = sumarDias(hoy, -1);
    const manana = sumarDias(hoy, 1);
    const ORIGEN = "https://simexperience.com.ar";
    const get = (q = "") => ruta.GET(new Request(`${ORIGEN}/api/turnos-stand/cambio${q}`));
    const post = (body: unknown, origin = ORIGEN) =>
      ruta.POST(new Request(`${ORIGEN}/api/turnos-stand/cambio`, {
        method: "POST", headers: { "content-type": "application/json", origin },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }));
    const sinCache = (r: Response) => assert.equal(r.headers.get("cache-control"), "no-store, max-age=0");

    reiniciar([{ fecha: ayer, monto: 45000 }]);
    cookie = undefined;
    assert.equal((await get()).status, 401, "GET sin sesión");
    assert.equal((await post({ monto: 50000 })).status, 401, "POST sin sesión");
    cookie = tokenAdmin;
    assert.equal((await post({ monto: 50000 }, "https://otro.example")).status, 403, "POST desde otro origen");
    assert.deepEqual(escrituras(), [], "nada rechazado escribió");

    // Staff: hoy y el cierre anterior; no elige otro día.
    cookie = tokenStaff;
    let res = await get();
    assert.equal(res.status, 200);
    sinCache(res);
    let json = await res.json();
    assert.deepEqual(Object.keys(json).sort(), ["anterior", "fecha", "hoy", "puede_elegir_fecha", "registro"]);
    assert.deepEqual([json.hoy, json.fecha, json.registro, json.anterior, json.puede_elegir_fecha], [hoy, hoy, null, { fecha: ayer, monto: 45000 }, false]);
    res = await get(`?fecha=${ayer}`);
    assert.equal(res.status, 403, "el staff no ve otro día");
    sinCache(res);
    res = await post({ monto: 1, fecha: ayer });
    assert.equal(res.status, 403, "ni lo corrige");
    res = await post({ monto: -1 });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, MENSAJE_MONTO_INVALIDO);
    res = await post("{no es json");
    assert.equal(res.status, 400);
    assert.deepEqual(escrituras(), [], "nada rechazado escribió");

    res = await post({ monto: 50000 });
    assert.equal(res.status, 200);
    sinCache(res);
    json = await res.json();
    assert.equal(json.registro.monto, 50000);
    assert.equal(json.registro.actualizado_por, "staff", "el actor sale de la sesión");
    assert.equal(json.anterior.monto, 45000);
    // Un nombre mandado por el navegador no cuenta.
    res = await post({ monto: 55000, actualizado_por: "admin", creado_por: "Juan", actor: "admin" });
    json = await res.json();
    assert.equal(json.registro.actualizado_por, "staff");
    assert.equal(delDia(hoy).length, 1);
    assert.equal(delDia(hoy)[0].creado_por, "staff");

    // Admin: ve y corrige otro día; nunca uno futuro.
    cookie = tokenAdmin;
    res = await get(`?fecha=${ayer}`);
    assert.equal(res.status, 200);
    json = await res.json();
    assert.deepEqual([json.fecha, json.registro.monto, json.puede_elegir_fecha], [ayer, 45000, true]);
    res = await post({ monto: 46000, fecha: ayer });
    assert.equal(res.status, 200);
    assert.equal(delDia(ayer)[0].monto, 46000);
    assert.equal(delDia(ayer)[0].actualizado_por, "admin");
    const antes = escrituras().length;
    assert.equal((await post({ monto: 1, fecha: manana })).status, 400, "día futuro");
    assert.equal((await get(`?fecha=${manana}`)).status, 400);
    assert.equal((await post({ monto: 1, fecha: "2026-02-30" })).status, 400, "fecha inexistente");
    assert.equal(escrituras().length, antes, "ninguno escribió");

    // Dos guardados simultáneos por la ruta: 1 fila.
    await Promise.all([post({ monto: 61000 }), post({ monto: 62000 })]);
    assert.equal(delDia(hoy).length, 1);
    assert.ok([61000, 62000].includes(Number(delDia(hoy)[0].monto)));

    // Una caída de la base no expone el detalle.
    fallaSelect = { message: "relation secreta no existe" };
    res = await get();
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(await res.json()).includes("secreta"), "sin detalle interno");
  }

  // ── 11. Solo su tabla y su RPC: nada de Finanzas, Métricas, IA ni V2 ───────
  {
    assert.deepEqual([...tablasTocadas], [T], `solo se lee ${T}`);
    assert.deepEqual([...rpcLlamadas], [RPC], `solo se escribe por ${RPC}`);
    for (const fecha of new Set(filas.map((f) => String(f.fecha)))) assert.equal(delDia(fecha).length, 1, "UNIQUE(fecha)");

    const ROOT = process.cwd();
    const leer = (f: string) => readFileSync(join(ROOT, f), "utf8");
    const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const importsDe = (f: string) => [...leer(f).matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]).sort();

    // Lo que importa cada pieza, y nada más.
    assert.deepEqual(importsDe("lib/turneroCambio.ts"), ["@/lib/adminSession", "@/lib/agenda", "@/lib/supabaseAdmin"]);
    assert.match(leer("lib/turneroCambio.ts"), /^import type \{ AdminRole \} from "@\/lib\/adminSession";$/m, "de la sesión, solo el tipo");
    assert.deepEqual(importsDe("app/api/turnos-stand/cambio/route.ts"),
      ["@/lib/adminGuards", "@/lib/apiError", "@/lib/originCheck", "@/lib/turneroCambio", "next/server"]);
    assert.deepEqual(importsDe("app/admin/(panel)/turnero/CambioEnCaja.tsx"), ["react"], "el navegador no importa nada del servidor");

    // Ni tablas ni conceptos de otros dominios en el código (los comentarios explican qué NO es).
    const AJENOS = /\b(fin_[a-z_]+|finanzas|metricas|mercadopago|turnos_stand|turnos_historicos|reservas?|reserva_slots|gift_cards?|mensualidad\w*|empresa_\w+|codigos_descuento|modalidad\w*|catalogo\w*|precio\w*|ia_\w+|colectivo_\w+|campeonato_\w+)\b/i;
    for (const f of ["lib/turneroCambio.ts", "app/api/turnos-stand/cambio/route.ts", "app/admin/(panel)/turnero/CambioEnCaja.tsx"]) {
      const m = sinComentarios(leer(f)).match(AJENOS);
      assert.equal(m, null, `${f}: no toca ${m?.[0]}`);
    }
    const lib = sinComentarios(leer("lib/turneroCambio.ts"));
    assert.ok(lib.includes(`const TABLA = "${T}"`) && lib.includes(`const RPC_GUARDAR = "${RPC}"`));
    assert.equal((lib.match(/\.from\(/g) ?? []).length, 2, "dos lecturas");
    assert.ok(!/\.from\(\s*["']/.test(lib) && !/\.rpc\(\s*["']/.test(lib), "las tablas/RPC salen de las constantes");
    assert.ok(!/\.(insert|upsert|update|delete)\(/.test(lib), "escribe solo por la RPC");

    // Nadie más lo usa: ni Finanzas, ni Métricas, ni la IA, ni el resumen del día.
    const MARCAS = /turnero_cambio_diario|turnero_cambio_guardar|turneroCambio|\/api\/turnos-stand\/cambio|CambioEnCaja/;
    const PERMITIDOS = new Set([
      "lib/turneroCambio.ts", "lib/turneroCambio.test.ts", "app/api/turnos-stand/cambio/route.ts",
      "app/admin/(panel)/turnero/CambioEnCaja.tsx", "app/admin/(panel)/turnero/page.tsx",
      "db/turnero-cambio-diario.sql", "db/turnero-cambio-diario.verificacion.sql",
      // La guarda B0 solo NOMBRA este test, para justificar la fecha de ejemplo 01/10.
      "lib/modalidadComercial.test.ts",
    ]);
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (/\.(ts|tsx|mts|js|mjs|sql|json)$/.test(e)) archivos.push(relative(ROOT, p).split(sep).join("/"));
      }
    };
    for (const c of ["app", "lib", "components", "data", "db", "tests"]) if (existsSync(join(ROOT, c))) recorrer(join(ROOT, c));
    assert.ok(archivos.length > 300);
    const usan = archivos.filter((f) => MARCAS.test(leer(f)));
    assert.deepEqual(usan.filter((f) => !PERMITIDOS.has(f)), [], "solo el Turnero usa el cambio en caja");
    assert.deepEqual([...PERMITIDOS].filter((f) => !usan.includes(f)), [], "y todas sus piezas existen");

    // La página del Turnero solo monta la sección: no la lee ni la suma al resumen.
    const pagina = leer("app/admin/(panel)/turnero/page.tsx");
    assert.equal(pagina.split("<CambioEnCaja />").length - 1, 1, "se monta una vez");
    assert.ok(/^import CambioEnCaja from "\.\/CambioEnCaja";\r?$/m.test(pagina));
    assert.ok(!/turnero_cambio|\/api\/turnos-stand\/cambio/.test(pagina), "la página no consulta el cambio");
    assert.ok(pagina.indexOf("<CambioEnCaja />") > pagina.indexOf("Resumen del día"), "al final, después del resumen");

    // La sección no decide la fecha: manda `fecha` solo si un admin eligió otro día.
    const ui = sinComentarios(leer("app/admin/(panel)/turnero/CambioEnCaja.tsx"));
    assert.ok(/^\s*["']use client["']/.test(leer("app/admin/(panel)/turnero/CambioEnCaja.tsx")));
    assert.ok(!/hoyEnSim|new Date\(\)/.test(ui), "sin reloj del navegador para la fecha");
    assert.ok(ui.includes("if (vista.fecha !== vista.hoy) cuerpo.fecha = vista.fecha;"));

    // La migración solo crea lo suyo: no toca ninguna tabla existente. Sin
    // comentarios ni textos entre comillas (el comentario de la tabla explica
    // justamente qué NO es).
    const sql = leer("db/turnero-cambio-diario.sql").replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
    for (const m of sql.matchAll(/\b(?:create table(?: if not exists)?|alter table|comment on table|on table|insert into|update|delete from|truncate)\s+(public\.\w+)/gi)) {
      assert.equal(m[1], `public.${T}`, `la migración solo toca ${T}: ${m[0]}`);
    }
    for (const m of sql.matchAll(/\bfunction\s+(public\.\w+)/gi)) assert.equal(m[1], `public.${RPC}`);
    assert.equal(sql.match(AJENOS), null, "sin referencias a otros dominios");
    assert.ok(/unique \(fecha\)/.test(sql) && /check \(monto >= 0/.test(sql) && /enable row level security/.test(sql));
    assert.ok(!/create policy/i.test(sql), "deny by default: sin policies");
    assert.ok(/revoke all on table public\.turnero_cambio_diario from public, anon, authenticated/.test(sql));
    assert.ok(/on conflict \(fecha\) do update/.test(sql), "upsert atómico");
  }

  console.log("OK — Turnero: cambio diario de caja (fecha Argentina, 1 fila por día, edición, $0 válido, negativos rechazados sin escribir, cierre anterior, permisos staff/admin, concurrencia, sin Finanzas/Métricas/IA/V2).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
