import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS } from "@/lib/modalidadComercial";
import { CATALOGO_ACTUALIZADO } from "@/lib/catalogoComercial";
import {
  CAMPOS_PRECIO_ESPECIAL, MENSAJE_CATALOGO_ADMIN, PRECIO_ESPECIAL_MAXIMO, eliminarPrecioEspecial,
  guardarPrecioEspecial, vistaPreciosEspeciales,
} from "@/lib/preciosEspeciales";
import { getPrecioEspecialCompleto, precioReservaPara } from "@/lib/reservasPricing";
import { disponibilidadReservas } from "@/lib/reservasComercial";

// Precios especiales 10/20/30 por modalidad (Bloque B4).
// Ejecutar: npx tsx --env-file=.env.local lib/preciosEspeciales.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA (con el
// UNIQUE(fecha) y los CHECK de reservas_precios_especiales simulados), `fetch`
// queda bloqueado, el reloj se inyecta y la sesión admin se firma con un
// secreto DESCARTABLE generado acá (nunca el real). Las rutas se prueban de
// verdad: next/headers se reemplaza por un almacén de cookies en memoria.

// ── Base en memoria ─────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type ErrorDb = { code?: string; message: string };
type Op = "select" | "insert" | "update" | "delete";
type Resultado = { data: unknown; error: ErrorDb | null; count: number | null };

const TABLAS: Record<string, Fila[]> = {};
let fallas: Array<{ tabla: string; op: Op; error: ErrorDb }> = [];
let ganchos: Array<{ tabla: string; op: Op; fn: () => void }> = [];
const operaciones: string[] = [];
const PE = "reservas_precios_especiales";
const COLS = ["precio_10", "precio_15", "precio_20", "precio_30"];

const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clonar = (f: Fila): Fila => JSON.parse(JSON.stringify(f));

function reiniciar(filas: Record<string, Fila[]> = {}) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  for (const [k, v] of Object.entries(filas)) TABLAS[k] = v.map(clonar);
  TABLAS.modalidad_comercial_config ??= [
    { id: 1, modalidad_override: null, motivo: null, actualizado_por: null, updated_at: null },
  ];
  fallas = [];
  ganchos = [];
  operaciones.length = 0;
}
/** Justo antes de la próxima operación `op` sobre `t` (otra pestaña, otro admin). */
function antesDe(t: string, op: Op, fn: () => void) {
  ganchos.push({ tabla: t, op, fn });
}
/** Override de ESTA base falsa (nunca el de producción). */
function override(valor: "legacy" | "v2_10" | null) {
  tabla("modalidad_comercial_config")[0].modalidad_override = valor;
}
function fallar(t: string, op: Op, error: ErrorDb) {
  fallas.push({ tabla: t, op, error });
}
const escrituras = () => operaciones.filter((o) => !o.startsWith("select:"));

// Los CHECK de la tabla real (B1): al menos un precio y ninguno negativo. Como
// en Postgres, un INSERT los valida sobre la fila insertada y un UPDATE sobre
// la fila resultante. No hay upsert: si el código volviera a usarlo, falla (en
// la base real un upsert parcial choca con al_menos_un_precio sobre la fila
// candidata, antes de ver el conflicto).
function violaChecks(t: string, f: Fila): ErrorDb | null {
  if (t !== PE) return null;
  if (COLS.every((c) => f[c] == null)) return { code: "23514", message: "al_menos_un_precio" };
  if (COLS.some((c) => f[c] != null && Number(f[c]) < 0)) return { code: "23514", message: "no_negativo" };
  return null;
}
const defaults = (t: string): Fila =>
  t === PE
    ? { id: randomUUID(), precio_10: null, precio_15: null, precio_20: null, precio_30: null, created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    : { id: randomUUID() };

class Consulta implements PromiseLike<Resultado> {
  private op: Op = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private valores: Fila | Fila[] | null = null;
  private devolver = false;
  private uno: "single" | "maybe" | null = null;
  private orden: { col: string; asc: boolean } | null = null;
  private rango: [number, number] | null = null;
  constructor(private readonly t: string) {}

  select() { if (this.op !== "select") this.devolver = true; return this; }
  insert(v: Fila | Fila[]) { this.op = "insert"; this.valores = v; return this; }
  update(v: Fila) { this.op = "update"; this.valores = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filtros.push((f) => vs.includes(f[c])); return this; }
  gte(c: string, v: string) { this.filtros.push((f) => String(f[c]) >= v); return this; }
  lte(c: string, v: string) { this.filtros.push((f) => String(f[c]) <= v); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orden = { col, asc: opts?.ascending !== false }; return this; }
  range(a: number, b: number) { this.rango = [a, b]; return this; }
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
    const g = ganchos.findIndex((x) => x.tabla === this.t && x.op === this.op);
    if (g >= 0) ganchos.splice(g, 1)[0].fn();
    const e = fallas.findIndex((x) => x.tabla === this.t && x.op === this.op);
    if (e >= 0) return { data: null, error: fallas.splice(e, 1)[0].error, count: null };
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
        if (this.rango) out = out.slice(this.rango[0], this.rango[1] + 1);
        return this.forma(out.map(clonar));
      }
      case "insert": {
        const nuevas = lista.map((v) => ({ ...defaults(this.t), ...clonar(v) }));
        for (const n of nuevas) {
          const err = violaChecks(this.t, n);
          if (err) return { data: null, error: err, count: null };
          if (this.t === PE && filas.some((f) => f.fecha === n.fecha)) return { data: null, error: { code: "23505", message: "fecha_key" }, count: null };
        }
        filas.push(...nuevas);
        return this.forma(this.devolver ? nuevas.map(clonar) : null);
      }
      case "update": {
        const afectadas = filas.filter(coincide);
        for (const f of afectadas) {
          const err = violaChecks(this.t, { ...f, ...(this.valores as Fila) });
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

const cliente = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (...a: unknown[]) => unknown };
cliente.from = (t: string) => new Consulta(t);
cliente.rpc = (fn: unknown) => { throw new Error(`el test no espera la RPC ${String(fn)}`); };

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

const LUNES = "2026-10-05";
const MARTES = "2026-10-06";
const SABADO = "2026-10-10";

const fila = (fecha: string) => tabla(PE).find((f) => f.fecha === fecha);
const precios = (fecha: string) => {
  const f = fila(fecha);
  return f ? Object.fromEntries(COLS.map((c) => [c, f[c] ?? null])) : null;
};

async function guardar(body: Record<string, unknown>, ahora: Date) {
  return guardarPrecioEspecial(body, { actor: "admin", ahora });
}

/** El precio que cobraría B3 hoy para (fecha, duración) en esa modalidad. */
async function precioB3(modalidad: "legacy" | "v2_10", fecha: string, d: number) {
  return precioReservaPara(modalidad, fecha, d, await getPrecioEspecialCompleto(fecha));
}

async function main() {
  // ── 1. Columnas y catálogo ────────────────────────────────────────────────
  {
    assert.deepEqual(CAMPOS_PRECIO_ESPECIAL.map((c) => c.columna), COLS,
      "las columnas salen del catálogo (legacy 15/30 ∪ v2 10/20/30) y son las de B1");

    reiniciar();
    const a = await vistaPreciosEspeciales(ANTES);
    assert.equal(a.modalidad, "legacy", "23:59:59.999 → legacy");
    assert.deepEqual(a.duraciones, [15, 30]);
    assert.deepEqual(a.campos.map((c) => c.columna), ["precio_15", "precio_30"]);
    assert.deepEqual(a.otros.map((c) => c.columna), ["precio_10", "precio_20"]);
    assert.deepEqual(a.precios_base, { semana: { 15: 12000, 30: 18000 }, fin_de_semana: { 15: 12000, 30: 20000 } });
    assert.deepEqual(a.precios, []);

    const v = await vistaPreciosEspeciales(CORTE);
    assert.equal(v.modalidad, "v2_10", "00:00:00.000 → v2_10, sin redeploy");
    assert.deepEqual(v.duraciones, [10, 20, 30]);
    assert.deepEqual(v.campos.map((c) => c.columna), ["precio_10", "precio_20", "precio_30"]);
    assert.deepEqual(v.otros.map((c) => c.columna), ["precio_15"]);
    const base = { 10: 10000, 20: 17000, 30: 23000 };
    assert.deepEqual(v.precios_base, { semana: base, fin_de_semana: base }, "v2 no distingue el tipo de día");

    // Modalidad EFECTIVA: el override gana; un error al leerlo sigue el calendario.
    override("legacy");
    assert.equal((await vistaPreciosEspeciales(DESPUES)).modalidad, "legacy", "rollback: override legacy");
    override("v2_10");
    assert.equal((await vistaPreciosEspeciales(ANTES)).modalidad, "v2_10", "contingencia: override v2");
    reiniciar();
    fallar("modalidad_comercial_config", "select", { message: "caída" });
    assert.equal((await vistaPreciosEspeciales(ANTES)).modalidad, "legacy");
    fallar("modalidad_comercial_config", "select", { message: "caída" });
    assert.equal((await vistaPreciosEspeciales(CORTE)).modalidad, "v2_10");
  }

  // ── 2. Legacy: 15/30 llegan al precio de B3 ───────────────────────────────
  {
    reiniciar();
    const r = await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_15: 13000, precio_30: "21000" }, ANTES);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(precios(LUNES), { precio_10: null, precio_15: 13000, precio_20: null, precio_30: 21000 });
    assert.equal(fila(LUNES)?.created_by, "admin");
    assert.equal(await precioB3("legacy", LUNES, 15), 13000);
    assert.equal(await precioB3("legacy", LUNES, 30), 21000);
    assert.equal(await precioB3("legacy", MARTES, 15), 12000, "sin override: normal");
    assert.equal(await precioB3("legacy", MARTES, 30), 18000);
    assert.equal(await precioB3("legacy", SABADO, 30), 20000);
    // Y así lo muestra /reservas (disponibilidad pública antes del corte).
    const d = await disponibilidadReservas({ fecha: LUNES, duracion: 30, ahora: ANTES });
    assert.ok(d.ok);
    assert.deepEqual(d.data.precios, { 15: 13000, 30: 21000 });
    assert.equal(d.data.precio, 21000);
  }

  // ── 3. v2: 10/20/30 llegan al precio de B3 ────────────────────────────────
  {
    reiniciar();
    const r = await guardar({ fecha: LUNES, modalidad_vista: "v2_10", precio_10: 11000, precio_20: 19000, precio_30: 26000 }, DESPUES);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(precios(LUNES), { precio_10: 11000, precio_15: null, precio_20: 19000, precio_30: 26000 });
    for (const [dur, esperado] of [[10, 11000], [20, 19000], [30, 26000]]) {
      assert.equal(await precioB3("v2_10", LUNES, dur), esperado, `v2 ${dur} con override`);
    }
    for (const [dur, esperado] of [[10, 10000], [20, 17000], [30, 23000]]) {
      assert.equal(await precioB3("v2_10", MARTES, dur), esperado, `v2 ${dur} sin override`);
      assert.equal(await precioB3("v2_10", SABADO, dur), esperado, `v2 ${dur} finde = semana`);
    }
    const d = await disponibilidadReservas({ fecha: LUNES, duracion: 20, ahora: DESPUES });
    assert.ok(d.ok);
    assert.deepEqual(d.data.precios, { 10: 11000, 20: 19000, 30: 26000 });
    assert.deepEqual(d.data.precios_base_dia, { 10: 10000, 20: 17000, 30: 23000 });
  }

  // ── 4. precio_30 compartido ───────────────────────────────────────────────
  {
    reiniciar();
    assert.ok((await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_30: 25000 }, ANTES)).ok);
    assert.ok((await guardar({ fecha: SABADO, modalidad_vista: "legacy", precio_30: 25000 }, ANTES)).ok);
    for (const f of [LUNES, SABADO]) {
      assert.equal(await precioB3("legacy", f, 30), 25000, `legacy 30 (${f}) → 25000`);
      assert.equal(await precioB3("v2_10", f, 30), 25000, `v2 30 (${f}) → 25000: la misma columna`);
      assert.equal(await precioB3("legacy", f, 15), 12000);
      assert.equal(await precioB3("v2_10", f, 10), 10000);
      assert.equal(await precioB3("v2_10", f, 20), 17000);
    }
    assert.equal(Object.keys(fila(LUNES) ?? {}).filter((k) => k.startsWith("precio_30")).length, 1, "una sola columna de 30");
  }

  // ── 5. Preservación legacy en una edición v2 ──────────────────────────────
  {
    reiniciar();
    assert.ok((await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_15: 14000, precio_30: 22000 }, ANTES)).ok);
    // Después del corte el admin agrega 10 y 20 (sin mandar precio_15 ni precio_30).
    let r = await guardar({ fecha: LUNES, modalidad_vista: "v2_10", precio_10: 11000, precio_20: 18000 }, DESPUES);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(precios(LUNES), { precio_10: 11000, precio_15: 14000, precio_20: 18000, precio_30: 22000 },
      "precio_15 sigue 14000; precio_30 no vino y no se tocó");
    // El formulario v2 real manda los tres campos: 30 queda con lo enviado.
    r = await guardar({ fecha: LUNES, modalidad_vista: "v2_10", precio_10: "11000", precio_20: "18000", precio_30: "" }, DESPUES);
    assert.ok(r.ok);
    assert.deepEqual(precios(LUNES), { precio_10: 11000, precio_15: 14000, precio_20: 18000, precio_30: null });
    assert.equal(await precioB3("v2_10", LUNES, 30), 23000, "30 vacío → normal v2");
    // Los tres v2 vacíos: la fila sigue viva por precio_15.
    r = await guardar({ fecha: LUNES, modalidad_vista: "v2_10", precio_10: null, precio_20: null, precio_30: null }, DESPUES);
    assert.ok(r.ok);
    assert.deepEqual(precios(LUNES), { precio_10: null, precio_15: 14000, precio_20: null, precio_30: null });
    // NULL / fallback.
    assert.equal(await precioB3("v2_10", LUNES, 10), 10000);
    assert.equal(await precioB3("v2_10", LUNES, 20), 17000);
    assert.equal(await precioB3("v2_10", LUNES, 30), 23000);
    assert.equal(await precioB3("legacy", LUNES, 15), 14000, "legacy sigue leyendo su precio_15");
    assert.equal(await precioB3("legacy", LUNES, 30), 18000, "precio_30 NULL → normal legacy");
    assert.equal(await precioB3("legacy", SABADO, 30), 20000);
  }

  // ── 6. Rollback con override legacy y vuelta a v2 ─────────────────────────
  {
    reiniciar();
    assert.ok((await guardar({ fecha: LUNES, modalidad_vista: "v2_10", precio_10: 11000, precio_20: 18000, precio_30: 26000 }, DESPUES)).ok);
    override("legacy");
    const vl = await vistaPreciosEspeciales(DESPUES);
    assert.deepEqual(vl.duraciones, [15, 30], "override legacy: el panel vuelve a 15/30");
    assert.equal(vl.precios[0].precio_10, 11000, "10 y 20 siguen guardados (no activos)");
    assert.ok((await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_15: 15000, precio_30: 24000 }, DESPUES)).ok);
    assert.deepEqual(precios(LUNES), { precio_10: 11000, precio_15: 15000, precio_20: 18000, precio_30: 24000 },
      "editar en legacy no borra 10/20");
    override(null);
    const vv = await vistaPreciosEspeciales(DESPUES);
    assert.deepEqual(vv.duraciones, [10, 20, 30]);
    assert.equal(await precioB3("v2_10", LUNES, 10), 11000, "al volver a v2 los valores siguen ahí");
    assert.equal(await precioB3("v2_10", LUNES, 30), 24000, "30 compartido: el último guardado");
  }

  // ── 7. Pestaña vieja del panel: 409 y 0 escrituras ────────────────────────
  {
    reiniciar({ [PE]: [{ id: randomUUID(), fecha: LUNES, precio_10: null, precio_15: 14000, precio_20: null, precio_30: 22000 }] });
    const antes = JSON.stringify(tabla(PE));
    const DESPUES_1S = new Date(CORTE_MODALIDAD_V2_MS + 1000);
    for (const [body, ahora, caso] of [
      [{ fecha: LUNES, modalidad_vista: "legacy", precio_15: 15000, precio_30: 25000 }, DESPUES_1S, "formulario legacy enviado 00:00:01"],
      [{ fecha: LUNES, precio_15: 15000, precio_30: 25000 }, DESPUES_1S, "panel anterior a B4 (sin modalidad_vista)"],
      [{ fecha: LUNES, modalidad_vista: "v2_10", precio_10: 1 }, ANTES, "no se fuerza v2 antes del corte"],
    ] as const) {
      const r = await guardar({ ...body }, ahora);
      assert.ok(!r.ok, caso);
      assert.equal(r.status, 409, caso);
      assert.equal(r.codigo, CATALOGO_ACTUALIZADO.codigo, caso);
      assert.equal(r.error, MENSAJE_CATALOGO_ADMIN, caso);
    }
    assert.equal(MENSAJE_CATALOGO_ADMIN, "Cambió la modalidad comercial. Recargá los precios antes de guardar.");
    assert.deepEqual(escrituras(), [], "0 escrituras");
    assert.equal(JSON.stringify(tabla(PE)), antes, "0 cambios en la base");
  }

  // ── 8. Validaciones: 400 sin escrituras parciales ─────────────────────────
  {
    reiniciar({ [PE]: [{ id: randomUUID(), fecha: MARTES, precio_10: null, precio_15: 14000, precio_20: null, precio_30: null }] });
    const antes = JSON.stringify(tabla(PE));
    const casosLegacy: Array<[unknown, string]> = [
      [{ fecha: LUNES, precio_15: -1 }, "negativo"],
      [{ fecha: LUNES, precio_15: "-1" }, "negativo en texto"],
      [{ fecha: LUNES, precio_15: "abc" }, "texto inválido"],
      [{ fecha: LUNES, precio_15: "NaN" }, "NaN"],
      [{ fecha: LUNES, precio_15: Number.NaN }, "NaN numérico"],
      [{ fecha: LUNES, precio_15: 12.5 }, "decimal"],
      [{ fecha: LUNES, precio_15: "12.5" }, "decimal en texto"],
      [{ fecha: LUNES, precio_15: "1e4" }, "exponente"],
      [{ fecha: LUNES, precio_15: true }, "booleano"],
      [{ fecha: LUNES, precio_15: {} }, "objeto"],
      [{ fecha: LUNES, precio_15: PRECIO_ESPECIAL_MAXIMO + 1 }, "fuera de rango"],
      [{ fecha: LUNES, precio_15: 13000, precio_30: "x" }, "un campo bueno y uno malo: nada se escribe"],
      [{ fecha: LUNES, precio_10: 11000 }, "duración no soportada en legacy (10)"],
      [{ fecha: LUNES, precio_45: 11000 }, "duración inexistente (45)"],
      [{ fecha: LUNES, modalidad_vista: "v3", precio_15: 13000 }, "modalidad inventada"],
      [{ fecha: LUNES, modalidad_vista: 1, precio_15: 13000 }, "modalidad no texto"],
      [{ fecha: "2026-02-30", precio_15: 13000 }, "fecha inexistente"],
      [{ fecha: "hoy", precio_15: 13000 }, "fecha basura"],
      [{ fecha: 20261005, precio_15: 13000 }, "fecha numérica"],
      [{ precio_15: 13000 }, "sin fecha"],
      [{ fecha: LUNES }, "sin precios"],
      [{ fecha: LUNES, precio_15: null, precio_30: "" }, "fecha nueva sin ningún precio"],
      [{ fecha: MARTES, precio_15: null }, "dejaría la fila sin precios: usar Eliminar"],
      [null, "cuerpo nulo"],
      [[1, 2], "cuerpo lista"],
      ["texto", "cuerpo texto"],
    ];
    for (const [body, caso] of casosLegacy) {
      const r = await guardarPrecioEspecial(body, { actor: "admin", ahora: ANTES });
      assert.ok(!r.ok, caso);
      assert.equal(r.status, 400, `${caso}: ${r.error}`);
    }
    // v2: 15 ya no es editable.
    const r15 = await guardar({ fecha: LUNES, modalidad_vista: "v2_10", precio_15: 13000 }, DESPUES);
    assert.ok(!r15.ok && r15.status === 400, "v2 no edita precio_15");
    assert.deepEqual(escrituras(), [], "ninguna validación escribe");
    assert.equal(JSON.stringify(tabla(PE)), antes);
    // Permitidos: 0 y el máximo.
    assert.ok((await guardar({ fecha: LUNES, precio_15: 0, precio_30: PRECIO_ESPECIAL_MAXIMO }, ANTES)).ok);
    assert.deepEqual(precios(LUNES), { precio_10: null, precio_15: 0, precio_20: null, precio_30: PRECIO_ESPECIAL_MAXIMO });
    // Carreras entre la lectura y la escritura → 409, sin escribir nada:
    // (a) otra pestaña deja la fila sin sus otros precios → la base rechaza el UPDATE;
    reiniciar({ [PE]: [{ id: randomUUID(), fecha: LUNES, precio_10: null, precio_15: 14000, precio_20: null, precio_30: 22000 }] });
    antesDe(PE, "update", () => { fila(LUNES)!.precio_15 = null; });
    const ra = await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_30: null }, ANTES);
    assert.ok(!ra.ok && ra.status === 409, JSON.stringify(ra));
    assert.deepEqual(precios(LUNES), { precio_10: null, precio_15: null, precio_20: null, precio_30: 22000 }, "el UPDATE no se aplicó");
    // (b) otra pestaña crea la misma fecha → 23505 en el INSERT;
    reiniciar();
    antesDe(PE, "insert", () => { tabla(PE).push({ id: randomUUID(), fecha: LUNES, precio_10: null, precio_15: 9000, precio_20: null, precio_30: null }); });
    const rb = await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_15: 13000 }, ANTES);
    assert.ok(!rb.ok && rb.status === 409, JSON.stringify(rb));
    assert.equal(fila(LUNES)?.precio_15, 9000, "gana lo que ya estaba; no se pisa");
    // (c) otra pestaña elimina la fecha → el UPDATE no encuentra fila.
    reiniciar({ [PE]: [{ id: randomUUID(), fecha: LUNES, precio_10: null, precio_15: 14000, precio_20: null, precio_30: null }] });
    antesDe(PE, "update", () => { TABLAS[PE] = []; });
    const rc = await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_30: 21000 }, ANTES);
    assert.ok(!rc.ok && rc.status === 409, JSON.stringify(rc));
    assert.equal(fila(LUNES), undefined, "no se resucita una fila eliminada");
  }

  // ── 9. Eliminar: la fila completa, como acción explícita ──────────────────
  {
    const id = randomUUID();
    reiniciar({ [PE]: [{ id, fecha: LUNES, precio_10: 11000, precio_15: 14000, precio_20: null, precio_30: 22000 }] });
    await eliminarPrecioEspecial(id);
    assert.equal(fila(LUNES), undefined);
    assert.equal(await precioB3("v2_10", LUNES, 10), 10000);
    assert.equal(await precioB3("legacy", LUNES, 15), 12000);
  }

  // ── 10. Reservas, pagos y Finanzas existentes no cambian ──────────────────
  {
    const reserva = {
      id: 3100, fecha: LUNES, hora: "12:00", duracion_minutos: 30, simuladores: ["Ferrari"], estado: "activa",
      total: 18000, total_original: 18000, modalidad: "legacy", mercado_pago_payment_id: "PAGO-1", origen: "web",
      created_at: "2026-09-29T15:00:00Z",
    };
    reiniciar({ reservas: [reserva], reserva_slots: [], fin_movimientos: [{ id: 1, monto: 18000 }] });
    const antesReservas = JSON.stringify(tabla("reservas"));
    const antesFin = JSON.stringify(tabla("fin_movimientos"));
    assert.ok((await guardar({ fecha: LUNES, modalidad_vista: "legacy", precio_30: 30000 }, ANTES)).ok);
    const id = String(fila(LUNES)?.id);
    await eliminarPrecioEspecial(id);
    assert.equal(JSON.stringify(tabla("reservas")), antesReservas, "la reserva existente no cambia");
    assert.equal(JSON.stringify(tabla("fin_movimientos")), antesFin, "Finanzas no cambia");
    const tocadas = new Set(escrituras().map((o) => o.split(":")[1]));
    assert.deepEqual([...tocadas], [PE], "solo se escribe reservas_precios_especiales");
  }

  // ── 11. Rutas reales: permisos, origen, 409 y sin caché ───────────────────
  {
    // Sesión con un secreto DESCARTABLE (el real no se usa ni se imprime) y
    // next/headers reemplazado por un almacén de cookies en memoria.
    process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
    let cookie: string | undefined;
    const rutaHeaders = require.resolve("next/headers");
    require.cache[rutaHeaders] = {
      id: rutaHeaders, filename: rutaHeaders, loaded: true,
      exports: {
        cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }),
      },
    } as unknown as NodeJS.Module;
    const { createSessionToken, ADMIN_COOKIE } = await import("@/lib/adminSession");
    assert.equal(ADMIN_COOKIE, "sim-admin-session");
    const tokenAdmin = await createSessionToken("admin");
    const tokenStaff = await createSessionToken("staff");
    const ruta = await import("@/app/api/admin/bloqueos/precios/route");
    const rutaId = await import("@/app/api/admin/bloqueos/precios/[id]/route");
    assert.equal(ruta.dynamic, "force-dynamic");

    const ORIGEN = "https://simexperience.com.ar";
    const post = (body: unknown, origin = ORIGEN) =>
      new Request(`${ORIGEN}/api/admin/bloqueos/precios`, {
        method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
      });
    const del = (id: string, origin = ORIGEN) =>
      new Request(`${ORIGEN}/api/admin/bloqueos/precios/${id}`, { method: "DELETE", headers: { origin } });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    // Las rutas resuelven la modalidad con el reloj real: se fija con el override de la base falsa.
    const cuerpo = { fecha: LUNES, modalidad_vista: "legacy", precio_15: 13000, precio_30: 21000 };

    reiniciar();
    override("legacy");
    cookie = undefined;
    assert.equal((await ruta.GET()).status, 401, "GET sin sesión");
    assert.equal((await ruta.POST(post(cuerpo))).status, 401, "POST sin sesión");
    cookie = tokenStaff;
    assert.equal((await ruta.GET()).status, 403, "GET staff");
    assert.equal((await ruta.POST(post(cuerpo))).status, 403, "POST staff");
    assert.equal((await rutaId.DELETE(del(randomUUID()), ctx(randomUUID()))).status, 403, "DELETE staff");
    cookie = tokenAdmin;
    assert.equal((await ruta.POST(post(cuerpo, "https://otro.example"))).status, 403, "POST origen ajeno");
    assert.equal((await rutaId.DELETE(del(randomUUID(), "https://otro.example"), ctx(randomUUID()))).status, 403, "DELETE origen ajeno");
    assert.deepEqual(escrituras(), [], "nada rechazado escribió");

    let res = await ruta.GET();
    assert.equal(res.status, 200, "GET admin");
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    let json = await res.json();
    assert.equal(json.modalidad, "legacy");
    assert.deepEqual(json.duraciones, [15, 30]);
    assert.deepEqual(Object.keys(json).sort(), ["campos", "duraciones", "modalidad", "otros", "precios", "precios_base", "resuelto_en"]);

    res = await ruta.POST(post(cuerpo));
    assert.equal(res.status, 201, "POST admin");
    json = await res.json();
    assert.deepEqual(Object.keys(json.precio).sort(), ["fecha", "id", "precio_10", "precio_15", "precio_20", "precio_30"], "sin datos de más");
    assert.deepEqual(precios(LUNES), { precio_10: null, precio_15: 13000, precio_20: null, precio_30: 21000 });

    // El corte llega con la pestaña abierta: el mismo formulario → 409, nada escrito.
    override("v2_10");
    const antes = JSON.stringify(tabla(PE));
    res = await ruta.POST(post({ ...cuerpo, precio_15: 99999 }));
    assert.equal(res.status, 409);
    json = await res.json();
    assert.equal(json.codigo, "catalogo_actualizado");
    assert.equal(json.error, MENSAJE_CATALOGO_ADMIN);
    assert.equal(JSON.stringify(tabla(PE)), antes);
    // Recarga: el panel ya ve 10/20/30 y los precios guardados.
    json = await (await ruta.GET()).json();
    assert.deepEqual(json.duraciones, [10, 20, 30]);
    assert.equal(json.precios[0].precio_15, 13000);

    // DELETE admin: id inválido → 404; válido → borra.
    assert.equal((await rutaId.DELETE(del("no-es-uuid"), ctx("no-es-uuid"))).status, 404);
    const idFila = String(fila(LUNES)?.id);
    res = await rutaId.DELETE(del(idFila), ctx(idFila));
    assert.equal(res.status, 200);
    assert.equal(fila(LUNES), undefined);
  }

  // ── 12. Guardas de fuente ─────────────────────────────────────────────────
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const pagina = leer("app/admin/(panel)/bloqueos/page.tsx");
    // La fecha del corte, tomada de la constante (no se repite el literal).
    const fechaCorte = new Date(CORTE_MODALIDAD_V2_MS).toISOString().slice(0, 10);
    for (const prohibido of ["Precio 15 min", "Precio 30 min", "precio_10", "precio_15", "precio_20", "precio_30",
      "@/lib/catalogoComercial", "@/lib/modalidadComercial", fechaCorte]) {
      assert.ok(!pagina.includes(prohibido), `el panel no decide duraciones ni modalidad: aparece ${prohibido}`);
    }
    assert.ok(pagina.includes("modalidad_vista:"), "el panel manda la modalidad que vio");
    assert.ok(pagina.includes('cache: "no-store"'));

    const rutaSrc = leer("app/api/admin/bloqueos/precios/route.ts");
    const rutaIdSrc = leer("app/api/admin/bloqueos/precios/[id]/route.ts");
    for (const src of [rutaSrc, rutaIdSrc]) {
      assert.ok(/requireAdmin\(\)/.test(src) && !/requireStaffOrAdmin/.test(src), "solo admin");
      assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src));
    }
    assert.equal((rutaSrc.match(/isAllowedOrigin\(req\)/g) ?? []).length, 1, "POST con control de origen");
    assert.ok(/isAllowedOrigin\(req\)/.test(rutaIdSrc), "DELETE con control de origen");
    assert.ok(/force-dynamic/.test(rutaSrc) && /no-store/.test(rutaSrc), "GET sin caché");

    // Lo que ya existe nunca se re-precia: webhook, reactivación y cancelación no leen precios especiales.
    for (const f of ["lib/reservasWebhook.ts", "lib/reservasEstado.ts"]) {
      const src = leer(f);
      assert.ok(!src.includes(PE) && !/getPrecioEspecial|precioReservaPara|precioDelPedido/.test(src), `${f} no recalcula precios`);
    }
    // Gift Cards, Mensualidades y Empresas no usan los precios especiales de Reservas.
    for (const f of ["lib/giftCards.ts", "lib/mensualidades.ts", "lib/empresasServer.ts"]) {
      assert.ok(!leer(f).includes(PE) && !leer(f).includes("@/lib/preciosEspeciales"), `${f} no usa precios especiales`);
    }
  }

  console.log("OK — preciosEspeciales (B4): 15/30 antes del corte, 10/20/30 desde el corte, precio_30 compartido, precio_15 preservado, 409, validaciones, permisos y B3 leyendo lo configurado.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
