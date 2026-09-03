// IA SIM · Bloque 4B.5.1 — Orquestación server-side del saldo de créditos.
// Tres modos EXPLÍCITOS del saldo estimado:
//   • oficial:        Σ(movimientos) − costo oficial acumulado (si hay snapshot válido).
//   • conciliado:     S + M − (C − B), tomando la última conciliación como punto de partida.
//   • sin conciliación: Σ(movimientos monetarios) − costo interno acumulado.
// Donde S=saldo observado, B=costo interno al conciliar, C=costo interno actual,
// M=movimientos monetarios posteriores a la conciliación (excluye conciliaciones).
// Dinero exacto: numeric (Postgres) + BigInt nano-USD (JS). Sin floating point.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN, IA_ADMIN_KEY_VAR, getAdminKey, getCostosDesdeISO, getAlertasSaldo, getLimites } from "@/lib/ia/config";
import { rangoMes } from "@/lib/ia/consumoUtil";
import { usdANanoUsd, nanoUsdAString, formatoUSD } from "@/lib/ia/creditos/dinero";
import { consultarCostReport, CostReportError, type FetchLike } from "@/lib/ia/creditos/costReport";
import { saldoConciliado } from "@/lib/ia/creditos/saldoFormula";

const TZ = "America/Argentina/Cordoba";
export const TIPOS_MOVIMIENTO = ["carga", "ajuste_positivo", "ajuste_negativo", "credito_vencido", "conciliacion"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];
const MONETARIOS = new Set<string>(["carga", "ajuste_positivo", "ajuste_negativo", "credito_vencido"]);
const POSITIVOS = new Set<string>(["carga", "ajuste_positivo"]);

function hoyISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
function textoANano(s: unknown): bigint {
  const t = s == null ? "0" : String(s).trim();
  if (t === "" || t === "null") return 0n;
  try { return usdANanoUsd(t); } catch { return 0n; }
}

// ── Costo interno acumulado (real, no fake): chat + OCR. Exacto en nano-USD. ──
async function costoInternoAcumulado(hastaISO?: string): Promise<bigint> {
  const { data } = await supabaseAdmin.rpc("ia_costo_interno_acumulado", { p_hasta: hastaISO ?? null });
  return textoANano(data);
}

// ── Consumo del mes vigente (Córdoba), fuente COMPLETA (chat + OCR, no fake) ──
async function consumoMesVigente() {
  const mes = hoyISO().slice(0, 7);
  const { desde, hasta } = rangoMes(mes);
  const d0 = `${desde}T00:00:00-03:00`, d1 = `${hasta}T00:00:00-03:00`;
  const [{ data: ej }, { data: ocr }, { data: bw }] = await Promise.all([
    supabaseAdmin.from("ia_ejecuciones").select("tokens_in, tokens_out, costo_estimado, busquedas_web, costo_busquedas_usd, uso_desconocido").neq("proveedor", "fake").gte("created_at", d0).lt("created_at", d1),
    supabaseAdmin.from("ia_ocr_resultados").select("tokens_in, tokens_out, costo_estimado").neq("proveedor", "fake").gte("created_at", d0).lt("created_at", d1),
    // 4D.5 — créditos Tavily del mes (NO monetizados; separados del saldo de Anthropic).
    supabaseAdmin.from("ia_busquedas_web").select("creditos_busqueda, cache_hit").eq("proveedor", "tavily").gte("created_at", d0).lt("created_at", d1),
  ]);
  let tin = 0, tout = 0, costoNano = 0n, busquedasWeb = 0, costoWebNano = 0n, usoDesconocido = 0;
  for (const r of [...(ej ?? []), ...(ocr ?? [])]) {
    tin += Number(r.tokens_in || 0); tout += Number(r.tokens_out || 0);
    costoNano += textoANano(r.costo_estimado);
    busquedasWeb += Number((r as { busquedas_web?: number }).busquedas_web || 0);
    costoWebNano += textoANano((r as { costo_busquedas_usd?: unknown }).costo_busquedas_usd);
    if ((r as { uso_desconocido?: boolean }).uso_desconocido) usoDesconocido++;
  }
  let creditosTavilyMes = 0, cacheHitsMes = 0;
  for (const b of bw ?? []) { creditosTavilyMes += Number(b.creditos_busqueda || 0); if (b.cache_hit) cacheHitsMes++; }
  const tokensTotal = tin + tout;
  const limite = getLimites().tokensMesMax;
  return { periodo: mes, tokens_total: tokensTotal, costo_usd: formatoUSD(costoNano), costo_nano: costoNano, limite_tokens_mes: limite, porcentaje_tope: limite > 0 ? Math.round((tokensTotal / limite) * 100) : 0, busquedas_web: busquedasWeb, costo_web_usd: formatoUSD(costoWebNano), intentos_uso_desconocido: usoDesconocido, creditos_busqueda_tavily: creditosTavilyMes, cache_hits_tavily: cacheHitsMes };
}

// ── Costo interno por MES (Córdoba) para el detalle (solo estimado) ──────────
async function costoInternoPorMes(): Promise<Record<string, bigint>> {
  const [{ data: ej }, { data: ocr }] = await Promise.all([
    supabaseAdmin.from("ia_ejecuciones").select("created_at, costo_estimado").neq("proveedor", "fake"),
    supabaseAdmin.from("ia_ocr_resultados").select("created_at, costo_estimado").neq("proveedor", "fake"),
  ]);
  const porMes: Record<string, bigint> = {};
  for (const r of [...(ej ?? []), ...(ocr ?? [])]) {
    const mes = new Date(r.created_at as string).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
    porMes[mes] = (porMes[mes] ?? 0n) + textoANano(r.costo_estimado);
  }
  return porMes;
}

type Movimiento = { id: string; tipo: string; importe_usd: string; fecha: string; descripcion: string; referencia: string | null; estado: string; motivo_anulacion: string | null; created_at: string };
type Conciliacion = { id: string; saldo_observado_usd: string; saldo_calculado_usd: string; diferencia_usd: string; costo_interno_baseline: string | null; estado: string; baseline_reconstruido: boolean; motivo: string | null; created_at: string };

// ── Núcleo: cálculo del saldo en los tres modos ──────────────────────────────
export type SaldoCalculo = {
  modo: "oficial" | "conciliado" | "sin_conciliacion" | "conciliacion_pendiente";
  saldoNano: bigint; referenciaNano: bigint;
  sNano: bigint; bNano: bigint; cNano: bigint; mNano: bigint;
  creditosRegistradosNano: bigint; costoOficialNano: bigint;
  ultimaConciliacion: Conciliacion | null; hayOficial: boolean;
};

async function calcularSaldo(): Promise<{ calc: SaldoCalculo; movimientos: Movimiento[] }> {
  const [{ data: movs }, { data: conc }, { data: snap }, cNano] = await Promise.all([
    supabaseAdmin.from("ia_creditos_movimientos").select("id, tipo, importe_usd, fecha, descripcion, referencia, estado, motivo_anulacion, created_at").order("created_at", { ascending: false }).limit(500),
    supabaseAdmin.from("ia_saldo_conciliaciones").select("id, saldo_observado_usd, saldo_calculado_usd, diferencia_usd, costo_interno_baseline, estado, baseline_reconstruido, motivo, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("ia_costos_oficiales_snapshots").select("costo_total_usd, estado, moneda, sincronizado_at").order("sincronizado_at", { ascending: false }).limit(1).maybeSingle(),
    costoInternoAcumulado(),
  ]);
  const confirmados = (movs ?? []).filter((m) => m.estado === "confirmado") as Movimiento[];
  const sumaSi = (pred: (m: Movimiento) => boolean) => confirmados.filter(pred).reduce((a, m) => a + textoANano(m.importe_usd), 0n);

  const monetarioNano = sumaSi((m) => MONETARIOS.has(m.tipo));
  const creditosRegistradosNano = sumaSi((m) => POSITIVOS.has(m.tipo));
  const todosNano = sumaSi(() => true); // incluye conciliaciones (para modo oficial)

  const conciliacion = (conc ?? null) as Conciliacion | null;
  const hayOficial = Boolean(snap && (snap as { estado?: string }).estado === "ok" && (snap as { moneda?: string }).moneda === "USD");
  const costoOficialNano = hayOficial ? textoANano((snap as { costo_total_usd?: string }).costo_total_usd) : 0n;

  let modo: SaldoCalculo["modo"]; let saldoNano: bigint; let referenciaNano: bigint;
  let sNano = 0n, bNano = 0n, mNano = 0n;

  if (hayOficial) {
    modo = "oficial";
    saldoNano = todosNano - costoOficialNano;
    referenciaNano = creditosRegistradosNano;
  } else if (conciliacion && conciliacion.costo_interno_baseline != null && conciliacion.estado === "ok") {
    modo = "conciliado";
    sNano = textoANano(conciliacion.saldo_observado_usd);
    bNano = textoANano(conciliacion.costo_interno_baseline);
    const post = confirmados.filter((m) => MONETARIOS.has(m.tipo) && new Date(m.created_at) > new Date(conciliacion.created_at));
    mNano = post.reduce((a, m) => a + textoANano(m.importe_usd), 0n);
    saldoNano = saldoConciliado(sNano, mNano, cNano, bNano);
    const cargasPost = post.filter((m) => POSITIVOS.has(m.tipo)).reduce((a, m) => a + textoANano(m.importe_usd), 0n);
    referenciaNano = sNano + cargasPost;
  } else if (conciliacion) {
    // Conciliación sin baseline (histórica sin recalibrar): se usa el modo estimado
    // y se avisa que está pendiente de recalibración.
    modo = "conciliacion_pendiente";
    saldoNano = monetarioNano - cNano;
    referenciaNano = creditosRegistradosNano;
  } else {
    modo = "sin_conciliacion";
    saldoNano = monetarioNano - cNano;
    referenciaNano = creditosRegistradosNano;
  }

  return {
    calc: { modo, saldoNano, referenciaNano, sNano, bNano, cNano, mNano, creditosRegistradosNano, costoOficialNano, ultimaConciliacion: conciliacion, hayOficial },
    movimientos: (movs ?? []) as Movimiento[],
  };
}

// ── Estado de la sincronización oficial (no se llama al Cost Report en cada carga) ─
async function leerSyncEstado() {
  const { data } = await supabaseAdmin.from("ia_creditos_sync_estado").select("*").eq("owner", IA_OWNER_ADMIN).maybeSingle();
  return data as { estado: string; ultimo_error: string | null; ultimo_intento_at: string | null; ultimo_exito_at: string | null } | null;
}

// ── Resumen para el panel ────────────────────────────────────────────────────
export async function resumenSaldo() {
  const { calc, movimientos } = await calcularSaldo();
  const consumoMes = await consumoMesVigente();
  const alertasCfg = getAlertasSaldo();
  const sync = await leerSyncEstado();

  // Barra y color.
  const pctReal = calc.referenciaNano > 0n ? Number(calc.saldoNano) / Number(calc.referenciaNano) : null;
  const pctDisplay = pctReal == null ? null : Math.max(0, Math.min(100, Math.round(pctReal * 100)));
  let color: "ok" | "warn" | "critico" = "ok";
  const umbral1 = usdANanoUsd(String(alertasCfg.bajo1)); // US$1
  if (calc.saldoNano <= 0n) color = "critico";
  else if (calc.saldoNano < umbral1 || (pctReal != null && pctReal < 0.10)) color = "critico";
  else if (pctReal != null && pctReal < 0.25) color = "warn";

  // Etiqueta honesta del modo.
  const etiquetaModo = calc.modo === "oficial" ? "Con costos oficiales"
    : calc.modo === "conciliado" ? "Estimado desde último saldo real"
    : calc.modo === "conciliacion_pendiente" ? "Estimación manual (conciliación pendiente)"
    : "Sin conciliar";

  // Alertas.
  const alertas: Array<{ nivel: "info" | "warn" | "critico"; codigo: string; texto: string }> = [];
  if (calc.saldoNano <= 0n) alertas.push({ nivel: "critico", codigo: "saldo_agotado", texto: "El saldo estimado está agotado o en negativo. Registrá un crédito o ajustá el saldo real." });
  else if (calc.saldoNano < umbral1) alertas.push({ nivel: "critico", codigo: "saldo_bajo_1", texto: `Saldo estimado por debajo de US$${alertasCfg.bajo1}.` });
  else if (pctReal != null && pctReal < 0.25) alertas.push({ nivel: "warn", codigo: "saldo_bajo_25", texto: "Queda menos del 25% del saldo de referencia." });
  if (calc.modo === "conciliacion_pendiente") alertas.push({ nivel: "warn", codigo: "conciliacion_pendiente", texto: "La última conciliación no tiene baseline de costo. Registrá una nueva conciliación (Ajustar saldo real) para recalibrar." });

  // Detalle: consumo por mes (estimado) + oficial si existe.
  const estimadoPorMes = await costoInternoPorMes();
  const oficialPorMes: Record<string, string> = {}; // sin oficial disponible → vacío
  const meses = [...new Set([...Object.keys(estimadoPorMes), ...Object.keys(oficialPorMes)])].sort().reverse();
  const consumoPorMes = meses.map((mes) => ({
    mes,
    estimado_usd: formatoUSD(estimadoPorMes[mes] ?? 0n),
    oficial_usd: oficialPorMes[mes] != null ? formatoUSD(textoANano(oficialPorMes[mes])) : null,
  }));

  // Conciliaciones (detalle).
  const { data: concs } = await supabaseAdmin.from("ia_saldo_conciliaciones")
    .select("id, saldo_observado_usd, saldo_calculado_usd, diferencia_usd, costo_interno_baseline, estado, baseline_reconstruido, motivo, created_at")
    .order("created_at", { ascending: false }).limit(20);

  const conc = calc.ultimaConciliacion;
  return {
    saldo: {
      modo: calc.modo,
      etiqueta_modo: etiquetaModo,
      saldo_display: formatoUSD(calc.saldoNano),
      saldo_usd: nanoUsdAString(calc.saldoNano, 6),
      referencia_usd: nanoUsdAString(calc.referenciaNano, 6),
      porcentaje: pctDisplay,
      color,
      creditos_registrados_usd: formatoUSD(calc.creditosRegistradosNano),
      ultimo_saldo_real: conc && (calc.modo === "conciliado" || calc.modo === "conciliacion_pendiente") ? { usd: formatoUSD(textoANano(conc.saldo_observado_usd)), fecha: conc.created_at } : null,
      gastado_desde_usd: calc.modo === "conciliado" ? formatoUSD(calc.cNano - calc.bNano < 0n ? 0n : calc.cNano - calc.bNano) : null,
    },
    consumo_mes: { periodo: consumoMes.periodo, tokens_total: consumoMes.tokens_total, costo_estimado_usd: consumoMes.costo_usd, porcentaje_tope: consumoMes.porcentaje_tope, busquedas_web: consumoMes.busquedas_web, costo_web_usd: consumoMes.costo_web_usd, intentos_uso_desconocido: consumoMes.intentos_uso_desconocido, creditos_busqueda_tavily: consumoMes.creditos_busqueda_tavily, cache_hits_tavily: consumoMes.cache_hits_tavily },
    sincronizacion: {
      estado: sync?.estado ?? "sin_sincronizacion_oficial",
      configurada: Boolean(getAdminKey()),
      variable_requerida: getAdminKey() ? null : IA_ADMIN_KEY_VAR,
      ultimo_intento: sync?.ultimo_intento_at ?? null,
      ultimo_exito: sync?.ultimo_exito_at ?? null,
      ultimo_error: sync?.ultimo_error ?? null,
    },
    alertas,
    detalle: {
      como_se_calculo: {
        modo: calc.modo,
        ultimo_saldo_real_usd: calc.sNano !== 0n ? formatoUSD(calc.sNano) : null,
        baseline_usd: calc.bNano !== 0n ? formatoUSD(calc.bNano) : null,
        costo_interno_actual_usd: formatoUSD(calc.cNano),
        consumo_posterior_usd: calc.modo === "conciliado" ? formatoUSD(calc.cNano - calc.bNano < 0n ? 0n : calc.cNano - calc.bNano) : formatoUSD(calc.cNano),
        movimientos_posteriores_usd: formatoUSD(calc.mNano),
        creditos_registrados_usd: formatoUSD(calc.creditosRegistradosNano),
        costo_oficial_usd: calc.hayOficial ? formatoUSD(calc.costoOficialNano) : null,
        saldo_usd: formatoUSD(calc.saldoNano),
        fuente: calc.modo === "oficial" ? "Costos oficiales de Anthropic" : calc.modo === "conciliado" ? "Último saldo real conciliado − consumo interno posterior" : "Créditos registrados − consumo interno estimado",
      },
      movimientos: movimientos.map((m) => ({ id: m.id, tipo: m.tipo, importe_usd: m.importe_usd, fecha: m.fecha, descripcion: m.descripcion, estado: m.estado, motivo_anulacion: m.motivo_anulacion, created_at: m.created_at })),
      consumo_por_mes: consumoPorMes,
      conciliaciones: (concs ?? []).map((c) => ({ id: c.id, saldo_observado_usd: c.saldo_observado_usd, saldo_calculado_usd: c.saldo_calculado_usd, diferencia_usd: c.diferencia_usd, costo_interno_baseline: c.costo_interno_baseline, estado: c.estado, baseline_reconstruido: c.baseline_reconstruido, created_at: c.created_at })),
    },
  };
}

// ── Registrar movimiento (idempotente) ───────────────────────────────────────
export async function registrarMovimiento(input: {
  tipo: TipoMovimiento; importeUsd: string; fecha: string; descripcion: string; referencia?: string | null; idempotencyKey?: string | null; actor: string;
}): Promise<{ ok: true; id: string; duplicado: boolean } | { ok: false; error: string }> {
  if (!TIPOS_MOVIMIENTO.includes(input.tipo)) return { ok: false, error: "Tipo de movimiento inválido." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) return { ok: false, error: "Fecha inválida." };
  if (!input.descripcion.trim()) return { ok: false, error: "Falta la descripción." };
  const negativos: TipoMovimiento[] = ["ajuste_negativo", "credito_vencido"];
  const magnitud = input.importeUsd.startsWith("-") ? input.importeUsd.slice(1) : input.importeUsd;
  const firmado = negativos.includes(input.tipo) ? `-${magnitud}` : magnitud;
  const { data, error } = await supabaseAdmin.rpc("ia_creditos_registrar_movimiento", {
    p_tipo: input.tipo, p_importe: firmado, p_fecha: input.fecha, p_desc: input.descripcion.slice(0, 500),
    p_actor: input.actor, p_ref: input.referencia?.slice(0, 200) ?? null, p_idem: input.idempotencyKey?.slice(0, 200) ?? null,
  });
  if (error || !data || !(data as { ok?: boolean }).ok) return { ok: false, error: "No se pudo registrar el movimiento." };
  const d = data as { id: string; duplicado: boolean };
  return { ok: true, id: d.id, duplicado: Boolean(d.duplicado) };
}

// ── Anular movimiento (conserva historial) ───────────────────────────────────
export async function anularMovimiento(id: string, motivo: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabaseAdmin.rpc("ia_creditos_anular_movimiento", { p_id: id, p_motivo: motivo.slice(0, 500), p_actor: actor });
  if (error) return { ok: false, error: "No se pudo anular." };
  if (!(data as { ok?: boolean }).ok) return { ok: false, error: "El movimiento no existe o ya no está confirmado." };
  return { ok: true };
}

// ── Ajustar saldo real / conciliar. Snapshotea B = costo interno actual (inmutable). ─
// El servidor calcula el consumo al momento de conciliar (nunca el cliente).
export async function conciliar(input: { observadoUsd: string; confirmar: boolean; motivo?: string | null; actor: string }): Promise<
  | { ok: true; committed: boolean; saldo_calculado_usd: string; saldo_observado_usd: string; diferencia_usd: string; baseline_usd: string; movimiento_id?: string }
  | { ok: false; error: string }
> {
  const { calc } = await calcularSaldo();
  const calcNano = calc.saldoNano; // saldo estimado ACTUAL (el que ve el admin)
  let obsNano: bigint;
  try { obsNano = usdANanoUsd(input.observadoUsd); } catch { return { ok: false, error: "Saldo observado inválido." }; }
  const diffNano = obsNano - calcNano;
  const baselineNano = await costoInternoAcumulado(); // B = costo interno AL MOMENTO de conciliar

  const base = {
    saldo_calculado_usd: nanoUsdAString(calcNano, 6),
    saldo_observado_usd: nanoUsdAString(obsNano, 6),
    diferencia_usd: nanoUsdAString(diffNano, 6),
    baseline_usd: nanoUsdAString(baselineNano, 6),
  };
  if (!input.confirmar) return { ok: true, committed: false, ...base };

  // Movimiento técnico de ajuste (solo relevante para el modo oficial; se excluye de M).
  let movimientoId: string | undefined;
  if (diffNano !== 0n) {
    const { data, error } = await supabaseAdmin.rpc("ia_creditos_registrar_movimiento", {
      p_tipo: "conciliacion", p_importe: nanoUsdAString(diffNano, 6),
      p_fecha: hoyISO(), p_desc: `Ajuste de saldo real${input.motivo ? `: ${input.motivo.slice(0, 300)}` : ""}`,
      p_actor: input.actor, p_ref: null, p_idem: null,
    });
    if (error || !(data as { ok?: boolean })?.ok) return { ok: false, error: "No se pudo registrar el ajuste." };
    movimientoId = (data as { id: string }).id;
  }
  await supabaseAdmin.from("ia_saldo_conciliaciones").insert({
    saldo_calculado_usd: base.saldo_calculado_usd, saldo_observado_usd: base.saldo_observado_usd, diferencia_usd: base.diferencia_usd,
    costo_interno_baseline: base.baseline_usd, estado: "ok", baseline_reconstruido: false, fuente: "anthropic_console_manual",
    motivo: input.motivo?.slice(0, 500) ?? null, actor: input.actor, movimiento_ajuste_id: movimientoId ?? null,
  });
  return { ok: true, committed: true, ...base, movimiento_id: movimientoId };
}

// ── Sincronización oficial (Cost Report). Actualiza el ESTADO de sync; no domina la UI. ─
export async function sincronizarCostos(actor: string, opts?: { fetchImpl?: FetchLike; adminKeyOverride?: string }): Promise<
  | { ok: true; estado: "ok" | "parcial"; costo_total_usd: string; buckets: number; paginas: number; moneda: string; advertencias: string[]; snapshot_id: string }
  | { ok: false; estado: "no_configurada"; variable: string }
  | { ok: false; estado: "credencial_invalida" | "rate_limit" | "timeout" | "error"; mensaje: string }
> {
  const adminKey = opts?.adminKeyOverride ?? getAdminKey();
  const ahora = new Date().toISOString();
  if (!adminKey) {
    await supabaseAdmin.from("ia_creditos_sync_estado").upsert({ owner: IA_OWNER_ADMIN, estado: "sin_sincronizacion_oficial", ultimo_intento_at: ahora, ultimo_error: "Falta la credencial administrativa.", updated_at: ahora }, { onConflict: "owner" });
    return { ok: false, estado: "no_configurada", variable: IA_ADMIN_KEY_VAR };
  }
  const desdeISO = getCostosDesdeISO();
  const hoy = hoyISO();
  const hastaISO = `${hoy}T00:00:00Z`;
  let r;
  try {
    r = await consultarCostReport({ adminKey, desdeISO, hastaISO, fetchImpl: opts?.fetchImpl, tz: TZ });
  } catch (e) {
    const codigo = e instanceof CostReportError ? e.codigo : "error";
    // 401/403 → estado seguro 'sin_sincronizacion_oficial' (no error rojo permanente).
    const estadoSeguro = codigo === "credencial_invalida" ? "sin_sincronizacion_oficial" : "error";
    const err = codigo === "credencial_invalida" ? "La organización no expone Admin API (401/403)." : codigo === "rate_limit" ? "Rate limit (429)." : codigo === "timeout" ? "Timeout." : "No se pudo consultar el Cost Report.";
    await supabaseAdmin.from("ia_creditos_sync_estado").upsert({ owner: IA_OWNER_ADMIN, estado: estadoSeguro, ultimo_intento_at: ahora, ultimo_error: err, updated_at: ahora }, { onConflict: "owner" });
    if (codigo === "credencial_invalida") return { ok: false, estado: "credencial_invalida", mensaje: err };
    if (codigo === "rate_limit") return { ok: false, estado: "rate_limit", mensaje: err };
    if (codigo === "timeout") return { ok: false, estado: "timeout", mensaje: err };
    return { ok: false, estado: "error", mensaje: err };
  }

  const porMes: Record<string, string> = {};
  for (const [mes, nano] of Object.entries(r.porMesNano)) porMes[mes] = nanoUsdAString(nano, 9);
  const estado = r.advertencias.length > 0 ? "parcial" : "ok";
  const costoTotal = nanoUsdAString(r.costoTotalNano, 9);
  const { data, error } = await supabaseAdmin.from("ia_costos_oficiales_snapshots").insert({
    desde: desdeISO.slice(0, 10), hasta: hoy, costo_total_usd: costoTotal, moneda: r.moneda,
    buckets: r.buckets, paginas: r.paginas, por_mes: porMes, estado, actor, advertencias: r.advertencias,
  }).select("id").single();
  if (error || !data) return { ok: false, estado: "error", mensaje: "No se pudo guardar el snapshot de costos." };
  await supabaseAdmin.from("ia_creditos_sync_estado").upsert({ owner: IA_OWNER_ADMIN, estado: "ok", ultimo_intento_at: ahora, ultimo_exito_at: ahora, ultimo_error: null, updated_at: ahora }, { onConflict: "owner" });
  return { ok: true, estado, costo_total_usd: costoTotal, buckets: r.buckets, paginas: r.paginas, moneda: r.moneda, advertencias: r.advertencias, snapshot_id: data.id as string };
}
