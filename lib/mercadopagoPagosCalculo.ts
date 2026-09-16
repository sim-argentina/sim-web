// Conciliación financiera de los cobros web de Mercado Pago (Checkout Pro).
//
// El cliente paga un BRUTO, pero Mercado Pago acredita un NETO: descuenta sus
// cargos antes de liberar el dinero. Finanzas necesita las dos cifras separadas:
//
//   - Revenue y métricas comerciales  → BRUTO (lo que pagó el cliente).
//   - Saldo disponible de Mercado Pago → NETO (lo que realmente entró).
//
// Este módulo NO estima con una tasa fija: usa los números reales que devuelve
// Mercado Pago por cada pago (`fee_details` y `transaction_details
// .net_received_amount`). Es la única fuente de la comisión web.
//
// Este módulo es PURO (sin red ni DB) para poder testear todas las formas que
// devuelve MP sin pagos reales ni credenciales. La persistencia vive en
// @/lib/mercadopagoPagos, que lo re-exporta: el resto del código no cambia.

// ── Tipos ────────────────────────────────────────────────────────────────────

// Productos web que cobran por Checkout Pro. Coinciden con las fuentes de
// fin_ingresos_por_mes para que bruto y cargos caigan siempre en el mismo mes.
export const PRODUCTOS_WEB = ["campeonatos", "reservas_online", "gift_cards"] as const;
export type ProductoWeb = (typeof PRODUCTOS_WEB)[number];

export type FeeDetail = { type?: string | null; amount?: number | string | null; fee_payer?: string | null };

// charges_details trae TODOS los conceptos que Mercado Pago descuenta, no solo su
// comisión: también retenciones impositivas (SIRTAC, IIBB…) que NO aparecen en
// fee_details pero sí están descontadas en net_received_amount.
export type ChargeDetail = {
  name?: string | null;
  type?: string | null;
  amounts?: { original?: number | string | null; refunded?: number | string | null } | null;
};

// Forma parcial del pago de Mercado Pago: solo lo que se usa para conciliar.
// No se guarda el pago completo (trae datos personales del pagador).
export type PagoMpFinanzas = {
  id?: string | number | null;
  status?: string | null;
  status_detail?: string | null;
  currency_id?: string | null;
  external_reference?: string | null;
  transaction_amount?: number | string | null;
  fee_details?: FeeDetail[] | null;
  charges_details?: ChargeDetail[] | null;
  transaction_details?: { net_received_amount?: number | string | null; total_paid_amount?: number | string | null } | null;
  date_approved?: string | null;
  date_last_updated?: string | null;
  money_release_date?: string | null;
  money_release_status?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
};

export type FinanzasPago = {
  bruto: number | null;
  // Cargos que paga SIM (fee_payer = collector). Nunca los que paga el cliente.
  cargos: number | null;
  neto: number | null;
  // Trazabilidad de las dos vías de cálculo, para poder auditar la diferencia.
  cargosFeeDetails: number | null;
  cargosChargesDetails: number | null;
  netoMp: number | null;
  feeDetails: FeeDetail[];
  chargesDetails: ChargeDetail[];
  // cargos − desglose conocido. Debe ser ~0; si no, hay un concepto que el
  // desglose no explica y el pago queda marcado como no conciliado.
  diferenciaRedondeo: number | null;
  conciliado: boolean;
  // true cuando MP no dio ni fee_details ni net_received_amount: NO se asume 0.
  incompleto: boolean;
  motivoIncompleto: string | null;
  moneda: string | null;
  mpStatus: string | null;
  mpStatusDetail: string | null;
  dateApproved: string | null;
  dateLastUpdated: string | null;
  moneyReleaseDate: string | null;
  moneyReleaseStatus: string | null;
  metodoPago: string | null;
  tipoPago: string | null;
};

// Tolerancia de un centavo: MP redondea a 2 decimales en cada cargo.
export const TOLERANCIA_CONCILIACION = 0.01;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Extracción pura ──────────────────────────────────────────────────────────

// Suma los cargos que paga SIM. `fee_details` puede traer varios conceptos
// (mercadopago_fee, application_fee, financing_fee, …): se suman todos los que
// pague el collector. Un cargo con fee_payer = "payer" lo paga el cliente y NO
// reduce lo que recibimos, así que no se cuenta.
//
// Si un cargo viene sin fee_payer se cuenta como nuestro: subestimar el saldo es
// preferible a inflarlo.
//
// Devuelve null —no 0— cuando no hay NINGÚN cargo del collector: un array vacío
// significa "Mercado Pago no informó cargos", no "no nos cobró nada". Tomarlo
// como 0 inflaría el saldo de MP en silencio, que es justo lo que hay que evitar.
export function sumarCargosCollector(feeDetails: FeeDetail[] | null | undefined): number | null {
  if (!Array.isArray(feeDetails)) return null;
  let total = 0;
  let hubo = false;
  for (const f of feeDetails) {
    const pagador = String(f?.fee_payer ?? "collector").trim().toLowerCase();
    if (pagador !== "collector") continue;
    const monto = num(f?.amount);
    if (monto === null) continue;
    total += monto;
    hubo = true;
  }
  return hubo ? round2(total) : null;
}

// Suma los conceptos de charges_details netos de lo reintegrado. Incluye la
// comisión y las RETENCIONES impositivas, que fee_details no trae.
export function sumarChargesDetails(charges: ChargeDetail[] | null | undefined): number | null {
  if (!Array.isArray(charges) || charges.length === 0) return null;
  let total = 0;
  for (const c of charges) {
    const original = num(c?.amounts?.original) ?? 0;
    const reintegrado = num(c?.amounts?.refunded) ?? 0;
    total += original - reintegrado;
  }
  return round2(total);
}

// Traduce un pago de Mercado Pago a las tres cifras que necesita Finanzas.
//
// `net_received_amount` manda: es lo que MP dice que acreditó. `fee_details` se
// conserva como respaldo y para auditar el desglose de cargos.
export function extraerFinanzasPago(pago: PagoMpFinanzas): FinanzasPago {
  const bruto = num(pago?.transaction_amount);
  const feeDetails = Array.isArray(pago?.fee_details) ? pago.fee_details : [];
  const chargesDetails = Array.isArray(pago?.charges_details) ? pago.charges_details : [];
  const cargosFeeDetails = sumarCargosCollector(pago?.fee_details);
  const cargosChargesDetails = sumarChargesDetails(pago?.charges_details);
  const netoMp = num(pago?.transaction_details?.net_received_amount);
  const estado = String(pago?.status ?? "").trim().toLowerCase();

  const base = {
    bruto,
    cargosFeeDetails,
    cargosChargesDetails,
    netoMp,
    feeDetails,
    chargesDetails,
    moneda: pago?.currency_id ? String(pago.currency_id) : null,
    mpStatus: pago?.status ? String(pago.status) : null,
    mpStatusDetail: pago?.status_detail ? String(pago.status_detail) : null,
    dateApproved: pago?.date_approved ?? null,
    dateLastUpdated: pago?.date_last_updated ?? null,
    moneyReleaseDate: pago?.money_release_date ?? null,
    moneyReleaseStatus: pago?.money_release_status ?? null,
    metodoPago: pago?.payment_method_id ? String(pago.payment_method_id) : null,
    tipoPago: pago?.payment_type_id ? String(pago.payment_type_id) : null,
  };

  const incompletoCon = (motivo: string): FinanzasPago => ({
    ...base,
    cargos: null,
    neto: null,
    diferenciaRedondeo: null,
    conciliado: false,
    incompleto: true,
    motivoIncompleto: motivo,
  });

  if (bruto === null) return incompletoCon("sin_transaction_amount");

  // Un pago NO aprobado no acreditó nada: net_received_amount viene en 0 y
  // tomarlo como válido inventaría un cargo igual al bruto. Queda marcado para
  // que Finanzas lo muestre como advertencia con su payment_id.
  if (estado !== "approved") return incompletoCon(`pago_no_aprobado:${estado || "desconocido"}`);

  // Camino principal: MP dio el neto acreditado. Es el dato autoritativo porque
  // ya contempla comisión + retenciones + cualquier otra deducción.
  if (netoMp !== null) {
    const cargos = round2(bruto - netoMp);
    // Se contrasta contra el desglose más completo disponible: charges_details
    // incluye retenciones impositivas que fee_details no trae.
    const desglose = cargosChargesDetails ?? cargosFeeDetails;
    const diferenciaRedondeo = desglose === null ? null : round2(cargos - desglose);
    return {
      ...base,
      cargos,
      neto: round2(netoMp),
      diferenciaRedondeo,
      conciliado: diferenciaRedondeo === null || Math.abs(diferenciaRedondeo) <= TOLERANCIA_CONCILIACION,
      incompleto: false,
      motivoIncompleto: null,
    };
  }

  // Sin neto pero con desglose de cargos: se reconstruye desde el más completo.
  const desgloseSolo = cargosChargesDetails ?? cargosFeeDetails;
  if (desgloseSolo !== null) {
    return {
      ...base,
      cargos: desgloseSolo,
      neto: round2(bruto - desgloseSolo),
      diferenciaRedondeo: 0,
      conciliado: true,
      incompleto: false,
      motivoIncompleto: null,
    };
  }

  // Ni neto ni cargos: NO se asume comisión 0 (inflaría el saldo de MP).
  return incompletoCon("sin_fee_details_ni_net_received_amount");
}


// ── Fila lista para persistir ────────────────────────────────────────────────

export type OrigenRegistro = "webhook" | "reconciliacion" | "backfill";

export type FilaPagoWeb = {
  payment_id: string;
  producto: ProductoWeb;
  referencia_externa: string | null;
  bruto: number | null;
  cargos: number | null;
  neto: number | null;
  cargos_fee_details: number | null;
  cargos_charges_details: number | null;
  neto_mp: number | null;
  fee_details: FeeDetail[];
  charges_details: ChargeDetail[];
  diferencia_redondeo: number | null;
  conciliado: boolean;
  incompleto: boolean;
  motivo_incompleto: string | null;
  moneda: string | null;
  mp_status: string | null;
  mp_status_detail: string | null;
  date_approved: string | null;
  date_last_updated: string | null;
  money_release_date: string | null;
  money_release_status: string | null;
  metodo_pago: string | null;
  tipo_pago: string | null;
  origen: OrigenRegistro;
};

// Determinística: el mismo pago produce siempre la misma fila. Es lo que hace
// que reprocesar un webhook o repetir el backfill sea idempotente.
export function filaPagoWeb(
  paymentId: string,
  producto: ProductoWeb,
  pago: PagoMpFinanzas,
  origen: OrigenRegistro
): FilaPagoWeb {
  const f = extraerFinanzasPago(pago);
  return {
    payment_id: String(paymentId),
    producto,
    referencia_externa: pago?.external_reference ? String(pago.external_reference) : null,
    bruto: f.bruto,
    cargos: f.cargos,
    neto: f.neto,
    cargos_fee_details: f.cargosFeeDetails,
    cargos_charges_details: f.cargosChargesDetails,
    neto_mp: f.netoMp,
    fee_details: f.feeDetails,
    charges_details: f.chargesDetails,
    diferencia_redondeo: f.diferenciaRedondeo,
    conciliado: f.conciliado,
    incompleto: f.incompleto,
    motivo_incompleto: f.motivoIncompleto,
    moneda: f.moneda,
    mp_status: f.mpStatus,
    mp_status_detail: f.mpStatusDetail,
    date_approved: f.dateApproved,
    date_last_updated: f.dateLastUpdated,
    money_release_date: f.moneyReleaseDate,
    money_release_status: f.moneyReleaseStatus,
    metodo_pago: f.metodoPago,
    tipo_pago: f.tipoPago,
    origen,
  };
}
