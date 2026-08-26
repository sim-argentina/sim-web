// Read-model PÚBLICO del bracket (solo lectura). Reutiliza obtenerEstado() del motor
// admin (que es READ-ONLY: no crea bracket, no sincroniza, no persiste) y proyecta un
// DTO con ALLOWLIST EXPLÍCITA: solo información deportiva, jamás PII (DNI, teléfono,
// email, pagos, observaciones privadas, ids internos). No recalcula nada deportivo.
import { obtenerEstado } from "@/lib/bracketServer";
import { msToTiempo } from "@/lib/campeonatos";

export type EstadoPublicoBracket =
  | "no_iniciado" | "clasificacion" | "clasificacion_cerrada" | "en_curso" | "finalizado";

export type ParticipantePub = {
  seed: number | null;
  nombre: string;
  posicion_final: number | null;
  estado: string;        // "activo" | "dnf" | "dsq" (estado deportivo; sin notas privadas)
  clasifica: boolean | null;
};
export type CarreraPub = { numero: number; estado: string; es_bye: boolean; participantes: ParticipantePub[] };
export type RondaPub = { numero: number; nombre: string; tipo: string; estado: string; carreras: CarreraPub[] };
export type PodioPub = { puesto: number; nombre: string; premio: { monto: number; trofeo: boolean } | null };
export type PremiosPub = { total: number | null; detalle: Array<{ puesto: number; monto: number; trofeo: boolean }> };

export type BracketPublico = {
  aplica: true;
  campeonato: { id: string; nombre: string; modalidad: "eliminacion"; estado_deportivo: EstadoPublicoBracket };
  estado: EstadoPublicoBracket;
  usa_clasificacion: boolean;
  clasificacion: {
    abierta: boolean;
    pilotos: number;
    // Clasificación OFICIAL (seed + nombre + mejor tiempo) solo cuando está cerrada y el
    // torneo usa qualifying. Mientras está abierta NO se publican seeds ni tiempos.
    oficial: Array<{ seed: number; nombre: string; mejor_tiempo: string | null }> | null;
  };
  rondas: RondaPub[];
  final: RondaPub | null;
  podio: PodioPub[] | null;
  premios: PremiosPub | null;
};
export type BracketPublicoResp = BracketPublico | { aplica: false; modalidad: string };

// Forma (parcial) del DTO admin que consumimos. Solo lo permitido públicamente.
type AdminEstado = {
  campeonato: { id: string; nombre: string };
  cfg: { clasificacion: { habilitada: boolean } };
  premios: { total?: number; detalle?: Array<{ puesto: number; monto: number; trofeo?: boolean }> } | null;
  bracket: { id: string | null; estado: string; clasificacion_habilitada: boolean; podio: Array<{ puesto: number; nombre: string }> | null };
  participantes: Array<{ seed: number | null; nombre: string; mejor_ms: number | null }>;
  rondas: Array<{
    numero: number; nombre: string | null; tipo: string; estado: string;
    carreras: Array<{
      numero: number; estado: string; es_bye: boolean;
      participantes: Array<{ seed: number | null; nombre: string; posicion_final: number | null; estado: string; clasifica: boolean | null }>;
    }>;
  }>;
};

function estadoPublico(bracketId: string | null, estadoBracket: string): EstadoPublicoBracket {
  if (!bracketId) return "no_iniciado";
  if (estadoBracket === "clasificacion") return "clasificacion";
  if (estadoBracket === "cerrada") return "clasificacion_cerrada";
  if (estadoBracket === "en_curso") return "en_curso";
  if (estadoBracket === "finalizado") return "finalizado";
  return "no_iniciado";
}

export type ResultadoPublico =
  | { ok: true; data: BracketPublicoResp; estado: EstadoPublicoBracket | "no_aplica" }
  | { ok: false; status: number };

// Estado público del bracket de un campeonato. Solo lectura. 404 si no existe/archivado;
// aplica:false si el campeonato no es de eliminación (la vista bracket no aplica).
export async function estadoPublicoBracket(campeonatoId: string): Promise<ResultadoPublico> {
  const est = await obtenerEstado(campeonatoId);
  if (!est.ok) {
    // cargarCampeonatoEliminacion: 404 no existe/archivado; 400 no es eliminación.
    if (est.status === 400) return { ok: true, data: { aplica: false, modalidad: "liga" }, estado: "no_aplica" };
    return { ok: false, status: est.status };
  }
  const a = est.data as AdminEstado;
  const b = a.bracket;
  const estado = estadoPublico(b.id, b.estado);
  const usaClasificacion = b.clasificacion_habilitada;

  // Clasificación oficial: seeds definitivos (seed != null) ordenados; tiempos solo si
  // el torneo usa qualifying. Mientras la clasificación está abierta → null (no oficial).
  const abierta = estado === "clasificacion";
  const oficial = !abierta && estado !== "no_iniciado" && usaClasificacion
    ? a.participantes
        .filter((p) => p.seed != null)
        .sort((x, y) => (x.seed as number) - (y.seed as number))
        .map((p) => ({ seed: p.seed as number, nombre: p.nombre, mejor_tiempo: p.mejor_ms != null ? msToTiempo(p.mejor_ms) : null }))
    : null;

  const rondas: RondaPub[] = a.rondas.map((r) => ({
    numero: r.numero,
    nombre: r.nombre || `Ronda ${r.numero}`,
    tipo: r.tipo,
    estado: r.estado,
    carreras: r.carreras.map((c) => ({
      numero: c.numero,
      estado: c.estado,
      es_bye: c.es_bye,
      participantes: c.participantes.map((p) => ({
        seed: p.seed ?? null,
        nombre: p.nombre,
        posicion_final: p.posicion_final ?? null,
        estado: p.estado ?? "activo",
        clasifica: p.clasifica ?? null,
      })),
    })),
  }));

  const premios: PremiosPub | null = a.premios
    ? { total: a.premios.total ?? null, detalle: (a.premios.detalle ?? []).map((d) => ({ puesto: d.puesto, monto: d.monto, trofeo: Boolean(d.trofeo) })) }
    : null;

  const podio: PodioPub[] | null = b.podio
    ? b.podio.map((p) => {
        const pr = premios?.detalle.find((d) => d.puesto === p.puesto) ?? null;
        return { puesto: p.puesto, nombre: p.nombre, premio: pr ? { monto: pr.monto, trofeo: pr.trofeo } : null };
      })
    : null;

  const data: BracketPublico = {
    aplica: true,
    campeonato: { id: a.campeonato.id, nombre: a.campeonato.nombre, modalidad: "eliminacion", estado_deportivo: estado },
    estado,
    usa_clasificacion: usaClasificacion,
    clasificacion: { abierta, pilotos: a.participantes.length, oficial },
    rondas,
    final: rondas.find((r) => r.tipo === "final") ?? null,
    podio,
    premios,
  };
  return { ok: true, data, estado };
}
