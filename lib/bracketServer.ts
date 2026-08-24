// Orquestación servidor del motor de brackets: combina el motor puro
// (lib/bracketEngine) con la persistencia (supabaseAdmin). Solo se usa desde route
// handlers admin/staff. Idempotencia y concurrencia se apoyan en los UNIQUE de la
// migración (bracket por campeonato, ronda por número, participante por ronda).
// Solo se importa desde route handlers (server): usa supabaseAdmin (service_role).
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  configEliminacion,
  validarConfigEliminacion,
  calcularSeeds,
  armarPrimeraRonda,
  armarSiguienteRonda,
  clasificadosDeCarrera,
  validarResultadoCarrera,
  calcularPodio,
  esGranFinal,
  type ConfigEliminacion,
  type ParticipanteQuali,
  type Clasificado,
  type PlanRonda,
  type ResultadoParticipante,
} from "@/lib/bracketEngine";

export type Rol = "admin" | "staff";
export type Resultado<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Resultado<never> => ({ ok: false, status, error });
const ok = <T>(data: T): Resultado<T> => ({ ok: true, data });

type CampeonatoRow = {
  id: string;
  nombre: string;
  modalidad: string | null;
  usa_ronda_preliminar: boolean | null;
  config: Record<string, unknown> | null;
  deleted_at: string | null;
};

// Carga un campeonato de modalidad eliminación (no archivado). Base de todo.
export async function cargarCampeonatoEliminacion(
  campeonatoId: string,
): Promise<Resultado<CampeonatoRow>> {
  const { data } = await supabaseAdmin
    .from("campeonatos")
    .select("id, nombre, modalidad, usa_ronda_preliminar, config, deleted_at")
    .eq("id", campeonatoId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return fail(404, "Campeonato no encontrado.");
  if (data.modalidad !== "eliminacion") {
    return fail(400, "El campeonato no es de modalidad eliminación.");
  }
  return ok(data as CampeonatoRow);
}

// Inscripciones VÁLIDAS del campeonato: pagadas y no eliminadas. Fuente de pilotos.
async function inscripcionesValidas(campeonatoId: string) {
  const { data } = await supabaseAdmin
    .from("campeonato_inscripciones")
    .select("id, nombre_completo, created_at")
    .eq("campeonato_id", campeonatoId)
    .eq("estado_pago", "pagado")
    .is("eliminada_at", null)
    .order("created_at", { ascending: true });
  return data ?? [];
}

// get-or-create de la fila de estado del bracket (idempotente por UNIQUE campeonato_id).
async function ensureBracket(camp: CampeonatoRow) {
  const cfg = configEliminacion(camp);
  const { data } = await supabaseAdmin
    .from("campeonato_bracket")
    .select("*")
    .eq("campeonato_id", camp.id)
    .maybeSingle();
  if (data) return data;
  const { data: creado, error } = await supabaseAdmin
    .from("campeonato_bracket")
    .insert({
      campeonato_id: camp.id,
      clasificacion_habilitada: cfg.clasificacion.habilitada,
      seeding_modo: cfg.clasificacion.habilitada ? "clasificacion" : "manual",
    })
    .select("*")
    .single();
  if (error) {
    // Posible inserción concurrente → releer.
    const { data: again } = await supabaseAdmin
      .from("campeonato_bracket").select("*").eq("campeonato_id", camp.id).maybeSingle();
    return again;
  }
  return creado;
}

// Mientras la clasificación está abierta, asegura una fila de participante por cada
// inscripción válida (nuevas inscripciones aparecen hasta cerrar). No auto-agrega
// tras el cierre (§41).
async function sincronizarParticipantes(bracketId: string, campeonatoId: string) {
  const inscripciones = await inscripcionesValidas(campeonatoId);
  const { data: existentes } = await supabaseAdmin
    .from("campeonato_bracket_participantes")
    .select("inscripcion_id")
    .eq("bracket_id", bracketId);
  const yaHay = new Set((existentes ?? []).map((e) => e.inscripcion_id));
  const nuevos = inscripciones
    .filter((i) => !yaHay.has(i.id))
    .map((i, idx) => ({
      bracket_id: bracketId,
      inscripcion_id: i.id,
      orden_inscripcion: yaHay.size + idx,
    }));
  if (nuevos.length) {
    await supabaseAdmin.from("campeonato_bracket_participantes").insert(nuevos);
  }
}

// ── Estado completo (para la UI) ──────────────────────────────────────────────

export async function obtenerEstado(campeonatoId: string): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const cfg = configEliminacion(camp.data);
  const configValida = validarConfigEliminacion(cfg);

  const bracket = await ensureBracket(camp.data);
  if (!bracket) return fail(500, "No se pudo inicializar el bracket.");

  if (bracket.estado === "clasificacion") {
    await sincronizarParticipantes(bracket.id, campeonatoId);
  }

  const nombres = new Map<string, string>();
  (await inscripcionesValidas(campeonatoId)).forEach((i) => nombres.set(i.id, i.nombre_completo));
  // Nombres también de inscripciones ya no "válidas" pero presentes en el bracket.
  const [{ data: participantes }, { data: rondas }, { data: carreras }, { data: cps }] =
    await Promise.all([
      supabaseAdmin.from("campeonato_bracket_participantes").select("*").eq("bracket_id", bracket.id),
      supabaseAdmin.from("campeonato_bracket_rondas").select("*").eq("bracket_id", bracket.id).order("numero"),
      supabaseAdmin.from("campeonato_bracket_carreras").select("*").eq("bracket_id", bracket.id).order("numero"),
      supabaseAdmin.from("campeonato_bracket_carrera_participantes").select("*").eq("bracket_id", bracket.id),
    ]);

  const faltantes = new Set<string>();
  (participantes ?? []).forEach((p) => { if (!nombres.has(p.inscripcion_id)) faltantes.add(p.inscripcion_id); });
  (cps ?? []).forEach((p) => { if (!nombres.has(p.inscripcion_id)) faltantes.add(p.inscripcion_id); });
  if (faltantes.size) {
    const { data: extra } = await supabaseAdmin
      .from("campeonato_inscripciones").select("id, nombre_completo").in("id", Array.from(faltantes));
    (extra ?? []).forEach((i) => nombres.set(i.id, i.nombre_completo));
  }

  const cpsPorCarrera = new Map<string, typeof cps>();
  (cps ?? []).forEach((cp) => {
    const arr = cpsPorCarrera.get(cp.carrera_id) ?? [];
    arr.push(cp);
    cpsPorCarrera.set(cp.carrera_id, arr);
  });
  const carrerasPorRonda = new Map<string, typeof carreras>();
  (carreras ?? []).forEach((c) => {
    const arr = carrerasPorRonda.get(c.ronda_id) ?? [];
    arr.push(c);
    carrerasPorRonda.set(c.ronda_id, arr);
  });

  const rondasDto = (rondas ?? []).map((r) => ({
    ...r,
    carreras: (carrerasPorRonda.get(r.id) ?? [])
      .sort((a, b) => a.numero - b.numero)
      .map((c) => ({
        ...c,
        participantes: (cpsPorCarrera.get(c.id) ?? [])
          .map((cp) => ({ ...cp, nombre: nombres.get(cp.inscripcion_id) ?? "—" }))
          .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999)),
      })),
  }));

  const participantesDto = (participantes ?? [])
    .map((p) => ({ ...p, nombre: nombres.get(p.inscripcion_id) ?? "—" }))
    .sort((a, b) => {
      if (a.seed != null && b.seed != null) return a.seed - b.seed;
      if (a.seed != null) return -1;
      if (b.seed != null) return 1;
      return (a.mejor_ms ?? Infinity) - (b.mejor_ms ?? Infinity);
    });

  const premios = (camp.data.config as { premios?: unknown })?.premios ?? null;
  const podioNombres = Array.isArray(bracket.podio)
    ? (bracket.podio as Array<{ puesto: number; inscripcion_id: string }>).map((p) => ({
        ...p, nombre: nombres.get(p.inscripcion_id) ?? "—",
      }))
    : null;

  return ok({
    campeonato: { id: camp.data.id, nombre: camp.data.nombre, usa_ronda_preliminar: camp.data.usa_ronda_preliminar },
    cfg,
    configValida,
    premios,
    bracket: {
      id: bracket.id, estado: bracket.estado, seeding_modo: bracket.seeding_modo,
      clasificacion_habilitada: bracket.clasificacion_habilitada, podio: podioNombres,
    },
    participantes: participantesDto,
    rondas: rondasDto,
  });
}

// ── Clasificación (staff) ─────────────────────────────────────────────────────

// Guarda quali de un participante: presente, mejor tiempo (único) e incluido.
// Solo con la clasificación abierta.
export async function guardarQuali(
  campeonatoId: string,
  participanteId: string,
  patch: { presente?: boolean; incluido?: boolean; mejor_ms?: number | null },
): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id,estado").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  if (br.estado !== "clasificacion") return fail(409, "La clasificación ya fue cerrada.");

  const { data: part } = await supabaseAdmin
    .from("campeonato_bracket_participantes").select("*").eq("id", participanteId).eq("bracket_id", br.id).maybeSingle();
  if (!part) return fail(404, "Participante no encontrado.");

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.presente === "boolean") {
    updates.presente = patch.presente;
    updates.estado = patch.presente ? "activo" : "ausente";
  }
  if (typeof patch.incluido === "boolean") updates.incluido = patch.incluido;
  if ("mejor_ms" in patch) {
    updates.mejor_ms = patch.mejor_ms != null && Number.isFinite(Number(patch.mejor_ms)) ? Math.round(Number(patch.mejor_ms)) : null;
  }
  const { data, error } = await supabaseAdmin
    .from("campeonato_bracket_participantes").update(updates).eq("id", participanteId).select("*").single();
  if (error) return fail(500, "No se pudo guardar la clasificación.");
  return ok(data);
}

// Seeding manual (admin): asigna seeds según el orden recibido (array de participante ids).
export async function seedManual(campeonatoId: string, ordenParticipanteIds: string[]): Promise<Resultado<unknown>> {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id,estado").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  if (br.estado !== "clasificacion") return fail(409, "La clasificación ya fue cerrada.");
  let seed = 1;
  for (const pid of ordenParticipanteIds) {
    await supabaseAdmin.from("campeonato_bracket_participantes")
      .update({ seed: seed++, updated_at: new Date().toISOString() })
      .eq("id", pid).eq("bracket_id", br.id).eq("presente", true);
  }
  await supabaseAdmin.from("campeonato_bracket").update({ seeding_modo: "manual", updated_at: new Date().toISOString() }).eq("id", br.id);
  return ok({ seeds: ordenParticipanteIds.length });
}

// Cerrar clasificación (admin): congela seeds y bloquea cambios. Idempotente.
export async function cerrarClasificacion(campeonatoId: string): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("*").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  if (br.estado !== "clasificacion") return ok({ estado: br.estado }); // idempotente

  const { data: parts } = await supabaseAdmin
    .from("campeonato_bracket_participantes").select("*").eq("bracket_id", br.id);
  const quali: ParticipanteQuali[] = (parts ?? []).map((p) => ({
    inscripcion_id: p.inscripcion_id,
    presente: p.presente,
    incluido: p.incluido,
    mejor_ms: p.mejor_ms != null ? Number(p.mejor_ms) : null,
    orden_inscripcion: p.orden_inscripcion ?? 0,
  }));
  const seeds = calcularSeeds(quali);
  const seedById = new Map(seeds.map((s) => [s.inscripcion_id, s.seed]));

  // Congelar seed en cada participante; excluidos/ausentes → seed null.
  for (const p of parts ?? []) {
    const s = seedById.get(p.inscripcion_id) ?? null;
    await supabaseAdmin.from("campeonato_bracket_participantes")
      .update({ seed: s, estado: s == null ? (p.presente ? "excluido" : "ausente") : "activo", updated_at: new Date().toISOString() })
      .eq("id", p.id);
  }
  await supabaseAdmin.from("campeonato_bracket")
    .update({ estado: "cerrada", cerrada_at: new Date().toISOString(), config_snapshot: configEliminacion(camp.data), updated_at: new Date().toISOString() })
    .eq("id", br.id);
  return ok({ seeds: seeds.length });
}

// Reabrir clasificación (admin): solo si no empezó ninguna carrera.
export async function reabrirClasificacion(campeonatoId: string): Promise<Resultado<unknown>> {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id,estado").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  if (br.estado === "clasificacion") return ok({ estado: "clasificacion" });
  const { count } = await supabaseAdmin
    .from("campeonato_bracket_carreras").select("id", { count: "exact", head: true })
    .eq("bracket_id", br.id).neq("estado", "pendiente");
  if ((count ?? 0) > 0) return fail(409, "No se puede reabrir: ya hay carreras iniciadas.");
  // Borra rondas/carreras generadas (aún sin iniciar) y vuelve a clasificación.
  await supabaseAdmin.from("campeonato_bracket_rondas").delete().eq("bracket_id", br.id);
  await supabaseAdmin.from("campeonato_bracket").update({ estado: "clasificacion", cerrada_at: null, generado_at: null, updated_at: new Date().toISOString() }).eq("id", br.id);
  return ok({ estado: "clasificacion" });
}

// ── Generación de bracket ─────────────────────────────────────────────────────

function nombreRonda(plan: PlanRonda, numero: number, totalPrevio: number): string {
  if (plan.tipo === "final") return "Gran Final";
  void totalPrevio;
  return `Ronda ${numero}`;
}

async function persistirRonda(
  bracketId: string, numero: number, plan: PlanRonda, cfg: ConfigEliminacion,
): Promise<Resultado<{ ronda_id: string }>> {
  // Insert ronda: el UNIQUE(bracket_id,numero) evita duplicar la ronda (idempotencia/concurrencia).
  const { data: ronda, error: eR } = await supabaseAdmin
    .from("campeonato_bracket_rondas")
    .insert({ bracket_id: bracketId, numero, nombre: nombreRonda(plan, numero, 0), tipo: plan.tipo, estado: "lista" })
    .select("id").single();
  if (eR || !ronda) return fail(409, "La ronda ya existe o no se pudo crear.");

  for (let i = 0; i < plan.carreras.length; i++) {
    const c = plan.carreras[i];
    const { data: carrera, error: eC } = await supabaseAdmin
      .from("campeonato_bracket_carreras")
      .insert({ bracket_id: bracketId, ronda_id: ronda.id, numero: i + 1, vueltas: cfg.eliminatoria.vueltas, es_bye: c.es_bye, estado: c.es_bye ? "finalizada" : "pendiente", finished_at: c.es_bye ? new Date().toISOString() : null })
      .select("id").single();
    if (eC || !carrera) return fail(500, "No se pudo crear la carrera.");
    const filas = c.participantes.map((p) => ({
      bracket_id: bracketId, ronda_id: ronda.id, carrera_id: carrera.id,
      inscripcion_id: p.inscripcion_id, seed: p.seed,
      origen_carrera_id: p.origen_carrera_id ?? null, origen_posicion: p.origen_posicion ?? null,
      // BYE: el único participante clasifica automáticamente.
      posicion_final: c.es_bye ? 1 : null, clasifica: c.es_bye ? true : null,
    }));
    const { error: eP } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes").insert(filas);
    if (eP) return fail(409, "Conflicto de participantes (¿piloto repetido en la ronda?).");
  }
  return ok({ ronda_id: ronda.id });
}

// Generar el bracket (primera ronda). Admin. Idempotente: si ya existe la ronda 1, no duplica.
export async function generarBracket(campeonatoId: string): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const cfg = configEliminacion(camp.data);
  const val = validarConfigEliminacion(cfg);
  if (!val.ok) return fail(400, `La configuración de este campeonato no permite generar un bracket válido: ${val.error}`);

  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("*").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  if (br.estado === "clasificacion") return fail(409, "Primero cerrá la clasificación.");

  const { count: yaRondas } = await supabaseAdmin
    .from("campeonato_bracket_rondas").select("id", { count: "exact", head: true }).eq("bracket_id", br.id);
  if ((yaRondas ?? 0) > 0) return fail(409, "El bracket ya fue generado.");

  const { data: parts } = await supabaseAdmin
    .from("campeonato_bracket_participantes").select("*").eq("bracket_id", br.id).not("seed", "is", null).order("seed");
  const seeds = (parts ?? []).map((p) => ({ inscripcion_id: p.inscripcion_id, seed: p.seed as number, mejor_ms: p.mejor_ms }));
  if (seeds.length < 2) return fail(400, "Se necesitan al menos 2 participantes con seed para generar el bracket.");

  const plan = armarPrimeraRonda(seeds, cfg);
  const res = await persistirRonda(br.id, 1, plan, cfg);
  if (!res.ok) return res;
  await supabaseAdmin.from("campeonato_bracket")
    .update({ estado: "en_curso", generado_at: new Date().toISOString(), config_snapshot: cfg, updated_at: new Date().toISOString() })
    .eq("id", br.id);
  return ok({ ronda_id: res.data.ronda_id, carreras: plan.carreras.length, tipo: plan.tipo });
}

// ── Carreras ──────────────────────────────────────────────────────────────────

async function cargarCarrera(campeonatoId: string, carreraId: string) {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id,estado").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return null;
  const { data: carrera } = await supabaseAdmin.from("campeonato_bracket_carreras").select("*").eq("id", carreraId).eq("bracket_id", br.id).maybeSingle();
  if (!carrera) return null;
  return { br, carrera };
}

// Iniciar carrera (staff). Para esta fase: solo una carrera en curso por campeonato.
export async function iniciarCarrera(campeonatoId: string, carreraId: string): Promise<Resultado<unknown>> {
  const ctx = await cargarCarrera(campeonatoId, carreraId);
  if (!ctx) return fail(404, "Carrera no encontrada.");
  if (ctx.carrera.estado === "finalizada") return fail(409, "La carrera ya está finalizada.");
  if (ctx.carrera.estado === "en_curso") return ok({ estado: "en_curso" });
  const { count } = await supabaseAdmin.from("campeonato_bracket_carreras")
    .select("id", { count: "exact", head: true }).eq("bracket_id", ctx.br.id).eq("estado", "en_curso");
  if ((count ?? 0) > 0) return fail(409, "Ya hay una carrera en curso en este campeonato.");
  await supabaseAdmin.from("campeonato_bracket_carreras").update({ estado: "en_curso", started_at: new Date().toISOString() }).eq("id", carreraId);
  await supabaseAdmin.from("campeonato_bracket_rondas").update({ estado: "en_curso", started_at: new Date().toISOString() }).eq("id", ctx.carrera.ronda_id).eq("estado", "lista");
  return ok({ estado: "en_curso" });
}

// Guardar resultado parcial (staff): posiciones / DNF / DSQ / observación por participante.
export async function guardarResultadoCarrera(
  campeonatoId: string, carreraId: string,
  resultado: Array<{ participante_id: string; posicion_final?: number | null; estado?: string; observacion?: string | null }>,
): Promise<Resultado<unknown>> {
  const ctx = await cargarCarrera(campeonatoId, carreraId);
  if (!ctx) return fail(404, "Carrera no encontrada.");
  if (ctx.carrera.estado === "finalizada") return fail(409, "La carrera está finalizada; reabrila para editar.");
  for (const r of resultado) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("posicion_final" in r) updates.posicion_final = r.posicion_final == null ? null : Math.round(Number(r.posicion_final));
    if (r.estado && ["activo", "dnf", "dsq"].includes(r.estado)) updates.estado = r.estado;
    if ("observacion" in r) updates.observacion = r.observacion || null;
    await supabaseAdmin.from("campeonato_bracket_carrera_participantes")
      .update(updates).eq("id", r.participante_id).eq("carrera_id", carreraId);
  }
  return ok({ guardado: resultado.length });
}

// Finalizar carrera (staff): valida resultado, marca clasifican los primeros
// `avanzan_por_carrera`. Idempotente.
export async function finalizarCarrera(campeonatoId: string, carreraId: string): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const ctx = await cargarCarrera(campeonatoId, carreraId);
  if (!ctx) return fail(404, "Carrera no encontrada.");
  if (ctx.carrera.estado === "finalizada") return ok({ estado: "finalizada" }); // idempotente

  const cfg = configEliminacion(camp.data);
  const { data: cps } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes").select("*").eq("carrera_id", carreraId);
  const rows = cps ?? [];
  const ids = rows.map((r) => r.inscripcion_id);
  const resultado: ResultadoParticipante[] = rows.map((r) => ({
    inscripcion_id: r.inscripcion_id,
    posicion_final: Number(r.posicion_final),
    estado: (r.estado as ResultadoParticipante["estado"]) ?? "activo",
  }));
  const val = validarResultadoCarrera(ids, resultado);
  if (!val.ok) return fail(400, val.error);

  const clasifican = new Set(clasificadosDeCarrera(resultado, cfg.eliminatoria.avanzanPorCarrera).map((c) => c.inscripcion_id));
  for (const r of rows) {
    await supabaseAdmin.from("campeonato_bracket_carrera_participantes")
      .update({ clasifica: clasifican.has(r.inscripcion_id), updated_at: new Date().toISOString() })
      .eq("id", r.id);
  }
  await supabaseAdmin.from("campeonato_bracket_carreras").update({ estado: "finalizada", finished_at: new Date().toISOString() }).eq("id", carreraId);

  // Si es la Gran Final → podio + torneo finalizado.
  const { data: ronda } = await supabaseAdmin.from("campeonato_bracket_rondas").select("*").eq("id", ctx.carrera.ronda_id).maybeSingle();
  if (ronda?.tipo === "final") {
    const podio = calcularPodio(resultado);
    await supabaseAdmin.from("campeonato_bracket").update({ podio, estado: "finalizado", finalizado_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", ctx.br.id);
    await supabaseAdmin.from("campeonato_bracket_rondas").update({ estado: "finalizada", finished_at: new Date().toISOString() }).eq("id", ronda.id);
  } else {
    // ¿Todas las carreras de la ronda finalizadas? → ronda finalizada.
    await marcarRondaSiCompleta(ctx.carrera.ronda_id);
  }
  return ok({ estado: "finalizada", clasifican: clasifican.size });
}

async function marcarRondaSiCompleta(rondaId: string) {
  const { count: pendientes } = await supabaseAdmin.from("campeonato_bracket_carreras")
    .select("id", { count: "exact", head: true }).eq("ronda_id", rondaId).neq("estado", "finalizada");
  if ((pendientes ?? 0) === 0) {
    await supabaseAdmin.from("campeonato_bracket_rondas").update({ estado: "finalizada", finished_at: new Date().toISOString() }).eq("id", rondaId);
  }
}

// Reabrir carrera (admin) con protección downstream (§30).
export async function reabrirCarrera(campeonatoId: string, carreraId: string): Promise<Resultado<unknown>> {
  const ctx = await cargarCarrera(campeonatoId, carreraId);
  if (!ctx) return fail(404, "Carrera no encontrada.");
  const { data: ronda } = await supabaseAdmin.from("campeonato_bracket_rondas").select("numero").eq("id", ctx.carrera.ronda_id).maybeSingle();
  // ¿Existe una ronda posterior con alguna carrera ya iniciada? → bloquear.
  const { data: rondasPost } = await supabaseAdmin.from("campeonato_bracket_rondas")
    .select("id").eq("bracket_id", ctx.br.id).gt("numero", ronda?.numero ?? 0);
  if (rondasPost && rondasPost.length) {
    const ids = rondasPost.map((r) => r.id);
    const { count: iniciadas } = await supabaseAdmin.from("campeonato_bracket_carreras")
      .select("id", { count: "exact", head: true }).in("ronda_id", ids).neq("estado", "pendiente");
    if ((iniciadas ?? 0) > 0) {
      return fail(409, "No se puede reabrir: una ronda posterior ya comenzó. Reabrí/regenerá primero esa ronda.");
    }
    // Ronda posterior existe pero nadie empezó → se elimina para regenerar (confirmación explícita en la UI).
    await supabaseAdmin.from("campeonato_bracket_rondas").delete().in("id", ids);
    await supabaseAdmin.from("campeonato_bracket").update({ estado: "en_curso", podio: null, finalizado_at: null, updated_at: new Date().toISOString() }).eq("id", ctx.br.id);
  }
  await supabaseAdmin.from("campeonato_bracket_carrera_participantes").update({ clasifica: null, updated_at: new Date().toISOString() }).eq("carrera_id", carreraId);
  await supabaseAdmin.from("campeonato_bracket_carreras").update({ estado: "en_curso", finished_at: null }).eq("id", carreraId);
  await supabaseAdmin.from("campeonato_bracket_rondas").update({ estado: "en_curso", finished_at: null }).eq("id", ctx.carrera.ronda_id);
  return ok({ estado: "en_curso" });
}

// ── Siguiente ronda ───────────────────────────────────────────────────────────

export async function generarSiguienteRonda(campeonatoId: string, rondaId: string): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const cfg = configEliminacion(camp.data);
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id,estado").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  const { data: ronda } = await supabaseAdmin.from("campeonato_bracket_rondas").select("*").eq("id", rondaId).eq("bracket_id", br.id).maybeSingle();
  if (!ronda) return fail(404, "Ronda no encontrada.");
  if (ronda.tipo === "final") return fail(400, "La Gran Final no genera otra ronda.");

  // Todas las carreras de la ronda deben estar finalizadas.
  const { data: carreras } = await supabaseAdmin.from("campeonato_bracket_carreras").select("*").eq("ronda_id", rondaId);
  if (!carreras || carreras.some((c) => c.estado !== "finalizada")) {
    return fail(409, "Faltan carreras por finalizar en esta ronda.");
  }
  // ¿Ya existe la ronda siguiente? Idempotente.
  const { data: existeSig } = await supabaseAdmin.from("campeonato_bracket_rondas").select("id").eq("bracket_id", br.id).eq("numero", ronda.numero + 1).maybeSingle();
  if (existeSig) return ok({ ronda_id: existeSig.id, yaExistia: true });

  // Recolectar clasificados (clasifica=true) con su origen.
  const { data: cps } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes")
    .select("*").eq("ronda_id", rondaId).eq("clasifica", true);
  const clasificados: Clasificado[] = (cps ?? []).map((cp) => ({
    inscripcion_id: cp.inscripcion_id,
    seed: cp.seed ?? 9999,
    origen_carrera_id: cp.carrera_id,
    origen_posicion: cp.posicion_final ?? 1,
  }));
  if (clasificados.length < 2) return fail(400, "No hay suficientes clasificados para una nueva ronda.");

  const plan = armarSiguienteRonda(clasificados, cfg);
  const res = await persistirRonda(br.id, ronda.numero + 1, plan, cfg);
  if (!res.ok) return res;
  return ok({ ronda_id: res.data.ronda_id, carreras: plan.carreras.length, tipo: plan.tipo, esFinal: esGranFinal(clasificados.length, cfg) });
}

// Override manual de una ronda ANTES de que empiece (admin). Reemplaza la
// asignación de participantes por carrera. Valida: sin duplicados, sin perdidos,
// respeta el máximo, solo participantes de esa ronda.
export async function overrideRonda(
  campeonatoId: string, rondaId: string,
  asignacion: Array<{ carrera_id: string; inscripcion_ids: string[] }>,
): Promise<Resultado<unknown>> {
  const camp = await cargarCampeonatoEliminacion(campeonatoId);
  if (!camp.ok) return camp;
  const cfg = configEliminacion(camp.data);
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("id").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  const { data: carreras } = await supabaseAdmin.from("campeonato_bracket_carreras").select("*").eq("ronda_id", rondaId);
  if (!carreras || !carreras.length) return fail(404, "Ronda sin carreras.");
  if (carreras.some((c) => c.estado !== "pendiente")) return fail(409, "La ronda ya comenzó; no se puede reordenar.");

  const { data: cps } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes").select("*").eq("ronda_id", rondaId);
  const original = new Map((cps ?? []).map((p) => [p.inscripcion_id, p]));
  const carrerasValidas = new Set(carreras.map((c) => c.id));

  const vistos = new Set<string>();
  for (const a of asignacion) {
    if (!carrerasValidas.has(a.carrera_id)) return fail(400, "Carrera ajena a la ronda.");
    if (a.inscripcion_ids.length > cfg.eliminatoria.pilotosPorCarrera) return fail(400, "Una carrera supera el máximo de pilotos.");
    for (const id of a.inscripcion_ids) {
      if (!original.has(id)) return fail(400, "Participante ajeno a la ronda.");
      if (vistos.has(id)) return fail(400, "Piloto asignado dos veces.");
      vistos.add(id);
    }
  }
  if (vistos.size !== original.size) return fail(400, "Faltan pilotos por asignar (no se puede perder ninguno).");

  // Aplicar: mover cada participante a su nueva carrera. Se borra y reinserta para
  // respetar los UNIQUE (ronda_id,inscripcion_id) / (carrera_id,inscripcion_id).
  await supabaseAdmin.from("campeonato_bracket_carrera_participantes").delete().eq("ronda_id", rondaId);
  for (const a of asignacion) {
    const filas = a.inscripcion_ids.map((id) => {
      const o = original.get(id)!;
      return {
        bracket_id: br.id, ronda_id: rondaId, carrera_id: a.carrera_id, inscripcion_id: id,
        seed: o.seed, origen_carrera_id: o.origen_carrera_id, origen_posicion: o.origen_posicion,
      };
    });
    if (filas.length) {
      const { error } = await supabaseAdmin.from("campeonato_bracket_carrera_participantes").insert(filas);
      if (error) return fail(409, "Conflicto al aplicar el override.");
    }
  }
  return ok({ carreras: asignacion.length });
}

// Finalizar torneo manualmente (admin): si la final ya está finalizada, deja el
// estado como finalizado; si no, lo marca (sin borrar nada). Idempotente.
export async function finalizarTorneo(campeonatoId: string): Promise<Resultado<unknown>> {
  const { data: br } = await supabaseAdmin.from("campeonato_bracket").select("*").eq("campeonato_id", campeonatoId).maybeSingle();
  if (!br) return fail(404, "Bracket no inicializado.");
  await supabaseAdmin.from("campeonato_bracket").update({ estado: "finalizado", finalizado_at: br.finalizado_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", br.id);
  return ok({ estado: "finalizado" });
}
