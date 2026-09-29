import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MINUTOS_DIA, bloquesLegacy, duracionValida, horaDeMinutos, iniciosDelDia, minutosDeHora,
  reglasDiaV2, seSuperponen, turnoOcupacion, turnoPara, type Intervalo, type ProductoAgenda,
} from "@/lib/agendaIntervalos";
import { bloquesDeAgendaPara, horariosPosiblesPara, sumarDias, type Producto } from "@/lib/agenda";
import { duracionesPermitidas, pasoAgendaMin, type ProductoComercial } from "@/lib/catalogoComercial";

// Agenda por intervalos (Bloque B2). Puro: no toca la base ni el reloj.
// Ejecutar: npx tsx lib/agendaIntervalos.test.ts
//
// Tests A–K de ocupación y solapamiento (J y K, que necesitan recursos, están
// en lib/disponibilidadIntervalos.test.ts), la grilla v2 y la equivalencia de
// la grilla legacy con la agenda actual.

const HABIL = "2026-10-05";       // lunes
const SABADO = "2026-10-03";
const DOMINGO = "2026-10-04";
const h = (m: number) => horaDeMinutos(m);
const iv = (desde: number, hasta: number): Intervalo => ({ desde, hasta });

// ── A–G · Duración comercial vs. ocupación ──────────────────────────────────
{
  const casos: Array<[string, "legacy" | "v2_10", number, number]> = [
    ["A · v2 10 → ocupa 20", "v2_10", 10, 20],
    ["B · v2 20 → ocupa 30", "v2_10", 20, 30],
    ["C · v2 30 → ocupa 40", "v2_10", 30, 40],
    ["D · legacy 15 → ocupa 20", "legacy", 15, 20],
    ["E · legacy 30 → ocupa 40", "legacy", 30, 40],
    ["F · legacy 45 → ocupa 60", "legacy", 45, 60],
    ["G · legacy 60 → ocupa 80", "legacy", 60, 80],
  ];
  for (const [nombre, modalidad, duracion, ocupacion] of casos) {
    const t = turnoOcupacion(modalidad, "12:00", duracion);
    assert.ok(t, nombre);
    assert.equal(t.duracion, duracion, `${nombre}: duración comercial`);
    assert.equal(t.ocupacion, ocupacion, nombre);
    assert.equal(t.buffer, ocupacion - duracion, `${nombre}: buffer`);
    assert.equal(t.finComercial, 12 * 60 + duracion, `${nombre}: fin comercial`);
    assert.equal(t.finOcupacion, 12 * 60 + ocupacion, `${nombre}: fin de ocupación`);
    assert.deepEqual(t.intervalo, iv(12 * 60, 12 * 60 + ocupacion), `${nombre}: [inicio, finOcupacion)`);
    // El buffer nunca es parte de lo vendido.
    assert.ok(t.finComercial < t.finOcupacion, `${nombre}: el buffer va después del tiempo comercial`);
  }
  // v2: siempre duración + 10.
  for (const d of duracionesPermitidas("v2_10", "reserva")) {
    assert.equal(turnoOcupacion("v2_10", "10:00", d)!.buffer, 10, `v2 ${d}: buffer 10`);
  }
  // Duraciones que la modalidad no sabe ocupar, horas ilegibles.
  assert.equal(turnoOcupacion("legacy", "12:00", 10), null, "legacy no ocupa 10");
  assert.equal(turnoOcupacion("legacy", "12:00", 20), null, "legacy no ocupa 20");
  assert.equal(turnoOcupacion("v2_10", "12:00", 7), null, "v2 no ocupa 7");
  for (const mala of ["9:00", "24:00", "12:5", "12:60", "", " 12:00", "12:00:00", null, 1200]) {
    assert.equal(turnoOcupacion("v2_10", mala, 10), null, `hora ilegible ${JSON.stringify(mala)}`);
  }
}

// ── Horas ───────────────────────────────────────────────────────────────────
{
  assert.equal(minutosDeHora("00:00"), 0);
  assert.equal(minutosDeHora("21:50"), 1310);
  assert.equal(minutosDeHora("23:59"), MINUTOS_DIA - 1);
  for (let m = 0; m < MINUTOS_DIA; m++) assert.equal(minutosDeHora(h(m)), m, `ida y vuelta ${m}`);
  assert.equal(h(22 * 60 + 10), "22:10");
  assert.equal(h(MINUTOS_DIA + 10), "24:10", "un fin de ocupación después de medianoche se ve igual");
}

// ── H–I · Solapamiento semiabierto ──────────────────────────────────────────
{
  const [m12, m1220, m1230, m1250, m13] = [720, 740, 750, 770, 780];
  assert.equal(seSuperponen(iv(m12, m1230), iv(m1230, m13)), false, "H · 12:00–12:30 y 12:30–13:00 no se tocan");
  assert.equal(seSuperponen(iv(m1230, m13), iv(m12, m1230)), false, "H · en el otro orden tampoco");
  assert.equal(seSuperponen(iv(m12, m1230), iv(m1220, m1250)), true, "12:00–12:30 y 12:20–12:50 sí");
  assert.equal(seSuperponen(iv(m12, m1230), iv(m1230 - 1, m13)), true, "I · un minuto en común alcanza");
  assert.equal(seSuperponen(iv(m12, m1230), iv(m12, m1230)), true, "el mismo intervalo");
  assert.equal(seSuperponen(iv(m12, m13), iv(m1220, m1230)), true, "uno adentro del otro");
  assert.equal(seSuperponen(iv(m12, m12), iv(m12 - 10, m12 + 10)), false, "un intervalo vacío no pisa nada");

  // Exhaustivo contra la definición: comparten algún minuto.
  const minutos = (i: Intervalo) => new Set(Array.from({ length: Math.max(0, i.hasta - i.desde) }, (_, k) => i.desde + k));
  let n = 0;
  for (let a0 = 0; a0 <= 8; a0++) for (let a1 = a0; a1 <= 8; a1++) {
    for (let b0 = 0; b0 <= 8; b0++) for (let b1 = b0; b1 <= 8; b1++) {
      const A = iv(a0, a1), B = iv(b0, b1);
      const esperado = [...minutos(A)].some((m) => minutos(B).has(m));
      assert.equal(seSuperponen(A, B), esperado, `[${a0},${a1}) vs [${b0},${b1})`);
      assert.equal(seSuperponen(A, B), seSuperponen(B, A), "simétrico");
      n++;
    }
  }
  assert.equal(n, 2025, "se probaron todos los pares");
}

// ── Grilla v2 ───────────────────────────────────────────────────────────────
{
  const soloHoras = (modalidad: "v2_10", producto: ProductoAgenda, fecha: string, d: number) =>
    iniciosDelDia({ modalidad, producto, fecha, duracion: d }).map((t) => t.hora);

  // Lunes a viernes: el tiempo COMERCIAL termina a las 22:00 como máximo.
  const ultimoLV: Record<number, string> = { 10: "21:50", 20: "21:40", 30: "21:30" };
  for (const d of duracionesPermitidas("v2_10", "reserva")) {
    const horas = soloHoras("v2_10", "reserva", HABIL, d);
    assert.equal(horas[0], "10:00", `L-V ${d}: primer inicio 10:00`);
    assert.equal(horas[horas.length - 1], ultimoLV[d], `L-V ${d}: último inicio ${ultimoLV[d]}`);
    for (let i = 1; i < horas.length; i++) {
      assert.equal(minutosDeHora(horas[i])! - minutosDeHora(horas[i - 1])!, 10, `L-V ${d}: paso de 10`);
    }
    const ultimo = turnoPara({ modalidad: "v2_10", producto: "reserva", fecha: HABIL, hora: ultimoLV[d], duracion: d })!;
    assert.equal(h(ultimo.finComercial), "22:00", `L-V ${d}: fin comercial 22:00`);
    assert.equal(h(ultimo.finOcupacion), "22:10", `L-V ${d}: el buffer sigue hasta 22:10`);
    const siguiente = h(minutosDeHora(ultimoLV[d])! + 10);
    assert.equal(turnoPara({ modalidad: "v2_10", producto: "reserva", fecha: HABIL, hora: siguiente, duracion: d }), null,
      `L-V ${d}: ${siguiente} ya no entra (terminaría después de las 22:00)`);
  }
  assert.equal(soloHoras("v2_10", "reserva", HABIL, 10).length, 72);
  assert.equal(soloHoras("v2_10", "reserva", HABIL, 20).length, 71);
  assert.equal(soloHoras("v2_10", "reserva", HABIL, 30).length, 70);

  // Sábado y domingo: último INICIO 14:00 para cualquier duración.
  const finFinde: Record<number, string> = { 10: "14:20", 20: "14:30", 30: "14:40" };
  for (const fecha of [SABADO, DOMINGO]) {
    for (const d of duracionesPermitidas("v2_10", "reserva")) {
      const horas = soloHoras("v2_10", "reserva", fecha, d);
      assert.equal(horas[0], "10:00", `${fecha} ${d}: primer inicio`);
      assert.equal(horas[horas.length - 1], "14:00", `${fecha} ${d}: último inicio 14:00`);
      assert.equal(horas.length, 25, `${fecha} ${d}: de 10:00 a 14:00 cada 10`);
      const t = turnoPara({ modalidad: "v2_10", producto: "reserva", fecha, hora: "14:00", duracion: d })!;
      assert.equal(h(t.finOcupacion), finFinde[d], `${fecha} ${d} a las 14:00 ocupa hasta ${finFinde[d]}`);
      assert.equal(turnoPara({ modalidad: "v2_10", producto: "reserva", fecha, hora: "14:10", duracion: d }), null,
        `${fecha} ${d}: 14:10 no es un inicio (ocupar no es poder empezar)`);
    }
  }

  // La grilla es la misma para todo lo que vende v2.
  for (const producto of ["mensualidad", "gift_card"] as const) {
    for (const d of duracionesPermitidas("v2_10", producto)) {
      for (const fecha of [HABIL, SABADO]) {
        assert.deepEqual(soloHoras("v2_10", producto, fecha, d), soloHoras("v2_10", "reserva", fecha, d),
          `${producto} ${d} en ${fecha}: misma grilla que Reservas`);
      }
    }
  }

  // Inicios fuera de la red de 10, antes de abrir, duraciones que v2 no vende.
  for (const hora of ["10:05", "09:50", "12:15"]) {
    assert.equal(turnoPara({ modalidad: "v2_10", producto: "reserva", fecha: HABIL, hora, duracion: 10 }), null, hora);
  }
  for (const [producto, d] of [["reserva", 15], ["reserva", 45], ["mensualidad", 60], ["gift_card", 15]] as const) {
    assert.equal(iniciosDelDia({ modalidad: "v2_10", producto, fecha: HABIL, duracion: d }).length, 0, `v2 no vende ${producto} ${d}`);
  }
  // Empresa: la duración de la campaña, con la grilla v2. Una campaña legacy
  // de 15 canjeada en v2 ocupa 25.
  const emp = turnoPara({ modalidad: "v2_10", producto: "empresa", fecha: HABIL, hora: "12:00", duracion: 15 })!;
  assert.equal(emp.ocupacion, 25);
  assert.equal(soloHoras("v2_10", "empresa", HABIL, 15).at(-1), "21:40", "15 de campaña: termina 21:55");
  assert.equal(soloHoras("v2_10", "empresa", HABIL, 7).length, 0, "7 no es múltiplo de 5");

  assert.deepEqual(reglasDiaV2(HABIL), { apertura: 600, paso: 10, limite: { tipo: "cierre", minuto: 1320 } });
  assert.deepEqual(reglasDiaV2(SABADO), { apertura: 600, paso: 10, limite: { tipo: "ultimoInicio", minuto: 840 } });
  assert.equal(reglasDiaV2("2026-02-31"), null);
  assert.deepEqual(iniciosDelDia({ modalidad: "v2_10", producto: "reserva", fecha: "2026-13-01", duracion: 10 }), []);
}

// ── Grilla legacy = agenda actual, en todas las fechas ──────────────────────
// Para cada día de sep-2026 a dic-2027 y cada producto/duración, los inicios
// del motor nuevo en modo legacy son EXACTAMENTE los de horariosPosiblesPara,
// y los bloques que cubre cada turno son los de bloquesDeAgendaPara.
{
  const productos: Array<[ProductoComercial, Producto]> = [
    ["reserva", "reserva"], ["gift_card", "reserva"], ["mensualidad", "mensualidad"],
  ];
  let dias = 0, turnos = 0;
  for (let fecha = "2026-09-01"; fecha <= "2027-12-31"; fecha = sumarDias(fecha, 1)) {
    dias++;
    for (const [producto, deAgenda] of productos) {
      for (const d of duracionesPermitidas("legacy", producto)) {
        const nuevos = iniciosDelDia({ modalidad: "legacy", producto, fecha, duracion: d });
        assert.deepEqual(nuevos.map((t) => t.hora), horariosPosiblesPara(deAgenda, fecha, d),
          `legacy ${producto} ${d} en ${fecha}: mismos inicios que la agenda actual`);
        for (const t of nuevos) {
          const bloques = bloquesDeAgendaPara(deAgenda, fecha, t.hora, d)!;
          assert.deepEqual(bloquesLegacy(t), bloques, `${fecha} ${t.hora} ${d}: mismos bloques`);
          assert.equal(t.ocupacion, bloques.length * pasoAgendaMin("legacy"));
          turnos++;
        }
      }
    }
    // Empresa legacy con 15/30: exactamente Reservas.
    for (const d of [15, 30]) {
      assert.deepEqual(
        iniciosDelDia({ modalidad: "legacy", producto: "empresa", fecha, duracion: d }).map((t) => t.hora),
        horariosPosiblesPara("reserva", fecha, d), `empresa legacy ${d} en ${fecha}`);
    }
  }
  assert.equal(dias, 487);
  assert.ok(turnos > 40_000, `${turnos} turnos legacy comparados`);

  // Lo que la agenda actual ya hacía y el motor nuevo no toca:
  const horas = (producto: ProductoAgenda, fecha: string, d: number) =>
    iniciosDelDia({ modalidad: "legacy", producto, fecha, duracion: d }).map((t) => t.hora);
  assert.equal(horas("reserva", HABIL, 15).at(-1), "21:40");
  assert.equal(horas("reserva", HABIL, 30).at(-1), "21:20");
  assert.equal(horas("reserva", SABADO, 15).at(-1), "14:00");
  assert.equal(horas("reserva", SABADO, 30).at(-1), "13:40", "legacy: un 30 no empieza 14:00 el sábado");
  assert.equal(horas("mensualidad", SABADO, 60).at(-1), "14:00", "Mensualidad: 14:00 de 60 el sábado");
  assert.equal(h(turnoPara({ modalidad: "legacy", producto: "mensualidad", fecha: SABADO, hora: "14:00", duracion: 60 })!.finOcupacion), "15:20");
  assert.equal(horas("mensualidad", HABIL, 60).at(-1), "20:40");
  assert.equal(horas("mensualidad", HABIL, 45).at(-1), "21:00");
  // legacy no vende 10 ni 20; Reservas no vende 45.
  assert.deepEqual(horas("reserva", HABIL, 10), []);
  assert.deepEqual(horas("reserva", HABIL, 20), []);
  assert.deepEqual(horas("reserva", HABIL, 45), []);
  assert.equal(duracionValida("legacy", "empresa", 45), true, "empresa legacy: cualquier duración que legacy sepa ocupar");
  assert.equal(duracionValida("legacy", "empresa", 10), false);
}

// ── El motor no hardcodea duraciones ni mira el reloj ──────────────────────
{
  const sinComentarios = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const MOTOR = ["lib/agendaIntervalos.ts", "lib/disponibilidadIntervalos.ts", "lib/disponibilidadIntervalosServer.ts"];
  for (const f of MOTOR) {
    const codigo = sinComentarios(readFileSync(join(process.cwd(), f), "utf8"));
    for (const linea of codigo.split("\n")) {
      if (/const MINUTOS_POR_HORA = 60;/.test(linea)) continue;
      assert.ok(!/\b(10|15|20|30|45|60)\b/.test(linea), `${f}: duración escrita a mano → ${linea.trim()}`);
    }
    assert.ok(!/Date\.now\(|new Date\(\s*\)/.test(codigo), `${f}: el motor recibe \`ahora\`, no lee el reloj`);
    assert.ok(!codigo.includes("@/lib/modalidadComercial\""), `${f}: el motor no resuelve la modalidad`);
  }
  // Los dos módulos puros no tocan la base.
  for (const f of ["lib/agendaIntervalos.ts", "lib/disponibilidadIntervalos.ts"]) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(!src.includes("supabase") && !src.includes("@/lib/disponibilidad\""), `${f}: puro`);
  }
}

console.log("OK — agendaIntervalos: ocupación A–G, solapamiento semiabierto, grilla v2 y grilla legacy idéntica a la actual.");
