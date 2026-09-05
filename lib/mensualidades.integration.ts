import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarTelefono, simularCompra } from "@/lib/mensualidades";

// Integración de Mensualidades (Bloque M2) contra la DB REAL, con datos TEMPORALES
// que se ELIMINAN al final. Teléfonos 9990xxxxxx (rango imposible en la realidad) y
// external_reference marcadas, para no tocar datos de producción.
// Ejecutar:
//   node --env-file=.env.local --import tsx lib/mensualidades.integration.ts

const MARCA = `zztest_${Date.now()}`;
const creados = { compras: [] as string[], mensualidades: [] as string[] };

const tel = (n: number) => `999${String(n).padStart(7, "0")}`;
let seq = 0;
const nuevoTel = () => tel((Date.now() % 1_000_000) * 10 + seq++);

type Compra = {
  id: string; mensualidad_id: string | null; tipo: string | null;
  minutos_trasladados: number | null; minutos_descartados: number | null;
  saldo_resultante: number | null; vence_el: string | null;
  estado_pago: string; procesamiento: string; mp_payment_id: string | null;
  plan_precio: string | number; plan_minutos: number; plan_nombre: string;
};

// Crea una compra PENDIENTE como la que va a insertar la preferencia de MP en M3.
async function nuevaCompra(opts: {
  slug: string; minutos: number; precio: number; telefonoNorm: string; ref: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("mensualidad_compras")
    .insert({
      plan_slug: opts.slug, plan_nombre: `Plan ${opts.slug}`, plan_minutos: opts.minutos,
      plan_precio: opts.precio, plan_vigencia_dias: 30,
      comprador_nombre: "Zz", comprador_apellido: "Test",
      comprador_telefono: opts.telefonoNorm, telefono_norm: opts.telefonoNorm,
      comprador_email: `${MARCA}@test.local`,
      importe_bruto: opts.precio, external_reference: opts.ref,
    })
    .select("id")
    .single();
  if (error) throw new Error(`nuevaCompra: ${error.message}`);
  creados.compras.push(data.id);
  return data.id as string;
}

async function aplicar(ref: string, paymentId: string, aprobadoAt?: string) {
  const { data, error } = await supabaseAdmin.rpc("mensualidad_aplicar_compra", {
    p_external_reference: ref,
    p_mp_payment_id: paymentId,
    p_importe_bruto: null, p_comision_mp: null, p_importe_neto: null,
    ...(aprobadoAt ? { p_aprobado_at: aprobadoAt } : {}),
  });
  if (error) throw new Error(`aplicar(${ref}): ${error.message}`);
  const c = data as unknown as Compra;
  if (c?.mensualidad_id) creados.mensualidades.push(c.mensualidad_id);
  return c;
}

async function saldoDe(mensualidadId: string) {
  const { data } = await supabaseAdmin
    .from("mensualidades").select("saldo_minutos, codigo, vence_el, telefono_norm")
    .eq("id", mensualidadId).single();
  return data as { saldo_minutos: number; codigo: string; vence_el: string; telefono_norm: string };
}

async function setSaldo(mensualidadId: string, saldo: number, venceEl?: string) {
  const patch: Record<string, unknown> = { saldo_minutos: saldo };
  if (venceEl) patch.vence_el = venceEl;
  const { error } = await supabaseAdmin.from("mensualidades").update(patch).eq("id", mensualidadId);
  if (error) throw new Error(`setSaldo: ${error.message}`);
}

async function hoyCordoba(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("mensualidad_hoy");
  if (error) throw new Error(`mensualidad_hoy: ${error.message}`);
  return String(data);
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function limpiar() {
  const ids = Array.from(new Set(creados.mensualidades));
  if (creados.compras.length) {
    await supabaseAdmin.from("mensualidad_compras").delete().in("id", creados.compras);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_auditoria").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
}

async function main() {
  const HOY = await hoyCordoba();
  console.log(`hoy (Córdoba) = ${HOY}`);

  // ── T1 · Los tres planes existen y el seed no duplica ──────────────────────
  const { data: planes } = await supabaseAdmin
    .from("mensualidad_planes").select("slug, minutos, precio, etiqueta, vigencia_dias").order("orden");
  assert.equal(planes?.length, 3, "T1 debe haber exactamente 3 planes");
  assert.deepEqual(planes?.map((p) => p.slug), ["1h", "2h", "4h"], "T1 slugs");
  assert.deepEqual(planes?.map((p) => p.minutos), [60, 120, 240], "T1 minutos");
  assert.deepEqual(planes?.map((p) => Number(p.precio)), [30000, 55000, 100000], "T1 precios");
  assert.equal(planes?.[1].etiqueta, "Más elegida", "T1 etiqueta 2h");
  assert.equal(planes?.[2].etiqueta, "Mejor precio", "T1 etiqueta 4h");
  assert.ok(planes?.every((p) => p.vigencia_dias === 30), "T1 vigencia 30 días");
  console.log("T1 planes OK");

  // ── T2 · Compra nueva (alta) ──────────────────────────────────────────────
  const telA = nuevoTel();
  await nuevaCompra({ slug: "2h", minutos: 120, precio: 55000, telefonoNorm: telA, ref: `${MARCA}_a1` });
  const a1 = await aplicar(`${MARCA}_a1`, `${MARCA}_pay_a1`);
  assert.equal(a1.tipo, "alta", "T2 tipo");
  assert.equal(a1.saldo_resultante, 120, "T2 saldo");
  assert.equal(a1.estado_pago, "aprobado");
  assert.equal(a1.procesamiento, "aplicado");
  const mA = await saldoDe(a1.mensualidad_id!);
  assert.match(mA.codigo, /^MEN-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/, "T2/T10 formato de código");
  // ── T17 · Vencimiento calculado en Córdoba ────────────────────────────────
  assert.equal(mA.vence_el, sumarDias(HOY, 30), "T17 vence_el = hoy(Córdoba) + 30");
  console.log("T2 alta OK · T17 vencimiento Córdoba OK");

  // ── T8 · Idempotencia del mismo pago ──────────────────────────────────────
  const a1bis = await aplicar(`${MARCA}_a1`, `${MARCA}_pay_a1`);
  assert.equal(a1bis.id, a1.id, "T8 debe devolver la misma compra");
  assert.equal((await saldoDe(a1.mensualidad_id!)).saldo_minutos, 120, "T8 no debe duplicar saldo");
  const { count: movs } = await supabaseAdmin
    .from("mensualidad_movimientos").select("*", { count: "exact", head: true })
    .eq("mensualidad_id", a1.mensualidad_id!);
  assert.equal(movs, 1, "T8 no debe duplicar movimientos");
  console.log("T8 idempotencia OK");

  // ── T3 · Renovación con saldo MENOR a 60 ──────────────────────────────────
  await setSaldo(a1.mensualidad_id!, 45);
  await nuevaCompra({ slug: "2h", minutos: 120, precio: 55000, telefonoNorm: telA, ref: `${MARCA}_a2` });
  const a2 = await aplicar(`${MARCA}_a2`, `${MARCA}_pay_a2`);
  assert.equal(a2.tipo, "renovacion", "T3 tipo");
  assert.equal(a2.minutos_trasladados, 45);
  assert.equal(a2.minutos_descartados, 0);
  assert.equal(a2.saldo_resultante, 165, "T3 45 + 120 = 165");
  assert.equal((await saldoDe(a2.mensualidad_id!)).codigo, mA.codigo, "T3 conserva el código");
  console.log("T3 renovación <60 OK");

  // ── T4 · Renovación con saldo EXACTAMENTE 60 ──────────────────────────────
  await setSaldo(a1.mensualidad_id!, 60);
  await nuevaCompra({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telA, ref: `${MARCA}_a3` });
  const a3 = await aplicar(`${MARCA}_a3`, `${MARCA}_pay_a3`);
  assert.equal(a3.minutos_trasladados, 60);
  assert.equal(a3.minutos_descartados, 0, "T4 con 60 exactos no se descarta nada");
  assert.equal(a3.saldo_resultante, 120);
  console.log("T4 renovación =60 OK");

  // ── T5 · Renovación con saldo MAYOR a 60 (descarta el excedente) ──────────
  await setSaldo(a1.mensualidad_id!, 90);
  await nuevaCompra({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telA, ref: `${MARCA}_a4` });
  const a4 = await aplicar(`${MARCA}_a4`, `${MARCA}_pay_a4`);
  assert.equal(a4.minutos_trasladados, 60, "T5 traslada el tope");
  assert.equal(a4.minutos_descartados, 30, "T5 descarta el excedente");
  assert.equal(a4.saldo_resultante, 120, "T5 90 + 60 = 120 (no 150)");
  const { data: descartes } = await supabaseAdmin
    .from("mensualidad_movimientos").select("minutos, saldo_anterior, saldo_posterior")
    .eq("compra_id", a4.id).eq("tipo", "descarte");
  assert.equal(descartes?.length, 1, "T5 debe registrar el descarte");
  assert.equal(descartes?.[0].minutos, -30);
  assert.equal(descartes?.[0].saldo_anterior, 90);
  assert.equal(descartes?.[0].saldo_posterior, 60);
  // La previsualización de TypeScript tiene que coincidir con lo que hizo la RPC.
  assert.deepEqual(
    simularCompra({ saldoActual: 90, venceActual: sumarDias(HOY, 10), planMinutos: 60, hoy: HOY }),
    { tipo: a4.tipo, trasladados: a4.minutos_trasladados, descartados: a4.minutos_descartados, saldoResultante: a4.saldo_resultante },
    "T5 simularCompra (TS) difiere de la RPC (SQL)"
  );
  console.log("T5 renovación >60 OK (TS == SQL)");

  // ── T6 · Renovación con saldo 0 pero todavía vigente ──────────────────────
  await setSaldo(a1.mensualidad_id!, 0);
  await nuevaCompra({ slug: "4h", minutos: 240, precio: 100000, telefonoNorm: telA, ref: `${MARCA}_a5` });
  const a5 = await aplicar(`${MARCA}_a5`, `${MARCA}_pay_a5`);
  assert.equal(a5.tipo, "renovacion", "T6 sigue siendo renovación");
  assert.equal(a5.saldo_resultante, 240);
  assert.equal((await saldoDe(a5.mensualidad_id!)).codigo, mA.codigo, "T6 conserva el código");
  console.log("T6 renovación con saldo 0 OK");

  // ── T7 · Compra POSTERIOR al vencimiento: código nuevo, saldo = plan ──────
  await setSaldo(a1.mensualidad_id!, 45, sumarDias(HOY, -1));
  await nuevaCompra({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telA, ref: `${MARCA}_a6` });
  const a6 = await aplicar(`${MARCA}_a6`, `${MARCA}_pay_a6`);
  assert.equal(a6.tipo, "alta", "T7 debe ser alta");
  assert.equal(a6.saldo_resultante, 60, "T7 no recupera saldo vencido");
  assert.notEqual(a6.mensualidad_id, a1.mensualidad_id, "T7 debe crear otra mensualidad");
  const mNueva = await saldoDe(a6.mensualidad_id!);
  assert.notEqual(mNueva.codigo, mA.codigo, "T7 código nuevo");
  assert.equal((await saldoDe(a1.mensualidad_id!)).saldo_minutos, 45, "T7 no toca la vencida");
  console.log("T7 compra tras vencimiento OK");

  // ── T9 · Dos aprobaciones CONCURRENTES para el mismo teléfono ─────────────
  // Sin advisory lock esto crearía dos billeteras o perdería minutos.
  const telB = nuevoTel();
  await nuevaCompra({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telB, ref: `${MARCA}_c1` });
  await nuevaCompra({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telB, ref: `${MARCA}_c2` });
  const [c1, c2] = await Promise.all([
    aplicar(`${MARCA}_c1`, `${MARCA}_pay_c1`),
    aplicar(`${MARCA}_c2`, `${MARCA}_pay_c2`),
  ]);
  const { data: billeterasB } = await supabaseAdmin
    .from("mensualidades").select("id, saldo_minutos, codigo").eq("telefono_norm", telB);
  assert.equal(billeterasB?.length, 1, "T9 no puede haber dos mensualidades activas para el mismo teléfono");
  assert.equal(c1.mensualidad_id, c2.mensualidad_id, "T9 ambas compras van a la misma billetera");
  // Una es alta (60) y la otra renovación (traslada 60 + suma 60 = 120).
  const tipos = [c1.tipo, c2.tipo].sort();
  assert.deepEqual(tipos, ["alta", "renovacion"], `T9 tipos inesperados: ${tipos.join(",")}`);
  assert.equal(billeterasB?.[0].saldo_minutos, 120, "T9 no se pierden minutos: 60 + 60 = 120");
  console.log("T9 concurrencia OK");

  // ── T10 · Código único ────────────────────────────────────────────────────
  const { error: dupErr } = await supabaseAdmin.from("mensualidades").insert({
    codigo: mA.codigo, titular_nombre: "Zz", titular_apellido: "Test",
    titular_telefono: telA, telefono_norm: telA, titular_email: "zz@test.local",
    saldo_minutos: 0, vence_el: HOY,
  });
  assert.ok(dupErr, "T10 debe rechazar un código duplicado");
  assert.equal((dupErr as { code?: string }).code, "23505", "T10 debe ser unique_violation");
  console.log("T10 código único OK");

  // ── T11 · Teléfono normalizado: SQL y TypeScript coinciden ───────────────
  const casos = ["+54 9 351 512-3456", "5493515123456", "0054 9 3515123456", "351 512 3456", "3515123456"];
  for (const c of casos) {
    const { data: sql } = await supabaseAdmin.rpc("mensualidad_normalizar_telefono", { p_tel: c });
    assert.equal(sql, normalizarTelefono(c), `T11 SQL y TS difieren para "${c}": ${sql} vs ${normalizarTelefono(c)}`);
  }
  console.log("T11 teléfono normalizado OK (SQL == TS)");

  // ── T12 · Saldo negativo imposible ────────────────────────────────────────
  const { error: negErr } = await supabaseAdmin
    .from("mensualidades").update({ saldo_minutos: -15 }).eq("id", a1.mensualidad_id!);
  assert.ok(negErr, "T12 debe rechazar saldo negativo");
  assert.equal((negErr as { code?: string }).code, "23514", "T12 debe ser check_violation");
  console.log("T12 saldo negativo bloqueado OK");

  // ── T13 · Múltiplos de 15 en planes, saldos y movimientos ────────────────
  const { error: m1 } = await supabaseAdmin
    .from("mensualidades").update({ saldo_minutos: 20 }).eq("id", a1.mensualidad_id!);
  assert.equal((m1 as { code?: string } | null)?.code, "23514", "T13 saldo no múltiplo de 15");
  const { error: m2 } = await supabaseAdmin.from("mensualidad_planes")
    .insert({ slug: `zz${Date.now()}`, nombre: "Zz", minutos: 20, precio: 1 });
  assert.equal((m2 as { code?: string } | null)?.code, "23514", "T13 plan no múltiplo de 15");
  const { error: m3 } = await supabaseAdmin.from("mensualidad_movimientos").insert({
    mensualidad_id: a1.mensualidad_id!, tipo: "ajuste_admin", minutos: 10,
    saldo_anterior: 45, saldo_posterior: 55,
  });
  assert.equal((m3 as { code?: string } | null)?.code, "23514", "T13 movimiento no múltiplo de 15");
  console.log("T13 múltiplos de 15 OK");

  // ── T16 · Rollback total: una compra que falla no deja saldo aplicado ────
  // Email sin "@": la compra se inserta (esa tabla no lo valida) pero el INSERT en
  // mensualidades revienta el check DESPUÉS de tomar el advisory lock, así que la
  // operación aborta a mitad de camino. Es el escenario de rollback real.
  const telC = nuevoTel();
  const { data: compraRota, error: compraRotaErr } = await supabaseAdmin
    .from("mensualidad_compras").insert({
      plan_slug: "1h", plan_nombre: "Plan 1h", plan_minutos: 60, plan_precio: 30000,
      plan_vigencia_dias: 30, comprador_nombre: "Zz", comprador_apellido: "Test",
      comprador_telefono: telC, telefono_norm: telC,
      comprador_email: "sin-arroba", importe_bruto: 30000,
      external_reference: `${MARCA}_r1`,
    }).select("id").single();
  if (compraRotaErr) throw new Error(`T16 setup: ${compraRotaErr.message}`);
  creados.compras.push(compraRota.id);
  const { error: rollErr } = await supabaseAdmin.rpc("mensualidad_aplicar_compra", {
    p_external_reference: `${MARCA}_r1`, p_mp_payment_id: `${MARCA}_pay_r1`,
    p_importe_bruto: null, p_comision_mp: null, p_importe_neto: null,
  });
  assert.ok(rollErr, "T16 debía fallar al crear la billetera");
  assert.equal((rollErr as { code?: string }).code, "23514", "T16 debe ser check_violation");
  const { data: billeterasC } = await supabaseAdmin
    .from("mensualidades").select("id").eq("telefono_norm", telC);
  assert.equal(billeterasC?.length, 0, "T16 rollback: no debe quedar la billetera a medio crear");
  const { data: compraR } = await supabaseAdmin
    .from("mensualidad_compras").select("procesamiento, estado_pago, mensualidad_id")
    .eq("external_reference", `${MARCA}_r1`).single();
  assert.equal(compraR?.procesamiento, "pendiente", "T16 la compra debe seguir pendiente");
  assert.equal(compraR?.mensualidad_id, null, "T16 la compra no debe quedar vinculada");
  const { count: movsC } = await supabaseAdmin
    .from("mensualidad_movimientos").select("*", { count: "exact", head: true })
    .eq("compra_id", compraRota.id);
  assert.equal(movsC, 0, "T16 rollback: no debe quedar ningún movimiento");
  console.log("T16 rollback total OK");

  // ── T16b · Un payment_id ya aplicado con OTRA referencia se rechaza ──────
  // Si no, la compra nueva quedaría sin aplicar devolviendo la fila equivocada.
  const telD = nuevoTel();
  await nuevaCompra({ slug: "1h", minutos: 60, precio: 30000, telefonoNorm: telD, ref: `${MARCA}_x1` });
  const { error: cruzErr } = await supabaseAdmin.rpc("mensualidad_aplicar_compra", {
    p_external_reference: `${MARCA}_x1`, p_mp_payment_id: `${MARCA}_pay_a2`,
    p_importe_bruto: null, p_comision_mp: null, p_importe_neto: null,
  });
  assert.ok(cruzErr, "T16b debía rechazar un payment_id de otra compra");
  const { data: billeterasD } = await supabaseAdmin
    .from("mensualidades").select("id").eq("telefono_norm", telD);
  assert.equal(billeterasD?.length, 0, "T16b no debe crear billetera");
  console.log("T16b payment_id cruzado rechazado OK");

  // ── T18 · Snapshot histórico inmune a cambios del plan ───────────────────
  const { data: planAntes } = await supabaseAdmin
    .from("mensualidad_planes").select("precio, minutos, nombre").eq("slug", "2h").single();
  await supabaseAdmin.from("mensualidad_planes")
    .update({ precio: 999999, nombre: "ZZ CAMBIADO" }).eq("slug", "2h");
  const { data: compraVieja } = await supabaseAdmin
    .from("mensualidad_compras").select("plan_precio, plan_minutos, plan_nombre")
    .eq("external_reference", `${MARCA}_a1`).single();
  assert.equal(Number(compraVieja?.plan_precio), 55000, "T18 el precio histórico no debe cambiar");
  assert.equal(compraVieja?.plan_minutos, 120, "T18 los minutos históricos no deben cambiar");
  await supabaseAdmin.from("mensualidad_planes")
    .update({ precio: planAntes?.precio, nombre: planAntes?.nombre }).eq("slug", "2h");
  const { data: planDespues } = await supabaseAdmin
    .from("mensualidad_planes").select("precio, nombre").eq("slug", "2h").single();
  assert.equal(Number(planDespues?.precio), 55000, "T18 el plan debe quedar restaurado");
  console.log("T18 snapshot inmutable OK");

  // ── T14 · anon no puede leer PII ni escribir ─────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(url && anonKey, "T14 faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY en .env.local");
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  for (const tabla of ["mensualidades", "mensualidad_compras", "mensualidad_movimientos", "mensualidad_auditoria", "mensualidad_planes"]) {
    const { data, error } = await anon.from(tabla).select("*").limit(1);
    assert.ok(error || (data ?? []).length === 0, `T14 anon pudo leer ${tabla}`);
  }
  const { data: vistaAnon, error: vistaErr } = await anon.from("mensualidades_estado").select("*").limit(1);
  assert.ok(vistaErr || (vistaAnon ?? []).length === 0, "T14 anon pudo leer la vista mensualidades_estado");
  // ── T15 · anon no puede insertar compras aprobadas ni ejecutar la RPC ────
  const { error: insAnon } = await anon.from("mensualidad_compras").insert({
    plan_slug: "1h", plan_nombre: "x", plan_minutos: 60, plan_precio: 0, plan_vigencia_dias: 30,
    comprador_nombre: "x", comprador_apellido: "x", comprador_telefono: "3515123456",
    telefono_norm: "3515123456", comprador_email: "x@x.com", importe_bruto: 0,
    estado_pago: "aprobado", procesamiento: "aplicado",
  });
  assert.ok(insAnon, "T15 anon pudo insertar una compra");
  const { error: rpcAnon } = await anon.rpc("mensualidad_aplicar_compra", {
    p_external_reference: `${MARCA}_a1`, p_mp_payment_id: "hack",
  });
  assert.ok(rpcAnon, "T15 anon pudo ejecutar mensualidad_aplicar_compra");
  const { error: saldoAnon } = await anon.from("mensualidades")
    .update({ saldo_minutos: 240 }).eq("id", a1.mensualidad_id!);
  assert.ok(saldoAnon, "T15 anon pudo modificar un saldo");
  console.log("T14/T15 anon sin acceso a PII ni a mutaciones OK");

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M2 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { data: resto } = await supabaseAdmin
      .from("mensualidades").select("id").like("titular_email", `${MARCA}%`);
    console.log(`limpieza: ${resto?.length ?? 0} filas temporales restantes (debe ser 0)`);
  });
