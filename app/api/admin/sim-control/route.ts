import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { failResponse } from "@/lib/apiError";
import { pepperDisponible } from "@/lib/simControlCredentials";
import {
  cambiarEstadoTerminal,
  crearTerminal,
  listarConciliaciones,
  listarPaquetes,
  listarTerminales,
  revocarCredencial,
  rotarCredencial,
} from "@/lib/simControlAdmin";
import { simControlSyncHabilitado } from "@/lib/simControlServer";

// Administración de SIM Control desde el panel.
//
// ── Solo admin ─────────────────────────────────────────────────────────────────
// `requireAdmin` valida la cookie firmada en el backend; no se confía en la UI ni en el middleware.
// Staff no entra: desde acá se generan credenciales de máquina, que son secretos de producción.
//
// Es la contracara de /api/sim-control/v1/*: aquella autentica MÁQUINAS con su token, esta autentica
// PERSONAS con su sesión. Ninguna de las dos acepta el método de la otra.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sinCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const vista = searchParams.get("vista") ?? "terminales";

  try {
    if (vista === "paquetes") {
      return NextResponse.json({ paquetes: await listarPaquetes() }, { headers: sinCache });
    }

    if (vista === "conciliaciones") {
      return NextResponse.json({ conciliaciones: await listarConciliaciones() }, { headers: sinCache });
    }

    return NextResponse.json(
      {
        terminales: await listarTerminales(),
        // El panel avisa si falta configuración del servidor, en vez de dejar que la terminal se
        // entere sola con un 503 en medio de un cierre.
        syncHabilitado: simControlSyncHabilitado(),
        pepperConfigurado: pepperDisponible(),
      },
      { headers: sinCache }
    );
  } catch (error) {
    return failResponse(500, "No se pudo cargar la información", { logContext: "admin/sim-control GET", error });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const accion = String(body?.accion ?? "");
    const actor = auth.role;

    if (accion === "crear_terminal") {
      const terminalKey = String(body?.terminalKey ?? "").trim();
      const displayName = String(body?.displayName ?? "").trim();

      if (!terminalKey || terminalKey.length > 64) {
        return NextResponse.json({ error: "Identificador de terminal inválido" }, { status: 400, headers: sinCache });
      }
      if (!displayName || displayName.length > 80) {
        return NextResponse.json({ error: "Nombre inválido" }, { status: 400, headers: sinCache });
      }

      const r = await crearTerminal({
        terminalKey,
        displayName,
        simulatorLabel: body?.simulatorLabel ?? null,
        actor,
      });

      return r.ok
        ? NextResponse.json({ ok: true, id: r.id }, { headers: sinCache })
        : NextResponse.json({ error: r.motivo }, { status: 409, headers: sinCache });
    }

    const terminalId = String(body?.terminalId ?? "");
    if (!terminalId) {
      return NextResponse.json({ error: "Falta la terminal" }, { status: 400, headers: sinCache });
    }

    if (accion === "rotar_credencial") {
      if (!pepperDisponible()) {
        // Sin pepper el hash no sería el que valida la API: generar una credencial ahora produciría
        // una que no sirve. Mejor decirlo que emitir algo roto.
        return NextResponse.json(
          { error: "Falta SIM_CONTROL_CREDENTIAL_PEPPER en el servidor." },
          { status: 503, headers: sinCache }
        );
      }

      const r = await rotarCredencial({ terminalId, actor });
      if (!r.ok) {
        return NextResponse.json({ error: r.motivo }, { status: 400, headers: sinCache });
      }

      // ÚNICA vez que el token viaja. No se guarda en claro en ningún lado.
      return NextResponse.json(
        {
          ok: true,
          token: r.token,
          prefijo: r.prefijo,
          advertencia: "Guardá esta credencial en SIM Control ahora: no se puede volver a mostrar.",
        },
        { headers: sinCache }
      );
    }

    if (accion === "revocar_credencial") {
      await revocarCredencial({ terminalId, actor });
      return NextResponse.json({ ok: true }, { headers: sinCache });
    }

    if (accion === "desactivar_terminal" || accion === "reactivar_terminal") {
      await cambiarEstadoTerminal({ terminalId, activa: accion === "reactivar_terminal", actor });
      return NextResponse.json({ ok: true }, { headers: sinCache });
    }

    return NextResponse.json({ error: "Acción desconocida" }, { status: 400, headers: sinCache });
  } catch (error) {
    return failResponse(500, "No se pudo completar la operación", { logContext: "admin/sim-control POST", error });
  }
}
