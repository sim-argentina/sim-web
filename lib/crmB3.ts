// CRM B2B · B3 — ventas, cobros, comisiones y recompras (puro: sin base ni red).
// Importes en CENTAVOS (enteros) para sumar y comparar sin errores de coma
// flotante; a la base viajan como texto "123456.78" (crm_importe valida los
// centavos). Los estados de cobro y de comisión se DERIVAN de los cobros y pagos
// registrados: no hay casillas de "pagado". Nada de esto es facturación ni
// Finanzas: "Importe acordado" es el acuerdo comercial (sin IVA ni comprobantes) y
// "Cobrado según CRM" es lo que Administración registró a mano.
// Definiciones: docs/crm/b3-ventas-cobros-comisiones.md.

export type Centavos = number;

// ── Importes ────────────────────────────────────────────────────────────────
/** Valor que devuelve la base (numeric: número o texto) → centavos. */
export function aCentavos(v: number | string | null | undefined): Centavos | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
}

/** Centavos → "123456.78", la forma que acepta la RPC. */
export const aTextoImporte = (c: Centavos): string => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;

/**
 * Importe escrito por una persona → centavos (null si no se entiende o es
 * ambiguo). Como se escribe en Argentina: la coma separa los centavos y el punto
 * los miles ("150.000", "150.000,50"); sin coma, un punto seguido de 1 o 2 cifras
 * se toma como decimal ("150000.5"). Hasta 10 cifras enteras, como la base.
 */
export function leerImporte(texto: string): Centavos | null {
  const t = texto.replace(/\$|ars|\s/gi, "");
  if (!t) return null;
  let entero: string;
  let dec = "";
  if (t.includes(",")) {
    const m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(t);
    if (!m) return null;
    entero = m[1].replace(/\./g, "");
    dec = m[2];
  } else if (t.includes(".")) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) entero = t.replace(/\./g, "");
    else {
      const m = /^(\d+)\.(\d{1,2})$/.exec(t);
      if (!m) return null;
      entero = m[1];
      dec = m[2];
    }
  } else if (/^\d+$/.test(t)) entero = t;
  else return null;
  entero = entero.replace(/^0+(?=\d)/, "");
  if (entero.length > 10) return null;
  return Number(entero) * 100 + Number(dec.padEnd(2, "0"));
}

const F_PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const F_PESOS_CENTAVOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "$ 150.000" (o "$ 150.000,50" si tiene centavos). */
export const formatoPesos = (c: Centavos | null): string =>
  c === null ? "—" : (c % 100 === 0 ? F_PESOS : F_PESOS_CENTAVOS).format(c / 100);

// ── Catálogo y opciones ─────────────────────────────────────────────────────
export type CodigoProducto = "pack_10" | "pack_25" | "personalizado";
export type Producto = {
  codigo: CodigoProducto; nombre: string; experiencias: number | null; minimo_experiencias: number | null; duracion_minutos: number;
  precio: Centavos | null; comision_estandar: Centavos | null; activo: boolean; orden: number; version: number;
};

export type TipoComision = "pactada" | "no_corresponde";
export const FUNDAMENTOS = [
  { valor: "origen_comercial", texto: "Venta nueva: comercial que originó el lead" },
  { valor: "recompra_trabajada", texto: "Recompra trabajada por un comercial" },
  { valor: "recompra_espontanea", texto: "Recompra espontánea (sin comisión)" },
  { valor: "acuerdo_especial", texto: "Acuerdo especial" },
] as const;
export type Fundamento = (typeof FUNDAMENTOS)[number]["valor"];
export const textoFundamento = (f: string | null) => FUNDAMENTOS.find((x) => x.valor === f)?.texto ?? (f ?? "—");

export const MEDIOS = [
  { valor: "transferencia", texto: "Transferencia" },
  { valor: "efectivo", texto: "Efectivo" },
  { valor: "mercadopago", texto: "Mercado Pago (anotado a mano)" },
  { valor: "tarjeta", texto: "Tarjeta" },
  { valor: "otro", texto: "Otro" },
] as const;
export type Medio = (typeof MEDIOS)[number]["valor"];
export const textoMedio = (m: string) => MEDIOS.find((x) => x.valor === m)?.texto ?? m;

export const CONCEPTOS = [
  { valor: "anticipo", texto: "Anticipo" },
  { valor: "saldo", texto: "Saldo" },
  { valor: "otro", texto: "Otro" },
] as const;
export type Concepto = (typeof CONCEPTOS)[number]["valor"];
export const textoConcepto = (c: string) => CONCEPTOS.find((x) => x.valor === c)?.texto ?? c;

// ── Cobro ───────────────────────────────────────────────────────────────────
/**
 * Condición inicial 50/50: el anticipo esperado es la mitad del importe acordado
 * (redondeada al centavo hacia arriba) y el saldo, el resto. Es una referencia para
 * cargar los cobros: el estado sale SIEMPRE de lo cobrado.
 */
export const anticipoEsperado = (importe: Centavos): Centavos => Math.ceil(importe / 2);

export type EstadoCobro = "sin_cobros" | "parcial" | "anticipo" | "cobrada";
export const ESTADOS_COBRO: ReadonlyArray<{ valor: EstadoCobro; texto: string }> = [
  { valor: "sin_cobros", texto: "Sin cobros" },
  { valor: "parcial", texto: "Cobro parcial (menos que el anticipo)" },
  { valor: "anticipo", texto: "Anticipo cobrado · falta el saldo" },
  { valor: "cobrada", texto: "Cobrada por completo" },
];
export const textoEstadoCobro = (e: EstadoCobro) => ESTADOS_COBRO.find((x) => x.valor === e)!.texto;

/** Estado del cobro según lo registrado (lo cobrado nunca supera el importe: lo garantiza la base). */
export function estadoCobro(importe: Centavos, cobrado: Centavos): EstadoCobro {
  if (cobrado <= 0) return "sin_cobros";
  if (cobrado >= importe) return "cobrada";
  return cobrado >= anticipoEsperado(importe) ? "anticipo" : "parcial";
}

/** Importe sugerido para el próximo cobro: el anticipo que falta o el saldo. */
export function cobroSugerido(importe: Centavos, cobrado: Centavos, concepto: Concepto): Centavos {
  const saldo = Math.max(0, importe - cobrado);
  if (concepto === "anticipo") return Math.min(saldo, Math.max(0, anticipoEsperado(importe) - cobrado));
  return saldo;
}

// ── Comisión ────────────────────────────────────────────────────────────────
export type EstadoComision = "no_corresponde" | "prevista" | "generada" | "pagada_parcial" | "pagada" | "a_revisar";
export const ESTADOS_COMISION: ReadonlyArray<{ valor: EstadoComision; texto: string }> = [
  { valor: "no_corresponde", texto: "No corresponde" },
  { valor: "prevista", texto: "Prevista (falta cobrar la venta)" },
  { valor: "generada", texto: "Generada · sin pagar" },
  { valor: "pagada_parcial", texto: "Parcialmente pagada" },
  { valor: "pagada", texto: "Pagada" },
  { valor: "a_revisar", texto: "A revisar" },
];
export const textoEstadoComision = (e: EstadoComision) => ESTADOS_COMISION.find((x) => x.valor === e)!.texto;

export type MotivoRevision = "pagos_sin_comision" | "pagos_superan" | "otro_beneficiario" | "pagos_sin_cobro_total";
export const TEXTO_REVISION: Record<MotivoRevision, string> = {
  pagos_sin_comision: "Hay pagos de comisión en una venta que ya no lleva comisión.",
  pagos_superan: "Lo pagado supera la comisión pactada.",
  otro_beneficiario: "Hay pagos a otra persona que no es el beneficiario actual.",
  pagos_sin_cobro_total: "Hay pagos de comisión pero la venta ya no figura cobrada por completo.",
};

export type ComisionInput = {
  tipo: TipoComision; pactada: Centavos | null; beneficiario_id: string | null; importe: Centavos; cobrado: Centavos;
  pagos: ReadonlyArray<{ importe: Centavos; beneficiario_id: string }>;
};

/**
 * Estado de la comisión, derivado (misma regla que crm_venta_gestionar al pagar):
 *   · no corresponde: la venta no lleva comisión;
 *   · prevista: pactada, pero la venta todavía no está cobrada por completo;
 *   · generada: la venta está cobrada por completo y no se pagó nada;
 *   · parcialmente pagada / pagada: según lo pagado frente a lo pactado;
 *   · a revisar: algo no cierra (pagos que superan lo pactado, pagos a otra persona,
 *     pagos en una venta sin comisión o que dejó de estar cobrada por completo, p. ej.
 *     tras una corrección). Mientras esté a revisar no se registran pagos nuevos.
 */
export function estadoComision(v: ComisionInput): { estado: EstadoComision; pagado: Centavos; pendiente: Centavos; motivos: MotivoRevision[] } {
  const pagado = v.pagos.reduce((s, p) => s + p.importe, 0);
  const motivos: MotivoRevision[] = [];
  if (v.tipo === "no_corresponde") {
    if (pagado > 0) motivos.push("pagos_sin_comision");
  } else {
    if (pagado > (v.pactada ?? 0)) motivos.push("pagos_superan");
    if (v.pagos.some((p) => p.beneficiario_id !== v.beneficiario_id)) motivos.push("otro_beneficiario");
    if (pagado > 0 && v.cobrado < v.importe) motivos.push("pagos_sin_cobro_total");
  }
  if (motivos.length) return { estado: "a_revisar", pagado, pendiente: 0, motivos };
  if (v.tipo === "no_corresponde") return { estado: "no_corresponde", pagado, pendiente: 0, motivos };
  const pactada = v.pactada ?? 0;
  if (v.cobrado < v.importe) return { estado: "prevista", pagado, pendiente: 0, motivos };
  const pendiente = pactada - pagado;
  return { estado: pagado === 0 ? "generada" : pendiente > 0 ? "pagada_parcial" : "pagada", pagado, pendiente, motivos };
}

/** Importe distinto del de lista en un pack: la base pide confirmarlo (confirmar_importe). */
export const requiereConfirmarImporte = (p: Pick<Producto, "codigo" | "precio">, importe: Centavos | null) =>
  p.codigo !== "personalizado" && importe !== null && importe !== p.precio;

/**
 * Misma regla que crm_venta_comision: es estándar la comisión pactada de un pack,
 * por el importe de lista y con la comisión de lista, a quien originó el lead o a
 * quien trabajó la recompra. Todo lo demás (un descuento, un personalizado, un
 * acuerdo especial con o sin comisión) se confirma explícitamente.
 */
export function requiereConfirmarComision(p: Pick<Producto, "codigo" | "precio" | "comision_estandar">, importe: Centavos | null,
  c: { tipo: TipoComision | null; fundamento: Fundamento | null; importe: Centavos | null }): boolean {
  if (c.fundamento === "acuerdo_especial") return true;
  if (c.tipo !== "pactada") return false;
  const estandar = p.codigo !== "personalizado" && (c.fundamento === "origen_comercial" || c.fundamento === "recompra_trabajada")
    && c.importe === p.comision_estandar && importe === p.precio;
  return !estandar;
}

export type ComisionPropuesta = { tipo: TipoComision; fundamento: Fundamento; beneficiario_id: string | null; importe: Centavos | null };

/**
 * Comisión que propone el formulario (la persona puede cambiarla y la base valida):
 *   · venta nueva → al comercial que ORIGINÓ el lead (aunque cierre Administración o
 *     cambie el responsable del negocio), con la comisión de lista si el importe es
 *     el de lista; en un personalizado o con descuento, el importe queda vacío para
 *     cargarlo a mano (nunca 0 como "sin definir");
 *   · recompra → espontánea, sin comisión. Si un comercial la trabajó, se elige
 *     «recompra trabajada» con una visita suya en esta oportunidad.
 */
export function comisionPropuesta(o: { esRecompra: boolean; origenUsuarioId: string | null },
  p: Pick<Producto, "codigo" | "precio" | "comision_estandar">, importe: Centavos | null): ComisionPropuesta {
  if (o.esRecompra) return { tipo: "no_corresponde", fundamento: "recompra_espontanea", beneficiario_id: null, importe: null };
  const estandar = p.codigo !== "personalizado" && importe !== null && importe === p.precio ? p.comision_estandar : null;
  return { tipo: "pactada", fundamento: "origen_comercial", beneficiario_id: o.origenUsuarioId, importe: estandar };
}

// ── Entrega y campaña de Empresas (solo lectura) ───────────────────────────
export const ENTREGAS = [
  { valor: "pendiente", texto: "Tarjetas sin entregar" },
  { valor: "entregada", texto: "Tarjetas entregadas" },
] as const;
export type Entrega = (typeof ENTREGAS)[number]["valor"];

export type CampaniaLectura = {
  id: string; empresa: string; nombre: string | null; estado: string; estado_pago: string; modalidad: string;
  cantidad_contratada: number; duracion_minutos: number; usos_por_codigo: number;
  // (Empresas B8) Un solo código para todas las tarjetas del pack, con cantidad_contratada usos.
  codigo_comun: boolean;
  fecha_inicio: string | null; fecha_vencimiento: string | null; eliminada: boolean;
  codigos: { generados: number; disponibles: number; utilizados: number; vencidos: number; cancelados: number };
  // Experiencias descontadas del cupo (la regla de Empresas): una por simulador de las
  // reservas vigentes y de las canceladas sin liberar; de ellas, «retenidas» son las de
  // canceladas sin liberar. Una cancelada liberando no cuenta.
  usos: number;
  experiencias: { contratadas: number; usadas: number; retenidas: number; restantes: number };
};

/**
 * Avisos de la campaña vinculada frente a la venta (solo informan: no modifican la
 * campaña ni el CRM). La comparación de cobro es de estado, no de montos: la
 * campaña lleva su propio precio con IVA y no es la fuente de los cobros del CRM.
 */
export function avisosCampania(v: { experiencias: number; duracion_minutos: number; estado_cobro: EstadoCobro }, c: CampaniaLectura): string[] {
  const a: string[] = [];
  if (c.eliminada) a.push("La campaña fue eliminada en Empresas.");
  if (c.cantidad_contratada !== v.experiencias) {
    a.push(`La campaña tiene ${c.cantidad_contratada} turno${c.cantidad_contratada === 1 ? "" : "s"} contratado${c.cantidad_contratada === 1 ? "" : "s"} y la venta, ${v.experiencias} experiencias.`);
  }
  if (c.duracion_minutos !== v.duracion_minutos) a.push(`La campaña es de ${c.duracion_minutos} minutos por turno y la venta, de ${v.duracion_minutos}.`);
  if (c.estado_pago === "pagado" && v.estado_cobro !== "cobrada") a.push("Empresas marca la campaña como pagada, pero según el CRM la venta no está cobrada por completo.");
  if (c.estado_pago !== "pagado" && v.estado_cobro === "cobrada") a.push("Según el CRM la venta está cobrada, pero en Empresas la campaña figura con el pago pendiente.");
  return a;
}

// ── Lista de ventas ─────────────────────────────────────────────────────────
export type Pendiente = "cobro" | "entrega" | "comision";
export const PENDIENTES: ReadonlyArray<{ valor: Pendiente; texto: string }> = [
  { valor: "cobro", texto: "Falta cobrar" },
  { valor: "entrega", texto: "Falta entregar tarjetas" },
  { valor: "comision", texto: "Comisión para pagar" },
];

/** Una venta tal como la muestran la lista, el detalle y la ficha. Importes en centavos. */
export type VentaFila = {
  id: string; version: number; oportunidad_id: string; es_recompra: boolean; fecha_acuerdo: string; registrada_en: string;
  empresa: { id: string; nombre: string };
  producto: { codigo: CodigoProducto; nombre: string }; experiencias: number; duracion_minutos: number;
  importe: Centavos; cobrado: Centavos; saldo: Centavos; anticipo_esperado: Centavos; estado_cobro: EstadoCobro;
  comision: {
    tipo: TipoComision; fundamento: Fundamento; detalle: string | null; pactada: Centavos | null;
    beneficiario: { id: string; nombre: string } | null; pagado: Centavos; pendiente: Centavos; estado: EstadoComision; motivos: MotivoRevision[];
  };
  entrega: { estado: Entrega; fecha: string | null };
  campania_id: string | null;
  anulada: { en: string; motivo: string } | null;
  pendientes: Pendiente[];
};

export function pendientesDe(v: Pick<VentaFila, "saldo" | "entrega" | "comision" | "anulada">): Pendiente[] {
  if (v.anulada) return [];
  const p: Pendiente[] = [];
  if (v.saldo > 0) p.push("cobro");
  if (v.entrega.estado === "pendiente") p.push("entrega");
  if (v.comision.estado === "generada" || v.comision.estado === "pagada_parcial") p.push("comision");
  return p;
}

export type FiltrosVentas = {
  desde?: string; hasta?: string; q?: string; empresa?: string; producto?: string; cobro?: string; comision?: string; pendiente?: string;
  anuladas?: boolean;
};

const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Filtros de la lista (todos opcionales). Las anuladas solo aparecen si se piden. */
export function filtrarVentas(filas: VentaFila[], f: FiltrosVentas): VentaFila[] {
  const q = f.q?.trim() ? normalizar(f.q.trim()) : "";
  return filas.filter((v) =>
    (f.anuladas || !v.anulada)
    && (!f.desde || v.fecha_acuerdo >= f.desde) && (!f.hasta || v.fecha_acuerdo <= f.hasta)
    && (!q || normalizar(v.empresa.nombre).includes(q))
    && (!f.empresa || v.empresa.id === f.empresa)
    && (!f.producto || v.producto.codigo === f.producto)
    && (!f.cobro || (!v.anulada && v.estado_cobro === f.cobro))
    && (!f.comision || (!v.anulada && v.comision.estado === f.comision))
    && (!f.pendiente || v.pendientes.includes(f.pendiente as Pendiente)));
}

/**
 * Totales de una lista, SOLO sobre ventas vigentes (las anuladas no suman).
 * «Comisión a pagar» = lo pendiente de comisiones ya generadas.
 */
export function totalesVentas(filas: VentaFila[]) {
  const vig = filas.filter((v) => !v.anulada);
  const suma = (f: (v: VentaFila) => number) => vig.reduce((s, v) => s + f(v), 0);
  return {
    ventas: vig.length, acordado: suma((v) => v.importe), cobrado: suma((v) => v.cobrado), saldo: suma((v) => v.saldo),
    comision_pactada: suma((v) => (v.comision.tipo === "pactada" ? v.comision.pactada ?? 0 : 0)),
    comision_pagada: suma((v) => v.comision.pagado), comision_a_pagar: suma((v) => v.comision.pendiente),
  };
}

/**
 * Historial de compras de un negocio (ficha). Definiciones:
 *   · compras = acuerdos VIGENTES registrados en el CRM (una venta anulada no es una
 *     compra), con o sin cobro;
 *   · cobradas por completo = las compras cuyo cobro según CRM llegó al importe;
 *   · última compra = la fecha de acuerdo más reciente entre las compras;
 *   · importes = suma de lo acordado, de lo cobrado según CRM y del saldo;
 *   · packs = cantidad de compras por producto.
 * Lo comprado antes del CRM no está cargado: si el negocio es cliente previo, la
 * ficha lo advierte (historial incompleto).
 */
export function resumenCompras(filas: VentaFila[]) {
  const vig = filas.filter((v) => !v.anulada);
  const packs = new Map<string, { nombre: string; compras: number; experiencias: number }>();
  for (const v of vig) {
    const p = packs.get(v.producto.codigo) ?? { nombre: v.producto.nombre, compras: 0, experiencias: 0 };
    p.compras++;
    p.experiencias += v.experiencias;
    packs.set(v.producto.codigo, p);
  }
  return {
    compras: vig.length,
    cobradas: vig.filter((v) => v.estado_cobro === "cobrada").length,
    ultima: vig.reduce<string | null>((m, v) => (!m || v.fecha_acuerdo > m ? v.fecha_acuerdo : m), null),
    acordado: vig.reduce((s, v) => s + v.importe, 0),
    cobrado: vig.reduce((s, v) => s + v.cobrado, 0),
    saldo: vig.reduce((s, v) => s + v.saldo, 0),
    packs: [...packs.entries()].map(([codigo, p]) => ({ codigo, ...p })),
  };
}
