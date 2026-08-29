import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearEmpleado } from "@/lib/empleadosServer";
import { crearBorrador, confirmarMes, getMesVista, getHistorial } from "@/lib/cronogramaServer";
import { getImportacion, guardarCorrecciones, aplicarImportacion, descartarImportacion, type Propuesta } from "@/lib/cronogramaImportServer";

// Integración DB (SIM WEB). Prueba la capa de aplicación/conflictos/bloqueo SIN
// depender del PDF (el parseo se prueba en cronogramaPdf.test.ts y contra el PDF
// real localmente). Usa años 2098 y fixtures ZZTEST; limpia todo al final.
// Ejecutar: npx tsx --env-file=.env.local lib/cronogramaImport.integration.ts

async function limpiar() {
  await supabaseAdmin.from("cronograma_importaciones").delete().or("anio.eq.2098,archivo_nombre.like.ZZTEST%");
  await supabaseAdmin.from("cronograma_meses").delete().eq("anio", 2098);
  const { data } = await supabaseAdmin.from("empleados").select("id").ilike("nombre_formal", "ZZTEST_IMP_%");
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) await supabaseAdmin.from("empleados").delete().in("id", ids);
}

async function seedImport(anio: number, mes: number, propuesta: Propuesta, opts: { bloquea?: boolean; incidencias?: unknown[] } = {}): Promise<string> {
  const { data, error } = await supabaseAdmin.from("cronograma_importaciones").insert({
    anio, mes, archivo_nombre: "ZZTEST_import.pdf", archivo_tamano: 1000, archivo_hash: "zz", paginas: 1,
    estado: opts.bloquea ? "pendiente_correcciones" : "pendiente",
    bloquea_confirmacion: !!opts.bloquea, propuesta, incidencias: opts.incidencias ?? [],
  }).select("id").single();
  if (error || !data) throw new Error("seed import: " + JSON.stringify(error));
  return data.id as string;
}

const dia = (fecha: string, jornadas: Array<{ empleado_id: string; hora_inicio: string; hora_fin: string; alias_texto?: string }>, cerrado = false) => ({
  fecha, cerrado, apertura: "10:00", cierre: "22:00",
  jornadas: jornadas.map((j) => ({ alias_texto: j.alias_texto ?? "x", empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })),
});

async function main() {
  await limpiar();
  try {
    const fran = await crearEmpleado("ZZTEST_IMP_Fran", [{ alias: "ZZ Imp Fran", alias_normalizado: "zztest_imp_fran" }]);
    const fede = await crearEmpleado("ZZTEST_IMP_Fede", [{ alias: "ZZ Imp Fede", alias_normalizado: "zztest_imp_fede" }]);
    assert.ok(fran.ok && fede.ok, "fixtures");
    const FRAN = fran.ok ? fran.empleado.id : "";
    const FEDE = fede.ok ? fede.empleado.id : "";

    // ── 15/22/23) Aplicar como borrador (mes inexistente) ────────────────────
    const prop1: Propuesta = {
      mes_estado_actual: "inexistente",
      aliases: { Fran: { empleado_id: FRAN, nombre: "Fran", activo: true }, Fede: { empleado_id: FEDE, nombre: "Fede", activo: true } },
      dias: [
        dia("2098-05-04", [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "20:00" }, { empleado_id: FEDE, hora_inicio: "16:00", hora_fin: "22:00" }]),
        dia("2098-05-05", [], true),
      ],
      conflictos: [],
    };
    const id1 = await seedImport(2098, 5, prop1);
    await guardarCorrecciones(id1, {}); // pobla conflictos (todos solo_pdf)
    const ap1 = await aplicarImportacion(id1);
    assert.ok(ap1.ok, "15: aplicar OK");
    let vista = await getMesVista(2098, 5);
    assert.equal(vista.estado, "borrador", "15: crea BORRADOR (nunca confirmado)");
    const d04 = vista.dias.find((d) => d.fecha === "2098-05-04")!;
    assert.equal(d04.jornadas.length, 2, "día 04 con 2 jornadas");
    assert.equal(vista.dias.find((d) => d.fecha === "2098-05-05")!.cerrado, true, "día 05 cerrado");
    const imp1 = await getImportacion(id1);
    assert.equal(imp1!.estado, "aplicada", "import queda aplicada");
    const hist = await getHistorial(2098, 5);
    assert.ok(hist.some((h) => h.tipo === "importacion_aplicada"), "23: historial importacion_aplicada");
    assert.ok(hist.some((h) => h.tipo === "dia_guardado" && (h.antes === null)), "23b: snapshot antes(null)/después por día");

    // ── 16/17/18) Conflictos por día ─────────────────────────────────────────
    const prop2: Propuesta = {
      mes_estado_actual: "borrador",
      aliases: prop1.aliases,
      dias: [
        dia("2098-05-04", [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "18:00" }]), // DIFERENTE (actual tiene 2)
        dia("2098-05-05", [{ empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "22:00" }]), // DIFERENTE (actual cerrado)
        dia("2098-05-06", [{ empleado_id: FEDE, hora_inicio: "10:00", hora_fin: "20:00" }]), // SOLO_PDF
      ],
      conflictos: [],
    };
    const id2 = await seedImport(2098, 5, prop2);
    const g2 = await guardarCorrecciones(id2, {});
    assert.ok(g2.ok, "recompute conflictos");
    if (g2.ok) {
      const c04 = g2.data.propuesta!.conflictos.find((c) => c.fecha === "2098-05-04")!;
      const c06 = g2.data.propuesta!.conflictos.find((c) => c.fecha === "2098-05-06")!;
      assert.equal(c04.clase, "diferente", "16: 04 diferente");
      assert.equal(c06.clase, "solo_pdf", "16: 06 solo_pdf");
      assert.equal(g2.data.bloquea_confirmacion, true, "19: conflicto sin decidir bloquea");
    }
    // 17) mantener actual el 04; 18) usar PDF el 05.
    const g2b = await guardarCorrecciones(id2, { decisiones: { "2098-05-04": "actual", "2098-05-05": "pdf" } });
    assert.ok(g2b.ok && g2b.data.bloquea_confirmacion === false, "conflictos resueltos → no bloquea");
    const ap2 = await aplicarImportacion(id2);
    assert.ok(ap2.ok, "aplicar con decisiones OK");
    vista = await getMesVista(2098, 5);
    assert.equal(vista.dias.find((d) => d.fecha === "2098-05-04")!.jornadas.length, 2, "17: 04 mantiene versión actual (2 jornadas)");
    const d05 = vista.dias.find((d) => d.fecha === "2098-05-05")!;
    assert.equal(d05.cerrado, false, "18: 05 usa PDF (abierto)");
    assert.equal(d05.jornadas.length, 1, "18b: 05 con 1 jornada del PDF");
    assert.ok(vista.dias.some((d) => d.fecha === "2098-05-06"), "06 aplicado (solo_pdf)");

    // ── 19/20) Bloqueo de confirmación + descartar ───────────────────────────
    await crearBorrador(2098, 6);
    const propBloq: Propuesta = { mes_estado_actual: "borrador", aliases: {}, dias: [], conflictos: [] };
    const id3 = await seedImport(2098, 6, propBloq, { bloquea: true, incidencias: [{ tipo: "alias_desconocido", severidad: "bloqueante", detalle: "x" }] });
    const confBloq = await confirmarMes(2098, 6);
    assert.equal(confBloq.ok, false, "19: no se puede confirmar con importación bloqueante");
    if (!confBloq.ok) assert.equal(confBloq.status, 409, "19b: 409");
    const desc = await descartarImportacion(id3);
    assert.ok(desc.ok && desc.data.estado === "descartada", "20: descartada");
    const impDesc = await getImportacion(id3);
    assert.ok(impDesc && impDesc.estado === "descartada", "20b: auditoría preservada");
    const confOk = await confirmarMes(2098, 6);
    assert.ok(confOk.ok && confOk.data.estado === "confirmado", "20c: tras descartar se puede confirmar");

    // ── 21) Mes confirmado no admite importación masiva ──────────────────────
    const id4 = await seedImport(2098, 6, { mes_estado_actual: "confirmado", aliases: {}, dias: [dia("2098-06-10", [{ empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "12:00" }])], conflictos: [] });
    await guardarCorrecciones(id4, {});
    const ap4 = await aplicarImportacion(id4);
    assert.equal(ap4.ok, false, "21: no aplica sobre mes confirmado");
    if (!ap4.ok) assert.equal(ap4.status, 409, "21b: 409");

    // ── 22) Atomicidad DB: RPC directa con superposición → rollback total ─────
    const id5 = await seedImport(2098, 7, { mes_estado_actual: "inexistente", aliases: {}, dias: [], conflictos: [] });
    const { error: eAtomic } = await supabaseAdmin.rpc("cronograma_aplicar_importacion", {
      p_import_id: id5,
      p_dias: [{ fecha: "2098-07-03", cerrado: false, apertura: "10:00", cierre: "22:00", jornadas: [
        { empleado_id: FRAN, hora_inicio: "10:00", hora_fin: "14:00" },
        { empleado_id: FRAN, hora_inicio: "13:00", hora_fin: "16:00" },
      ] }],
    });
    assert.equal((eAtomic as { code?: string } | null)?.code, "23P01", "22: superposición → 23P01");
    const vista7 = await getMesVista(2098, 7);
    assert.equal(vista7.estado, "inexistente", "22b: mes NO quedó creado (rollback atómico)");
    assert.equal((await getImportacion(id5))!.estado, "pendiente", "22c: import sigue pendiente");

    // ── 8) Alias desconocido bloquea; resolverlo desbloquea ──────────────────
    const id6 = await seedImport(2098, 8, {
      mes_estado_actual: "inexistente",
      aliases: { Desconocido: { empleado_id: null, nombre: null, activo: false } },
      dias: [dia("2098-08-04", [{ empleado_id: "", hora_inicio: "10:00", hora_fin: "20:00", alias_texto: "Desconocido" }])].map((d) => ({ ...d, jornadas: d.jornadas.map((j) => ({ ...j, empleado_id: null as unknown as string })) })),
      conflictos: [],
    });
    const g6 = await guardarCorrecciones(id6, {});
    assert.ok(g6.ok && g6.data.bloquea_confirmacion === true, "8: alias desconocido bloquea");
    const g6b = await guardarCorrecciones(id6, { aliases: { Desconocido: FRAN } });
    assert.ok(g6b.ok && g6b.data.bloquea_confirmacion === false, "8b: resolver alias desbloquea");

    // ── 26) RLS deny-by-default para anon ────────────────────────────────────
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data: anonData } = await anon.from("cronograma_importaciones").select("*").limit(1);
    assert.equal((anonData ?? []).length, 0, "26: anon no lee cronograma_importaciones");

    console.log("OK — cronogramaImport (integración): aplicar→borrador (nunca confirmado, historial), conflictos por día (mantener/usar-pdf/solo-pdf), bloqueo de confirmación + descartar (auditoría), mes confirmado sin import masiva, atomicidad DB (rollback), alias desconocido bloquea/se resuelve, RLS deny-by-default.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
