// Cálculo puro de comisiones de cobro por pago individual (sin acceso a DB).
// La comisión se aplica SOLO a qr/debito/credito con procesador; efectivo y
// transferencia no tienen comisión. Nunca sobre el total del turno: siempre por pago.

export const METODOS_CON_COMISION = ["qr", "debito", "credito"] as const;
export const METODOS_SIN_COMISION = ["efectivo", "transferencia"] as const;

// Todos los medios de cobro presencial que modela Finanzas, en el orden en que
// se muestran. Cualquier pantalla que ofrezca "cómo se cobró" sale de acá: si
// mañana aparece un medio nuevo, se agrega una vez.
export const METODOS_PAGO = [...METODOS_SIN_COMISION, ...METODOS_CON_COMISION] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const METODO_PAGO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  qr: "QR",
  debito: "Débito",
  credito: "Crédito",
};

// Procesadores con posnet en el local. Son los dos que reconoce mapProcesador y
// los únicos que tienen tasas en fin_comisiones_cobro.
export const PROCESADORES = ["mercado_pago", "payway"] as const;
export type Procesador = (typeof PROCESADORES)[number];

export const PROCESADOR_LABEL: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  payway: "Payway",
};

// Un cobro lleva procesador exactamente cuando pasa por posnet. Efectivo y
// transferencia no: no hay quién cobre comisión. Es la regla que decide qué
// combinaciones son válidas; nadie debería reimplementarla.
export function requiereProcesador(metodo: string): boolean {
  return (METODOS_CON_COMISION as readonly string[]).includes(String(metodo).trim().toLowerCase());
}

export function esMetodoPagoValido(metodo: string): boolean {
  return (METODOS_PAGO as readonly string[]).includes(String(metodo).trim().toLowerCase());
}

export type ComisionConfig = {
  procesador: string; // 'mercado_pago' | 'payway'
  metodo_pago: string; // 'qr' | 'debito' | 'credito'
  porcentaje_base: number;
  aplica_iva: boolean;
  iva_porcentaje: number;
  activa: boolean;
};

export type PagoInput = { metodo_pago?: string | null; monto?: number | string | null; posnet_pago?: string | null };

export type PagoComision = {
  metodo_pago: string;
  procesador: string | null;
  monto: number;
  porcentaje_base: number;
  iva_porcentaje: number;
  porcentaje_total: number;
  comision: number;
  neto: number;
  advertencia: "sin_procesador" | "sin_config" | null;
};

export type AdvertenciaComision = {
  motivo: "sin_procesador" | "sin_config";
  metodo_pago: string;
  monto: number;
  procesador: string | null;
};

export type ResultadoComisiones = {
  bruto: number;
  comision: number;
  neto: number;
  detalle: PagoComision[];
  advertencias: AdvertenciaComision[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Porcentaje total = base * (1 + IVA/100) si aplica IVA; si no, el base.
export function porcentajeTotalComision(c: Pick<ComisionConfig, "porcentaje_base" | "aplica_iva" | "iva_porcentaje">): number {
  const base = Number(c.porcentaje_base) || 0;
  return c.aplica_iva ? base * (1 + (Number(c.iva_porcentaje) || 0) / 100) : base;
}

// posnet_pago ("MP" / "PayWay") → procesador canónico. null si no reconocido/vacío.
export function mapProcesador(posnet: string | null | undefined): string | null {
  const p = String(posnet ?? "").trim().toLowerCase();
  if (p === "mp" || p === "mercado_pago" || p === "mercadopago") return "mercado_pago";
  if (p === "payway") return "payway";
  return null;
}

export function claveComision(procesador: string, metodo: string): string {
  return `${procesador}:${metodo}`;
}

function esMetodoConComision(m: string): boolean {
  return requiereProcesador(m);
}

// Calcula comisión/neto por cada pago del array pagos_detalle.
// configByKey: mapa `${procesador}:${metodo}` → ComisionConfig activa.
export function calcularComisionesPagos(
  pagos: PagoInput[] | null | undefined,
  configByKey: Record<string, ComisionConfig>
): ResultadoComisiones {
  const detalle: PagoComision[] = [];
  const advertencias: AdvertenciaComision[] = [];
  let bruto = 0, comision = 0, neto = 0;

  for (const p of Array.isArray(pagos) ? pagos : []) {
    const metodo = String(p?.metodo_pago ?? "").trim().toLowerCase();
    const monto = Number(p?.monto) || 0;
    if (monto <= 0) continue;
    bruto += monto;

    // efectivo / transferencia (y cualquier método sin comisión): comisión 0.
    if (!esMetodoConComision(metodo)) {
      detalle.push({ metodo_pago: metodo, procesador: null, monto, porcentaje_base: 0, iva_porcentaje: 0, porcentaje_total: 0, comision: 0, neto: monto, advertencia: null });
      neto += monto;
      continue;
    }

    // qr / debito / credito: requieren procesador + config activa.
    const procesador = mapProcesador(p?.posnet_pago);
    if (!procesador) {
      detalle.push({ metodo_pago: metodo, procesador: null, monto, porcentaje_base: 0, iva_porcentaje: 0, porcentaje_total: 0, comision: 0, neto: monto, advertencia: "sin_procesador" });
      advertencias.push({ motivo: "sin_procesador", metodo_pago: metodo, monto, procesador: null });
      neto += monto;
      continue;
    }
    const cfg = configByKey[claveComision(procesador, metodo)];
    if (!cfg || !cfg.activa) {
      detalle.push({ metodo_pago: metodo, procesador, monto, porcentaje_base: 0, iva_porcentaje: 0, porcentaje_total: 0, comision: 0, neto: monto, advertencia: "sin_config" });
      advertencias.push({ motivo: "sin_config", metodo_pago: metodo, monto, procesador });
      neto += monto;
      continue;
    }
    const total = porcentajeTotalComision(cfg);
    const com = round2((monto * total) / 100);
    const net = round2(monto - com);
    detalle.push({
      metodo_pago: metodo, procesador, monto,
      porcentaje_base: Number(cfg.porcentaje_base) || 0,
      iva_porcentaje: cfg.aplica_iva ? (Number(cfg.iva_porcentaje) || 0) : 0,
      porcentaje_total: round2(total * 1000) / 1000,
      comision: com, neto: net, advertencia: null,
    });
    comision += com;
    neto += net;
  }

  return { bruto: round2(bruto), comision: round2(comision), neto: round2(neto), detalle, advertencias };
}
