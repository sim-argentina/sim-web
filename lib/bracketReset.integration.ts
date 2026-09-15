import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  reiniciarCampeonato, obtenerEstado, cerrarClasificacion, generarBracket,
  guardarQuali, iniciarCarrera, guardarResultadoCarrera, finalizarCarrera,
  generarSiguienteRonda, finalizarTorneo, reabrirClasificacion,
  CONFIRMACION_REINICIO,
} from "@/lib/bracketServer";
import { estadoPublicoBracket } from "@/lib/bracketPublic";

// Integración del REINICIO de campeonato contra la DB REAL, con campeonatos e
// inscripciones TEMPORALES que se ELIMINAN al final.
//
// NUNCA se toca el Duelo real ni ningún campeonato de producción: todo ocurre
// sobre campeonatos marcados "zzrst_*" creados y borrados por este archivo.
//
// Ejecutar:
//   npx tsx --env-file=.env.local lib/bracketReset.integration.ts

const MARCA = `zzrst_${Date.now()}`;
const creados = { campeonatos: [] as string[] };

const CONFIG = {
  hora: "10:20",
  presentacion: { hora_inicio: "10:20" },
  requiere_escuderia: false,
  clasificacion: { tipo: "lanzadas", vueltas: 3, criterio: "mejor_vuelta_valida" },
  eliminatoria: { pilotos_por_carrera: 4, vueltas: 5, avanzan: 2, final_pilotos: 4 },
  inscripcion: {
    campos: {
      nombre: "required", apellido: "required", telefono: "required",
      dni: "hidden", instagram: "hidden", escuderia: "hidden",
      categoria: "hidden", mejor_tiempo: "hidden", monto: "hidden",
    },
  },
};

type Estado = {
  bracket: { id: string | null; estado: string; podio: unknown[] | null };
  participantes: Array<{ inscripcion_id: string; nombre: string; seed: number | null; mejor_ms: number | null; persistido?: boolean }>;
  rondas: Array<{ id: string; numero: number; carreras: Array<{ id: string; estado: string; es_bye: boolean; participantes: Array<{ id: string; inscripcion_id: string }> }> }>;
};

async function crearCampeonato(nombre: string) {
  const { data, error } = await supabaseAdmin
    .from("campeonatos")
    .insert({
      nombre: `${MARCA} ${nombre}`, estado: "activo", modalidad: "eliminacion",
      permite_pago_stand: false, precio_inscripcion: 20000, cupos_maximos: 32,
      inscripcion_habilitada: true, fecha_inicio: "2026-09-19", fecha_fin: "2026-09-19",
      config: CONFIG,
    })
    .select("id").single();
  if (error || !data) throw new Error(`crearCampeonato: ${error?.message}`);
  creados.campeonatos.push(data.id);
  return data.id as string;
}

// Inscripciones PAGADAS (las únicas válidas para el bracket).
async function inscribir(campeonatoId: string, n: number) {
  const filas = Array.from({ length: n }, (_, i) => ({
    campeonato_id: campeonatoId,
    nombre: "Zz", apellido: `Piloto${i + 1}`, nombre_completo: `Zz Piloto${i + 1}`,
    telefono: `351500${String(i).padStart(4, "0")}`, dni: "",
    monto: 20000, estado_pago: "pagado", metodo_pago: "mercadopago",
    payment_id: `zzrstpay_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
  }));
  const { data, error } = await supabaseAdmin
    .from("campeonato_inscripciones").insert(filas).select("id, payment_id, estado_pago, monto, eliminada_at, created_at");
  if (error || !data) throw new Error(`inscribir: ${error?.message}`);
  return data;
}

const estadoDe = async (id: string): Promise<Estado> => {
  const r = await obtenerEstado(id);
  assert.ok(r.ok, "obtenerEstado falló");
  return r.data as Estado;
};

// Conteo directo de las 5 tablas deportivas del campeonato.
async function conteos(campeonatoId: string) {
  const { data: br } = await supabaseAdmin
    .from("campeonato_bracket").select("id").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return { bracket: 0, participantes: 0, rondas: 0, carreras: 0, carrera_participantes: 0 };
  const [p, r, c, cp] = await Promise.all([
    supabaseAdmin.from("campeonato_bracket_participantes").select("id", { count: "exact", head: true }).eq("bracket_id", br.id),
    supabaseAdmin.from("campeonato_bracket_rondas").select("id", { count: "exact", head: true }).eq("bracket_id", br.id),
    supabaseAdmin.from("campeonato_bracket_carreras").select("id", { count: "exact", head: true }).eq("bracket_id", br.id),
    supabaseAdmin.from("campeonato_bracket_carrera_participantes").select("id", { count: "exact", head: true }).eq("bracket_id", br.id),
  ]);
  return {
    bracket: 1,
    participantes: p.count ?? 0, rondas: r.count ?? 0,
    carreras: c.count ?? 0, carrera_participantes: cp.count ?? 0,
  };
}

// Foto exacta de las inscripciones, para comparar antes/después del reset.
async function fotoInscripciones(campeonatoId: string) {
  const { data } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id, nombre, apellido, nombre_completo, telefono, monto, estado_pago, metodo_pago, payment_id, preference_id, eliminada_at, created_at")
    .eq("campeonato_id", campeonatoId)
    .order("created_at", { ascending: true });
  return JSON.stringify(data ?? []);
}

// Deja el campeonato EN CERO y verifica el invariante completo del estado limpio.
async function verificarEnCero(campeonatoId: string, etiqueta: string) {
  const c = await conteos(campeonatoId);
  // La fila raíz vuelve a existir, pero limpia; todo lo deportivo cuelga de ella y
  // quedó en cero.
  assert.deepEqual(
    { participantes: c.participantes, rondas: c.rondas, carreras: c.carreras, carrera_participantes: c.carrera_participantes },
    { participantes: 0, rondas: 0, carreras: 0, carrera_participantes: 0 },
    `${etiqueta}: deberían quedar 0 filas deportivas`,
  );
  const e = await estadoDe(campeonatoId);
  assert.equal(e.bracket.estado, "clasificacion", `${etiqueta}: clasificación abierta`);
  assert.equal(e.bracket.podio, null, `${etiqueta}: sin podio`);
  const { data: brRow } = await supabaseAdmin
    .from("campeonato_bracket").select("cerrada_at, generado_at, finalizado_at")
    .eq("campeonato_id", campeonatoId).maybeSingle();
  assert.equal(brRow?.cerrada_at, null, `${etiqueta}: sin cerrada_at`);
  assert.equal(brRow?.generado_at, null, `${etiqueta}: sin generado_at`);
  assert.equal(brRow?.finalizado_at, null, `${etiqueta}: sin finalizado_at`);
  assert.equal(e.rondas.length, 0, `${etiqueta}: sin rondas`);
  assert.ok(e.participantes.every((p) => p.seed == null), `${etiqueta}: sin seeds`);
  assert.ok(e.participantes.every((p) => p.mejor_ms == null), `${etiqueta}: sin mejores tiempos`);
  assert.ok(e.participantes.every((p) => p.persistido === false), `${etiqueta}: sin filas deportivas heredadas`);
  // El público tampoco muestra nada viejo.
  const pub = await estadoPublicoBracket(campeonatoId);
  assert.ok(pub.ok, `${etiqueta}: el público responde`);
  assert.equal(pub.estado, "clasificacion", `${etiqueta}: público en clasificación abierta`);
  const dp = pub.data as {
    aplica: boolean; rondas: unknown[]; final: unknown; podio: unknown;
    clasificacion: { oficial: unknown };
  };
  assert.equal(dp.aplica, true);
  assert.equal(dp.rondas.length, 0, `${etiqueta}: público sin rondas`);
  assert.equal(dp.final, null, `${etiqueta}: público sin final`);
  assert.equal(dp.podio, null, `${etiqueta}: público sin podio`);
  assert.equal(dp.clasificacion.oficial, null, `${etiqueta}: público sin seeds oficiales`);
}

const reset = (id: string) => reiniciarCampeonato(id, CONFIRMACION_REINICIO);

async function limpiar() {
  for (const id of creados.campeonatos) {
    await supabaseAdmin.from("campeonato_bracket").delete().eq("campeonato_id", id);
    await supabaseAdmin.from("campeonato_inscripciones").delete().eq("campeonato_id", id);
    await supabaseAdmin.from("campeonatos").delete().eq("id", id);
  }
}

// Lleva un campeonato hasta tener la Ronda 1 generada (clasificación cerrada + bracket).
async function hastaBracketGenerado(pilotos: number) {
  const id = await crearCampeonato(`c${pilotos}`);
  const inscs = await inscribir(id, pilotos);
  for (let i = 0; i < inscs.length; i++) {
    const r = await guardarQuali(id, inscs[i].id, { presente: true, mejor_ms: 90_000 + i * 250 });
    assert.ok(r.ok, "guardarQuali falló");
  }
  assert.ok((await cerrarClasificacion(id)).ok);
  assert.ok((await generarBracket(id)).ok);
  return { id, inscs };
}

async function main() {
  // ── TEST A · campeonato sin bracket ───────────────────────────────────────
  const a = await crearCampeonato("A");
  await inscribir(a, 4);
  assert.deepEqual(await conteos(a), { bracket: 0, participantes: 0, rondas: 0, carreras: 0, carrera_participantes: 0 });
  const rA = await reset(a);
  assert.ok(rA.ok);
  assert.equal(rA.data.resultado, "ya_en_cero", "TEST A: idempotente, sin error");
  await verificarEnCero(a, "TEST A");
  // Y sigue operativo: se puede cerrar la clasificación después del reset.
  assert.ok((await cerrarClasificacion(a)).ok, "TEST A: sigue operativo");
  console.log("TEST A (sin bracket) OK");

  // ── TEST B · clasificación cerrada con tiempos y seeds ────────────────────
  const b = await crearCampeonato("B");
  const inscsB = await inscribir(b, 8);
  for (let i = 0; i < inscsB.length; i++) {
    await guardarQuali(b, inscsB[i].id, { presente: true, mejor_ms: 91_000 + i * 300 });
  }
  assert.ok((await cerrarClasificacion(b)).ok);
  const eB = await estadoDe(b);
  assert.equal(eB.bracket.estado, "cerrada");
  assert.ok(eB.participantes.some((p) => p.seed != null), "TEST B: había seeds");
  assert.ok(eB.participantes.some((p) => p.mejor_ms != null), "TEST B: había tiempos");
  const rB = await reset(b);
  assert.ok(rB.ok);
  assert.equal(rB.data.resultado, "reiniciado");
  assert.equal(rB.data.estado_previo, "cerrada");
  assert.equal(rB.data.participantes, 8);
  await verificarEnCero(b, "TEST B");
  console.log("TEST B (clasificación cerrada) OK");

  // ── TEST C · bracket generado, ninguna carrera iniciada ───────────────────
  const { id: c } = await hastaBracketGenerado(8);
  const eC = await estadoDe(c);
  assert.ok(eC.rondas.length > 0, "TEST C: había ronda 1");
  assert.ok(eC.rondas[0].carreras.every((x) => x.estado === "pendiente"));
  const rC = await reset(c);
  assert.ok(rC.ok);
  assert.ok(rC.data.rondas > 0 && rC.data.carreras > 0);
  await verificarEnCero(c, "TEST C");
  console.log("TEST C (bracket generado) OK");

  // ── TEST D · carreras EN CURSO (la reapertura normal está bloqueada) ──────
  const { id: d } = await hastaBracketGenerado(8);
  const eD = await estadoDe(d);
  const carreraD = eD.rondas[0].carreras.find((x) => !x.es_bye)!;
  assert.ok((await iniciarCarrera(d, carreraD.id)).ok);
  // La protección de "Reabrir clasificación" SIGUE vigente.
  const reabrirD = await reabrirClasificacion(d);
  assert.equal(reabrirD.ok, false, "TEST D: reabrir debe seguir bloqueado");
  assert.equal((reabrirD as { status: number }).status, 409);
  assert.match((reabrirD as { error: string }).error, /ya hay carreras iniciadas/);
  // El reinicio, en cambio, sí puede.
  const rD = await reset(d);
  assert.ok(rD.ok, "TEST D: el reinicio sí procede con carreras en curso");
  assert.equal(rD.data.estado_previo, "en_curso");
  await verificarEnCero(d, "TEST D");
  console.log("TEST D (carreras en curso) OK");

  // ── TEST E · carreras FINALIZADAS con clasificados y avance ──────────────
  const { id: e } = await hastaBracketGenerado(8);
  const eE = await estadoDe(e);
  for (const carrera of eE.rondas[0].carreras.filter((x) => !x.es_bye)) {
    assert.ok((await iniciarCarrera(e, carrera.id)).ok);
    const resultado = carrera.participantes.map((p, i) => ({
      participante_id: p.id, posicion_final: i + 1, estado: "activo", observacion: null,
    }));
    assert.ok((await guardarResultadoCarrera(e, carrera.id, resultado)).ok);
    assert.ok((await finalizarCarrera(e, carrera.id)).ok);
  }
  // Avanza a la ronda siguiente: hay clasificados persistidos.
  const trasRonda1 = await estadoDe(e);
  const sig = await generarSiguienteRonda(e, trasRonda1.rondas[0].id);
  assert.ok(sig.ok, "TEST E: se generó la ronda siguiente");
  const antesE = await conteos(e);
  assert.ok(antesE.rondas >= 2 && antesE.carrera_participantes > 0);
  const rE = await reset(e);
  assert.ok(rE.ok);
  assert.ok(rE.data.carrera_participantes > 0, "TEST E: había resultados persistidos");
  await verificarEnCero(e, "TEST E");
  console.log("TEST E (carreras finalizadas y avances) OK");

  // ── TEST F · torneo FINALIZADO con podio ─────────────────────────────────
  const { id: f } = await hastaBracketGenerado(4); // una sola carrera = Gran Final
  const eF = await estadoDe(f);
  for (const carrera of eF.rondas[0].carreras.filter((x) => !x.es_bye)) {
    await iniciarCarrera(f, carrera.id);
    await guardarResultadoCarrera(f, carrera.id, carrera.participantes.map((p, i) => ({
      participante_id: p.id, posicion_final: i + 1, estado: "activo", observacion: null,
    })));
    await finalizarCarrera(f, carrera.id);
  }
  assert.ok((await finalizarTorneo(f)).ok);
  const eFin = await estadoDe(f);
  assert.equal(eFin.bracket.estado, "finalizado");
  assert.ok(eFin.bracket.podio && eFin.bracket.podio.length > 0, "TEST F: había podio");
  const pubFin = await estadoPublicoBracket(f);
  assert.ok(pubFin.ok && (pubFin.data as { podio?: unknown[] | null }).podio, "TEST F: el público mostraba podio");
  const rF = await reset(f);
  assert.ok(rF.ok);
  assert.equal(rF.data.estado_previo, "finalizado");
  assert.equal(rF.data.tenia_podio, true);
  await verificarEnCero(f, "TEST F");
  console.log("TEST F (torneo finalizado con podio) OK");

  // ── TEST G · inscripciones intactas ──────────────────────────────────────
  const { id: g, inscs: inscsG } = await hastaBracketGenerado(8);
  const antesG = await fotoInscripciones(g);
  const idsAntes = inscsG.map((i) => i.id).sort().join(",");
  assert.ok((await reset(g)).ok);
  const despuesG = await fotoInscripciones(g);
  assert.equal(despuesG, antesG, "TEST G: las inscripciones no pueden cambiar en NADA");
  const { data: inscsDespues } = await supabaseAdmin
    .from("campeonato_inscripciones").select("id, estado_pago").eq("campeonato_id", g);
  assert.equal((inscsDespues ?? []).length, 8, "TEST G: mismas N inscripciones");
  assert.equal((inscsDespues ?? []).map((i) => i.id).sort().join(","), idsAntes, "TEST G: mismos IDs");
  assert.ok((inscsDespues ?? []).every((i) => i.estado_pago === "pagado"), "TEST G: siguen pagadas");
  // Y siguen siendo los pilotos disponibles de la clasificación.
  const eG = await estadoDe(g);
  assert.equal(eG.participantes.length, 8, "TEST G: los 8 pilotos siguen apareciendo");
  console.log("TEST G (inscripciones intactas) OK");

  // ── TEST H · pagos y checkouts intactos ──────────────────────────────────
  const { id: h } = await hastaBracketGenerado(4);
  const antesPagos = await supabaseAdmin
    .from("campeonato_inscripciones").select("id, payment_id, estado_pago, monto, metodo_pago")
    .eq("campeonato_id", h).order("created_at");
  const checkoutsAntes = await supabaseAdmin
    .from("campeonato_checkouts").select("id", { count: "exact", head: true });
  assert.ok((await reset(h)).ok);
  const despuesPagos = await supabaseAdmin
    .from("campeonato_inscripciones").select("id, payment_id, estado_pago, monto, metodo_pago")
    .eq("campeonato_id", h).order("created_at");
  assert.equal(JSON.stringify(despuesPagos.data), JSON.stringify(antesPagos.data), "TEST H: pagos idénticos");
  const checkoutsDespues = await supabaseAdmin
    .from("campeonato_checkouts").select("id", { count: "exact", head: true });
  assert.equal(checkoutsDespues.count, checkoutsAntes.count, "TEST H: los checkouts no se tocan");
  console.log("TEST H (pagos y checkouts intactos) OK");

  // ── TEST I · segunda barrera de confirmación (backend) ───────────────────
  const { id: i } = await hastaBracketGenerado(4);
  for (const malo of ["", "reiniciar", "REINICIAR ", "BORRAR", "si"]) {
    const r = await reiniciarCampeonato(i, malo);
    assert.equal(r.ok, false, `confirmación "${malo}" no debe pasar`);
    assert.equal((r as { status: number }).status, 400);
  }
  const trasIntentos = await conteos(i);
  assert.equal(trasIntentos.bracket, 1, "TEST I: nada se borró sin la confirmación exacta");
  assert.ok(trasIntentos.rondas > 0);
  assert.ok((await reset(i)).ok);
  await verificarEnCero(i, "TEST I");
  // Y una liga tampoco puede reiniciarse por este camino.
  const { data: liga } = await supabaseAdmin
    .from("campeonatos").insert({ nombre: `${MARCA} liga`, estado: "activo", modalidad: "liga", config: {} })
    .select("id").single();
  creados.campeonatos.push(liga!.id);
  const rLiga = await reiniciarCampeonato(liga!.id, CONFIRMACION_REINICIO);
  assert.equal(rLiga.ok, false, "TEST I: una liga no tiene bracket que reiniciar");
  console.log("TEST I (confirmación y modalidad) OK");

  // ── TEST J · reset vs escritura deportiva concurrente ────────────────────
  const { id: j } = await hastaBracketGenerado(8);
  const eJ = await estadoDe(j);
  const carreraJ = eJ.rondas[0].carreras.find((x) => !x.es_bye)!;
  await iniciarCarrera(j, carreraJ.id);
  const resultadoJ = carreraJ.participantes.map((p, k) => ({
    participante_id: p.id, posicion_final: k + 1, estado: "activo", observacion: null,
  }));
  // Se disparan a la vez: el reset y un guardado de resultado.
  const [resetJ] = await Promise.all([
    reset(j),
    guardarResultadoCarrera(j, carreraJ.id, resultadoJ).catch(() => null),
  ]);
  assert.ok(resetJ.ok, "TEST J: el reset termina bien");
  // Sea cual sea el orden, el estado final es UNO de los dos coherentes: todo
  // borrado. Nunca medio cuadro viejo.
  await verificarEnCero(j, "TEST J");
  // Reinicio repetido sobre un campeonato ya en cero: sigue en cero, sin error ni
  // datos duplicados. Lo que borra es 0 de todo, porque ya no quedaba nada.
  const otraVez = await reset(j);
  assert.ok(otraVez.ok, "TEST J: reiniciar dos veces no falla");
  assert.equal(otraVez.data.estado_previo, "clasificacion");
  assert.deepEqual(
    { p: otraVez.data.participantes, r: otraVez.data.rondas, c: otraVez.data.carreras, cp: otraVez.data.carrera_participantes },
    { p: 0, r: 0, c: 0, cp: 0 },
    "TEST J: el segundo reinicio no tenía nada que borrar",
  );
  assert.equal(otraVez.data.tenia_podio, false);
  await verificarEnCero(j, "TEST J (repetido)");
  // Una tercera vez tampoco rompe.
  assert.ok((await reset(j)).ok);
  await verificarEnCero(j, "TEST J (tercera)");
  console.log("TEST J (concurrencia e idempotencia) OK");
}

main()
  .then(async () => {
    await limpiar();
    console.log("\nbracketReset.integration.ts OK · datos temporales eliminados");
  })
  .catch(async (e) => {
    await limpiar();
    console.error("\nFALLÓ:", e);
    process.exit(1);
  });
