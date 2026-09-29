// ============================================================================
// Diagnóstico de la modalidad comercial (Bloque B0). SOLO SERVIDOR, SOLO LECTURA.
// ----------------------------------------------------------------------------
// Arma lo que devuelve GET /api/admin/modalidad-comercial/diagnostico: qué
// modalidad rige ahora, por qué (calendario u override) y cuál regiría en otro
// instante. Simular un instante NO cambia nada: no escribe en la base, no toca
// el override y ningún flujo comercial lee este resultado.
// ============================================================================

import { CATALOGOS, type CatalogoComercial, type Modalidad } from "@/lib/catalogoComercial";
import {
  CORTE_MODALIDAD_V2, CORTE_MODALIDAD_V2_MS, ZONA_CORTE,
  leerOverride, modalidadEfectiva, modalidadProgramada,
} from "@/lib/modalidadComercial";

type VersionPrecio = { precio: number; vigente_desde: string };

export type PlanDiagnostico = {
  slug: string;
  nombre: string;
  minutos: number;
  activo: boolean;
  /** Lo que cobran HOY los flujos públicos: mensualidad_planes.precio. */
  precio_publico_actual: number;
  /** Versiones de mensualidad_plan_precios (B1). Ningún flujo público las lee todavía. */
  versiones: VersionPrecio[];
  /** La versión que corresponde por fecha en `ahora` y en el instante simulado. */
  precio_por_version_ahora: number | null;
  precio_por_version_simulado: number | null;
};

export type DiagnosticoModalidad = {
  solo_lectura: true;
  ahora_servidor: string;
  ahora_servidor_ar: string;
  corte: { literal: string; utc: string; epoch_ms: number; zona: string; en_zona: string };
  modalidad_programada_actual: Modalidad;
  override: {
    valor: Modalidad | null;
    motivo: string | null;
    actualizado_por: string | null;
    updated_at: string | null;
    error_lectura: boolean;
  };
  modalidad_efectiva: Modalidad;
  simulacion: null | {
    at: string;
    at_ar: string;
    modalidad_programada: Modalidad;
    modalidad_efectiva: Modalidad;
  };
  catalogos: { legacy: CatalogoComercial; v2_10: CatalogoComercial };
  planes_mensualidad: { leidos_por_flujos_publicos: false; error: boolean; planes: PlanDiagnostico[] };
  notas: string[];
};

// "2026-09-28 17:10:05": el sueco da AAAA-MM-DD HH:MM:SS sin nada que traducir.
const FORMATO_AR = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZONA_CORTE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

const enZonaAr = (instante: Date): string => FORMATO_AR.format(instante);

/** Precio de la última versión vigente en ese instante, o null si no hay ninguna. */
function precioEn(versiones: VersionPrecio[], instante: Date): number | null {
  let precio: number | null = null;
  for (const v of versiones) {
    if (Date.parse(v.vigente_desde) <= instante.getTime()) precio = v.precio;
  }
  return precio;
}

async function planesMensualidad(
  ahora: Date,
  simularEn: Date | null,
): Promise<{ error: boolean; planes: PlanDiagnostico[] }> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
    const [planes, versiones] = await Promise.all([
      supabaseAdmin
        .from("mensualidad_planes")
        .select("id, slug, nombre, minutos, precio, activo, orden")
        .order("orden", { ascending: true }),
      supabaseAdmin
        .from("mensualidad_plan_precios")
        .select("plan_id, precio, vigente_desde")
        .order("vigente_desde", { ascending: true }),
    ]);
    if (planes.error || versiones.error) return { error: true, planes: [] };

    const porPlan = new Map<string, VersionPrecio[]>();
    for (const v of versiones.data ?? []) {
      const lista = porPlan.get(String(v.plan_id)) ?? [];
      lista.push({ precio: Number(v.precio), vigente_desde: String(v.vigente_desde) });
      porPlan.set(String(v.plan_id), lista);
    }

    return {
      error: false,
      planes: (planes.data ?? []).map((p) => {
        const lista = porPlan.get(String(p.id)) ?? [];
        return {
          slug: String(p.slug),
          nombre: String(p.nombre),
          minutos: Number(p.minutos),
          activo: Boolean(p.activo),
          precio_publico_actual: Number(p.precio),
          versiones: lista,
          precio_por_version_ahora: precioEn(lista, ahora),
          precio_por_version_simulado: simularEn ? precioEn(lista, simularEn) : null,
        };
      }),
    };
  } catch {
    return { error: true, planes: [] };
  }
}

/**
 * El diagnóstico completo. `simularEn` evalúa el CALENDARIO en otro instante
 * con el override que esté vigente: sirve para comprobar el corte antes de que
 * llegue, sin tocar nada.
 */
export async function diagnosticoModalidad(
  opts: { ahora?: Date; simularEn?: Date | null } = {},
): Promise<DiagnosticoModalidad> {
  const ahora = opts.ahora ?? new Date();
  const simularEn = opts.simularEn ?? null;

  const [o, planes] = await Promise.all([leerOverride(), planesMensualidad(ahora, simularEn)]);
  const programada = modalidadProgramada(ahora);
  const corte = new Date(CORTE_MODALIDAD_V2_MS);

  const notas = [
    "Solo lectura: consultar este diagnóstico no cambia el override ni afecta ninguna operación.",
    "`at` simula el calendario en otro instante con el override vigente; no se guarda nada.",
    "(B0/B1) Ningún flujo comercial lee todavía esta modalidad: Reservas, Gift Cards, Mensualidades, Empresas y el Turnero siguen operando legacy por código.",
    "(B0/B1) mensualidad_plan_precios está cargada pero ningún flujo público la lee: los planes se cobran con mensualidad_planes.precio.",
  ];
  if (o.override !== null) {
    notas.push(`Override ACTIVO (${o.override}): gana sobre el calendario para las operaciones nuevas de los flujos que lo lean.`);
  }
  if (o.errorLectura) {
    notas.push("No se pudo leer el override: se sigue el calendario.");
  }

  return {
    solo_lectura: true,
    ahora_servidor: ahora.toISOString(),
    ahora_servidor_ar: enZonaAr(ahora),
    corte: {
      literal: CORTE_MODALIDAD_V2,
      utc: corte.toISOString(),
      epoch_ms: CORTE_MODALIDAD_V2_MS,
      zona: ZONA_CORTE,
      en_zona: enZonaAr(corte),
    },
    modalidad_programada_actual: programada,
    override: {
      valor: o.override,
      motivo: o.motivo,
      actualizado_por: o.actualizadoPor,
      updated_at: o.updatedAt,
      error_lectura: o.errorLectura,
    },
    modalidad_efectiva: modalidadEfectiva(programada, o.override),
    simulacion: simularEn
      ? {
        at: simularEn.toISOString(),
        at_ar: enZonaAr(simularEn),
        modalidad_programada: modalidadProgramada(simularEn),
        modalidad_efectiva: modalidadEfectiva(modalidadProgramada(simularEn), o.override),
      }
      : null,
    catalogos: { legacy: CATALOGOS.legacy, v2_10: CATALOGOS.v2_10 },
    planes_mensualidad: { leidos_por_flujos_publicos: false, ...planes },
    notas,
  };
}
