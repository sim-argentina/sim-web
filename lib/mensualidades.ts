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

// Saldo legible: los minutos siguen siendo la unidad real, pero "150 minutos" se
// entiende peor que "2 h 30 min".
export function minutosATexto(minutos: number): string {
  const m = Math.max(0, Math.trunc(Number(minutos) || 0));
  if (m === 0) return "0 min";
  const h = Math.floor(m / 60);
  const resto = m % 60;
  if (h === 0) return `${resto} min`;
  if (resto === 0) return `${h} h`;
  return `${h} h ${resto} min`;
}

export function duracionValida(d: unknown): d is DuracionMensualidad {
  return (DURACIONES_MENSUALIDAD as readonly number[]).includes(Number(d));
}

export function cantidadSimuladoresValida(n: unknown): boolean {
  const v = Number(n);
  return Number.isInteger(v) && v >= SIMULADORES_MIN && v <= SIMULADORES_MAX;
}

// ── Normalización argentina de teléfonos (M2.1) ─────────────────────────────
// Espejo EXACTO de public.mensualidad_normalizar_telefono. Si cambia una, cambia
// la otra: lib/mensualidades.integration.ts compara las dos contra la misma tabla
// de casos.
//
// Forma canónica: el número nacional argentino de 10 dígitos, código de área +
// número local, sin 0, sin 15 y sin +54 9. Ejemplo: 3515123456.
//
// El plan de numeración argentino tiene exactamente tres largos de código de área:
//   · 2 dígitos → solo "11" (AMBA).
//   · 3 dígitos → un conjunto fijo (AREAS_3_DIGITOS, 38 indicativos).
//   · 4 dígitos → todo el resto, que siempre empieza con 2 o 3.
// Como área + local = 10 SIEMPRE, el largo del área determina dónde termina y por
// lo tanto dónde puede estar el "15" histórico: justo después del código de área.
//
// FUENTE OFICIAL — verificada el 2026-09-05 contra ENACOM:
//   https://www.enacom.gob.ar/indicativos-interurbanos_p143
//   planilla "archivo_20240521035456_1549.xls", hoja "AREAS LOCALES 300".
// La planilla trae 300 indicativos: 1 de dos dígitos (11), 38 de tres y 261 de
// cuatro. Ninguno de cuatro empieza con 1 y todos arrancan con 1, 2 o 3, que es
// exactamente lo que hace única la lectura del "15".
export const AREAS_3_DIGITOS: ReadonlySet<string> = new Set([
  "220", "221", "223", "230", "236", "237", "249",
  "260", "261", "263", "264", "266", "280", "291", "294", "297", "298", "299",
  "336", "341", "342", "343", "345", "348", "351", "353", "358",
  "362", "364", "370", "376", "379", "380", "381", "383", "385", "387", "388",
]);

export const TELEFONO_CANONICO_RE = /^[0-9]{10}$/;

// Símbolos de presentación aceptados. Cualquier otra cosa (letras incluidas) se rechaza.
const SIMBOLOS_PERMITIDOS = /^[0-9+().\-\s]+$/;

export type TelefonoRechazo =
  | "vacio" | "simbolos_invalidos" | "mas_mal_ubicado" | "prefijo_extranjero"
  | "largo_invalido" | "area_invalida" | "sin_15_en_el_borde" | "ambiguo";

export type TelefonoNormalizado =
  | { ok: true; valor: string }
  | { ok: false; motivo: TelefonoRechazo };

// Largos de área POSIBLES para un número de 12 dígitos. Son candidatos, no una
// decisión: 49 de los 261 indicativos de 4 dígitos empiezan con uno de 3 válido
// (2202/220, 3489/348, 2945/294…), así que quedarse con el primero que matchea
// rompería justo esas localidades. Se prueban todos y decide dónde cae el "15".
function largosPosiblesDeArea(d: string): number[] {
  const out: number[] = [];
  if (d.startsWith("11")) out.push(2);                 // único indicativo de 2
  if (AREAS_3_DIGITOS.has(d.slice(0, 3))) out.push(3);
  if (d[0] === "2" || d[0] === "3") out.push(4);       // el resto del plan
  return out;
}

function areaPlausible(d: string): boolean {
  if (d.startsWith("11")) return true;
  return d[0] === "2" || d[0] === "3";
}

// Devuelve el número canónico o el motivo del rechazo. Ante cualquier duda NO
// adivina: prefiere rechazar antes que asociar la mensualidad a otra persona.
export function normalizarTelefonoDetallado(tel: string | null | undefined): TelefonoNormalizado {
  const crudo = String(tel ?? "").trim();
  if (!crudo) return { ok: false, motivo: "vacio" };
  if (!SIMBOLOS_PERMITIDOS.test(crudo)) return { ok: false, motivo: "simbolos_invalidos" };

  const conMas = crudo.startsWith("+");
  if ((crudo.match(/\+/g) ?? []).length > 1) return { ok: false, motivo: "mas_mal_ubicado" };
  if (crudo.indexOf("+") > 0) return { ok: false, motivo: "mas_mal_ubicado" };

  let d = crudo.replace(/[^0-9]/g, "");
  if (!d) return { ok: false, motivo: "vacio" };

  // Prefijo internacional. Si viene explícito (+ o 00), TIENE que ser Argentina.
  if (conMas) {
    if (!d.startsWith("54")) return { ok: false, motivo: "prefijo_extranjero" };
    d = d.slice(2);
  } else if (d.startsWith("00")) {
    d = d.slice(2);
    if (!d.startsWith("54")) return { ok: false, motivo: "prefijo_extranjero" };
    d = d.slice(2);
  } else if (d.startsWith("54") && d.length >= 12) {
    // Ningún código de área argentino empieza con 5: solo puede ser el país.
    d = d.slice(2);
  }

  // 9 móvil y 0 de trunk nacional: ningún código de área empieza con 0 ni con 9.
  // El corte nunca baja de 10 dígitos, así que no puede comerse un área válida.
  while (d.length > 10 && (d[0] === "0" || d[0] === "9")) d = d.slice(1);

  if (d.length === 10) {
    return areaPlausible(d) ? { ok: true, valor: d } : { ok: false, motivo: "area_invalida" };
  }

  if (d.length === 12) {
    // 12 dígitos = 10 del número + el "15" histórico intercalado. El "15" solo es
    // válido pegado al final del código de área: se prueban los largos posibles y
    // se acepta el único que lo tenga ahí.
    const posibles = largosPosiblesDeArea(d);
    if (posibles.length === 0) return { ok: false, motivo: "area_invalida" };
    const candidatos = posibles.filter((a) => d.slice(a, a + 2) === "15");
    // Dos lecturas válidas a la vez son imposibles (área 3 exige d[4]="5" y área 4
    // exige d[4]="1"; área 2 exigiría un indicativo de 4 que empiece con 11 y no
    // existe ninguno). Igual se comprueba: ante ambigüedad se rechaza, nunca se
    // elige una en silencio.
    if (candidatos.length > 1) return { ok: false, motivo: "ambiguo" };
    if (candidatos.length === 0) return { ok: false, motivo: "sin_15_en_el_borde" };
    const area = candidatos[0];
    const salida = d.slice(0, area) + d.slice(area + 2);
    if (salida.length !== 10 || !areaPlausible(salida)) return { ok: false, motivo: "area_invalida" };
    return { ok: true, valor: salida };
  }

  return { ok: false, motivo: "largo_invalido" };
}

// Atajo: el número canónico, o null si no es interpretable.
export function normalizarTelefono(tel: string | null | undefined): string | null {
  const r = normalizarTelefonoDetallado(tel);
  return r.ok ? r.valor : null;
}

export function telefonoNormalizadoValido(norm: string | null | undefined): boolean {
  return typeof norm === "string" && TELEFONO_CANONICO_RE.test(norm);
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
