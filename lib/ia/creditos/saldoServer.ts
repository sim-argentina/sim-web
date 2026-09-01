// IA SIM · Bloque 4B.5 — Orquestación server-side del saldo de créditos.
// Mantiene SEPARADAS las dos fuentes:
//   • Consumo interno estimado (ia_consumo, por tokens) → control inmediato/límites.
//   • Costos oficiales Anthropic (Cost Report snapshots) → saldo calculado.
// Saldo calculado = Σ(movimientos confirmados) − costo oficial acumulado.
// Todo el dinero se maneja en numeric (Postgres) / BigInt nano-USD (JS), sin float.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { IA_OWNER_ADMIN, IA_ADMIN_KEY_VAR, getAdminKey, getCostosDesdeISO, getAlertasSaldo, costoOficialConfigurado, getLimites } from "@/lib/ia/config";
import { rangoMes } from "@/lib/ia/consumoUtil";
import { usdANanoUsd, nanoUsdAString, formatoUSD } from "@/lib/ia/creditos/dinero";
import { consultarCostReport, CostReportError, type FetchLike } from "@/lib/ia/creditos/costReport";

const TZ = "America/Argentina/Cordoba";
export const TIPOS_MOVIMIENTO = ["carga", "ajuste_positivo", "ajuste_negativo", "credito_vencido", "conciliacion"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

function hoyISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

// Convierte un numeric::text de Postgres a nano-USD exacto (tolera null/"").
function textoANano(s: unknown): bigint {
  const t = s == null ? "0" : String(s).trim();
  if (t === "" || t === "null") return 0n;
  try { return usdANanoUsd(t.startsWith("-") ? t : t); } catch { return 0n; }
}

// ── Saldo exacto (RPC) ───────────────────────────────────────────────────────
export type SaldoRPC = {
  cargas_total_usd: string; costo_oficial_usd: string; saldo_calculado_usd: string;
  hay_snapshot: boolean; ultima_sync: string | null; sync_estado: string | null;
  sync_desde: string | null; sync_hasta: string | null; sync_moneda: string | null;
  costos_por_mes: Record<string, string> | null;
};

async function leerSaldoRPC(): Promise<SaldoRPC> {
  const { data, error } = await supabaseAdmin.rpc("ia_creditos_saldo");
  if (error || !data) throw new Error("No se pudo leer el saldo.");
  return data as SaldoRPC;
}

// ── Consumo interno estimado del mes vigente (Córdoba) ───────────────────────
async function consumoMesVigente() {
  const mes = hoyISO().slice(0, 7);
  const { desde, hasta } = rangoMes(mes);
  const { data } = await supabaseAdmin.from("ia_consumo")
    .select("tokens_in, tokens_out, costo_estimado")
    .eq("owner", IA_OWNER_ADMIN).gte("dia", desde).lt("dia", hasta);
  const t = (data ?? []).reduce((a, r) => ({
    tin: a.tin + Number(r.tokens_in || 0), tout: a.tout + Number(r.tokens_out || 0), costo: a.costo + Number(r.costo_estimado || 0),
  }), { tin: 0, tout: 0, costo: 0 });
  const tokensTotal = t.tin + t.tout;
  const limite = getLimites().tokensMesMax;
  return {
    periodo: mes, tokens_total: tokensTotal,
    costo_estimado_usd: Math.round(t.costo * 10000) / 10000,
    limite_tokens_mes: limite,
    porcentaje_tope: limite > 0 ? Math.round((tokensTotal / limite) * 100) : 0,
  };
}

// ── Consumo interno estimado por MES (para el detalle oficial vs estimado) ───
async function consumoEstimadoPorMes(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin.from("ia_consumo").select("dia, costo_estimado").eq("owner", IA_OWNER_ADMIN);
  const porMes: Record<string, number> = {};
  for (const r of data ?? []) {
    const mes = new Date(`${r.dia}T00:00:00-03:00`).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
    porMes[mes] = (porMes[mes] ?? 0) + Number(r.costo_estimado || 0);
  }
  return porMes;
}

// ── Resumen completo para el panel ───────────────────────────────────────────
export async function resumenSaldo() {
  const saldo = await leerSaldoRPC();
  const consumoMes = await consumoMesVigente();
  const alertasCfg = getAlertasSaldo();
  const configurada = costoOficialConfigurado();

  const saldoNano = textoANano(saldo.saldo_calculado_usd);
  const cargasNano = textoANano(saldo.cargas_total_usd);
  const costoNano = textoANano(saldo.costo_oficial_usd);

  // Desglose por mes: costo OFICIAL (snapshot) vs ESTIMADO interno + diferencia.
  const estimadoPorMes = await consumoEstimadoPorMes();
  const oficialPorMes = saldo.costos_por_mes ?? {};
  const meses = [...new Set([...Object.keys(oficialPorMes), ...Object.keys(estimadoPorMes)])].sort().reverse();
  const porMes = meses.map((mes) => {
    const oficial = textoANano(oficialPorMes[mes] ?? "0");
    const estimado = usdANanoUsd(String(Math.round((estimadoPorMes[mes] ?? 0) * 1e6) / 1e6));
    return {
      mes,
      oficial_usd: oficialPorMes[mes] != null ? formatoUSD(oficial) : null,
      estimado_usd: formatoUSD(estimado),
      diferencia_usd: oficialPorMes[mes] != null ? formatoUSD(oficial - estimado) : null,
    };
  });

  // Detalle: últimos movimientos, snapshots y conciliaciones.
  const [{ data: movs }, { data: snaps }, { data: concs }] = await Promise.all([
    supabaseAdmin.from("ia_creditos_movimientos").select("id, tipo, importe_usd, fecha, descripcion, referencia, estado, motivo_anulacion, created_at").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabaseAdmin.from("ia_costos_oficiales_snapshots").select("id, sincronizado_at, desde, hasta, costo_total_usd, moneda, buckets, paginas, por_mes, estado, advertencias").order("sincronizado_at", { ascending: false }).limit(20),
    supabaseAdmin.from("ia_saldo_conciliaciones").select("id, saldo_calculado_usd, saldo_observado_usd, diferencia_usd, motivo, created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  // Estado de la sincronización.
  let syncEstado: "ok" | "desactualizada" | "sin_datos" | "no_configurada" = "sin_datos";
  let syncStale = false;
  if (!configurada) syncEstado = "no_configurada";
  else if (saldo.hay_snapshot && saldo.ultima_sync) {
    const dias = (Date.now() - new Date(saldo.ultima_sync).getTime()) / 86400000;
    syncStale = dias > alertasCfg.syncStaleDias;
    syncEstado = syncStale ? "desactualizada" : "ok";
  }

  // Alertas configurables.
  const alertas: Array<{ nivel: "info" | "warn" | "critico"; codigo: string; texto: string }> = [];
  if (saldoNano <= 0n) alertas.push({ nivel: "critico", codigo: "saldo_agotado", texto: "El saldo calculado está agotado o en negativo. Registrá una carga o conciliá con Anthropic." });
  else if (saldoNano < usdANanoUsd(String(alertasCfg.bajo1))) alertas.push({ nivel: "critico", codigo: "saldo_bajo_1", texto: `Saldo calculado por debajo de US$${alertasCfg.bajo1}.` });
  else if (saldoNano < usdANanoUsd(String(alertasCfg.bajo2))) alertas.push({ nivel: "warn", codigo: "saldo_bajo_2", texto: `Saldo calculado por debajo de US$${alertasCfg.bajo2}.` });
  if (syncEstado === "no_configurada") alertas.push({ nivel: "warn", codigo: "sync_no_configurada", texto: `Sincronización oficial no configurada: falta la variable ${IA_ADMIN_KEY_VAR}. Se muestra solo el consumo interno estimado.` });
  if (syncStale) alertas.push({ nivel: "warn", codigo: "sync_desactualizada", texto: `La última sincronización oficial tiene más de ${alertasCfg.syncStaleDias} día(s). Actualizá el saldo.` });
  if (saldo.sync_moneda && saldo.sync_moneda !== "USD") alertas.push({ nivel: "warn", codigo: "moneda_mixta", texto: "Se detectaron costos en una moneda distinta de USD; se excluyeron del saldo." });

  return {
    saldo: {
      saldo_calculado_usd: nanoUsdAString(saldoNano, 6),
      saldo_display: formatoUSD(saldoNano),
      cargas_total_usd: nanoUsdAString(cargasNano, 6),
      costo_oficial_usd: nanoUsdAString(costoNano, 6),
      costo_oficial_display: formatoUSD(costoNano),
      hay_snapshot: saldo.hay_snapshot,
      ultima_sync: saldo.ultima_sync,
      sync_desde: saldo.sync_desde,
      sync_hasta: saldo.sync_hasta,
      costos_por_mes: saldo.costos_por_mes ?? {},
    },
    consumo_mes: consumoMes,
    sincronizacion: { estado: syncEstado, configurada, variable_requerida: configurada ? null : IA_ADMIN_KEY_VAR },
    alertas,
    detalle: {
      movimientos: movs ?? [],
      snapshots: snaps ?? [],
      conciliaciones: concs ?? [],
      por_mes: porMes,
    },
  };
}

// ── Registrar movimiento (idempotente) ───────────────────────────────────────
// importeUsd es la MAGNITUD (string canónico). El signo se deriva del tipo.
export async function registrarMovimiento(input: {
  tipo: TipoMovimiento; importeUsd: string; fecha: string; descripcion: string; referencia?: string | null; idempotencyKey?: string | null; actor: string;
}): Promise<{ ok: true; id: string; duplicado: boolean } | { ok: false; error: string }> {
  if (!TIPOS_MOVIMIENTO.includes(input.tipo)) return { ok: false, error: "Tipo de movimiento inválido." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) return { ok: false, error: "Fecha inválida." };
  if (!input.descripcion.trim()) return { ok: false, error: "Falta la descripción." };
  // Signo por tipo. La conciliación se registra por su circuito propio (con signo).
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

// ── Sincronizar costos oficiales (Cost Report) → snapshot ────────────────────
// Si no hay credencial: NO guarda snapshot (para no falsear el saldo); devuelve
// estado 'no_configurada' con la variable faltante. El chat sigue funcionando.
export async function sincronizarCostos(actor: string, opts?: { fetchImpl?: FetchLike; adminKeyOverride?: string }): Promise<
  | { ok: true; estado: "ok" | "parcial"; costo_total_usd: string; buckets: number; paginas: number; moneda: string; advertencias: string[]; snapshot_id: string }
  | { ok: false; estado: "no_configurada"; variable: string }
  | { ok: false; estado: "credencial_invalida" | "rate_limit" | "timeout" | "error"; mensaje: string }
> {
  const adminKey = opts?.adminKeyOverride ?? getAdminKey();
  if (!adminKey) return { ok: false, estado: "no_configurada", variable: IA_ADMIN_KEY_VAR };

  const desdeISO = getCostosDesdeISO();
  const hoy = hoyISO();
  const hastaISO = `${hoy}T00:00:00Z`; // exclusivo: hasta el inicio de hoy (UTC), datos ya disponibles

  let r;
  try {
    r = await consultarCostReport({ adminKey, desdeISO, hastaISO, fetchImpl: opts?.fetchImpl, tz: TZ });
  } catch (e) {
    if (e instanceof CostReportError) {
      if (e.codigo === "credencial_invalida") return { ok: false, estado: "credencial_invalida", mensaje: "La credencial administrativa fue rechazada (401/403). Verificá ANTHROPIC_ADMIN_KEY." };
      if (e.codigo === "rate_limit") return { ok: false, estado: "rate_limit", mensaje: "Anthropic devolvió rate limit (429). Reintentá en un minuto." };
      if (e.codigo === "timeout") return { ok: false, estado: "timeout", mensaje: "La consulta al Cost Report tardó demasiado." };
      return { ok: false, estado: "error", mensaje: "No se pudo consultar el Cost Report." };
    }
    return { ok: false, estado: "error", mensaje: "No se pudo consultar el Cost Report." };
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

  return { ok: true, estado, costo_total_usd: costoTotal, buckets: r.buckets, paginas: r.paginas, moneda: r.moneda, advertencias: r.advertencias, snapshot_id: data.id as string };
}

// ── Conciliación con el saldo observado en Anthropic Console ──────────────────
// confirmar=false → solo compara (preview). confirmar=true → crea el ajuste.
export async function conciliar(input: { observadoUsd: string; confirmar: boolean; motivo?: string | null; actor: string }): Promise<
  | { ok: true; committed: boolean; saldo_calculado_usd: string; saldo_observado_usd: string; diferencia_usd: string; movimiento_id?: string }
  | { ok: false; error: string }
> {
  const saldo = await leerSaldoRPC();
  const calcNano = textoANano(saldo.saldo_calculado_usd);
  let obsNano: bigint;
  try { obsNano = usdANanoUsd(input.observadoUsd); } catch { return { ok: false, error: "Saldo observado inválido." }; }
  const diffNano = obsNano - calcNano;

  const base = {
    saldo_calculado_usd: nanoUsdAString(calcNano, 6),
    saldo_observado_usd: nanoUsdAString(obsNano, 6),
    diferencia_usd: nanoUsdAString(diffNano, 6),
  };
  if (!input.confirmar) return { ok: true, committed: false, ...base };

  // Ajuste de conciliación con la diferencia (con signo). No sobrescribe historial.
  let movimientoId: string | undefined;
  if (diffNano !== 0n) {
    const { data, error } = await supabaseAdmin.rpc("ia_creditos_registrar_movimiento", {
      p_tipo: "conciliacion", p_importe: nanoUsdAString(diffNano, 6),
      p_fecha: hoyISO(), p_desc: `Conciliación con Anthropic Console${input.motivo ? `: ${input.motivo.slice(0, 300)}` : ""}`,
      p_actor: input.actor, p_ref: null, p_idem: null,
    });
    if (error || !(data as { ok?: boolean })?.ok) return { ok: false, error: "No se pudo registrar el ajuste de conciliación." };
    movimientoId = (data as { id: string }).id;
  }
  await supabaseAdmin.from("ia_saldo_conciliaciones").insert({
    saldo_calculado_usd: base.saldo_calculado_usd, saldo_observado_usd: base.saldo_observado_usd, diferencia_usd: base.diferencia_usd,
    motivo: input.motivo?.slice(0, 500) ?? null, actor: input.actor, movimiento_ajuste_id: movimientoId ?? null,
  });
  return { ok: true, committed: true, ...base, movimiento_id: movimientoId };
}
