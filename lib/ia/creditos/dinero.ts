// IA SIM · Bloque 4B.5 — Dinero EXACTO (sin floating point).
// El Cost Report de Anthropic entrega `amount` como string decimal en la unidad
// más baja (centavos): "123.78912" en USD = $1.2378912. Para no perder precisión
// trabajamos con enteros BigInt en NANO-USD (1e-9 USD) y solo convertimos a
// Number al FORMATEAR para la pantalla.

export const NANO = 1_000_000_000n; // 1 USD = 1e9 nano-USD

// Parsea un string decimal a un entero escalado a `scale` decimales, redondeando
// half-up el dígito siguiente. Acepta signo, espacios y separador de miles ausente.
function decimalAEscalado(s: string, scale: number): bigint {
  const t = String(s).trim();
  const m = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(t);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error("importe inválido");
  const signo = m[1] === "-" ? -1n : 1n;
  const ent = m[2] || "0";
  const fracRaw = m[3] || "";
  const frac = fracRaw.slice(0, scale).padEnd(scale, "0");
  let val = BigInt(ent) * 10n ** BigInt(scale) + (frac === "" ? 0n : BigInt(frac));
  // Redondeo half-up con el primer dígito descartado.
  const sig = fracRaw.charCodeAt(scale);
  if (sig >= 53 /* '5' */ && sig <= 57 /* '9' */) val += 1n;
  return signo * val;
}

// Cost Report: string en CENTAVOS → nano-USD. 1 centavo = 0.01 USD = 1e7 nano-USD.
export function centavosANanoUsd(centavos: string): bigint {
  return decimalAEscalado(centavos, 7); // 7 decimales de centavo = nano-USD
}

// Importe USD ingresado por el admin → nano-USD (para validaciones/agregados).
export function usdANanoUsd(usd: string): bigint {
  return decimalAEscalado(usd, 9);
}

// nano-USD → string decimal USD con N decimales exactos (para persistir en numeric).
export function nanoUsdAString(nano: bigint, decimales = 9): string {
  const neg = nano < 0n;
  let v = neg ? -nano : nano;
  // Reescalar de 9 decimales a `decimales` con redondeo half-up.
  if (decimales < 9) {
    const div = 10n ** BigInt(9 - decimales);
    const resto = v % div;
    v = v / div;
    if (resto * 2n >= div) v += 1n;
  } else if (decimales > 9) {
    v = v * 10n ** BigInt(decimales - 9);
  }
  const base = 10n ** BigInt(decimales);
  const ent = v / base;
  const frac = (v % base).toString().padStart(decimales, "0");
  const cuerpo = decimales > 0 ? `${ent}.${frac}` : `${ent}`;
  return neg ? `-${cuerpo}` : cuerpo;
}

// Formato para PANTALLA. Saldos: 2 decimales. Montos chicos (<US$0,01): 4 decimales
// para que nunca aparezcan como cero por redondeo prematuro.
export function formatoUSD(nano: bigint | number | string): string {
  const n = typeof nano === "bigint" ? nano : usdANanoUsd(String(nano));
  const abs = n < 0n ? -n : n;
  // ≥US$1 → 2 decimales. <US$1 → 4 decimales (nunca cero por redondeo). Montos
  // ínfimos (<US$0,0001) → 6 decimales para no colapsar a "0.0000".
  const decimales = abs === 0n ? 2 : abs >= NANO ? 2 : abs < 100_000n ? 6 : 4;
  return nanoUsdAString(n, decimales);
}

// Valida y normaliza un importe USD ingresado por el admin. Devuelve el string
// canónico (para el numeric de Postgres) o null si es inválido/no positivo.
export function normalizarImporteUsd(entrada: unknown, opts?: { permitirCero?: boolean }): string | null {
  if (entrada == null) return null;
  const s = String(entrada).replace(",", ".").trim();
  if (!/^[+-]?\d*(?:\.\d+)?$/.test(s) || s === "" || s === "." || s === "+" || s === "-") return null;
  let nano: bigint;
  try { nano = usdANanoUsd(s); } catch { return null; }
  if (nano < 0n) return null;
  if (nano === 0n && !opts?.permitirCero) return null;
  // Límite defensivo: importes absurdos (>US$1.000.000) se rechazan.
  if (nano > 1_000_000n * NANO) return null;
  return nanoUsdAString(nano, 6); // hasta 6 decimales, suficiente para dinero real
}
