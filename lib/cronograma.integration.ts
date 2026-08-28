import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearEmpleado } from "@/lib/empleadosServer";
import { crearBorrador, guardarDia, confirmarMes, getMesVista, getHistorial, getFallback } from "@/lib/cronogramaServer";
import { resolverPresencia, type DiaResol } from "@/lib/cronograma";

// Integración contra la DB real (SIM WEB). Usa el mes de prueba 2099-01 y
// fixtures ZZTEST_CRON_*, y limpia TODO al final. No toca datos reales.
// Ejecutar: npx tsx --env-file=.env.local lib/cronograma.integration.ts

const ANIO = 2099;
const MES = 1;

async function mesId(): Promise<string | null> {
  const { data } = await supabaseAdmin.from("cronograma_meses").select("id").eq("anio", ANIO).eq("mes", MES).maybeSingle();
  return (data?.id as string) ?? null;
}

async function limpiar() {
  await supabaseAdmin.from("cronograma_meses").delete().eq("anio", ANIO); // cascada: días/jornadas/historial
  const { data } = await supabaseAdmin.from("empleados").select("id").ilike("nombre_formal", "ZZTEST_CRON_%");
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) await supabaseAdmin.from("empleados").delete().in("id", ids);
}

function diaResolDeVista(vista: Awaited<ReturnType<typeof getMesVista>>, fecha: string): DiaResol {
  const d = vista.dias.find((x) => x.fecha === fecha);
  if (d) return { cerrado: d.cerrado, apertura: d.apertura, cierre: d.cierre, jornadas: d.jornadas };
  return { cerrado: false, apertura: vista.apertura_default, cierre: vista.cierre_default, jornadas: [] };
}

async function main() {
  await limpiar();
  try {
    const fb = await getFallback();
    assert.ok(fb, "existe integrante fallback (Ramiro)");
    const RAMIRO = fb!.id;

    // Fixtures: dos activos + uno que archivaremos.
    const fran = await crearEmpleado("ZZTEST_CRON_Fran", [{ alias: "ZZ Cron Fran", alias_normalizado: "zztest_cron_fran" }]);
    const fede = await crearEmpleado("ZZTEST_CRON_Fede", [{ alias: "ZZ Cron Fede", alias_normalizado: "zztest_cron_fede" }]);
    const arch = await crearEmpleado("ZZTEST_CRON_Arch", [{ alias: "ZZ Cron Arch", alias_normalizado: "zztest_cron_arch" }]);
    assert.ok(fran.ok && fede.ok && arch.ok, "fixtures creados");
    const FRAN = fran.ok ? fran.empleado.id : "";
    const FEDE = fede.ok ? fede.empleado.id : "";
    const ARCH = arch.ok ? arch.empleado.id : "";
    await supabaseAdmin.from("empleados").update({ activo: false }).eq("id", ARCH); // archivar

    // ── 1) Mes inexistente ────────────────────────────────────────────────────
    let vista = await getMesVista(ANIO, MES);
    assert.equal(vista.estado, "inexistente", "1: mes inexistente");
    assert.deepEqual(
      resolverPresencia({ estado: "inexistente", dia: diaResolDeVista(vista, "2099-01-15"), hora: "15:00", fallbackEmpleadoId: RAMIRO }),
      { presentes: [], fuente: "ninguno", oficial: false },
      "1b: inexistente → nadie",
    );

    // ── 2) Crear borrador (+ historial, idempotente) ──────────────────────────
    const b1 = await crearBorrador(ANIO, MES);
    assert.ok(b1.ok && b1.data.estado === "borrador", "2: borrador creado");
    await crearBorrador(ANIO, MES); // idempotente
    let hist = await getHistorial(ANIO, MES);
    assert.equal(hist.filter((h) => h.tipo === "mes_creado").length, 1, "2b: un solo evento mes_creado (idempotente)");

    const mid = await mesId();
    assert.ok(mid, "mes_id disponible");

    // ── 16) Escritura inválida NO deja datos parciales (atomicidad DB) ─────────
    // Llamada directa a la RPC (evita la validación pura) con superposición del
    // mismo integrante: la 2ª jornada viola la exclusión → rollback total.
    const { error: eAtomic } = await supabaseAdmin.rpc("cronograma_guardar_dia", {
      p_anio: ANIO, p_mes: MES, p_fecha: "2099-01-10", p_cerrado: false, p_apertura: "10:00", p_cierre: "22:00",
      p_jornadas: [
        { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" },
        { empleado_id: FRAN, hora_inicio: "13:00", hora_fin: "16:00" },
      ],
    });
    assert.equal((eAtomic as { code?: string } | null)?.code, "23P01", "16a: superposición rechazada por exclusión (23P01)");
    const { data: diaParcial } = await supabaseAdmin.from("cronograma_dias").select("id").eq("mes_id", mid!).eq("fecha", "2099-01-10");
    assert.equal((diaParcial ?? []).length, 0, "16b: no quedó el día a medias (rollback atómico)");

    // ── 6/12b) Guardar día válido con jornada manual ──────────────────────────
    const g1 = await guardarDia(ANIO, MES, "2099-01-15", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" }] });
    assert.ok(g1.ok, "6: día con jornada manual guardado");

    // ── 13) Superposición entre integrantes DISTINTOS → OK ────────────────────
    const g2 = await guardarDia(ANIO, MES, "2099-01-17", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [
      { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "18:00" },
      { empleado_id: FEDE, hora_inicio: "12:00", hora_fin: "20:00" },
    ] });
    assert.ok(g2.ok, "13: distintos integrantes simultáneos OK");

    // ── 4) Día cerrado ────────────────────────────────────────────────────────
    const g3 = await guardarDia(ANIO, MES, "2099-01-16", { cerrado: true, apertura: "10:00", cierre: "22:00", jornadas: [] });
    assert.ok(g3.ok, "4: día cerrado guardado");

    // ── 15) Integrante archivado no puede usarse en jornada nueva ─────────────
    const gArch = await guardarDia(ANIO, MES, "2099-01-18", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: ARCH, hora_inicio: "10:00", hora_fin: "12:00" }] });
    assert.equal(gArch.ok, false, "15: archivado rechazado");
    if (!gArch.ok) assert.equal(gArch.status, 409, "15b: archivado → 409");

    // ── 3/5) Confirmar → huecos a Ramiro; fuera de horario nadie ──────────────
    const conf = await confirmarMes(ANIO, MES);
    assert.ok(conf.ok && conf.data.estado === "confirmado", "confirmado");
    vista = await getMesVista(ANIO, MES);

    // Día 15: FRAN 10–14.
    const d15 = diaResolDeVista(vista, "2099-01-15");
    assert.deepEqual(resolverPresencia({ estado: "confirmado", dia: d15, hora: "12:00", fallbackEmpleadoId: RAMIRO }).presentes, [FRAN], "6b: 12:00 → Fran");
    assert.deepEqual(resolverPresencia({ estado: "confirmado", dia: d15, hora: "15:00", fallbackEmpleadoId: RAMIRO }).presentes, [RAMIRO], "3: hueco 15:00 → Ramiro");
    assert.equal(resolverPresencia({ estado: "confirmado", dia: d15, hora: "09:00", fallbackEmpleadoId: RAMIRO }).fuente, "ninguno", "5: 09:00 fuera de horario → nadie");

    // Día 16 cerrado → nadie a cualquier hora.
    const d16 = diaResolDeVista(vista, "2099-01-16");
    assert.equal(resolverPresencia({ estado: "confirmado", dia: d16, hora: "15:00", fallbackEmpleadoId: RAMIRO }).fuente, "ninguno", "4b: cerrado → nadie");

    // Día 20 SIN fila → hueco confirmado cubierto por Ramiro; fuera de horario nadie.
    const d20 = diaResolDeVista(vista, "2099-01-20");
    assert.deepEqual(resolverPresencia({ estado: "confirmado", dia: d20, hora: "15:00", fallbackEmpleadoId: RAMIRO }).presentes, [RAMIRO], "3b: día sin fila, confirmado → Ramiro");

    // ── 18) Corrección post-confirmación: sigue confirmado + historial ────────
    const corr = await guardarDia(ANIO, MES, "2099-01-15", { cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [{ empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "20:00" }] });
    assert.ok(corr.ok && corr.data.estado === "confirmado", "18: corrección conserva confirmado");
    hist = await getHistorial(ANIO, MES);
    assert.equal(hist.some((h) => h.tipo === "mes_confirmado"), true, "17: confirmar generó historial");
    assert.equal(hist.some((h) => h.tipo === "correccion_confirmado"), true, "18b: corrección generó historial");
    // El historial es reconstruible: la corrección guarda snapshots antes/después.
    const evCorr = hist.find((h) => h.tipo === "correccion_confirmado")!;
    assert.ok(evCorr.antes && evCorr.despues, "18c: snapshots antes/después presentes");

    // ── 21) RLS deny-by-default: anon no puede leer las tablas ────────────────
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const tabla of ["cronograma_meses", "cronograma_dias", "cronograma_jornadas", "cronograma_historial"]) {
      const { data } = await anon.from(tabla).select("*").limit(1);
      assert.equal((data ?? []).length, 0, `21: anon no lee ${tabla}`);
    }

    console.log("OK — cronograma (integración): inexistente/borrador(idempotente)/confirmado, huecos→Ramiro, cerrado→nadie, fuera de horario→nadie, manual, simultáneos distintos, archivado rechazado, atomicidad (rollback), corrección conserva confirmado + historial con snapshots, RLS deny-by-default.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
