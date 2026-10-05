// Genera db/fixtures-ia-historico.sql: el escenario histórico SINTÉTICO de agosto y
// septiembre de 2026 que necesitan las suites de IA SIM para correr sin datos reales.
//
//   node scripts/pruebas/generar-historico-ia.mjs
//
// Por qué un generador y no SQL escrito a mano: el contrato numérico son decenas de
// restricciones cruzadas (totales por mes, por fuente, por grupo hábiles/fin de semana,
// por semana ISO, mejores días, promedios, turnos, personas, minutos y horas). Acá se
// declaran los repartos y el script VERIFICA toda la aritmética antes de escribir una
// línea de SQL: si una suma no cierra, no emite nada y dice qué falló.
//
// El SQL resultante se versiona: es el fixture, y queda auditable línea por línea.

import { writeFileSync } from "node:fs";

const MARCA = "TEST_IA_HIST_2026";
const ARCHIVO = "db/fixtures-ia-historico.sql";

// ── Calendario ──────────────────────────────────────────────────────────────
const esFinDeSemana = (iso) => [0, 6].includes(new Date(iso + "T00:00:00Z").getUTCDay());
const dia = (mes, d) => "2026-" + String(mes).padStart(2, "0") + "-" + String(d).padStart(2, "0");
const diasDe = (mes) => Array.from({ length: new Date(Date.UTC(2026, mes, 0)).getUTCDate() }, (_, i) => dia(mes, i + 1));
// Lunes de la semana ISO de una fecha: la dimensión `semana` del motor analítico.
const lunesDe = (iso) => {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};

// ── AGOSTO · turnero del stand por día ──────────────────────────────────────
// Los cinco totales semanales aprobados por 5A salen de esta columna más los ingresos
// manuales y los campeonatos que se cargan abajo.
const TURNERO_AGO = {
  // semana del 3 (hábiles) → $1.348.000
  "2026-08-03": 220_000, "2026-08-04": 240_000, "2026-08-05": 268_000, "2026-08-06": 300_000, "2026-08-07": 320_000,
  // semana del 10 → $1.004.000
  "2026-08-10": 180_000, "2026-08-11": 184_000, "2026-08-12": 200_000, "2026-08-13": 220_000, "2026-08-14": 220_000,
  // semana del 17 → $2.954.000, con el 18 como mejor día hábil ($1.720.000 con el manual)
  "2026-08-17": 300_000, "2026-08-18": 220_000, "2026-08-19": 320_000, "2026-08-20": 300_000, "2026-08-21": 314_000,
  // semana del 24 → $2.242.000
  "2026-08-24": 180_000, "2026-08-25": 200_000, "2026-08-26": 150_000, "2026-08-27": 120_000, "2026-08-28": 102_000,
  // semana del 31 (el lunes suelto que 5A exige como quinta fila) → $132.000
  "2026-08-31": 132_000,
  // fines de semana: el 15 es el mejor día del grupo ($878.000, solo turnero)
  "2026-08-01": 520_000, "2026-08-02": 560_000, "2026-08-08": 480_000, "2026-08-09": 600_000,
  "2026-08-15": 878_000, "2026-08-16": 540_000, "2026-08-22": 500_000, "2026-08-23": 530_000,
  "2026-08-29": 520_000, "2026-08-30": 440_000,
};

// Turnos comerciales del stand por día: suman 906 y, con los 6 de las reservas, dan los
// 912 aprobados. Repartidos en proporción a la facturación del día (~11.300 por turno).
const TURNOS_AGO = {
  "2026-08-01": 46, "2026-08-02": 49, "2026-08-03": 19, "2026-08-04": 21, "2026-08-05": 24,
  "2026-08-06": 26, "2026-08-07": 28, "2026-08-08": 42, "2026-08-09": 53, "2026-08-10": 16,
  "2026-08-11": 16, "2026-08-12": 18, "2026-08-13": 19, "2026-08-14": 19, "2026-08-15": 78,
  "2026-08-16": 48, "2026-08-17": 26, "2026-08-18": 19, "2026-08-19": 28, "2026-08-20": 26,
  "2026-08-21": 28, "2026-08-22": 44, "2026-08-23": 47, "2026-08-24": 16, "2026-08-25": 18,
  "2026-08-26": 13, "2026-08-27": 11, "2026-08-28": 9, "2026-08-29": 46, "2026-08-30": 39,
  "2026-08-31": 14,
};

// Ingresos manuales de agosto: $2.950.000, los dos en días hábiles, así el grupo
// "lunes a viernes" cierra en $7.680.000 y el fin de semana queda con manuales en $0.
const MANUALES_AGO = [
  { fecha: "2026-08-18", monto: 1_500_000, detalle: "evento corporativo" },
  { fecha: "2026-08-26", monto: 1_450_000, detalle: "convenio institucional" },
];

// Campeonatos de agosto: $120.000 = 6 inscripciones de $20.000, dos en un día hábil
// ($40.000) y cuatro en fines de semana ($80.000). Imputan por fecha de PAGO.
const CAMPEONATOS_AGO = [
  { fecha: "2026-08-25", cantidad: 2 },
  { fecha: "2026-08-08", cantidad: 2 },
  { fecha: "2026-08-22", cantidad: 2 },
];

// Reservas web de agosto: $126.000, las tres en fin de semana (el grupo hábil queda en $0).
const RESERVAS_AGO = [
  { fecha: "2026-08-16", total: 50_000, turnos: 2 },
  { fecha: "2026-08-23", total: 40_000, turnos: 2 },
  { fecha: "2026-08-30", total: 36_000, turnos: 2 },
];

// ── SEPTIEMBRE ──────────────────────────────────────────────────────────────
// Sin contrato de segmentación: alcanza con que el mes cierre en sus totales por fuente.
const TURNERO_SEP = {
  "2026-09-01": 282_000, "2026-09-02": 292_000, "2026-09-03": 300_000, "2026-09-04": 310_000,
  "2026-09-05": 454_000, "2026-09-06": 442_000, "2026-09-07": 272_000, "2026-09-08": 282_000,
  "2026-09-09": 292_000, "2026-09-10": 282_000, "2026-09-11": 300_000, "2026-09-12": 432_000,
  "2026-09-13": 424_000, "2026-09-14": 264_000, "2026-09-15": 272_000, "2026-09-16": 282_000,
  "2026-09-17": 292_000, "2026-09-18": 300_000, "2026-09-19": 414_000, "2026-09-20": 404_000,
  "2026-09-21": 254_000, "2026-09-22": 264_000, "2026-09-23": 272_000, "2026-09-24": 282_000,
  "2026-09-25": 292_000, "2026-09-26": 394_000, "2026-09-27": 386_000, "2026-09-28": 238_000,
  "2026-09-29": 244_000, "2026-09-30": 236_000,
};
const TURNOS_SEP = {
  "2026-09-01": 25, "2026-09-02": 25, "2026-09-03": 26, "2026-09-04": 27, "2026-09-05": 39,
  "2026-09-06": 38, "2026-09-07": 24, "2026-09-08": 24, "2026-09-09": 25, "2026-09-10": 24,
  "2026-09-11": 26, "2026-09-12": 38, "2026-09-13": 37, "2026-09-14": 23, "2026-09-15": 24,
  "2026-09-16": 24, "2026-09-17": 25, "2026-09-18": 26, "2026-09-19": 36, "2026-09-20": 35,
  "2026-09-21": 22, "2026-09-22": 23, "2026-09-23": 24, "2026-09-24": 24, "2026-09-25": 25,
  "2026-09-26": 34, "2026-09-27": 34, "2026-09-28": 21, "2026-09-29": 21, "2026-09-30": 21,
};
const MANUALES_SEP = [
  { fecha: "2026-09-10", monto: 400_000, detalle: "evento corporativo" },
  { fecha: "2026-09-24", monto: 270_000, detalle: "convenio institucional" },
];
const CAMPEONATOS_SEP = [
  { fecha: "2026-09-12", cantidad: 6 },
  { fecha: "2026-09-26", cantidad: 6 },
];
const RESERVAS_SEP = [
  { fecha: "2026-09-05", total: 30_000, turnos: 2 },
  { fecha: "2026-09-19", total: 26_000, turnos: 2 },
  { fecha: "2026-09-27", total: 20_000, turnos: 2 },
];

const PRECIO_INSCRIPCION = 20_000;

// ── Contrato numérico aprobado ──────────────────────────────────────────────
// `personas` y `minutos` son los dos valores estructurales que NO están en el enunciado
// del bloque: los declara lib/ia/plan/ejecutorPlan.integration.ts (822/738 personas y
// 13.680/12.390 minutos de actividad), verificados aparte contra las herramientas.
const CONTRATO = {
  8: { total: 13_454_000, turnero: 10_258_000, manuales: 2_950_000, campeonatos: 120_000, reservas: 126_000, turnos: 912, personas: 822, minutos: 13_680, minutosCronograma: 24_840 },
  9: { total: 10_440_000, turnero: 9_454_000, manuales: 670_000, campeonatos: 240_000, reservas: 76_000, turnos: 826, personas: 738, minutos: 12_390, minutosCronograma: 24_305 },
};
const datos = {
  8: { turnero: TURNERO_AGO, turnos: TURNOS_AGO, manuales: MANUALES_AGO, camp: CAMPEONATOS_AGO, res: RESERVAS_AGO },
  9: { turnero: TURNERO_SEP, turnos: TURNOS_SEP, manuales: MANUALES_SEP, camp: CAMPEONATOS_SEP, res: RESERVAS_SEP },
};

// ── Cronograma: minutos exactos ─────────────────────────────────────────────
// Cada día abierto lleva una jornada que cubre TODA la ventana operativa (sin huecos, así
// el integrante de respaldo no suma minutos) y algunos días una segunda jornada de tarde
// de otro integrante. Los totales salen exactos: agosto 24.840 min = 414,00 h;
// septiembre 24.305 min = 405,0833… h, que el servidor redondea a 405,08 h.
const VENTANA = { apertura: "10:00", cierre: "22:00" }; // 720 minutos
// Los dos integrantes se parten la ventana SIN huecos (así el de respaldo suma 0) y el
// primero agrega refuerzos de tarde, que se superponen con el segundo: superponerse entre
// integrantes distintos es válido, lo que no se admite es que uno se superponga consigo
// mismo. Por eso los refuerzos empiezan después de que termina su propio turno.
const TURNOS = {
  manana:       { inicio: "10:00", fin: "15:00", minutos: 300 },  // integrante A
  mananaCorta:  { inicio: "10:00", fin: "14:30", minutos: 270 },  // integrante A
  tarde:        { inicio: "15:00", fin: "22:00", minutos: 420 },  // integrante B
  tardeLarga:   { inicio: "14:30", fin: "22:00", minutos: 450 },  // integrante B
  refuerzo:     { inicio: "16:00", fin: "22:00", minutos: 360 },  // integrante A
  refuerzoCorto:{ inicio: "18:55", fin: "22:00", minutos: 185 },  // integrante A
};
// `cortas` son los días en que A entra media hora menos y B compensa; `refuerzos`, los
// días en que A vuelve a la tarde. El reparto no es decorativo: 4C.2 afirma que el
// integrante A tiene 194 h (11.640 min) en agosto, y de ahí salen los números.
const CRONOGRAMA = {
  8: {
    cortas: ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-08-06"],
    refuerzos: ["2026-08-07", "2026-08-08", "2026-08-14", "2026-08-15", "2026-08-21", "2026-08-22", "2026-08-29"],
    refuerzoCorto: null,
  },
  9: {
    cortas: [],
    refuerzos: ["2026-09-04", "2026-09-05", "2026-09-11", "2026-09-12", "2026-09-18", "2026-09-19", "2026-09-25"],
    refuerzoCorto: "2026-09-26",
  },
};
// Minutos por integrante que tiene que dar el reparto.
const HORAS_POR_INTEGRANTE = {
  8: { a: 11_640, b: 13_200 },  // 194 h y 220 h
  9: { a: 11_705, b: 12_600 },
};

// ── Reparto de personas por día ─────────────────────────────────────────────
// En modalidad legacy los minutos de actividad salen solos (turnos × 15), pero las
// personas son independientes de los turnos: una persona que juega 30 minutos deja dos
// turnos. Por eso cada día lleva dos filas, la forma real de una jornada del stand:
//   · fila de 15 min → personas = turnos
//   · fila de 30 min → personas = turnos / 2
// Con T turnos y P personas en el día, la fila de 30 lleva (T − P) personas y la de 15
// lleva (2P − T). El reparto por día es determinístico: resto mayor sobre los turnos.
function filasDelMes(mes) {
  const d = datos[mes];
  const standTurnos = Object.values(d.turnos).reduce((a, b) => a + b, 0);
  const standPersonas = CONTRATO[mes].personas - d.res.length; // una persona por reserva
  const objetivo30 = standTurnos - standPersonas;

  const dias = diasDe(mes);
  const cuota = dias.map((f) => (d.turnos[f] * objetivo30) / standTurnos);
  const base = cuota.map(Math.floor);
  const faltan = objetivo30 - base.reduce((a, b) => a + b, 0);
  const orden = dias
    .map((f, i) => ({ i, resto: cuota[i] - base[i], turnos: d.turnos[f] }))
    .sort((a, b) => b.resto - a.resto || b.turnos - a.turnos || a.i - b.i);
  for (let k = 0; k < faltan; k++) base[orden[k].i]++;

  return dias.map((f, i) => {
    const t = d.turnos[f];
    const p30 = base[i];
    const t30 = p30 * 2;
    const t15 = t - t30;
    const totalDia = d.turnero[f];
    // El importe del día se parte en proporción a los turnos de cada fila, redondeado a
    // miles: una caja real no factura $429.565. El día sigue sumando exacto porque la fila
    // de 15 se queda con el resto.
    const total30 = t15 === 0 ? totalDia : t30 === 0 ? 0 : Math.round((totalDia * t30) / t / 1000) * 1000;
    return {
      fecha: f,
      q15: { turnos: t15, personas: t15, total: totalDia - total30 },
      q30: { turnos: t30, personas: p30, total: total30 },
    };
  });
}

// ── Verificación de TODA la aritmética antes de emitir ──────────────────────
const problemas = [];
const chequear = (ok, msg) => { if (!ok) problemas.push(msg); };
const suma = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const sumaSi = (o, pred) => Object.entries(o).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);

// Cobertura: el turnero y los turnos cubren exactamente los días de cada mes.
for (const mes of [8, 9]) {
  const esperados = diasDe(mes);
  chequear(JSON.stringify(Object.keys(datos[mes].turnero).sort()) === JSON.stringify(esperados), `mes ${mes}: el turnero no cubre exactamente los días del mes`);
  chequear(JSON.stringify(Object.keys(datos[mes].turnos).sort()) === JSON.stringify(esperados), `mes ${mes}: los turnos no cubren exactamente los días del mes`);
}

const FILAS = { 8: filasDelMes(8), 9: filasDelMes(9) };

for (const mes of [8, 9]) {
  const c = CONTRATO[mes], d = datos[mes];
  // Totales por fuente.
  chequear(suma(d.turnero) === c.turnero, `mes ${mes}: turnero ${suma(d.turnero)} ≠ ${c.turnero}`);
  const man = d.manuales.reduce((a, m) => a + m.monto, 0);
  chequear(man === c.manuales, `mes ${mes}: manuales ${man} ≠ ${c.manuales}`);
  const camp = d.camp.reduce((a, x) => a + x.cantidad, 0) * PRECIO_INSCRIPCION;
  chequear(camp === c.campeonatos, `mes ${mes}: campeonatos ${camp} ≠ ${c.campeonatos}`);
  const res = d.res.reduce((a, r) => a + r.total, 0);
  chequear(res === c.reservas, `mes ${mes}: reservas ${res} ≠ ${c.reservas}`);
  chequear(suma(d.turnero) + man + camp + res === c.total, `mes ${mes}: la facturación bruta no cierra`);

  // Actividad: turnos, personas y minutos (legacy: minutos = turnos × 15).
  const resTurnos = d.res.reduce((a, r) => a + r.turnos, 0);
  const standTurnos = FILAS[mes].reduce((a, f) => a + f.q15.turnos + f.q30.turnos, 0);
  const standPersonas = FILAS[mes].reduce((a, f) => a + f.q15.personas + f.q30.personas, 0);
  chequear(standTurnos + resTurnos === c.turnos, `mes ${mes}: turnos ${standTurnos + resTurnos} ≠ ${c.turnos}`);
  chequear(standPersonas + d.res.length === c.personas, `mes ${mes}: personas ${standPersonas + d.res.length} ≠ ${c.personas}`);
  chequear((standTurnos + resTurnos) * 15 === c.minutos, `mes ${mes}: minutos de actividad ${(standTurnos + resTurnos) * 15} ≠ ${c.minutos}`);

  // Cada fila tiene que cumplir la fórmula legacy de su duración.
  for (const f of FILAS[mes]) {
    chequear(f.q15.turnos >= 0 && f.q30.turnos >= 0, `mes ${mes}: el día ${f.fecha} quedó con una fila negativa`);
    chequear(f.q15.turnos === f.q15.personas, `mes ${mes}: ${f.fecha} la fila de 15 min no cumple turnos = personas`);
    chequear(f.q30.turnos === f.q30.personas * 2, `mes ${mes}: ${f.fecha} la fila de 30 min no cumple turnos = personas × 2`);
    chequear(f.q15.total + f.q30.total === d.turnero[f.fecha], `mes ${mes}: ${f.fecha} las dos filas no suman el turnero del día`);
    chequear(f.q15.total >= 0 && f.q30.total >= 0, `mes ${mes}: ${f.fecha} un importe quedó negativo`);
  }

  // Cronograma: minutos por integrante y total del mes.
  const cr = CRONOGRAMA[mes];
  const dias = diasDe(mes);
  for (const f of [...cr.cortas, ...cr.refuerzos, cr.refuerzoCorto].filter(Boolean)) {
    chequear(dias.includes(f), `mes ${mes}: ${f} no es un día del mes`);
  }
  chequear(new Set(cr.cortas).size === cr.cortas.length, `mes ${mes}: días cortos repetidos`);
  chequear(new Set(cr.refuerzos).size === cr.refuerzos.length, `mes ${mes}: refuerzos repetidos`);
  chequear(!cr.refuerzos.includes(cr.refuerzoCorto), `mes ${mes}: el refuerzo corto cae un día que ya tiene refuerzo`);

  const minA = cr.cortas.length * TURNOS.mananaCorta.minutos
    + (dias.length - cr.cortas.length) * TURNOS.manana.minutos
    + cr.refuerzos.length * TURNOS.refuerzo.minutos
    + (cr.refuerzoCorto ? TURNOS.refuerzoCorto.minutos : 0);
  const minB = cr.cortas.length * TURNOS.tardeLarga.minutos
    + (dias.length - cr.cortas.length) * TURNOS.tarde.minutos;

  chequear(minA === HORAS_POR_INTEGRANTE[mes].a, `mes ${mes}: integrante A ${minA} min ≠ ${HORAS_POR_INTEGRANTE[mes].a}`);
  chequear(minB === HORAS_POR_INTEGRANTE[mes].b, `mes ${mes}: integrante B ${minB} min ≠ ${HORAS_POR_INTEGRANTE[mes].b}`);
  chequear(minA + minB === c.minutosCronograma, `mes ${mes}: minutos de cronograma ${minA + minB} ≠ ${c.minutosCronograma}`);

  // La ventana queda cubierta sin huecos: el integrante de respaldo no suma minutos.
  chequear(TURNOS.manana.fin === TURNOS.tarde.inicio, "la mañana y la tarde tienen que empalmar");
  chequear(TURNOS.mananaCorta.fin === TURNOS.tardeLarga.inicio, "la mañana corta y la tarde larga tienen que empalmar");
  chequear(TURNOS.manana.inicio === VENTANA.apertura && TURNOS.tarde.fin === VENTANA.cierre, "los turnos cubren la ventana");
  // Y ningún integrante se superpone consigo mismo: el refuerzo arranca después de su turno.
  chequear(TURNOS.refuerzo.inicio >= TURNOS.manana.fin, "el refuerzo no puede solaparse con la mañana");
  chequear(TURNOS.refuerzoCorto.inicio >= TURNOS.manana.fin, "el refuerzo corto no puede solaparse con la mañana");
}

// Horas que publica la herramienta: round(minutos / 60, 2).
const horasDe = (mes) => Math.round((CONTRATO[mes].minutosCronograma / 60) * 100) / 100;
chequear(horasDe(8) === 414, `horas de agosto ${horasDe(8)} ≠ 414`);
chequear(horasDe(9) === 405.08, `horas de septiembre ${horasDe(9)} ≠ 405,08`);

// ── Segmentación de agosto (contrato 5A/5B/5B1) ─────────────────────────────
{
  const porDia = {};
  const sumar = (f, v) => { porDia[f] = (porDia[f] ?? 0) + v; };
  for (const [f, v] of Object.entries(TURNERO_AGO)) sumar(f, v);
  for (const m of MANUALES_AGO) sumar(m.fecha, m.monto);
  for (const c of CAMPEONATOS_AGO) sumar(c.fecha, c.cantidad * PRECIO_INSCRIPCION);
  for (const r of RESERVAS_AGO) sumar(r.fecha, r.total);

  const hab = sumaSi(porDia, (f) => !esFinDeSemana(f));
  const fds = sumaSi(porDia, esFinDeSemana);
  chequear(hab === 7_680_000, `agosto hábiles ${hab} ≠ 7.680.000`);
  chequear(fds === 5_774_000, `agosto fin de semana ${fds} ≠ 5.774.000`);
  chequear(diasDe(8).filter((f) => !esFinDeSemana(f)).length === 21, "agosto no tiene 21 días hábiles");
  chequear(diasDe(8).filter(esFinDeSemana).length === 10, "agosto no tiene 10 días de fin de semana");

  // Promedios por día calendario, tal como los publica el servidor.
  const dosDec = (x) => Math.round(x * 100) / 100;
  chequear(dosDec(hab / 21) === 365_714.29, `promedio de hábiles ${dosDec(hab / 21)} ≠ 365.714,29`);
  chequear(dosDec(fds / 10) === 577_400, `promedio del fin de semana ${dosDec(fds / 10)} ≠ 577.400`);
  chequear(dosDec(13_454_000 / 31) === 434_000, `promedio del mes ${dosDec(13_454_000 / 31)} ≠ 434.000`);

  // Mejores días, con máximo ÚNICO en cada grupo (si empatara, el mejor día sería ambiguo).
  const mejor = (pred) => Object.entries(porDia).filter(([f]) => pred(f)).sort((a, b) => b[1] - a[1])[0];
  const mh = mejor((f) => !esFinDeSemana(f));
  chequear(mh[0] === "2026-08-18" && mh[1] === 1_720_000, `mejor día hábil ${mh[0]} ${mh[1]} ≠ 18/08 1.720.000`);
  const mf = mejor(esFinDeSemana);
  chequear(mf[0] === "2026-08-15" && mf[1] === 878_000, `mejor día de fin de semana ${mf[0]} ${mf[1]} ≠ 15/08 878.000`);
  for (const [nombre, pred, max] of [["hábil", (f) => !esFinDeSemana(f), 1_720_000], ["fin de semana", esFinDeSemana, 878_000]]) {
    const empates = Object.entries(porDia).filter(([f, v]) => pred(f) && v === max).length;
    chequear(empates === 1, `el mejor día ${nombre} empata (${empates} días con ${max})`);
  }

  // Desglose por fuente y grupo, incluidos los dos ceros que el servidor escribe como $0.
  const turneroHab = sumaSi(TURNERO_AGO, (f) => !esFinDeSemana(f));
  const turneroFds = sumaSi(TURNERO_AGO, esFinDeSemana);
  chequear(turneroHab === 4_690_000, `turnero hábiles ${turneroHab} ≠ 4.690.000`);
  chequear(turneroFds === 5_568_000, `turnero fin de semana ${turneroFds} ≠ 5.568.000`);
  chequear(MANUALES_AGO.every((m) => !esFinDeSemana(m.fecha)), "los manuales de agosto tienen que caer en días hábiles (fin de semana = $0)");
  const campHab = CAMPEONATOS_AGO.filter((c) => !esFinDeSemana(c.fecha)).reduce((a, c) => a + c.cantidad, 0) * PRECIO_INSCRIPCION;
  chequear(campHab === 40_000, `campeonatos hábiles ${campHab} ≠ 40.000`);
  chequear(RESERVAS_AGO.every((r) => esFinDeSemana(r.fecha)), "las reservas de agosto tienen que caer en fin de semana (hábiles = $0)");

  // Las cinco semanas hábiles de 5A.
  const SEMANAS = { "2026-08-03": 1_348_000, "2026-08-10": 1_004_000, "2026-08-17": 2_954_000, "2026-08-24": 2_242_000, "2026-08-31": 132_000 };
  const porSemana = {};
  for (const [f, v] of Object.entries(porDia)) if (!esFinDeSemana(f)) porSemana[lunesDe(f)] = (porSemana[lunesDe(f)] ?? 0) + v;
  chequear(Object.keys(porSemana).length === 5, `5A espera cinco semanas hábiles, hay ${Object.keys(porSemana).length}`);
  for (const [lunes, esperado] of Object.entries(SEMANAS)) {
    chequear(porSemana[lunes] === esperado, `semana del ${lunes}: ${porSemana[lunes]} ≠ ${esperado}`);
  }
}

// ── Comparación agosto → septiembre (contrato 5C) ───────────────────────────
{
  const dif = (a, b) => b - a;
  const varPct = (a, b) => Math.round(((b - a) / a) * 1000) / 10;
  chequear(dif(13_454_000, 10_440_000) === -3_014_000, "diferencia de facturación");
  chequear(varPct(13_454_000, 10_440_000) === -22.4, "variación de facturación ≠ −22,4 %");
  chequear(dif(912, 826) === -86, "diferencia de turnos");
  chequear(varPct(912, 826) === -9.4, "variación de turnos ≠ −9,4 %");
  const hAgo = horasDe(8), hSep = horasDe(9);
  chequear(Math.round((hSep - hAgo) * 100) / 100 === -8.92, `diferencia de horas ${hSep - hAgo} ≠ −8,92`);
  chequear(varPct(hAgo, hSep) === -2.2, "variación de horas ≠ −2,2 %");
  const deltas = { manuales: dif(2_950_000, 670_000), turnero: dif(10_258_000, 9_454_000), campeonatos: dif(120_000, 240_000), reservas: dif(126_000, 76_000) };
  chequear(deltas.manuales === -2_280_000, "delta de manuales");
  chequear(deltas.turnero === -804_000, "delta de turnero");
  chequear(deltas.campeonatos === 120_000, "delta de campeonatos");
  chequear(deltas.reservas === -50_000, "delta de reservas");
  chequear(Object.values(deltas).reduce((a, b) => a + b, 0) === -3_014_000, "los deltas por fuente no suman la diferencia total");
  // La lectura `compatible_menor_demanda` exige que la actividad caiga más que la disponibilidad.
  chequear(Math.abs(-9.4) > Math.abs(-2.2), "la lectura compatible_menor_demanda exige |actividad| > |disponibilidad|");
}

if (problemas.length) {
  console.error("\nEl escenario NO cumple el contrato numérico; no se generó nada:\n");
  for (const p of problemas) console.error("  · " + p);
  process.exit(1);
}

// ── Emisión del SQL ─────────────────────────────────────────────────────────
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const L = [];
const w = (s = "") => L.push(s);

w("-- ============================================================================");
w("-- ESCENARIO HISTÓRICO SINTÉTICO de IA SIM — familia " + MARCA);
w("-- ----------------------------------------------------------------------------");
w("-- GENERADO por scripts/pruebas/generar-historico-ia.mjs. No editar a mano: ese");
w("-- script declara los repartos y verifica TODA la aritmética del contrato antes");
w("-- de emitir. Si una suma no cierra, no genera nada.");
w("--");
w("-- Para qué: las suites servidor5a, servidor5b, servidor5b1 y servidor5c");
w("-- verificaban cifras del historial REAL de agosto y septiembre de 2026. Este");
w("-- escenario las reproduce en la base LOCAL atravesando las mismas tablas fuente");
w("-- y las mismas reglas de imputación:");
w("--   turnero      → fecha de SERVICIO (turnos_stand.fecha)");
w("--   reservas     → fecha de PAGO (reservas.created_at en hora Argentina)");
w("--   campeonatos  → fecha de PAGO (campeonato_inscripciones.created_at)");
w("--   manuales     → fecha contable (fin_movimientos.fecha + mes_contable)");
w("--   actividad    → fecha de servicio y modalidad persistida de cada fila");
w("--   cronograma   → jornadas del mes CONFIRMADO");
w("--");
w("-- No se insertan resultados: ni vistas, ni salidas de RPC, ni tablas derivadas,");
w("-- ni mensajes de IA. Los totales aparecen al ejecutar las funciones y las");
w("-- herramientas reales. scripts/pruebas/contrato-historico-ia.ts lo comprueba");
w("-- contra el motor antes de dejar correr las suites.");
w("--");
w("-- Todo sintético: sin nombres, teléfonos, correos ni IDs de pago reales. Los");
w("-- correos usan el dominio reservado @example.test.");
w("--");
w("-- Idempotente: borra su propia familia antes de insertar.");
w("-- ============================================================================");
w();
w("-- Todo en UNA transacción. La guardia de abajo es la primera sentencia: si aborta, los");
w("-- `delete` que siguen NO se ejecutan ni siquiera si psql corre sin ON_ERROR_STOP, porque");
w("-- la transacción queda abortada y el commit se vuelve un rollback.");
w("begin;");
w();
w("-- ── Guardia: esto NO se aplica a una base con datos reales ──────────────────");
w("-- Segunda barrera, independiente del runner (que ya exige un destino loopback):");
w("-- la base no puede tener historia fuera de agosto y septiembre de 2026, ni");
w("-- reservas con correos que no sean del dominio de prueba. Producción tiene las");
w("-- dos cosas, así que ahí esto aborta antes de escribir.");
w("do $guardia$");
w("begin");
w("  if exists (select 1 from public.turnos_stand where fecha < date '2026-08-01' or fecha > date '2026-09-30') then");
w("    raise exception 'FIXTURE_IA_HIST: la base tiene turnos del stand fuera de agosto y septiembre de 2026, parece una base con datos reales. El escenario histórico sintético solo se aplica a la base LOCAL de pruebas.';");
w("  end if;");
w("  if exists (select 1 from public.reservas where email is not null and email not like '%@example.test') then");
w("    raise exception 'FIXTURE_IA_HIST: la base tiene reservas con correos que no son del dominio de prueba. Abortado.';");
w("  end if;");
w("end $guardia$;");
w();
w("-- ── Limpieza idempotente de la familia ─────────────────────────────────────");
w("delete from public.campeonato_inscripciones where campeonato_id in (select id from public.campeonatos where nombre like " + q(MARCA + "%") + ");");
w("delete from public.campeonatos where nombre like " + q(MARCA + "%") + ";");
w("delete from public.reserva_slots where reserva_id in (select id from public.reservas where nombre like " + q(MARCA + "%") + ");");
w("delete from public.reservas where nombre like " + q(MARCA + "%") + ";");
w("delete from public.turnos_stand where nombre like " + q(MARCA + "%") + ";");
w("delete from public.fin_movimientos where creado_por = " + q(MARCA) + ";");
w("delete from public.cronograma_jornadas where dia_id in (select d.id from public.cronograma_dias d join public.cronograma_meses m on m.id = d.mes_id where m.anio = 2026 and m.mes in (8, 9));");
w("delete from public.cronograma_dias where mes_id in (select id from public.cronograma_meses where anio = 2026 and mes in (8, 9));");
w("delete from public.cronograma_meses where anio = 2026 and mes in (8, 9);");
w();

// ── Turnero del stand ───────────────────────────────────────────────────────
w("-- ── Turnero del stand ──────────────────────────────────────────────────────");
w("-- Dos filas por día, la forma real de una jornada: una de 15 minutos y otra de 30.");
w("-- `cantidad_turnos` expresa la cantidad del día, así el escenario son decenas de");
w("-- filas y no miles, y la fórmula legacy se cumple en cada fila:");
w("--   turnos = personas × (minutos / 15)   ·   minutos de actividad = turnos × 15");
w("-- `modalidad` legacy, la vigente en esos meses (v2_10 arrancó el 01/10/2026).");
w("insert into public.turnos_stand (nombre, fecha, hora, cantidad_turnos, cantidad_personas, cantidad_simuladores, cantidad_minutos, duracion_minutos, total, metodo_pago, estado, modalidad, observaciones) values");
{
  const filas = [];
  for (const mes of [8, 9]) {
    for (const f of FILAS[mes]) {
      for (const [bloque, hora, min] of [["q15", "15:00", 15], ["q30", "18:00", 30]]) {
        const b = f[bloque];
        if (b.turnos <= 0) continue;
        filas.push("  (" + [q(MARCA), q(f.fecha), q(hora), b.turnos, b.personas, b.personas, min, min, b.total,
          q("efectivo"), q("activo"), q("legacy"), q(MARCA + " jornada sintética de " + min + " min")].join(", ") + ")");
      }
    }
  }
  w(filas.join(",\n") + ";");
}
w();

// ── Reservas web ────────────────────────────────────────────────────────────
w("-- ── Reservas web ───────────────────────────────────────────────────────────");
w("-- Imputan por fecha de PAGO (created_at); se les da la misma fecha de servicio para");
w("-- que su actividad caiga en el mismo mes. Un simulador por reserva = una persona.");
w("insert into public.reservas (nombre, apellido, email, telefono, fecha, hora, simuladores, cantidad_turnos, duracion_minutos, total, estado, origen, acepto_condiciones, modalidad, created_at) values");
{
  const filas = [];
  let n = 0;
  for (const mes of [8, 9]) {
    for (const r of datos[mes].res) {
      n++;
      filas.push("  (" + [q(MARCA), q("Reserva " + n), q("hist-" + n + "@example.test"), q("0000000000"), q(r.fecha), q("16:00"),
        "'[\"Ferrari\"]'::jsonb", r.turnos, 15, r.total, q("activa"), q("web"), "true", q("legacy"), q(r.fecha + " 16:00:00-03")].join(", ") + ")");
    }
  }
  w(filas.join(",\n") + ";");
}
w();

// ── Campeonatos ─────────────────────────────────────────────────────────────
w("-- ── Campeonatos ────────────────────────────────────────────────────────────");
w("-- Un campeonato sintético con sus inscripciones PAGADAS, que imputan por fecha de");
w("-- pago. Sin payment_id: no se inventan identificadores de Mercado Pago.");
w("insert into public.campeonatos (nombre, estado, modalidad, precio_inscripcion, cupos_maximos, inscripcion_habilitada, fecha_inicio, fecha_fin)");
w("values (" + [q(MARCA + " campeonato"), q("finalizado"), q("liga"), PRECIO_INSCRIPCION, 64, "false", q("2026-08-01"), q("2026-09-30")].join(", ") + ");");
w();
w("insert into public.campeonato_inscripciones (campeonato_id, nombre, apellido, nombre_completo, telefono, dni, monto, estado_pago, metodo_pago, created_at)");
w("select c.id, " + q(MARCA) + ", v.apellido, " + q(MARCA) + " || ' ' || v.apellido, '0000000000', '', " + PRECIO_INSCRIPCION + ", 'pagado', 'mercadopago', v.pago");
w("from public.campeonatos c, (values");
{
  const filas = [];
  let n = 0;
  for (const mes of [8, 9]) {
    for (const g of datos[mes].camp) {
      for (let i = 0; i < g.cantidad; i++) {
        n++;
        filas.push("  (" + q("Piloto sintetico " + n) + ", " + q(g.fecha + " 12:00:00-03") + "::timestamptz)");
      }
    }
  }
  w(filas.join(",\n"));
}
w(") as v(apellido, pago)");
w("where c.nombre = " + q(MARCA + " campeonato") + ";");
w();

// ── Ingresos manuales ───────────────────────────────────────────────────────
w("-- ── Ingresos manuales ──────────────────────────────────────────────────────");
w("-- tipo ingreso, sin financiamiento y sin ajuste inicial: así los toma la composición");
w("-- canónica, imputados por mes contable.");
w("insert into public.fin_movimientos (fecha, mes_contable, ambito, tipo, clasificacion, cuenta_origen_id, categoria_id, descripcion, monto, origen, creado_por)");
w("select v.fecha::date, v.mes, 'sim', 'ingreso', 'ingreso',");
w("       (select id from public.fin_cuentas where nombre = 'Mercado Pago' limit 1),");
w("       (select id from public.fin_categorias where tipo = 'ingreso' order by nombre limit 1),");
w("       v.detalle, v.monto, 'manual', " + q(MARCA));
w("from (values");
{
  const filas = [];
  for (const mes of [8, 9]) {
    for (const m of datos[mes].manuales) {
      filas.push("  (" + [q(m.fecha), q(m.fecha.slice(0, 7)), q(MARCA + " " + m.detalle), m.monto].join(", ") + ")");
    }
  }
  w(filas.join(",\n"));
}
w(") as v(fecha, mes, detalle, monto);");
w();

// ── Cronograma ──────────────────────────────────────────────────────────────
w("-- ── Cronograma confirmado ──────────────────────────────────────────────────");
w("-- Cada día abierto con una jornada que cubre toda la ventana operativa, así no quedan");
w("-- huecos y el integrante de respaldo no suma minutos; algunos días llevan una segunda");
w("-- jornada de tarde de otro integrante. Los integrantes se eligen por orden de nombre,");
w("-- no por UUID: la configuración base del repositorio crea los tres.");
w("insert into public.cronograma_meses (anio, mes, estado, apertura_default, cierre_default, confirmado_at) values");
w("  (2026, 8, 'confirmado', " + q(VENTANA.apertura) + ", " + q(VENTANA.cierre) + ", '2026-07-31 12:00:00-03'),");
w("  (2026, 9, 'confirmado', " + q(VENTANA.apertura) + ", " + q(VENTANA.cierre) + ", '2026-08-31 12:00:00-03');");
w();
w("insert into public.cronograma_dias (mes_id, fecha, cerrado, apertura, cierre)");
w("select m.id, v.fecha::date, false, " + q(VENTANA.apertura) + ", " + q(VENTANA.cierre));
w("from public.cronograma_meses m, (values");
{
  const filas = [];
  for (const mes of [8, 9]) for (const f of diasDe(mes)) filas.push("  (" + q(f) + ", " + mes + ")");
  w(filas.join(",\n"));
}
w(") as v(fecha, mes)");
w("where m.anio = 2026 and m.mes = v.mes;");
w();
// Las jornadas se emiten como una sola lista (fecha, integrante, inicio, fin): es más
// legible que cuatro inserts condicionales y deja ver el reparto de un vistazo.
{
  const A = "(select id from public.empleados where es_fallback = false and activo order by nombre_formal asc limit 1)";
  const B = "(select id from public.empleados where es_fallback = false and activo order by nombre_formal desc limit 1)";
  const jornadas = [];
  for (const mes of [8, 9]) {
    const cr = CRONOGRAMA[mes];
    for (const f of diasDe(mes)) {
      const corta = cr.cortas.includes(f);
      jornadas.push([f, "a", corta ? TURNOS.mananaCorta : TURNOS.manana]);
      jornadas.push([f, "b", corta ? TURNOS.tardeLarga : TURNOS.tarde]);
      if (cr.refuerzos.includes(f)) jornadas.push([f, "a", TURNOS.refuerzo]);
      if (cr.refuerzoCorto === f) jornadas.push([f, "a", TURNOS.refuerzoCorto]);
    }
  }
  w("-- Jornadas. El integrante A toma la mañana y vuelve de refuerzo algunas tardes; el B");
  w("-- cubre la tarde. Entre los dos cierran la ventana sin huecos, así el de respaldo suma");
  w("-- 0 minutos. Se eligen por orden de nombre, no por UUID: los crea la configuración base.");
  w("--   agosto      → A " + HORAS_POR_INTEGRANTE[8].a + " min (" + (HORAS_POR_INTEGRANTE[8].a / 60) + " h)  ·  B " + HORAS_POR_INTEGRANTE[8].b + " min (" + (HORAS_POR_INTEGRANTE[8].b / 60) + " h)");
  w("--   septiembre  → A " + HORAS_POR_INTEGRANTE[9].a + " min  ·  B " + HORAS_POR_INTEGRANTE[9].b + " min");
  w("insert into public.cronograma_jornadas (dia_id, empleado_id, hora_inicio, hora_fin, activo)");
  w("select d.id, case v.quien when 'a' then " + A + " else " + B + " end, v.inicio::time, v.fin::time, true");
  w("from public.cronograma_dias d, (values");
  w(jornadas.map(([f, quien, t]) => "  (" + [q(f), q(quien), q(t.inicio), q(t.fin)].join(", ") + ")").join(",\n"));
  w(") as v(fecha, quien, inicio, fin)");
  w("where d.fecha = v.fecha::date;");
}
w();
w("commit;");
w();

writeFileSync(ARCHIVO, L.join("\n") + "\n");

const nStand = [8, 9].reduce((a, m) => a + FILAS[m].reduce((x, f) => x + (f.q15.turnos > 0 ? 1 : 0) + (f.q30.turnos > 0 ? 1 : 0), 0), 0);
const nInsc = [8, 9].reduce((a, m) => a + datos[m].camp.reduce((x, g) => x + g.cantidad, 0), 0);
const nJor = 61 * 2 + CRONOGRAMA[8].refuerzos.length + CRONOGRAMA[9].refuerzos.length + 1;
console.log(ARCHIVO + " generado. Contrato numérico verificado, sin problemas.");
console.log("  turnos_stand " + nStand + " · reservas 6 · campeonatos 1 + " + nInsc + " inscripciones · fin_movimientos 4");
console.log("  cronograma: 2 meses · 61 días · " + nJor + " jornadas");
for (const mes of [8, 9]) {
  const c = CONTRATO[mes];
  console.log("  2026-0" + mes + ": $" + c.total.toLocaleString("es-AR") + " · " + c.turnos + " turnos · " + c.personas + " personas · " + c.minutos + " min actividad · " + horasDe(mes) + " h cronograma");
}
