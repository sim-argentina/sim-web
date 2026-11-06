import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import {
  CODIGO_ENVIO_REAL_BLOQUEADO,
  armarPedidoPlantilla,
  clasificarRespuestaCloud,
  crearProveedorCloud,
  estadoConfiguracionWhatsapp,
  evaluarEnvioReal,
} from "@/lib/marketing/whatsappCloud";
import {
  esBotonDeBaja,
  esTextoDeBaja,
  leerConfigWebhook,
  leerWebhook,
  tokenVerificacionValido,
  verificarFirmaMeta,
} from "@/lib/marketing/whatsappWebhook";
import { CODIGO_CLOUD_SIN_CAMPANIAS, crearProveedorSimulado, evaluarProveedorWhatsapp, wamidSimulado, type MensajePlantilla } from "@/lib/marketing/proveedorWhatsapp";

// Marketing · WhatsApp Cloud API: adaptador de envío y lectura del webhook. Puro.
// Ejecutar: npx tsx lib/marketing/whatsapp.test.ts
// La red está BLOQUEADA: todo pedido a Meta pasa por un transporte simulado.

let red = 0;
globalThis.fetch = (() => { red++; throw new Error("red prohibida en las pruebas de WhatsApp"); }) as typeof fetch;

const TOKEN = "EAAprueba-token-que-no-debe-aparecer";
const CREDENCIALES = {
  WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "123456789012345", WHATSAPP_BUSINESS_ACCOUNT_ID: "987654321098765",
  WHATSAPP_APP_SECRET: "secreto-app", WHATSAPP_VERIFY_TOKEN: "verificar", WHATSAPP_GRAPH_VERSION: "v26.0",
  MARKETING_WHATSAPP_PLANTILLA: "recuperacion_stand_v1", MARKETING_WHATSAPP_IDIOMA: "es_AR",
};
const MSJ: MensajePlantilla = {
  destino: "5493511234567", plantilla: "", idioma: "", variables: ["Hola Ana", "10 % de descuento", "30/10", "reservas web y Gift Cards"],
  codigoCupon: "SIMU-ABCDEFGH", claveIdempotencia: "c:3511234567", intento: 1, referencia: "00000000-0000-4000-8000-000000000001:1",
};

type Llamada = { url: string; init: RequestInit };
function transporte(respuesta: () => Promise<Response> | Response) {
  const llamadas: Llamada[] = [];
  const t = async (url: string, init: RequestInit) => { llamadas.push({ url, init }); return respuesta(); };
  return { t, llamadas };
}
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

async function main() {
  // ── 1. Bloqueo de envíos reales: apagado por defecto, credenciales no alcanzan ──
  {
    assert.equal(evaluarEnvioReal(CREDENCIALES).ok, false, "con credenciales pero sin el bloqueo abierto");
    for (const v of ["TRUE", "1", "yes", "true ", "si"]) {
      assert.equal(evaluarEnvioReal({ ...CREDENCIALES, MARKETING_WHATSAPP_ENVIOS_REALES: v }).ok, v === "true ", `"${v}"`);
    }
    const abierto = evaluarEnvioReal({ ...CREDENCIALES, MARKETING_WHATSAPP_ENVIOS_REALES: "true" });
    assert.ok(abierto.ok && abierto.config.version === "v26.0" && !abierto.config.bizOpaque);
    const sinVersion = evaluarEnvioReal({ ...CREDENCIALES, WHATSAPP_GRAPH_VERSION: "", MARKETING_WHATSAPP_ENVIOS_REALES: "true" });
    assert.ok(!sinVersion.ok && sinVersion.codigo === "configuracion_incompleta" && sinVersion.motivo.includes("WHATSAPP_GRAPH_VERSION"));
    const malaVersion = evaluarEnvioReal({ ...CREDENCIALES, WHATSAPP_GRAPH_VERSION: "latest", MARKETING_WHATSAPP_ENVIOS_REALES: "true" });
    assert.ok(!malaVersion.ok && malaVersion.codigo === "configuracion_incompleta");
    assert.ok(!JSON.stringify(sinVersion).includes(TOKEN), "el motivo no lleva secretos");
  }

  // ── 2. El bloqueo se comprueba ANTES de cualquier salida ──────────────────
  {
    const { t, llamadas } = transporte(() => json(200, { messages: [{ id: "wamid.X" }] }));
    const p = crearProveedorCloud({ transporte: t, entorno: () => CREDENCIALES });
    const r = await p.enviarPlantilla(MSJ);
    assert.ok(!r.ok && r.codigo === CODIGO_ENVIO_REAL_BLOQUEADO);
    assert.equal(llamadas.length, 0, "con el bloqueo cerrado no sale ningún pedido");
    let abierto = true;
    const p2 = crearProveedorCloud({ transporte: t, entorno: () => ({ ...CREDENCIALES, MARKETING_WHATSAPP_ENVIOS_REALES: abierto ? "true" : "" }) });
    assert.ok((await p2.enviarPlantilla(MSJ)).ok);
    abierto = false;
    assert.ok(!(await p2.enviarPlantilla(MSJ)).ok, "cerrar el bloqueo corta en el envío siguiente");
    assert.equal(llamadas.length, 1);
  }

  // ── 3. Pedido: endpoint con versión explícita, plantilla, parámetros y cupón ──
  {
    const { t, llamadas } = transporte(() => json(200, { messaging_product: "whatsapp", contacts: [{ input: "5493511234567", wa_id: "5493511234567" }], messages: [{ id: "wamid.HBgM1", message_status: "accepted" }] }));
    const entorno = { ...CREDENCIALES, MARKETING_WHATSAPP_ENVIOS_REALES: "true" };
    const r = await crearProveedorCloud({ transporte: t, entorno: () => entorno }).enviarPlantilla(MSJ);
    assert.deepEqual(r, { ok: true, wamid: "wamid.HBgM1", repetido: false, estadoMeta: "accepted" }, "aceptado ≠ entregado: solo el wamid y el estado de la API");
    assert.equal(llamadas[0].url, "https://graph.facebook.com/v26.0/123456789012345/messages");
    const h = llamadas[0].init.headers as Record<string, string>;
    assert.equal(h.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(String(llamadas[0].init.body));
    assert.deepEqual(body, {
      messaging_product: "whatsapp", recipient_type: "individual", to: "5493511234567", type: "template",
      template: {
        name: "recuperacion_stand_v1", language: { code: "es_AR" },
        components: [
          { type: "body", parameters: MSJ.variables.map((text) => ({ type: "text", text })) },
          { type: "button", sub_type: "copy_code", index: 0, parameters: [{ type: "coupon_code", coupon_code: "SIMU-ABCDEFGH" }] },
        ],
      },
    }, "sin biz_opaque_callback_data salvo que se active");
    const { t: t2, llamadas: l2 } = transporte(() => json(200, { messages: [{ id: "wamid.HBgM2" }] }));
    await crearProveedorCloud({ transporte: t2, entorno: () => ({ ...entorno, MARKETING_WHATSAPP_BIZ_OPAQUE: "true" }) }).enviarPlantilla(MSJ);
    assert.equal(JSON.parse(String(l2[0].init.body)).biz_opaque_callback_data, MSJ.referencia);
    const { t: t3, llamadas: l3 } = transporte(() => json(200, { messages: [{ id: "wamid.HBgM3" }] }));
    await crearProveedorCloud({ transporte: t3, entorno: () => ({ ...entorno, MARKETING_WHATSAPP_ENDPOINT: "marketing_messages" }) }).enviarPlantilla(MSJ);
    assert.equal(l3[0].url, "https://graph.facebook.com/v26.0/123456789012345/marketing_messages", "Marketing Messages API (mismo esquema)");
    const malo = await crearProveedorCloud({ transporte: t3, entorno: () => ({ ...entorno, MARKETING_WHATSAPP_ENDPOINT: "otro" }) }).enviarPlantilla(MSJ);
    assert.ok(!malo.ok && l3.length === 1, "un endpoint desconocido no sale");
  }

  // ── 4. Validación local: nada inválido sale a la red ──────────────────────
  {
    const c = { plantilla: "recuperacion_stand_v1", idioma: "es_AR", bizOpaque: false };
    const err = (m: Partial<MensajePlantilla>) => { const r = armarPedidoPlantilla({ ...MSJ, ...m }, c); return r.ok ? "ok" : r.error; };
    assert.equal(err({}), "ok");
    assert.equal(err({ variables: ["Hola", "", "x", "y"] }), "parametros_invalidos", "Meta no admite parámetros vacíos");
    assert.equal(err({ variables: ["Hola\nAna", "a", "b", "c"] }), "parametros_invalidos");
    assert.equal(err({ variables: ["Hola     Ana", "a", "b", "c"] }), "parametros_invalidos");
    assert.equal(err({ variables: Array(11).fill("x") }), "parametros_invalidos");
    assert.equal(err({ codigoCupon: "SIMU-ABCDEFGHIJKLMNOPQ" }), "cupon_invalido", "el cupón copiable tiene hasta 20 caracteres");
    assert.equal(err({ destino: "3511234567" }), "destino_invalido");
    assert.equal(armarPedidoPlantilla(MSJ, { ...c, plantilla: "Con Mayúsculas" }).ok, false);
    const { t, llamadas } = transporte(() => json(200, { messages: [{ id: "wamid.X" }] }));
    const r = await crearProveedorCloud({ transporte: t, entorno: () => ({ ...CREDENCIALES, MARKETING_WHATSAPP_ENVIOS_REALES: "true" }) })
      .enviarPlantilla({ ...MSJ, variables: [] });
    assert.ok(!r.ok && r.codigo === "parametros_invalidos" && llamadas.length === 0);
  }

  // ── 5. Clasificación: aceptado, transitorio, definitivo e INCIERTO ────────
  {
    const c = (s: number, j: unknown) => clasificarRespuestaCloud(s, j);
    const tipo = (r: ReturnType<typeof c>) => (r.ok ? "aceptado" : r.incierto ? "incierto" : r.transitorio ? "transitorio" : "definitivo");
    assert.equal(tipo(c(200, { messages: [{ id: "wamid.1" }] })), "aceptado");
    assert.equal(tipo(c(200, { messages: [] })), "incierto", "OK sin id: no se sabe si salió");
    for (const code of [2, 4, 130429, 131000, 131016, 131056]) assert.equal(tipo(c(400, { error: { code, message: "x" } })), "transitorio", String(code));
    for (const code of [131026, 131049, 131050, 132000, 132001, 190, 100]) assert.equal(tipo(c(400, { error: { code, message: "x" } })), "definitivo", String(code));
    assert.equal(tipo(c(500, {})), "incierto", "5xx sin código");
    assert.equal(tipo(c(400, { error: { code: 1, message: "posible error del servidor" } })), "incierto");
    assert.equal(tipo(c(403, null)), "definitivo");
    const r131050 = c(400, { error: { code: 131050, message: "opted out" } });
    assert.ok(!r131050.ok && r131050.codigo === "131050");

    const entorno = () => ({ ...CREDENCIALES, MARKETING_WHATSAPP_ENVIOS_REALES: "true" });
    const colgado = crearProveedorCloud({ transporte: (_u, i) => new Promise<Response>((_, rej) => i.signal?.addEventListener("abort", () => rej(Object.assign(new Error("abort"), { name: "AbortError" })))), entorno, tiempoMs: 50 });
    const rt = await colgado.enviarPlantilla(MSJ);
    assert.ok(!rt.ok && rt.incierto && rt.codigo === "tiempo_agotado", "tiempo agotado = incierto, nunca 'falló'");
    const cortado = crearProveedorCloud({ transporte: async () => { throw new TypeError("fetch failed"); }, entorno });
    const rc = await cortado.enviarPlantilla(MSJ);
    assert.ok(!rc.ok && rc.incierto && rc.codigo === "sin_respuesta");
    const ilegible = crearProveedorCloud({ transporte: async () => new Response("<html>", { status: 200 }), entorno });
    const ri = await ilegible.enviarPlantilla(MSJ);
    assert.ok(!ri.ok && ri.incierto);
    for (const r of [rt, rc, ri, r131050]) assert.ok(!JSON.stringify(r).includes(TOKEN), "ningún resultado lleva el token");
  }

  // ── 6. Estado de la configuración, sin valores ────────────────────────────
  {
    assert.equal(estadoConfiguracionWhatsapp({}).nivel, "sin_configurar");
    const parcial = estadoConfiguracionWhatsapp({ WHATSAPP_ACCESS_TOKEN: TOKEN });
    assert.equal(parcial.nivel, "incompleta");
    assert.ok(parcial.faltan.includes("WHATSAPP_APP_SECRET"));
    const todo = estadoConfiguracionWhatsapp(CREDENCIALES);
    assert.equal(todo.nivel, "presente");
    assert.deepEqual([todo.numeroFinal, todo.cuentaFinal, todo.version, todo.enviosReales.habilitado], ["2345", "8765", "v26.0", false]);
    assert.ok(!JSON.stringify(todo).includes(TOKEN) && !JSON.stringify(todo).includes("secreto-app"));
    assert.ok(estadoConfiguracionWhatsapp({ ...CREDENCIALES, WHATSAPP_GRAPH_VERSION: "26" }).invalidas.includes("WHATSAPP_GRAPH_VERSION"));
  }

  // ── 7. Firma del webhook sobre los bytes, token de verificación ───────────
  {
    const crudo = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [], texto: "acentuado: ñandú ✓" }), "utf8");
    const firma = `sha256=${createHmac("sha256", "secreto-app").update(crudo).digest("hex")}`;
    assert.equal(verificarFirmaMeta(crudo, firma, "secreto-app"), true);
    assert.equal(verificarFirmaMeta(crudo, firma, "otro-secreto"), false);
    assert.equal(verificarFirmaMeta(crudo, firma.replace("sha256=", ""), "secreto-app"), false);
    assert.equal(verificarFirmaMeta(crudo, null, "secreto-app"), false);
    assert.equal(verificarFirmaMeta(crudo, firma, ""), false, "sin secreto no hay firma válida");
    const alterado = Buffer.from(crudo); alterado[alterado.length - 3] ^= 1;
    assert.equal(verificarFirmaMeta(alterado, firma, "secreto-app"), false, "un byte cambiado invalida");
    assert.equal(tokenVerificacionValido("verificar", "verificar"), true);
    assert.equal(tokenVerificacionValido("verificarX", "verificar"), false);
    assert.equal(tokenVerificacionValido(null, "verificar"), false);
    assert.deepEqual(leerConfigWebhook({}).ok, false);
    assert.ok(leerConfigWebhook(CREDENCIALES).ok);
  }

  // ── 8. Lectura: cuenta y número de SIM, estados, bajas inequívocas, preferencias ──
  {
    const cfg = { phoneNumberId: "123456789012345", wabaId: "987654321098765" };
    const meta = { display_phone_number: "5493510000000", phone_number_id: cfg.phoneNumberId };
    const ts = "1790000000";
    const cuerpo = (entry: unknown[]) => ({ object: "whatsapp_business_account", entry });
    const cambio = (value: Record<string, unknown>, field = "messages") => ({ id: cfg.wabaId, changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, ...value } }] });
    const l = leerWebhook(cuerpo([
      cambio({ statuses: [
        { id: "wamid.A", status: "delivered", timestamp: ts, recipient_id: "5493511234567", pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" } },
        { id: "wamid.A", status: "failed", timestamp: ts, recipient_id: "5493511234567", errors: [{ code: 131050, title: "x" }] },
        { id: "wamid.B", status: "inventado", timestamp: ts },
      ] }),
      cambio({ messages: [
        { from: "5493511234567", id: "wamid.IN1", timestamp: ts, type: "text", text: { body: "  Baja!! " } },
        { from: "5493511234568", id: "wamid.IN2", timestamp: ts, type: "text", text: { body: "baja el precio?" } },
        { from: "5493511234569", id: "wamid.IN3", timestamp: ts, type: "button", button: { text: "No quiero promociones", payload: "No quiero promociones" }, context: { from: "5493510000000", id: "wamid.A" } },
        { from: "5493511234570", id: "wamid.IN4", timestamp: ts, type: "text", text: { body: "Hola, quiero reservar" } },
      ] }),
      { id: cfg.wabaId, changes: [{ field: "user_preferences", value: { user_preferences: [
        { wa_id: "5493511234571", detail: "User requested to stop marketing messages", category: "marketing_messages", value: "stop", timestamp: 1790000100 },
        { wa_id: "5493511234571", detail: "User requested to resume marketing messages", category: "marketing_messages", value: "resume", timestamp: 1790000200 },
        { wa_id: "5493511234572", category: "otra", value: "stop", timestamp: 1790000300 },
      ] } }] },
      { id: "111111111111111", changes: [{ field: "messages", value: { metadata: meta, messages: [{ from: "5493511234599", id: "wamid.AJENO", timestamp: ts, type: "text", text: { body: "baja" } }] } }] },
      { id: cfg.wabaId, changes: [{ field: "messages", value: { metadata: { ...meta, phone_number_id: "222222222222222" }, messages: [{ from: "5493511234598", id: "wamid.OTRO", timestamp: ts, type: "text", text: { body: "baja" } }] } }] },
    ]), cfg);
    const claves = l.eventos.map((e) => e.clave);
    assert.deepEqual(claves, [
      "estado:wamid.A:delivered", "estado:wamid.A:failed",
      "mensaje:wamid.IN1", "mensaje:wamid.IN2", "mensaje:wamid.IN3", "mensaje:wamid.IN4",
      "preferencia:5493511234571:stop:1790000100", "preferencia:5493511234571:resume:1790000200",
    ]);
    const por = Object.fromEntries(l.eventos.map((e) => [e.clave, e]));
    assert.deepEqual(por["estado:wamid.A:delivered"].pricing, { type: "regular", category: "marketing", billable: true, pricing_model: "PMP" });
    assert.equal(por["estado:wamid.A:failed"].error_codigo, "131050");
    assert.equal(por["mensaje:wamid.IN1"].intencion, "baja_texto");
    assert.equal(por["mensaje:wamid.IN2"].intencion, "otro", "\"baja el precio\" no es una baja");
    assert.equal(por["mensaje:wamid.IN3"].intencion, "baja_boton");
    assert.equal(por["mensaje:wamid.IN3"].contexto_wamid, "wamid.A");
    assert.equal(por["mensaje:wamid.IN4"].intencion, "otro", "un mensaje común no es autorización ni baja");
    assert.equal(por["mensaje:wamid.IN1"].ocurrido_en, new Date(1790000000 * 1000).toISOString());
    assert.deepEqual(l.rechazos, { evento_malformado: 2, cuenta_ajena: 1, numero_ajeno: 1 });
    assert.ok(!JSON.stringify(l.eventos).includes("quiero reservar"), "los eventos no guardan textos");
    assert.equal(l.finanzas.length, 4, "Finanzas recibe los mensajes de la cuenta de SIM (y solo esos)");
    assert.equal(leerWebhook({ object: "page", entry: [] }, cfg).eventos.length, 0);

    for (const t of ["BAJA", "Stop", "no quiero más promociones", "Desuscribirme."]) assert.equal(esTextoDeBaja(t), true, t);
    for (const t of ["cancelar", "no", "no, gracias", "bajá el volumen", "stop por favor que es muy caro", ""]) assert.equal(esTextoDeBaja(t), false, t);
    assert.equal(esBotonDeBaja("Stop promotions"), true);
    assert.equal(esBotonDeBaja("Reservar ahora"), false);
    assert.equal(esBotonDeBaja("Chau promos", "chau promos"), true, "la etiqueta propia de SIM se puede sumar");
  }

  // ── 9. Proveedores: la Cloud API no la usa ninguna campaña; wamid simulado por intento ──
  {
    const v = evaluarProveedorWhatsapp({ MARKETING_WHATSAPP_PROVIDER: "cloud", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" });
    assert.ok(!v.ok && v.codigo === CODIGO_CLOUD_SIN_CAMPANIAS);
    const sim = crearProveedorSimulado({ fallo_definitivo_pct: 0, fallo_transitorio_pct: 0, incierto_pct: 0, no_entregado_pct: 0 });
    const a = await sim.enviarPlantilla({ ...MSJ, plantilla: "p", idioma: "es_AR", intento: 1 });
    const b = await sim.enviarPlantilla({ ...MSJ, plantilla: "p", idioma: "es_AR", intento: 2 });
    assert.ok(a.ok && b.ok && a.wamid !== b.wamid && a.wamid === wamidSimulado(`${MSJ.claveIdempotencia}:1`), "cada intento, su wamid");
  }

  assert.equal(red, 0, "ningún pedido salió a la red");
  console.log("whatsapp.test.ts OK — bloqueo de envíos, pedido, validación, clasificación (incierto), configuración, firma y lectura del webhook.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
