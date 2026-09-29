import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PENDIENTE_TTL_MIN, simuladoresLibresDelDia } from "@/lib/disponibilidad";
import { turnoBloqueado } from "@/lib/bloqueos";
import { getOccupiedSlots } from "@/lib/reservasSlots";
import {
  bloquesDeAgendaPara, esFinDeSemana, horariosPosiblesPara, sumarDias, type Producto,
} from "@/lib/agenda";
import { bloquesLegacy, horaDeMinutos, turnoPara, type ProductoAgenda } from "@/lib/agendaIntervalos";
import {
  RECURSOS_AGENDA, asignarRecursos, bloqueoTocaTurno, disponibilidadIntervalos, horariosConLibres,
  modalidadDeReserva, ocupacionesDelDia, recursosLibres,
  type FilaBloqueo, type FilaReserva, type FilaSlot,
} from "@/lib/disponibilidadIntervalos";
import { cargarFuentesAgenda, disponibilidadDesdeFuentes } from "@/lib/disponibilidadIntervalosServer";
import {
  ARCHIVO_SQL_SINTETICO, escenariosSinteticos, sqlMotorVsTrigger, veredictoMotor,
} from "@/lib/disponibilidadIntervalosTrigger";

// Disponibilidad por intervalos y recursos (Bloque B2).
// Ejecutar: npx tsx --env-file=.env.local lib/disponibilidadIntervalos.test.ts
//
// NO toca la base: supabaseAdmin se reemplaza por una base EN MEMORIA antes de
// cualquier consulta, y el motor ACTUAL (lib/disponibilidad.ts) corre de verdad
// contra ella para la prueba de equivalencia. Con datos reales, de solo
// lectura, está lib/disponibilidadIntervalos.integration.ts; contra el trigger,
// db/b2-motor-vs-trigger.sql (generado y verificado acá).

// ── Base en memoria ─────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = { reservas: [], reserva_slots: [], bloqueos_reservas: [] };
const consultas: string[] = [];

class ConsultaFalsa implements PromiseLike<{ data: Fila[]; error: null }> {
  private filtros: Array<(f: Fila) => boolean> = [];
  private orden: string | null = null;
  private rango: [number, number] | null = null;
  constructor(private readonly filas: Fila[]) {}
  select() { return this; }
  eq(col: string, v: unknown) { this.filtros.push((f) => f[col] === v); return this; }
  in(col: string, vs: unknown[]) { this.filtros.push((f) => vs.includes(f[col])); return this; }
  gte(col: string, v: string) { this.filtros.push((f) => String(f[col]) >= v); return this; }
  lte(col: string, v: string) { this.filtros.push((f) => String(f[col]) <= v); return this; }
  order(col: string) { this.orden = col; return this; }
  range(a: number, b: number) { this.rango = [a, b]; return this; }
  then<A = { data: Fila[]; error: null }, B = never>(
    ok?: ((v: { data: Fila[]; error: null }) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let out = this.filas.filter((f) => this.filtros.every((fn) => fn(f)));
    if (this.orden) {
      const c = this.orden;
      out = [...out].sort((x, y) => Number(x[c]) - Number(y[c]));
    }
    if (this.rango) out = out.slice(this.rango[0], this.rango[1] + 1);
    return Promise.resolve({ data: out.map((f) => ({ ...f })), error: null as null }).then(ok, ko);
  }
}

const cliente = supabaseAdmin as unknown as Record<string, unknown>;
const fromReal = cliente.from;
const rpcReal = cliente.rpc;
cliente.from = (tabla: string) => {
  consultas.push(tabla);
  if (!(tabla in TABLAS)) throw new Error(`tabla no simulada: ${tabla}`);
  return new ConsultaFalsa(TABLAS[tabla]);
};
cliente.rpc = () => { throw new Error("el test no llama RPC"); };

// ── Ayudas ──────────────────────────────────────────────────────────────────
const AHORA = new Date();
const haceMin = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
function primerDia(desde: string, cumple: (f: string) => boolean): string {
  let f = desde;
  while (!cumple(f)) f = sumarDias(f, 1);
  return f;
}
const dow = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();
const LUNES = primerDia("2099-03-01", (f) => dow(f) === 1);
const SABADO = primerDia(LUNES, (f) => dow(f) === 6);
const [FERRARI, MCLAREN, REDBULL, ALPINE] = RECURSOS_AGENDA;

let proximoId = 1;
const slot = (hora: string, simulador: string, ocupacion_min: number | null = null,
  extra: Partial<FilaSlot> = {}): FilaSlot =>
  ({ reserva_id: 900, fecha: LUNES, hora, simulador, estado: "activa", ocupacion_min, ...extra });
const reserva = (extra: Partial<FilaReserva>): FilaReserva => ({
  id: proximoId++, fecha: LUNES, hora: "12:00", duracion_minutos: 30, simuladores: [FERRARI],
  estado: "activa", created_at: haceMin(60), modalidad: null, origen: "web", ...extra,
});

function disp(modalidad: "legacy" | "v2_10", duracion: number, datos: {
  reservas?: FilaReserva[]; slots?: FilaSlot[]; bloqueos?: FilaBloqueo[];
  producto?: ProductoAgenda; fecha?: string;
} = {}) {
  const fecha = datos.fecha ?? LUNES;
  const { ocupaciones } = ocupacionesDelDia({
    fecha, reservas: datos.reservas ?? [], slots: datos.slots ?? [], ahora: AHORA, pendienteTtlMin: PENDIENTE_TTL_MIN,
  });
  return disponibilidadIntervalos({
    modalidad, producto: datos.producto ?? "reserva", fecha, duracion, ocupaciones, bloqueos: datos.bloqueos ?? [], ahora: AHORA,
  });
}
const libres = (d: ReturnType<typeof disp>, hora: string) => {
  const h = d.horarios.find((x) => x.hora === hora);
  assert.ok(h, `${hora} tiene que ser un inicio válido`);
  return h.libres;
};
const bloqueo = (extra: Partial<FilaBloqueo>): FilaBloqueo => ({
  fecha: LUNES, todo_el_dia: false, hora_inicio: null, hora_fin: null, simulador: null, activo: true, ...extra,
});

async function main() {
  // ── Capacidad con 4 recursos ──────────────────────────────────────────────
  {
    assert.deepEqual(libres(disp("v2_10", 30), "12:00"), [FERRARI, MCLAREN, REDBULL, ALPINE], "0 ocupados → 4");
    const uno = [slot("12:00", FERRARI), slot("12:20", FERRARI)];
    assert.equal(libres(disp("v2_10", 30, { slots: uno }), "12:00").length, 3, "1 ocupado todo el intervalo → 3");
    const dos = [...uno, slot("12:00", MCLAREN, 40)];
    assert.equal(libres(disp("v2_10", 30, { slots: dos }), "12:00").length, 2, "2 → 2");
    const cuatro = [...dos, slot("12:00", REDBULL, 40), slot("12:00", ALPINE, 40)];
    const lleno = disp("v2_10", 30, { slots: cuatro });
    assert.equal(libres(lleno, "12:00").length, 0, "4 → 0");
    assert.ok(!horariosConLibres(lleno).some((h) => h.hora === "12:00"), "sin recursos no se ofrece");
    // Tocar una parte del intervalo alcanza para descartar el recurso.
    assert.deepEqual(libres(disp("v2_10", 30, { slots: [slot("12:20", FERRARI)] }), "12:00"), [MCLAREN, REDBULL, ALPINE]);

    // Fragmentación: A 12:00–12:30, B 12:30–13:00. Un 12:10–12:50 no entra ni
    // en A ni en B, aunque nunca haya más de uno ocupado a la vez.
    const frag = disp("v2_10", 30, { slots: [slot("12:00", FERRARI, 30), slot("12:30", MCLAREN, 30)] });
    const h1210 = frag.horarios.find((h) => h.hora === "12:10")!;
    assert.deepEqual(h1210.libres, [REDBULL, ALPINE], "fragmentación: no se promete capacidad inexistente");
    assert.equal(asignarRecursos(h1210, 3), null, "no hay 3");
    assert.deepEqual(asignarRecursos(h1210, 2), [REDBULL, ALPINE], "asignación concreta, recurso por recurso");
    assert.equal(recursosLibres(h1210, [FERRARI]), false);
    assert.equal(recursosLibres(h1210, [REDBULL, ALPINE]), true);
    assert.equal(recursosLibres(h1210, [REDBULL, REDBULL]), false, "sin repetir");
    assert.equal(asignarRecursos(h1210, 0), null);
  }

  // ── H, I, J, K con recursos ───────────────────────────────────────────────
  {
    const a = [slot("12:00", FERRARI, 30)];   // Ferrari 12:00–12:30
    assert.ok(libres(disp("v2_10", 20, { slots: a }), "12:30").includes(FERRARI), "H · contigua: 12:30 empieza donde terminó");
    assert.ok(!libres(disp("v2_10", 10, { slots: [slot("12:00", FERRARI, 35)] }), "12:30").includes(FERRARI),
      "I · cinco minutos de solapamiento alcanzan");
    const j = libres(disp("v2_10", 20, { slots: a }), "12:00");
    assert.ok(!j.includes(FERRARI) && j.includes(MCLAREN), "J · el mismo intervalo en otro recurso está permitido");
    assert.ok(!libres(disp("legacy", 15, { slots: [slot("12:00", FERRARI)] }), "12:00").includes(FERRARI),
      "K · misma fecha, hora y recurso: conflicto");
  }

  // ── Legacy + v2, en los dos sentidos ──────────────────────────────────────
  {
    const legacy30 = [slot("12:00", FERRARI), slot("12:20", FERRARI)];   // legacy 30: 12:00–12:40
    assert.ok(!libres(disp("v2_10", 10, { slots: legacy30 }), "12:30").includes(FERRARI), "caso 1: v2 12:30–12:50 choca");
    assert.ok(libres(disp("v2_10", 10, { slots: legacy30 }), "12:40").includes(FERRARI), "caso 2: v2 desde 12:40, libre");
    const v2de20 = [slot("12:00", FERRARI, 30)];                        // v2 20: 12:00–12:30
    assert.ok(!libres(disp("legacy", 15, { slots: v2de20 }), "12:20").includes(FERRARI), "caso 3: legacy 12:20–12:40 choca");
    assert.ok(libres(disp("legacy", 15, { slots: v2de20 }), "12:40").includes(FERRARI));
    assert.ok(!libres(disp("legacy", 30, { slots: v2de20 }), "11:40").includes(FERRARI), "legacy 11:40–12:20 también choca");
  }

  // ── Fuentes: slots, reservas sin slots, pendientes y modalidad persistida ─
  {
    // Slots: la verdad de la base. Legacy = bloque de 20; v2 = su ocupación.
    const { ocupaciones, resumen } = ocupacionesDelDia({
      fecha: LUNES, ahora: AHORA, pendienteTtlMin: PENDIENTE_TTL_MIN,
      reservas: [reserva({ id: 900, duracion_minutos: 30 })],
      slots: [
        slot("12:00", FERRARI),                          // legacy
        slot("15:00", MCLAREN, 40),                      // v2
        slot("16:00", REDBULL, null, { estado: "cancelada" }),
        slot("16:00", ALPINE, null, { estado: "reprogramada" }),
        slot("9:00", ALPINE),                            // hora ilegible
        slot("17:00", ALPINE, null, { fecha: SABADO }),  // otro día
      ],
    });
    assert.deepEqual(ocupaciones.map((o) => [o.recurso, horaDeMinutos(o.intervalo.desde), horaDeMinutos(o.intervalo.hasta), o.modalidad, o.fuente]), [
      [FERRARI, "12:00", "12:20", "legacy", "slot"],
      [MCLAREN, "15:00", "15:40", "v2_10", "slot"],
    ]);
    assert.equal(resumen.slotsActivos, 2);
    assert.equal(resumen.descartadas, 1);
    assert.equal(resumen.reservasConSlots, 1, "la reserva 900 se toma por sus slots, no por sus datos");

    // Reserva activa sin slots: sus bloques por SU modalidad.
    const sinSlots = reserva({ hora: "12:00", duracion_minutos: 30 });
    assert.ok(!libres(disp("v2_10", 10, { reservas: [sinSlots] }), "12:30").includes(FERRARI), "legacy sin slots: 12:00–12:40");
    // Modalidad PERSISTIDA, no la pedida: una reserva de 20 guardada como v2
    // ocupa 30; la misma sin modalidad (legacy) solo el primer bloque de 20.
    const v2guardada = reserva({ hora: "12:00", duracion_minutos: 20, modalidad: "v2_10" });
    const nula = reserva({ hora: "12:00", duracion_minutos: 20, modalidad: null });
    assert.ok(!libres(disp("v2_10", 10, { reservas: [v2guardada] }), "12:20").includes(FERRARI), "v2 guardada: 12:00–12:30");
    assert.ok(libres(disp("v2_10", 10, { reservas: [nula] }), "12:20").includes(FERRARI), "NULL = legacy, aunque se pida v2");
    assert.equal(modalidadDeReserva(null), "legacy");
    assert.equal(modalidadDeReserva("legacy"), "legacy");
    assert.equal(modalidadDeReserva("v2_10"), "v2_10");

    // Pendientes: retienen mientras no vence el TTL, sin slots.
    const vigente = reserva({ estado: "pendiente_pago", created_at: haceMin(5), hora: "12:00", duracion_minutos: 30 });
    const vencida = reserva({ estado: "pendiente_pago", created_at: haceMin(PENDIENTE_TTL_MIN + 5), hora: "12:00", duracion_minutos: 30 });
    const sinFecha = reserva({ estado: "pendiente_pago", created_at: null, hora: "12:00", duracion_minutos: 30 });
    assert.ok(!libres(disp("legacy", 15, { reservas: [vigente] }), "12:20").includes(FERRARI), "pendiente vigente retiene");
    assert.ok(libres(disp("legacy", 15, { reservas: [vencida] }), "12:20").includes(FERRARI), "pendiente vencida no retiene");
    assert.ok(libres(disp("legacy", 15, { reservas: [sinFecha] }), "12:20").includes(FERRARI), "pendiente sin fecha no retiene");
    const pendienteV2 = reserva({ estado: "pendiente_pago", created_at: haceMin(5), hora: "12:00", duracion_minutos: 20, modalidad: "v2_10" });
    assert.ok(!libres(disp("v2_10", 10, { reservas: [pendienteV2] }), "12:20").includes(FERRARI), "pendiente v2: duración + 10");
    assert.ok(libres(disp("v2_10", 10, { reservas: [pendienteV2] }), "12:30").includes(FERRARI));
    const sinSims = reserva({ estado: "pendiente_pago", created_at: haceMin(5), simuladores: null });
    assert.equal(ocupacionesDelDia({ fecha: LUNES, reservas: [sinSims], slots: [], ahora: AHORA, pendienteTtlMin: PENDIENTE_TTL_MIN }).ocupaciones.length, 0);
    // Canceladas: nada.
    assert.equal(ocupacionesDelDia({ fecha: LUNES, reservas: [reserva({ estado: "cancelada" })], slots: [], ahora: AHORA, pendienteTtlMin: PENDIENTE_TTL_MIN }).ocupaciones.length, 0);
  }

  // ── Bloqueos ──────────────────────────────────────────────────────────────
  {
    const b1220 = [bloqueo({ hora_inicio: "12:20", hora_fin: "12:40", simulador: FERRARI })];
    assert.ok(!libres(disp("v2_10", 20, { bloqueos: b1220 }), "12:00").includes(FERRARI), "v2 12:00–12:30 contra bloqueo 12:20–12:40: conflicto");
    assert.ok(libres(disp("v2_10", 10, { bloqueos: b1220 }), "12:00").includes(FERRARI), "v2 que termina justo donde empieza el bloqueo: libre");
    assert.ok(!libres(disp("v2_10", 10, { bloqueos: b1220 }), "12:40").includes(FERRARI), "v2 que EMPIEZA en hora_fin: bloqueado (como el trigger)");
    assert.ok(libres(disp("v2_10", 10, { bloqueos: b1220 }), "12:50").includes(FERRARI));
    assert.ok(libres(disp("v2_10", 20, { bloqueos: b1220 }), "12:00").includes(MCLAREN), "bloqueo de un simulador: los otros no");
    const todoElDia = [bloqueo({ todo_el_dia: true, simulador: ALPINE })];
    assert.ok(disp("v2_10", 10, { bloqueos: todoElDia }).horarios.every((h) => !h.libres.includes(ALPINE)), "todo el día");
    const general = [bloqueo({ hora_inicio: "15:00", hora_fin: "15:30" })];
    assert.deepEqual(libres(disp("v2_10", 10, { bloqueos: general }), "15:10"), [], "sin simulador: todos");
    assert.equal(libres(disp("v2_10", 10, { bloqueos: [bloqueo({ ...general[0], activo: false })] }), "15:10").length, 4, "inactivo no bloquea");
    // Vencido: su fin ya pasó.
    const pasado = "2000-01-03";
    const vencido = [bloqueo({ fecha: pasado, todo_el_dia: true })];
    assert.equal(libres(disp("v2_10", 10, { bloqueos: vencido, fecha: pasado }), "12:00").length, 4, "vencido no bloquea");
    // v2: el buffer también cuenta, aunque pase las 22:00.
    const noche = [bloqueo({ hora_inicio: "22:00", hora_fin: "23:00" })];
    assert.deepEqual(libres(disp("v2_10", 10, { bloqueos: noche }), "21:50"), [], "21:50–22:10 toca un bloqueo desde las 22:00");
    // Un límite ilegible no bloquea en v2 (como el trigger).
    assert.equal(libres(disp("v2_10", 10, { bloqueos: [bloqueo({ hora_inicio: "12:00", hora_fin: "9:00" })] }), "12:00").length, 4);

    // Legacy: EXACTAMENTE turnoBloqueado de lib/bloqueos.ts, en una matriz de
    // límites de grilla y fuera de grilla, con y sin simulador.
    const horas = [null, "11:50", "12:00", "12:10", "12:20", "12:30", "12:40", "13:00", "13:50", "14:00", "14:20", "15:00"];
    const casos: Array<[ProductoAgenda, Producto, string, number, string]> = [];
    for (const hora of ["11:20", "11:40", "12:00", "12:20", "12:40", "13:00"]) {
      for (const d of [15, 30]) casos.push(["reserva", "reserva", LUNES, d, hora]);
    }
    for (const hora of ["13:20", "13:40", "14:00"]) {
      for (const d of [15, 30, 45, 60]) casos.push(["mensualidad", "mensualidad", SABADO, d, hora]);
    }
    let comparados = 0;
    for (const [producto, deAgenda, fecha, d, hora] of casos) {
      const turno = turnoPara({ modalidad: "legacy", producto, fecha, hora, duracion: d });
      if (!turno) continue;
      const bloques = bloquesDeAgendaPara(deAgenda, fecha, hora, d)!;
      for (const ini of horas) for (const fin of horas) for (const sim of [null, FERRARI, MCLAREN]) for (const todo of [false, true]) {
        const b = bloqueo({ fecha, hora_inicio: ini, hora_fin: fin, simulador: sim, todo_el_dia: todo });
        assert.equal(bloqueoTocaTurno(b, turno, FERRARI), turnoBloqueado([b], bloques, [FERRARI]),
          `legacy ${producto} ${d} ${hora} vs [${ini}, ${fin}] ${sim} ${todo}`);
        comparados++;
      }
    }
    assert.ok(comparados > 10_000, `${comparados} combinaciones legacy de bloqueo comparadas`);
  }

  // ── EQUIVALENCIA LEGACY: motor actual vs motor nuevo ──────────────────────
  // Datos realistas generados como los crean los flujos: web y Empresas con
  // getOccupiedSlots, Mensualidades con bloquesDeAgendaPara (corridos el fin de
  // semana), pendientes vigentes y vencidas, canceladas, bloqueos de todo tipo.
  // El motor ACTUAL corre de verdad contra la base en memoria.
  {
    const HOY = "2099-05-10";
    const VENTANA = Array.from({ length: 15 }, (_, i) => sumarDias(HOY, i + 1));
    const PASADO = "2020-01-06", HOY_PASADO = "2020-01-05";
    let semilla = 20260929;
    const rnd = () => {
      semilla = (semilla + 0x6d2b79f5) | 0;
      let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const elegir = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

    const reservas: FilaReserva[] = [];
    const slots: Array<FilaSlot & { id: number }> = [];
    const bloqueos: Array<FilaBloqueo & { id: number }> = [];
    /** Bloques que tiene cada Mensualidad corrida y el motor actual no ve (slots − getOccupiedSlots). */
    const ocultos: Array<{ fecha: string; sim: string; bloque: string }> = [];
    let idSlot = 1, idBloqueo = 1;

    const generar = (fecha: string, forzarCorridas: boolean) => {
      const tomados = new Set<string>();
      const libre = (bloques: string[], sims: string[]) => sims.every((s) => bloques.every((b) => !tomados.has(`${b}|${s}`)));
      const tomar = (bloques: string[], sims: string[]) => sims.forEach((s) => bloques.forEach((b) => tomados.add(`${b}|${s}`)));
      const agregar = (tipo: "web" | "mensualidad" | "empresa", estado: string, hora: string, d: number, sims: string[], conSlots = true) => {
        const id = proximoId++;
        const deAgenda: Producto = tipo === "mensualidad" ? "mensualidad" : "reserva";
        const bloquesSlot = tipo === "mensualidad" ? bloquesDeAgendaPara(deAgenda, fecha, hora, d)! : getOccupiedSlots(fecha, hora, d);
        const pendiente = estado === "vigente" || estado === "vencida";
        reservas.push({
          id, fecha, hora, duracion_minutos: d, simuladores: sims, origen: tipo, modalidad: null,
          estado: pendiente ? "pendiente_pago" : estado,
          created_at: estado === "vigente" ? haceMin(5) : haceMin(90),
        });
        if (pendiente) return;
        if (conSlots) {
          for (const s of sims) for (const b of bloquesSlot) {
            slots.push({ id: idSlot++, reserva_id: id, fecha, hora: b, simulador: s, estado: estado === "activa" ? "activa" : "cancelada", ocupacion_min: null });
          }
        }
        if (estado === "activa" && tipo === "mensualidad") {
          const vistos = new Set(getOccupiedSlots(fecha, hora, d));
          for (const s of sims) for (const b of bloquesSlot) if (!vistos.has(b)) ocultos.push({ fecha, sim: s, bloque: b });
        }
      };
      const intentar = (tipo: "web" | "mensualidad" | "empresa", estado: string, hora: string, d: number, sims: string[], conSlots = true) => {
        const deAgenda: Producto = tipo === "mensualidad" ? "mensualidad" : "reserva";
        const bloques = tipo === "mensualidad" ? bloquesDeAgendaPara(deAgenda, fecha, hora, d) : getOccupiedSlots(fecha, hora, d);
        if (!bloques) return false;
        const retiene = estado === "activa" || estado === "vigente";
        if (retiene && !libre(bloques, sims)) return false;
        agregar(tipo, estado, hora, d, sims, conSlots);
        if (retiene) tomar(bloques, sims);
        return true;
      };

      if (forzarCorridas) {
        // Mensualidades de fin de semana que terminan después de las 14:00.
        intentar("mensualidad", "activa", "13:40", 60, [ALPINE]);
        intentar("mensualidad", "activa", "14:00", 30, [MCLAREN]);
        intentar("mensualidad", "activa", "13:20", 60, [REDBULL]);
      }
      const n = 8 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) {
        const tipo = elegir(["web", "web", "web", "mensualidad", "empresa"] as const);
        const estado = elegir(["activa", "activa", "activa", "activa", "vigente", "vencida", "cancelada"]);
        const t = estado === "vigente" || estado === "vencida" ? "web" : tipo;   // las pendientes son web
        const deAgenda: Producto = t === "mensualidad" ? "mensualidad" : "reserva";
        const d = elegir(t === "mensualidad" ? [15, 30, 45, 60] : [15, 30]);
        const horas = horariosPosiblesPara(deAgenda, fecha, d);
        if (!horas.length) continue;
        const cant = 1 + Math.floor(rnd() * 3);
        const sims = [...RECURSOS_AGENDA].sort(() => rnd() - 0.5).slice(0, cant);
        intentar(t, estado, elegir(horas), d, sims, !(estado === "activa" && rnd() < 0.08));
      }
      // Bloqueos.
      const plantillas: Array<Partial<FilaBloqueo>> = [
        { todo_el_dia: true, simulador: elegir(RECURSOS_AGENDA) },
        { hora_inicio: "12:00", hora_fin: "13:00", simulador: null },
        { hora_inicio: "12:10", hora_fin: "12:50", simulador: elegir(RECURSOS_AGENDA) },
        { hora_inicio: "18:20", hora_fin: "19:00", simulador: elegir(RECURSOS_AGENDA) },
        { hora_inicio: "13:30", hora_fin: "14:00", simulador: null },
        { hora_inicio: "10:00", hora_fin: "11:00", simulador: null, activo: false },
        { hora_inicio: "21:30", hora_fin: "21:59", simulador: elegir(RECURSOS_AGENDA) },
      ];
      const nb = Math.floor(rnd() * 3);
      for (let i = 0; i < nb; i++) {
        bloqueos.push({ id: idBloqueo++, fecha, todo_el_dia: false, hora_inicio: null, hora_fin: null, simulador: null, activo: true, ...elegir(plantillas) });
      }
    };

    let corridas = 0;
    for (const fecha of VENTANA) {
      const finde = esFinDeSemana(fecha);
      generar(fecha, finde && corridas++ < 2);
    }
    generar(PASADO, false);
    bloqueos.push({ id: idBloqueo++, fecha: PASADO, todo_el_dia: true, hora_inicio: null, hora_fin: null, simulador: null, activo: true });

    TABLAS.reservas = reservas;
    TABLAS.reserva_slots = slots;
    TABLAS.bloqueos_reservas = bloqueos;

    // El motor nuevo por el cargador de servidor: el rango entero, una vez.
    consultas.length = 0;
    const fuentes = await cargarFuentesAgenda(PASADO, VENTANA[VENTANA.length - 1]);
    assert.equal(fuentes.consultas, 3, "tres consultas para todo el rango");
    assert.deepEqual([...consultas].sort(), ["bloqueos_reservas", "reserva_slots", "reservas"]);

    const PRODUCTOS: Array<[ProductoAgenda, Producto, number[]]> = [
      ["reserva", "reserva", [15, 30]],
      ["mensualidad", "mensualidad", [15, 30, 45, 60]],
      ["gift_card", "reserva", [15, 30]],
    ];
    type Dif = { fecha: string; producto: string; d: number; hora: string; sim: string; actual: boolean; nuevo: boolean };
    const difs: Dif[] = [];
    let comparaciones = 0, consultasMotorActual = 0;
    for (const fecha of [...VENTANA, PASADO]) {
      const hoy = fecha === PASADO ? HOY_PASADO : HOY;
      for (const [producto, deAgenda, durs] of PRODUCTOS) {
        for (const d of durs) {
          consultas.length = 0;
          const actual = await simuladoresLibresDelDia({ fecha, duracion: d, producto: deAgenda, hoy });
          consultasMotorActual += consultas.length;
          assert.ok(actual.ok, `motor actual ${fecha} ${producto} ${d}`);
          const mapaActual = new Map(actual.horarios.map((h) => [h.hora, h.simuladores]));
          const nuevo = disponibilidadDesdeFuentes(fuentes, { modalidad: "legacy", producto, fecha, duracion: d, ahora: new Date() });
          const mapaNuevo = new Map(horariosConLibres(nuevo.disponibilidad).map((h) => [h.hora, h.libres]));
          const horas = new Set([...mapaActual.keys(), ...mapaNuevo.keys()]);
          for (const hora of horas) {
            for (const sim of RECURSOS_AGENDA) {
              comparaciones++;
              const a = mapaActual.get(hora)?.includes(sim) ?? false;
              const n = mapaNuevo.get(hora)?.includes(sim) ?? false;
              if (a !== n) difs.push({ fecha, producto, d, hora, sim, actual: a, nuevo: n });
            }
          }
        }
      }
    }

    // Toda diferencia tiene que ser la ÚNICA clase conocida (D1): una
    // Mensualidad de fin de semana cuyos bloques corridos pasan las 14:00. El
    // motor actual la lee de `reservas` con getOccupiedSlots y solo ve su
    // primer bloque; el nuevo lee sus slots —lo mismo que controla la base— y
    // ve la ocupación completa. Nunca al revés: el nuevo jamás libera algo que
    // el actual ocupa.
    for (const x of difs) {
      assert.ok(x.actual && !x.nuevo, `diferencia en sentido inesperado: ${JSON.stringify(x)}`);
      const turno = turnoPara({ modalidad: "legacy", producto: x.producto as ProductoAgenda, fecha: x.fecha, hora: x.hora, duracion: x.d })!;
      const tapa = bloquesLegacy(turno).some((b) => ocultos.some((o) => o.fecha === x.fecha && o.sim === x.sim && o.bloque === b));
      assert.ok(tapa, `diferencia sin explicar (no es D1): ${JSON.stringify(x)}`);
      assert.ok(esFinDeSemana(x.fecha));
    }
    assert.ok(ocultos.length > 0 && difs.length > 0, "la clase D1 quedó ejercitada");
    const clave = (x: Dif) => `${x.fecha} ${x.producto} ${x.d} ${x.hora} ${x.sim}`;
    console.log(`equivalencia legacy: ${comparaciones} comparaciones (fecha × producto × duración × inicio × simulador), ` +
      `${difs.length} diferencias, todas D1: ${[...new Set(difs.map(clave))].slice(0, 6).join(" | ")}${difs.length > 6 ? " | …" : ""}`);
    console.log(`consultas: motor actual ${consultasMotorActual} (2 por día y duración) · motor nuevo ${fuentes.consultas} para todo el rango`);

    // El núcleo puro y el cargador dan lo mismo.
    const f0 = VENTANA.find((f) => esFinDeSemana(f))!;
    const puro = disponibilidadIntervalos({
      modalidad: "legacy", producto: "mensualidad", fecha: f0, duracion: 60, ahora: new Date(), bloqueos,
      ocupaciones: ocupacionesDelDia({ fecha: f0, reservas, slots, ahora: new Date(), pendienteTtlMin: PENDIENTE_TTL_MIN }).ocupaciones,
    });
    assert.deepEqual(puro, disponibilidadDesdeFuentes(fuentes, { modalidad: "legacy", producto: "mensualidad", fecha: f0, duracion: 60, ahora: new Date() }).disponibilidad);
  }

  // ── Cargador: paginación de PostgREST (1.000 filas) ───────────────────────
  {
    const muchos: Array<FilaSlot & { id: number }> = [];
    for (let i = 0; i < 2500; i++) {
      muchos.push({ id: i + 1, reserva_id: 1, fecha: "2099-06-01", hora: "12:00", simulador: FERRARI, estado: "activa", ocupacion_min: null });
    }
    TABLAS.reserva_slots = muchos;
    TABLAS.reservas = [];
    TABLAS.bloqueos_reservas = [];
    const f = await cargarFuentesAgenda("2099-06-01", "2099-06-01");
    assert.equal(f.slots.length, 2500, "trae todas las páginas");
    assert.equal(f.consultas, 5, "3 consultas + 2 páginas extra de slots");
    await assert.rejects(cargarFuentesAgenda("2099-06-02", "2099-06-01"), /Rango/);
    await assert.rejects(cargarFuentesAgenda("2099-02-30", "2099-03-01"), /Rango/);
  }

  // ── Motor vs trigger: el SQL versionado es el que genera el motor ─────────
  {
    const escenarios = escenariosSinteticos();
    const sql = sqlMotorVsTrigger(escenarios, { titulo: "B2 · motor vs trigger B1 (matriz sintética)", ahora: new Date() });
    if (process.env.B2_REGENERAR_SQL === "1") writeFileSync(join(process.cwd(), ARCHIVO_SQL_SINTETICO), sql);
    const versionado = readFileSync(join(process.cwd(), ARCHIVO_SQL_SINTETICO), "utf8").replace(/\r\n/g, "\n");
    assert.equal(versionado, sql, `${ARCHIVO_SQL_SINTETICO} no coincide con lo que calcula el motor: regenerar con B2_REGENERAR_SQL=1`);

    // Los casos pedidos, con el veredicto del motor.
    const ver = (codigo: string, recurso: string, modalidad: "legacy" | "v2_10", hora: string, d: number) => {
      const e = escenarios.find((x) => x.codigo === codigo)!;
      const c = e.candidatos.find((x) => x.recurso === recurso && x.turno.modalidad === modalidad && x.turno.hora === hora && x.turno.duracion === d);
      assert.ok(c, `falta el candidato ${codigo} ${recurso} ${modalidad} ${hora} ${d}`);
      return veredictoMotor(e, c, new Date());
    };
    assert.equal(ver("S1", FERRARI, "v2_10", "12:30", 10), "23505", "caso 1: legacy 12:00–12:40 vs v2 12:30");
    assert.equal(ver("S1", FERRARI, "v2_10", "12:40", 10), "ok", "caso 2: v2 desde 12:40");
    assert.equal(ver("S1", MCLAREN, "legacy", "12:20", 15), "23505", "caso 3: v2 12:00–12:30 vs legacy 12:20");
    assert.equal(ver("S1", MCLAREN, "v2_10", "12:30", 20), "ok", "contigua");
    assert.equal(ver("S1", FERRARI, "v2_10", "21:40", 10), "23505", "choca con el buffer de 21:50–22:10");
    assert.equal(ver("S2", FERRARI, "v2_10", "12:00", 20), "23514", "v2 12:00–12:30 vs bloqueo 12:20–12:40");
    assert.equal(ver("S2", FERRARI, "v2_10", "12:00", 10), "ok", "termina donde empieza el bloqueo");
    assert.equal(ver("S2", FERRARI, "legacy", "12:40", 15), "23514", "legacy en hora_fin (inclusiva)");
    assert.equal(ver("S2", REDBULL, "v2_10", "12:00", 30), "ok", "bloqueo inactivo");
    assert.equal(ver("S3", ALPINE, "legacy", "14:00", 15), "23505", "D1: la Mensualidad 13:40 de 60 ocupa 14:00");
    assert.equal(ver("S3", MCLAREN, "v2_10", "13:40", 10), "ok", "desde 13:40 vuelve a estar libre");
    assert.equal(ver("S3", MCLAREN, "v2_10", "12:50", 10), "23505", "12:50–13:10 toca 13:00–13:40");
    assert.equal(ver("S4", FERRARI, "v2_10", "12:30", 10), "ok", "bloqueo vencido + contigua");
    const total = escenarios.reduce((s, e) => s + e.candidatos.length, 0);
    console.log(`motor vs trigger: ${total} casos en ${ARCHIVO_SQL_SINTETICO} (se corre con execute_sql y debe dar B2_MOTOR_VS_TRIGGER_OK)`);
  }

  // ── Guardas: B2 no conecta ningún flujo comercial ─────────────────────────
  {
    const ROOT = process.cwd();
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (/\.(ts|tsx)$/.test(e)) archivos.push(relative(ROOT, p).split(sep).join("/"));
      }
    };
    for (const c of ["app", "lib", "components"]) if (existsSync(join(ROOT, c))) recorrer(join(ROOT, c));
    const leer = (f: string) => readFileSync(join(ROOT, f), "utf8");
    const MODULOS = /["']@\/lib\/(agendaIntervalos|disponibilidadIntervalos|disponibilidadIntervalosServer|disponibilidadIntervalosTrigger)["']/;
    const PERMITIDOS = new Set([
      "lib/agendaIntervalos.ts", "lib/disponibilidadIntervalos.ts", "lib/disponibilidadIntervalosServer.ts",
      "lib/disponibilidadIntervalosTrigger.ts",
      "app/api/admin/modalidad-comercial/disponibilidad-diagnostico/route.ts",
      "lib/agendaIntervalos.test.ts", "lib/disponibilidadIntervalos.test.ts", "lib/disponibilidadIntervalos.integration.ts",
    ]);
    const ajenos = archivos.filter((f) => MODULOS.test(leer(f)) && !PERMITIDOS.has(f));
    assert.deepEqual(ajenos, [], `B2 no se conecta a flujos comerciales; lo importan: ${ajenos.join(", ")}`);
    for (const f of archivos) {
      if (/^\s*["']use client["']/m.test(leer(f))) assert.ok(!MODULOS.test(leer(f)), `${f} es "use client": el navegador no calcula disponibilidad`);
    }
    // /reservas y los flujos que venden siguen con el motor actual.
    for (const f of ["app/api/disponibilidad/route.ts", "app/api/reservas/route.ts", "app/api/mercadopago/preference/route.ts",
      "app/api/mensualidades/disponibilidad/route.ts", "lib/mensualidadesReserva.ts", "lib/mensualidadesGestionReserva.ts"]) {
      assert.ok(leer(f).includes("@/lib/disponibilidad\""), `${f} sigue usando lib/disponibilidad.ts`);
    }

    // El diagnóstico: solo GET, solo admin, sin caché, sin escrituras, sin PII,
    // y la modalidad es un parámetro (no importa el resolver por reloj).
    const ruta = "app/api/admin/modalidad-comercial/disponibilidad-diagnostico/route.ts";
    const src = leer(ruta);
    assert.deepEqual([...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]), ["GET"]);
    assert.ok(/requireAdmin\(\)/.test(src) && !/requireStaffOrAdmin/.test(src), "solo admin");
    assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src));
    assert.ok(/force-dynamic/.test(src) && /no-store/.test(src), "sin caché");
    assert.ok(!src.includes("@/lib/modalidadComercial\""), "no decide la modalidad por el reloj");
    for (const f of [ruta, "lib/disponibilidadIntervalosServer.ts", "lib/disponibilidadIntervalos.ts"]) {
      for (const escritura of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
        assert.ok(!leer(f).includes(escritura), `${f}: solo lectura, no usa ${escritura}`);
      }
    }
    const cargador = leer("lib/disponibilidadIntervalosServer.ts");
    for (const pii of ["nombre", "telefono", "email", "apellido"]) {
      assert.ok(!new RegExp(`select\\([^)]*\\b${pii}\\b`).test(cargador), `el cargador no lee ${pii}`);
    }
  }

  cliente.from = fromReal;
  cliente.rpc = rpcReal;
  console.log("OK — disponibilidadIntervalos: capacidad por recurso, fuentes, bloqueos, equivalencia legacy (salvo D1, explicada), cargador y motor vs trigger.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
