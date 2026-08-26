import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  guardarQuali, cerrarClasificacion, generarBracket,
  iniciarCarrera, guardarResultadoCarrera, finalizarCarrera, generarSiguienteRonda,
} from "@/lib/bracketServer";
import { estadoPublicoBracket, type BracketPublico } from "@/lib/bracketPublic";

// Integración del DTO público del bracket contra la DB real, con campeonatos TEMPORALES
// que se ELIMINAN al final. NO se toca el bracket real de Duelo. Ejecutar con:
//   npx tsx --env-file=.env.local lib/bracketPublic.integration.ts
//
// Valores PII distintivos en las inscripciones fixture: NO deben aparecer en el DTO.
const PII_TEL = "PIITEL5550001";
const PII_DNI = "PIIDNI9988776";
const PII_EMAIL = "pii@fixture.test";

type ElimCfg = { pilotos_por_carrera: number; avanzan: number; vueltas: number; final_pilotos: number };

async function crearCampeonato(nombre: string, n: number, cfgElim: ElimCfg, modalidad = "eliminacion"): Promise<string> {
  const { data: camp, error } = await supabaseAdmin.from("campeonatos").insert({
    nombre, estado: "activo", modalidad, permite_pago_stand: false, usa_ronda_preliminar: false,
    precio_inscripcion: 1, cupos_maximos: 0, categorias: [],
    config: {
      clasificacion: { habilitada: true, vueltas: 3, criterio: "mejor_vuelta" },
      eliminatoria: cfgElim,
      premios: { total: 100000, detalle: [{ puesto: 1, monto: 60000, trofeo: true }, { puesto: 2, monto: 30000, trofeo: false }, { puesto: 3, monto: 10000, trofeo: false }] },
    },
  }).select("id").single();
  if (error || !camp) throw new Error("crear campeonato: " + JSON.stringify(error));
  const filas = Array.from({ length: n }, (_, i) => ({
    campeonato_id: camp.id, nombre: `P${i + 1}`, apellido: "Test", nombre_completo: `P${i + 1} Test`,
    telefono: PII_TEL, dni: `${PII_DNI}${i}`, escuderia_favorita: "", monto: 1, estado_pago: "pagado",
    metodo_pago: "mercadopago", observaciones: PII_EMAIL,
  }));
  const { error: eI } = await supabaseAdmin.from("campeonato_inscripciones").insert(filas);
  if (eI) throw new Error("crear inscripciones: " + JSON.stringify(eI));
  return camp.id as string;
}
async function pub(id: string): Promise<BracketPublico> {
  const r = await estadoPublicoBracket(id);
  assert.ok(r.ok, "estadoPublicoBracket ok");
  const d = r.data;
  assert.ok(d.aplica === true, "aplica=true para eliminación");
  return d;
}
async function inscripciones(id: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("campeonato_inscripciones").select("id").eq("campeonato_id", id).order("created_at");
  return (data ?? []).map((x) => x.id as string);
}
async function carrerasRonda1(id: string) {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", id).single();
  const { data: r1 } = await supabaseAdmin.from("campeonato_bracket_rondas").select("id").eq("bracket_id", br!.id).order("numero").limit(1).single();
  const { data: cs } = await supabaseAdmin.from("campeonato_bracket_carreras").select("id,estado").eq("ronda_id", r1!.id).order("numero");
  return cs ?? [];
}
async function correr(id: string) {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", id).single();
  let guard = 0;
  while (guard++ < 20) {
    const { data: rondas } = await supabaseAdmin.from("campeonato_bracket_rondas").select("id,numero,tipo").eq("bracket_id", br!.id).order("numero");
    const ronda = (rondas ?? [])[(rondas ?? []).length - 1];
    if (!ronda) break;
    const { data: carreras } = await supabaseAdmin.from("campeonato_bracket_carreras").select("id,estado").eq("ronda_id", ronda.id).order("numero");
    for (const c of carreras ?? []) {
      if (c.estado === "finalizada") continue;
      await iniciarCarrera(id, c.id);
      const { data: parts } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes").select("id,seed").eq("carrera_id", c.id);
      const orden = [...(parts ?? [])].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
      await guardarResultadoCarrera(id, c.id, orden.map((p, i) => ({ participante_id: p.id as string, posicion_final: i + 1 })));
      await finalizarCarrera(id, c.id);
    }
    if (ronda.tipo !== "final") await generarSiguienteRonda(id, ronda.id); else break;
  }
}
async function limpiar(id: string) {
  await supabaseAdmin.from("campeonato_inscripciones").delete().eq("campeonato_id", id);
  await supabaseAdmin.from("campeonatos").delete().eq("id", id);
}

async function main() {
  const marca = `__TEST_PUBBRK_${Date.now()}`;
  const camp8 = await crearCampeonato(`${marca}_8`, 8, { pilotos_por_carrera: 4, avanzan: 2, vueltas: 5, final_pilotos: 4 });
  const campBye = await crearCampeonato(`${marca}_bye`, 3, { pilotos_por_carrera: 2, avanzan: 1, vueltas: 3, final_pilotos: 2 });
  const campLiga = await crearCampeonato(`${marca}_liga`, 2, { pilotos_por_carrera: 4, avanzan: 2, vueltas: 5, final_pilotos: 4 }, "liga");

  try {
    // ── CASO A: eliminatorio sin bracket → no_iniciado ────────────────────────
    {
      const d = await pub(camp8);
      assert.equal(d.estado, "no_iniciado", "A: sin bracket → no_iniciado");
      assert.deepEqual(d.rondas, [], "A: sin rondas");
      assert.equal(d.podio, null, "A: sin podio");
      assert.equal(d.clasificacion.oficial, null, "A: sin clasificación oficial");
    }

    // ── CASO B: clasificación abierta → sin seeds oficiales ───────────────────
    const ins8 = await inscripciones(camp8);
    for (let i = 0; i < ins8.length; i++) await guardarQuali(camp8, ins8[i], { presente: true, mejor_ms: 90000 + i * 100 });
    {
      const d = await pub(camp8);
      assert.equal(d.estado, "clasificacion", "B: clasificación abierta");
      assert.equal(d.clasificacion.abierta, true, "B: abierta");
      assert.equal(d.clasificacion.oficial, null, "B: sin clasificación oficial mientras está abierta");
      assert.equal(d.clasificacion.pilotos, 8, "B: 8 pilotos");
      // Nombres SÍ (para el resumen contextual), en orden alfabético y sin seeds/tiempos.
      assert.ok(Array.isArray(d.clasificacion.nombres) && d.clasificacion.nombres.length === 8, "B: 8 nombres");
      const ordenado = [...d.clasificacion.nombres!].sort((x, y) => x.localeCompare(y, "es"));
      assert.deepEqual(d.clasificacion.nombres, ordenado, "B: nombres en orden alfabético (no insinúa ranking)");
      assert.deepEqual(d.rondas, [], "B: sin cuadro todavía");
    }

    // ── CASO C: clasificación cerrada → oficial disponible ────────────────────
    await cerrarClasificacion(camp8);
    {
      const d = await pub(camp8);
      assert.equal(d.estado, "clasificacion_cerrada", "C: cerrada");
      assert.equal(d.clasificacion.nombres, null, "C: nombres null al cerrar (usa oficial)");
      assert.ok(d.clasificacion.oficial && d.clasificacion.oficial.length === 8, "C: 8 seeds oficiales");
      assert.equal(d.clasificacion.oficial![0].seed, 1, "C: seed 1 primero");
      assert.ok(/^\d+:\d{2}\.\d{3}$/.test(d.clasificacion.oficial![0].mejor_tiempo ?? ""), "C: mejor tiempo formateado M:SS.mmm");
      assert.deepEqual(d.rondas, [], "C: cuadro aún no publicado");
    }

    // ── CASO D: bracket generado → rondas/carreras ────────────────────────────
    await generarBracket(camp8);
    {
      const d = await pub(camp8);
      assert.equal(d.estado, "en_curso", "D: en curso");
      assert.equal(d.rondas.length, 1, "D: 1 ronda inicial");
      assert.equal(d.rondas[0].carreras.length, 2, "D: 8/4 = 2 carreras");
      assert.ok(d.rondas[0].carreras[0].participantes.every((p) => p.seed != null && p.nombre), "D: participantes con seed y nombre");
    }

    // ── CASO E: carrera en curso ──────────────────────────────────────────────
    const cs1 = await carrerasRonda1(camp8);
    await iniciarCarrera(camp8, cs1[0].id);
    {
      const d = await pub(camp8);
      const enCurso = d.rondas[0].carreras.filter((c) => c.estado === "en_curso");
      assert.equal(enCurso.length, 1, "E: una carrera en curso");
    }

    // ── CASO F: carrera finalizada → posiciones + clasificados ────────────────
    {
      const { data: parts } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes").select("id,seed").eq("carrera_id", cs1[0].id);
      const orden = [...(parts ?? [])].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
      await guardarResultadoCarrera(camp8, cs1[0].id, orden.map((p, i) => ({ participante_id: p.id as string, posicion_final: i + 1 })));
      await finalizarCarrera(camp8, cs1[0].id);
      const d = await pub(camp8);
      const carr = d.rondas[0].carreras.find((c) => c.estado === "finalizada")!;
      assert.ok(carr.participantes.every((p) => p.posicion_final != null), "F: posiciones cargadas");
      assert.equal(carr.participantes.filter((p) => p.clasifica === true).length, 2, "F: 2 clasificados (avanzan 2)");
      assert.equal(carr.participantes.filter((p) => p.clasifica === false).length, 2, "F: 2 eliminados");
    }

    // ── Correr hasta el final → CASO H (final) + CASO I (finalizado + historial) ─
    await correr(camp8);
    {
      const d = await pub(camp8);
      assert.equal(d.estado, "finalizado", "I: torneo finalizado");
      assert.ok(d.final && d.final.tipo === "final", "H: Gran Final presente");
      assert.ok(d.podio && d.podio.length >= 1 && d.podio[0].puesto === 1 && d.podio[0].nombre, "H: podio con 1.º");
      assert.ok(d.podio![0].premio && d.podio![0].premio!.monto === 60000, "H: premio del 1.º desde config");
      assert.ok(d.rondas.length >= 2, "I: historial completo de rondas visible");

      // ── CASO (PII): el DTO serializado NO contiene ninguna PII ni dato privado ──
      const json = JSON.stringify(d);
      for (const secreto of [PII_TEL, PII_DNI, PII_EMAIL, "estado_pago", "pagado", "metodo_pago", "mercadopago", "observacion", "observaciones", "inscripcion_id", "telefono", "dni"]) {
        assert.ok(!json.includes(secreto), `PII: el DTO no debe contener "${secreto}"`);
      }
    }

    // ── CASO G: BYE → pase directo ────────────────────────────────────────────
    const insBye = await inscripciones(campBye);
    for (let i = 0; i < insBye.length; i++) await guardarQuali(campBye, insBye[i], { presente: true, mejor_ms: 90000 + i * 100 });
    await cerrarClasificacion(campBye);
    await generarBracket(campBye);
    {
      const d = await pub(campBye);
      const bye = d.rondas[0].carreras.find((c) => c.es_bye);
      assert.ok(bye, "G: existe una carrera BYE");
      assert.equal(bye!.participantes.length, 1, "G: el BYE tiene un solo piloto (pase directo)");
      assert.ok(bye!.participantes[0].nombre && !/null/i.test(bye!.participantes[0].nombre), "G: sin participante fantasma/NULL");
    }

    // ── CASO J: liga → la vista bracket no aplica ─────────────────────────────
    {
      const r = await estadoPublicoBracket(campLiga);
      assert.ok(r.ok && r.data.aplica === false, "J: liga → aplica:false (UI histórica intacta)");
    }

    console.log("OK — bracket público: A) no_iniciado, B) clasificación abierta sin seeds, " +
      "C) clasificación oficial, D) rondas/carreras, E) carrera en curso, F) posiciones+clasificados, " +
      "G) BYE pase directo, H) Gran Final + podio + premios de config, I) finalizado con historial, " +
      "J) liga no aplica. PII: el DTO no expone teléfono/DNI/email/pago/observaciones/inscripcion_id.");
  } finally {
    await limpiar(camp8);
    await limpiar(campBye);
    await limpiar(campLiga);
    await supabaseAdmin.from("campeonatos").delete().like("nombre", "__TEST_PUBBRK_%");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
