// Manejadores de las rutas del CRM B1, compartidos por la interfaz comercial
// (/comercial/api/...) y la administración (/api/admin/crm/...). Cada archivo de
// ruta elige el actor (actorComercial / actorAdmin) y delega acá: el alcance y los
// permisos los aplican lib/crmB1Server.ts y las RPCs con ESE actor.

import { NextResponse } from "next/server";
import { esUuid } from "@/lib/crmB1";
import * as S from "@/lib/crmB1Server";
import type { ActorRpc } from "@/lib/crmB1Server";
import { cuerpoMutacion, entero, json, leer, noEncontrado, responder, textoOpcional } from "@/lib/crmHttp";

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const NO_NEGOCIO = "El negocio no existe o no está asignado a vos.";

// ── Catálogo ────────────────────────────────────────────────────────────────
export async function catalogoGet(actor: ActorRpc): Promise<NextResponse> {
  const r = await leer("crm catálogo", async () => ({
    ...(await S.catalogo(actor.rol === "comercial")),
    ...(actor.rol === "admin" ? { usuarios: await S.usuariosComerciales() } : {}),
  }));
  return r.ok ? json(r.valor) : r.response;
}

export async function catalogoGuardar(actor: ActorRpc, req: Request, id: string | null): Promise<NextResponse> {
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { tipo, version, datos } = b.cuerpo;
  if ((tipo !== "rubro" && tipo !== "zona") || !esObjeto(datos) || (id && (!esUuid(id) || !entero(version)))) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.guardarCatalogo(actor, tipo, id, id ? entero(version) : null, datos), "crm catálogo", (v) => v, id ? 200 : 201);
}

// ── Negocios ────────────────────────────────────────────────────────────────
export async function negociosGet(actor: ActorRpc, req: Request): Promise<NextResponse> {
  const p = new URL(req.url).searchParams;
  const r = await leer("crm negocios", () => S.listarEmpresas(actor, {
    q: p.get("q"), responsable: p.get("responsable"), rubro: p.get("rubro"), zona: p.get("zona"), prioridad: p.get("prioridad"),
    estado: p.get("estado"), archivadas: p.get("archivadas") === "1", duplicados: p.get("duplicados") === "1",
  }));
  return r.ok ? json({ negocios: r.valor }) : r.response;
}

export async function negociosPost(actor: ActorRpc, req: Request): Promise<NextResponse> {
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  if (!esObjeto(b.cuerpo.datos)) return json({ error: "Datos inválidos." }, 400);
  const r = await S.crearEmpresa(actor, b.cuerpo.datos, b.cuerpo.confirmar_duplicado === true);
  if (r.ok && r.valor.resultado === "posible_duplicado") {
    return json({ error: "Hay negocios parecidos.", codigo: "posible_duplicado", candidatos: r.valor.candidatos }, 409);
  }
  return responder(r, "crm negocio alta", (v) => ({ id: (v as { id: string }).id }), 201);
}

export async function negocioGet(actor: ActorRpc, id: string): Promise<NextResponse> {
  const r = await leer("crm ficha", () => S.fichaEmpresa(actor, id));
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : noEncontrado(NO_NEGOCIO);
}

export async function negocioPatch(actor: ActorRpc, req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado(NO_NEGOCIO);
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { accion = "actualizar", version, cambios, motivo } = b.cuerpo;
  const v = entero(version);
  if (!v) return json({ error: "Falta la versión." }, 400);
  if (accion === "archivar" || accion === "desarchivar") {
    if (actor.rol !== "admin") return json({ error: "No tenés permiso para esa acción." }, 403);
    return responder(await S.archivarEmpresa(actor, id, v, accion === "archivar", textoOpcional(motivo)), "crm negocio archivo", (x) => x);
  }
  if (accion !== "actualizar" || !esObjeto(cambios)) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.actualizarEmpresa(actor, id, v, cambios), "crm negocio edición", (x) => x);
}

// ── Contactos ───────────────────────────────────────────────────────────────
export async function contactoPost(actor: ActorRpc, req: Request, empresaId: string): Promise<NextResponse> {
  if (!esUuid(empresaId)) return noEncontrado(NO_NEGOCIO);
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  if (!esObjeto(b.cuerpo.datos)) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.crearContacto(actor, empresaId, b.cuerpo.datos), "crm contacto alta", (x) => x, 201);
}

export async function contactoPatch(actor: ActorRpc, req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado("El contacto no existe en ese negocio.");
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const v = entero(b.cuerpo.version);
  if (!v || !esObjeto(b.cuerpo.cambios)) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.actualizarContacto(actor, id, v, b.cuerpo.cambios), "crm contacto edición", (x) => x);
}

// ── Jornadas ────────────────────────────────────────────────────────────────
export async function jornadasGet(actor: ActorRpc, req: Request): Promise<NextResponse> {
  const p = new URL(req.url).searchParams;
  const r = await leer("crm jornadas", () => S.listarJornadas(actor, {
    usuario: p.get("usuario"), desde: p.get("desde"), hasta: p.get("hasta"), estado: p.get("estado"), pendientes: p.get("pendientes") === "1",
  }));
  return r.ok ? json({ jornadas: r.valor }) : r.response;
}

export async function jornadasPost(actor: ActorRpc, req: Request): Promise<NextResponse> {
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  if (!esObjeto(b.cuerpo.datos)) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.crearJornada(actor, b.cuerpo.datos), "crm jornada alta", (x) => x, 201);
}

export async function jornadaGet(actor: ActorRpc, id: string): Promise<NextResponse> {
  const r = await leer("crm jornada", () => S.detalleJornada(actor, id));
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : noEncontrado("La jornada no existe o no es tuya.");
}

export async function jornadaPatch(actor: ActorRpc, req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado("La jornada no existe o no es tuya.");
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const v = entero(b.cuerpo.version);
  const cambios = b.cuerpo.cambios ?? {};
  if (!v || !esObjeto(cambios)) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.actualizarJornada(actor, id, v, cambios, b.cuerpo.cerrar === true), "crm jornada edición", (x) => x);
}

// ── Visitas ─────────────────────────────────────────────────────────────────
export async function visitasPost(actor: ActorRpc, req: Request): Promise<NextResponse> {
  const b = await cuerpoMutacion(req, 32_768);
  if (!b.ok) return b.response;
  const { clave, datos } = b.cuerpo;
  if (!esUuid(clave) || !esObjeto(datos)) return json({ error: "Datos inválidos." }, 400);
  const r = await S.registrarVisita(actor, clave, datos);
  if (r.ok && r.valor.resultado === "posible_duplicado") {
    return json({ error: "Hay negocios parecidos.", codigo: "posible_duplicado", candidatos: r.valor.candidatos }, 409);
  }
  const repetida = r.ok && r.valor.resultado === "ok" && r.valor.repetida;
  return responder(r, "crm visita", (x) => x, repetida ? 200 : 201);
}

export async function visitaPatch(actor: ActorRpc, req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado("La visita no existe.");
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { accion, version, cambios, motivo, resolucion, nuevo_origen } = b.cuerpo;
  const v = entero(version);
  const m = textoOpcional(motivo);
  if (!v) return json({ error: "Falta la versión." }, 400);
  if (accion === "corregir") {
    if (!esObjeto(cambios)) return json({ error: "Datos inválidos." }, 400);
    return responder(await S.corregirVisita(actor, id, v, cambios, m ?? ""), "crm visita corrección", (x) => x);
  }
  if (accion === "anular") {
    const res = resolucion === "cerrar_oportunidad" || resolucion === "reasignar_origen" ? resolucion : null;
    const nuevo = esUuid(nuevo_origen) ? nuevo_origen : null;
    return responder(await S.anularVisita(actor, id, v, m ?? "", res, nuevo), "crm visita anulación", (x) => x);
  }
  return json({ error: "Acción inválida." }, 400);
}

export async function visitaNotaPost(actor: ActorRpc, req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado("La visita no existe.");
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  return responder(await S.notaVisita(actor, id, typeof b.cuerpo.texto === "string" ? b.cuerpo.texto : ""), "crm visita nota", (x) => x, 201);
}

// ── Revisitas ───────────────────────────────────────────────────────────────
export async function tareaPatch(actor: ActorRpc, req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado("La revisita no existe.");
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { version, accion, vence_el, motivo } = b.cuerpo;
  const v = entero(version);
  const fecha = typeof vence_el === "string" && /^\d{4}-\d{2}-\d{2}$/.test(vence_el) ? vence_el : null;
  if (!v || (accion !== "reprogramar" && accion !== "cancelar")) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.actualizarTarea(actor, id, v, accion, fecha, textoOpcional(motivo)), "crm revisita", (x) => x);
}
