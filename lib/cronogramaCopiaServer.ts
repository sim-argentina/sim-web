import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMesVista, type MesVista } from "@/lib/cronogramaServer";
import { validarDia } from "@/lib/cronograma";
import {
  mapearSemana, mapearMes, fechasSemana, esLunes, weekday, ocurrencia,
  clasificar, normalizarNombrePlantilla, parseFecha, ymd,
  type DiaCmp,
} from "@/lib/cronogramaCopia";

// Copiar semanas/meses y aplicar plantillas (server-only). Reutiliza el comparador
// de conflictos (lib/cronogramaCopia) y aplica los días vía la RPC atómica
// multi-mes `cronograma_aplicar_dias` (crea borradores donde haga falta, rechaza
// confirmados, reactiva descartados, historial, NUNCA confirma). No copia la
// cobertura automática de Ramiro (getMesVista ya devuelve solo jornadas manuales).

export type Fail = { ok: false; status: number; error: string };
export type Ok<T> = { ok: true; data: T };

const AP_DEF = "10:00";
const CI_DEF = "22:00";

export type JorPrev = { empleado_id: string; nombre: string; hora_inicio: string; hora_fin: string; activo: boolean };
export type DiaPrev = { cerrado: boolean; apertura: string; cierre: string; jornadas: JorPrev[] };
export type ClaseFila = "sin_cambios" | "solo_propuesta" | "solo_destino" | "diferente" | "sin_equivalente" | "sin_datos_origen";
export type Fila = { destino: string; origen: string | null; clase: ClaseFila; actual: DiaPrev | null; propuesta: DiaPrev | null; decision: "actual" | "propuesta" | null };
export type Incidencia = { tipo: string; severidad: "bloqueante" | "advertencia"; detalle: string; fecha?: string };
export type Preview = {
  clase_op: "semana" | "mes" | "plantilla_semanal" | "plantilla_mensual";
  origen_no_oficial: boolean;
  meses_destino: Array<{ anio: number; mes: number; estado: string }>;
  bloqueado: { anio: number; mes: number } | null;
  incidencias: Incidencia[];
  filas: Fila[];
  solo_origen: string[];
};

const hhmm = (t: string) => String(t).slice(0, 5);
const cmp = (d: DiaPrev): DiaCmp => ({ cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas.map((j) => ({ key: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })) });
const esVacioDefault = (d: DiaPrev) => !d.cerrado && d.apertura === AP_DEF && d.cierre === CI_DEF && d.jornadas.length === 0;

function vistaToPrev(dia: MesVista["dias"][number]): DiaPrev {
  return { cerrado: dia.cerrado, apertura: hhmm(dia.apertura), cierre: hhmm(dia.cierre), jornadas: dia.jornadas.map((j) => ({ empleado_id: j.empleado_id, nombre: j.nombre, hora_inicio: hhmm(j.hora_inicio), hora_fin: hhmm(j.hora_fin), activo: j.empleado_activo })) };
}

// Cache de vistas de mes por 'anio-mes'.
type Cache = Map<string, MesVista>;
async function vista(cache: Cache, anio: number, mes: number): Promise<MesVista> {
  const k = `${anio}-${mes}`;
  let v = cache.get(k);
  if (!v) { v = await getMesVista(anio, mes); cache.set(k, v); }
  return v;
}
const mapaDias = (v: MesVista) => new Map(v.dias.map((d) => [d.fecha, vistaToPrev(d)]));

function clasificarFila(actual: DiaPrev | null, propuesta: DiaPrev | null): ClaseFila {
  if (!propuesta && !actual) return "sin_cambios";
  if (!propuesta) return "solo_destino";
  if (!actual) return esVacioDefault(propuesta) ? "sin_cambios" : "solo_propuesta";
  return clasificar(cmp(actual), cmp(propuesta)) === "sin_cambios" ? "sin_cambios" : "diferente";
}

// Entrada normalizada para el motor: cada destino con su propuesta (o sin datos).
type Entrada = { destino: string; origen: string | null; propuesta: DiaPrev | null; sinDatos: boolean };

async function finalizarPreview(
  clase_op: Preview["clase_op"],
  entradas: Entrada[],
  solo_origen: string[],
  origen_no_oficial: boolean,
  cache: Cache,
): Promise<Preview> {
  const mesesSet = new Map<string, { anio: number; mes: number }>();
  for (const e of entradas) { const p = parseFecha(e.destino)!; mesesSet.set(`${p.y}-${p.m}`, { anio: p.y, mes: p.m }); }

  const meses_destino: Preview["meses_destino"] = [];
  let bloqueado: Preview["bloqueado"] = null;
  const actualPorFecha = new Map<string, DiaPrev>();
  for (const { anio, mes } of mesesSet.values()) {
    const v = await vista(cache, anio, mes);
    meses_destino.push({ anio, mes, estado: v.estado });
    if (v.estado === "confirmado" && !bloqueado) bloqueado = { anio, mes };
    for (const [f, d] of mapaDias(v)) actualPorFecha.set(f, d);
  }

  const incidencias: Incidencia[] = [];
  const filas: Fila[] = [];
  for (const e of entradas) {
    const actual = actualPorFecha.get(e.destino) ?? null;
    if (e.sinDatos) { filas.push({ destino: e.destino, origen: e.origen, clase: "sin_datos_origen", actual, propuesta: null, decision: null }); continue; }
    const clase = clasificarFila(actual, e.propuesta);
    filas.push({ destino: e.destino, origen: e.origen, clase, actual, propuesta: e.propuesta, decision: null });
    // Integrante archivado en la propuesta → incidencia bloqueante.
    if (e.propuesta && !e.propuesta.cerrado) {
      for (const j of e.propuesta.jornadas) {
        if (!j.activo) incidencias.push({ tipo: "integrante_archivado", severidad: "bloqueante", detalle: `Día ${e.destino}: "${j.nombre}" está archivado. Reemplazalo por un integrante activo antes de aplicar.`, fecha: e.destino });
      }
    }
  }
  if (bloqueado) incidencias.push({ tipo: "mes_confirmado", severidad: "bloqueante", detalle: `El mes destino ${bloqueado.mes}/${bloqueado.anio} está confirmado. Reabrilo como borrador antes de copiar.` });
  filas.sort((a, b) => a.destino.localeCompare(b.destino));

  return { clase_op, origen_no_oficial, meses_destino, bloqueado, incidencias, filas, solo_origen: solo_origen.slice().sort() };
}

// Aplica: valida bloqueos/conflictos/archivados, arma p_dias con las decisiones y
// llama a la RPC atómica. `reemplazos` sustituye integrantes archivados por activos.
async function finalizarAplicacion(
  preview: Preview,
  decisiones: Record<string, "actual" | "propuesta">,
  reemplazos: Record<string, string>,
  evento: "semana_copiada" | "mes_copiado" | "plantilla_aplicada",
  meta: Record<string, unknown>,
): Promise<Ok<{ dias: number }> | Fail> {
  if (preview.bloqueado) return { ok: false, status: 409, error: `El mes ${preview.bloqueado.mes}/${preview.bloqueado.anio} está confirmado. Reabrilo como borrador antes de aplicar.` };

  // Conflictos 'diferente' sin decisión → bloquea.
  for (const f of preview.filas) if (f.clase === "diferente" && !decisiones[f.destino]) return { ok: false, status: 409, error: `Resolvé el conflicto del día ${f.destino}.` };

  // Activos disponibles (para validar reemplazos).
  const { data: activos } = await supabaseAdmin.from("empleados").select("id").eq("activo", true);
  const activosSet = new Set((activos ?? []).map((a) => a.id as string));

  const pDias: Array<Record<string, unknown>> = [];
  for (const f of preview.filas) {
    let usar: DiaPrev | null = null;
    if (f.clase === "solo_propuesta") usar = f.propuesta;
    else if (f.clase === "diferente" && decisiones[f.destino] === "propuesta") usar = f.propuesta;
    // sin_cambios / solo_destino / sin_equivalente / sin_datos_origen / diferente(actual) → no se escribe
    if (!usar) continue;

    const p = parseFecha(f.destino)!;
    const jornadas: Array<{ empleado_id: string; hora_inicio: string; hora_fin: string }> = [];
    if (!usar.cerrado) {
      for (const j of usar.jornadas) {
        let emp = j.empleado_id;
        if (!activosSet.has(emp)) {
          const rep = reemplazos[emp];
          if (rep && activosSet.has(rep)) emp = rep;
          else return { ok: false, status: 409, error: `Reemplazá al integrante archivado del día ${f.destino} por uno activo.` };
        }
        jornadas.push({ empleado_id: emp, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin });
      }
    }
    const val = validarDia({ cerrado: usar.cerrado, apertura: usar.apertura, cierre: usar.cierre, jornadas });
    if (!val.ok) return { ok: false, status: 400, error: `Día ${f.destino}: ${val.error}` };
    pDias.push({ anio: p.y, mes: p.m, fecha: f.destino, cerrado: val.dia.cerrado, apertura: val.dia.apertura, cierre: val.dia.cierre, jornadas: val.dia.jornadas });
  }

  if (pDias.length === 0) return { ok: true, data: { dias: 0 } };

  const { error } = await supabaseAdmin.rpc("cronograma_aplicar_dias", { p_dias: pDias, p_evento: evento, p_meta: meta });
  if (error) {
    const code = (error as { code?: string; message?: string }).code;
    const msg = (error as { message?: string }).message ?? "";
    if (code === "22023" && /mes_confirmado/.test(msg)) return { ok: false, status: 409, error: "Un mes destino está confirmado. Reabrilo como borrador." };
    if (code === "23514") return { ok: false, status: 409, error: "Hay integrantes inactivos en la copia." };
    if (code === "23P01") return { ok: false, status: 409, error: "Superposición de jornadas del mismo integrante." };
    if (code === "22007") return { ok: false, status: 400, error: "Una fecha no pertenece a su mes." };
    return { ok: false, status: 500, error: "No se pudo aplicar la operación." };
  }
  return { ok: true, data: { dias: pDias.length } };
}

// ── Origen: día propuesto desde una vista de mes (o vacío-default si no hay fila) ──
function propuestaDesdeVista(v: MesVista, fecha: string): DiaPrev | null {
  if (v.estado === "inexistente") return null; // sin datos en origen
  const d = v.dias.find((x) => x.fecha === fecha);
  if (d) return vistaToPrev(d);
  return { cerrado: false, apertura: hhmm(v.apertura_default), cierre: hhmm(v.cierre_default), jornadas: [] };
}

// ── COPIAR SEMANA ─────────────────────────────────────────────────────────────
export async function previsualizarCopiaSemana(lunesOrigen: string, lunesDestino: string): Promise<Ok<Preview> | Fail> {
  if (!esLunes(lunesOrigen) || !esLunes(lunesDestino)) return { ok: false, status: 400, error: "Elegí lunes de origen y destino válidos." };
  const cache: Cache = new Map();
  const pares = mapearSemana(lunesOrigen, lunesDestino);
  let noOficial = false;
  const entradas: Entrada[] = [];
  for (const { origen, destino } of pares) {
    const po = parseFecha(origen)!;
    const vo = await vista(cache, po.y, po.m);
    if (vo.estado === "borrador") noOficial = true;
    const sinDatos = vo.estado === "inexistente";
    entradas.push({ destino, origen, propuesta: sinDatos ? null : propuestaDesdeVista(vo, origen), sinDatos });
  }
  return { ok: true, data: await finalizarPreview("semana", entradas, [], noOficial, cache) };
}

export async function aplicarCopiaSemana(lunesOrigen: string, lunesDestino: string, decisiones: Record<string, "actual" | "propuesta">): Promise<Ok<{ dias: number }> | Fail> {
  const prev = await previsualizarCopiaSemana(lunesOrigen, lunesDestino);
  if (!prev.ok) return prev;
  return finalizarAplicacion(prev.data, decisiones, {}, "semana_copiada", { origen: lunesOrigen, destino: lunesDestino });
}

// ── COPIAR MES ────────────────────────────────────────────────────────────────
export async function previsualizarCopiaMes(anioO: number, mesO: number, anioD: number, mesD: number): Promise<Ok<Preview> | Fail> {
  const cache: Cache = new Map();
  const vo = await vista(cache, anioO, mesO);
  if (vo.estado === "inexistente") return { ok: false, status: 400, error: "El mes de origen no tiene cronograma." };
  const map = mapearMes(anioO, mesO, anioD, mesD);
  const entradas: Entrada[] = map.pares.map((p) => ({ destino: p.destino, origen: p.origen, propuesta: propuestaDesdeVista(vo, p.origen), sinDatos: false }));
  // Días de destino sin equivalente en origen → 'sin_equivalente' (se conservan).
  for (const f of map.soloDestino) entradas.push({ destino: f, origen: null, propuesta: null, sinDatos: false });
  const prev = await finalizarPreview("mes", entradas, map.soloOrigen, vo.estado === "borrador", cache);
  // Reclasificar los soloDestino a 'sin_equivalente' (propuesta null + actual presente/ausente).
  for (const fila of prev.filas) if (fila.origen === null && fila.propuesta === null && !map.soloOrigen.includes(fila.destino)) fila.clase = "sin_equivalente";
  return { ok: true, data: prev };
}

export async function aplicarCopiaMes(anioO: number, mesO: number, anioD: number, mesD: number, decisiones: Record<string, "actual" | "propuesta">): Promise<Ok<{ dias: number }> | Fail> {
  const prev = await previsualizarCopiaMes(anioO, mesO, anioD, mesD);
  if (!prev.ok) return prev;
  return finalizarAplicacion(prev.data, decisiones, {}, "mes_copiado", { origen: `${anioO}-${mesO}`, destino: `${anioD}-${mesD}` });
}

// ── PLANTILLAS ────────────────────────────────────────────────────────────────
export type PlantillaRow = {
  id: string; tipo: "semanal" | "mensual"; nombre: string; nombre_normalizado: string;
  contenido: unknown; activo: boolean; actor: string; created_at: string; updated_at: string;
};
type SnapDia = { cerrado: boolean; apertura: string; cierre: string; jornadas: Array<{ empleado_id: string; hora_inicio: string; hora_fin: string }> };
type ContenidoSemanal = { tipo: "semanal"; dias: Array<{ weekday: number; presente: boolean } & Partial<SnapDia>> };
type ContenidoMensual = { tipo: "mensual"; celdas: Array<{ weekday: number; ocurrencia: number } & SnapDia> };

function snapDesdePrev(d: DiaPrev): SnapDia {
  return { cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas.map((j) => ({ empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })) };
}

// Construye el snapshot leyendo el cronograma fuente (server, no cliente).
async function snapshotSemanal(lunes: string): Promise<ContenidoSemanal | Fail> {
  if (!esLunes(lunes)) return { ok: false, status: 400, error: "Elegí un lunes válido." };
  const cache: Cache = new Map();
  const dias: ContenidoSemanal["dias"] = [];
  for (const fecha of fechasSemana(lunes)) {
    const p = parseFecha(fecha)!;
    const v = await vista(cache, p.y, p.m);
    const wd = weekday(fecha);
    if (v.estado === "inexistente") { dias.push({ weekday: wd, presente: false }); continue; }
    dias.push({ weekday: wd, presente: true, ...snapDesdePrev(propuestaDesdeVista(v, fecha)!) });
  }
  return { tipo: "semanal", dias };
}
async function snapshotMensual(anio: number, mes: number): Promise<ContenidoMensual | Fail> {
  const v = await getMesVista(anio, mes);
  if (v.estado === "inexistente") return { ok: false, status: 400, error: "El mes de origen no tiene cronograma." };
  const celdas: ContenidoMensual["celdas"] = [];
  const total = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  for (let d = 1; d <= total; d++) {
    const fecha = ymd(anio, mes, d);
    celdas.push({ weekday: weekday(fecha), ocurrencia: ocurrencia(fecha), ...snapDesdePrev(propuestaDesdeVista(v, fecha)!) });
  }
  return { tipo: "mensual", celdas };
}

export async function crearPlantilla(tipo: "semanal" | "mensual", nombre: string, origen: { lunes?: string; anio?: number; mes?: number }): Promise<Ok<PlantillaRow> | Fail> {
  const nom = String(nombre ?? "").trim();
  if (nom.length < 1 || nom.length > 80) return { ok: false, status: 400, error: "El nombre debe tener entre 1 y 80 caracteres." };
  const norm = normalizarNombrePlantilla(nom);
  let contenido: unknown;
  if (tipo === "semanal") {
    if (!origen.lunes) return { ok: false, status: 400, error: "Elegí la semana de origen." };
    const snap = await snapshotSemanal(origen.lunes);
    if ("ok" in snap && snap.ok === false) return snap;
    contenido = snap;
  } else {
    if (!origen.anio || !origen.mes) return { ok: false, status: 400, error: "Elegí el mes de origen." };
    const snap = await snapshotMensual(origen.anio, origen.mes);
    if ("ok" in snap && snap.ok === false) return snap;
    contenido = snap;
  }
  const { data, error } = await supabaseAdmin.rpc("cronograma_plantilla_crear", { p_tipo: tipo, p_nombre: nom, p_nombre_norm: norm, p_contenido: contenido });
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, status: 409, error: "Ya existe una plantilla activa de ese tipo con ese nombre." };
    return { ok: false, status: 500, error: "No se pudo crear la plantilla." };
  }
  return { ok: true, data: data as PlantillaRow };
}

export async function listarPlantillas(): Promise<{ activas: PlantillaRow[]; archivadas: PlantillaRow[] }> {
  const { data, error } = await supabaseAdmin.from("cronograma_plantillas").select("id, tipo, nombre, nombre_normalizado, activo, actor, created_at, updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as PlantillaRow[];
  return { activas: rows.filter((r) => r.activo), archivadas: rows.filter((r) => !r.activo) };
}

export async function getPlantilla(id: string): Promise<PlantillaRow | null> {
  const { data, error } = await supabaseAdmin.from("cronograma_plantillas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PlantillaRow) ?? null;
}

export async function renombrarPlantilla(id: string, nombre: string): Promise<Ok<PlantillaRow> | Fail> {
  const nom = String(nombre ?? "").trim();
  if (nom.length < 1 || nom.length > 80) return { ok: false, status: 400, error: "El nombre debe tener entre 1 y 80 caracteres." };
  const { data, error } = await supabaseAdmin.rpc("cronograma_plantilla_renombrar", { p_id: id, p_nombre: nom, p_nombre_norm: normalizarNombrePlantilla(nom) });
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, status: 409, error: "Ya existe una plantilla activa de ese tipo con ese nombre." };
    if ((error as { code?: string }).code === "P0002") return { ok: false, status: 404, error: "Plantilla no encontrada." };
    return { ok: false, status: 500, error: "No se pudo renombrar." };
  }
  return { ok: true, data: data as PlantillaRow };
}

export async function actualizarPlantilla(id: string, origen: { lunes?: string; anio?: number; mes?: number }): Promise<Ok<PlantillaRow> | Fail> {
  const pl = await getPlantilla(id);
  if (!pl) return { ok: false, status: 404, error: "Plantilla no encontrada." };
  let contenido: unknown;
  if (pl.tipo === "semanal") {
    if (!origen.lunes) return { ok: false, status: 400, error: "Elegí la semana de origen." };
    const snap = await snapshotSemanal(origen.lunes);
    if ("ok" in snap && snap.ok === false) return snap;
    contenido = snap;
  } else {
    if (!origen.anio || !origen.mes) return { ok: false, status: 400, error: "Elegí el mes de origen." };
    const snap = await snapshotMensual(origen.anio, origen.mes);
    if ("ok" in snap && snap.ok === false) return snap;
    contenido = snap;
  }
  const { data, error } = await supabaseAdmin.rpc("cronograma_plantilla_actualizar", { p_id: id, p_contenido: contenido });
  if (error) return { ok: false, status: 500, error: "No se pudo actualizar la plantilla." };
  return { ok: true, data: data as PlantillaRow };
}

export async function estadoPlantilla(id: string, activo: boolean): Promise<Ok<PlantillaRow> | Fail> {
  const { data, error } = await supabaseAdmin.rpc("cronograma_plantilla_estado", { p_id: id, p_activo: activo });
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, status: 409, error: "Ya hay una plantilla activa de ese tipo con ese nombre. Renombrá antes de reactivar." };
    if ((error as { code?: string }).code === "P0002") return { ok: false, status: 404, error: "Plantilla no encontrada." };
    return { ok: false, status: 500, error: "No se pudo cambiar el estado." };
  }
  return { ok: true, data: data as PlantillaRow };
}

// Convierte el snapshot de una plantilla en entradas (destino→propuesta) + nombres.
async function entradasPlantilla(pl: PlantillaRow, destino: { lunes?: string; anio?: number; mes?: number }): Promise<{ entradas: Entrada[]; solo_origen: string[] } | Fail> {
  // Nombres actuales de los empleados referenciados (para mostrar + estado activo).
  const cont = pl.contenido as ContenidoSemanal | ContenidoMensual;
  const empIds = new Set<string>();
  if (cont.tipo === "semanal") {
    for (const d of cont.dias) if (d.presente) for (const j of d.jornadas ?? []) empIds.add(j.empleado_id);
  } else {
    for (const c of cont.celdas) for (const j of c.jornadas) empIds.add(j.empleado_id);
  }
  const { data: emps } = await supabaseAdmin.from("empleados").select("id, nombre_formal, activo").in("id", [...empIds]);
  const nom = new Map((emps ?? []).map((e) => [e.id as string, { nombre: e.nombre_formal as string, activo: e.activo as boolean }]));
  const jorPrev = (js: Array<{ empleado_id: string; hora_inicio: string; hora_fin: string }>): JorPrev[] =>
    js.map((j) => ({ empleado_id: j.empleado_id, nombre: nom.get(j.empleado_id)?.nombre ?? "—", hora_inicio: j.hora_inicio, hora_fin: j.hora_fin, activo: nom.get(j.empleado_id)?.activo ?? false }));

  if (cont.tipo === "semanal") {
    if (!destino.lunes || !esLunes(destino.lunes)) return { ok: false, status: 400, error: "Elegí un lunes de destino válido." };
    const fechas = fechasSemana(destino.lunes);
    const porWd = new Map(cont.dias.map((d) => [d.weekday, d]));
    const entradas: Entrada[] = fechas.map((fecha) => {
      const snap = porWd.get(weekday(fecha));
      if (!snap || !snap.presente) return { destino: fecha, origen: null, propuesta: null, sinDatos: true };
      return { destino: fecha, origen: null, propuesta: { cerrado: snap.cerrado!, apertura: snap.apertura!, cierre: snap.cierre!, jornadas: jorPrev(snap.jornadas ?? []) }, sinDatos: false };
    });
    return { entradas, solo_origen: [] };
  }
  // mensual
  if (!destino.anio || !destino.mes) return { ok: false, status: 400, error: "Elegí el mes de destino." };
  const total = new Date(Date.UTC(destino.anio, destino.mes, 0)).getUTCDate();
  const destPorKey = new Map<string, string>();
  for (let d = 1; d <= total; d++) { const fecha = ymd(destino.anio, destino.mes, d); destPorKey.set(`${weekday(fecha)}-${ocurrencia(fecha)}`, fecha); }
  const entradas: Entrada[] = [];
  const usadas = new Set<string>();
  const solo_origen: string[] = [];
  for (const c of cont.celdas) {
    const fecha = destPorKey.get(`${c.weekday}-${c.ocurrencia}`);
    if (!fecha) { solo_origen.push(`${c.weekday}-${c.ocurrencia}`); continue; }
    usadas.add(fecha);
    entradas.push({ destino: fecha, origen: null, propuesta: { cerrado: c.cerrado, apertura: c.apertura, cierre: c.cierre, jornadas: jorPrev(c.jornadas) }, sinDatos: false });
  }
  // Días de destino sin celda equivalente → sin_equivalente (se conservan).
  for (const fecha of destPorKey.values()) if (!usadas.has(fecha)) entradas.push({ destino: fecha, origen: null, propuesta: null, sinDatos: false });
  return { entradas, solo_origen };
}

export async function previsualizarPlantilla(id: string, destino: { lunes?: string; anio?: number; mes?: number }): Promise<Ok<Preview & { plantilla: { id: string; nombre: string; tipo: string } }> | Fail> {
  const pl = await getPlantilla(id);
  if (!pl) return { ok: false, status: 404, error: "Plantilla no encontrada." };
  const built = await entradasPlantilla(pl, destino);
  if ("ok" in built && built.ok === false) return built;
  const { entradas, solo_origen } = built as { entradas: Entrada[]; solo_origen: string[] };
  const cache: Cache = new Map();
  const prev = await finalizarPreview(pl.tipo === "semanal" ? "plantilla_semanal" : "plantilla_mensual", entradas, solo_origen, false, cache);
  for (const fila of prev.filas) if (fila.origen === null && fila.propuesta === null && fila.clase === "solo_destino") fila.clase = "sin_equivalente";
  return { ok: true, data: { ...prev, plantilla: { id: pl.id, nombre: pl.nombre, tipo: pl.tipo } } };
}

export async function aplicarPlantilla(id: string, destino: { lunes?: string; anio?: number; mes?: number }, decisiones: Record<string, "actual" | "propuesta">, reemplazos: Record<string, string>): Promise<Ok<{ dias: number }> | Fail> {
  const prev = await previsualizarPlantilla(id, destino);
  if (!prev.ok) return prev;
  return finalizarAplicacion(prev.data, decisiones, reemplazos ?? {}, "plantilla_aplicada", { plantilla_id: id, destino });
}
