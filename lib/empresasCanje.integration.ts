import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  crearCampania, generarCodigos, canjearCodigo, validarCodigo, getCampania, datosInforme,
} from "@/lib/empresasServer";
import { sumarDias } from "@/lib/empresas";

// Integración END-TO-END contra la DB real, con campañas TEMPORALES que se ELIMINAN
// al final (§50: no crear campañas reales en producción). Ejecutar con:
//   node --env-file=.env.local --import tsx lib/empresasCanje.integration.ts
//
// Verifica: vigencia 60/30, generación de códigos, validación, canje atómico,
// CONCURRENCIA (solo uno gana), código usado bloqueado, programada/vencida/no pagada,
// e informe con datos reales.

const MARCA = `__TEST_EMP_${Date.now()}`;
const hoy = () => new Date().toISOString().slice(0, 10);

async function crear(overrides: Record<string, unknown>) {
  const res = await crearCampania({
    empresa: `${MARCA}`, nombre_campania: "Acción test",
    modalidad: "unica", cantidad_contratada: 25, duracion_minutos: 15, usos_por_codigo: 1,
    precio_neto: 100000, iva_porcentaje: 21,
    fecha_pago: hoy(), estado_pago: "pagado", fecha_inicio: hoy(), estado: "activa",
    ...overrides,
  }, "admin");
  assert.ok(res.ok, "crearCampania: " + (res.ok ? "" : res.error));
  return (res.data as { id: string; fecha_vencimiento: string });
}
async function codigosDe(id: string) {
  const { data } = await supabaseAdmin.from("empresa_codigos").select("*").eq("campania_id", id).order("created_at");
  return data ?? [];
}
async function limpiar() {
  await supabaseAdmin.from("empresa_campanias").delete().like("empresa", "__TEST_EMP_%");
}

async function main() {
  try {
    // ── A. Compra única: 25 códigos, vencimiento hoy+60 ─────────────────────────
    const a = await crear({ modalidad: "unica" });
    assert.equal(a.fecha_vencimiento, sumarDias(hoy(), 60), "compra única → 60 días");
    const g = await generarCodigos(a.id);
    assert.ok(g.ok);
    const codsA = await codigosDe(a.id);
    assert.equal(codsA.length, 25, "25 códigos generados");
    assert.ok(codsA.every((c) => /^EMP-/.test(c.codigo)), "formato de código");
    assert.equal(new Set(codsA.map((c) => c.codigo)).size, 25, "códigos únicos");
    // No se puede regenerar (idempotencia por bandera).
    assert.equal((await generarCodigos(a.id)).ok, false, "no regenera");

    // Validar + canjear un código.
    const cod1 = codsA[0].codigo;
    assert.ok((await validarCodigo(cod1)).ok, "válido antes de usar");
    const canje1 = await canjearCodigo(cod1, { nombre: "Juan", apellido: "Pérez", telefono: "351", email: "j@e.com" });
    assert.ok(canje1.ok, "canje ok");
    // Código quedó utilizado; hay 1 uso registrado con el beneficiario.
    const { data: refetch } = await supabaseAdmin.from("empresa_codigos").select("estado, usos_actuales").eq("codigo", cod1).single();
    assert.equal(refetch!.estado, "utilizado");
    assert.equal(refetch!.usos_actuales, 1);
    const { data: usos } = await supabaseAdmin.from("empresa_codigo_usos").select("*").eq("campania_id", a.id);
    assert.equal(usos!.length, 1);
    assert.equal(usos![0].beneficiario_nombre, "Juan");
    assert.equal(usos![0].reserva_id, null, "Fase 1: sin reserva vinculada todavía");

    // ── D. Código ya usado → segundo intento bloqueado ─────────────────────────
    assert.equal((await canjearCodigo(cod1, { nombre: "Otro" })).ok, false, "código usado no se re-canjea");
    assert.equal((await validarCodigo(cod1)).ok, false, "validar código usado → inválido genérico");

    // ── B. Pack mensual: vencimiento hoy+30 ────────────────────────────────────
    const b = await crear({ modalidad: "mensual", cantidad_contratada: 5 });
    assert.equal(b.fecha_vencimiento, sumarDias(hoy(), 30), "pack mensual → 30 días");

    // ── C. Programada (inicio +15): código NO usable antes ─────────────────────
    const c = await crear({ fecha_inicio: sumarDias(hoy(), 15), estado: "programada", cantidad_contratada: 3 });
    await generarCodigos(c.id);
    const codsC = await codigosDe(c.id);
    assert.equal((await canjearCodigo(codsC[0].codigo, { nombre: "X" })).ok, false, "programada: no canjeable antes del inicio");

    // ── F. Vencida: canje bloqueado ────────────────────────────────────────────
    const f = await crear({ fecha_pago: sumarDias(hoy(), -90), fecha_inicio: sumarDias(hoy(), -90), cantidad_contratada: 2 });
    assert.equal(f.fecha_vencimiento, sumarDias(hoy(), -30), "vencimiento en el pasado");
    await generarCodigos(f.id);
    const codsF = await codigosDe(f.id);
    assert.equal((await canjearCodigo(codsF[0].codigo, { nombre: "X" })).ok, false, "vencida: no canjeable");

    // ── G. No pagada: no genera códigos ────────────────────────────────────────
    const gc = await crear({ estado_pago: "pendiente", estado: "pendiente_pago", cantidad_contratada: 4 });
    assert.equal((await generarCodigos(gc.id)).ok, false, "sin pago no se generan códigos");

    // ── E. CONCURRENCIA: 1 código de 1 uso, 2 canjes simultáneos → solo uno gana ─
    const e = await crear({ cantidad_contratada: 1 });
    await generarCodigos(e.id);
    const codE = (await codigosDe(e.id))[0].codigo;
    const [r1, r2] = await Promise.all([
      canjearCodigo(codE, { nombre: "A" }),
      canjearCodigo(codE, { nombre: "B" }),
    ]);
    const ganadores = [r1, r2].filter((r) => r.ok).length;
    assert.equal(ganadores, 1, "exactamente un canje gana el último uso");
    const { data: codE2 } = await supabaseAdmin.from("empresa_codigos").select("usos_actuales, estado").eq("codigo", codE).single();
    assert.equal(codE2!.usos_actuales, 1, "nunca se consume dos veces");
    assert.equal(codE2!.estado, "utilizado");
    const { data: usosE } = await supabaseAdmin.from("empresa_codigo_usos").select("id").eq("campania_id", e.id);
    assert.equal(usosE!.length, 1, "un solo uso registrado");

    // ── H. Informe con datos reales ────────────────────────────────────────────
    const det = await getCampania(a.id);
    assert.ok(det.ok);
    const dd = det.data as { metricas: { generados: number; utilizados: number; pctUtilizacion: number; minutos_utilizados: number } };
    assert.equal(dd.metricas.generados, 25);
    assert.equal(dd.metricas.utilizados, 1);
    assert.equal(dd.metricas.pctUtilizacion, 4); // 1/25
    assert.equal(dd.metricas.minutos_utilizados, 15);
    const inf = await datosInforme(a.id, "definitivo");
    assert.ok(inf.ok);
    const infd = inf.data as { tipo: string; usos: unknown[]; evolucion: unknown[] };
    assert.equal(infd.tipo, "definitivo");
    assert.equal(infd.usos.length, 1);
    assert.equal(infd.evolucion.length, 1);
    // Registró informe definitivo.
    const { data: campInf } = await supabaseAdmin.from("empresa_campanias").select("informe_definitivo_at").eq("id", a.id).single();
    assert.ok(campInf!.informe_definitivo_at, "informe_definitivo_at registrado");

    console.log("OK — empresas canje: vigencia 60/30, generación única (25) sin regeneración, " +
      "validar/canjear, código usado bloqueado, programada/vencida/no-pagada, CONCURRENCIA (1 gana), " +
      "informe con datos reales (métricas + usos + evolución). Sin reservas ni finanzas tocadas.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
