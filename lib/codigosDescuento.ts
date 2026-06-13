import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Lógica compartida de códigos de descuento (la misma que usan las reservas),
// para reutilizarla desde el flujo de Gift Cards sin duplicar reglas.

function calcularDescuento(tipo: string, valor: number, totalOriginal: number) {
  if (tipo === "porcentaje") return totalOriginal * (valor / 100);
  if (tipo === "monto_fijo") return valor;
  if (tipo === "turno_gratis") return valor;
  return 0;
}

export type ValidacionCodigo = {
  valido: boolean;
  codigo: string | null;
  descuento: number;
  error: string | null;
};

export async function validarCodigoDescuento(
  codigoIngresado: string,
  totalOriginal: number
): Promise<ValidacionCodigo> {
  const codigoBuscado = String(codigoIngresado || "").trim().toUpperCase();

  if (!codigoBuscado) {
    return { valido: false, codigo: null, descuento: 0, error: "Código vacío" };
  }

  const { data: codigo, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("*")
    .eq("codigo", codigoBuscado)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!codigo) {
    return { valido: false, codigo: null, descuento: 0, error: "El código no existe" };
  }
  if (!codigo.activo) {
    return { valido: false, codigo: null, descuento: 0, error: "El código no está activo" };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  if (codigo.fecha_inicio && hoy < codigo.fecha_inicio) {
    return { valido: false, codigo: null, descuento: 0, error: "El código todavía no está vigente" };
  }
  if (codigo.fecha_fin && hoy > codigo.fecha_fin) {
    return { valido: false, codigo: null, descuento: 0, error: "El código está vencido" };
  }
  if (
    codigo.usos_maximos !== null &&
    codigo.usos_maximos !== undefined &&
    Number(codigo.usos_actuales || 0) >= Number(codigo.usos_maximos)
  ) {
    return { valido: false, codigo: null, descuento: 0, error: "El código ya alcanzó el máximo de usos" };
  }

  const descuentoCalculado = calcularDescuento(
    codigo.tipo_descuento,
    Number(codigo.valor_descuento || 0),
    totalOriginal
  );

  return {
    valido: true,
    codigo: codigo.codigo,
    descuento: Math.min(descuentoCalculado, totalOriginal),
    error: null,
  };
}

export async function consumirCodigoDescuento(codigo: string) {
  const codigoNormalizado = String(codigo || "").trim().toUpperCase();

  const { data: codigoActual, error } = await supabaseAdmin
    .from("codigos_descuento")
    .select("id, usos_actuales, usos_maximos")
    .eq("codigo", codigoNormalizado)
    .maybeSingle();

  if (error || !codigoActual) return;

  const nuevosUsos = Number(codigoActual.usos_actuales || 0) + 1;
  const usosMaximos =
    codigoActual.usos_maximos === null || codigoActual.usos_maximos === undefined
      ? null
      : Number(codigoActual.usos_maximos);
  const debeInactivar = usosMaximos !== null && nuevosUsos >= usosMaximos;

  await supabaseAdmin
    .from("codigos_descuento")
    .update({ usos_actuales: nuevosUsos, activo: debeInactivar ? false : true })
    .eq("id", codigoActual.id);
}
