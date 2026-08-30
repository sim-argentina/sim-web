import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearEmpleado } from "@/lib/empleadosServer";
import { crearBorrador, guardarDia, confirmarMes, reabrirMes, descartarBorrador, getHorasMensuales, getDatosPdf, getFallback } from "@/lib/cronogramaServer";

// Integración DB (SIM WEB): resumen de horas por estado + datos del PDF (confirmado).
// Año 2096 + fixtures ZZTEST; limpia todo al final.
// Ejecutar: npx tsx --env-file=.env.local lib/cronogramaHoras.integration.ts

async function limpiar() {
  await supabaseAdmin.from("cronograma_meses").delete().eq("anio", 2096);
  const { data } = await supabaseAdmin.from("empleados").select("id").ilike("nombre_formal", "ZZTEST_H2C_%");
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) await supabaseAdmin.from("empleados").delete().in("id", ids);
}

const min = (h: number) => h * 60;

async function main() {
  await limpiar();
  try {
    const fb = await getFallback();
    const RAMIRO = fb!.id;
    const fede = await crearEmpleado("ZZTEST_H2C_Fede", [{ alias: "ZZ H2C Fede", alias_normalizado: "zztest_h2c_fede" }]);
    const arch = await crearEmpleado("ZZTEST_H2C_Arch", [{ alias: "ZZ H2C Arch", alias_normalizado: "zztest_h2c_arch" }]);
    const FEDE = fede.ok ? fede.empleado.id : "";
    const ARCH = arch.ok ? arch.empleado.id : "";

    // ── 1) Mes inexistente → sin resumen, sin PDF ────────────────────────────
    assert.equal(await getHorasMensuales(2096, 3), null, "1: inexistente → sin horas");
    assert.equal(await getDatosPdf(2096, 3), null, "1b: inexistente → sin PDF");

    // ── 3) Borrador → proyección; Fede 10–18 (8 h), Ramiro hueco (4 h) ───────
    await crearBorrador(2096, 3);
    await guardarDia(2096, 3, "2096-03-04", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "18:00" }] });
    const hB = await getHorasMensuales(2096, 3);
    assert.ok(hB && hB.estado === "borrador", "3: borrador");
    assert.match(hB!.label, /Proyección/, "3b: label proyección");
    assert.equal(hB!.integrantes.find((i) => i.empleado_id === FEDE)?.minutos, min(8), "3c: Fede 8 h");
    assert.equal(hB!.integrantes.find((i) => i.empleado_id === RAMIRO)?.minutos, min(4), "3d: Ramiro 4 h (hueco)");
    // 22) PDF rechazado en borrador.
    assert.equal(await getDatosPdf(2096, 3), null, "22: borrador → sin PDF");

    // ── 4) Confirmado → efectivo; PDF disponible con jornadas manuales ───────
    await confirmarMes(2096, 3);
    const hC = await getHorasMensuales(2096, 3);
    assert.match(hC!.label, /efectivas del cronograma confirmado/, "4: label efectivas");
    assert.equal(hC!.integrantes.find((i) => i.empleado_id === FEDE)?.minutos, min(8), "4b: Fede 8 h confirmado");
    const pdf = await getDatosPdf(2096, 3);
    assert.ok(pdf, "20: PDF disponible confirmado");
    assert.equal(pdf!.dias.find((d) => d.fecha === "2096-03-04")?.jornadas[0]?.nombre, "ZZTEST_H2C_Fede", "25/27: PDF trae la jornada manual con nombre formal");
    // 23) Reabierto → PDF deja de estar disponible.
    await reabrirMes(2096, 3);
    assert.equal(await getDatosPdf(2096, 3), null, "23: reabierto → sin PDF");
    // El resumen admin continúa como proyección.
    assert.match((await getHorasMensuales(2096, 3))!.label, /Proyección/, "reabierto → proyección");

    // ── 2) Descartado → sin resumen ───────────────────────────────────────────
    await descartarBorrador(2096, 3);
    assert.equal(await getHorasMensuales(2096, 3), null, "2: descartado → sin horas");
    assert.equal(await getDatosPdf(2096, 3), null, "2b: descartado → sin PDF");

    // ── 15) Integrante ARCHIVADO con horas históricas → incluido y marcado ───
    await crearBorrador(2096, 4);
    await guardarDia(2096, 4, "2096-04-02", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: ARCH, hora_inicio: "10:00", hora_fin: "14:00" }] });
    await confirmarMes(2096, 4);
    await supabaseAdmin.from("empleados").update({ activo: false }).eq("id", ARCH); // archivar tras confirmar
    const hArch = await getHorasMensuales(2096, 4);
    const arCh = hArch!.integrantes.find((i) => i.empleado_id === ARCH);
    assert.ok(arCh && arCh.archivado === true, "15: archivado con horas incluido y marcado");
    assert.equal(arCh!.minutos, min(4), "15b: archivado 4 h");
    // Activos con 0 h presentes (Fede activo sin jornadas ese mes → 0).
    assert.equal(hArch!.integrantes.find((i) => i.empleado_id === FEDE)?.minutos, 0, "activo sin horas → 0 h");

    console.log("OK — cronogramaHoras (integración): inexistente/descartado→null; borrador→proyección; confirmado→efectivas + PDF con jornadas manuales; reabierto→sin PDF + proyección; archivado con horas incluido; activo 0 h.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
