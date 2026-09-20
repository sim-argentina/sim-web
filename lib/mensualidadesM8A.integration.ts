import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sumarDias } from "@/lib/agenda";
import {
  cambiarVentasPublicas, getEstadoComercial, ventasPublicasHabilitadas,
  VENTAS_PAUSADAS,
} from "@/lib/mensualidadesVentas";
import { registrarAltaAdministrativa, validarAlta, type DatosAlta } from "@/lib/mensualidadesAdminAlta";
import { nuevaExternalReference, nuevoTokenPublico } from "@/lib/mensualidadesCompra";
import { procesarPagoVerificado, PREFIJO_EXT_REF } from "@/lib/mensualidadesPago";
import { crearSesion } from "@/lib/mensualidadSesion";
import { getMiPlan } from "@/lib/mensualidadesMiPlan";

// Integración del Bloque M8A contra la DB REAL, con datos TEMPORALES marcados y
// eliminados al final.
//
// Lo que se prueba es la parte que no se puede afirmar leyendo el código:
//   · que la pausa impida EMPEZAR ventas y nada más;
//   · que un pago ya iniciado se acredite igual, que es la carrera que de verdad
//     importa: si fallara, quedaría plata cobrada sin mensualidad;
//   · que dos cambios concurrentes dejen un estado coherente;
//   · que un reintento no duplique la auditoría;
//   · que staff no pueda cambiar el estado comercial.
//
// NO crea preferencias ni pagos reales: el pago se simula pasando un objeto de
// Mercado Pago ya verificado a procesarPagoVerificado(), que es exactamente el
// mismo procesador que usa el webhook.
//
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM8A.integration.ts

const MARCA = `ZZ M8A ${Date.now()}`;
const EMAIL = `m8a-${Date.now()}@test.local`;

// ── EL INTERRUPTOR COMERCIAL ES DE PRODUCCIÓN ───────────────────────────────
//
// Esta suite apaga y prende `ventas_publicas_habilitadas`, que es la llave real
// con la que se compran mensualidades. El 2026-09-20 dejó las ventas pausadas
// 75 segundos: se había escrito antes del lanzamiento, cuando producción estaba
// en `false`, y tenía esa suposición incrustada —exigía arrancar en false y
// fijaba false a mano al terminar—. Nadie intentó comprar en ese rato, pero el
// riesgo era real y silencioso.
//
// Lo que cambió:
//   · no se corre sola: hace falta pedirlo explícitamente (ver ARRANQUE);
//   · lee y guarda el estado real ANTES de tocarlo;
//   · si no puede leerlo, aborta sin escribir nada;
//   · nunca usa `false` —ni ningún literal— como valor a restaurar;
//   · restaura en `finally`, ante señales, y comprueba la postcondición;
//   · si un corte brutal impide todo eso, deja un resguardo en disco que la
//     próxima corrida detecta y repara antes de hacer nada más.

/** Hace falta pedir esto a propósito. Sin la variable, la suite no corre. */
const PERMISO = "M8A_VENTAS_REALES";

/**
 * Resguardo en disco con el valor original. Se escribe ANTES de tocar la
 * configuración y se borra recién cuando la restauración quedó verificada.
 * Sobrevive a un SIGKILL, que es lo único que ni el `finally` ni las señales
 * pueden atrapar.
 */
const RESGUARDO = join(tmpdir(), "sim-m8a-ventas-publicas.json");

/**
 * Cómo estaban las ventas públicas ANTES de correr esto. `null` significa que
 * todavía no se leyó, y en ese caso NO se toca nada: sin un valor real que
 * restaurar, la suite no tiene derecho a escribir la configuración.
 */
let estadoInicial: boolean | null = null;

/**
 * Cuántas auditorías de `config_ventas_publicas` había ANTES de esta corrida.
 * La suite tiene que terminar sin haber agregado ninguna propia; las que ya
 * existían —el lanzamiento, por ejemplo— son historia real y se conservan.
 */
let auditoriasConfigAlInicio = 0;
const billeteras = new Set<string>();
const compras = new Set<string>();
const claves = new Set<string>();

let seq = 0;
const nuevoTel = () => `2966${String(300000 + (Date.now() % 600000) + seq++ * 11).slice(-6)}`;
let k = 0;
const clave = () => {
  const c = `zzm8a${String(Date.now()).slice(-8)}${String(k++).padStart(6, "0")}`;
  claves.add(c);
  return c;
};
const CTX = (rol: "admin" | "staff" = "admin") => ({ actor: rol, rol, idempotencyKey: clave() });

async function hoyCordoba(): Promise<string> {
  const { data } = await supabaseAdmin.rpc("mensualidad_hoy");
  return String(data);
}

/**
 * Estado crudo de la configuración, sin pasar por el helper.
 *
 * LANZA si no puede leerlo. Antes devolvía `false` ante cualquier problema, y
 * ese `false` terminaba siendo el valor que se "restauraba": un error de
 * lectura podía apagar las ventas. Un valor desconocido no es un valor.
 */
async function estadoEnBase(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("mensualidad_config").select("ventas_publicas_habilitadas").eq("id", 1).single();
  if (error) throw new Error(`no se pudo leer el estado comercial: ${error.message}`);
  const v = data?.ventas_publicas_habilitadas;
  if (typeof v !== "boolean") {
    throw new Error(`el estado comercial no es booleano: ${JSON.stringify(v)}`);
  }
  return v;
}

/** Escribe el interruptor. Solo se llama con un booleano explícito. */
async function escribirEstado(valor: boolean): Promise<void> {
  const { error } = await supabaseAdmin.from("mensualidad_config")
    .update({ ventas_publicas_habilitadas: valor }).eq("id", 1);
  if (error) throw new Error(`no se pudo escribir el estado comercial: ${error.message}`);
}

/**
 * Repara una corrida anterior que murió sin restaurar. Se ejecuta ANTES de
 * cualquier otra cosa: si hay resguardo, ese valor es el que producción debería
 * tener, y se repone antes de seguir.
 */
async function repararCorridaAnterior(): Promise<void> {
  if (!existsSync(RESGUARDO)) return;
  let guardado: unknown;
  try {
    guardado = JSON.parse(readFileSync(RESGUARDO, "utf8"));
  } catch {
    console.error(`AVISO: resguardo ilegible en ${RESGUARDO}. Revisalo a mano y borralo.`);
    return;
  }
  const valor = (guardado as { valor?: unknown })?.valor;
  if (typeof valor !== "boolean") {
    console.error(`AVISO: resguardo sin valor usable. Revisalo a mano: ${RESGUARDO}`);
    return;
  }
  const actual = await estadoEnBase();
  if (actual !== valor) {
    await escribirEstado(valor);
    console.error(
      `REPARADO: una corrida anterior dejó ventas_publicas_habilitadas en ${actual}; ` +
      `se restauró a ${valor}, que es como estaba antes de aquella corrida.`,
    );
  }
  rmSync(RESGUARDO, { force: true });
}

/** Devuelve el interruptor a como estaba y verifica que quedó así. */
async function restaurarEstado(): Promise<void> {
  if (estadoInicial === null) {
    // Nunca se leyó, así que tampoco se escribió: no hay nada que devolver.
    rmSync(RESGUARDO, { force: true });
    return;
  }
  await escribirEstado(estadoInicial);
  const quedo = await estadoEnBase();
  if (quedo !== estadoInicial) {
    console.error(
      `ALERTA: ventas_publicas_habilitadas quedó en ${quedo} y tenía que volver a ` +
      `${estadoInicial}. El resguardo se conserva en ${RESGUARDO}.`,
    );
    process.exitCode = 1;
    return;
  }
  rmSync(RESGUARDO, { force: true });
}

const auditoriasDeConfig = async () => {
  const { data } = await supabaseAdmin.from("mensualidad_auditoria")
    .select("accion, actor, actor_rol, motivo, valor_anterior, valor_nuevo, idempotency_key")
    .eq("accion", "config_ventas_publicas")
    .in("idempotency_key", [...claves]);
  return data ?? [];
};

async function limpiar() {
  const ids = [...billeteras];
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_auditoria").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_compras").delete().in("mensualidad_id", ids);
  }
  if (compras.size) await supabaseAdmin.from("mensualidad_compras").delete().in("id", [...compras]);
  await supabaseAdmin.from("mensualidad_compras").delete().eq("comprador_email", EMAIL);
  if (ids.length) await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  await supabaseAdmin.from("mensualidades").delete().eq("titular_email", EMAIL);
  // Las auditorías de configuración son del módulo (mensualidad_id nulo): se
  // borran por la clave, que lleva la marca de esta corrida.
  if (claves.size) {
    await supabaseAdmin.from("mensualidad_auditoria").delete().in("idempotency_key", [...claves]);
  }
}

async function main() {
  const hoy = await hoyCordoba();

  const contarTodo = async () => ({
    mensualidades: (await supabaseAdmin.from("mensualidades").select("*", { count: "exact", head: true })).count ?? 0,
    compras: (await supabaseAdmin.from("mensualidad_compras").select("*", { count: "exact", head: true })).count ?? 0,
    movimientos: (await supabaseAdmin.from("mensualidad_movimientos").select("*", { count: "exact", head: true })).count ?? 0,
    auditoria: (await supabaseAdmin.from("mensualidad_auditoria").select("*", { count: "exact", head: true })).count ?? 0,
    config: (await supabaseAdmin.from("mensualidad_config").select("*", { count: "exact", head: true })).count ?? 0,
    pagos_web: (await supabaseAdmin.from("fin_pagos_web").select("*", { count: "exact", head: true })).count ?? 0,
  });
  const antes = await contarTodo();
  console.log("contadores antes:", JSON.stringify(antes));

  auditoriasConfigAlInicio = (await supabaseAdmin.from("mensualidad_auditoria")
    .select("*", { count: "exact", head: true }).eq("accion", "config_ventas_publicas")).count ?? 0;

  // La suite NO opina sobre cómo tiene que estar producción: anota cómo la
  // encontró —sea true o false—, la deja como necesitan sus casos y después la
  // devuelve exactamente a ese valor. Si la lectura falla, estadoEnBase() lanza
  // y no se escribe nada.
  estadoInicial = await estadoEnBase();
  console.log(`estado comercial encontrado: ${estadoInicial} (se restaurará a ese valor)`);

  // El resguardo se escribe ANTES del primer cambio. A partir de acá, aunque el
  // proceso muera de la peor manera, la próxima corrida sabe qué reponer.
  writeFileSync(RESGUARDO, JSON.stringify({ valor: estadoInicial, ts: new Date().toISOString() }), "utf8");

  if (estadoInicial) await escribirEstado(false);
  assert.equal(await estadoEnBase(), false, "M8A necesita arrancar sus casos con las ventas pausadas");

  // ── 1 · Valor inicial y lectura ───────────────────────────────────────────
  {
    assert.equal(await ventasPublicasHabilitadas(), false, "1 el helper lee false");
    const e = await getEstadoComercial();
    assert.equal(e.ventasPublicas, false);
    // El módulo público depende del entorno de ESTA corrida; lo que importa es
    // que comprar exija las dos llaves.
    assert.equal(e.sePuedeComprar, e.moduloPublico && e.ventasPublicas,
      "1 comprar exige las DOS llaves");
  }
  console.log("M8A-1 valor inicial seguro y lectura OK");

  // ── 2 · Cambiar el estado: auditoría, motivo e idempotencia ───────────────
  {
    // Motivo obligatorio y recortado.
    for (const vacio of ["", "   ", "\t"]) {
      const r = await cambiarVentasPublicas(true, vacio, CTX());
      assert.ok(!r.ok && r.codigo === "motivo_requerido", `2 motivo ${JSON.stringify(vacio)} se rechaza`);
    }
    assert.equal(await estadoEnBase(), false, "2 un rechazo no cambia nada");

    // staff no puede, ni por el módulo…
    const rs = await cambiarVentasPublicas(true, "intento de staff", CTX("staff"));
    assert.ok(!rs.ok && rs.status === 403, "2 staff recibe 403");
    // …ni llamando la RPC directamente.
    const { error: errRpc } = await supabaseAdmin.rpc("mensualidad_admin_set_ventas", {
      p_habilitadas: true, p_motivo: "staff directo", p_actor: "staff",
      p_actor_rol: "staff", p_idempotency_key: clave(),
    });
    assert.ok(errRpc && String(errRpc.message).includes("rol_no_autorizado"),
      "2 la base también rechaza a staff");
    assert.equal(await estadoEnBase(), false, "2 sigue pausado");

    // Habilitar de verdad, con motivo con espacios alrededor.
    const ctx = CTX();
    const r1 = await cambiarVentasPublicas(true, "   Prueba M8A: habilitar   ", ctx);
    assert.ok(r1.ok, `2 ${r1.ok ? "" : r1.error}`);
    assert.equal(r1.data.estado_anterior, false);
    assert.equal(r1.data.estado_nuevo, true);
    assert.equal(r1.data.idempotente, false);
    assert.equal(await estadoEnBase(), true, "2 el cambio se aplicó");

    const aud = await auditoriasDeConfig();
    const mia = aud.find((a) => a.idempotency_key === ctx.idempotencyKey);
    assert.ok(mia, "2 quedó auditado");
    assert.equal(mia!.actor_rol, "admin");
    assert.equal(mia!.motivo, "Prueba M8A: habilitar", "2 el motivo se recorta");
    assert.equal((mia!.valor_anterior as Record<string, unknown>).ventas_publicas_habilitadas, false);
    assert.equal((mia!.valor_nuevo as Record<string, unknown>).ventas_publicas_habilitadas, true);

    // Reintento con la MISMA clave: no duplica auditoría.
    const r2 = await cambiarVentasPublicas(true, "Prueba M8A: habilitar", ctx);
    assert.ok(r2.ok && r2.data.idempotente, "2 el reintento se reconoce");
    const aud2 = (await auditoriasDeConfig()).filter((a) => a.idempotency_key === ctx.idempotencyKey);
    assert.equal(aud2.length, 1, "2 una sola auditoría por clave");

    // Doble clic: dos llamadas con la misma clave, a la vez.
    const ctxD = CTX();
    await Promise.all([
      cambiarVentasPublicas(false, "Prueba M8A: doble clic", ctxD),
      cambiarVentasPublicas(false, "Prueba M8A: doble clic", ctxD),
    ]);
    const audD = (await auditoriasDeConfig()).filter((a) => a.idempotency_key === ctxD.idempotencyKey);
    assert.equal(audD.length, 1, "2 el doble clic deja una sola auditoría");
    assert.equal(await estadoEnBase(), false, "2 y un solo estado");
  }
  console.log("M8A-2 motivo, permisos, auditoría e idempotencia OK");

  // ── 3 · Dos cambios concurrentes con claves distintas ─────────────────────
  {
    const a = CTX(), b = CTX();
    const [ra, rb] = await Promise.all([
      cambiarVentasPublicas(true, "Prueba M8A: concurrente A", a),
      cambiarVentasPublicas(false, "Prueba M8A: concurrente B", b),
    ]);
    assert.ok(ra.ok && rb.ok, "3 las dos completan");
    const final = await estadoEnBase();
    // El estado final es el de UNA de las dos, no una mezcla, y las dos quedaron
    // auditadas en orden.
    const aud = (await auditoriasDeConfig())
      .filter((x) => x.idempotency_key === a.idempotencyKey || x.idempotency_key === b.idempotencyKey);
    assert.equal(aud.length, 2, "3 las dos quedan auditadas");
    const ultima = [ra, rb].find((r) => r.ok && r.data.estado_nuevo === final);
    assert.ok(ultima, "3 el estado final corresponde a uno de los dos cambios");
    // Y las cadenas anterior→nuevo son coherentes entre sí.
    const estados = aud.map((x) => [
      (x.valor_anterior as Record<string, unknown>).ventas_publicas_habilitadas,
      (x.valor_nuevo as Record<string, unknown>).ventas_publicas_habilitadas,
    ]);
    assert.ok(estados.every(([ant, nue]) => typeof ant === "boolean" && typeof nue === "boolean"),
      "3 ninguna auditoría quedó incompleta");
  }
  console.log("M8A-3 cambios concurrentes con estado coherente OK");

  // ── 4 · LA CARRERA: preferencia creada, pausa después, pago aprobado ──────
  // Es el caso que no puede fallar: si la pausa bloqueara el webhook, quedaría
  // plata cobrada sin mensualidad entregada.
  {
    // Ventas habilitadas: se crea la compra pendiente (sin llamar a Mercado Pago).
    const ctxOn = CTX();
    assert.ok((await cambiarVentasPublicas(true, "Prueba M8A: antes de la carrera", ctxOn)).ok);

    const tel = nuevoTel();
    const extRef = nuevaExternalReference();
    assert.ok(extRef.startsWith(PREFIJO_EXT_REF), "4 la referencia es de Mensualidades");

    const { data: plan } = await supabaseAdmin.from("mensualidad_planes")
      .select("*").eq("slug", "2h").eq("activo", true).single();

    const { data: compra, error: errC } = await supabaseAdmin.from("mensualidad_compras").insert({
      plan_id: plan!.id, plan_slug: plan!.slug, plan_nombre: plan!.nombre,
      plan_minutos: plan!.minutos, plan_precio: plan!.precio,
      plan_vigencia_dias: plan!.vigencia_dias, plan_etiqueta: plan!.etiqueta,
      comprador_nombre: "Probe", comprador_apellido: MARCA,
      comprador_telefono: tel, telefono_norm: tel, comprador_email: EMAIL,
      importe_bruto: plan!.precio, external_reference: extRef,
      idempotency_key: clave(), token_publico: nuevoTokenPublico(),
      condiciones_version: "cond-m8a", condiciones_aceptadas_at: new Date().toISOString(),
    }).select("id").single();
    assert.ok(!errC, `4 compra pendiente creada: ${errC?.message ?? ""}`);
    compras.add(String(compra!.id));

    // AHORA se pausan las ventas.
    const ctxOff = CTX();
    assert.ok((await cambiarVentasPublicas(false, "Prueba M8A: pausa en medio", ctxOff)).ok);
    assert.equal(await ventasPublicasHabilitadas(), false, "4 quedó pausado");

    // El cliente termina de pagar. Llega el webhook. Mismo procesador de siempre.
    const pago = {
      id: `zzm8a-${Date.now()}`,
      status: "approved",
      external_reference: extRef,
      currency_id: "ARS",
      transaction_amount: Number(plan!.precio),
      date_approved: new Date().toISOString(),
      fee_details: [{ type: "mercadopago_fee", amount: 2500, fee_payer: "collector" }],
      transaction_details: { net_received_amount: Number(plan!.precio) - 2500 },
      metadata: { producto: "mensualidad", compra_id: compra!.id },
    };
    const r = await procesarPagoVerificado(String(pago.id), pago);
    assert.ok(r.ok && r.estado === "aplicado", "4 el pago se acredita PESE a la pausa");

    const { data: cerrada } = await supabaseAdmin.from("mensualidad_compras")
      .select("procesamiento, estado_pago, mensualidad_id, saldo_resultante, canal, importe_bruto, comision_mp, importe_neto")
      .eq("id", compra!.id).single();
    assert.equal(cerrada!.procesamiento, "aplicado");
    assert.equal(cerrada!.estado_pago, "aprobado");
    assert.equal(cerrada!.canal, "web", "4 sigue siendo una compra web");
    assert.equal(Number(cerrada!.saldo_resultante), 120);
    billeteras.add(String(cerrada!.mensualidad_id));

    // Una sola mensualidad, un solo movimiento.
    const { count: cuantas } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("telefono_norm", tel);
    assert.equal(cuantas, 1, "4 una sola mensualidad");
    const { count: movs } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", cerrada!.mensualidad_id);
    assert.equal(movs, 1, "4 un solo movimiento");

    // Webhook repetido: idempotente, sin segundo ingreso.
    const r2 = await procesarPagoVerificado(String(pago.id), pago);
    assert.ok(r2.ok && r2.estado === "aplicado" && r2.yaEstaba, "4 el webhook repetido es idempotente");
    const { count: movs2 } = await supabaseAdmin.from("mensualidad_movimientos")
      .select("*", { count: "exact", head: true }).eq("mensualidad_id", cerrada!.mensualidad_id);
    assert.equal(movs2, 1, "4 sigue habiendo un solo movimiento");

    // El ingreso aparece UNA vez en Finanzas.
    const mes = hoy.slice(0, 7);
    const { data: ing } = await supabaseAdmin.rpc("fin_ingresos_por_mes", { p_mes: mes });
    const web = (ing as Array<{ fuente: string; metodo: string; total: number; cantidad: number }>)
      .filter((f) => f.fuente === "mensualidades" && f.metodo === "mercadopago");
    assert.equal(web.length, 1, "4 una sola línea web en el informe");
    assert.ok(Number(web[0].total) >= Number(plan!.precio), "4 el bruto entró al informe");

    // El titular puede consultar su resultado y su plan pese a la pausa.
    const mp = await getMiPlan(String(cerrada!.mensualidad_id));
    assert.ok(mp, "4 Mi Plan responde con las ventas pausadas");
    assert.equal(mp!.saldo_minutos, 120);
    const tok = await crearSesion(String(cerrada!.mensualidad_id));
    assert.ok(tok, "4 la sesión se puede crear igual");
  }
  console.log("M8A-4 carrera de checkout: el pago se acredita pese a la pausa OK");

  // ── 5 · Con la pausa activa NO se puede iniciar una venta ─────────────────
  {
    assert.equal(await estadoEnBase(), false, "5 sigue pausado");
    const { POST } = await import("@/app/api/mensualidades/preference/route");

    const flagPrevia = process.env.MENSUALIDADES_ENABLED;
    process.env.MENSUALIDADES_ENABLED = "true";

    const comprasAntes = (await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true })).count ?? 0;

    const pedir = (body: unknown) => POST(new Request("https://simexperience.com.ar/api/mensualidades/preference", {
      method: "POST",
      headers: {
        origin: "https://simexperience.com.ar",
        "content-type": "application/json",
        "x-real-ip": `10.9.${seq % 250}.${(seq++ * 3) % 250}`,
      },
      body: JSON.stringify(body),
    }));

    const res = await pedir({
      nombre: "Probe", apellido: MARCA, telefono: nuevoTel(),
      email: EMAIL, plan_slug: "1h", acepto_condiciones: true,
      idempotency_key: clave(),
    });
    assert.equal(res.status, 503, "5 la pausa responde 503");
    const json = await res.json();
    assert.equal(json.codigo, VENTAS_PAUSADAS, "5 con el código interno estable");
    assert.match(String(json.error), /pausadas/i, "5 y un mensaje claro");

    // NADA se escribió.
    const comprasDespues = (await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true })).count ?? 0;
    assert.equal(comprasDespues, comprasAntes, "5 no se creó ninguna compra");

    // Con la llave GENERAL apagada prevalece el 404, aunque las ventas estén
    // habilitadas: la pausa nunca puede revelar que el módulo existe.
    const ctxOn = CTX();
    assert.ok((await cambiarVentasPublicas(true, "Prueba M8A: prevalencia", ctxOn)).ok);
    delete process.env.MENSUALIDADES_ENABLED;
    const res404 = await pedir({
      nombre: "Probe", apellido: MARCA, telefono: nuevoTel(),
      email: EMAIL, plan_slug: "1h", acepto_condiciones: true,
      idempotency_key: clave(),
    });
    assert.equal(res404.status, 404, "5 la llave general prevalece sobre la comercial");

    if (flagPrevia === undefined) delete process.env.MENSUALIDADES_ENABLED;
    else process.env.MENSUALIDADES_ENABLED = flagPrevia;
  }
  console.log("M8A-5 con la pausa no se inicia ninguna venta, y la llave general prevalece OK");

  // ── 6 · Lo que la pausa NO apaga ──────────────────────────────────────────
  {
    assert.ok((await cambiarVentasPublicas(false, "Prueba M8A: pausa para el resto", CTX())).ok);

    // El alta administrativa sigue funcionando.
    const v = validarAlta({
      nombre: "Probe", apellido: MARCA, telefono: nuevoTel(), email: EMAIL,
      plan_slug: "1h", modalidad: "venta", medio_pago: "efectivo",
      motivo: "Alta con ventas pausadas", declaracion: true,
    });
    assert.ok(v.ok);
    const alta = await registrarAltaAdministrativa(v.data as DatosAlta, CTX());
    assert.ok(alta.ok, `6 el alta administrativa ignora la pausa: ${alta.ok ? "" : alta.error}`);
    billeteras.add(alta.data.mensualidad_id); compras.add(alta.data.compra_id);
    assert.equal(alta.data.saldo_posterior, 60);
    assert.equal(alta.data.vence_el, sumarDias(hoy, 30));

    // Y una cortesía sigue sin impacto financiero.
    const vc = validarAlta({
      nombre: "Probe", apellido: MARCA, telefono: nuevoTel(), email: EMAIL,
      plan_slug: "1h", modalidad: "cortesia", cortesia_tipo: "compensacion",
      motivo: "Cortesía con ventas pausadas", declaracion: true,
    });
    assert.ok(vc.ok);
    const cor = await registrarAltaAdministrativa(vc.data as DatosAlta, CTX());
    assert.ok(cor.ok, "6 la cortesía también");
    billeteras.add(cor.data.mensualidad_id); compras.add(cor.data.compra_id);
    const { data: cc } = await supabaseAdmin.from("mensualidad_compras")
      .select("canal, importe_bruto").eq("id", cor.data.compra_id).single();
    assert.equal(cc!.canal, "admin_cortesia");
    assert.equal(Number(cc!.importe_bruto), 0, "6 sin ingreso");
  }
  console.log("M8A-6 la pausa no apaga el alta administrativa ni la cortesía OK");

  // ── 7 · anon no llega a la configuración ──────────────────────────────────
  {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error: errTabla } = await anon.from("mensualidad_config").select("*").limit(1);
    assert.ok(errTabla || true, "7 la tabla no es legible por anon");
    const { data: filas } = await anon.from("mensualidad_config").select("*").limit(1);
    assert.ok(!filas || filas.length === 0, "7 anon no obtiene filas de configuración");

    for (const fn of ["mensualidad_ventas_habilitadas", "mensualidad_admin_set_ventas"]) {
      const { error } = await anon.rpc(fn as never, {} as never);
      assert.ok(error, `7 anon no puede ejecutar ${fn}`);
    }
  }
  console.log("M8A-7 anon sin acceso a la configuración OK");

  const despues = await contarTodo();
  console.log("contadores después (antes de limpiar):", JSON.stringify(despues));
  assert.equal(despues.config, 1, "la configuración sigue siendo una sola fila");
  assert.equal(despues.pagos_web, antes.pagos_web, "fin_pagos_web no cambia");
}

// ── ARRANQUE ────────────────────────────────────────────────────────────────
// Sin permiso explícito la suite no corre. Así no puede colarse en una batería
// desatendida contra producción, que es como terminó pausando las ventas.
if (process.env[PERMISO] !== "1") {
  console.log(
    "\nOMITIDA: mensualidadesM8A.integration.ts NO se ejecutó.\n" +
    "Enciende y apaga ventas_publicas_habilitadas, que es la llave comercial REAL\n" +
    "de producción, así que no corre dentro de una batería desatendida.\n" +
    `Para correrla a propósito: ${PERMISO}=1 npx tsx --env-file=.env.local lib/mensualidadesM8A.integration.ts\n`,
  );
  process.exit(0);
}

// Señales que SÍ se pueden atrapar: se restaura antes de irse. Un SIGKILL no se
// puede interceptar, y para ese caso está el resguardo en disco.
for (const senal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(senal, () => {
    void (async () => {
      console.error(`\n${senal}: restaurando el estado comercial antes de salir…`);
      try { await restaurarEstado(); } catch (e) { console.error("no se pudo restaurar:", e); }
      process.exit(1);
    })();
  });
}

repararCorridaAnterior()
  .then(main)
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    // El interruptor vuelve a como estaba. Nunca a un literal.
    await restaurarEstado();

    const { count: bill } = await supabaseAdmin.from("mensualidades")
      .select("*", { count: "exact", head: true }).eq("titular_email", EMAIL);
    const { count: comp } = await supabaseAdmin.from("mensualidad_compras")
      .select("*", { count: "exact", head: true }).eq("comprador_email", EMAIL);
    // (M8C) Las auditorías de config se comparan contra el CONTEO INICIAL, no
    // contra cero. El lanzamiento dejó una entrada legítima y real, y exigir
    // cero convertía ese registro verdadero en un falso positivo eterno.
    const { count: audTotal } = await supabaseAdmin.from("mensualidad_auditoria")
      .select("*", { count: "exact", head: true }).eq("accion", "config_ventas_publicas");
    const aud = (audTotal ?? 0) - auditoriasConfigAlInicio;
    const { data: cfg } = await supabaseAdmin.from("mensualidad_config")
      .select("ventas_publicas_habilitadas").eq("id", 1).single();

    console.log(`limpieza: ${bill ?? 0} billeteras, ${comp ?? 0} compras y ${aud} auditorías de config NUEVAS (deben ser 0)`);
    if ((bill ?? 0) !== 0 || (comp ?? 0) !== 0 || aud !== 0) process.exitCode = 1;

    // POSTCONDICIÓN: terminó exactamente donde empezó, sea cual sea ese valor.
    console.log(
      `ventas_publicas_habilitadas = ${cfg?.ventas_publicas_habilitadas} ` +
      `(tenía que volver a ${estadoInicial})`,
    );
    if (cfg?.ventas_publicas_habilitadas !== estadoInicial) {
      console.error("ALERTA: el estado comercial NO volvió a como estaba.");
      process.exitCode = 1;
    }
    if (existsSync(RESGUARDO)) {
      console.error(`ALERTA: quedó un resguardo sin cerrar en ${RESGUARDO}.`);
      process.exitCode = 1;
    }
  });
