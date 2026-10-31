// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  crearCampania, actualizarCampania, generarCodigos, reservarConCodigo, validarCodigo, getCampania,
  listarCampanias, datosInforme, marcarPagada, cancelarReservaEmpresa, reprogramarReservaEmpresa,
} from "@/lib/empresasServer";
import { catalogoEmpresasVigente } from "@/lib/empresasComercial";
import { sumarDias } from "@/lib/empresas";
import { hoyEnSim } from "@/lib/agenda";

// (B8) Código común por pack y un uso por experiencia, por la ruta real del servidor
// (crearCampania → generarCodigos → reservarConCodigo → RPC v2), con la modalidad
// comercial VIGENTE (v2_10: experiencias de 20 minutos). Pack de 10 experiencias con
// un solo código compartido por sus tarjetas:
//   · el código se genera una sola vez, aunque se pida dos veces a la vez, y antes del
//     pago (para imprimir las tarjetas); no canjea hasta pagada + fecha de inicio;
//   · 12 canjes simultáneos del mismo código → exactamente 10;
//   · un canje de 2 simuladores se rechaza sin consumir (servidor y RPC);
//   · reprogramar no cambia la cantidad ni consume otro uso;
//   · un canje cancelado liberando el código no cuenta como usado (métricas,
//     listado e informe) y la experiencia se puede volver a usar;
//   · la configuración que multiplicaba el cupo (individuales con varios usos) se
//     rechaza, y el tipo de código y su cupo quedan fijos al generarlo.
// Datos temporales con marca __TEST_B8_, que se eliminan al terminar.
//   node scripts/pruebas/correr-mutantes.mjs lib/empresasCodigoComun.integration.ts

const MARCA = `__TEST_B8_${Date.now()}`;
const SIMS = ["Ferrari", "McLaren", "Red Bull", "Alpine"];
const BENEF = { nombre: "ZZTEST", apellido: "B8", telefono: "000", email: "zz@test.b8" };

/** Primer día hábil (lunes a viernes) desde hoy + 7, dentro de la vigencia de 60 días. */
function diaHabil(hoy: string): string {
  for (let i = 7; i < 20; i++) {
    const f = sumarDias(hoy, i);
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) return f;
  }
  throw new Error("sin día hábil");
}

async function limpiar() {
  const { data: camps } = await supabaseAdmin.from("empresa_campanias").select("id").like("empresa", "__TEST_B8_%");
  const ids = (camps ?? []).map((c) => c.id);
  const { data: r1 } = ids.length ? await supabaseAdmin.from("reservas").select("id").in("empresa_campania_id", ids) : { data: [] };
  const { data: r2 } = await supabaseAdmin.from("reservas").select("id").eq("nombre", "ZZTEST").eq("apellido", "B8");
  const rids = Array.from(new Set([...(r1 ?? []), ...(r2 ?? [])].map((r) => r.id)));
  if (rids.length) {
    await supabaseAdmin.from("reserva_slots").delete().in("reserva_id", rids);
    await supabaseAdmin.from("reservas").delete().in("id", rids);
  }
  if (ids.length) await supabaseAdmin.from("empresa_campanias").delete().in("id", ids); // cascade códigos/usos
}

async function codigosDe(id: string) {
  const { data } = await supabaseAdmin.from("empresa_codigos").select("*").eq("campania_id", id);
  return data ?? [];
}

async function main() {
  const hoy = hoyEnSim();
  const cat = await catalogoEmpresasVigente();
  assert.equal(cat.modalidad, "v2_10", "la suite corre con la modalidad vigente v2_10 (experiencias de 20 minutos)");
  assert.ok(cat.duraciones.includes(20), "v2_10 vende 20 minutos");
  const D = diaHabil(hoy);
  const base = { modalidad: "unica", duracion_minutos: 20, precio_neto: 150000, iva_porcentaje: 21, modalidad_vista: cat.modalidad };

  try {
    // ── Configuración ────────────────────────────────────────────────────────
    const mult = await crearCampania({ ...base, empresa: MARCA, cantidad_contratada: 10, usos_por_codigo: 10, codigo_comun: false }, "admin");
    assert.ok(!mult.ok && mult.status === 400 && /Código común/.test(mult.error), "individuales con 10 usos (cupo ×10) se rechaza");

    const res = await crearCampania({ ...base, empresa: MARCA, nombre_campania: "Pack 10", cantidad_contratada: 10, usos_por_codigo: 1, codigo_comun: true }, "admin");
    assert.ok(res.ok, "crear pack común: " + (res.ok ? "" : res.error));
    const pack = res.data as { id: string; codigo_comun: boolean; estado: string };
    assert.equal(pack.codigo_comun, true);

    // ── Generación: una sola vez, antes del pago ───────────────────────────────
    const [g1, g2] = await Promise.all([generarCodigos(pack.id), generarCodigos(pack.id)]);
    assert.equal([g1, g2].filter((g) => g.ok).length, 1, "dos «Generar» a la vez: una sola tanda");
    assert.ok([g1, g2].some((g) => !g.ok && g.status === 409));
    const cods = await codigosDe(pack.id);
    assert.equal(cods.length, 1, "un solo código");
    assert.equal(cods[0].usos_maximos, 10, "con 10 usos: el cupo del pack");
    const CODIGO = cods[0].codigo as string;
    assert.ok(!(await validarCodigo(CODIGO)).ok, "sin pagar no canjea");
    assert.ok(!(await reservarConCodigo(CODIGO, BENEF, D, "10:00", ["Ferrari"], `${MARCA}-antes`)).ok);

    // Fijos al generar: el tipo de código y el cupo.
    const e1 = await actualizarCampania(pack.id, { cantidad_contratada: 25 });
    assert.ok(!e1.ok && e1.status === 409, "no se cambia el cupo de un código común ya generado");
    const e2 = await actualizarCampania(pack.id, { codigo_comun: false });
    assert.ok(!e2.ok && e2.status === 409, "no se cambia el tipo de código ya generado");
    assert.ok((await actualizarCampania(pack.id, { observaciones: "entrega con tarjetas" })).ok, "lo demás se edita");

    // ── Activación a mano al entregar: pagada + inicio hoy → vence a los 60 días ──
    assert.ok((await marcarPagada(pack.id, hoy, "transferencia")).ok);
    const act = await actualizarCampania(pack.id, { fecha_inicio: hoy });
    assert.ok(act.ok);
    assert.equal((act.data as { fecha_vencimiento: string }).fecha_vencimiento, sumarDias(hoy, 60));
    assert.ok((await validarCodigo(CODIGO)).ok, "pagada y con inicio: canjea");

    // ── Un canje = un simulador ──────────────────────────────────────────────
    const dos = await reservarConCodigo(CODIGO, BENEF, D, "16:00", ["Ferrari", "McLaren"], `${MARCA}-dos`);
    assert.ok(!dos.ok && dos.status === 400, "2 simuladores con un canje se rechaza");
    const { data: rpcDos } = await supabaseAdmin.rpc("crear_reserva_empresa_v2", {
      p_codigo: CODIGO, p_nombre: "ZZTEST", p_apellido: "B8", p_telefono: "000", p_email: null,
      p_fecha: D, p_hora: "16:00", p_duracion: 20, p_simuladores: ["Ferrari", "McLaren"], p_idempotency_key: `${MARCA}-rpc-dos`,
    });
    assert.equal((rpcDos ?? []).length, 0, "la RPC tampoco acepta 2 simuladores");
    assert.equal((await codigosDe(pack.id))[0].usos_actuales, 0, "nada consumido");

    // ── 12 canjes simultáneos del mismo código → exactamente 10 ─────────────────
    const intentos = ["10:00", "10:30", "11:00"].flatMap((h) => SIMS.map((s) => ({ h, s })));
    assert.equal(intentos.length, 12);
    const resultados = await Promise.all(intentos.map(({ h, s }, i) =>
      reservarConCodigo(CODIGO, BENEF, D, h, [s], `${MARCA}-c${i}`)));
    const okas = resultados.filter((r) => r.ok);
    assert.equal(okas.length, 10, `12 canjes a la vez: ${okas.length} aceptados (esperado 10)`);
    assert.ok(resultados.filter((r) => !r.ok).every((r) => !r.ok && r.status === 409));
    const [cod] = await codigosDe(pack.id);
    assert.equal(cod.usos_actuales, 10);
    assert.equal(cod.estado, "utilizado");
    const { count: nUsos } = await supabaseAdmin.from("empresa_codigo_usos").select("id", { count: "exact", head: true }).eq("campania_id", pack.id);
    assert.equal(nUsos, 10);
    const { data: reservas } = await supabaseAdmin.from("reservas").select("id, cantidad_turnos").eq("empresa_campania_id", pack.id);
    assert.equal(reservas?.length, 10);
    assert.ok(reservas!.every((r) => r.cantidad_turnos === 1), "cada reserva, un simulador");
    assert.ok(!(await reservarConCodigo(CODIGO, BENEF, D, "17:00", ["Ferrari"], `${MARCA}-11`)).ok, "agotado");

    // ── Reprogramar: misma cantidad, sin otro uso ──────────────────────────────
    const rid = (okas[0] as { ok: true; data: { reserva_id: number } }).data.reserva_id;
    const r2 = await reprogramarReservaEmpresa(rid, D, "15:00", ["Ferrari", "McLaren"]);
    assert.ok(!r2.ok && r2.status === 400, "reprogramar con 2 simuladores se rechaza");
    assert.ok((await reprogramarReservaEmpresa(rid, D, "15:00", ["Alpine"])).ok, "reprogramar con uno");
    assert.equal((await codigosDe(pack.id))[0].usos_actuales, 10, "reprogramar no consume");

    // ── Cancelar liberando: la experiencia vuelve y no cuenta como usada ──────────
    assert.ok((await cancelarReservaEmpresa(rid, true)).ok);
    const [libre] = await codigosDe(pack.id);
    assert.equal(libre.usos_actuales, 9);
    assert.equal(libre.estado, "disponible");
    const det = await getCampania(pack.id);
    assert.ok(det.ok);
    const m = (det.data as { metricas: Record<string, number> }).metricas;
    assert.deepEqual([m.turnos_contratados, m.turnos_utilizados, m.turnos_restantes, m.pctUtilizacion, m.generados], [10, 9, 1, 90, 1]);
    const lista = await listarCampanias({ q: MARCA });
    assert.ok(lista.ok);
    const fila = (lista.data as Array<{ id: string; generados: number; utilizados: number }>).find((c) => c.id === pack.id)!;
    assert.deepEqual([fila.generados, fila.utilizados], [1, 9], "listado: 1 código, 9 experiencias usadas");
    const inf = await datosInforme(pack.id, "parcial");
    assert.ok(inf.ok);
    const ev = (inf.data as { evolucion: Array<{ canjes: number }> }).evolucion;
    assert.equal(ev.reduce((a, e) => a + e.canjes, 0), 9, "informe: 9 canjes, sin el cancelado");
    assert.ok((await reservarConCodigo(CODIGO, BENEF, D, "17:00", ["Ferrari"], `${MARCA}-vuelve`)).ok, "la experiencia liberada se usa");
    assert.equal((await codigosDe(pack.id))[0].usos_actuales, 10);

    // ── Individuales: siguen como antes ────────────────────────────────────────
    const ind = await crearCampania({ ...base, empresa: MARCA, nombre_campania: "Individuales", cantidad_contratada: 3, usos_por_codigo: 1 }, "admin");
    assert.ok(ind.ok);
    const indId = (ind.data as { id: string }).id;
    const gAntes = await generarCodigos(indId);
    assert.ok(!gAntes.ok && gAntes.status === 409, "individuales: sin pagar no se generan (como antes)");
    assert.ok((await marcarPagada(indId, hoy, "transferencia")).ok);
    assert.ok((await generarCodigos(indId)).ok);
    const codsInd = await codigosDe(indId);
    assert.equal(codsInd.length, 3);
    assert.ok(codsInd.every((c) => c.usos_maximos === 1));
    assert.ok(!(await actualizarCampania(indId, { usos_por_codigo: 5 })).ok, "pasar a varios usos por código se rechaza");

    console.log("OK — Empresas B8: código común de 10 experiencias (una sola generación aunque se pida dos veces a la vez, antes del pago, " +
      "sin canje hasta pagada + inicio, vence a los 60 días), 12 canjes simultáneos → 10, un canje = un simulador (servidor y RPC), " +
      "reprogramar sin cambiar cantidad ni consumir, cancelado liberado fuera de métricas/listado/informe y reutilizable, " +
      "configuración que multiplicaba rechazada, tipo y cupo fijos al generar, individuales como antes.");
  } finally {
    await limpiar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
