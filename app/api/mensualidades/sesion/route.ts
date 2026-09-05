import { NextResponse } from "next/server";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { isAllowedOrigin, forbiddenOrigin } from "@/lib/originCheck";
import { failResponse } from "@/lib/apiError";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { normalizarTelefonoDetallado, normalizarCodigo } from "@/lib/mensualidades";
import { buscarPorCodigoYTelefono } from "@/lib/mensualidadesMiPlan";
import {
  COOKIE_SESION, crearSesion, revocarSesion, limpiarSesionesVencidas,
  opcionesCookie, opcionesCookieBorrada, tokenDeRequest,
} from "@/lib/mensualidadSesion";

// Identificación pública de Mensualidades (Bloque M4): código + teléfono a
// cambio de una cookie HttpOnly con un token opaco. Sin cuentas ni contraseñas.
//
// POST   → identificarse (detrás de la feature flag: es un acceso NUEVO)
// DELETE → cerrar sesión (siempre disponible: cerrar nunca puede fallar)

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
// Todas las respuestas tardan al menos esto: así no se distingue por tiempos si
// falló el código, el teléfono o la combinación.
const PISO_RESPUESTA_MS = 220;

const sinCache = { "Cache-Control": "no-store, max-age=0" };

// Un único mensaje para TODOS los fallos de identificación: no se revela cuál de
// los dos datos estaba mal ni si el código existe.
function credencialesInvalidas() {
  return NextResponse.json(
    { error: "No encontramos una mensualidad con esos datos. Revisá el código y el teléfono." },
    { status: 401, headers: sinCache },
  );
}

async function esperarPiso(desde: number) {
  const resta = PISO_RESPUESTA_MS - (Date.now() - desde);
  if (resta > 0) await new Promise((r) => setTimeout(r, resta));
}

export async function POST(req: Request) {
  const t0 = Date.now();

  // Acceso nuevo → depende de la flag. 404 neutral, sin revelar la función.
  if (!mensualidadesHabilitadas()) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404, headers: sinCache });
  }
  // Rate limit estricto: identificarse es adivinable por fuerza bruta.
  if (!(await rateLimit(`mens-sesion:${clientIp(req)}`, 8, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 415, headers: sinCache });
  }
  const crudo = await req.text().catch(() => "");
  if (crudo.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413, headers: sinCache });
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(crudo) as Record<string, unknown>; } catch {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: sinCache });
  }

  try {
    // Formato inválido y datos que no coinciden devuelven EXACTAMENTE lo mismo.
    const codigo = normalizarCodigo(String(body.codigo ?? "").slice(0, 40));
    const tel = normalizarTelefonoDetallado(String(body.telefono ?? "").slice(0, 40));

    let mensualidadId: string | null = null;
    if (codigo && tel.ok) {
      mensualidadId = await buscarPorCodigoYTelefono(codigo, tel.valor);
    }

    if (!mensualidadId) {
      await esperarPiso(t0);
      return credencialesInvalidas();
    }

    // Identificarse NO exige que la mensualidad esté vigente: vencida, agotada o
    // bloqueada también se pueden consultar. El estado condiciona las acciones,
    // no el acceso a la información básica.
    const tokenPrevio = tokenDeRequest(req);
    const token = await crearSesion(mensualidadId, tokenPrevio);
    if (!token) {
      await esperarPiso(t0);
      return failResponse(500, "No pudimos abrir tu sesión. Probá de nuevo.", {
        logContext: "mens-sesion crear",
      });
    }
    // Barrido oportunista de sesiones viejas.
    void limpiarSesionesVencidas().catch(() => null);

    await esperarPiso(t0);
    const res = NextResponse.json({ ok: true }, { headers: sinCache });
    res.cookies.set(COOKIE_SESION, token, opcionesCookie());
    return res;
  } catch (error) {
    await esperarPiso(t0);
    // Sin código, teléfono, nombre ni email en el log.
    return failResponse(500, "No pudimos abrir tu sesión. Probá de nuevo.", {
      logContext: "mens-sesion", error,
    });
  }
}

// Cerrar sesión: revoca en base y borra la cookie. No depende de la flag.
export async function DELETE(req: Request) {
  if (!(await rateLimit(`mens-salir:${clientIp(req)}`, 30, 60_000))) return tooManyResponse();
  if (!isAllowedOrigin(req)) return forbiddenOrigin();

  await revocarSesion(tokenDeRequest(req)).catch(() => null);

  const res = NextResponse.json({ ok: true }, { headers: sinCache });
  res.cookies.set(COOKIE_SESION, "", opcionesCookieBorrada());
  return res;
}
