import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CORTE_MODALIDAD_V2_MS } from "@/lib/modalidadComercial";
import { CATALOGO_ACTUALIZADO } from "@/lib/catalogoComercial";
import { esFinDeSemana, fechasPublicas, horariosDe } from "@/lib/agenda";
import { construirOcupacion, filasSlotsReserva, getOccupiedSlots } from "@/lib/reservasSlots";
import { precioReservaPara, type PrecioEspecialCompleto } from "@/lib/reservasPricing";
import { validarReservaInput } from "@/lib/reservasValidation";
import {
  catalogoReservasVigente, disponibilidadReservas, evaluarTurno, precioDelPedido, prepararReservaWeb,
  type Fallo,
} from "@/lib/reservasComercial";
import { ESTADO_CONFLICTO_PAGO, procesarPagoAprobadoReserva } from "@/lib/reservasWebhook";
import { cambiarEstadoReserva } from "@/lib/reservasEstado";
import { rangoV2, turnosDeReserva } from "@/lib/reservasPresentacion";

// Reservas web v2 end-to-end + corte automático (Bloque B3).
// Ejecutar: npx tsx --env-file=.env.local lib/reservasComercial.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA (con el
// índice único / trigger de reserva_slots simulados), `fetch` queda bloqueado
// (ni Upstash, ni Mercado Pago, ni Supabase), la preferencia de Mercado Pago se
// intercepta y el reloj se inyecta. Las rutas se prueban de verdad (POST de
// /api/reservas y de la preferencia) contra esa base.

// ── Base en memoria ─────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type ErrorDb = { code?: string; message: string };
type Op = "select" | "insert" | "update" | "delete";
type Resultado = { data: unknown; error: ErrorDb | null; count: number | null };

const TABLAS: Record<string, Fila[]> = {};
const SECUENCIA: Record<string, number> = {};
let fallas: Array<{ tabla: string; op: Op; error: ErrorDb }> = [];
let ganchos: Array<{ tabla: string; op: Op; fn: () => void }> = [];
const operaciones: string[] = [];
const rpcs: string[] = [];

const tabla = (t: string): Fila[] => (TABLAS[t] ??= []);
const clonar = (f: Fila): Fila => JSON.parse(JSON.stringify(f));

function reiniciar(filas: Record<string, Fila[]> = {}) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  for (const k of Object.keys(SECUENCIA)) delete SECUENCIA[k];
  for (const [k, v] of Object.entries(filas)) TABLAS[k] = v.map(clonar);
  TABLAS.modalidad_comercial_config ??= [
    { id: 1, modalidad_override: null, motivo: null, actualizado_por: null, updated_at: null },
  ];
  fallas = [];
  ganchos = [];
  operaciones.length = 0;
  rpcs.length = 0;
}

/** Override de ESTA base falsa (nunca el de producción). */
function override(valor: "legacy" | "v2_10" | null) {
  tabla("modalidad_comercial_config")[0].modalidad_override = valor;
}
/** La próxima operación `op` sobre `t` devuelve este error. */
function fallar(t: string, op: Op, error: ErrorDb) {
  fallas.push({ tabla: t, op, error });
}
/** Justo antes de la próxima operación `op` sobre `t`. */
function antesDe(t: string, op: Op, fn: () => void) {
  ganchos.push({ tabla: t, op, fn });
}

// El índice único + trigger de reserva_slots (B1): legacy ocupa su bloque de 20,
// v2 [hora, hora + ocupacion_min). Se superponen en el mismo simulador → 23505.
function intervaloSlot(f: Fila): [number, number] | null {
  const m = /^(\d{2}):(\d{2})/.exec(String(f.hora));
  if (!m) return null;
  const ini = Number(m[1]) * 60 + Number(m[2]);
  return [ini, ini + (f.ocupacion_min == null ? 20 : Number(f.ocupacion_min))];
}
function chocan(a: Fila, b: Fila): boolean {
  if (a.fecha !== b.fecha || a.simulador !== b.simulador) return false;
  const x = intervaloSlot(a);
  const y = intervaloSlot(b);
  return !!x && !!y && x[0] < y[1] && y[0] < x[1];
}
function restricciones(t: string, nuevas: Fila[]): ErrorDb | null {
  if (t !== "reserva_slots") return null;
  const activas = tabla(t).filter((f) => f.estado === "activa");
  for (let i = 0; i < nuevas.length; i++) {
    const n = nuevas[i];
    if (n.estado !== "activa") continue;
    if (activas.some((f) => chocan(f, n)) || nuevas.slice(0, i).some((f) => chocan(f, n))) {
      return { code: "23505", message: "reserva_slots: turno ocupado" };
    }
  }
  return null;
}

const DEFAULTS: Record<string, Fila> = {
  reservas: { estado: "activa", mercado_pago_payment_id: null, modalidad: null, origen: null },
  reserva_slots: { estado: "activa", ocupacion_min: null },
};

class Consulta implements PromiseLike<Resultado> {
  private op: Op = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private valores: Fila | Fila[] | null = null;
  private soloConteo = false;
  private conConteo = false;
  private devolver = false;
  private uno: "single" | "maybe" | null = null;
  private orden: string | null = null;
  private rango: [number, number] | null = null;
  constructor(private readonly t: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.conConteo = !!opts?.count;
      this.soloConteo = !!opts?.head;
    } else {
      this.devolver = true;
    }
    return this;
  }
  insert(v: Fila | Fila[]) { this.op = "insert"; this.valores = v; return this; }
  update(v: Fila) { this.op = "update"; this.valores = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filtros.push((f) => vs.includes(f[c])); return this; }
  gte(c: string, v: string) { this.filtros.push((f) => String(f[c]) >= v); return this; }
  lte(c: string, v: string) { this.filtros.push((f) => String(f[c]) <= v); return this; }
  lt(c: string, v: string) { this.filtros.push((f) => String(f[c]) < v); return this; }
  is(c: string, v: null) { this.filtros.push((f) => (f[c] ?? null) === v); return this; }
  not(c: string, op: string, v: null) {
    if (op !== "is") throw new Error(`not(${op}) no soportado`);
    this.filtros.push((f) => (f[c] ?? null) !== v);
    return this;
  }
  order(c: string) { this.orden = c; return this; }
  range(a: number, b: number) { this.rango = [a, b]; return this; }
  single() { this.uno = "single"; return this; }
  maybeSingle() { this.uno = "maybe"; return this; }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(ok, ko);
  }

  private forma(filas: Fila[] | null, count: number | null): Resultado {
    if (this.uno === null) return { data: filas, error: null, count };
    const lista = filas ?? [];
    if (this.uno === "single" && lista.length !== 1) {
      return { data: null, error: { code: "PGRST116", message: "no es exactamente una fila" }, count: null };
    }
    if (lista.length > 1) return { data: null, error: { code: "PGRST116", message: "más de una fila" }, count: null };
    return { data: lista[0] ?? null, error: null, count };
  }

  private ejecutar(): Resultado {
    operaciones.push(`${this.op}:${this.t}`);
    const g = ganchos.findIndex((x) => x.tabla === this.t && x.op === this.op);
    if (g >= 0) ganchos.splice(g, 1)[0].fn();
    const e = fallas.findIndex((x) => x.tabla === this.t && x.op === this.op);
    if (e >= 0) return { data: null, error: fallas.splice(e, 1)[0].error, count: null };

    const filas = tabla(this.t);
    const coincide = (f: Fila) => this.filtros.every((fn) => fn(f));
    switch (this.op) {
      case "select": {
        let out = filas.filter(coincide);
        if (this.orden) {
          const c = this.orden;
          out = [...out].sort((x, y) => (Number(x[c]) || 0) - (Number(y[c]) || 0));
        }
        if (this.rango) out = out.slice(this.rango[0], this.rango[1] + 1);
        if (this.soloConteo) return { data: null, error: null, count: out.length };
        return this.forma(out.map(clonar), this.conConteo ? out.length : null);
      }
      case "insert": {
        const lista = Array.isArray(this.valores) ? this.valores : [this.valores as Fila];
        const nuevas: Fila[] = lista.map((v) => ({
          ...(DEFAULTS[this.t] ?? {}),
          created_at: new Date().toISOString(),
          ...clonar(v),
        }));
        const err = restricciones(this.t, nuevas);
        if (err) return { data: null, error: err, count: null };
        for (const n of nuevas) {
          if (n.id === undefined) n.id = (SECUENCIA[this.t] = (SECUENCIA[this.t] ?? 5000) + 1);
          filas.push(n);
        }
        return this.forma(this.devolver ? nuevas.map(clonar) : null, null);
      }
      case "update": {
        const afectadas = filas.filter(coincide);
        for (const f of afectadas) Object.assign(f, clonar(this.valores as Fila));
        return this.forma(this.devolver ? afectadas.map(clonar) : null, null);
      }
      case "delete": {
        TABLAS[this.t] = filas.filter((f) => !coincide(f));
        return { data: null, error: null, count: null };
      }
    }
  }
}

const cliente = supabaseAdmin as unknown as {
  from: (t: string) => unknown;
  rpc: (fn: string, args?: Record<string, unknown>) => unknown;
};
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

// Nada sale a la red: si algún módulo intentara Upstash, Mercado Pago o
// Supabase de verdad, el test falla en lugar de escribir afuera.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`el test no usa la red (${String(input).slice(0, 30)}…)`);
}) as typeof fetch;

// ── Datos ───────────────────────────────────────────────────────────────────
const FERRARI = "Ferrari";
const MCLAREN = "McLaren";
const REDBULL = "Red Bull";
const ALPINE = "Alpine";

/** 30/09/2026 23:59:59.999 ART. */
const ANTES = new Date(CORTE_MODALIDAD_V2_MS - 1);
/** 01/10/2026 00:00:00.000 ART: el corte. */
const CORTE = new Date(CORTE_MODALIDAD_V2_MS);
const DESPUES = new Date(CORTE_MODALIDAD_V2_MS + 60 * 60_000);

const LUNES = "2026-10-05";
const SABADO = "2026-10-03";

const cuerpo = (extra: Record<string, unknown> = {}) => ({
  nombre: "Prueba B3",
  telefono: "3510000000",
  fecha: LUNES,
  hora: "12:00",
  simuladores: [FERRARI],
  acepto_condiciones: true,
  ...extra,
});

function esFallo(r: { ok: boolean }, status: number, codigo?: string): asserts r is Fallo {
  assert.equal(r.ok, false, "se esperaba un rechazo");
  assert.equal((r as Fallo).status, status);
  if (codigo) assert.equal((r as Fallo).codigo, codigo);
}

const slotsDe = (reservaId: number) =>
  tabla("reserva_slots")
    .filter((s) => s.reserva_id === reservaId)
    .map((s) => `${s.hora}|${s.simulador}|${s.ocupacion_min ?? "-"}`)
    .sort();

async function main() {
  // ── 1. Catálogo vigente y corte exacto ────────────────────────────────────
  {
    reiniciar();
    const a = await catalogoReservasVigente(ANTES);
    assert.equal(a.modalidad, "legacy", "23:59:59.999 → legacy");
    assert.deepEqual(a.duraciones, [15, 30]);
    assert.equal(a.duracion_inicial, 15);
    assert.deepEqual(a.precios_base, {
      semana: { 15: 12000, 30: 18000 },
      fin_de_semana: { 15: 12000, 30: 20000 },
    });
    assert.equal(a.desde_precio, 12000);
    assert.equal(a.paso_min, 20);
    assert.equal(a.buffer_min, null);
    assert.deepEqual(a.horario, {
      semana: { desde: "10:00", hasta: "21:40" },
      fin_de_semana: { desde: "10:00", hasta: "14:00" },
    });
    assert.equal(a.ventana[0], "2026-10-01");
    assert.equal(a.ventana[a.ventana.length - 1], "2026-10-15");

    const v = await catalogoReservasVigente(CORTE);
    assert.equal(v.modalidad, "v2_10", "00:00:00.000 → v2_10");
    assert.deepEqual(v.duraciones, [10, 20, 30]);
    assert.equal(v.duracion_inicial, 10);
    const v2 = { 10: 10000, 20: 17000, 30: 23000 };
    assert.deepEqual(v.precios_base, { semana: v2, fin_de_semana: v2 });
    assert.equal(v.desde_precio, 10000);
    assert.equal(v.paso_min, 10);
    assert.equal(v.buffer_min, 10);
    assert.deepEqual(v.horario, {
      semana: { desde: "10:00", hasta: "21:50" },
      fin_de_semana: { desde: "10:00", hasta: "14:00" },
    });
    assert.equal(v.ventana[0], "2026-10-02", "a las 00:00 del 01/10 la ventana ya arranca el 02/10");

    // El override de la base gana (rollback y contingencia), y un error al
    // leerlo sigue el calendario.
    override("legacy");
    assert.equal((await catalogoReservasVigente(DESPUES)).modalidad, "legacy", "rollback: override legacy");
    override("v2_10");
    assert.equal((await catalogoReservasVigente(ANTES)).modalidad, "v2_10", "contingencia: override v2");
    reiniciar();
    fallar("modalidad_comercial_config", "select", { message: "caída" });
    assert.equal((await catalogoReservasVigente(ANTES)).modalidad, "legacy");
    fallar("modalidad_comercial_config", "select", { message: "caída" });
    assert.equal((await catalogoReservasVigente(CORTE)).modalidad, "v2_10");
  }

  // ── 2. Disponibilidad pública en el corte ─────────────────────────────────
  {
    reiniciar();
    const a = await disponibilidadReservas({ fecha: LUNES, ahora: ANTES });
    assert.ok(a.ok);
    assert.equal(a.data.modalidad, "legacy");
    assert.equal(a.data.duracion, 15);
    assert.deepEqual(a.data.grilla, horariosDe(LUNES), "legacy: la grilla de 20 de siempre");
    assert.equal(a.data.grilla[a.data.grilla.length - 1], "21:40");
    assert.equal(a.data.precio, 12000);
    assert.deepEqual(a.data.precios, { 15: 12000, 30: 18000 });
    assert.ok(a.data.horarios.every((h) => h.disponibles === 4));

    const v = await disponibilidadReservas({ fecha: LUNES, ahora: CORTE });
    assert.ok(v.ok);
    assert.equal(v.data.modalidad, "v2_10");
    assert.equal(v.data.duracion, 10);
    assert.equal(v.data.grilla.length, 72, "10:00 a 21:50 cada 10");
    assert.equal(v.data.grilla[0], "10:00");
    assert.equal(v.data.grilla[71], "21:50");
    assert.equal(v.data.precio, 10000);
    assert.deepEqual(v.data.precios, { 10: 10000, 20: 17000, 30: 23000 });

    // v2 30 min: misma grilla del día; 21:40 y 21:50 no entran ("Sin lugares").
    const v30 = await disponibilidadReservas({ fecha: LUNES, duracion: 30, ahora: CORTE });
    assert.ok(v30.ok);
    assert.deepEqual(v30.data.grilla, v.data.grilla);
    const horas30 = v30.data.horarios.map((h) => h.hora);
    assert.equal(horas30[horas30.length - 1], "21:30");
    assert.ok(!horas30.includes("21:40") && !horas30.includes("21:50"));
    assert.equal(v30.data.precio, 23000);

    // Fin de semana v2: último inicio 14:00 para todas las duraciones.
    for (const d of [10, 20, 30]) {
      const s = await disponibilidadReservas({ fecha: SABADO, duracion: d, ahora: CORTE });
      assert.ok(s.ok);
      assert.equal(s.data.horarios[s.data.horarios.length - 1].hora, "14:00", `finde v2 ${d} min`);
      assert.equal(s.data.grilla[s.data.grilla.length - 1], "14:00");
      assert.equal(s.data.precio, d === 10 ? 10000 : d === 20 ? 17000 : 23000, "v2: mismo precio los siete días");
    }
    const s30 = await disponibilidadReservas({ fecha: SABADO, duracion: 30, ahora: ANTES });
    assert.ok(s30.ok);
    assert.equal(s30.data.precio, 20000, "legacy: el 30 de finde sigue en $20.000");

    // Sin fecha: el primer día reservable, resuelto en el MISMO request.
    const sa = await disponibilidadReservas({ ahora: ANTES });
    assert.ok(sa.ok);
    assert.equal(sa.data.fecha, "2026-10-01");
    const sc = await disponibilidadReservas({ ahora: CORTE });
    assert.ok(sc.ok);
    assert.equal(sc.data.fecha, "2026-10-02");

    // Duración de la otra modalidad → 400 con las vigentes (el front se recupera).
    const d15 = await disponibilidadReservas({ fecha: LUNES, duracion: 15, ahora: CORTE });
    esFallo(d15, 400);
    assert.deepEqual(d15.duraciones, [10, 20, 30]);
    const d10 = await disponibilidadReservas({ fecha: LUNES, duracion: 10, ahora: ANTES });
    esFallo(d10, 400);
    assert.deepEqual(d10.duraciones, [15, 30]);
    esFallo(await disponibilidadReservas({ fecha: "2026-10-01", ahora: CORTE }), 400);
    esFallo(await disponibilidadReservas({ fecha: "2026-13-01", ahora: CORTE }), 400);
  }

  // ── 3. Pedido: la modalidad se resuelve UNA vez; pestaña vieja → 409 ──────
  {
    reiniciar();
    const ok = async (body: Record<string, unknown>, ahora: Date) => {
      const r = await prepararReservaWeb(body, { ahora });
      assert.ok(r.ok, `se esperaba aceptar: ${JSON.stringify(r)}`);
      return r.pedido;
    };
    let p = await ok(cuerpo({ duracion_minutos: 15, modalidad_vista: "legacy" }), ANTES);
    assert.equal(p.modalidad, "legacy");
    assert.equal(p.duracion, 15);
    assert.equal(p.resuelto_en, ANTES.toISOString());
    p = await ok(cuerpo({ duracion_minutos: 30 }), ANTES);
    assert.equal(p.modalidad, "legacy", "un cliente sin modalidad_vista (anterior a B3) vio legacy");

    p = await ok(cuerpo({ duracion_minutos: 10, modalidad_vista: "v2_10" }), CORTE);
    assert.equal(p.modalidad, "v2_10");
    assert.equal(p.duracion, 10);
    assert.deepEqual(p.bloques, ["12:00"]);

    for (const [body, ahora, caso] of [
      [cuerpo({ duracion_minutos: 15, modalidad_vista: "legacy" }), CORTE, "pestaña legacy a las 00:00"],
      [cuerpo({ duracion_minutos: 15 }), CORTE, "cliente viejo a las 00:00"],
      [cuerpo({ duracion_minutos: 30, modalidad_vista: "legacy" }), CORTE, "30 legacy no es 30 v2"],
      [cuerpo({ duracion_minutos: 10, modalidad_vista: "v2_10" }), ANTES, "v2 antes del corte"],
      [cuerpo({ duracion_minutos: 10, modalidad_vista: "v3" }), CORTE, "modalidad desconocida"],
    ] as const) {
      const r = await prepararReservaWeb(body, { ahora });
      esFallo(r, 409, "catalogo_actualizado");
      assert.equal(r.error, CATALOGO_ACTUALIZADO.mensaje, caso);
    }
    assert.equal(
      CATALOGO_ACTUALIZADO.mensaje,
      "Actualizamos nuestros turnos y precios. Revisá las nuevas opciones para continuar.",
    );
    assert.deepEqual(operaciones.filter((o) => !o.startsWith("select:")), [], "validar no escribe nada");
  }

  // ── 4. Precios: legacy, v2 y especiales, siempre del servidor ─────────────
  {
    const LUNES_ = LUNES;
    assert.equal(precioReservaPara("legacy", LUNES_, 15, null), 12000);
    assert.equal(precioReservaPara("legacy", LUNES_, 30, null), 18000);
    assert.equal(precioReservaPara("legacy", SABADO, 30, null), 20000);
    assert.equal(precioReservaPara("legacy", SABADO, 15, null), 12000);
    assert.equal(precioReservaPara("legacy", LUNES_, 10, null), null, "legacy no vende 10");
    for (const f of [LUNES_, SABADO]) {
      assert.equal(precioReservaPara("v2_10", f, 10, null), 10000);
      assert.equal(precioReservaPara("v2_10", f, 20, null), 17000);
      assert.equal(precioReservaPara("v2_10", f, 30, null), 23000);
      assert.equal(precioReservaPara("v2_10", f, 15, null), null, "v2 no vende 15");
    }
    const especial: PrecioEspecialCompleto = { precio_10: 8000, precio_15: 9000, precio_20: null, precio_30: 21000 };
    assert.equal(precioReservaPara("legacy", LUNES_, 15, especial), 9000, "legacy 15 → precio_15");
    assert.equal(precioReservaPara("legacy", LUNES_, 30, especial), 21000, "legacy 30 → precio_30");
    assert.equal(precioReservaPara("v2_10", LUNES_, 10, especial), 8000, "v2 10 → precio_10");
    assert.equal(precioReservaPara("v2_10", LUNES_, 20, especial), 17000, "v2 20 sin precio_20 → base");
    assert.equal(precioReservaPara("v2_10", LUNES_, 30, especial), 21000, "v2 30 → precio_30");
    assert.equal(
      precioReservaPara("legacy", LUNES_, 15, { precio_10: 1, precio_15: null, precio_20: 2, precio_30: null }),
      12000,
      "legacy ignora precio_10/precio_20",
    );

    // Precio del pedido: el del servidor; `precio_visto` distinto → 409.
    reiniciar();
    const r = await prepararReservaWeb(
      cuerpo({ duracion_minutos: 30, modalidad_vista: "legacy", simuladores: [FERRARI, MCLAREN] }),
      { ahora: ANTES },
    );
    assert.ok(r.ok);
    const pr = await precioDelPedido(r.pedido, { precio_visto: 18000, total: 1 });
    assert.ok(pr.ok);
    assert.equal(pr.precioUnitario, 18000);
    assert.equal(pr.totalOriginal, 36000, "el total del cliente no se usa");
    esFallo(await precioDelPedido(r.pedido, { precio_visto: 12000 }), 409, "catalogo_actualizado");
    assert.ok((await precioDelPedido(r.pedido, {})).ok, "un cliente viejo sin precio_visto");

    // Con precio especial, la disponibilidad ya muestra el efectivo.
    reiniciar({ reservas_precios_especiales: [{ fecha: LUNES, ...especial }] });
    const dv = await disponibilidadReservas({ fecha: LUNES, duracion: 20, ahora: CORTE });
    assert.ok(dv.ok);
    assert.deepEqual(dv.data.precios, { 10: 8000, 20: 17000, 30: 21000 });
    assert.deepEqual(dv.data.precios_base_dia, { 10: 10000, 20: 17000, 30: 23000 });
    const dl = await disponibilidadReservas({ fecha: LUNES, ahora: ANTES });
    assert.ok(dl.ok);
    assert.deepEqual(dl.data.precios, { 15: 9000, 30: 21000 });
    assert.equal(dl.data.desde_precio, 12000, "el \"desde\" es el precio base, no el especial");
  }

  // ── 5. Cierres ──────────────────────────────────────────────────────────
  {
    const valida = (fecha: string, hora: string, d: number, modalidad: "legacy" | "v2_10" = "v2_10") =>
      validarReservaInput(cuerpo({ fecha, hora, duracion_minutos: d }), { hoy: "2026-10-01", modalidad }).ok;
    // L-V v2: el tiempo comercial termina ≤ 22:00.
    assert.ok(valida(LUNES, "21:50", 10), "10@21:50");
    assert.ok(valida(LUNES, "21:40", 20), "20@21:40");
    assert.ok(valida(LUNES, "21:30", 30), "30@21:30");
    assert.ok(!valida(LUNES, "21:40", 30), "30@21:40 no");
    assert.ok(!valida(LUNES, "21:50", 20), "20@21:50 no");
    assert.ok(!valida(LUNES, "22:00", 10), "22:00 no");
    assert.ok(valida(LUNES, "10:00", 10));
    assert.ok(!valida(LUNES, "09:50", 10), "antes de abrir no");
    assert.ok(!valida(LUNES, "12:05", 10), "fuera de la grilla de 10");
    // Finde v2: último inicio 14:00 para todas.
    for (const d of [10, 20, 30]) {
      assert.ok(valida(SABADO, "14:00", d), `finde ${d}@14:00`);
      assert.ok(!valida(SABADO, "14:10", d), `finde ${d}@14:10 no`);
    }
    // Legacy, igual que siempre.
    assert.ok(valida(LUNES, "21:40", 15, "legacy"));
    assert.ok(!valida(LUNES, "21:40", 30, "legacy"), "legacy 30@21:40: no hay turno consecutivo");
    assert.ok(valida(LUNES, "21:20", 30, "legacy"));
    assert.ok(valida(SABADO, "14:00", 15, "legacy"));
    assert.ok(!valida(LUNES, "12:10", 15, "legacy"), "legacy: grilla de 20");
    assert.ok(!valida(LUNES, "12:00", 10, "legacy"), "legacy no vende 10");
    assert.ok(!valida(LUNES, "12:00", 15, "v2_10"), "v2 no vende 15");
  }

  // ── 6. Capacidad: v2 20 min @12:00 con 2 simuladores ──────────────────────
  {
    const reserva = {
      id: 101, fecha: LUNES, hora: "12:00", duracion_minutos: 20, simuladores: [FERRARI, MCLAREN],
      estado: "activa", modalidad: "v2_10", origen: null, created_at: "2026-10-01T03:05:00Z",
    };
    const slots = filasSlotsReserva(reserva).map((f, i) => ({ id: 900 + i, ...f }));
    assert.deepEqual(slots.map((s) => s.ocupacion_min), [30, 30], "20 + 10 de buffer, una fila por simulador");
    reiniciar({ reservas: [reserva], reserva_slots: slots });

    const libres = async (d: number, hora: string) => {
      const r = await disponibilidadReservas({ fecha: LUNES, duracion: d, ahora: DESPUES });
      assert.ok(r.ok);
      return r.data.horarios.find((h) => h.hora === hora)?.libres ?? null;
    };
    for (const d of [10, 20, 30]) {
      for (const h of ["12:00", "12:10", "12:20"]) {
        assert.deepEqual(await libres(d, h), [REDBULL, ALPINE], `[12:00, 12:30) ocupado: ${d}@${h}`);
      }
      assert.equal((await libres(d, "12:30"))?.length, 4, `libre desde 12:30 (${d})`);
    }
    // Lo que TERMINA (buffer incluido) justo a las 12:00 no choca.
    assert.equal((await libres(10, "11:40"))?.length, 4);
    assert.deepEqual(await libres(10, "11:50"), [REDBULL, ALPINE]);
    assert.equal((await libres(20, "11:30"))?.length, 4);
    assert.deepEqual(await libres(20, "11:40"), [REDBULL, ALPINE]);
    assert.equal((await libres(30, "11:20"))?.length, 4);
    assert.deepEqual(await libres(30, "11:30"), [REDBULL, ALPINE]);

    const turno = (hora: string, d: number, sims: string[]) =>
      evaluarTurno({ modalidad: "v2_10", fecha: LUNES, hora, duracion: d, simuladores: sims, ahora: DESPUES });
    assert.equal((await turno("12:20", 10, [FERRARI])).ocupado?.status, 409);
    assert.equal((await turno("12:00", 20, [REDBULL, ALPINE])).ocupado, null);
    assert.equal((await turno("12:30", 10, [FERRARI, MCLAREN])).ocupado, null, "contigua");
    // Lo que todavía calcula por bloques (Mensualidades, Empresas) la ve.
    const mapa = construirOcupacion(LUNES, [reserva]);
    assert.deepEqual(Object.keys(mapa).sort(), ["12:00", "12:20"]);
    assert.deepEqual([...mapa["12:20"]].sort(), [FERRARI, MCLAREN]);
  }

  // ── 7. Filas de slots, ocupación por bloques y presentación ───────────────
  {
    const base = { id: 7, fecha: LUNES, hora: "12:00", simuladores: [FERRARI, REDBULL] };
    const legacy15 = filasSlotsReserva({ ...base, duracion_minutos: 15, modalidad: "legacy" });
    assert.deepEqual(legacy15.map((f) => `${f.hora}|${f.simulador}|${f.ocupacion_min ?? "-"}`),
      ["12:00|Ferrari|-", "12:00|Red Bull|-"]);
    const legacy30 = filasSlotsReserva({ ...base, duracion_minutos: 30, modalidad: null });
    assert.deepEqual(legacy30.map((f) => `${f.hora}|${f.simulador}`),
      ["12:00|Ferrari", "12:00|Red Bull", "12:20|Ferrari", "12:20|Red Bull"], "NULL = legacy: bloques de 20");
    assert.ok(legacy30.every((f) => !("ocupacion_min" in f)), "legacy no escribe ocupacion_min");
    for (const [d, oc] of [[10, 20], [20, 30], [30, 40]]) {
      const v = filasSlotsReserva({ ...base, duracion_minutos: d, modalidad: "v2_10" });
      assert.deepEqual(v.map((f) => `${f.hora}|${f.simulador}|${f.ocupacion_min}`),
        [`12:00|Ferrari|${oc}`, `12:00|Red Bull|${oc}`], `v2 ${d} → ocupacion_min ${oc}`);
    }
    // B0: en v2 ocupa duración + buffer cualquier múltiplo de 5 (un 15 de
    // Empresa canjeado con la agenda nueva ocupa 25); lo que no se puede ubicar, lanza.
    assert.deepEqual(filasSlotsReserva({ ...base, duracion_minutos: 15, modalidad: "v2_10" }).map((f) => f.ocupacion_min), [25, 25]);
    assert.throws(() => filasSlotsReserva({ ...base, duracion_minutos: 7, modalidad: "v2_10" }));

    // construirOcupacion: legacy idéntico a getOccupiedSlots; v2 marca los bloques que toca.
    const legacyReservas = [
      { hora: "12:00", duracion_minutos: 30, simuladores: [FERRARI] },
      { hora: "21:40", duracion_minutos: 30, simuladores: [ALPINE], modalidad: "legacy" },
      { hora: "13:00", duracion_minutos: null, simuladores: [MCLAREN], modalidad: null },
    ];
    const m = construirOcupacion(LUNES, legacyReservas);
    const esperado: Record<string, string[]> = {};
    for (const r of legacyReservas) {
      for (const s of getOccupiedSlots(LUNES, r.hora, Number(r.duracion_minutos) || 15)) {
        (esperado[s] ??= []).push(...r.simuladores);
      }
    }
    assert.deepEqual(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()])),
      Object.fromEntries(Object.entries(esperado).map(([k, v]) => [k, [...v].sort()])));
    const v10 = construirOcupacion(LUNES, [{ hora: "12:10", duracion_minutos: 10, simuladores: [FERRARI], modalidad: "v2_10" }]);
    assert.deepEqual(Object.keys(v10).sort(), ["12:00", "12:20"], "[12:10, 12:30) toca 12:00 y 12:20");

    assert.deepEqual(rangoV2({ hora: "12:00", duracion_minutos: 20, modalidad: "v2_10" }),
      { inicio: "12:00", finComercial: "12:20", finOcupacion: "12:30" });
    assert.equal(rangoV2({ hora: "12:00", duracion_minutos: 30, modalidad: "legacy" }), null);
    assert.equal(rangoV2({ hora: "12:00", duracion_minutos: 30, modalidad: null }), null);
    assert.equal(turnosDeReserva({ duracion_minutos: 15 }), 1);
    assert.equal(turnosDeReserva({ duracion_minutos: 30, modalidad: null }), 2);
    assert.equal(turnosDeReserva({ duracion_minutos: 10, modalidad: "v2_10" }), 1);
    assert.equal(turnosDeReserva({ duracion_minutos: 20, modalidad: "v2_10" }), 2);
    assert.equal(turnosDeReserva({ duracion_minutos: 30, modalidad: "v2_10" }), 3, "el buffer no suma turnos");
  }

  // ── 8. Webhook: modalidad GUARDADA, nunca activa sin slots, idempotente ───
  {
    const pagos: string[] = [];
    const codigos: string[] = [];
    const deps = {
      registrarPago: (async (paymentId: string) => { pagos.push(paymentId); }) as never,
      consumirCodigo: (async (codigo: string) => { codigos.push(codigo); return true; }) as never,
    };
    const pendiente = (extra: Record<string, unknown>) => ({
      nombre: "Prueba B3", telefono: "3510000000", fecha: LUNES, estado: "pendiente_pago",
      total_original: 0, descuento_aplicado: 0, codigo_descuento: null, mercado_pago_payment_id: null,
      origen: null, ...extra,
    });
    const pagar = (reservaId: number, paymentId: string) =>
      procesarPagoAprobadoReserva({ reservaId, paymentId, paymentData: {} as never, deps });
    const reserva = (id: number) => tabla("reservas").find((r) => r.id === id)!;
    const reiniciarPagos = () => { pagos.length = 0; codigos.length = 0; };

    // Pago tardío: creada legacy 23:55 del 30/09, pagada después del corte →
    // sigue legacy (bloques de 20, misma duración, mismo total).
    reiniciar({ reservas: [pendiente({
      id: 201, hora: "13:00", duracion_minutos: 30, simuladores: [REDBULL, FERRARI], modalidad: "legacy",
      total: 36000, total_original: 36000, cantidad_turnos: 2, created_at: "2026-10-01T02:55:00Z",
    })] });
    reiniciarPagos();
    let r = await pagar(201, "PAGO-201");
    assert.equal(r.http, 200);
    assert.equal(r.estado, "activa");
    assert.equal(reserva(201).estado, "activa");
    assert.equal(reserva(201).mercado_pago_payment_id, "PAGO-201");
    assert.equal(reserva(201).modalidad, "legacy", "la modalidad no cambia al pagar");
    assert.equal(reserva(201).duracion_minutos, 30);
    assert.equal(reserva(201).total, 36000);
    assert.deepEqual(slotsDe(201), ["13:00|Ferrari|-", "13:00|Red Bull|-", "13:20|Ferrari|-", "13:20|Red Bull|-"]);
    assert.deepEqual(pagos, ["PAGO-201"], "Finanzas registra el pago una vez");
    // Notificación repetida: nada nuevo.
    r = await pagar(201, "PAGO-201");
    assert.equal(r.http, 200);
    assert.equal(r.estado, undefined, "ya estaba procesada");
    assert.equal(slotsDe(201).length, 4, "sin slots duplicados");
    assert.deepEqual(pagos, ["PAGO-201"], "sin duplicar Finanzas");

    // v2 aprobado: una fila por simulador con duración + buffer.
    reiniciar({ reservas: [pendiente({
      id: 202, hora: "12:00", duracion_minutos: 20, simuladores: [FERRARI, MCLAREN], modalidad: "v2_10",
      total: 34000, created_at: "2026-10-01T04:00:00Z",
    })] });
    reiniciarPagos();
    r = await pagar(202, "PAGO-202");
    assert.equal(r.estado, "activa");
    assert.deepEqual(slotsDe(202), ["12:00|Ferrari|30", "12:00|McLaren|30"]);
    assert.equal(reserva(202).modalidad, "v2_10");

    // Pendiente anterior a B3 (modalidad NULL) → legacy.
    reiniciar({ reservas: [pendiente({ id: 203, hora: "18:20", duracion_minutos: 15, simuladores: [ALPINE], modalidad: null, total: 12000 })] });
    r = await pagar(203, "PAGO-203");
    assert.equal(r.estado, "activa");
    assert.deepEqual(slotsDe(203), ["18:20|Alpine|-"]);
    assert.equal(reserva(203).modalidad, null, "NULL se queda NULL (= legacy)");

    // Dos notificaciones a la vez: la otra creó los slots entre el conteo y el
    // insert → 23505 contra sí misma → igual queda activa, sin duplicados.
    reiniciar({ reservas: [pendiente({ id: 204, hora: "15:00", duracion_minutos: 10, simuladores: [FERRARI], modalidad: "v2_10", total: 10000 })] });
    antesDe("reserva_slots", "insert", () => {
      tabla("reserva_slots").push({ id: 1, reserva_id: 204, fecha: LUNES, hora: "15:00", simulador: FERRARI, estado: "activa", ocupacion_min: 20 });
    });
    r = await pagar(204, "PAGO-204");
    assert.equal(r.estado, "activa");
    assert.deepEqual(slotsDe(204), ["15:00|Ferrari|20"]);

    // 23505 contra OTRA reserva → conflicto_pago con payment_id, sin slots,
    // pago preservado, código sin consumir.
    reiniciar({
      reservas: [pendiente({ id: 205, hora: "12:00", duracion_minutos: 20, simuladores: [FERRARI, MCLAREN], modalidad: "v2_10", total: 34000, codigo_descuento: "B3-DESC" })],
      reserva_slots: [{ id: 1, reserva_id: 999, fecha: LUNES, hora: "12:10", simulador: MCLAREN, estado: "activa", ocupacion_min: 20 }],
    });
    reiniciarPagos();
    r = await pagar(205, "PAGO-205");
    assert.equal(r.http, 200, "200: Mercado Pago no tiene que reintentar");
    assert.equal(r.estado, ESTADO_CONFLICTO_PAGO);
    assert.equal(r.motivo, "ocupado");
    assert.equal(reserva(205).estado, "conflicto_pago");
    assert.equal(reserva(205).mercado_pago_payment_id, "PAGO-205", "el payment_id no se pierde");
    assert.deepEqual(slotsDe(205), [], "ningún slot parcial");
    assert.deepEqual(pagos, ["PAGO-205"], "el pago queda registrado (sin reembolso automático)");
    assert.deepEqual(codigos, [], "sin turno no se consume el código");

    // 23514 (bloqueo) y cualquier otro error → conflicto, nunca activa.
    for (const [code, motivo] of [["23514", "bloqueado"], ["XX000", "error_slots"]] as const) {
      reiniciar({ reservas: [pendiente({ id: 206, hora: "12:00", duracion_minutos: 15, simuladores: [FERRARI], modalidad: "legacy", total: 12000 })] });
      fallar("reserva_slots", "insert", { code, message: `forzado ${code}` });
      r = await pagar(206, `PAGO-206-${code}`);
      assert.equal(r.http, 200);
      assert.equal(reserva(206).estado, "conflicto_pago", `${code} → conflicto_pago`);
      assert.equal(r.motivo, motivo);
      assert.equal(reserva(206).mercado_pago_payment_id, `PAGO-206-${code}`);
      assert.deepEqual(slotsDe(206), []);
    }

    // Sin simuladores: no hay turno que tomar → conflicto, no activa.
    reiniciar({ reservas: [pendiente({ id: 207, hora: "12:00", duracion_minutos: 15, simuladores: [], modalidad: "legacy", total: 12000 })] });
    r = await pagar(207, "PAGO-207");
    assert.equal(reserva(207).estado, "conflicto_pago");
    assert.equal(r.motivo, "sin_turno");

    // No se pudo contar → 500 sin tocar la reserva (Mercado Pago reintenta).
    reiniciar({ reservas: [pendiente({ id: 208, hora: "12:00", duracion_minutos: 15, simuladores: [FERRARI], modalidad: "legacy", total: 12000 })] });
    fallar("reserva_slots", "select", { message: "caída" });
    r = await pagar(208, "PAGO-208");
    assert.equal(r.http, 500);
    assert.equal(reserva(208).estado, "pendiente_pago");
    assert.equal(reserva(208).mercado_pago_payment_id, null);
    // Falla el UPDATE final con los slots ya creados → 500; el reintento activa sin duplicar.
    fallar("reservas", "update", { message: "caída" });
    r = await pagar(208, "PAGO-208");
    assert.equal(r.http, 500);
    assert.equal(slotsDe(208).length, 1);
    r = await pagar(208, "PAGO-208");
    assert.equal(r.estado, "activa");
    assert.equal(slotsDe(208).length, 1, "el reintento no duplica slots");

    // Código de descuento: solo se consume al activar.
    reiniciar({ reservas: [pendiente({ id: 209, hora: "16:00", duracion_minutos: 30, simuladores: [ALPINE], modalidad: "v2_10", total: 11500, codigo_descuento: "B3-DESC" })] });
    reiniciarPagos();
    await pagar(209, "PAGO-209");
    assert.deepEqual(codigos, ["B3-DESC"]);
    await pagar(209, "PAGO-209");
    assert.deepEqual(codigos, ["B3-DESC"], "una sola vez");

    reiniciar();
    assert.equal((await pagar(404, "PAGO-404")).http, 404);
  }

  // ── 9. Reactivación y cancelación desde la administración ─────────────────
  {
    const codigos: string[] = [];
    const consumirCodigo = (async (c: string) => { codigos.push(c); return true; }) as never;
    const reactivar = (id: number) => cambiarEstadoReserva(id, "activa", { ahora: DESPUES, consumirCodigo });
    const reserva = (id: number) => tabla("reservas").find((r) => r.id === id)!;
    const base = (extra: Record<string, unknown>) => ({
      nombre: "Prueba B3", telefono: "3510000000", fecha: LUNES, hora: "12:00", estado: "cancelada",
      origen: null, codigo_descuento: null, mercado_pago_payment_id: null, created_at: "2026-09-30T15:00:00Z",
      ...extra,
    });

    // Legacy reactivada DESPUÉS del corte: sigue legacy.
    reiniciar({ reservas: [base({ id: 301, duracion_minutos: 30, simuladores: [FERRARI, MCLAREN], modalidad: "legacy" })] });
    let r = await reactivar(301);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(reserva(301).estado, "activa");
    assert.equal(reserva(301).modalidad, "legacy");
    assert.deepEqual(slotsDe(301), ["12:00|Ferrari|-", "12:00|McLaren|-", "12:20|Ferrari|-", "12:20|McLaren|-"]);
    // NULL también.
    reiniciar({ reservas: [base({ id: 302, duracion_minutos: 15, simuladores: [ALPINE], modalidad: null })] });
    assert.ok((await reactivar(302)).ok);
    assert.deepEqual(slotsDe(302), ["12:00|Alpine|-"]);
    // v2 sigue v2.
    reiniciar({ reservas: [base({ id: 303, duracion_minutos: 20, simuladores: [REDBULL], modalidad: "v2_10" })] });
    assert.ok((await reactivar(303)).ok);
    assert.deepEqual(slotsDe(303), ["12:00|Red Bull|30"]);

    // Ocupado por otra → 409, sigue cancelada y sin slots.
    const otra = { id: 350, fecha: LUNES, hora: "12:10", duracion_minutos: 10, simuladores: [REDBULL], estado: "activa", modalidad: "v2_10", origen: null, created_at: "2026-10-01T05:00:00Z" };
    reiniciar({
      reservas: [base({ id: 304, duracion_minutos: 20, simuladores: [REDBULL], modalidad: "v2_10" }), otra],
      reserva_slots: filasSlotsReserva(otra).map((f, i) => ({ id: 1 + i, ...f })),
    });
    r = await reactivar(304);
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.equal(r.motivo, "ocupado");
    assert.equal(reserva(304).estado, "cancelada");
    assert.deepEqual(slotsDe(304), []);

    // Bloqueado → 409, sin slots.
    reiniciar({
      reservas: [base({ id: 305, duracion_minutos: 15, simuladores: [FERRARI], modalidad: "legacy" })],
      bloqueos_reservas: [{ id: 1, fecha: LUNES, todo_el_dia: false, hora_inicio: "12:00", hora_fin: "12:10", simulador: FERRARI, activo: true }],
    });
    r = await reactivar(305);
    assert.ok(!r.ok);
    assert.equal(r.motivo, "bloqueado");
    assert.equal(reserva(305).estado, "cancelada");
    assert.deepEqual(slotsDe(305), []);

    // Carrera: otra reserva toma el turno entre la verificación y el insert → 409, nada parcial.
    reiniciar({ reservas: [base({ id: 306, duracion_minutos: 30, simuladores: [FERRARI, MCLAREN], modalidad: "legacy" })] });
    antesDe("reserva_slots", "insert", () => {
      tabla("reserva_slots").push({ id: 1, reserva_id: 999, fecha: LUNES, hora: "12:20", simulador: MCLAREN, estado: "activa", ocupacion_min: null });
    });
    r = await reactivar(306);
    assert.ok(!r.ok);
    assert.equal(r.motivo, "ocupado");
    assert.equal(reserva(306).estado, "cancelada");
    assert.deepEqual(slotsDe(306), [], "el insert es uno solo: todos o ninguno");

    // El estado cambió en el medio → 409 y se deshacen los slots recién creados.
    reiniciar({ reservas: [base({ id: 307, duracion_minutos: 10, simuladores: [ALPINE], modalidad: "v2_10" })] });
    antesDe("reservas", "update", () => { reserva(307).estado = "reembolsada"; });
    r = await reactivar(307);
    assert.ok(!r.ok);
    assert.equal(r.motivo, "estado_cambiado");
    assert.deepEqual(slotsDe(307), []);

    // Pagada sin turno (conflicto_pago) → al activarse consume el código pendiente.
    reiniciar({ reservas: [base({
      id: 308, estado: "conflicto_pago", duracion_minutos: 20, simuladores: [FERRARI], modalidad: "v2_10",
      codigo_descuento: "B3-DESC", mercado_pago_payment_id: "PAGO-308", total: 15000,
    })] });
    r = await reactivar(308);
    assert.ok(r.ok);
    assert.equal(reserva(308).estado, "activa");
    assert.equal(reserva(308).mercado_pago_payment_id, "PAGO-308");
    assert.deepEqual(slotsDe(308), ["12:00|Ferrari|30"]);
    assert.deepEqual(codigos, ["B3-DESC"]);
    // Una cancelada que se reactiva NO vuelve a consumirlo.
    codigos.length = 0;
    reiniciar({ reservas: [base({ id: 309, duracion_minutos: 15, simuladores: [FERRARI], modalidad: "legacy", codigo_descuento: "B3-DESC", mercado_pago_payment_id: "PAGO-309" })] });
    assert.ok((await reactivar(309)).ok);
    assert.deepEqual(codigos, []);

    // Ya activa y completa: no toca nada.
    reiniciar({
      reservas: [base({ id: 310, estado: "activa", duracion_minutos: 15, simuladores: [FERRARI], modalidad: "legacy" })],
      reserva_slots: [{ id: 1, reserva_id: 310, fecha: LUNES, hora: "12:00", simulador: FERRARI, estado: "activa", ocupacion_min: null }],
    });
    assert.ok((await reactivar(310)).ok);
    assert.ok(!operaciones.some((o) => o.startsWith("insert:") || o.startsWith("update:") || o.startsWith("delete:")));

    // Reembolsada: terminal. Inexistente: 404.
    reiniciar({ reservas: [base({ id: 311, estado: "reembolsada", duracion_minutos: 15, simuladores: [FERRARI], modalidad: "legacy" })] });
    r = await reactivar(311);
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    reiniciar();
    r = await reactivar(312);
    assert.ok(!r.ok);
    assert.equal(r.status, 404);

    // Cancelar una v2: libera TODO (el buffer vive en la misma fila).
    const activaV2 = { id: 320, fecha: LUNES, hora: "12:00", duracion_minutos: 30, simuladores: [FERRARI, ALPINE], estado: "activa", modalidad: "v2_10", origen: null, created_at: "2026-10-01T05:00:00Z" };
    reiniciar({ reservas: [activaV2], reserva_slots: filasSlotsReserva(activaV2).map((f, i) => ({ id: 1 + i, ...f })) });
    r = await cambiarEstadoReserva(320, "cancelada");
    assert.ok(r.ok);
    assert.equal(reserva(320).estado, "cancelada");
    assert.equal(reserva(320).modalidad, "v2_10");
    assert.deepEqual(slotsDe(320), []);
    const d = await disponibilidadReservas({ fecha: LUNES, duracion: 10, ahora: DESPUES });
    assert.ok(d.ok);
    assert.equal(d.data.horarios.find((h) => h.hora === "12:30")?.disponibles, 4, "el buffer también se liberó");
  }

  // ── 10. Rutas reales contra la base falsa ─────────────────────────────────
  {
    // Antes de cargar las rutas: sin Upstash (rate limit en memoria) y con una
    // configuración de pago de mentira. `fetch` sigue bloqueado.
    for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) {
      delete process.env[k];
    }
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-B3-SIN-RED";
    process.env.NEXT_PUBLIC_BASE_URL = "https://b3.invalid";
    const { Preference } = await import("mercadopago");
    const preferencias: Array<{ body: { items: Array<{ unit_price: number }>; external_reference: string } }> = [];
    (Preference.prototype as unknown as { create: (a: unknown) => Promise<unknown> }).create = async (a: unknown) => {
      preferencias.push(a as (typeof preferencias)[number]);
      return { id: `pref-${preferencias.length}`, init_point: "https://b3.invalid/pagar", sandbox_init_point: null };
    };
    const rutaReservas = await import("@/app/api/reservas/route");
    const rutaPreferencia = await import("@/app/api/mercadopago/preference/route");
    const rutaCatalogo = await import("@/app/api/reservas/catalogo/route");
    const rutaDisponibilidad = await import("@/app/api/reservas/disponibilidad/route");
    const rutaPrecio = await import("@/app/api/reservas/precio/route");
    const rutaDispPublica = await import("@/app/api/disponibilidad/route");

    let ip = 0;
    const post = (ruta: string, body: unknown, origin = "https://simexperience.com.ar") =>
      new Request(`https://simexperience.com.ar${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, "x-real-ip": `10.3.0.${++ip}` },
        body: JSON.stringify(body),
      });
    const get = (ruta: string) =>
      new Request(`https://simexperience.com.ar${ruta}`, { headers: { "x-real-ip": `10.4.0.${++ip}` } });
    const inserts = () => operaciones.filter((o) => o.startsWith("insert:") || o.startsWith("update:"));

    const ventana = fechasPublicas();
    const habil = ventana.find((f) => !esFinDeSemana(f))!;
    const codigoGratis = {
      id: 1, codigo: "B3-GRATIS", activo: true, fecha_inicio: null, fecha_fin: null, usos_maximos: null,
      usos_actuales: 0, dias_permitidos: null, solo_dias_habiles: false, fechas_bloqueadas: null,
      duraciones_permitidas: null, tipo_descuento: "porcentaje", valor_descuento: 100,
    };

    // a) Bonificada legacy: modalidad explícita, slots de 20, código consumido.
    reiniciar({ codigos_descuento: [codigoGratis] });
    override("legacy");
    let res = await rutaReservas.POST(post("/api/reservas", cuerpo({
      fecha: habil, hora: "12:00", duracion_minutos: 30, simuladores: [FERRARI, MCLAREN],
      codigo_descuento: "B3-GRATIS", modalidad_vista: "legacy", precio_visto: 18000,
    })));
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    let fila = tabla("reservas")[0];
    assert.equal(fila.modalidad, "legacy", "reservas.modalidad explícita");
    assert.equal(fila.estado, "activa");
    assert.equal(fila.duracion_minutos, 30);
    assert.equal(fila.cantidad_turnos, 2, "Métricas: cantidad de simuladores, como hoy");
    assert.equal(fila.total, 0);
    assert.equal(fila.total_original, 36000);
    assert.equal(fila.descuento_aplicado, 36000);
    assert.deepEqual(slotsDe(Number(fila.id)), ["12:00|Ferrari|-", "12:00|McLaren|-", "12:20|Ferrari|-", "12:20|McLaren|-"]);
    assert.equal(tabla("codigos_descuento")[0].usos_actuales, 1);

    // b) Bonificada v2: una fila por simulador con ocupacion_min.
    reiniciar({ codigos_descuento: [codigoGratis] });
    override("v2_10");
    res = await rutaReservas.POST(post("/api/reservas", cuerpo({
      fecha: habil, hora: "12:10", duracion_minutos: 20, simuladores: [REDBULL, ALPINE],
      codigo_descuento: "B3-GRATIS", modalidad_vista: "v2_10", precio_visto: 17000,
    })));
    assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
    fila = tabla("reservas")[0];
    assert.equal(fila.modalidad, "v2_10");
    assert.equal(fila.duracion_minutos, 20);
    assert.equal(fila.total_original, 34000);
    assert.deepEqual(slotsDe(Number(fila.id)), ["12:10|Alpine|30", "12:10|Red Bull|30"]);

    // c) Código restringido a 15: no se reinterpreta como 10 en v2.
    reiniciar({ codigos_descuento: [{ ...codigoGratis, duraciones_permitidas: [15] }] });
    override("v2_10");
    res = await rutaReservas.POST(post("/api/reservas", cuerpo({
      fecha: habil, hora: "12:00", duracion_minutos: 10, codigo_descuento: "B3-GRATIS", modalidad_vista: "v2_10", precio_visto: 10000,
    })));
    assert.equal(res.status, 400);
    assert.deepEqual(inserts(), []);

    // d) Pestaña vieja (bonificada): 409, ni reserva ni código.
    reiniciar({ codigos_descuento: [codigoGratis] });
    override("v2_10");
    res = await rutaReservas.POST(post("/api/reservas", cuerpo({
      fecha: habil, hora: "12:00", duracion_minutos: 15, codigo_descuento: "B3-GRATIS", modalidad_vista: "legacy", precio_visto: 12000,
    })));
    assert.equal(res.status, 409);
    let json = await res.json();
    assert.equal(json.codigo, "catalogo_actualizado");
    assert.equal(json.error, CATALOGO_ACTUALIZADO.mensaje);
    assert.deepEqual(inserts(), [], "0 reservas");
    assert.equal(tabla("codigos_descuento")[0].usos_actuales, 0);

    // e) Preferencia legacy: pendiente con SU modalidad y el precio del servidor.
    reiniciar();
    override("legacy");
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({
      fecha: habil, hora: "12:40", duracion_minutos: 15, modalidad_vista: "legacy", precio_visto: 12000, total: 1,
    })));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    fila = tabla("reservas")[0];
    assert.equal(fila.estado, "pendiente_pago");
    assert.equal(fila.modalidad, "legacy");
    assert.equal(fila.total, 12000, "el total del cliente se ignora");
    assert.equal(preferencias.length, 1);
    assert.equal(preferencias[0].body.items[0].unit_price, 12000);
    assert.equal(preferencias[0].body.external_reference, `reserva_${fila.id}`);
    assert.deepEqual(slotsDe(Number(fila.id)), [], "la pendiente no toma slots");

    // f) Preferencia v2.
    reiniciar();
    override("v2_10");
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({
      fecha: habil, hora: "21:40", duracion_minutos: 20, simuladores: [FERRARI, MCLAREN], modalidad_vista: "v2_10", precio_visto: 17000,
    })));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    fila = tabla("reservas")[0];
    assert.equal(fila.modalidad, "v2_10");
    assert.equal(fila.duracion_minutos, 20);
    assert.equal(fila.total, 34000);
    assert.equal(preferencias[1].body.items[0].unit_price, 34000);

    // g) Pestaña vieja (pago): 409, 0 reservas, 0 preferencias, 0 Finanzas.
    const antes = preferencias.length;
    reiniciar();
    override("v2_10");
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({
      fecha: habil, hora: "12:00", duracion_minutos: 30, modalidad_vista: "legacy", precio_visto: 18000,
    })));
    assert.equal(res.status, 409);
    json = await res.json();
    assert.equal(json.codigo, "catalogo_actualizado");
    assert.deepEqual(inserts(), [], "0 reservas, 0 Finanzas");
    assert.equal(preferencias.length, antes, "0 preferencias");
    // Sin modalidad_vista (cliente anterior a B3) tampoco pasa después del corte.
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({ fecha: habil, hora: "12:00", duracion_minutos: 30 })));
    assert.equal(res.status, 409);
    // Precio visto distinto (precio especial nuevo): 409, nada creado.
    reiniciar();
    override("legacy");
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({
      fecha: habil, hora: "12:00", duracion_minutos: 15, modalidad_vista: "legacy", precio_visto: 10000,
    })));
    assert.equal(res.status, 409);
    assert.deepEqual(inserts(), []);
    assert.equal(preferencias.length, antes);

    // h) Ocupado → 409, sin reserva ni preferencia.
    const ocupada = { id: 400, fecha: habil, hora: "12:00", duracion_minutos: 15, simuladores: [FERRARI], estado: "activa", modalidad: "legacy", origen: null, created_at: new Date().toISOString() };
    reiniciar({ reservas: [ocupada], reserva_slots: filasSlotsReserva(ocupada).map((f, i) => ({ id: 1 + i, ...f })) });
    override("legacy");
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({
      fecha: habil, hora: "12:00", duracion_minutos: 15, modalidad_vista: "legacy", precio_visto: 12000,
    })));
    assert.equal(res.status, 409);
    assert.deepEqual(inserts(), []);
    assert.equal(preferencias.length, antes);

    // i) Seguridad intacta: origen ajeno → 403.
    reiniciar();
    res = await rutaPreferencia.POST(post("/api/mercadopago/preference", cuerpo({ fecha: habil, duracion_minutos: 15 }), "https://otro.example"));
    assert.equal(res.status, 403);
    res = await rutaReservas.POST(post("/api/reservas", cuerpo({ fecha: habil, duracion_minutos: 15 }), "https://otro.example"));
    assert.equal(res.status, 403);
    assert.deepEqual(inserts(), []);

    // j) Catálogo, disponibilidad y precio: dinámicos y sin caché en ningún nivel.
    for (const m of [rutaCatalogo, rutaDisponibilidad, rutaPrecio, rutaDispPublica]) {
      assert.equal(m.dynamic, "force-dynamic");
    }
    reiniciar();
    override("v2_10");
    res = await rutaCatalogo.GET(get("/api/reservas/catalogo"));
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal((await res.json()).modalidad, "v2_10");
    res = await rutaDisponibilidad.GET(get("/api/reservas/disponibilidad"));
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    json = await res.json();
    assert.equal(json.fecha, ventana[0]);
    assert.equal(json.duracion, 10);
    assert.ok(Array.isArray(json.horarios) && json.horarios.every((h: { libres: string[] }) => Array.isArray(h.libres)));
    assert.ok(!JSON.stringify(json).includes("Prueba B3"), "sin PII");
    res = await rutaDisponibilidad.GET(get(`/api/reservas/disponibilidad?fecha=${habil}&duracion=15`));
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).duraciones, [10, 20, 30]);
    res = await rutaDisponibilidad.GET(get(`/api/reservas/disponibilidad?fecha=${habil}&duracion=abc`));
    assert.equal(res.status, 400);
    res = await rutaPrecio.GET(get(`/api/reservas/precio?fecha=${habil}`));
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    override("legacy");
    res = await rutaDispPublica.GET(get(`/api/disponibilidad?fecha=${habil}&duracion=30`));
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    json = await res.json();
    assert.equal(json.modalidad, "legacy");
    assert.deepEqual(json.duraciones, [15, 30]);
    assert.ok(!json.horarios.some((h: { hora: string }) => h.hora === "21:40"), "30 min no entra a las 21:40");
  }

  // ── 11. La página /reservas no decide nada por su cuenta ──────────────────
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const pagina = leer("app/reservas/page.tsx");
    for (const prohibido of [
      "@/lib/reservasSlots", "horariosDe", "fechasPublicas", "getOccupiedSlots", "getNextSlot", "precioPorSimulador",
      "/api/reservas/precio", "/api/bloqueos", "/api/reservas?fecha", "12000", "12.000", "cada 20", "21:40",
      "[15, 30]", "15 | 30", ">20 min<",
    ]) {
      assert.ok(!pagina.includes(prohibido), `/reservas no define la oferta: aparece ${prohibido}`);
    }
    assert.match(pagina, /import \{ CATALOGO_ACTUALIZADO \} from "@\/lib\/catalogoComercial";/);
    assert.ok(pagina.includes("/api/reservas/disponibilidad") && pagina.includes("/api/reservas/catalogo"));
    assert.ok((pagina.match(/cache: "no-store"/g) ?? []).length >= 2, "catálogo y disponibilidad sin caché");
    assert.ok(pagina.includes("modalidad_vista:") && pagina.includes("precio_visto:"));
    for (const ruta of ["app/api/reservas/catalogo/route.ts", "app/api/reservas/disponibilidad/route.ts", "app/api/reservas/precio/route.ts"]) {
      const src = leer(ruta);
      assert.ok(!/max-age=[1-9]|s-maxage|stale-while-revalidate|revalidate\s*=|\bpublic\b,/.test(src), `${ruta}: sin caché`);
    }
  }

  console.log("OK — reservasComercial (B3): corte exacto, 409 de pestaña vieja, precios, cierres, capacidad, slots, webhook, reactivación y rutas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
