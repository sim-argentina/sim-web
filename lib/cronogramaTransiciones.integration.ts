import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearEmpleado } from "@/lib/empleadosServer";
import { crearBorrador, confirmarMes, guardarDia, reabrirMes, descartarBorrador, getMesVista, getHistorial, getFallback } from "@/lib/cronogramaServer";
import { resolverPresencia, type DiaResol } from "@/lib/cronograma";

// Integración DB (SIM WEB): transiciones de estado (reabrir / descartar).
// Año 2097 + fixtures ZZTEST; limpia todo al final.
// Ejecutar: npx tsx --env-file=.env.local lib/cronogramaTransiciones.integration.ts

async function limpiar() {
  await supabaseAdmin.from("cronograma_importaciones").delete().eq("anio", 2097);
  await supabaseAdmin.from("cronograma_meses").delete().eq("anio", 2097);
  const { data } = await supabaseAdmin.from("empleados").select("id").ilike("nombre_formal", "ZZTEST_TR_%");
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) await supabaseAdmin.from("empleados").delete().in("id", ids);
}

function diaResol(vista: Awaited<ReturnType<typeof getMesVista>>, fecha: string): DiaResol {
  const d = vista.dias.find((x) => x.fecha === fecha);
  if (d) return { cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas };
  return { cerrado: false, apertura: vista.apertura_default, cierre: vista.cierre_default, jornadas: [] };
}

async function main() {
  await limpiar();
  try {
    const fb = await getFallback();
    const RAMIRO = fb!.id;
    const fran = await crearEmpleado("ZZTEST_TR_Fran", [{ alias: "ZZ TR Fran", alias_normalizado: "zztest_tr_fran" }]);
    const FRAN = fran.ok ? fran.empleado.id : "";

    // Confirmar un mes con una jornada.
    await crearBorrador(2097, 5);
    await guardarDia(2097, 5, "2097-05-04", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "20:00" }] });
    const conf = await confirmarMes(2097, 5);
    assert.ok(conf.ok && conf.data.estado === "confirmado", "mes confirmado");

    // Con confirmado, un hueco (día 05, 15:00) aplica fallback OFICIAL de Ramiro.
    let vista = await getMesVista(2097, 5);
    assert.deepEqual(resolverPresencia({ estado: "confirmado", dia: diaResol(vista, "2097-05-05"), hora: "15:00", fallbackEmpleadoId: RAMIRO }), { presentes: [RAMIRO], fuente: "fallback", oficial: true }, "confirmado → fallback oficial");

    // ── 20/21/23) Reabrir: conserva jornadas, deja de aplicar fallback oficial, historial ──
    const re = await reabrirMes(2097, 5);
    assert.ok(re.ok && re.data.estado === "borrador", "confirmado → borrador (reabrir)");
    vista = await getMesVista(2097, 5);
    assert.equal(vista.dias.find((d) => d.fecha === "2097-05-04")?.jornadas.length, 1, "20: reabrir conserva jornadas");
    // 21) En borrador, el hueco NO aplica fallback oficial.
    assert.equal(resolverPresencia({ estado: "borrador", dia: diaResol(vista, "2097-05-05"), hora: "15:00", fallbackEmpleadoId: RAMIRO }).fuente, "ninguno", "21: borrador no aplica fallback oficial");
    let hist = await getHistorial(2097, 5);
    assert.ok(hist.some((h) => h.tipo === "mes_reabierto"), "23: historial mes_reabierto");

    // ── 26) Descartar arrastra importaciones pendientes vinculadas ───────────
    const { data: impRow } = await supabaseAdmin.from("cronograma_importaciones").insert({
      anio: 2097, mes: 5, archivo_nombre: "ZZTEST_tr.pdf", archivo_tamano: 1, archivo_hash: "zz", paginas: 1,
      estado: "pendiente_correcciones", bloquea_confirmacion: true, propuesta: { mes_estado_actual: "borrador", aliases: {}, dias: [], conflictos: [] }, incidencias: [],
    }).select("id").single();
    const impId = impRow!.id as string;

    // ── 24/25) Descartar borrador → "Sin cronograma", historial ──────────────
    const desc = await descartarBorrador(2097, 5);
    assert.ok(desc.ok, "descartar OK");
    vista = await getMesVista(2097, 5);
    assert.equal(vista.estado, "inexistente", "24: descartado se ve como inexistente");
    assert.equal(vista.dias.length, 0, "24b: sin días/jornadas activos");
    hist = await getHistorial(2097, 5);
    assert.ok(hist.some((h) => h.tipo === "borrador_descartado"), "25: historial borrador_descartado");
    const { data: impAfter } = await supabaseAdmin.from("cronograma_importaciones").select("estado, bloquea_confirmacion").eq("id", impId).single();
    assert.equal(impAfter!.estado, "descartada", "26: importación pendiente descartada");
    assert.equal(impAfter!.bloquea_confirmacion, false, "26b: bloqueo liberado");
    // El historial se conserva pese a descartar.
    assert.ok(hist.length >= 3, "historial preservado tras descartar");

    // ── 27/28) Nuevo borrador tras descartar comienza VACÍO ──────────────────
    const nb = await crearBorrador(2097, 5);
    assert.ok(nb.ok && nb.data.estado === "borrador", "27: reactiva como borrador");
    vista = await getMesVista(2097, 5);
    assert.equal(vista.dias.length, 0, "28: nuevo borrador vacío (no reaparecen datos)");

    // ── 29/32) No se puede descartar un CONFIRMADO directamente (sin cambios) ──
    await crearBorrador(2097, 6);
    await guardarDia(2097, 6, "2097-06-03", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "18:00" }] });
    await confirmarMes(2097, 6);
    const descConf = await descartarBorrador(2097, 6);
    assert.equal(descConf.ok, false, "29: no descarta confirmado directamente");
    if (!descConf.ok) assert.equal(descConf.status, 409, "29b: 409");
    const vista6 = await getMesVista(2097, 6);
    assert.equal(vista6.estado, "confirmado", "32: confirmado intacto (rollback / sin cambios)");
    assert.equal(vista6.dias.find((d) => d.fecha === "2097-06-03")?.jornadas.length, 1, "32b: jornadas intactas");

    // ── Transiciones inválidas de reabrir ────────────────────────────────────
    const reInex = await reabrirMes(2097, 9);
    assert.equal(reInex.ok, false, "reabrir mes inexistente falla");
    if (!reInex.ok) assert.equal(reInex.status, 404, "reabrir inexistente → 404");
    const reBorr = await reabrirMes(2097, 5); // 2097-05 está en borrador ahora
    assert.equal(reBorr.ok, false, "reabrir un borrador falla");
    if (!reBorr.ok) assert.equal(reBorr.status, 409, "reabrir borrador → 409");

    console.log("OK — cronograma transiciones: reabrir conserva jornadas + deja de aplicar fallback oficial + historial; descartar → inexistente + historial + arrastra importaciones + libera bloqueo; nuevo borrador vacío; no descartar confirmado directo; reabrir inválido rechazado.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
