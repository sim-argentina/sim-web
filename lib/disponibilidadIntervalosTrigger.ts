// ============================================================================
// Contraste MOTOR vs TRIGGER B1 (Bloque B2). Lo usan solo los tests.
// ----------------------------------------------------------------------------
// Arma un bloque SQL que se REVIERTE entero. Inserta una base de ocupación
// (slots legacy y v2) y bloqueos con ids negativos, y prueba cada turno
// candidato en una subtransacción que también se revierte. Lo ESPERADO de cada
// caso lo calcula el motor nuevo (estadoRecurso); lo OBTENIDO, el trigger
// reserva_slot_bloqueo y el índice único de la base. Termina SIEMPRE con
// RAISE EXCEPTION:
//   'B2_MOTOR_VS_TRIGGER_OK <n> casos (…)'  o  'B2_FALLA <k> de <n> casos: …'
//
// Veredictos: 'ok' (libre), '23505' (ocupado), '23514' (bloqueado) y 'rechazo'
// (ocupado Y bloqueado: vale cualquiera de los dos, porque en un turno legacy
// de varias filas decide cuál falla primero).
//
// Las pendientes de pago no entran: todavía no tienen slots, así que el trigger
// no las ve por diseño. Retienen el turno en el motor, no en la base.
// ============================================================================

import type { Modalidad } from "@/lib/catalogoComercial";
import { esFinDeSemana, sumarDias } from "@/lib/agenda";
import {
  bloquesLegacy, iniciosDelDia, minutosDeHora, turnoOcupacion,
  type ProductoAgenda, type TurnoIntervalo,
} from "@/lib/agendaIntervalos";
import {
  RECURSOS_AGENDA, bloqueosAplicables, estadoRecurso, ocupacionesDelDia,
  type FilaBloqueo, type FilaSlot,
} from "@/lib/disponibilidadIntervalos";

/** Dónde vive el contraste sintético versionado. */
export const ARCHIVO_SQL_SINTETICO = "db/b2-motor-vs-trigger.sql";

export type Veredicto = "ok" | "23505" | "23514" | "rechazo";
export type OcupacionBase = { recurso: string; turno: TurnoIntervalo };
export type BloqueoFixture = FilaBloqueo & { id: number };
export type Candidato = { recurso: string; turno: TurnoIntervalo };

export type Escenario = {
  codigo: string;
  fecha: string;
  /** Reserva contenedora (id negativo) de la base y de los candidatos. */
  reservaId: number;
  /** Ocupación que se INSERTA como fixture (y se revierte). */
  base: OcupacionBase[];
  /** Bloqueos que se INSERTAN como fixture, después de la base. */
  bloqueos: BloqueoFixture[];
  /** Lo que YA está en la base: el motor lo ve, el SQL no lo inserta. */
  existentes?: { slots: FilaSlot[]; bloqueos: FilaBloqueo[] };
  candidatos: Candidato[];
};

/** Las filas de reserva_slots que produce un turno: legacy, un bloque de 20 por fila; v2, una fila con su ocupación. */
export function slotsDeTurno(turno: TurnoIntervalo): { horas: string[]; ocupacion: number | null } {
  return turno.modalidad === "legacy"
    ? { horas: bloquesLegacy(turno), ocupacion: null }
    : { horas: [turno.hora], ocupacion: turno.ocupacion };
}

function filasBase(e: Escenario): FilaSlot[] {
  return e.base.flatMap(({ recurso, turno }) => {
    const { horas, ocupacion } = slotsDeTurno(turno);
    return horas.map((hora) => ({
      reserva_id: e.reservaId, fecha: e.fecha, hora, simulador: recurso, estado: "activa", ocupacion_min: ocupacion,
    }));
  });
}

/** Lo que dice el motor de UN candidato, mirando solo lo que la base conoce (slots y bloqueos). */
export function veredictoMotor(e: Escenario, c: Candidato, ahora: Date): Veredicto {
  const slots = [...filasBase(e), ...(e.existentes?.slots ?? [])];
  const { ocupaciones } = ocupacionesDelDia({ fecha: e.fecha, reservas: [], slots, ahora, pendienteTtlMin: 0 });
  const bloqueos = bloqueosAplicables([...e.bloqueos, ...(e.existentes?.bloqueos ?? [])], e.fecha, ahora);
  const intervalos = ocupaciones.filter((o) => o.recurso === c.recurso).map((o) => o.intervalo);
  const { ocupado, bloqueado } = estadoRecurso(c.turno, c.recurso, intervalos, bloqueos);
  if (ocupado && bloqueado) return "rechazo";
  if (ocupado) return "23505";
  if (bloqueado) return "23514";
  return "ok";
}

// ── Candidatos ──────────────────────────────────────────────────────────────

/** Turnos válidos de la grilla entre dos horas (inclusive), para cada recurso. */
export function barrido(args: {
  modalidad: Modalidad;
  producto: ProductoAgenda;
  fecha: string;
  desde: string;
  hasta: string;
  duraciones: readonly number[];
  recursos?: readonly string[];
}): Candidato[] {
  const desde = minutosDeHora(args.desde)!;
  const hasta = minutosDeHora(args.hasta)!;
  const out: Candidato[] = [];
  for (const recurso of args.recursos ?? RECURSOS_AGENDA) {
    for (const duracion of args.duraciones) {
      for (const turno of iniciosDelDia({ ...args, duracion })) {
        if (turno.inicio >= desde && turno.inicio <= hasta) out.push({ recurso, turno });
      }
    }
  }
  return out;
}

const base = (recurso: string, modalidad: Modalidad, hora: string, duracion: number): OcupacionBase =>
  ({ recurso, turno: turnoOcupacion(modalidad, hora, duracion)! });

/** Primer día desde `desde` que cumple la condición. */
function primerDia(desde: string, cumple: (f: string) => boolean): string {
  let f = desde;
  while (!cumple(f)) f = sumarDias(f, 1);
  return f;
}

const diaDeSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();

/**
 * La matriz sintética versionada en db/b2-motor-vs-trigger.sql. Fechas de 2099
 * (y una del 2000 para bloqueos vencidos): nunca pisan operación real.
 */
export function escenariosSinteticos(): Escenario[] {
  const lunes = primerDia("2099-03-01", (f) => diaDeSemana(f) === 1);
  const martes = sumarDias(lunes, 1);
  const sabado = primerDia(lunes, (f) => diaDeSemana(f) === 6);
  const pasado = "2000-01-03";
  if (esFinDeSemana(lunes) || esFinDeSemana(martes) || !esFinDeSemana(sabado) || esFinDeSemana(pasado)) {
    throw new Error("escenariosSinteticos: días mal elegidos");
  }
  const v2 = (fecha: string, desde: string, hasta: string, recursos?: readonly string[]) =>
    barrido({ modalidad: "v2_10", producto: "reserva", fecha, desde, hasta, duraciones: [10, 20, 30], recursos });
  const leg = (fecha: string, desde: string, hasta: string, producto: ProductoAgenda = "reserva",
    duraciones: readonly number[] = [15, 30], recursos?: readonly string[]) =>
    barrido({ modalidad: "legacy", producto, fecha, desde, hasta, duraciones, recursos });

  return [
    {
      // S1 · Convivencia legacy / v2 por ocupación, en un día hábil.
      codigo: "S1",
      fecha: lunes,
      reservaId: -960001,
      base: [
        base("Ferrari", "legacy", "12:00", 30),   // [12:00, 12:40)  caso 1 y 2
        base("McLaren", "v2_10", "12:00", 20),    // [12:00, 12:30)  caso 3 y contigua
        base("Red Bull", "v2_10", "12:30", 30),   // [12:30, 13:10)
        base("Alpine", "legacy", "13:00", 15),    // [13:00, 13:20)
        base("Ferrari", "v2_10", "21:50", 10),    // [21:50, 22:10)  el buffer pasa las 22:00
        base("McLaren", "legacy", "21:40", 15),   // [21:40, 22:00)
      ],
      bloqueos: [],
      candidatos: [...v2(lunes, "11:40", "13:30"), ...v2(lunes, "21:10", "21:50"),
        ...leg(lunes, "11:40", "13:20"), ...leg(lunes, "21:00", "21:40")],
    },
    {
      // S2 · Bloqueos: parcial (12:20–12:40, el ejemplo de v2), otro parcial,
      // todo el día de un simulador y uno inactivo que no bloquea.
      codigo: "S2",
      fecha: martes,
      reservaId: -960002,
      base: [],
      bloqueos: [
        { id: -962001, fecha: martes, todo_el_dia: false, hora_inicio: "12:20", hora_fin: "12:40", simulador: "Ferrari", activo: true },
        { id: -962002, fecha: martes, todo_el_dia: false, hora_inicio: "15:00", hora_fin: "15:30", simulador: "McLaren", activo: true },
        { id: -962003, fecha: martes, todo_el_dia: true, hora_inicio: null, hora_fin: null, simulador: "Alpine", activo: true },
        { id: -962004, fecha: martes, todo_el_dia: false, hora_inicio: "12:00", hora_fin: "13:00", simulador: "Red Bull", activo: false },
      ],
      candidatos: [
        ...v2(martes, "11:50", "12:50", ["Ferrari", "Red Bull", "Alpine"]),
        ...v2(martes, "14:30", "15:40", ["McLaren"]),
        ...leg(martes, "11:40", "12:40", "reserva", [15, 30], ["Ferrari", "Red Bull", "Alpine"]),
        ...leg(martes, "14:20", "15:40", "reserva", [15, 30], ["McLaren"]),
      ],
    },
    {
      // S3 · Fin de semana: legacy como las reservas reales del 03/10, una
      // Mensualidad legacy que ocupa más allá de las 14:00 y una v2 a las 14:00.
      codigo: "S3",
      fecha: sabado,
      reservaId: -960003,
      base: [
        base("McLaren", "legacy", "13:00", 30),   // [13:00, 13:40)
        base("Alpine", "legacy", "13:40", 60),    // [13:40, 15:00): 13:40, 14:00, 14:20, 14:40
        base("Red Bull", "v2_10", "14:00", 30),   // [14:00, 14:40)
      ],
      bloqueos: [],
      candidatos: [...v2(sabado, "12:40", "14:00"), ...leg(sabado, "12:40", "14:00"),
        ...leg(sabado, "13:20", "14:00", "mensualidad", [45, 60])],
    },
    {
      // S4 · Día pasado: el bloqueo de todo el día ya venció y no bloquea; la
      // ocupación sí se sigue respetando.
      codigo: "S4",
      fecha: pasado,
      reservaId: -960004,
      base: [base("Ferrari", "v2_10", "12:00", 20)],   // [12:00, 12:30)
      bloqueos: [
        { id: -962005, fecha: pasado, todo_el_dia: true, hora_inicio: null, hora_fin: null, simulador: null, activo: true },
      ],
      candidatos: [...v2(pasado, "12:00", "12:30", ["Ferrari", "McLaren"]), ...leg(pasado, "12:00", "12:20", "reserva", [15], ["Ferrari", "McLaren"])],
    },
  ];
}

// ── SQL ─────────────────────────────────────────────────────────────────────

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const n = (v: number | null) => (v === null ? "null::integer" : `${v}::integer`);
const bool = (b: boolean) => (b ? "true" : "false");

/** Una fila de casos. Solo la primera lleva los tipos: el resto los hereda. */
function filaCaso(id: string, c: Candidato, esperado: Veredicto, primera: boolean): string {
  const { horas, ocupacion } = slotsDeTurno(c.turno);
  const lista = q(`{${horas.join(",")}}`);
  return primera
    ? `(${q(id)}, ${q(c.recurso)}, ${lista}::text[], ${n(ocupacion)}, ${q(esperado)})`
    : `(${q(id)}, ${q(c.recurso)}, ${lista}, ${ocupacion ?? "null"}, ${q(esperado)})`;
}

/**
 * El bloque SQL completo. `ahora` decide qué bloqueos siguen vigentes para el
 * motor (las fechas sintéticas no dependen de eso: 2099 aplica, 2000 venció).
 */
export function sqlMotorVsTrigger(escenarios: readonly Escenario[], opts: { titulo: string; ahora: Date }): string {
  const L: string[] = [];
  L.push(`-- ${opts.titulo}`);
  L.push("-- GENERADO por lib/disponibilidadIntervalosTrigger.ts: no editar a mano.");
  L.push("-- Se revierte entero (termina SIEMPRE con RAISE EXCEPTION). Ids negativos y");
  L.push("-- explícitos: no consume secuencias ni deja filas. Resultado esperado:");
  L.push("-- 'B2_MOTOR_VS_TRIGGER_OK <n> casos (...)'.");
  L.push("do $b2$");
  L.push("declare");
  L.push("  v_fallas integer;");
  L.push("  v_total integer;");
  L.push("  v_libres integer;");
  L.push("  v_detalle text;");
  L.push("  c record;");
  L.push("begin");
  L.push("  perform set_config('lock_timeout', '5s', true);");
  L.push("  create temp table b2_res (orden serial, caso text, esperado text, obtenido text);");
  L.push("");
  L.push("  -- Inserta las filas de UN turno en una subtransacción que siempre se revierte.");
  L.push("  create function pg_temp.b2_probar(p_reserva bigint, p_fecha text, p_sim text, p_horas text[], p_ocup integer)");
  L.push("  returns text language plpgsql as $f$");
  L.push("  begin");
  L.push("    begin");
  L.push("      insert into public.reserva_slots (id, reserva_id, fecha, hora, simulador, estado, ocupacion_min) overriding system value");
  L.push("      select -(9600000 + t.n)::bigint, p_reserva, p_fecha, t.h, p_sim, 'activa', p_ocup");
  L.push("        from unnest(p_horas) with ordinality as t(h, n) order by t.n;");
  L.push("      raise exception using errcode = 'ZB2OK';");
  L.push("    exception");
  L.push("      when sqlstate 'ZB2OK' then return 'ok';");
  L.push("      when others then return sqlstate;");
  L.push("    end;");
  L.push("  end $f$;");

  let idSlot = -961000;
  for (const e of escenarios) {
    L.push("");
    L.push(`  -- ── ${e.codigo} · ${e.fecha} ──`);
    L.push("  insert into public.reservas (id, nombre, telefono, fecha, hora, simuladores, cantidad_turnos, total, estado,");
    L.push("    acepto_condiciones, duracion_minutos, origen) overriding system value");
    L.push(`  values (${e.reservaId}, 'ZZ_B2_TRIGGER', '0000000000', ${q(e.fecha)}, '10:00', '["Ferrari"]', 1, 0, 'activa', true, 15, 'web');`);
    const filas = filasBase(e);
    if (filas.length) {
      L.push("  insert into public.reserva_slots (id, reserva_id, fecha, hora, simulador, estado, ocupacion_min) overriding system value values");
      L.push(filas.map((f) => `    (${--idSlot}, ${e.reservaId}, ${q(f.fecha)}, ${q(f.hora)}, ${q(f.simulador)}, 'activa', ${n(f.ocupacion_min)})`).join(",\n") + ";");
    }
    if (e.bloqueos.length) {
      L.push("  -- Después de la base: un bloqueo no borra lo que ya estaba reservado.");
      L.push("  insert into public.bloqueos_reservas (id, fecha, todo_el_dia, hora_inicio, hora_fin, simulador, motivo, activo) overriding system value values");
      L.push(e.bloqueos.map((b) => `    (${b.id}, ${q(b.fecha)}, ${bool(b.todo_el_dia)}, ${b.hora_inicio === null ? "null" : q(b.hora_inicio)}, ${b.hora_fin === null ? "null" : q(b.hora_fin)}, ${b.simulador === null ? "null" : q(b.simulador)}, 'ZZ_B2', ${bool(b.activo)})`).join(",\n") + ";");
    }
    if (!e.candidatos.length) continue;
    L.push("  -- (caso, simulador, filas a insertar, ocupacion_min: NULL = legacy, veredicto del MOTOR)");
    L.push("  for c in select * from (values");
    L.push(e.candidatos.map((c, i) =>
      `    ${filaCaso(`${e.codigo}-${String(i + 1).padStart(3, "0")}`, c, veredictoMotor(e, c, opts.ahora), i === 0)}`,
    ).join(",\n"));
    L.push("  ) as t(caso, sim, horas, ocup, esperado) loop");
    L.push(`    insert into b2_res (caso, esperado, obtenido)`);
    L.push(`    values (format('%s ${e.fecha} %s %s %s', c.caso, c.sim, c.horas, coalesce(c.ocup::text, 'legacy')), c.esperado,`);
    L.push(`            pg_temp.b2_probar(${e.reservaId}, ${q(e.fecha)}, c.sim, c.horas, c.ocup));`);
    L.push("  end loop;");
  }

  L.push("");
  L.push("  select count(*), string_agg(format('%s: esperaba %s y dio %s', caso, esperado, obtenido), ' ; ' order by orden)");
  L.push("    into v_fallas, v_detalle");
  L.push("    from b2_res");
  L.push("   where not (case esperado when 'rechazo' then obtenido in ('23505', '23514') else obtenido = esperado end);");
  L.push("  select count(*), count(*) filter (where obtenido = 'ok') into v_total, v_libres from b2_res;");
  L.push("  if v_fallas > 0 then");
  L.push("    raise exception 'B2_FALLA % de % casos: %', v_fallas, v_total, left(v_detalle, 3000);");
  L.push("  end if;");
  L.push("  raise exception 'B2_MOTOR_VS_TRIGGER_OK % casos (% libres, % rechazados)', v_total, v_libres, v_total - v_libres;");
  L.push("end");
  L.push("$b2$;");
  return L.join("\n") + "\n";
}
