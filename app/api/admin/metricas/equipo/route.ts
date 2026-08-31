import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { consultarMetricasEquipo, type FuenteFiltro } from "@/lib/metricasEquipoServer";

// GET /api/admin/metricas/equipo — métricas de servicio por integrante (ADMIN-only).
// 401 sin sesión · 403 staff · 200 admin. Validación estricta, anti mass-assignment,
// sin PII de clientes, sin detalles internos de Postgres. La API es la autoridad real
// (el gating de la pestaña Equipo en la UI es defensa adicional, no la única barrera).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366; // límite anti-consulta excesivamente amplia

function finDeMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 0)); // día 0 del mes siguiente = último del mes
  return d.toISOString().slice(0, 10);
}
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const q = url.searchParams;

    // Rango: por (anio, mes) o por (desde, hasta). Nada más se lee del request.
    let desde: string;
    let hasta: string;
    const anioRaw = q.get("anio");
    const mesRaw = q.get("mes");
    if (anioRaw !== null || mesRaw !== null) {
      const anio = Number(anioRaw);
      const mes = Number(mesRaw);
      if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return NextResponse.json({ error: "Año inválido." }, { status: 400 });
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) return NextResponse.json({ error: "Mes inválido." }, { status: 400 });
      desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
      hasta = finDeMes(anio, mes);
    } else {
      desde = q.get("desde") ?? "";
      hasta = q.get("hasta") ?? "";
      if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) return NextResponse.json({ error: "Rango inválido. Usá anio+mes o desde+hasta (YYYY-MM-DD)." }, { status: 400 });
      const d = diasEntre(desde, hasta);
      if (Number.isNaN(d) || d < 0) return NextResponse.json({ error: "El rango es inválido (desde posterior a hasta)." }, { status: 400 });
      if (d > MAX_DIAS) return NextResponse.json({ error: `El rango no puede superar ${MAX_DIAS} días.` }, { status: 400 });
    }

    const fuenteRaw = q.get("fuente") ?? "todas";
    if (!["todas", "stand", "reservas"].includes(fuenteRaw)) return NextResponse.json({ error: "Fuente inválida." }, { status: 400 });
    const fuentes = fuenteRaw as FuenteFiltro;

    const empleado = q.get("empleado");
    if (empleado !== null && !UUID_RE.test(empleado)) return NextResponse.json({ error: "Integrante inválido." }, { status: 400 });

    const reporte = await consultarMetricasEquipo({ desde, hasta, fuentes, empleadoId: empleado });
    return NextResponse.json(reporte, { status: 200, headers: { "X-Robots-Tag": "noindex" } });
  } catch (e) {
    console.error("metricas/equipo GET:", (e as Error)?.message);
    return NextResponse.json({ error: "No se pudieron calcular las métricas del equipo." }, { status: 500 });
  }
}
