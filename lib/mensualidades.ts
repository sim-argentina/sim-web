// Mensualidades SIM — reglas puras compartidas (Bloque M2).
// Sin acceso a red ni a Supabase: solo constantes y normalizaciones que TIENEN que
// coincidir exactamente con las funciones SQL homónimas de db/mensualidades-m2.sql.
// La autoridad de precio, minutos, vencimiento y saldo es SIEMPRE la base de datos:
// lo de acá sirve para validar entradas y mostrar, nunca para calcular saldo.

// Tope de minutos que se arrastran del saldo anterior al renovar. Debe coincidir
// con c_max_traslado de public.mensualidad_aplicar_compra.
export const MAX_TRASLADO_MINUTOS = 60;

// Unidad mínima: todo (planes, saldo, movimientos) es múltiplo de 15.
export const UNIDAD_MINUTOS = 15;

// Duraciones y cantidades permitidas al reservar con saldo (se implementa en M5;
// la ocupación de la agenda para 45/60 llega en M6).
export const DURACIONES_MENSUALIDAD = [15, 30, 45, 60] as const;
export type DuracionMensualidad = (typeof DURACIONES_MENSUALIDAD)[number];
export const SIMULADORES_MIN = 1;
export const SIMULADORES_MAX = 4;

// Alfabeto del código: sin 0/O/1/I para que no haya lecturas ambiguas.
export const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODIGO_RE = /^MEN-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export type EstadoMensualidad = "vigente" | "agotada" | "vencida" | "bloqueada";
export type EstadoPagoCompra = "pendiente" | "aprobado" | "rechazado" | "cancelado";
export type ProcesamientoCompra = "pendiente" | "aplicado" | "ignorado";
export type TipoCompra = "alta" | "renovacion";
export type TipoMovimiento =
  | "compra" | "renovacion" | "descarte" | "consumo" | "devolucion" | "ajuste_admin";

export type Plan = {
  id: string; slug: string; nombre: string; minutos: number; precio: number;
  vigencia_dias: number; etiqueta: string | null; orden: number; activo: boolean;
};

// Minutos que consume una reserva. Es la fórmula obligatoria del producto; el
// descuento real lo hace la RPC en el servidor, esto solo sirve para previsualizar.
export function minutosDeReserva(duracion: number, simuladores: number): number {
  return Number(duracion) * Number(simuladores);
}

export function duracionValida(d: unknown): d is DuracionMensualidad {
  return (DURACIONES_MENSUALIDAD as readonly number[]).includes(Number(d));
}

export function cantidadSimuladoresValida(n: unknown): boolean {
  const v = Number(n);
  return Number.isInteger(v) && v >= SIMULADORES_MIN && v <= SIMULADORES_MAX;
}

// Espejo exacto de public.mensualidad_normalizar_telefono.
// Solo dígitos + limpieza de prefijos argentinos (00 / 54 / 9 / 0) y recorte a los
// últimos 10. LIMITACIÓN CONOCIDA: no interpreta el "15" intermedio de los celulares
// viejos, así que "0351 15-5123456" NO normaliza igual que "+54 9 351 512-3456".
export function normalizarTelefono(tel: string | null | undefined): string {
  let v = String(tel ?? "").replace(/[^0-9]/g, "");
  if (v.startsWith("00") && v.length > 10) v = v.slice(2);
  if (v.startsWith("54") && v.length > 10) v = v.slice(2);
  if (v.startsWith("9") && v.length > 10) v = v.slice(1);
  if (v.startsWith("0") && v.length > 10) v = v.slice(1);
  if (v.length > 10) v = v.slice(-10);
  return v;
}

export function telefonoNormalizadoValido(norm: string): boolean {
  return /^[0-9]{8,15}$/.test(norm);
}

// Espejo exacto de public.mensualidad_normalizar_codigo.
// Devuelve null si tiene símbolos fuera del alfabeto: no adivina (0/O y 1/I están
// excluidos justamente para que no haya que adivinar).
export function normalizarCodigo(codigo: string | null | undefined): string | null {
  let v = String(codigo ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (v.startsWith("MEN")) v = v.slice(3);
  if (v.length !== 8) return null;
  if (!new RegExp(`^[${ALFABETO_CODIGO}]{8}$`).test(v)) return null;
  return `MEN-${v.slice(0, 4)}-${v.slice(4)}`;
}

// Espejo de public.mensualidad_estado. El estado NO se persiste: se deriva de
// saldo + bloqueo + fecha, en este orden de precedencia.
export function estadoMensualidad(args: {
  saldoMinutos: number; venceEl: string; bloqueada: boolean; hoy: string;
}): EstadoMensualidad {
  if (args.bloqueada) return "bloqueada";
  if (args.venceEl < args.hoy) return "vencida";
  if ((args.saldoMinutos ?? 0) <= 0) return "agotada";
  return "vigente";
}

// Previsualización del resultado de una compra (la verdad la calcula la RPC).
// Renovación = arrastra hasta MAX_TRASLADO_MINUTOS y suma el plan completo.
export function simularCompra(args: {
  saldoActual: number; venceActual: string | null; planMinutos: number; hoy: string;
}): { tipo: TipoCompra; trasladados: number; descartados: number; saldoResultante: number } {
  const vigente = args.venceActual !== null && args.venceActual >= args.hoy;
  if (!vigente) {
    return { tipo: "alta", trasladados: 0, descartados: 0, saldoResultante: args.planMinutos };
  }
  const trasladados = Math.min(args.saldoActual, MAX_TRASLADO_MINUTOS);
  return {
    tipo: "renovacion",
    trasladados,
    descartados: args.saldoActual - trasladados,
    saldoResultante: trasladados + args.planMinutos,
  };
}
