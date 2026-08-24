import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  obtenerEstado, guardarQuali, cerrarClasificacion, generarBracket,
  iniciarCarrera, guardarResultadoCarrera, finalizarCarrera, generarSiguienteRonda,
} from "@/lib/bracketServer";

// Integración END-TO-END contra la DB real, con un CAMPEONATO TEMPORAL que se
// ELIMINA al final (§63: nunca se genera el bracket real de Duelo). Ejecutar con:
//   node --env-file=.env.local --import tsx lib/bracketServer.integration.ts
//
// Verifica: creación de bracket, sincronización de participantes, quali+seeds,
// cierre, generación, corrida completa 32→16→8→4→podio, idempotencia, aislamiento
// entre campeonatos y el invariante "ningún piloto dos veces en una ronda".

type Estado = {
  bracket: { estado: string; podio: Array<{ puesto: number; nombre: string }> | null };
  configValida: { ok: boolean };
  participantes: Array<{ id: string; seed: number | null; nombre: string; mejor_ms: number | null }>;
  rondas: Array<{ id: string; numero: number; tipo: string; carreras: Array<{ id: string; estado: string; participantes: Array<{ id: string; seed: number | null }> }> }>;
};

async function crearCampeonatoTemp(nombre: string, n: number) {
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
        clasificacion: { habilitada: true, vueltas: 3, criterio: "mejor_vuelta" },
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

  try {
    // ── Sincronización + quali + seeds ─────────────────────────────────────────
    const st0 = await estado(camp32);
    assert.equal(st0.participantes.length, 32, "deben sincronizarse 32 participantes");
    assert.equal(st0.bracket.estado, "clasificacion");
    assert.equal((st0.configValida as { ok: boolean }).ok, true);

    // Cada piloto: un único mejor tiempo = 90000 + i*100 (menor = mejor seed).
    // Los 2 primeros vía la API guardarQuali (cobertura); el resto en bloque
    // (mismo efecto en DB) para acotar round-trips.
    for (let i = 0; i < 2; i++) {
      const r = await guardarQuali(camp32, st0.participantes[i].id as string, { presente: true, mejor_ms: 90000 + i * 100 });
      assert.ok(r.ok);
    }
    for (let i = 2; i < st0.participantes.length; i++) {
      await supabaseAdmin.from("campeonato_bracket_participantes")
        .update({ presente: true, mejor_ms: 90000 + i * 100 })
        .eq("id", st0.participantes[i].id as string);
    }

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
      await guardarQuali(camp8, st8a.participantes[i].id as string, { presente: true, mejor_ms: 90000 + i * 100 });
    }
    await cerrarClasificacion(camp8);
    await generarBracket(camp8);
    const r8 = await correrTorneo(camp8);
    assert.deepEqual(r8.carrerasPorRonda, [2, 1], "8→4→final");
    assert.equal(r8.podio, 3);
    await verificarInvarianteRonda(camp8);

    // camp32 sigue finalizado e intacto tras operar camp8 (aislamiento).
    assert.equal((await estado(camp32)).bracket.estado, "finalizado");

    console.log("OK — integración bracket: sync, quali+seeds, cierre idempotente, generación idempotente, " +
      "serpentina 1/16/17/32, torneo 32→16→8→4→podio(P1/P2/P3), 8→4→final, aislamiento e invariante de ronda.");
  } finally {
    await limpiar(camp32);
    await limpiar(camp8);
    // Barrido de seguridad: elimina cualquier campeonato de prueba que haya quedado.
    await supabaseAdmin.from("campeonatos").delete().like("nombre", "__TEST_BRACKET_%");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
