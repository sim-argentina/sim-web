// Manejadores de las rutas de ventas, cobros y comisiones (B3). Solo
// Administración: cada archivo de ruta valida el actor con actorAdmin antes de
// llamar acá. La interfaz comercial no tiene rutas de B3 ni recibe estos datos.

import { NextResponse } from "next/server";
import { esUuid } from "@/lib/crmB1";
import { cuerpoMutacion, entero, json, leer, noEncontrado, responder } from "@/lib/crmHttp";
import { ESTADOS_COBRO, ESTADOS_COMISION, PENDIENTES, type FiltrosVentas } from "@/lib/crmB3";
import * as S from "@/lib/crmB3Server";

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const esFecha = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const NO_VENTA = "La venta no existe.";
const NO_OPP = "La oportunidad no existe.";
const NO_EMPRESA = "El negocio no existe.";
const PRODUCTOS = ["pack_10", "pack_25", "personalizado"];

export async function ventasGet(req: Request): Promise<NextResponse> {
  const p = new URL(req.url).searchParams;
  const valor = (k: string, validos: readonly string[]) => (validos.includes(p.get(k) ?? "") ? (p.get(k) as string) : undefined);
  const f: FiltrosVentas = {
    desde: esFecha(p.get("desde")) ? p.get("desde")! : undefined, hasta: esFecha(p.get("hasta")) ? p.get("hasta")! : undefined,
    q: p.get("q")?.trim().slice(0, 80) || undefined, empresa: esUuid(p.get("empresa")) ? p.get("empresa")! : undefined,
    producto: valor("producto", PRODUCTOS), cobro: valor("cobro", ESTADOS_COBRO.map((e) => e.valor)),
    comision: valor("comision", ESTADOS_COMISION.map((e) => e.valor)), pendiente: valor("pendiente", PENDIENTES.map((e) => e.valor)),
    anuladas: p.get("anuladas") === "1",
  };
  const r = await leer("crm ventas", () => S.listarVentas(f));
  return r.ok ? json(r.valor) : r.response;
}

export async function ventaGet(id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado(NO_VENTA);
  const r = await leer("crm venta", () => S.detalleVenta(id));
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : noEncontrado(NO_VENTA);
}

/** Cobros, pagos de comisión, corrección, anulación, entrega y campaña: { clave, version, accion, datos }. Idempotente por clave. */
export async function ventaPost(req: Request, id: string): Promise<NextResponse> {
  if (!esUuid(id)) return noEncontrado(NO_VENTA);
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { clave, version, accion, datos = {} } = b.cuerpo;
  const v = entero(version);
  if (!esUuid(clave) || !v || !S.ACCIONES_VENTA.includes(accion as S.AccionVenta) || !esObjeto(datos)) return json({ error: "Datos inválidos." }, 400);
  const r = await S.gestionarVenta(clave, id, v, accion as S.AccionVenta, datos);
  return responder(r, `crm venta ${String(accion)}`, (x) => x, r.ok && r.valor.resultado === "ok" && !r.valor.repetida ? 201 : 200);
}

/** Datos para «Registrar venta» (consultar no escribe nada). */
export async function formularioVentaGet(oportunidadId: string): Promise<NextResponse> {
  if (!esUuid(oportunidadId)) return noEncontrado(NO_OPP);
  const r = await leer("crm formulario de venta", () => S.formularioVenta(oportunidadId));
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : noEncontrado(NO_OPP);
}

/** Registrar la venta y marcar «Ganado» en una sola operación: { clave, version, datos }. */
export async function ventaRegistrarPost(req: Request, oportunidadId: string): Promise<NextResponse> {
  if (!esUuid(oportunidadId)) return noEncontrado(NO_OPP);
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { clave, version, datos } = b.cuerpo;
  const v = entero(version);
  if (!esUuid(clave) || !v || !esObjeto(datos)) return json({ error: "Datos inválidos." }, 400);
  const r = await S.registrarVenta(clave, oportunidadId, v, datos);
  return responder(r, "crm registrar venta", (x) => x, r.ok && r.valor.repetida ? 200 : 201);
}

export async function comprasGet(empresaId: string): Promise<NextResponse> {
  if (!esUuid(empresaId)) return noEncontrado(NO_EMPRESA);
  const r = await leer("crm compras del negocio", () => S.comprasNegocio(empresaId));
  if (!r.ok) return r.response;
  return r.valor ? json(r.valor) : noEncontrado(NO_EMPRESA);
}

/** Oportunidad de recompra con un contacto existente: { clave, datos: { contacto_id, observacion?, proxima? } }. */
export async function recompraPost(req: Request, empresaId: string): Promise<NextResponse> {
  if (!esUuid(empresaId)) return noEncontrado(NO_EMPRESA);
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { clave, datos } = b.cuerpo;
  if (!esUuid(clave) || !esObjeto(datos)) return json({ error: "Datos inválidos." }, 400);
  const r = await S.crearRecompra(clave, empresaId, datos);
  return responder(r, "crm recompra", (x) => x, r.ok && r.valor.repetida ? 200 : 201);
}

export async function productosGet(): Promise<NextResponse> {
  const r = await leer("crm productos", () => S.productos());
  return r.ok ? json({ productos: r.valor }) : r.response;
}

/** Cambia precio, comisión de lista, nombre o activo de un producto: { codigo, version, cambios }. No toca ventas anteriores. */
export async function productoPatch(req: Request): Promise<NextResponse> {
  const b = await cuerpoMutacion(req);
  if (!b.ok) return b.response;
  const { codigo, version, cambios } = b.cuerpo;
  const v = entero(version);
  if (typeof codigo !== "string" || !PRODUCTOS.includes(codigo) || !v || !esObjeto(cambios)) return json({ error: "Datos inválidos." }, 400);
  return responder(await S.actualizarProducto(codigo, v, cambios), "crm producto", (x) => x);
}

/** Campañas de Empresas para vincular (solo lectura). */
export async function campaniasGet(req: Request): Promise<NextResponse> {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const r = await leer("crm campañas", () => S.buscarCampanias(q));
  return r.ok ? json({ campanias: r.valor }) : r.response;
}
