import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { isValidUuid } from "@/lib/security";
import { logSecurityEvent } from "@/lib/apiError";
import {
  marcarPagada, setEstadoCampania, setEstadoCodigo,
  cancelarReservaEmpresa, reprogramarReservaEmpresa, setNoShowEmpresa,
} from "@/lib/empresasServer";

type RouteContext = { params: Promise<{ id: string }> };

// Acciones admin sobre una campaña. SOLO admin (server-side). Estados no manuales:
// derivan de pago/fechas; acá solo hay transiciones explícitas (pagada/finalizar/
// cancelar) y operaciones sobre códigos/reservas.
export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const accion = String(body.accion ?? "");

  let res;
  switch (accion) {
    case "marcar_pagada":
      res = await marcarPagada(id, String(body.fecha_pago ?? ""), String(body.medio_pago ?? "")); break;
    case "finalizar":
      res = await setEstadoCampania(id, "finalizada"); break;
    case "cancelar":
      res = await setEstadoCampania(id, "cancelada"); break;
    case "codigo_estado": {
      const codigoId = String(body.codigo_id ?? "");
      const estado = String(body.estado ?? "");
      if (!isValidUuid(codigoId) || !["bloqueado", "cancelado", "disponible"].includes(estado)) {
        return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
      }
      res = await setEstadoCodigo(id, codigoId, estado as "bloqueado" | "cancelado" | "disponible"); break;
    }
    case "reserva_cancelar":
      res = await cancelarReservaEmpresa(Number(body.reserva_id), body.liberar_codigo === true); break;
    case "reserva_reprogramar":
      res = await reprogramarReservaEmpresa(Number(body.reserva_id), String(body.fecha ?? ""), String(body.hora ?? ""),
        Array.isArray(body.simuladores) ? (body.simuladores as unknown[]).map(String) : []); break;
    case "reserva_no_show":
      res = await setNoShowEmpresa(Number(body.reserva_id), body.no_show === true); break;
    default:
      return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  }

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logSecurityEvent("empresa_accion", { id, accion, role: auth.role });
  return NextResponse.json(res.data);
}
