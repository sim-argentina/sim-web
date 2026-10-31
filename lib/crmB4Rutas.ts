// Manejador de la ruta de métricas (B4). Solo Administración: el archivo de ruta
// valida el actor con actorAdmin antes de llamar acá. La interfaz comercial no
// tiene rutas de B4 ni recibe estos datos.

import { NextResponse } from "next/server";
import { esUuid, NECESIDADES } from "@/lib/crmB1";
import { json, leer } from "@/lib/crmHttp";
import {
  DEFINICIONES, DETALLES_EXTRA, PRESETS, PRESET_INICIAL, SIN_RUBRO, SIN_ZONA, detalle, periodoDe, preparar, tablero, type Filtros, type Preset,
} from "@/lib/crmB4";
import { cargarDatos } from "@/lib/crmB4Server";

/** Lee período y filtros de la URL (los mismos para el tablero y su detalle). */
export function leerConsulta(p: URLSearchParams) {
  const preset = (PRESETS.some((x) => x.valor === p.get("preset")) ? p.get("preset") : PRESET_INICIAL) as Preset;
  const filtros: Filtros = {
    comercial: esUuid(p.get("comercial")) ? p.get("comercial") : null,
    zona: esUuid(p.get("zona")) || p.get("zona") === SIN_ZONA ? p.get("zona") : null,
    rubro: esUuid(p.get("rubro")) || p.get("rubro") === SIN_RUBRO ? p.get("rubro") : null,
    necesidad: NECESIDADES.some((n) => n.valor === p.get("necesidad")) ? p.get("necesidad") : null,
  };
  return { preset, desde: p.get("desde"), hasta: p.get("hasta"), filtros };
}

export async function metricasGet(req: Request): Promise<NextResponse> {
  const p = new URL(req.url).searchParams;
  const q = leerConsulta(p);
  const id = p.get("detalle");
  if (id && !(id in DEFINICIONES) && !(DETALLES_EXTRA as readonly string[]).includes(id)) return json({ error: "Detalle inválido." }, 400);
  const r = await leer("crm métricas", async () => {
    const ahora = new Date();
    const ctx = preparar(await cargarDatos(), ahora);
    const periodo = periodoDe(q.preset, ctx.hoy, { desde: q.desde, hasta: q.hasta });
    if (!id) return tablero(ctx, periodo, q.filtros, ahora);
    const d = detalle(ctx, periodo, q.filtros, id, {
      dimension: p.get("dimension") ?? undefined, valor: p.get("valor")?.slice(0, 80) ?? undefined, jornada: esUuid(p.get("jornada")) ? p.get("jornada")! : undefined,
    });
    return d ? { ...d, consultado_en: ahora.toISOString(), hoy: ctx.hoy, periodo } : null;
  });
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : json({ error: "No existe." }, 404);
}
