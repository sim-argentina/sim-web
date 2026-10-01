import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS } from "@/lib/modalidadComercial";
import { hoyEnSim, sumarDias } from "@/lib/agenda";

// Empresas B7 — modalidad comercial por campaña y agenda de 10 minutos.
// Ejecutar: npx tsx --env-file=.env.local lib/empresasB7.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA, `fetch`
// queda bloqueado y las RPC se interceptan (se registra con qué se llamaron).
// Se prueban los módulos y las RUTAS reales (públicas y del panel, esta última
// con una sesión firmada con un secreto DESCARTABLE), con el reloj inyectado
// donde la modalidad o la hora dependen del instante. Lo que solo puede probar
// la base (RPC, trigger B1, concurrencia) va aparte, contra la base real y sin
// huella.

type Fila = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };
const TABLAS: Record<string, Fila[]> = {};
const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clon = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const escrituras: string[] = [];
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
// Función (y no rpcs.at(-1)) para que assert.deepEqual(rpcs, []) no angoste el tipo.
const ultimaRpc = () => rpcs[rpcs.length - 1];
// Gancho para simular lo que otro pedido confirma entre dos lecturas.
const DESPUES_DE_LEER: Record<string, () => void> = {};

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
      const nuevas: Fila[] = (Array.isArray(this.val) ? this.val : [this.val as Fila])
        .map((v) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...clon(v) }));
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
    DESPUES_DE_LEER[this.t]?.();
    if (this.orden) {
      const { c, asc } = this.orden;
      l.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rango) l = l.slice(this.rango[0], this.rango[1] + 1);
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
const ANTES = new Date(CORTE_MODALIDAD_V2_MS - 1);            // 30/09 23:59:59.999 ART
const DESPUES = new Date(CORTE_MODALIDAD_V2_MS + 60_000);     // 01/10 00:01 ART
const HOY_REAL = hoyEnSim(new Date());
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();
const proximo = (dow: number, desde: string) => { let f = desde; while (diaSemana(f) !== dow) f = sumarDias(f, 1); return f; };
// Fechas futuras respecto del reloj real (el canje público no acepta el pasado).
const MIERCOLES = proximo(3, sumarDias(HOY_REAL, 7));
const SABADO = proximo(6, sumarDias(HOY_REAL, 7));
// Relojes para esas fechas: la modalidad de la CAMPAÑA manda, no el instante.
const EN = (fecha: string, hhmm: string) => new Date(`${fecha}T${hhmm}:00-03:00`);

const CAMP_LEGACY = "00000000-0000-4000-8000-00000000b701";
const CAMP_V2 = "00000000-0000-4000-8000-00000000b702";
const CAMP_V2_30 = "00000000-0000-4000-8000-00000000b703";
const CAMP_LEGACY_30 = "00000000-0000-4000-8000-00000000b704";
const COD = { legacy: "EMP-TB7L-000001", v2: "EMP-TB7V-000001", v230: "EMP-TB7V-000030", legacy30: "EMP-TB7L-000030" };

const campania = (id: string, modalidad_comercial: string | null, duracion: number): Fila => ({
  id, empresa: "Empresa Test B7", nombre_campania: null, modalidad: "unica", modalidad_comercial,
  cantidad_contratada: 5, duracion_minutos: duracion, usos_por_codigo: 1, precio_neto: 0, iva_porcentaje: 21,
  estado: "activa", estado_pago: "pagado", fecha_pago: sumarDias(HOY_REAL, -2),
  fecha_inicio: sumarDias(HOY_REAL, -1), fecha_vencimiento: sumarDias(HOY_REAL, 60),
  deleted_at: null, codigos_generados: true, created_at: new Date(CORTE_MODALIDAD_V2_MS - 86_400_000).toISOString(),
});
const codigo = (campania_id: string, cod: string): Fila => ({
  id: randomUUID(), campania_id, codigo: cod, estado: "disponible", usos_actuales: 0, usos_maximos: 1,
  created_at: new Date(CORTE_MODALIDAD_V2_MS - 86_400_000).toISOString(),
});
const reserva = (id: number, fecha: string, hora: string, duracion: number, sims: string[], extra: Fila = {}): Fila => ({
  id, fecha, hora, duracion_minutos: duracion, simuladores: sims, estado: "activa",
  created_at: new Date(CORTE_MODALIDAD_V2_MS - 86_400_000).toISOString(), modalidad: null, origen: "web", ...extra,
});
const slot = (reserva_id: number, fecha: string, hora: string, simulador: string, ocupacion_min: number | null = null): Fila => ({
  reserva_id, fecha, hora, simulador, estado: "activa", ocupacion_min,
});

function reiniciar(extra: Record<string, Fila[]> = {}, override: string | null = null) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  TABLAS.modalidad_comercial_config = [{ id: 1, modalidad_override: override, motivo: null, actualizado_por: null, updated_at: new Date(CORTE_MODALIDAD_V2_MS).toISOString() }];
  TABLAS.empresa_campanias = [
    campania(CAMP_LEGACY, null, 15), campania(CAMP_V2, "v2_10", 20),
    campania(CAMP_V2_30, "v2_10", 30), campania(CAMP_LEGACY_30, null, 30),
  ];
  TABLAS.empresa_codigos = [
    codigo(CAMP_LEGACY, COD.legacy), codigo(CAMP_V2, COD.v2), codigo(CAMP_V2_30, COD.v230), codigo(CAMP_LEGACY_30, COD.legacy30),
  ];
  TABLAS.empresa_codigo_usos = [];
  TABLAS.reservas = [];
  TABLAS.reserva_slots = [];
  TABLAS.bloqueos_reservas = [];
  for (const [k, v] of Object.entries(extra)) TABLAS[k] = clon(v);
  escrituras.length = 0; rpcs.length = 0;
  for (const k of Object.keys(RESPUESTAS_RPC)) delete RESPUESTAS_RPC[k];
  for (const k of Object.keys(DESPUES_DE_LEER)) delete DESPUES_DE_LEER[k];
  const creada = (): Res => ({ data: [{ reserva_id: 9001, codigo_id: "cod", campania_id: "camp" }], error: null });
  RESPUESTAS_RPC.crear_reserva_empresa = creada;
  RESPUESTAS_RPC.crear_reserva_empresa_v2 = creada;
  RESPUESTAS_RPC.reprogramar_reserva_empresa = () => ({ data: true, error: null });
  RESPUESTAS_RPC.reprogramar_reserva_empresa_v2 = () => ({ data: true, error: null });
  RESPUESTAS_RPC.cancelar_reserva_empresa = () => ({ data: true, error: null });
}
const escrituraDe = () => escrituras.filter((e) => !e.startsWith("select"));

async function main() {
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];

  const comercial = await import("@/lib/empresasComercial");
  const server = await import("@/lib/empresasServer");
  type R = { ok: boolean; status?: number; error?: string; codigo?: string; data?: unknown; catalogo?: { modalidad: string; duraciones: number[] } };
  const horas = async (cod: string, fecha: string, ahora: Date) => {
    const r = (await server.disponibilidadConCodigo(cod, fecha, ahora)) as R;
    assert.ok(r.ok, `disponibilidad ${cod} ${fecha}: ${r.error}`);
    return (r.data as { horarios: Array<{ hora: string; simuladores: string[] }> }).horarios;
  };
  const libresEn = (hs: Array<{ hora: string; simuladores: string[] }>, hora: string) => hs.find((h) => h.hora === hora)?.simuladores ?? [];
  const canjear = (cod: string, fecha: string, hora: string, sims: string[], ahora: Date, key: string | null = randomUUID()) =>
    server.reservarConCodigo(cod, { nombre: "Test", apellido: "B7", telefono: "000" }, fecha, hora, sims, key, ahora) as Promise<R>;

  // ── 1. Catálogo por modalidad (puro) ────────────────────────────────────────
  {
    assert.deepEqual(comercial.duracionesEmpresa("legacy"), [15, 30]);
    assert.deepEqual(comercial.duracionesEmpresa("v2_10"), [10, 20, 30]);
    assert.equal(comercial.modalidadGuardada(null), "legacy", "NULL = histórica = legacy");
    assert.equal(comercial.modalidadGuardada("legacy"), "legacy");
    assert.equal(comercial.modalidadGuardada("v2_10"), "v2_10");
    assert.equal(comercial.mensajeDuracionEmpresa("legacy"), "Elegí una duración de 15 o 30 minutos.");
    assert.equal(comercial.mensajeDuracionEmpresa("v2_10"), "Elegí una duración de 10, 20 o 30 minutos.");
    for (const d of [10, 20, 45, 60, 0, " 15"]) assert.ok(!comercial.duracionEmpresaValida("legacy", d), `legacy no vende ${d}`);
    for (const d of [15, 45, 60, 25]) assert.ok(!comercial.duracionEmpresaValida("v2_10", d), `v2 no vende ${d}`);
    for (const d of [15, 30]) assert.ok(comercial.duracionEmpresaValida("legacy", d));
    for (const d of [10, 20, 30]) assert.ok(comercial.duracionEmpresaValida("v2_10", d));
    reiniciar();
    assert.equal((await comercial.catalogoEmpresasVigente(ANTES)).modalidad, "legacy", "23:59:59.999 → legacy");
    assert.equal((await comercial.catalogoEmpresasVigente(new Date(CORTE_MODALIDAD_V2_MS))).modalidad, "v2_10", "00:00:00.000 → v2");
    reiniciar({}, "legacy");
    assert.equal((await comercial.catalogoEmpresasVigente(DESPUES)).modalidad, "legacy", "rollback: override legacy");
  }

  // ── 2. Alta: modalidad resuelta UNA vez y guardada; 409 con 0 escrituras ─────
  const cuerpo = (duracion: number, vista?: string): Fila => ({
    empresa: "Empresa Alta B7", modalidad: "unica", cantidad_contratada: 3, duracion_minutos: duracion,
    usos_por_codigo: 1, precio_neto: 1000, iva_porcentaje: 21, fecha_inicio: null,
    ...(vista === undefined ? {} : { modalidad_vista: vista }),
  });
  const nuevas = () => tabla("empresa_campanias").filter((c) => c.empresa === "Empresa Alta B7");
  {
    // Antes del corte: legacy 15/30.
    reiniciar();
    let r = (await server.crearCampania(cuerpo(15, "legacy"), "admin", ANTES)) as R;
    assert.ok(r.ok, "alta legacy 15");
    assert.equal(nuevas()[0].modalidad_comercial, "legacy", "se guarda legacy");
    assert.equal(nuevas()[0].estado, "borrador");
    reiniciar();
    r = (await server.crearCampania(cuerpo(20, "legacy"), "admin", ANTES)) as R;
    assert.equal(r.status, 400, "legacy no acepta 20");
    assert.equal(r.error, "Elegí una duración de 15 o 30 minutos.");
    assert.deepEqual(escrituraDe(), [], "400 sin escrituras");
    // Pestaña anterior a B7 (sin modalidad_vista) antes del corte: legacy, como siempre.
    reiniciar();
    r = (await server.crearCampania(cuerpo(30), "admin", ANTES)) as R;
    assert.ok(r.ok, "sin modalidad_vista antes del corte = legacy");
    assert.equal(nuevas()[0].modalidad_comercial, "legacy");

    // Después del corte: v2 10/20/30; 15 no existe.
    for (const d of [10, 20, 30]) {
      reiniciar();
      r = (await server.crearCampania(cuerpo(d, "v2_10"), "admin", DESPUES)) as R;
      assert.ok(r.ok, `alta v2 ${d}`);
      assert.equal(nuevas()[0].modalidad_comercial, "v2_10", "se guarda v2_10");
      assert.equal(nuevas()[0].duracion_minutos, d);
    }
    reiniciar();
    r = (await server.crearCampania(cuerpo(15, "v2_10"), "admin", DESPUES)) as R;
    assert.equal(r.status, 400, "v2 rechaza 15");
    assert.equal(r.error, "Elegí una duración de 10, 20 o 30 minutos.");
    assert.deepEqual(escrituraDe(), [], "400 sin escrituras");

    // Pestaña vieja: armada en legacy, confirmada después del corte → 409, 0 escrituras.
    for (const vista of ["legacy", undefined]) {
      reiniciar();
      r = (await server.crearCampania(cuerpo(15, vista), "admin", DESPUES)) as R;
      assert.equal(r.status, 409, `pestaña vieja (${vista ?? "sin campo"}) → 409`);
      assert.equal(r.codigo, "catalogo_actualizado");
      assert.equal(r.error, "Cambió la modalidad comercial. Revisá las duraciones antes de crear la campaña.");
      assert.equal(r.catalogo?.modalidad, "v2_10");
      assert.deepEqual(r.catalogo?.duraciones, [10, 20, 30], "el 409 trae las duraciones vigentes");
      assert.deepEqual(escrituraDe(), [], "409 sin escrituras");
      assert.equal(nuevas().length, 0);
    }
    // Y al revés (override de rollback con una pestaña armada en v2).
    reiniciar({}, "legacy");
    r = (await server.crearCampania(cuerpo(20, "v2_10"), "admin", DESPUES)) as R;
    assert.equal(r.status, 409, "rollback: pestaña v2 → 409");
    assert.deepEqual(escrituraDe(), []);
    reiniciar();
    r = (await server.crearCampania(cuerpo(20, "v3"), "admin", DESPUES)) as R;
    assert.equal(r.status, 400, "modalidad desconocida → 400");
    assert.deepEqual(escrituraDe(), []);

    // El cuerpo NO decide la modalidad guardada.
    reiniciar();
    r = (await server.crearCampania({ ...cuerpo(15, "legacy"), modalidad_comercial: "v2_10" }, "admin", ANTES)) as R;
    assert.ok(r.ok);
    assert.equal(nuevas()[0].modalidad_comercial, "legacy", "modalidad_comercial del cuerpo se ignora");
  }

  // ── 3. Edición: nunca cambia la modalidad; duración contra la PROPIA ─────────
  {
    reiniciar();
    // Legacy existente después del corte: sigue legacy y conserva 15.
    let r = (await server.actualizarCampania(CAMP_LEGACY, { empresa: "Empresa Test B7", duracion_minutos: 15, modalidad_comercial: "v2_10" })) as R;
    assert.ok(r.ok, "editar legacy con su misma duración");
    const legacy = () => tabla("empresa_campanias").find((c) => c.id === CAMP_LEGACY)!;
    assert.equal(legacy().modalidad_comercial, null, "editar no toca modalidad_comercial (sigue NULL)");
    r = (await server.actualizarCampania(CAMP_LEGACY, { empresa: "Empresa Test B7", duracion_minutos: 30 })) as R;
    assert.ok(r.ok, "legacy puede pasar a 30");
    r = (await server.actualizarCampania(CAMP_LEGACY, { empresa: "Empresa Test B7", duracion_minutos: 20 })) as R;
    assert.equal(r.status, 400, "legacy no puede pasar a 20 (aunque ya rija v2)");
    assert.equal(legacy().duracion_minutos, 30);
    r = (await server.actualizarCampania(CAMP_V2, { empresa: "Empresa Test B7", duracion_minutos: 15 })) as R;
    assert.equal(r.status, 400, "v2 no puede pasar a 15");
    r = (await server.actualizarCampania(CAMP_V2, { empresa: "Empresa Test B7", duracion_minutos: 10 })) as R;
    assert.ok(r.ok, "v2 puede pasar a 10");
    assert.equal(tabla("empresa_campanias").find((c) => c.id === CAMP_V2)!.modalidad_comercial, "v2_10");
    // Una duración histórica rara se conserva al editar otros datos.
    TABLAS.empresa_campanias.push({ ...campania("00000000-0000-4000-8000-00000000b7ff", null, 45) });
    r = (await server.actualizarCampania("00000000-0000-4000-8000-00000000b7ff", { empresa: "Otra", duracion_minutos: 45 })) as R;
    assert.ok(r.ok, "la duración que ya tenía siempre vale");
  }

  // ── 4. Legacy: grilla de 20, 15→20, bloques; v2: grilla de 10 ────────────────
  {
    reiniciar();
    const hl = await horas(COD.legacy, MIERCOLES, DESPUES);
    assert.ok(hl.length > 0);
    assert.ok(hl.every((h) => /:(00|20|40)$/.test(h.hora)), "legacy (aun después del corte): solo :00/:20/:40");
    assert.equal(hl[0].hora, "10:00");
    const hv = await horas(COD.v2, MIERCOLES, ANTES);
    assert.ok(hv.some((h) => h.hora === "12:10"), "v2 (aun antes del corte): grilla de 10");
    assert.ok(hv.every((h) => /:[0-5]0$/.test(h.hora)));

    // Cierre v2 de lunes a viernes: 10→21:50, 20→21:40, 30→21:30 (último inicio).
    TABLAS.empresa_campanias.push(campania("00000000-0000-4000-8000-00000000b710", "v2_10", 10));
    TABLAS.empresa_codigos.push(codigo("00000000-0000-4000-8000-00000000b710", "EMP-TB7V-000010"));
    const ultimo = async (cod: string, fecha: string) => (await horas(cod, fecha, ANTES)).at(-1)?.hora;
    assert.equal(await ultimo("EMP-TB7V-000010", MIERCOLES), "21:50", "v2 10 → último 21:50");
    assert.equal(await ultimo(COD.v2, MIERCOLES), "21:40", "v2 20 → último 21:40");
    assert.equal(await ultimo(COD.v230, MIERCOLES), "21:30", "v2 30 → último 21:30");
    // Fin de semana: último inicio 14:00 para cualquier duración v2.
    for (const cod of ["EMP-TB7V-000010", COD.v2, COD.v230]) assert.equal(await ultimo(cod, SABADO), "14:00", `${cod} sábado → 14:00`);
    // Legacy 30 el sábado: 14:00 no (necesitaría un bloque 14:20 que la grilla no tiene), como siempre.
    assert.equal(await ultimo(COD.legacy30, SABADO), "13:40", "legacy 30 sábado → 13:40");
    assert.equal(await ultimo(COD.legacy, SABADO), "14:00", "legacy 15 sábado → 14:00");

    // Canje legacy: RPC legacy con los bloques de 20 (15 → 1 bloque; 30 → 2).
    rpcs.length = 0;
    let r = await canjear(COD.legacy, MIERCOLES, "12:00", ["Ferrari"], DESPUES);
    assert.ok(r.ok, `canje legacy: ${r.error}`);
    assert.equal(ultimaRpc().fn, "crear_reserva_empresa", "campaña legacy → RPC legacy aun después del corte");
    assert.deepEqual(ultimaRpc().args.p_slots, ["12:00"]);
    assert.equal(ultimaRpc().args.p_duracion, 15);
    r = await canjear(COD.legacy30, MIERCOLES, "12:00", ["Ferrari"], DESPUES);
    assert.ok(r.ok);
    assert.deepEqual(ultimaRpc().args.p_slots, ["12:00", "12:20"], "legacy 30 → 12:00 y 12:20");
    // Canje v2: RPC v2, sin bloques (una fila por simulador la arma la base).
    r = await canjear(COD.v2, MIERCOLES, "12:10", ["McLaren"], ANTES);
    assert.ok(r.ok, `canje v2: ${r.error}`);
    assert.equal(ultimaRpc().fn, "crear_reserva_empresa_v2", "campaña v2 → RPC v2 aun antes del corte");
    assert.ok(!("p_slots" in ultimaRpc().args), "v2 no manda bloques");
    assert.equal(ultimaRpc().args.p_duracion, 20);
    // La duración la pone el servidor (la de la campaña), no el cliente.
    assert.deepEqual(Object.keys(ultimaRpc().args).sort(),
      ["p_apellido", "p_codigo", "p_duracion", "p_email", "p_fecha", "p_hora", "p_idempotency_key", "p_nombre", "p_simuladores", "p_telefono"]);
  }

  // ── 5. Legacy 30 vs v2 30: 12:10 inválido en legacy, válido en v2 ────────────
  {
    reiniciar();
    let r = await canjear(COD.legacy30, MIERCOLES, "12:10", ["Ferrari"], DESPUES);
    assert.equal(r.status, 422, "legacy 30 a las 12:10 → 422");
    assert.deepEqual(rpcs, [], "sin RPC");
    r = await canjear(COD.v230, MIERCOLES, "12:10", ["Ferrari"], ANTES);
    assert.ok(r.ok, "v2 30 a las 12:10 → vale");
    assert.equal(ultimaRpc().fn, "crear_reserva_empresa_v2");
    // Fuera de grilla o de cierre → 422 sin RPC.
    rpcs.length = 0;
    for (const [cod, hora] of [[COD.v230, "12:05"], [COD.v230, "21:40"], [COD.v2, "09:50"], [COD.legacy, "22:00"]] as const) {
      r = await canjear(cod, MIERCOLES, hora, ["Ferrari"], ANTES);
      assert.equal(r.status, 422, `${cod} ${hora} → 422`);
    }
    r = await canjear(COD.v230, SABADO, "14:10", ["Ferrari"], ANTES);
    assert.equal(r.status, 422, "v2 sábado 14:10 → 422");
    assert.deepEqual(rpcs, [], "ninguna llegó a la base");
  }

  // ── 6. Agenda unificada: bloqueos, web legacy, Mensualidad v2, pendientes ────
  {
    // Bloqueo 12:20–12:40 en Ferrari vs v2 20 a las 12:00 ([12:00,12:30)).
    reiniciar({ bloqueos_reservas: [{ id: 1, fecha: MIERCOLES, todo_el_dia: false, hora_inicio: "12:20", hora_fin: "12:40", simulador: "Ferrari", activo: true }] });
    let hs = await horas(COD.v2, MIERCOLES, ANTES);
    assert.ok(!libresEn(hs, "12:00").includes("Ferrari"), "v2 20 a las 12:00 toca el bloqueo 12:20");
    assert.ok(libresEn(hs, "12:00").includes("McLaren"), "el bloqueo es de Ferrari solo");
    let r = await canjear(COD.v2, MIERCOLES, "12:00", ["Ferrari"], ANTES);
    assert.equal(r.status, 409, "canje sobre el bloqueo → 409");
    assert.deepEqual(rpcs, [], "sin RPC");
    // v2 10 a las 12:00 termina de ocupar justo a las 12:20: no toca. 12:50 tampoco.
    TABLAS.empresa_campanias.push(campania("00000000-0000-4000-8000-00000000b710", "v2_10", 10));
    TABLAS.empresa_codigos.push(codigo("00000000-0000-4000-8000-00000000b710", "EMP-TB7V-000010"));
    hs = await horas("EMP-TB7V-000010", MIERCOLES, ANTES);
    assert.ok(libresEn(hs, "12:00").includes("Ferrari"), "v2 10 a las 12:00 [12:00,12:20) no toca 12:20–12:40");
    assert.ok(!libresEn(hs, "12:40").includes("Ferrari"), "12:40 (hora_fin inclusiva) sí choca");
    assert.ok(libresEn(hs, "12:50").includes("Ferrari"));
    // Bloqueo de todo el día.
    reiniciar({ bloqueos_reservas: [{ id: 2, fecha: MIERCOLES, todo_el_dia: true, hora_inicio: null, hora_fin: null, simulador: null, activo: true }] });
    assert.deepEqual(await horas(COD.v2, MIERCOLES, ANTES), [], "día bloqueado → sin horarios");
    assert.deepEqual(await horas(COD.legacy, MIERCOLES, ANTES), []);

    // Web legacy 30 a las 12:00 en Ferrari (bloques 12:00 y 12:20 = [12:00,12:40)).
    reiniciar({
      reservas: [reserva(501, MIERCOLES, "12:00", 30, ["Ferrari"])],
      reserva_slots: [slot(501, MIERCOLES, "12:00", "Ferrari"), slot(501, MIERCOLES, "12:20", "Ferrari")],
    });
    hs = await horas(COD.v2, MIERCOLES, ANTES);
    assert.ok(!libresEn(hs, "12:20").includes("Ferrari"), "v2 20 a las 12:20 choca con web legacy hasta 12:40");
    assert.ok(!libresEn(hs, "11:50").includes("Ferrari"), "v2 20 a las 11:50 ([11:50,12:20)) choca");
    assert.ok(libresEn(hs, "11:30").includes("Ferrari"), "v2 20 a las 11:30 ([11:30,12:00)) no choca");
    assert.ok(libresEn(hs, "12:40").includes("Ferrari"), "12:40 libre");
    assert.deepEqual(libresEn(hs, "12:20"), ["McLaren", "Red Bull", "Alpine"], "los otros tres siguen libres");
    const hl = await horas(COD.legacy, MIERCOLES, DESPUES);
    assert.ok(!libresEn(hl, "12:20").includes("Ferrari") && libresEn(hl, "12:40").includes("Ferrari"), "legacy ve lo mismo");

    // Mensualidad v2 12:00 de 20 en McLaren (slot v2: [12:00,12:30)).
    reiniciar({
      reservas: [reserva(502, MIERCOLES, "12:00", 20, ["McLaren"], { modalidad: "v2_10", origen: "mensualidad" })],
      reserva_slots: [slot(502, MIERCOLES, "12:00", "McLaren", 30)],
    });
    hs = await horas(COD.v2, MIERCOLES, ANTES);
    assert.ok(!libresEn(hs, "12:20").includes("McLaren"), "empresa 12:20 choca con la Mensualidad hasta 12:30");
    assert.ok(libresEn(hs, "12:30").includes("McLaren"), "12:30 libre (semiabierto)");
    assert.ok(!libresEn(hs, "11:40").includes("McLaren"), "empresa v2 20 a las 11:40 ([11:40,12:10)) choca");
    hs = await horas(COD.legacy, MIERCOLES, DESPUES);
    assert.ok(!libresEn(hs, "12:20").includes("McLaren"), "legacy 12:20 ([12:20,12:40)) choca con [12:00,12:30)");
    assert.ok(libresEn(hs, "12:40").includes("McLaren"));

    // Otra reserva de Empresa v2 existente (sin slots todavía no pasa: siempre los tiene).
    reiniciar({
      reservas: [reserva(503, MIERCOLES, "15:00", 30, ["Alpine"], { modalidad: "v2_10", origen: "empresa" })],
      reserva_slots: [slot(503, MIERCOLES, "15:00", "Alpine", 40)],
    });
    hs = await horas(COD.v2, MIERCOLES, ANTES);
    assert.ok(!libresEn(hs, "15:30").includes("Alpine") && libresEn(hs, "15:40").includes("Alpine"), "empresa v2 30 ocupa hasta 15:40");

    // Pendiente web vigente retiene; vencida (TTL 15 min) no.
    const ahora = EN(sumarDias(MIERCOLES, -1), "18:00");
    const pendiente = (id: number, minutosAtras: number) =>
      reserva(id, MIERCOLES, "16:00", 30, ["Red Bull"], { estado: "pendiente_pago", modalidad: "v2_10", created_at: new Date(ahora.getTime() - minutosAtras * 60_000).toISOString() });
    reiniciar({ reservas: [pendiente(504, 5)] });
    hs = await horas(COD.v2, MIERCOLES, ahora);
    assert.ok(!libresEn(hs, "16:00").includes("Red Bull"), "pendiente de 5 min retiene el turno");
    r = await canjear(COD.v2, MIERCOLES, "16:10", ["Red Bull"], ahora);
    assert.equal(r.status, 409, "no se canjea encima de una pendiente vigente");
    reiniciar({ reservas: [pendiente(505, 16)] });
    hs = await horas(COD.v2, MIERCOLES, ahora);
    assert.ok(libresEn(hs, "16:00").includes("Red Bull"), "pendiente de 16 min ya no retiene");
    // Reservas canceladas y slots cancelados no ocupan.
    reiniciar({
      reservas: [reserva(506, MIERCOLES, "17:00", 30, ["Ferrari"], { estado: "cancelada" })],
      reserva_slots: [{ ...slot(506, MIERCOLES, "17:00", "Ferrari"), estado: "cancelada" }],
    });
    hs = await horas(COD.v2, MIERCOLES, ANTES);
    assert.ok(libresEn(hs, "17:00").includes("Ferrari"), "lo cancelado libera");
  }

  // ── 7. El público no ve ni toma inicios pasados ─────────────────────────────
  {
    reiniciar();
    const ahora = EN(HOY_REAL, "12:05");
    const hs = await horas(COD.v2, HOY_REAL, ahora);
    assert.ok(hs.length > 0, "hoy quedan horarios después de las 12:05");
    assert.ok(hs.every((h) => h.hora > "12:05"), "solo inicios futuros");
    assert.equal(hs[0].hora, "12:10");
    let r = await canjear(COD.v2, HOY_REAL, "12:00", ["Ferrari"], ahora);
    assert.equal(r.status, 409, "un inicio pasado → 409");
    r = (await server.disponibilidadConCodigo(COD.v2, sumarDias(HOY_REAL, -1), ahora)) as R;
    assert.equal(r.status, 422, "una fecha pasada → 422");
    r = (await server.disponibilidadConCodigo(COD.v2, "2026-02-31", ahora)) as R;
    assert.equal(r.status, 400, "fecha inexistente → 400");
    assert.deepEqual(rpcs, []);
  }

  // ── 8. Canje: código inválido genérico, simuladores, conflicto, idempotencia ─
  {
    reiniciar();
    for (const cod of ["EMP-NOEX-ISTE00", ""]) {
      const r = (await server.disponibilidadConCodigo(cod, MIERCOLES, ANTES)) as R;
      assert.equal(r.error, "Código inválido o no disponible.", "mensaje genérico");
    }
    // Campaña cancelada / código usado: genérico también.
    tabla("empresa_codigos").find((c) => c.codigo === COD.v2)!.estado = "utilizado";
    let r = await canjear(COD.v2, MIERCOLES, "12:10", ["Ferrari"], ANTES);
    assert.equal(r.status, 409);
    assert.equal(r.error, "Código inválido o no disponible.");
    reiniciar();
    for (const sims of [["Ferrari", "Ferrari"], ["Mercedes"], []]) {
      r = await canjear(COD.v2, MIERCOLES, "12:10", sims, ANTES);
      assert.ok(r.status === 400, `simuladores ${JSON.stringify(sims)} → 400`);
    }
    assert.deepEqual(rpcs, []);
    // La base rechaza (carrera): 409 sin fingir la reserva.
    RESPUESTAS_RPC.crear_reserva_empresa_v2 = () => ({ data: [], error: null });
    r = await canjear(COD.v2, MIERCOLES, "12:10", ["Ferrari"], ANTES, null);
    assert.equal(r.status, 409, "la RPC no devolvió filas → 409");
    // Idempotencia: la key que ya creó una reserva la devuelve sin volver a la base.
    reiniciar({ empresa_codigo_usos: [{ id: randomUUID(), codigo_id: "x", campania_id: CAMP_V2, reserva_id: 777, idempotency_key: "key-b7" }] });
    r = await canjear(COD.v2, MIERCOLES, "12:10", ["Ferrari"], ANTES, "key-b7");
    assert.ok(r.ok && (r.data as { reserva_id: number }).reserva_id === 777 && (r.data as { idempotente: boolean }).idempotente);
    assert.deepEqual(rpcs, [], "idempotente: no vuelve a llamar a la RPC");

    // Reintento SIMULTÁNEO con la misma key: entre el chequeo inicial y la
    // evaluación, el otro pedido ya creó la reserva y ocupó el turno. Se
    // devuelve esa reserva, no un 409.
    const carrera = (reservaId: number, key: string) => {
      let lecturas = 0;
      DESPUES_DE_LEER.empresa_codigo_usos = () => {
        if (++lecturas === 1) tabla("empresa_codigo_usos").push({ id: randomUUID(), codigo_id: "x", campania_id: CAMP_V2, reserva_id: reservaId, idempotency_key: key });
      };
    };
    reiniciar({
      reservas: [reserva(801, MIERCOLES, "12:10", 20, ["Ferrari"], { origen: "empresa", modalidad: "v2_10" })],
      reserva_slots: [slot(801, MIERCOLES, "12:10", "Ferrari", 30)],
    });
    carrera(801, "key-carrera-1");
    r = await canjear(COD.v2, MIERCOLES, "12:10", ["Ferrari"], ANTES, "key-carrera-1");
    assert.ok(r.ok && (r.data as { reserva_id: number }).reserva_id === 801 && (r.data as { idempotente: boolean }).idempotente,
      "turno ya tomado por el mismo canje → la reserva, no 409");
    // Y si lo que ya figura es el código usado.
    reiniciar();
    tabla("empresa_codigos").find((c) => c.codigo === COD.v2)!.estado = "utilizado";
    carrera(802, "key-carrera-2");
    r = await canjear(COD.v2, MIERCOLES, "12:10", ["Ferrari"], ANTES, "key-carrera-2");
    assert.ok(r.ok && (r.data as { reserva_id: number }).reserva_id === 802, "código ya usado por el mismo canje → la reserva");
    // Sin key (o con otra) sigue siendo 409.
    reiniciar();
    tabla("empresa_codigos").find((c) => c.codigo === COD.v2)!.estado = "utilizado";
    carrera(803, "otra-key");
    r = await canjear(COD.v2, MIERCOLES, "12:10", ["Ferrari"], ANTES, "key-distinta");
    assert.equal(r.status, 409, "otra key → 409");
    assert.deepEqual(rpcs, []);
  }

  // ── 9. Reprogramación con la modalidad de la RESERVA ─────────────────────────
  {
    const empresaLegacy = reserva(601, MIERCOLES, "12:00", 15, ["Ferrari"], { origen: "empresa", modalidad: "legacy" });
    const empresaV2 = reserva(602, MIERCOLES, "14:00", 20, ["McLaren"], { origen: "empresa", modalidad: "v2_10" });
    const historica = reserva(603, MIERCOLES, "16:00", 30, ["Alpine"], { origen: "empresa", modalidad: null });
    const base = {
      reservas: [empresaLegacy, empresaV2, historica],
      reserva_slots: [slot(601, MIERCOLES, "12:00", "Ferrari"), slot(602, MIERCOLES, "14:00", "McLaren", 30),
        slot(603, MIERCOLES, "16:00", "Alpine"), slot(603, MIERCOLES, "16:20", "Alpine")],
    };
    reiniciar(base);
    // Legacy después del corte: grilla de 20 y RPC legacy con bloques.
    let r = (await server.reprogramarReservaEmpresa(601, MIERCOLES, "12:20", ["Ferrari"], DESPUES)) as R;
    assert.ok(r.ok, `reprogramar legacy: ${r.error}`);
    assert.equal(ultimaRpc().fn, "reprogramar_reserva_empresa");
    assert.deepEqual(ultimaRpc().args.p_slots, ["12:20"]);
    r = (await server.reprogramarReservaEmpresa(601, MIERCOLES, "12:10", ["Ferrari"], DESPUES)) as R;
    assert.equal(r.status, 422, "legacy no puede ir a 12:10 aunque rija v2");
    // Histórica (NULL) de 30: legacy, dos bloques; su propio lugar no la bloquea.
    r = (await server.reprogramarReservaEmpresa(603, MIERCOLES, "16:20", ["Alpine"], DESPUES)) as R;
    assert.ok(r.ok, "correrse 20 minutos sobre su propio lugar");
    assert.deepEqual(ultimaRpc().args.p_slots, ["16:20", "16:40"]);
    // v2 antes del corte: grilla de 10 y RPC v2.
    rpcs.length = 0;
    r = (await server.reprogramarReservaEmpresa(602, MIERCOLES, "14:10", ["McLaren"], ANTES)) as R;
    assert.ok(r.ok, "v2 se corre 10 minutos sobre su propio lugar");
    assert.equal(ultimaRpc().fn, "reprogramar_reserva_empresa_v2");
    assert.ok(!("p_slots" in ultimaRpc().args));
    // A un lugar ocupado por OTRA → 409 sin RPC.
    rpcs.length = 0;
    r = (await server.reprogramarReservaEmpresa(602, MIERCOLES, "12:10", ["Ferrari"], ANTES)) as R;
    assert.equal(r.status, 409, "v2 sobre la legacy de Ferrari 12:00 ([12:00,12:20)) → 409");
    assert.deepEqual(rpcs, []);
    // No empresarial → 404.
    reiniciar({ reservas: [reserva(604, MIERCOLES, "12:00", 15, ["Ferrari"])] });
    r = (await server.reprogramarReservaEmpresa(604, MIERCOLES, "12:20", ["Ferrari"], ANTES)) as R;
    assert.equal(r.status, 404);
    // Cancelar sigue siendo la RPC atómica de siempre (libera TODOS los slots: lo prueba la base).
    reiniciar(base);
    r = (await server.cancelarReservaEmpresa(602, true)) as R;
    assert.ok(r.ok);
    assert.deepEqual(rpcs.at(-1), { fn: "cancelar_reserva_empresa", args: { p_reserva_id: 602, p_liberar_codigo: true } });
  }

  // ── 10. Rutas públicas reales ───────────────────────────────────────────────
  {
    const rutaDisp = await import("@/app/api/empresas/disponibilidad/route");
    const rutaValidar = await import("@/app/api/empresas/validar/route");
    const rutaCanje = await import("@/app/api/empresas/canje/route");
    assert.equal(rutaDisp.dynamic, "force-dynamic");
    const ORIGEN = "https://simexperience.com.ar";
    const post = (path: string, body: unknown, origin = ORIGEN) => new Request(`${ORIGEN}${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin, "x-forwarded-for": `10.7.0.${Math.floor(Math.random() * 200)}` },
      body: JSON.stringify(body),
    });
    reiniciar();
    let res = await rutaDisp.POST(post("/api/empresas/disponibilidad", { codigo: COD.v2, fecha: MIERCOLES }, "https://otro.example"));
    assert.equal(res.status, 403, "origen ajeno → 403");
    res = await rutaDisp.POST(post("/api/empresas/disponibilidad", { codigo: COD.v2, fecha: MIERCOLES }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    const json = await res.json();
    assert.deepEqual(Object.keys(json).sort(), ["duracion_minutos", "fecha", "horarios"], "sin datos personales");
    assert.equal(json.duracion_minutos, 20);
    assert.ok(json.horarios.some((h: { hora: string }) => h.hora === "12:10"), "la campaña v2 ve grilla de 10 por la ruta real");
    for (const h of json.horarios) assert.deepEqual(Object.keys(h).sort(), ["hora", "simuladores"]);
    res = await rutaDisp.POST(post("/api/empresas/disponibilidad", { codigo: "EMP-NOEX-ISTE00", fecha: MIERCOLES }));
    assert.equal((await res.json()).error, "Código inválido o no disponible.");
    res = await rutaValidar.POST(post("/api/empresas/validar", { codigo: COD.legacy }));
    const val = await res.json();
    assert.equal(val.beneficio.duracion_minutos, 15);
    assert.equal(val.hoy, hoyEnSim(new Date()), "hoy de SIM, no del navegador");
    res = await rutaCanje.POST(post("/api/empresas/canje", { codigo: COD.legacy30, nombre: "T", apellido: "B7", telefono: "0", fecha: MIERCOLES, hora: "12:10", simuladores: ["Ferrari"] }));
    assert.equal(res.status, 422, "la ruta de canje valida la grilla de la campaña");
    res = await rutaCanje.POST(post("/api/empresas/canje", { codigo: COD.v230, nombre: "T", apellido: "B7", telefono: "0", fecha: MIERCOLES, hora: "12:10", simuladores: ["Ferrari"], total: 99999 }));
    assert.equal(res.status, 201, "canje v2 por la ruta real");
    assert.equal(ultimaRpc().fn, "crear_reserva_empresa_v2");
    assert.ok(!Object.keys(ultimaRpc().args).some((k) => /total|precio|monto/.test(k)), "el cliente no manda importes: el total es 0 en la base");
  }

  // ── 11. Rutas del panel: permisos, origen, catálogo y 409 ────────────────────
  {
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
    const ruta = await import("@/app/api/admin/empresas/campanias/route");
    const rutaId = await import("@/app/api/admin/empresas/campanias/[id]/route");
    const rutaAcc = await import("@/app/api/admin/empresas/campanias/[id]/acciones/route");
    const ORIGEN = "https://simexperience.com.ar";
    const req = (path: string, method: string, body?: unknown, origin = ORIGEN) => new Request(`${ORIGEN}${path}`, {
      method, headers: { "content-type": "application/json", origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

    // La ruta usa el reloj real: la modalidad se fija con el override de la base falsa.
    reiniciar({}, "v2_10");
    cookie = undefined;
    assert.equal((await ruta.GET(req("/api/admin/empresas/campanias", "GET"))).status, 401);
    assert.equal((await ruta.POST(req("/api/admin/empresas/campanias", "POST", cuerpo(20, "v2_10")))).status, 401);
    cookie = tokenStaff;
    assert.equal((await ruta.POST(req("/api/admin/empresas/campanias", "POST", cuerpo(20, "v2_10")))).status, 403, "staff no crea");
    cookie = tokenAdmin;
    assert.equal((await ruta.POST(req("/api/admin/empresas/campanias", "POST", cuerpo(20, "v2_10"), "https://otro.example"))).status, 403, "origen ajeno");
    assert.equal((await rutaId.PATCH(req(`/api/admin/empresas/campanias/${CAMP_V2}`, "PATCH", { duracion_minutos: 10 }, "https://otro.example"), ctx(CAMP_V2))).status, 403);
    assert.equal((await rutaAcc.POST(req(`/api/admin/empresas/campanias/${CAMP_V2}/acciones`, "POST", { accion: "reserva_reprogramar" }, "https://otro.example"), ctx(CAMP_V2))).status, 403);
    assert.deepEqual(escrituraDe(), [], "nada rechazado escribió");

    let res = await ruta.GET(req("/api/admin/empresas/campanias", "GET"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    let json = await res.json();
    assert.equal(json.catalogo.modalidad, "v2_10");
    assert.deepEqual(json.catalogo.duraciones, [10, 20, 30]);
    const fila = (id: string) => json.campanias.find((c: { id: string }) => c.id === id);
    assert.deepEqual(fila(CAMP_LEGACY).duraciones_permitidas, [15, 30], "la legacy edita con SUS duraciones");
    assert.deepEqual(fila(CAMP_V2).duraciones_permitidas, [10, 20, 30]);

    // Pestaña vieja (legacy) con v2 vigente: 409, catálogo nuevo, 0 escrituras.
    res = await ruta.POST(req("/api/admin/empresas/campanias", "POST", cuerpo(15, "legacy")));
    assert.equal(res.status, 409);
    json = await res.json();
    assert.equal(json.codigo, "catalogo_actualizado");
    assert.equal(json.error, "Cambió la modalidad comercial. Revisá las duraciones antes de crear la campaña.");
    assert.deepEqual(json.catalogo.duraciones, [10, 20, 30]);
    assert.deepEqual(escrituraDe(), [], "409 sin escrituras");
    res = await ruta.POST(req("/api/admin/empresas/campanias", "POST", cuerpo(20, "v2_10")));
    assert.equal(res.status, 201);
    assert.equal(nuevas()[0].modalidad_comercial, "v2_10");
    // Reprogramar por la ruta: la reserva manda.
    reiniciar({ reservas: [reserva(701, MIERCOLES, "12:00", 15, ["Ferrari"], { origen: "empresa", modalidad: null })], reserva_slots: [slot(701, MIERCOLES, "12:00", "Ferrari")] }, "v2_10");
    res = await rutaAcc.POST(req(`/api/admin/empresas/campanias/${CAMP_LEGACY}/acciones`, "POST", { accion: "reserva_reprogramar", reserva_id: 701, fecha: MIERCOLES, hora: "12:40", simuladores: ["Ferrari"] }), ctx(CAMP_LEGACY));
    assert.equal(res.status, 200);
    assert.equal(ultimaRpc().fn, "reprogramar_reserva_empresa", "histórica con v2 vigente → RPC legacy");
    delete require.cache[rutaHeaders];
  }

  // ── 12. Fuentes: el navegador ya no calcula; una sola puerta a la modalidad ───
  {
    const ROOT = process.cwd();
    const leer = (f: string) => readFileSync(join(ROOT, f), "utf8");
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const pagina = leer("app/reservas-empresa/page.tsx");
    assert.ok(/^\s*["']use client["']/m.test(pagina));
    for (const prohibido of ["@/lib/reservasSlots", "construirOcupacion", "getOccupiedSlots", "getSlotsForDate", "/api/reservas?fecha", "@/lib/disponibilidad", "@/lib/agendaIntervalos", "@/lib/modalidadComercial"]) {
      assert.ok(!pagina.includes(prohibido), `la página no usa ${prohibido}`);
    }
    assert.ok(pagina.includes("/api/empresas/disponibilidad"), "la página pide los horarios al servidor");
    assert.ok(/1,40 m/.test(pagina) && /110 kg/.test(pagina), "requisitos físicos intactos");

    const srv = sinComentarios(leer("lib/empresasServer.ts"));
    for (const prohibido of ["getOccupiedSlots", "reservaEstaBloqueada", "@/lib/reservasSlots", "@/lib/bloqueos\"", "modalidadVigente", "@/lib/modalidadComercial"]) {
      assert.ok(!srv.includes(prohibido), `empresasServer no usa ${prohibido}`);
    }
    assert.equal(srv.split("modalidadParaNuevaCampania(").length - 1, 1, "la modalidad vigente se consulta en un solo lugar: el alta");
    assert.ok(/async function crearCampania[\s\S]*?modalidadParaNuevaCampania\(/.test(srv), "…y es crearCampania");
    const editables = /const CAMPOS_EDITABLES = \[([\s\S]*?)\] as const/.exec(srv)![1];
    assert.ok(!editables.includes("modalidad_comercial"), "modalidad_comercial no es editable");
    for (const rpc of ["crear_reserva_empresa_v2", "reprogramar_reserva_empresa_v2", "\"crear_reserva_empresa\"", "\"reprogramar_reserva_empresa\""]) {
      assert.ok(srv.includes(rpc), `empresasServer llama ${rpc}`);
    }
    const com = sinComentarios(leer("lib/empresasComercial.ts"));
    assert.equal(com.split("modalidadVigente(").length - 1, 1, "empresasComercial resuelve la vigente una vez (catálogo del alta)");

    // La migración: funciones v2 nuevas, legacy guardadas, permisos cerrados.
    const sql = leer("db/empresas-b7-modalidad.sql");
    for (const f of ["crear_reserva_empresa_v2", "reprogramar_reserva_empresa_v2", "reserva_horario_valido_v2"]) {
      assert.ok(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`).test(sql), `${f}: revoke`);
      assert.ok(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`).test(sql), `${f}: grant`);
    }
    assert.ok(/security definer\s+set search_path to 'public'/.test(sql), "las v2 fijan search_path");
    assert.ok(!/drop function/i.test(sql), "no se borra ninguna función");
    assert.ok(sql.includes("coalesce(v_camp.modalidad_comercial, 'legacy') <> 'legacy'"), "la RPC legacy rechaza campañas v2");
    assert.ok(sql.includes("IF coalesce(v_res.modalidad, 'legacy') <> 'legacy' THEN RETURN false; END IF;"), "la reprogramación legacy rechaza reservas v2");
  }

  console.log("OK — Empresas B7: modalidad guardada en la campaña, 15/30 legacy y 10/20/30 v2, grilla y cierre por modalidad, agenda unificada (bloqueos, web, Mensualidades, pendientes), canje y reprogramación por modalidad, 409 del panel sin escrituras y rutas reales.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
