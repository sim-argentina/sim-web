import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuards";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { validarAnioMes, fechaEnMes, type DiaInput } from "@/lib/cronograma";
import { guardarDia } from "@/lib/cronogramaServer";

// Guardado atómico de un día (solo admin). Anti mass-assignment: solo se aceptan
// cerrado/apertura/cierre/jornadas; nunca id, estado, timestamps ni fallback.
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  if (!(await rateLimit(`cronograma-write:${clientIp(req)}`, 40, 60_000))) {
    return tooManyResponse();
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const val = validarAnioMes((body as { anio?: unknown }).anio, (body as { mes?: unknown }).mes);
  if (!val.ok) return NextResponse.json({ error: val.error }, { status: 400 });

  const fecha = String((body as { fecha?: unknown }).fecha ?? "");
  if (!fechaEnMes(fecha, val.anio, val.mes)) {
    return NextResponse.json({ error: "Fecha inválida o fuera del mes." }, { status: 400 });
  }

  // Whitelist explícita del cuerpo del día.
  const rawJornadas = Array.isArray((body as { jornadas?: unknown }).jornadas)
    ? ((body as { jornadas: unknown[] }).jornadas)
    : [];
  const dia: DiaInput = {
    cerrado: (body as { cerrado?: unknown }).cerrado === true,
    apertura: String((body as { apertura?: unknown }).apertura ?? ""),
    cierre: String((body as { cierre?: unknown }).cierre ?? ""),
    jornadas: rawJornadas.map((j) => {
      const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
      return {
        empleado_id: String(o.empleado_id ?? ""),
        hora_inicio: String(o.hora_inicio ?? ""),
        hora_fin: String(o.hora_fin ?? ""),
      };
    }),
  };

  const res = await guardarDia(val.anio, val.mes, fecha, dia);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ mes: res.data });
}
