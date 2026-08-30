import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearEmpleado } from "@/lib/empleadosServer";
import { crearBorrador, guardarDia, confirmarMes, reabrirMes, descartarBorrador, getMesVista, getHorasMensuales } from "@/lib/cronogramaServer";
import { weekday, ymd, fechasSemana, addDias } from "@/lib/cronogramaCopia";
import {
  previsualizarCopiaSemana, aplicarCopiaSemana, previsualizarCopiaMes, aplicarCopiaMes,
  crearPlantilla, listarPlantillas, previsualizarPlantilla, aplicarPlantilla, getPlantilla,
} from "@/lib/cronogramaCopiaServer";

// Integración DB (SIM WEB): copiar semana/mes + plantillas. Año 2095 + fixtures
// ZZTEST; limpia todo al final. Ejecutar: npx tsx --env-file=.env.local lib/cronogramaCopia.integration.ts

async function limpiar() {
  await supabaseAdmin.from("cronograma_meses").delete().eq("anio", 2095);
  await supabaseAdmin.from("cronograma_plantillas").delete().ilike("nombre", "ZZTEST%");
  const { data } = await supabaseAdmin.from("empleados").select("id").ilike("nombre_formal", "ZZTEST_CP_%");
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) await supabaseAdmin.from("empleados").delete().in("id", ids);
}

// Lunes de un mes.
function lunesDelMes(anio: number, mes: number): string[] {
  const total = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) { const f = ymd(anio, mes, d); if (weekday(f) === 0) out.push(f); }
  return out;
}
// Nº de aparición del lunes en un mes (1..) → fecha (usa el último si n excede).
function lunes(anio: number, mes: number, n: number): string {
  const ls = lunesDelMes(anio, mes);
  return ls[Math.min(n, ls.length) - 1];
}

async function main() {
  await limpiar();
  try {
    const fede = await crearEmpleado("ZZTEST_CP_Fede", [{ alias: "ZZ CP Fede", alias_normalizado: "zztest_cp_fede" }]);
    const fran = await crearEmpleado("ZZTEST_CP_Fran", [{ alias: "ZZ CP Fran", alias_normalizado: "zztest_cp_fran" }]);
    const arch = await crearEmpleado("ZZTEST_CP_Arch", [{ alias: "ZZ CP Arch", alias_normalizado: "zztest_cp_arch" }]);
    const FEDE = fede.ok ? fede.empleado.id : "", FRAN = fran.ok ? fran.empleado.id : "", ARCH = arch.ok ? arch.empleado.id : "";

    // ── Origen: mes 2095-07 confirmado con contenido variado ─────────────────
    await crearBorrador(2095, 7);
    const l1 = lunes(2095, 7, 1); // primer lunes de julio
    await guardarDia(2095, 7, l1, { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "18:00" }] }); // Fede 8h, hueco 4h
    const mar1 = addDias(l1, 1); // primer martes
    await guardarDia(2095, 7, mar1, { cerrado: true, apertura: "10:00", cierre: "22:00", jornadas: [] }); // cerrado
    const mie1 = addDias(l1, 2); // primer miércoles: horario especial
    await guardarDia(2095, 7, mie1, { cerrado: false, apertura: "12:00", cierre: "20:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "12:00", hora_fin: "20:00" }] });
    await confirmarMes(2095, 7);

    // ── 24) COPIAR MES por aparición → 2095-09 (inexistente) ─────────────────
    const pv = await previsualizarCopiaMes(2095, 7, 2095, 9);
    assert.ok(pv.ok, "preview copia mes");
    if (pv.ok) {
      // Primer lunes de julio → primer lunes de septiembre.
      const l1sep = lunes(2095, 9, 1);
      const fila = pv.data.filas.find((f) => f.origen === l1 && f.destino === l1sep);
      assert.ok(fila, "11: 1er lunes jul→1er lunes sep");
      assert.equal(fila!.propuesta?.jornadas[0]?.empleado_id, FEDE, "propuesta trae Fede");
      assert.equal(fila!.propuesta?.jornadas.length, 1, "5/6: solo jornada manual (sin Ramiro)");
    }
    const apMes = await aplicarCopiaMes(2095, 7, 2095, 9, {});
    assert.ok(apMes.ok, "17: mes inexistente → crea borrador");
    let v9 = await getMesVista(2095, 9);
    assert.equal(v9.estado, "borrador", "19: aplicar no confirma (queda borrador)");
    const l1sep = lunes(2095, 9, 1);
    const d1sep = v9.dias.find((d) => d.fecha === l1sep);
    assert.equal(d1sep?.jornadas.length, 1, "copió 1 jornada manual");
    assert.equal(d1sep?.jornadas[0].empleado_id, FEDE, "4: copió integrante y horario");
    // Día cerrado y horario especial copiados.
    const mar1sep = addDias(l1sep, 1), mie1sep = addDias(l1sep, 2);
    assert.equal(v9.dias.find((d) => d.fecha === mar1sep)?.cerrado, true, "2: abierto/cerrado copiado");
    assert.equal(v9.dias.find((d) => d.fecha === mie1sep)?.apertura, "12:00", "3: horario operativo copiado");
    // 35) Horas recalculadas (borrador → proyección).
    const h9 = await getHorasMensuales(2095, 9);
    assert.ok(h9 && h9.estado === "borrador", "35: horas recalculadas tras copiar");
    assert.equal(h9!.integrantes.find((i) => i.empleado_id === FEDE)?.minutos, 8 * 60, "Fede 8h en destino");
    // Historial mes_copiado.
    const { data: histCop } = await supabaseAdmin.from("cronograma_historial").select("tipo").eq("mes_id", (await supabaseAdmin.from("cronograma_meses").select("id").eq("anio", 2095).eq("mes", 9).single()).data!.id);
    assert.ok((histCop ?? []).some((h) => h.tipo === "mes_copiado"), "31: historial mes_copiado");
    assert.ok((histCop ?? []).some((h) => h.tipo === "dia_guardado"), "31b: historial por día");

    // ── 9) Destino CONFIRMADO bloquea ────────────────────────────────────────
    await confirmarMes(2095, 9);
    const pvBloq = await previsualizarCopiaMes(2095, 7, 2095, 9);
    assert.ok(pvBloq.ok && pvBloq.data.bloqueado, "9: preview marca bloqueado (confirmado)");
    const apBloq = await aplicarCopiaMes(2095, 7, 2095, 9, {});
    assert.equal(apBloq.ok, false, "9b: aplicar sobre confirmado rechazado");
    if (!apBloq.ok) assert.equal(apBloq.status, 409, "9c: 409");

    // ── 18) Descartado → borrador vacío (no reaparecen datos) ────────────────
    await reabrirMes(2095, 9);
    await descartarBorrador(2095, 9);
    const apReact = await aplicarCopiaMes(2095, 7, 2095, 9, {});
    assert.ok(apReact.ok, "18: descartado se reactiva al copiar");
    v9 = await getMesVista(2095, 9);
    assert.equal(v9.estado, "borrador", "18b: borrador tras reactivar");

    // ── 7/8) COPIAR SEMANA entre meses (atómica, hasta 2 meses destino) ──────
    const cruza = (l: string) => new Set(fechasSemana(l).map((f) => f.slice(0, 7))).size > 1;
    // Origen: primer lunes de julio (contenido confirmado). Destino: un lunes de un
    // mes inexistente cuya semana CRUCE a otro mes (afecta 2 meses destino).
    let luDest = "";
    for (const mm of [10, 11, 12]) { const c = lunesDelMes(2095, mm).find(cruza); if (c) { luDest = c; break; } }
    assert.ok(luDest && cruza(luDest), "hay un lunes destino que cruza de mes");
    const luSrc = lunes(2095, 7, 1);
    const pvSem = await previsualizarCopiaSemana(luSrc, luDest);
    assert.ok(pvSem.ok, "preview copia semana");
    if (pvSem.ok) {
      assert.equal(pvSem.data.filas.length, 7, "1: semana lun→dom (7 filas)");
      assert.equal(pvSem.data.meses_destino.length, 2, "8: la semana afecta 2 meses destino");
    }
    const apSem = await aplicarCopiaSemana(luSrc, luDest, {});
    assert.ok(apSem.ok, "8b: copia semana aplicada (atómica en 2 meses)");
    // Ambos meses destino existen ahora como borrador.
    for (const f of fechasSemana(luDest)) {
      const p = f.split("-").map(Number);
      const vd = await getMesVista(p[0], p[1]);
      assert.equal(vd.estado, "borrador", `8c: mes ${p[1]} destino es borrador`);
    }

    // ── 10) Fuente borrador marcada no oficial ───────────────────────────────
    await crearBorrador(2095, 10);
    await guardarDia(2095, 10, lunes(2095, 10, 1), { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" }] });
    const pvBorr = await previsualizarCopiaSemana(lunes(2095, 10, 1), lunes(2095, 12, 1));
    assert.ok(pvBorr.ok && pvBorr.data.origen_no_oficial === true, "10: origen borrador → no oficial");

    // ── Plantillas ───────────────────────────────────────────────────────────
    // 21) Snapshot MENSUAL desde 2095-07 (confirmado).
    const plM = await crearPlantilla("mensual", "ZZTEST Rotación", { anio: 2095, mes: 7 });
    assert.ok(plM.ok, "21: crea plantilla mensual");
    const plMId = plM.ok ? plM.data.id : "";
    // 25) Nombre único activo por tipo.
    const dup = await crearPlantilla("mensual", "ZZTEST Rotación", { anio: 2095, mes: 7 });
    assert.equal(dup.ok, false, "25: nombre activo duplicado rechazado");

    // 22) Cambiar el origen NO modifica la plantilla (snapshot inmutable).
    await reabrirMes(2095, 7);
    await guardarDia(2095, 7, l1, { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "22:00" }] }); // cambia el origen
    const plGet = await getPlantilla(plMId);
    const celdas = (plGet!.contenido as { celdas: Array<{ weekday: number; ocurrencia: number; jornadas: Array<{ empleado_id: string }> }> }).celdas;
    const celdaL1 = celdas.find((c) => c.weekday === 0 && c.ocurrencia === 1);
    assert.equal(celdaL1?.jornadas[0]?.empleado_id, FEDE, "22: plantilla conserva Fede (snapshot), no el cambio a Fran");
    await confirmarMes(2095, 7); // re-confirmar el origen para dejarlo estable

    // 24) Aplicar plantilla mensual a 2095-05 (inexistente) por aparición.
    const apPl = await aplicarPlantilla(plMId, { anio: 2095, mes: 5 }, {}, {});
    assert.ok(apPl.ok, "24: aplica plantilla mensual → borrador");
    const v5 = await getMesVista(2095, 5);
    assert.equal(v5.estado, "borrador", "plantilla no confirma");
    assert.ok(v5.dias.some((d) => d.jornadas.some((j) => j.empleado_id === FEDE)), "plantilla copió Fede");

    // 20/23) Plantilla SEMANAL + aplicación.
    const plS = await crearPlantilla("semanal", "ZZTEST Semana", { lunes: lunes(2095, 7, 2) });
    assert.ok(plS.ok, "20: crea plantilla semanal");
    const apPlS = await aplicarPlantilla(plS.ok ? plS.data.id : "", { lunes: lunes(2095, 6, 1) }, {}, {});
    assert.ok(apPlS.ok, "23: aplica plantilla semanal");

    // 28/29) Integrante ARCHIVADO en plantilla → bloquea; reemplazo por activo.
    await crearBorrador(2095, 3);
    const l3 = lunes(2095, 3, 1);
    await guardarDia(2095, 3, l3, { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: ARCH, hora_inicio: "10:00", hora_fin: "16:00" }] });
    await confirmarMes(2095, 3);
    const plA = await crearPlantilla("mensual", "ZZTEST ConArch", { anio: 2095, mes: 3 });
    const plAId = plA.ok ? plA.data.id : "";
    await supabaseAdmin.from("empleados").update({ activo: false }).eq("id", ARCH); // archivar
    const pvA = await previsualizarPlantilla(plAId, { anio: 2095, mes: 4 });
    assert.ok(pvA.ok && pvA.data.incidencias.some((i) => i.tipo === "integrante_archivado" && i.severidad === "bloqueante"), "28: archivado → incidencia bloqueante");
    const apAsinRep = await aplicarPlantilla(plAId, { anio: 2095, mes: 4 }, {}, {});
    assert.equal(apAsinRep.ok, false, "28b: sin reemplazo no aplica");
    const apAcon = await aplicarPlantilla(plAId, { anio: 2095, mes: 4 }, {}, { [ARCH]: FEDE });
    assert.ok(apAcon.ok, "29: reemplazo por activo aplica");
    const v4 = await getMesVista(2095, 4);
    assert.ok(v4.dias.some((d) => d.jornadas.some((j) => j.empleado_id === FEDE)), "29b: reemplazado por Fede");

    // 26) Archivar/reactivar plantilla.
    const { activas } = await listarPlantillas();
    assert.ok(activas.some((p) => p.id === plMId), "plantilla activa listada");

    console.log("OK — cronogramaCopia (integración): copia mes por aparición (crea borrador, no confirma, sin Ramiro, historial), destino confirmado bloquea, descartado reactiva, copia semana atómica cross-mes, origen borrador no oficial, horas recalculadas; plantillas snapshot inmutable + nombre único + aplicar semanal/mensual + archivado bloquea/reemplazo.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
