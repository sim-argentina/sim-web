import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { minutosATexto, type EstadoMensualidad } from "@/lib/mensualidades";

// Datos de "Mi mensualidad" (Bloque M4). Lo usan el endpoint y la página, así que
// el recorte de qué se expone vive en un solo lugar.
//
// Devuelve SOLO lo que el titular necesita ver. Nunca email, teléfono, ids
// internos, auditoría, referencias de Mercado Pago, importes internos, motivos de
// bloqueo ni movimientos. Y siempre de UNA mensualidad (la de la sesión): no se
// mezclan otras vencidas del mismo teléfono.

export type MotivoReserva = "ok" | "sin_saldo" | "vencida" | "bloqueada";

export type MiPlan = {
  estado: EstadoMensualidad;
  nombre: string;
  codigo: string;
  saldo_minutos: number;
  saldo_texto: string;
  vence_el: string;
  dias_restantes: number;
  bloqueada: boolean;
  ultimo_plan: string | null;
  ultima_compra_at: string | null;
  puede_reservar: boolean;
  motivo: MotivoReserva;
};

type FilaVista = {
  codigo: string;
  titular_nombre: string;
  saldo_minutos: number;
  vence_el: string;
  bloqueada: boolean;
  estado: string;
  dias_restantes: number;
};

// El estado NUNCA se persiste: sale de la vista mensualidades_estado, que lo
// calcula con mensualidad_estado(saldo, vence_el, bloqueada, hoy).
export async function getMiPlan(mensualidadId: string): Promise<MiPlan | null> {
  const { data } = await supabaseAdmin
    .from("mensualidades_estado")
    .select("codigo, titular_nombre, saldo_minutos, vence_el, bloqueada, estado, dias_restantes")
    .eq("id", mensualidadId)
    .maybeSingle();
  if (!data) return null;
  const m = data as unknown as FilaVista;

  // Última compra APROBADA de esta mensualidad (solo nombre del plan y fecha).
  const { data: compra } = await supabaseAdmin
    .from("mensualidad_compras")
    .select("plan_nombre, aprobado_at")
    .eq("mensualidad_id", mensualidadId)
    .eq("procesamiento", "aplicado")
    .order("aprobado_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const estado = m.estado as EstadoMensualidad;
  // Motivo público tipado: nada de detalles administrativos.
  const motivo: MotivoReserva =
    estado === "bloqueada" ? "bloqueada"
    : estado === "vencida" ? "vencida"
    : estado === "agotada" ? "sin_saldo"
    : "ok";

  return {
    estado,
    // Solo el nombre: el apellido no hace falta para saludar.
    nombre: String(m.titular_nombre ?? "").split(/\s+/)[0] ?? "",
    codigo: m.codigo,
    saldo_minutos: Number(m.saldo_minutos) || 0,
    saldo_texto: minutosATexto(Number(m.saldo_minutos) || 0),
    vence_el: String(m.vence_el),
    dias_restantes: Number(m.dias_restantes) || 0,
    bloqueada: Boolean(m.bloqueada),
    ultimo_plan: compra?.plan_nombre ?? null,
    ultima_compra_at: compra?.aprobado_at ?? null,
    // La reserva llega en M5; acá solo se informa si va a poder hacerla.
    puede_reservar: motivo === "ok",
    motivo,
  };
}

// Busca la mensualidad por código + teléfono normalizado. Devuelve solo el id:
// quien llama decide qué hacer. No distingue "código inexistente" de "teléfono
// que no coincide": las dos cosas devuelven null.
export async function buscarPorCodigoYTelefono(
  codigoNormalizado: string,
  telefonoNormalizado: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("mensualidades")
    .select("id")
    .eq("codigo", codigoNormalizado)
    .eq("telefono_norm", telefonoNormalizado)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}
