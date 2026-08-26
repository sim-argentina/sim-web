import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  obtenerEstado, guardarQuali, cerrarClasificacion, generarBracket,
  iniciarCarrera, guardarResultadoCarrera, finalizarCarrera, generarSiguienteRonda,
  seedManual, reabrirClasificacion,
} from "@/lib/bracketServer";

// Integración END-TO-END contra la DB real, con un CAMPEONATO TEMPORAL que se
// ELIMINA al final (§63: nunca se genera el bracket real de Duelo). Ejecutar con:
//   node --env-file=.env.local --import tsx lib/bracketServer.integration.ts
//
// Verifica: GET read-only (no persiste), pilotos derivados, persistencia solo por
// acción explícita, quali+seeds, cierre, corrida 32→16→8→4→podio, idempotencia,
// aislamiento, invariante "ningún piloto dos veces en una ronda", nuevas/canceladas.

type Estado = {
  bracket: { id: string | null; estado: string; clasificacion_habilitada?: boolean; podio: Array<{ puesto: number; nombre: string }> | null };
  configValida: { ok: boolean };
  participantes: Array<{ id: string | null; inscripcion_id: string; seed: number | null; posicion_provisional?: number | null; nombre: string; mejor_ms: number | null }>;
  rondas: Array<{ id: string; numero: number; tipo: string; carreras: Array<{ id: string; estado: string; participantes: Array<{ id: string; seed: number | null }> }> }>;
};

// Cuenta filas persistidas en el bracket de un campeonato (0 si no hay bracket).
async function contarParticipantes(campId: string): Promise<number> {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", campId).maybeSingle();
  if (!br) return 0;
  const { count } = await supabaseAdmin.from("campeonato_bracket_participantes").select("id", { count: "exact", head: true }).eq("bracket_id", br.id);
  return count ?? 0;
}
async function contarBracketRows(campId: string): Promise<number> {
  const { count } = await supabaseAdmin.from("campeonato_bracket").select("id", { count: "exact", head: true }).eq("campeonato_id", campId);
  return count ?? 0;
}
async function crearInscripcion(campId: string, nombre: string): Promise<string> {
  const { data } = await supabaseAdmin.from("campeonato_inscripciones").insert({
    campeonato_id: campId, nombre, apellido: "Test", nombre_completo: `${nombre} Test`,
    telefono: "000", dni: nombre, escuderia_favorita: null, monto: 1, estado_pago: "pagado",
  }).select("id").single();
  return data!.id as string;
}

async function crearCampeonatoTemp(nombre: string, n: number, opts?: { habilitada?: boolean }) {
  const { data: camp, error } = await supabaseAdmin
    .from("campeonatos")
    .insert({
      nombre,
      estado: "activo",
      modalidad: "eliminacion",
      permite_pago_stand: false,
      usa_ronda_preliminar: false,
      precio_inscripcion: 1,
      cupos_maximos: n,
      categorias: [],
      config: {
        clasificacion: { habilitada: opts?.habilitada ?? true, vueltas: 3, criterio: "mejor_vuelta" },
        eliminatoria: { pilotos_por_carrera: 4, avanzan: 2, vueltas: 5, final_pilotos: 4 },
      },
    })
    .select("id").single();
  if (error || !camp) throw new Error("No se pudo crear campeonato temp: " + JSON.stringify(error));

  const inscripciones = Array.from({ length: n }, (_, i) => ({
    campeonato_id: camp.id,
    nombre: `Piloto${i + 1}`,
    apellido: "Test",
    nombre_completo: `Piloto${i + 1} Test`,
    telefono: "000",
    dni: `T${i + 1}`,
    escuderia_favorita: null,
    monto: 1,
    estado_pago: "pagado",
  }));
  const { error: eI } = await supabaseAdmin.from("campeonato_inscripciones").insert(inscripciones);
  if (eI) throw new Error("No se pudieron crear inscripciones: " + JSON.stringify(eI));
  return camp.id as string;
}

async function limpiar(campId: string) {
  // Borra inscripciones (cascade a carrera_participantes) y el campeonato
  // (cascade a bracket/rondas/carreras). No queda nada del torneo temporal.
  await supabaseAdmin.from("campeonato_inscripciones").delete().eq("campeonato_id", campId);
  await supabaseAdmin.from("campeonatos").delete().eq("id", campId);
}

async function estado(campId: string): Promise<Estado> {
  const r = await obtenerEstado(campId);
  assert.ok(r.ok, "obtenerEstado falló: " + (r.ok ? "" : r.error));
  return r.data as unknown as Estado;
}

// Lee el seed PERSISTIDO en DB de una inscripción (para verificar que no se hace
// limpieza destructiva de seeds residuales/congelados).
async function dbSeed(campId: string, inscripcionId: string): Promise<number | null | undefined> {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", campId).maybeSingle();
  if (!br) return undefined;
  const { data } = await supabaseAdmin.from("campeonato_bracket_participantes")
    .select("seed").eq("bracket_id", br.id).eq("inscripcion_id", inscripcionId).maybeSingle();
  return data ? (data.seed as number | null) : undefined;
}

// Corre el torneo completo (gana el mejor seed en cada carrera). Usa lecturas
// directas ligeras en el loop (no obtenerEstado, que es pesado) para acotar el
// número de round-trips a la DB.
async function correrTorneo(campId: string): Promise<{ rondas: number; carrerasPorRonda: number[]; podio: number }> {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", campId).single();
  const carrerasPorRonda: number[] = [];
  let guard = 0;
  while (guard++ < 30) {
    // Última ronda existente.
    const { data: rondas } = await supabaseAdmin
      .from("campeonato_bracket_rondas").select("id, numero, tipo").eq("bracket_id", br!.id).order("numero");
    const ronda = (rondas ?? [])[(rondas ?? []).length - 1];
    if (!ronda) break;
    const { data: carreras } = await supabaseAdmin
      .from("campeonato_bracket_carreras").select("id, estado").eq("ronda_id", ronda.id).order("numero");
    if (carrerasPorRonda.length < (rondas ?? []).length) carrerasPorRonda.push((carreras ?? []).length);

    for (const c of carreras ?? []) {
      if (c.estado === "finalizada") continue; // BYE o ya corrida
      const ini = await iniciarCarrera(campId, c.id);
      assert.ok(ini.ok, "iniciar: " + (ini.ok ? "" : ini.error));
      const { data: parts } = await supabaseAdmin
        .from("campeonato_bracket_carrera_participantes").select("id, seed").eq("carrera_id", c.id);
      const orden = [...(parts ?? [])].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
      const resultado = orden.map((p, i) => ({ participante_id: p.id as string, posicion_final: i + 1 }));
      const g = await guardarResultadoCarrera(campId, c.id, resultado);
      assert.ok(g.ok, "guardar resultado: " + (g.ok ? "" : g.error));
      const fin = await finalizarCarrera(campId, c.id);
      assert.ok(fin.ok, "finalizar: " + (fin.ok ? "" : fin.error));
    }

    if (ronda.tipo !== "final") {
      const sig = await generarSiguienteRonda(campId, ronda.id);
      assert.ok(sig.ok, "generar siguiente: " + (sig.ok ? "" : sig.error));
    } else {
      break; // la final ya se finalizó → torneo terminado
    }
  }
  const fin = await estado(campId);
  return {
    rondas: fin.rondas.length,
    carrerasPorRonda,
    podio: Array.isArray(fin.bracket.podio) ? fin.bracket.podio.length : 0,
  };
}

async function verificarInvarianteRonda(campId: string) {
  // Ningún piloto aparece dos veces en la misma ronda (garantizado por UNIQUE).
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", campId).single();
  const { data: cps } = await supabaseAdmin
    .from("campeonato_bracket_carrera_participantes").select("ronda_id, inscripcion_id").eq("bracket_id", br!.id);
  const seen = new Set<string>();
  for (const cp of cps ?? []) {
    const k = `${cp.ronda_id}|${cp.inscripcion_id}`;
    assert.ok(!seen.has(k), "piloto duplicado en una ronda");
    seen.add(k);
  }
}

async function main() {
  const marca = `__TEST_BRACKET_${Date.now()}`;
  const camp32 = await crearCampeonatoTemp(`${marca}_32`, 32);
  const camp8 = await crearCampeonatoTemp(`${marca}_8`, 8);
  const camp5 = await crearCampeonatoTemp(`${marca}_5`, 5);
  const campSeed = await crearCampeonatoTemp(`${marca}_seed`, 3);
  const campGen = await crearCampeonatoTemp(`${marca}_gen`, 4);
  const campManual = await crearCampeonatoTemp(`${marca}_manual`, 4, { habilitada: false });

  try {
    // ── READ-ONLY explícito: 5 inscriptos, 0 filas; guardar 1 → 1 fila; nueva/cancelada
    {
      let st = await estado(camp5);
      assert.equal(st.participantes.length, 5, "GET muestra 5 pilotos");
      assert.equal(await contarParticipantes(camp5), 0, "DB sigue con 0 filas tras GET");
      assert.equal(await contarBracketRows(camp5), 0, "GET no crea bracket");

      // Guardar mejor tiempo de 1 piloto → 1 fila persistida.
      const r = await guardarQuali(camp5, st.participantes[0].inscripcion_id, { presente: true, mejor_ms: 91000 });
      assert.ok(r.ok);
      assert.equal(await contarParticipantes(camp5), 1, "tras guardar 1 → 1 fila");
      st = await estado(camp5);
      assert.equal(st.participantes.length, 5, "sigue mostrando 5 (1 persistido, 4 derivados)");
      assert.equal(st.participantes.filter((p) => p.id != null).length, 1, "1 persistido");
      assert.equal(await contarParticipantes(camp5), 1, "GET no persiste los derivados");

      // Nueva inscripción válida (clasificación abierta) → aparece sin INSERT en bracket.
      const nueva = await crearInscripcion(camp5, "Nuevo");
      st = await estado(camp5);
      assert.equal(st.participantes.length, 6, "nueva inscripción aparece (6)");
      assert.equal(await contarParticipantes(camp5), 1, "no se creó fila para el nuevo por GET");

      // Cancelar esa inscripción antes de persistir → deja de aparecer, sin fila creada.
      await supabaseAdmin.from("campeonato_inscripciones").update({ estado_pago: "cancelado" }).eq("id", nueva);
      st = await estado(camp5);
      assert.equal(st.participantes.length, 5, "cancelada deja de aparecer (5)");
      assert.equal(await contarParticipantes(camp5), 1, "nunca se creó fila para la cancelada");

      // Cerrar clasificación → persiste/congela a los 5 válidos con seeds.
      const c = await cerrarClasificacion(camp5);
      assert.ok(c.ok);
      assert.equal(await contarParticipantes(camp5), 5, "al cerrar se persisten los 5 del seeding");
      st = await estado(camp5);
      assert.equal(st.bracket.estado, "cerrada");
      assert.equal(st.participantes.filter((p) => p.seed != null).length, 5, "5 seeds congelados");
    }

    // ── READ-ONLY: abrir/consultar NO persiste nada ───────────────────────────
    const st0 = await estado(camp32);
    assert.equal(st0.participantes.length, 32, "GET debe mostrar 32 pilotos (derivados)");
    assert.equal(st0.bracket.estado, "clasificacion");
    assert.equal(st0.bracket.id, null, "GET no debe crear el bracket");
    assert.equal((st0.configValida as { ok: boolean }).ok, true);
    assert.equal(await contarBracketRows(camp32), 0, "GET no crea fila de bracket");
    assert.equal(await contarParticipantes(camp32), 0, "GET no crea filas de participantes");
    assert.ok(st0.participantes.every((p) => p.id === null && p.inscripcion_id), "todos derivados (sin fila persistida)");

    // Cada piloto: un único mejor tiempo = 90000 + i*100 (menor = mejor seed).
    // Los 2 primeros vía la API guardarQuali (acción explícita → persiste); el resto
    // se insertan en bloque por inscripcion_id (mismo efecto) para acotar round-trips.
    for (let i = 0; i < 2; i++) {
      const r = await guardarQuali(camp32, st0.participantes[i].inscripcion_id, { presente: true, mejor_ms: 90000 + i * 100 });
      assert.ok(r.ok);
    }
    assert.equal(await contarParticipantes(camp32), 2, "tras guardar 2 → 2 filas persistidas");
    // GET vuelve a mostrar 32 (2 persistidos, 30 derivados) y la DB sigue con 2 filas.
    const stMix = await estado(camp32);
    assert.equal(stMix.participantes.length, 32);
    assert.equal(await contarParticipantes(camp32), 2, "GET no persiste los derivados");

    const { data: br32 } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", camp32).single();
    const filas32 = [];
    for (let i = 2; i < st0.participantes.length; i++) {
      filas32.push({ bracket_id: br32!.id, inscripcion_id: st0.participantes[i].inscripcion_id, presente: true, mejor_ms: 90000 + i * 100, orden_inscripcion: i });
    }
    await supabaseAdmin.from("campeonato_bracket_participantes").insert(filas32);

    // ── Cierre (idempotente) ───────────────────────────────────────────────────
    const cerrar1 = await cerrarClasificacion(camp32);
    assert.ok(cerrar1.ok);
    const cerrar2 = await cerrarClasificacion(camp32); // idempotente
    assert.ok(cerrar2.ok);
    const stCerrado = await estado(camp32);
    assert.equal(stCerrado.bracket.estado, "cerrada");
    const conSeed = stCerrado.participantes.filter((p) => p.seed != null).sort((a, b) => (a.seed as number) - (b.seed as number));
    assert.equal(conSeed.length, 32, "32 seeds congelados");
    assert.deepEqual(conSeed.slice(0, 3).map((p) => p.seed), [1, 2, 3]);
    // El seed 1 es el de menor mejor_ms (mejor tiempo) — seeding por clasificación.
    const nombresTop3 = conSeed.slice(0, 3).map((p) => p.nombre); // esperado en el podio

    // ── Generar (idempotente: segunda vez rechaza) ─────────────────────────────
    const gen1 = await generarBracket(camp32);
    assert.ok(gen1.ok, "generar: " + (gen1.ok ? "" : gen1.error));
    const gen2 = await generarBracket(camp32);
    assert.equal(gen2.ok, false, "generar dos veces debe rechazarse");
    if (!gen2.ok) assert.equal(gen2.status, 409);

    const stGen = await estado(camp32);
    assert.equal(stGen.rondas.length, 1);
    assert.equal(stGen.rondas[0].carreras.length, 8, "primera ronda: 8 carreras");
    // Serpentina: carrera 1 = seeds 1,16,17,32.
    const seedsC1 = stGen.rondas[0].carreras[0].participantes.map((p) => p.seed).sort((a, b) => (a ?? 0) - (b ?? 0));
    assert.deepEqual(seedsC1, [1, 16, 17, 32]);

    // ── Corrida completa 32 → 16 → 8 → 4 → podio ──────────────────────────────
    const r32 = await correrTorneo(camp32);
    assert.deepEqual(r32.carrerasPorRonda, [8, 4, 2, 1], "32→16→8→4");
    assert.equal(r32.rondas, 4);
    assert.equal(r32.podio, 3, "podio de 3");
    await verificarInvarianteRonda(camp32);

    // Podio esperado: los 3 mejores seeds (gana siempre el mejor seed en la sim).
    const stFin = await estado(camp32);
    const podio = stFin.bracket.podio as Array<{ puesto: number; nombre: string }>;
    assert.deepEqual(podio.map((p) => p.nombre), nombresTop3);
    assert.equal(stFin.bracket.estado, "finalizado");

    // ── Aislamiento: el otro campeonato no tiene rondas ni se mezcló ───────────
    const st8a = await estado(camp8);
    assert.equal(st8a.rondas.length, 0, "camp8 no debe tener rondas todavía");
    assert.equal(st8a.participantes.length, 8);

    // Corre el de 8 (8 → 4 → final) para confirmar otra config de tamaño.
    for (let i = 0; i < st8a.participantes.length; i++) {
      await guardarQuali(camp8, st8a.participantes[i].inscripcion_id, { presente: true, mejor_ms: 90000 + i * 100 });
    }
    await cerrarClasificacion(camp8);
    await generarBracket(camp8);
    const r8 = await correrTorneo(camp8);
    assert.deepEqual(r8.carrerasPorRonda, [2, 1], "8→4→final");
    assert.equal(r8.podio, 3);
    await verificarInvarianteRonda(camp8);

    // camp32 sigue finalizado e intacto tras operar camp8 (aislamiento).
    assert.equal((await estado(camp32)).bracket.estado, "finalizado");

    // ── SEED vs POSICIÓN PROVISIONAL (foco del ajuste) ────────────────────────
    {
      let s = await estado(campSeed);
      const [pA, pB, pC] = s.participantes; // 3 pilotos derivados, sin seed
      assert.ok(s.participantes.every((p) => p.seed == null), "abierta: ningún seed definitivo");
      const posDe = (iid: string) => s.participantes.find((p) => p.inscripcion_id === iid)!.posicion_provisional ?? null;
      const seedDe = (iid: string) => s.participantes.find((p) => p.inscripcion_id === iid)!.seed;

      // CASO A: seed viejo persistido (residual) con mejor_ms=null → NO se expone.
      await guardarQuali(campSeed, pA.inscripcion_id, { presente: true }); // crea bracket + fila
      const { data: brS } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", campSeed).single();
      await supabaseAdmin.from("campeonato_bracket_participantes")
        .update({ seed: 1, mejor_ms: null }).eq("bracket_id", brS!.id).eq("inscripcion_id", pA.inscripcion_id);
      s = await estado(campSeed);
      assert.equal(seedDe(pA.inscripcion_id), null, "CASO A: el seed viejo NO se expone con clasificación abierta");
      assert.equal(posDe(pA.inscripcion_id), null, "CASO A: sin tiempo → sin posición (—)");
      assert.equal(await dbSeed(campSeed, pA.inscripcion_id), 1, "CASO A: la fila real queda intacta (seed=1 sigue en DB)");

      // CASO B: 3 pilotos con tiempo → orden provisional por mejor tiempo; sin seed.
      await guardarQuali(campSeed, pA.inscripcion_id, { presente: true, mejor_ms: 91000 });
      await guardarQuali(campSeed, pB.inscripcion_id, { presente: true, mejor_ms: 90000 });
      await guardarQuali(campSeed, pC.inscripcion_id, { presente: true, mejor_ms: 92000 });
      s = await estado(campSeed);
      assert.equal(posDe(pB.inscripcion_id), 1, "CASO B: pos.1 = mejor tiempo");
      assert.equal(posDe(pA.inscripcion_id), 2, "CASO B: pos.2");
      assert.equal(posDe(pC.inscripcion_id), 3, "CASO B: pos.3");
      assert.ok(s.participantes.every((p) => p.seed == null), "CASO B: aún sin seed definitivo");

      // CASO C: editar mejor tiempo antes de cerrar → cambia el ranking; seed sigue null.
      await guardarQuali(campSeed, pC.inscripcion_id, { presente: true, mejor_ms: 89000 }); // pasa a ser el mejor
      s = await estado(campSeed);
      assert.equal(posDe(pC.inscripcion_id), 1, "CASO C: el editado pasa a pos.1");
      assert.ok(s.participantes.every((p) => p.seed == null), "CASO C: sigue sin seed definitivo");

      // Cerrar → seeds 1/2/3 por tiempo, persistidos y visibles.
      assert.ok((await cerrarClasificacion(campSeed)).ok);
      s = await estado(campSeed);
      assert.equal(s.bracket.estado, "cerrada");
      assert.equal(seedDe(pC.inscripcion_id), 1, "cierre: mejor tiempo (89000) = seed 1");
      assert.equal(seedDe(pB.inscripcion_id), 2, "cierre: seed 2");
      assert.equal(seedDe(pA.inscripcion_id), 3, "cierre: seed 3");
      assert.equal(await dbSeed(campSeed, pC.inscripcion_id), 1, "cierre: seed persistido en DB");

      // CASO D: seed congelado; cambiar datos después (sin reabrir) NO altera el seed.
      await supabaseAdmin.from("campeonato_bracket_participantes")
        .update({ mejor_ms: 50000 }).eq("bracket_id", brS!.id).eq("inscripcion_id", pA.inscripcion_id);
      s = await estado(campSeed);
      assert.equal(seedDe(pA.inscripcion_id), 3, "CASO D: el seed sigue congelado pese al cambio de tiempo");

      // CASO E: reabrir → seeds dejan de considerarse definitivos; sin limpieza destructiva.
      assert.ok((await reabrirClasificacion(campSeed)).ok, "reabrir");
      s = await estado(campSeed);
      assert.equal(s.bracket.estado, "clasificacion");
      assert.ok(s.participantes.every((p) => p.seed == null), "CASO E: tras reabrir, ningún seed definitivo (aunque persistan en DB)");
      assert.ok((await dbSeed(campSeed, pC.inscripcion_id)) != null, "CASO E: no hubo limpieza destructiva de seeds");
      // Cerrar de nuevo (ahora pA es el más rápido, 50000) → recalcula.
      assert.ok((await cerrarClasificacion(campSeed)).ok);
      s = await estado(campSeed);
      assert.equal(seedDe(pA.inscripcion_id), 1, "CASO E: el recierre recalcula (pA 50000 = seed 1)");
    }

    // CASO F: generar bracket con clasificación abierta → rechazado server-side.
    {
      const s = await estado(campGen);
      await guardarQuali(campGen, s.participantes[0].inscripcion_id, { presente: true, mejor_ms: 90000 });
      const g = await generarBracket(campGen);
      assert.equal(g.ok, false, "CASO F: no se puede generar con clasificación abierta");
      if (!g.ok) assert.equal(g.status, 409);
    }

    // CASO G: campeonato SIN clasificación (manual) → seeding manual sigue funcionando.
    {
      const s0 = await estado(campManual);
      assert.equal(s0.participantes.length, 4);
      assert.equal(s0.bracket.clasificacion_habilitada, false, "CASO G: torneo con seeding manual");
      const orden = s0.participantes.map((p) => p.inscripcion_id);
      assert.ok((await seedManual(campManual, [orden[2], orden[0], orden[3], orden[1]])).ok, "CASO G: seedManual ok");
      const s = await estado(campManual);
      // En modo manual los seeds NO se ocultan (son la herramienta), aunque esté "abierta".
      assert.equal(s.participantes.find((p) => p.inscripcion_id === orden[2])!.seed, 1, "CASO G: seed manual 1 visible");
      assert.equal(s.participantes.find((p) => p.inscripcion_id === orden[0])!.seed, 2, "CASO G: seed manual 2 visible");
      assert.ok(s.participantes.some((p) => p.seed != null), "CASO G: seeding manual visible con clasificación abierta");
    }

    console.log("OK — integración bracket: GET read-only (no persiste, pilotos derivados), " +
      "persistencia por acción explícita (guardar/cerrar), nuevas/canceladas antes de persistir, " +
      "quali+seeds, cierre idempotente, generación idempotente, serpentina 1/16/17/32, " +
      "torneo 32→16→8→4→podio, 8→4→final, aislamiento e invariante de ronda. " +
      "SEED: A) seed viejo no expuesto abierto, B) ranking provisional, C) edición cambia ranking sin seed, " +
      "D) seed congelado al cerrar, E) reabrir invalida y recalcula (sin limpieza destructiva), " +
      "F) generar rechazado con clasificación abierta, G) seeding manual intacto.");
  } finally {
    await limpiar(camp32);
    await limpiar(camp8);
    await limpiar(camp5);
    await limpiar(campSeed);
    await limpiar(campGen);
    await limpiar(campManual);
    // Barrido de seguridad: elimina cualquier campeonato de prueba que haya quedado.
    await supabaseAdmin.from("campeonatos").delete().like("nombre", "__TEST_BRACKET_%");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
