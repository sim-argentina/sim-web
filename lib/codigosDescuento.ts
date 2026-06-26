import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Lógica compartida de códigos de descuento (la misma que usan las reservas),
// para reutilizarla desde el flujo de Gift Cards sin duplicar reglas.

function calcularDescuento(tipo: string, valor: number, totalOriginal: number) {
  if (tipo === "porcentaje") return totalOriginal * (valor / 100);
  if (tipo === "monto_fijo") return valor;
  if (tipo === "turno_gratis") return valor;
  return 0;
}

// Día de la semana (0=domingo … 6=sábado) de una fecha YYYY-MM-DD del calendario
// Argentina. Se arma con componentes locales (no se parsea como ISO con zona)
// para que el día sea el del calendario, sin corrimientos por el timezone del
// servidor (mismo criterio que isWeekendDate del front).
export function diaSemanaArg(fechaTurno: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaTurno || "").trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

export function esFinDeSemana(fechaTurno: string): boolean {
  const dow = diaSemanaArg(fechaTurno);
  return dow === 0 || dow === 6; // 0 = domingo, 6 = sábado
}

const MSG_FECHA_NO_DISPONIBLE =
  "Este código no está disponible para la fecha seleccionada.";
const MSG_SOLO_DIAS_HABILES =
  "Este código solo es válido para reservas de lunes a viernes.";

export type ValidacionCodigo = {
  valido: boolean;
  codigo: string | null;
  descuento: number;
  error: string | null;
};

export async function validarCodigoDescuento(
  codigoIngresado: string,
  totalOriginal: number,
  fechaTurno?: string | null
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

  // Restricciones opcionales por fecha del turno. Solo aplican cuando hay
  // fechaTurno (reservas); Gift Cards no la pasa, así que no cambia su
  // comportamiento.
  if (fechaTurno) {
    const dow = diaSemanaArg(fechaTurno);

    // Días permitidos personalizados (0..6). Tienen prioridad sobre el flag
    // legacy solo_dias_habiles.
    const diasPermitidos =
      Array.isArray(codigo.dias_permitidos) && codigo.dias_permitidos.length > 0
        ? codigo.dias_permitidos.map(Number)
        : null;

    if (diasPermitidos) {
      if (dow !== null && !diasPermitidos.includes(dow)) {
        return { valido: false, codigo: null, descuento: 0, error: MSG_FECHA_NO_DISPONIBLE };
      }
    } else if (codigo.solo_dias_habiles && (dow === 0 || dow === 6)) {
      // Compatibilidad: solo_dias_habiles ≡ lunes a viernes.
      return { valido: false, codigo: null, descuento: 0, error: MSG_SOLO_DIAS_HABILES };
    }

    // Fechas puntuales bloqueadas (feriados, promos no acumulables, etc.).
    const fechasBloqueadas = Array.isArray(codigo.fechas_bloqueadas)
      ? codigo.fechas_bloqueadas.map((f: unknown) => String(f).slice(0, 10))
      : [];
    if (fechasBloqueadas.includes(fechaTurno)) {
      return { valido: false, codigo: null, descuento: 0, error: MSG_FECHA_NO_DISPONIBLE };
    }
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

export type UsoCodigoContexto = {
  reserva_id?: number | null;
  nombre?: string | null;
  telefono?: string | null;
  fecha_reserva?: string | null;
  hora_reserva?: string | null;
  total_original?: number | null;
  descuento_aplicado?: number | null;
  total_final?: number | null;
  mercado_pago_payment_id?: string | null;
};

// Consumo ATÓMICO vía RPC (UPDATE ... WHERE usos_actuales < usos_maximos).
// Devuelve true si se consumió un uso, false si estaba agotado/inválido.
// Elimina la race condition del read-modify-write anterior (SIM-A02).
// Si el consumo tuvo éxito, registra el uso en usos_codigos_descuento (un solo
// registro por consumo → no duplica). Es best-effort: si la auditoría falla, el
// consumo igual quedó hecho y no se bloquea el flujo de pago.
export async function consumirCodigoDescuento(
  codigo: string,
  contexto?: UsoCodigoContexto
): Promise<boolean> {
  const codigoNormalizado = String(codigo || "").trim().toUpperCase();
  if (!codigoNormalizado) return false;

  const { data, error } = await supabaseAdmin.rpc("consumir_codigo_descuento", {
    p_codigo: codigoNormalizado,
  });

  if (error) {
    console.error("Error consumiendo código de descuento:", error.message);
    return false;
  }
  if (data !== true) return false;

  try {
    const { data: cod } = await supabaseAdmin
      .from("codigos_descuento")
      .select("id")
      .eq("codigo", codigoNormalizado)
      .maybeSingle();

    await supabaseAdmin.from("usos_codigos_descuento").insert({
      codigo_id: cod?.id ?? null,
      codigo: codigoNormalizado,
      reserva_id: contexto?.reserva_id ?? null,
      nombre: contexto?.nombre ?? null,
      telefono: contexto?.telefono ?? null,
      fecha_reserva: contexto?.fecha_reserva ?? null,
      hora_reserva: contexto?.hora_reserva ?? null,
      total_original: contexto?.total_original ?? null,
      descuento_aplicado: contexto?.descuento_aplicado ?? null,
      total_final: contexto?.total_final ?? null,
      mercado_pago_payment_id: contexto?.mercado_pago_payment_id ?? null,
    });
  } catch (e) {
    console.warn("No se pudo registrar el uso del código:", (e as Error)?.message);
  }

  return true;
}
