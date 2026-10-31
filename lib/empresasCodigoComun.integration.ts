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

// (B8) Código común por pack; el cupo son EXPERIENCIAS: cada simulador reservado
// consume una. Por la ruta real del servidor (crearCampania → generarCodigos →
// reservarConCodigo → RPC v2), con la modalidad comercial VIGENTE (v2_10,
// experiencias de 20 minutos):
//   · un código común de 10, de 25 y de una cantidad personalizada;
//   · se genera una sola vez (aunque se pida dos veces a la vez) y antes del pago,
//     sin fecha de inicio ni vencimiento; no canjea hasta pagada + inicio; la
//     fecha de inicio de un pack se carga recién pagado, y los 60 días corren desde
//     ella;
//   · una reserva de 2 simuladores consume 2; más simuladores que el cupo
//     restante se rechaza sin consumir;
//   · reservas simultáneas: 12 de un simulador sobre 10 → 10; mezcla de 4 y de 1
//     sobre 10 → nunca más de 10, y lo consumido = lo reservado;
//   · reprogramar no cambia la cantidad ni consume;
//   · cancelar con «liberar» devuelve exactamente lo de esa reserva, una sola vez,
//     también con dos cancelaciones simultáneas; sin «liberar» no devuelve, y un
//     reintento con «liberar» tampoco;
//   · métricas, listado e informe cuentan experiencias, sin las canceladas;
//   · la configuración que multiplicaba el cupo se rechaza; individuales como antes.
// Datos temporales con marca __TEST_B8_, que se eliminan al terminar.
//   node scripts/pruebas/correr-mutantes.mjs lib/empresasCodigoComun.integration.ts

const MARCA = `__TEST_B8_${Date.now()}`;
const SIMS = ["Ferrari", "McLaren", "Red Bull", "Alpine"];
const BENEF = { nombre: "ZZTEST", apellido: "B8", telefono: "000", email: "zz@test.b8" };
type Ok<T> = { ok: true; data: T };

/** Días hábiles (lunes a viernes) desde hoy + 7, dentro de la vigencia de 60 días. */
function diasHabiles(hoy: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 7; out.length < n && i < 40; i++) {
    const f = sumarDias(hoy, i);
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(f);
  }
  return out;
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

async function codigoDe(id: string) {
  const { data } = await supabaseAdmin.from("empresa_codigos").select("*").eq("campania_id", id);
  return data ?? [];
}
const usosActuales = async (id: string) => Number((await codigoDe(id))[0].usos_actuales);
async function sumaExperiencias(id: string, soloVigentes = true) {
  const { data } = await supabaseAdmin.from("empresa_codigo_usos").select("estado, experiencias").eq("campania_id", id);
  return (data ?? []).filter((u) => !soloVigentes || u.estado !== "cancelado").reduce((s, u) => s + Number(u.experiencias), 0);
}

async function main() {
  const hoy = hoyEnSim();
  const cat = await catalogoEmpresasVigente();
  assert.equal(cat.modalidad, "v2_10", "la suite corre con la modalidad vigente v2_10 (experiencias de 20 minutos)");
  assert.ok(cat.duraciones.includes(20), "v2_10 vende 20 minutos");
  const [D1, D2, D3] = diasHabiles(hoy, 3);
  const base = { modalidad: "unica", duracion_minutos: 20, precio_neto: 150000, iva_porcentaje: 21, modalidad_vista: cat.modalidad };

  /** Pack común creado, generado y activado hoy (pagado + inicio hoy). */
  async function packActivo(nombre: string, cantidad: number) {
    const r = await crearCampania({ ...base, empresa: MARCA, nombre_campania: nombre, cantidad_contratada: cantidad, usos_por_codigo: 1, codigo_comun: true }, "admin");
    assert.ok(r.ok, "crear " + nombre + ": " + (r.ok ? "" : r.error));
    const id = (r.data as { id: string }).id;
    assert.ok((await generarCodigos(id)).ok);
    assert.ok((await marcarPagada(id, hoy, "transferencia")).ok);
    assert.ok((await actualizarCampania(id, { fecha_inicio: hoy })).ok);
    return { id, codigo: (await codigoDe(id))[0].codigo as string };
  }

  try {
    // ── Configuración ────────────────────────────────────────────────────────
    const mult = await crearCampania({ ...base, empresa: MARCA, cantidad_contratada: 10, usos_por_codigo: 10, codigo_comun: false }, "admin");
    assert.ok(!mult.ok && mult.status === 400 && /Código común/.test(mult.error), "individuales con 10 usos (cupo ×10) se rechaza");
    const conInicio = await crearCampania({ ...base, empresa: MARCA, cantidad_contratada: 10, usos_por_codigo: 1, codigo_comun: true, fecha_inicio: hoy }, "admin");
    assert.ok(!conInicio.ok && conInicio.status === 400 && /entrega/.test(conInicio.error), "un pack no nace con fecha de inicio");

    const res = await crearCampania({ ...base, empresa: MARCA, nombre_campania: "Pack 10", cantidad_contratada: 10, usos_por_codigo: 1, codigo_comun: true }, "admin");
    assert.ok(res.ok, "crear pack común: " + (res.ok ? "" : res.error));
    const pack = res.data as { id: string; codigo_comun: boolean };
    assert.equal(pack.codigo_comun, true);

    // ── Generación: una sola vez, antes del pago, sin fechas ────────────────────
    const [g1, g2] = await Promise.all([generarCodigos(pack.id), generarCodigos(pack.id)]);
    assert.equal([g1, g2].filter((g) => g.ok).length, 1, "dos «Generar» a la vez: una sola tanda");
    assert.ok([g1, g2].some((g) => !g.ok && g.status === 409));
    const cods = await codigoDe(pack.id);
    assert.equal(cods.length, 1, "un solo código");
    assert.equal(cods[0].usos_maximos, 10, "con 10 usos: el cupo del pack");
    const CODIGO = cods[0].codigo as string;
    const { data: trasGenerar } = await supabaseAdmin.from("empresa_campanias").select("fecha_inicio, fecha_vencimiento, estado_pago").eq("id", pack.id).single();
    assert.deepEqual([trasGenerar!.fecha_inicio, trasGenerar!.fecha_vencimiento, trasGenerar!.estado_pago], [null, null, "pendiente"],
      "generar no fija inicio ni vencimiento");
    assert.ok(!(await validarCodigo(CODIGO)).ok, "sin pagar no canjea");
    assert.ok(!(await reservarConCodigo(CODIGO, BENEF, D1, "10:00", ["Ferrari"], `${MARCA}-antes`)).ok);
    const inicioSinPago = await actualizarCampania(pack.id, { fecha_inicio: hoy });
    assert.ok(!inicioSinPago.ok && inicioSinPago.status === 400, "la fecha de inicio de un pack no se carga sin el pago");

    // Fijos al generar: el tipo de código y el cupo.
    const e1 = await actualizarCampania(pack.id, { cantidad_contratada: 25 });
    assert.ok(!e1.ok && e1.status === 409, "no se cambia el cupo de un código común ya generado");
    const e2 = await actualizarCampania(pack.id, { codigo_comun: false });
    assert.ok(!e2.ok && e2.status === 409, "no se cambia el tipo de código ya generado");

    // ── Pagado (100%) pero sin inicio: sigue bloqueado ─────────────────────────
    assert.ok((await marcarPagada(pack.id, hoy, "transferencia")).ok);
    assert.ok(!(await validarCodigo(CODIGO)).ok, "pagado sin fecha de inicio (entrega) no canjea");
    // Activación al entregar: inicio = hoy → vence a los 60 días desde la activación.
    const act = await actualizarCampania(pack.id, { fecha_inicio: hoy });
    assert.ok(act.ok);
    assert.equal((act.data as { fecha_vencimiento: string }).fecha_vencimiento, sumarDias(hoy, 60));
    assert.ok((await validarCodigo(CODIGO)).ok, "pagado y con inicio: canjea");

    // ── Varios simuladores: consumen esa cantidad ────────────────────────────────
    const dos = await reservarConCodigo(CODIGO, BENEF, D1, "16:00", ["Ferrari", "McLaren"], `${MARCA}-dos`);
    assert.ok(dos.ok, "2 simuladores: " + (dos.ok ? "" : dos.error));
    const ridDos = (dos as Ok<{ reserva_id: number }>).data.reserva_id;
    assert.equal(await usosActuales(pack.id), 2, "2 simuladores = 2 experiencias");
    const { data: usoDos } = await supabaseAdmin.from("empresa_codigo_usos").select("experiencias").eq("reserva_id", ridDos).single();
    assert.equal(usoDos!.experiencias, 2);

    // ── Reservas simultáneas, mezcla de 4 y de 1 sobre 8 restantes ───────────────
    const mezcla = [
      ...["10:00", "10:30", "11:00"].map((h) => ({ h, sims: SIMS })),
      ...SIMS.map((s) => ({ h: "11:30", sims: [s] })),
    ];
    const rMezcla = await Promise.all(mezcla.map((m, i) => reservarConCodigo(CODIGO, BENEF, D1, m.h, m.sims, `${MARCA}-m${i}`)));
    const aceptadas = mezcla.filter((_, i) => rMezcla[i].ok).reduce((s, m) => s + m.sims.length, 0);
    const trasMezcla = await usosActuales(pack.id);
    assert.ok(trasMezcla <= 10, `nunca más que el cupo (${trasMezcla})`);
    assert.equal(trasMezcla, 2 + aceptadas, "lo consumido = lo reservado");
    assert.equal(await sumaExperiencias(pack.id), trasMezcla, "usos del código = experiencias de los canjes");
    assert.ok(rMezcla.filter((r) => !r.ok).every((r) => !r.ok && r.status === 409));
    const restantes = 10 - trasMezcla;
    const demasiados = await reservarConCodigo(CODIGO, BENEF, D2, "17:00", SIMS.slice(0, restantes + 1), `${MARCA}-demasiados`);
    assert.ok(!demasiados.ok && demasiados.status === 409, "más simuladores que el cupo restante se rechaza");
    assert.equal(await usosActuales(pack.id), trasMezcla, "sin consumir");

    // ── Reprogramar: misma cantidad, sin consumir ──────────────────────────────
    const r1 = await reprogramarReservaEmpresa(ridDos, D2, "15:00", ["Ferrari"]);
    assert.ok(!r1.ok && r1.status === 400, "reprogramar una de 2 con 1 simulador se rechaza");
    assert.ok((await reprogramarReservaEmpresa(ridDos, D2, "15:00", ["Red Bull", "Alpine"])).ok, "reprogramar con 2");
    assert.equal(await usosActuales(pack.id), trasMezcla, "reprogramar no consume");

    // ── Cancelar: devuelve lo de esa reserva, una sola vez ────────────────────────
    assert.ok((await cancelarReservaEmpresa(ridDos, true)).ok);
    assert.equal(await usosActuales(pack.id), trasMezcla - 2, "vuelven las 2 de esa reserva");
    assert.ok((await cancelarReservaEmpresa(ridDos, true)).ok, "reintento");
    assert.equal(await usosActuales(pack.id), trasMezcla - 2, "el reintento no vuelve a devolver");
    assert.equal(await sumaExperiencias(pack.id), trasMezcla - 2);

    // ── Pack de 10 aparte: 12 reservas simultáneas de un simulador → 10 ──────────
    const p2 = await packActivo("Pack 10 concurrencia", 10);
    const intentos = ["10:00", "10:30", "11:00"].flatMap((h) => SIMS.map((s) => ({ h, s })));
    const resultados = await Promise.all(intentos.map(({ h, s }, i) => reservarConCodigo(p2.codigo, BENEF, D3, h, [s], `${MARCA}-c${i}`)));
    const okas = resultados.filter((r) => r.ok) as Array<Ok<{ reserva_id: number }>>;
    assert.equal(okas.length, 10, `12 reservas a la vez: ${okas.length} aceptadas (esperado 10)`);
    const [cod2] = await codigoDe(p2.id);
    assert.deepEqual([cod2.usos_actuales, cod2.estado], [10, "utilizado"]);
    // Dos cancelaciones simultáneas de la misma reserva: se devuelve una vez.
    const [k1, k2] = await Promise.all([cancelarReservaEmpresa(okas[0].data.reserva_id, true), cancelarReservaEmpresa(okas[0].data.reserva_id, true)]);
    assert.ok(k1.ok && k2.ok);
    assert.equal(await usosActuales(p2.id), 9, "dos cancelaciones a la vez devuelven una sola vez");
    // Sin «liberar» no devuelve; un reintento con «liberar» tampoco.
    assert.ok((await cancelarReservaEmpresa(okas[1].data.reserva_id, false)).ok);
    assert.ok((await cancelarReservaEmpresa(okas[1].data.reserva_id, true)).ok);
    assert.equal(await usosActuales(p2.id), 9, "la liberación se decide en la cancelación efectiva");
    const m2 = ((await getCampania(p2.id)) as Ok<{ metricas: Record<string, number> }>).data.metricas;
    assert.deepEqual([m2.turnos_contratados, m2.turnos_utilizados, m2.turnos_restantes, m2.pctUtilizacion, m2.generados], [10, 9, 1, 90, 1]);
    assert.equal(m2.turnos_retenidos, 1, "la cancelada sin liberar sigue usada y figura retenida");
    const lista = (await listarCampanias({ q: MARCA })) as Ok<Array<{ id: string; generados: number; utilizados: number }>>;
    const fila = lista.data.find((c) => c.id === p2.id)!;
    assert.deepEqual([fila.generados, fila.utilizados], [1, 9], "listado: 1 código, 9 experiencias");
    const ev = ((await datosInforme(p2.id, "parcial")) as Ok<{ evolucion: Array<{ canjes: number }> }>).data.evolucion;
    assert.equal(ev.reduce((a, e) => a + e.canjes, 0), 9, "informe: 9 experiencias, sin la cancelada liberada");
    assert.ok((await reservarConCodigo(p2.codigo, BENEF, D3, "12:00", ["Ferrari"], `${MARCA}-vuelve`)).ok, "la liberada se vuelve a usar");
    assert.equal(await usosActuales(p2.id), 10);

    // Métricas del pack de la mezcla: experiencias, no códigos.
    const m1 = ((await getCampania(pack.id)) as Ok<{ metricas: Record<string, number> }>).data.metricas;
    assert.deepEqual([m1.turnos_contratados, m1.turnos_utilizados, m1.turnos_restantes], [10, trasMezcla - 2, 10 - (trasMezcla - 2)]);

    // ── 25 y personalizado: un código con ese cupo ──────────────────────────────
    for (const n of [25, 37]) {
      const p = await packActivo(`Pack ${n}`, n);
      const [c] = await codigoDe(p.id);
      assert.deepEqual([(await codigoDe(p.id)).length, c.usos_maximos], [1, n], `pack de ${n}: un código con ${n} usos`);
      const m = ((await getCampania(p.id)) as Ok<{ metricas: Record<string, number> }>).data.metricas;
      assert.deepEqual([m.turnos_contratados, m.minutos_contratados], [n, n * 20]);
    }

    // ── Individuales: siguen como antes ────────────────────────────────────────
    const ind = await crearCampania({ ...base, empresa: MARCA, nombre_campania: "Individuales", cantidad_contratada: 3, usos_por_codigo: 1, fecha_inicio: hoy }, "admin");
    assert.ok(ind.ok, "individuales con inicio al crear, como antes");
    const indId = (ind.data as { id: string }).id;
    const gAntes = await generarCodigos(indId);
    assert.ok(!gAntes.ok && gAntes.status === 409, "individuales: sin pagar no se generan (como antes)");
    assert.ok((await marcarPagada(indId, hoy, "transferencia")).ok);
    assert.ok((await generarCodigos(indId)).ok);
    const codsInd = await codigoDe(indId);
    assert.equal(codsInd.length, 3);
    assert.ok(codsInd.every((c) => c.usos_maximos === 1));
    const dosInd = await reservarConCodigo(codsInd[0].codigo, BENEF, D2, "18:00", ["Ferrari", "McLaren"], `${MARCA}-ind-dos`);
    assert.ok(!dosInd.ok && dosInd.status === 409, "un código individual (1 experiencia) no reserva 2 simuladores");
    assert.ok((await reservarConCodigo(codsInd[0].codigo, BENEF, D2, "18:00", ["Ferrari"], `${MARCA}-ind-uno`)).ok);
    assert.ok(!(await actualizarCampania(indId, { usos_por_codigo: 5 })).ok, "pasar a varios usos por código se rechaza");

    console.log("OK — Empresas B8: código común de 10, 25 y 37 experiencias (una sola generación, antes del pago y sin fechas; " +
      "bloqueado hasta pagada + inicio; inicio del pack solo pagado; vence a los 60 días del inicio), 2 simuladores = 2 experiencias, " +
      "más que el cupo rechazado sin consumir, simultáneas sin pasar el cupo (12×1 → 10; mezcla 4/1 ≤ 10 y consumido = reservado), " +
      "reprogramar sin cambiar cantidad ni consumir, cancelar devuelve lo de esa reserva una sola vez (reintento y simultánea), " +
      "sin «liberar» no devuelve, métricas/listado/informe por experiencia, configuración que multiplicaba rechazada, individuales como antes.");
  } finally {
    await limpiar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
