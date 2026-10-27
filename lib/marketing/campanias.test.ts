import { strict as assert } from "node:assert";
import {
  PROPUESTA_SIN_APROBAR,
  SIMULACION_POR_DEFECTO,
  aplicarTopes,
  capacidadesCodigos,
  condicionesParaDestinatario,
  describirBeneficio,
  errorDeRpcCampanias,
  faltantesParaPreparar,
  renderizarMensaje,
  validarDatosCampania,
  valoresMensaje,
  variablesDelMensaje,
  venceEl,
} from "@/lib/marketing/campanias";
import { evaluarEntornoCampanias } from "@/lib/marketing/entornoCampanias";
import {
  SinRespuestaSimulada,
  crearProveedorSimulado,
  decidirEntregaSimulada,
  decidirEnvioSimulado,
  wamidSimulado,
} from "@/lib/marketing/proveedorWhatsapp";

// Marketing · campañas en simulación: reglas puras. Sin base y sin red.
// Ejecutar: npx tsx lib/marketing/campanias.test.ts

let llamadasRed = 0;
globalThis.fetch = (() => {
  llamadasRed++;
  throw new Error("red prohibida en las pruebas de campañas");
}) as typeof fetch;

const base = {
  nombre: "Recuperación", objetivo: "Que vuelvan", ventana_dias: 14, mensaje: "Hola {nombre}! {beneficio} con {codigo} hasta el {vence}. Baja: {baja}",
  productos: ["reserva", "gift_card"],
};

async function main() {
  // ── 1. Validación: lo comercial arranca vacío; la propuesta no es un valor por defecto ──
  {
    const v = validarDatosCampania(base);
    assert.ok(v.ok);
    assert.equal(v.valor.beneficio_tipo, null);
    assert.equal(v.valor.beneficio_valor, null);
    assert.equal(v.valor.beneficio_vigencia_dias, null);
    assert.equal(v.valor.solo_pagos, true, "solo pagos por defecto, como audiencia.ts");
    assert.deepEqual(v.valor.simulacion, SIMULACION_POR_DEFECTO);
    assert.deepEqual(faltantesParaPreparar(v.valor), ["tipo y valor del beneficio", "vencimiento del beneficio", "tarifa de referencia y moneda"]);
    assert.ok(PROPUESTA_SIN_APROBAR.beneficio_valor === 15 && PROPUESTA_SIN_APROBAR.beneficio_vigencia_dias === 7);
  }
  {
    const campos = (b: Record<string, unknown>) => { const v = validarDatosCampania({ ...base, ...b }); return v.ok ? [] : v.errores.map((e) => e.campo); };
    assert.deepEqual(campos({ ventana_dias: 30 }), ["ventana_dias"]);
    assert.deepEqual(campos({ nombre: "x" }), ["nombre"]);
    assert.deepEqual(campos({ productos: [] }), ["productos"]);
    assert.deepEqual(campos({ productos: ["stand"] }), ["productos"]);
    assert.deepEqual(campos({ beneficio_tipo: "porcentaje", beneficio_valor: 150 }), ["beneficio_valor"]);
    assert.deepEqual(campos({ beneficio_valor: 10 }), ["beneficio_tipo"]);
    assert.deepEqual(campos({ beneficio_vigencia_dias: 90 }), ["beneficio_vigencia_dias"]);
    assert.deepEqual(campos({ limite_destinatarios: 0 }), ["limite_destinatarios"]);
    assert.deepEqual(campos({ tarifa: 0.06 }), ["moneda"], "una tarifa sin moneda no sirve");
    assert.deepEqual(campos({ tarifa: 0.06, moneda: "US" }), ["moneda"]);
    assert.deepEqual(campos({ presupuesto_maximo: 5 }), ["tarifa"]);
    assert.deepEqual(campos({ indicativos: "351, 35" }), []);
    assert.deepEqual(campos({ indicativos: "abc" }), ["indicativos"]);
    assert.deepEqual(campos({ simulacion: { fallo_definitivo_pct: 60, fallo_transitorio_pct: 30, incierto_pct: 20, no_entregado_pct: 0 } }), ["simulacion"]);
    const ok = validarDatosCampania({ ...base, beneficio_tipo: "monto_fijo", beneficio_valor: "5000", beneficio_vigencia_dias: "7", tarifa: "0,0618", moneda: "usd", presupuesto_maximo: "3" });
    assert.ok(ok.ok);
    assert.deepEqual([ok.valor.beneficio_valor, ok.valor.tarifa, ok.valor.moneda, ok.valor.presupuesto_maximo], [5000, 0.0618, "USD", 3]);
  }

  // ── 2. Mensaje: solo variables admitidas; {nombre} vacío no deja basura ────
  {
    assert.deepEqual(variablesDelMensaje("Hola {nombre}, {codigo}").usadas.sort(), ["codigo", "nombre"]);
    assert.deepEqual(variablesDelMensaje("Hola {Nombre} {cupon}").desconocidas.sort(), ["cupon", "llaves mal formadas"]);
    assert.ok(variablesDelMensaje("Hola {cupon}").desconocidas.includes("cupon"));
    assert.ok(variablesDelMensaje("Hola {{1}}").desconocidas.includes("llaves mal formadas"));
    const v = validarDatosCampania({ ...base, mensaje: "Hola {nombre}! Usá {cupon} ya." });
    assert.ok(!v.ok && v.errores.some((e) => e.campo === "mensaje"));
    const sinCodigo = validarDatosCampania({ ...base, mensaje: "Hola {nombre}! Te esperamos en SIM." });
    assert.ok(sinCodigo.ok && sinCodigo.advertencias.some((a) => a.includes("{codigo}")) && sinCodigo.advertencias.some((a) => a.includes("{baja}")));

    const d = { beneficio_tipo: "porcentaje" as const, beneficio_valor: 10, beneficio_vigencia_dias: 5, productos: ["gift_card" as const] };
    const hoy = "2026-10-23";
    assert.equal(venceEl(hoy, 5), "28/10");
    assert.equal(venceEl("2026-12-30", 5), "04/01", "cruza el año por fecha de negocio");
    const conNombre = renderizarMensaje("Hola {nombre}, tenés {beneficio}: {codigo} hasta el {vence} para {productos}.", valoresMensaje(d, { nombre: "Ana", codigo: "SIMU-ABCDEFGH" }, hoy));
    assert.equal(conNombre, "Hola Ana, tenés 10 % de descuento: SIMU-ABCDEFGH hasta el 28/10 para Gift Cards.");
    const sinNombre = renderizarMensaje("Hola {nombre}, tenés {beneficio}.", valoresMensaje(d, { nombre: null, codigo: "SIMU-ABCDEFGH" }, hoy));
    assert.equal(sinNombre, "Hola, tenés 10 % de descuento.");
    assert.equal(describirBeneficio("monto_fijo", 5000), "$5.000 de descuento");
    assert.equal(describirBeneficio(null, null), "(beneficio sin definir)");
    assert.ok(condicionesParaDestinatario(d, hoy).some((c) => c.includes("28/10")));
  }

  // ── 3. Capacidades: lo que el módulo de Códigos NO valida no aparece como efectivo ──
  {
    const ambos = capacidadesCodigos(["reserva", "gift_card"]);
    const uno = capacidadesCodigos(["reserva"]);
    const estado = (l: typeof ambos, r: string) => l.find((c) => c.restriccion === r)?.estado;
    assert.equal(estado(ambos, "Productos alcanzados"), "aplicada");
    assert.equal(estado(uno, "Productos alcanzados"), "no_aplicada");
    assert.match(uno.find((c) => c.restriccion === "Productos alcanzados")!.detalle, /Gift Cards/);
    for (const l of [ambos, uno]) {
      assert.equal(estado(l, "Cantidad de Gift Cards por compra"), "no_aplicada");
      assert.equal(estado(l, "Atado al teléfono del destinatario"), "no_aplicada");
      assert.equal(estado(l, "Un solo uso, exclusivo entre productos"), "aplicada");
    }
  }

  // ── 4. Topes: límite y presupuesto, con la tarifa como parámetro ──────────
  {
    const sinTarifa = { limite_destinatarios: 3, tarifa: null, moneda: null, presupuesto_maximo: null };
    assert.deepEqual(aplicarTopes(5, sinTarifa), { seleccionados: 3, recortadoPor: ["limite"], costo: null });
    const t = aplicarTopes(5, { limite_destinatarios: null, tarifa: 0.05, moneda: "USD", presupuesto_maximo: 0.1 });
    assert.equal(t.seleccionados, 2);
    assert.deepEqual(t.recortadoPor, ["presupuesto"]);
    assert.equal(t.costo?.costoMaximo, 0.1);
    assert.equal(aplicarTopes(0, { limite_destinatarios: 2, tarifa: 0.05, moneda: "USD", presupuesto_maximo: null }).seleccionados, 0);
  }

  // ── 5. Proveedor simulado: determinístico, sin estado, bandas y wamid estable ──
  {
    const s = { fallo_definitivo_pct: 25, fallo_transitorio_pct: 25, incierto_pct: 25, no_entregado_pct: 50 };
    const conteo = { aceptado: 0, definitivo: 0, transitorio: 0, incierto: 0 };
    for (let i = 0; i < 2000; i++) {
      const k = `c:${3510000000 + i}`;
      const a = decidirEnvioSimulado(k, 1, s);
      assert.equal(decidirEnvioSimulado(k, 1, s), a, "misma clave, mismo resultado");
      conteo[a]++;
      if (a === "transitorio" || a === "incierto") assert.equal(decidirEnvioSimulado(k, 2, s), "aceptado", "al 2.º intento sale");
      if (a === "definitivo") assert.equal(decidirEnvioSimulado(k, 2, s), "definitivo");
    }
    for (const n of Object.values(conteo)) assert.ok(n > 400 && n < 600, JSON.stringify(conteo));
    assert.equal(decidirEnvioSimulado("x", 1, { ...s, fallo_definitivo_pct: 0, fallo_transitorio_pct: 0, incierto_pct: 0 }), "aceptado");
    assert.equal(decidirEntregaSimulada("x", { ...s, no_entregado_pct: 0 }), true);
    assert.equal(decidirEntregaSimulada("x", { ...s, no_entregado_pct: 100 }), false);
    assert.equal(wamidSimulado("c:1"), wamidSimulado("c:1"));
    assert.notEqual(wamidSimulado("c:1"), wamidSimulado("c:2"));

    const p = crearProveedorSimulado({ fallo_definitivo_pct: 0, fallo_transitorio_pct: 0, incierto_pct: 100, no_entregado_pct: 0 });
    const m = { destino: "5493511234567", plantilla: "p", idioma: "es_AR", variables: [], claveIdempotencia: "c:1", intento: 1 };
    await assert.rejects(() => p.enviarPlantilla(m), SinRespuestaSimulada, "incierto = sin respuesta (el ejecutor lo marca incierto)");
    assert.deepEqual(await p.enviarPlantilla({ ...m, intento: 2 }), { ok: true, wamid: wamidSimulado("c:1:2"), repetido: false });
    assert.equal((await p.enviarPlantilla({ ...m, destino: "351" })).ok, false);
  }

  // ── 6. Entorno: solo la base local con proveedor falso puede escribir ─────
  {
    const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", MARKETING_WHATSAPP_PROVIDER: "fake" };
    assert.equal(evaluarEntornoCampanias(local).escritura, true);
    const no = (e: Record<string, string | undefined>) => { const r = evaluarEntornoCampanias(e); return r.escritura ? "si" : r.codigo; };
    assert.equal(no({ ...local, VERCEL: "1" }), "campanias_en_vercel");
    assert.equal(no({ ...local, VERCEL_ENV: "preview" }), "campanias_en_vercel");
    assert.equal(no({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://bcmoewwhsyxsiyvroarj.supabase.co" }), "campanias_base_no_local");
    assert.equal(no({ ...local, NEXT_PUBLIC_SUPABASE_URL: "http://usuario:clave@127.0.0.1:55321" }), "campanias_base_no_local");
    assert.equal(no({ ...local, MARKETING_WHATSAPP_PROVIDER: undefined }), "whatsapp_sin_proveedor");
    assert.equal(no({ ...local, MARKETING_WHATSAPP_PROVIDER: "cloud" }), "whatsapp_cloud_solo_adaptador", "la Cloud API no escribe campañas");
    assert.equal(no({ ...local, MARKETING_WHATSAPP_PROVIDER: "cloud_api" }), "whatsapp_cloud_api_no_disponible");
  }

  // ── 7. Errores de la base → errores de la API, sin detalle interno ─────────
  {
    assert.equal(errorDeRpcCampanias({ code: "PGRST205", message: "x" })?.codigo, "campanias_no_instaladas");
    assert.deepEqual(errorDeRpcCampanias({ code: "22023", message: "tope_excedido:presupuesto" }), { status: 409, codigo: "tope_excedido", error: errorDeRpcCampanias({ code: "22023", message: "tope_excedido" })!.error, campo: "presupuesto" });
    assert.equal(errorDeRpcCampanias({ code: "40001", message: "version_desactualizada" })?.status, 409);
    assert.equal(errorDeRpcCampanias({ code: "55000", message: "no_editable:preparada" })?.codigo, "no_editable");
    assert.equal(errorDeRpcCampanias({ code: "23514", message: 'new row violates check constraint "mkt_campanias_ventana"' })?.campo, "ventana_dias");
    assert.equal(errorDeRpcCampanias({ code: "XX000", message: "algo interno" }), null, "lo desconocido es 500 con el detalle solo en el log");
  }

  assert.equal(llamadasRed, 0);
  console.log("campanias.test.ts OK — validación, mensaje, capacidades, topes, proveedor simulado, entorno y errores.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
