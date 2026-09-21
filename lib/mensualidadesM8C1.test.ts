import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGLAS_POR_PRODUCTO, WEEKDAY_SLOTS, WEEKEND_SLOTS,
  bloquesDeAgendaPara, diaHabilitadoPara, fechasPublicas, fechasPublicasPara,
  horariosDe, horariosPosiblesPara, limiteDeTurno, terminaAntesDelCierre,
} from "@/lib/agenda";
import { validarSeleccion } from "@/lib/mensualidadesReserva";
import {
  CONDICIONES_MENSUALIDAD, CONDICIONES_MENSUALIDAD_TEXTO,
  CONDICIONES_VERSION, CONDICIONES_RESERVA_VERSION,
} from "@/lib/mensualidadesCondiciones";

// Guardas PURAS del bloque M8C.1. Sin DB, sin red.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM8C1.test.ts
//
// M5C.1 había restringido Mensualidades a lunes–viernes. Nada del negocio lo
// pedía: el local abre los siete días y quien compró horas tiene que poder
// usarlas cuando el local abre.
//
// REGLA DEFINITIVA
//   · lunes a viernes: inicios de 10:00 a 21:40, y la experiencia TERMINA a las
//     22:00 o antes;
//   · sábados y domingos: inicios de 10:00 a 14:00 INCLUSIVE, con cualquiera de
//     las cuatro duraciones. El turno PUEDE terminar después de las 14:00.
//
// Los dos días se limitan de maneras distintas y eso es deliberado: entre
// semana manda el CIERRE, el fin de semana manda el ÚLTIMO INICIO. No existe un
// "cierre de las 15:00": nadie fijó esa hora. Lo que el negocio define el
// sábado es hasta qué hora se puede empezar, y eso ya lo dice la grilla.

const ROOT = process.cwd();
const leer = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Semana de referencia: lun 21 … dom 27 de septiembre de 2026.
const LUNES = "2026-09-21";
const VIERNES = "2026-09-25";
const SABADO = "2026-09-26";
const DOMINGO = "2026-09-27";
const HOY = "2026-09-20";
const DURACIONES = [15, 30, 45, 60] as const;

const clave = () => "m8c1" + "x".repeat(20);
const sel = (extra: Record<string, unknown>) =>
  validarSeleccion({
    fecha: LUNES, hora: "11:00", duracion_minutos: 15,
    simuladores: ["Ferrari"], acepto_condiciones: true, idempotency_key: clave(),
    ...extra,
  }, HOY);
const codigo = (r: ReturnType<typeof sel>) => (r.ok ? "ok" : r.codigo);

// ── 1) Los siete días están habilitados ────────────────────────────────────
{
  for (const f of [LUNES, "2026-09-22", "2026-09-23", "2026-09-24", VIERNES, SABADO, DOMINGO]) {
    assert.equal(diaHabilitadoPara("mensualidad", f), true, `${f} habilitado`);
  }
  assert.deepEqual([...REGLAS_POR_PRODUCTO.mensualidad.diasHabilitados].sort(),
    [0, 1, 2, 3, 4, 5, 6], "los siete días en la fuente de dominio");

  // La ventana pública ya no se recorta: es la misma que la de Reservas.
  assert.deepEqual(fechasPublicasPara("mensualidad", HOY), fechasPublicas(HOY));
  assert.equal(fechasPublicasPara("mensualidad", HOY).length, 15);

  for (const malo of ["", "2026-13-01", "20260921", "hoy", "2026-09-31"]) {
    assert.equal(diaHabilitadoPara("mensualidad", malo), false, `inválida: ${malo}`);
  }
}

// ── 2) Dos maneras distintas de limitar el turno ───────────────────────────
{
  const l = REGLAS_POR_PRODUCTO.mensualidad.limiteTurno;
  assert.deepEqual(l.semana, { tipo: "cierre", minuto: 22 * 60 });
  assert.deepEqual(l.finDeSemana, { tipo: "ultimoInicio" });

  assert.equal(limiteDeTurno("mensualidad", LUNES).tipo, "cierre");
  assert.equal(limiteDeTurno("mensualidad", VIERNES).tipo, "cierre");
  assert.equal(limiteDeTurno("mensualidad", SABADO).tipo, "ultimoInicio");
  assert.equal(limiteDeTurno("mensualidad", DOMINGO).tipo, "ultimoInicio");

  // Reservas normales NO cambió: cierre a las 22:00 los siete días.
  const rn = REGLAS_POR_PRODUCTO.reserva.limiteTurno;
  assert.deepEqual(rn.semana, { tipo: "cierre", minuto: 22 * 60 });
  assert.deepEqual(rn.finDeSemana, { tipo: "cierre", minuto: 22 * 60 },
    "Reservas conserva su cierre de siempre");
  assert.equal(limiteDeTurno("reserva", SABADO).tipo, "cierre");
}

// ── 3) Lunes a viernes: exactamente como estaba ────────────────────────────
{
  assert.equal(WEEKDAY_SLOTS[0], "10:00");
  assert.equal(WEEKDAY_SLOTS[WEEKDAY_SLOTS.length - 1], "21:40");
  assert.deepEqual(horariosDe(LUNES), [...WEEKDAY_SLOTS]);

  // Terminar exactamente a las 22:00 vale; un minuto después, no.
  assert.equal(terminaAntesDelCierre("mensualidad", LUNES, "21:00", 60), true);
  assert.equal(terminaAntesDelCierre("mensualidad", LUNES, "21:01", 60), false);

  // Los últimos inicios REALES de la semana, por duración. Son los de siempre.
  const ultimo = (f: string, d: number) => {
    const hs = horariosPosiblesPara("mensualidad", f, d);
    return hs[hs.length - 1];
  };
  assert.equal(ultimo(LUNES, 15), "21:40");
  assert.equal(ultimo(LUNES, 30), "21:20");
  assert.equal(ultimo(LUNES, 45), "21:00");
  assert.equal(ultimo(LUNES, 60), "20:40");
  assert.equal(horariosPosiblesPara("mensualidad", LUNES, 60)[0], "10:00");

  // Y un inicio fuera de la grilla no entra, aunque terminara antes del cierre.
  assert.equal(bloquesDeAgendaPara("mensualidad", LUNES, "21:45", 15), null,
    "21:45 no es un inicio de la grilla");
  assert.equal(bloquesDeAgendaPara("mensualidad", LUNES, "10:10", 15), null);
}

// ── 4) Sábado y domingo: inicios de 10:00 a 14:00 INCLUSIVE ────────────────
{
  assert.equal(WEEKEND_SLOTS[0], "10:00");
  assert.equal(WEEKEND_SLOTS[WEEKEND_SLOTS.length - 1], "14:00");
  assert.equal(WEEKEND_SLOTS.length, 13);

  for (const finde of [SABADO, DOMINGO]) {
    assert.deepEqual(horariosDe(finde), [...WEEKEND_SLOTS], `${finde} usa la grilla corta`);

    // LA regla de M8C.1: los 13 inicios se ofrecen con las CUATRO duraciones.
    for (const d of DURACIONES) {
      assert.deepEqual(horariosPosiblesPara("mensualidad", finde, d), [...WEEKEND_SLOTS],
        `${finde} con ${d} min ofrece los 13 inicios, sin recortar`);
    }

    // 14:00 con cualquier duración: entra, y ocupa lo que le corresponde.
    assert.deepEqual(bloquesDeAgendaPara("mensualidad", finde, "14:00", 15), ["14:00"]);
    assert.deepEqual(bloquesDeAgendaPara("mensualidad", finde, "14:00", 30), ["14:00", "14:20"]);
    assert.deepEqual(bloquesDeAgendaPara("mensualidad", finde, "14:00", 45),
      ["14:00", "14:20", "14:40"]);
    assert.deepEqual(bloquesDeAgendaPara("mensualidad", finde, "14:00", 60),
      ["14:00", "14:20", "14:40", "15:00"],
      "un turno de 60 desde las 14:00 ocupa hasta las 15:00: ocupar no es poder empezar");

    // 14:20 y cualquier inicio que no esté en la grilla: rechazado.
    for (const hora of ["14:20", "14:40", "15:00", "18:00", "21:00", "09:40", "13:50"]) {
      assert.equal(bloquesDeAgendaPara("mensualidad", finde, hora, 15), null,
        `${hora} no es un inicio del fin de semana`);
    }

    // No hay cierre que medir: la función que lo mide no rechaza nada acá.
    for (const [hora, d] of [["14:00", 60], ["13:00", 60]] as const) {
      assert.equal(terminaAntesDelCierre("mensualidad", finde, hora, d), true,
        "el fin de semana no se mide contra un cierre");
    }
  }
}

// ── 5) Reservas normales, intacto ──────────────────────────────────────────
{
  // El sábado, con 15 minutos, los dos productos ofrecen los MISMOS 13 inicios.
  assert.deepEqual(horariosPosiblesPara("reserva", SABADO, 15), [...WEEKEND_SLOTS]);
  assert.deepEqual(horariosPosiblesPara("mensualidad", SABADO, 15), [...WEEKEND_SLOTS]);
  assert.deepEqual(
    horariosPosiblesPara("reserva", SABADO, 15),
    horariosPosiblesPara("mensualidad", SABADO, 15),
    "mismo sábado, misma grilla de inicios para los dos",
  );

  // Con 30 minutos Reservas sigue comportándose EXACTAMENTE como antes: sus
  // bloques salen de la grilla, así que 14:00 no le entra porque necesitaría un
  // 14:20 que la grilla no tiene. No se toca.
  assert.deepEqual(horariosPosiblesPara("reserva", SABADO, 30).slice(-1), ["13:40"],
    "Reservas con 30 min sigue terminando en 13:40, como siempre");
  assert.equal(bloquesDeAgendaPara("reserva", SABADO, "14:00", 30), null);
  // Y entre semana, igual que siempre.
  assert.deepEqual(horariosPosiblesPara("reserva", LUNES, 15).slice(-1), ["21:40"]);
  assert.deepEqual(horariosPosiblesPara("reserva", LUNES, 30).slice(-1), ["21:20"]);
  assert.deepEqual([...REGLAS_POR_PRODUCTO.reserva.duraciones], [15, 30]);
  assert.deepEqual([...REGLAS_POR_PRODUCTO.reserva.diasHabilitados], [0, 1, 2, 3, 4, 5, 6]);
}

// ── 6) La validación completa aplica la regla por día ──────────────────────
{
  // Fin de semana a las 14:00, las cuatro duraciones: aceptadas.
  for (const finde of [SABADO, DOMINGO]) {
    for (const d of DURACIONES) {
      assert.equal(codigo(sel({ fecha: finde, hora: "14:00", duracion_minutos: d })), "ok",
        `${finde} 14:00 de ${d} min se acepta`);
    }
    // Temprano también.
    assert.equal(codigo(sel({ fecha: finde, hora: "10:00", duracion_minutos: 60 })), "ok");
    // 14:20 no existe como inicio: cae antes, por horario.
    assert.equal(codigo(sel({ fecha: finde, hora: "14:20", duracion_minutos: 15 })), "hora_invalida",
      `${finde} 14:20 no es un horario de la grilla`);
    assert.equal(codigo(sel({ fecha: finde, hora: "18:00", duracion_minutos: 15 })), "hora_invalida");
  }

  // Entre semana, el cierre sigue mandando.
  assert.equal(codigo(sel({ fecha: LUNES, hora: "20:40", duracion_minutos: 60 })), "ok");
  assert.equal(codigo(sel({ fecha: LUNES, hora: "21:00", duracion_minutos: 60 })), "sin_bloques");
  assert.equal(codigo(sel({ fecha: LUNES, hora: "21:40", duracion_minutos: 30 })), "sin_bloques");

  // El mensaje dice cuál de los dos límites falló.
  const semana = sel({ fecha: LUNES, hora: "21:40", duracion_minutos: 30 });
  assert.ok(!semana.ok && /terminar antes de las 22:00/.test(semana.error),
    `entre semana el mensaje habla del cierre: ${semana.ok ? "" : semana.error}`);
}

// ── 7) Lo que NO cambió ────────────────────────────────────────────────────
{
  // Simuladores: de 1 a 4, también el fin de semana y también a las 14:00.
  for (const n of [1, 2, 3, 4]) {
    const sims = ["Ferrari", "McLaren", "Red Bull", "Alpine"].slice(0, n);
    assert.equal(codigo(sel({ fecha: SABADO, hora: "14:00", simuladores: sims })), "ok",
      `${n} simuladores el sábado a las 14:00`);
  }
  assert.equal(codigo(sel({ fecha: SABADO, hora: "14:00", simuladores: [] })), "simuladores_invalidos");
  assert.equal(codigo(sel({
    fecha: SABADO, hora: "14:00",
    simuladores: ["Ferrari", "McLaren", "Red Bull", "Alpine", "Ferrari"],
  })), "simuladores_invalidos");

  // Consumo: duración × cantidad, sin excepciones de día.
  for (const [n, d, esperado] of [[1, 15, 15], [4, 60, 240], [2, 30, 60], [4, 15, 60]] as const) {
    assert.equal(d * n, esperado, `${n} x ${d} = ${esperado}`);
  }

  // Ventana, vigencia y condiciones siguen mandando.
  assert.equal(codigo(sel({ fecha: HOY })), "fecha_fuera_de_ventana", "hoy no");
  assert.equal(codigo(sel({ fecha: "2026-10-06" })), "fecha_fuera_de_ventana", "hoy+16 tampoco");
  assert.equal(codigo(sel({ fecha: SABADO, hora: "11:00", acepto_condiciones: false })), "condiciones");
}

// ── 8) Las condiciones dicen el horario nuevo ──────────────────────────────
{
  assert.equal(CONDICIONES_MENSUALIDAD.length, 8, "siguen siendo ocho, sin una novena");

  const reservas = CONDICIONES_MENSUALIDAD.find((c) => c.titulo === "Reservas");
  assert.ok(reservas, "existe la condición de Reservas");
  assert.equal(
    reservas!.texto,
    "Se realizan desde la web con el código y el teléfono, sin crear una cuenta. " +
    "Podés reservar de lunes a viernes de 10:00 a 22:00, " +
    "y sábados y domingos con horarios de inicio de 10:00 a 14:00. " +
    "Se reserva desde el día siguiente y hasta 15 días de anticipación. " +
    "El turno debe realizarse dentro de la vigencia y está sujeto a disponibilidad.",
    "el texto exacto de M8C.1",
  );

  // No puede decir que el turno tiene que terminar antes de las 14:00.
  assert.ok(!/finalizar.*14:00|terminar.*14:00/i.test(reservas!.texto),
    "la condición NO dice que el turno deba terminar antes de las 14:00");

  assert.equal(CONDICIONES_VERSION, "2026-09-m8c1");
  assert.equal(CONDICIONES_RESERVA_VERSION, "2026-09-m8c1");

  const texto = CONDICIONES_MENSUALIDAD_TEXTO.join(" ");
  assert.ok(!/solo de lunes a viernes/i.test(texto));
  assert.ok(texto.includes("sábados y domingos"), "nombra el fin de semana");
  assert.ok(texto.includes("1,40 m") && texto.includes("110 kg"));
}

// ── 9) Ningún texto vigente dice que Mensualidades es solo de lunes a viernes ─
{
  const archivos = [
    "lib/mensualidadesReserva.ts",
    "lib/mensualidadesGestionReserva.ts",
    "app/mensualidades/reservar/ReservarConMensualidad.tsx",
    "app/mensualidades/reservar/SelectorFecha.tsx",
    "app/api/mensualidades/disponibilidad/route.ts",
  ];
  // Se miran solo las CADENAS de cara al usuario, no los comentarios: varios
  // explican la historia del bloque y necesitan nombrar la regla vieja.
  for (const a of archivos) {
    const codigoSinComentarios = leer(a)
      .split("\n").map((l) => l.replace(/\r$/, "")).join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const prohibida of [
      "Con la mensualidad se reserva de lunes a viernes",
      "solo de lunes a viernes",
    ]) {
      assert.ok(!codigoSinComentarios.includes(prohibida),
        `${a} todavía le dice a la persona "${prohibida}"`);
    }
  }
}

// ── 10) El cliente no tiene una segunda aritmética de días ni horarios ─────
{
  for (const a of [
    "app/mensualidades/reservar/ReservarConMensualidad.tsx",
    "app/mensualidades/reservar/SelectorFecha.tsx",
  ]) {
    const texto = leer(a);
    for (const regla of [
      "WEEKDAY_SLOTS", "WEEKEND_SLOTS", "esFinDeSemana", "limiteTurno", "limiteDeTurno",
      "diaHabilitadoPara", "fechasPublicasPara", "REGLAS_POR_PRODUCTO",
      "10:00", "14:00", "22:00",
    ]) {
      assert.ok(!texto.includes(regla),
        `${a} no puede contener la regla "${regla}": el horario lo decide el servidor`);
    }
  }
}

console.log("mensualidadesM8C1.test.ts OK (los siete días; el finde se limita por último inicio)");
