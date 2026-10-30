// Manejadores de las rutas del seguimiento (B2). Solo Administración: cada archivo de
// ruta valida el actor con actorAdmin antes de llamar acá. La interfaz comercial no
// tiene rutas de B2 (ve solo el resumen de estado en la ficha del negocio).

import { NextResponse } from "next/server";
import { esUuid } from "@/lib/crmB1";
import { cuerpoMutacion, entero, json, leer, noEncontrado, responder } from "@/lib/crmHttp";
import * as S from "@/lib/crmB2Server";

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const NO_OPP = "La oportunidad no existe.";

export async function seguimientoGet(req: Request): Promise<NextResponse> {
  const p = new URL(req.url).searchParams;
  const vista: S.Vista = p.get("vista") === "perdidas" ? "perdidas" : p.get("vista") === "ganadas" ? "ganadas" : "abiertas";
  const texto = (k: string) => {
    const v = p.get(k)?.trim();
    return v ? v.slice(0, 80) : undefined;
  };
  const r = await leer("crm seguimiento", () => S.bandeja(vista, {
    q: texto("q"), estado: texto("estado"), origen: texto("origen"), interes: texto("interes"), rubro: texto("rubro"), zona: texto("zona"),
    proxima: texto("proxima"), grupo: texto("grupo"),
  }));
  return r.ok ? json(r.valor) : r.response;
}

/** Consultar NO escribe: abrir una oportunidad no la marca como gestionada. */
export async function oportunidadGet(id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado(NO_OPP);
  const r = await leer("crm oportunidad", () => S.detalleOportunidad(id));
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : noEncontrado(NO_OPP);
}

/** Toda la gestión: { clave, version, accion, datos }. Idempotente por clave. */
export async function oportunidadPost(req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado(NO_OPP);
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { clave, version, accion, datos = {} } = b.cuerpo;
  const v = entero(version);
  if (!esUuid(clave) || !v || !S.ACCIONES.includes(accion as S.Accion) || !esObjeto(datos)) return json({ error: "Datos inválidos." }, 400);
  const r = await S.gestionar(clave, id, v, accion as S.Accion, datos);
  return responder(r, `crm gestión ${String(accion)}`, (x) => x, r.ok && r.valor.repetida ? 200 : 201);
}
