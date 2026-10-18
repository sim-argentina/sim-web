import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { errorApi, instanteValido } from "@/lib/interacciones";
import { empleadosParaInteraccion } from "@/lib/interaccionesServer";
import { inesperado, responder, responderError, responderFallo } from "@/lib/interaccionesHttp";

// Opciones de "Atendió" (staff y admin): integrantes ACTIVOS, solo id y nombre,
// y los que el cronograma ubica a esa hora como SUGERENCIA (nunca se asigna
// solo). ?ocurrida_en=ISO con zona; sin parámetro, ahora. No toca el catálogo de
// empleados ni expone más datos (el endpoint general de empleados no se amplía).

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;
  try {
    const params = new URL(req.url).searchParams;
    for (const k of params.keys()) if (k !== "ocurrida_en") return responderError(errorApi("campo_desconocido", { campo: k.slice(0, 40) }));
    const crudo = params.get("ocurrida_en");
    if (crudo !== null && !instanteValido(crudo)) return responderError(errorApi("campo_invalido", { campo: "ocurrida_en" }));
    const r = await empleadosParaInteraccion(crudo ? new Date(crudo.replace(" ", "T")) : new Date());
    if (!r.ok) return responderFallo(r, "empleados");
    return responder(r.valor);
  } catch (error) {
    return inesperado("empleados", error);
  }
}
