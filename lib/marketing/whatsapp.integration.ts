// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// Marketing · webhook de WhatsApp Cloud API — la RUTA real contra el stack LOCAL,
// con eventos firmados como los de Meta y TODO pedido a graph.facebook.com
// interceptado (se registra y se contesta en el acto; nada sale a la red).
// Cubre: verificación de la suscripción, configuración ausente, firma inválida,
// cuenta y número ajenos, baja por WhatsApp después de preparar y antes del
// envío, duplicados, estados fuera de orden, falla de la base (500 y reintento),
// recuperación después de un corte, preferencias de Meta, respuesta incierta del
// proveedor (no se reenvía), Finanzas intacto y diagnóstico sin secretos.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/marketing/whatsapp.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const RUN = Date.now().toString(36);
const MARCA = `zzwa_${RUN}`;
const TEXTO = `zz-wa-${RUN}`.slice(0, 40);
const SEMILLA = (Number.parseInt(RUN.slice(-4), 36) * 31) % 900_000;
const tel = (i: number) => `3516${String((SEMILLA + i) % 1_000_000).padStart(6, "0")}`;
const wa = (i: number) => `549${tel(i)}`;
const FINANZAS = "5493519990777";

{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
  { input: q, encoding: "utf8" }).trim();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SECRETO = randomBytes(24).toString("hex");
const VERIFICAR = randomBytes(12).toString("hex");
const ACCESO = `EAAprueba${randomBytes(12).toString("hex")}`;
const NUMERO = "109876543210987";
const CUENTA = "209876543210987";
const campanias: string[] = [];
let vigentePrevio: string | null = null;

async function main() {
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.MARKETING_WHATSAPP_PROVIDER = "fake";
  process.env.CRON_SECRET = randomBytes(16).toString("hex");
  Object.assign(process.env, {
    WHATSAPP_APP_SECRET: SECRETO, WHATSAPP_VERIFY_TOKEN: VERIFICAR, WHATSAPP_ACCESS_TOKEN: ACCESO,
    WHATSAPP_PHONE_NUMBER_ID: NUMERO, WHATSAPP_BUSINESS_ACCOUNT_ID: CUENTA, WHATSAPP_GRAPH_VERSION: "v26.0",
    WHATSAPP_ALLOWED_NUMBERS: FINANZAS,
  });
  for (const k of ["VERCEL", "VERCEL_URL", "VERCEL_ENV", "MARKETING_WHATSAPP_ENVIOS_REALES", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];

  // ── Toda salida a Meta queda interceptada ─────────────────────────────────
  const aMeta: { url: string; body: Record<string, unknown> }[] = [];
  const fetchReal = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/graph\.facebook\.com/i.test(url)) {
      aMeta.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.INTERCEPTADO.${aMeta.length}` }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.ok(new URL(url).hostname === "127.0.0.1" || new URL(url).hostname === "localhost", `salida no permitida: ${url}`);
    return fetchReal(input, init);
  }) as typeof fetch;

  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: {
      cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }),
      headers: async () => new Headers(),
    },
  } as unknown as NodeJS.Module;

  const WH = await import("@/app/api/whatsapp/webhook/route");
  const DIAG = await import("@/app/api/admin/marketing/whatsapp/route");
  const EJEC = await import("@/app/api/admin/marketing/campanias/ejecutar/route");
  const SRV = await import("@/lib/marketing/campaniasServer");
  const { crearProveedorSimulado } = await import("@/lib/marketing/proveedorWhatsapp");
  const { crearProveedorCloud } = await import("@/lib/marketing/whatsappCloud");
  const { createSessionToken } = await import("@/lib/adminSession");
  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
  cookie = await createSessionToken("admin");

  let ip = 0;
  const unaIp = () => `198.51.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
  const firmar = (b: Buffer) => `sha256=${createHmac("sha256", SECRETO).update(b).digest("hex")}`;
  async function webhook(cuerpo: unknown, opts: { firma?: string | null; crudo?: Buffer } = {}) {
    const crudo = opts.crudo ?? Buffer.from(JSON.stringify(cuerpo), "utf8");
    const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": unaIp() };
    const firma = opts.firma === undefined ? firmar(crudo) : opts.firma;
    if (firma) headers["x-hub-signature-256"] = firma;
    const res = await WH.POST(new Request(`${ORIGEN}/api/whatsapp/webhook`, { method: "POST", headers, body: new Uint8Array(crudo) }));
    return res.status;
  }
  const ts = () => String(Math.floor(Date.now() / 1000));
  const meta = { display_phone_number: "5493510000000", phone_number_id: NUMERO };
  const mensajes = (msgs: unknown[], cuenta = CUENTA, numero = NUMERO) => ({
    object: "whatsapp_business_account",
    entry: [{ id: cuenta, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { ...meta, phone_number_id: numero }, messages: msgs } }] }],
  });
  const estados = (st: unknown[]) => ({
    object: "whatsapp_business_account",
    entry: [{ id: CUENTA, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: meta, statuses: st } }] }],
  });
  const texto = (i: number | string, id: string, body: string) => ({ from: typeof i === "number" ? wa(i) : i, id, timestamp: ts(), type: "text", text: { body } });
  const contar = (q: string) => Number(sql(q));
  const eventos = () => contar(`select count(*) from public.mkt_whatsapp_eventos where clave like ${lit(`%${RUN}%`)}`);
  const estadoConsent = (i: number) => sql(`select coalesce((select estado from public.mkt_consentimiento_estado where telefono = ${lit(tel(i))}), 'sin_registro')`);
  const rechazos = (m: string) => Number(sql(`select coalesce((rechazos -> ${lit(m)} ->> 'n')::int, 0) from public.mkt_whatsapp_estado`));

  // Datos sintéticos: texto publicado, consentimiento para 1..8, dos campañas preparadas.
  vigentePrevio = sql(`select coalesce((select version from public.mkt_textos_consentimiento where estado = 'vigente'), '')`) || null;
  sql(`insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
       values (${lit(TEXTO)}, 'Prueba WhatsApp', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp (integración del webhook).', '');
       select public.mkt_texto_publicar(${lit(TEXTO)}, 'admin');`);
  for (let i = 1; i <= 8; i++) {
    sql(`select public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
          'tipo', 'alta', 'fuente', 'admin_evidencia', 'telefono', ${lit(tel(i))}, 'texto_version', ${lit(TEXTO)},
          'evidencia', jsonb_build_object('tipo', 'papel_firmado', 'referencia', 'Planilla sintética'),
          'ocurrido_en', to_char((clock_timestamp() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'admin');`);
  }
  const datos = (nombre: string) => JSON.stringify({ nombre, objetivo: "Webhook", ventana_dias: 14, mensaje: "Hola {nombre} {codigo} {baja}",
    productos: ["reserva", "gift_card"], indicativos: [], beneficio_tipo: "porcentaje", beneficio_valor: 10, beneficio_vigencia_dias: 5, tarifa: 0.05, moneda: "USD" });
  const dest = (i: number) => `jsonb_build_object('telefono', ${lit(tel(i))}, 'ultima_visita', to_char(current_date - 3, 'YYYY-MM-DD'))`;
  const preparar = (nombre: string, tels: number[]) => {
    const id = sql(`select (public.mkt_campania_guardar(null, null, gen_random_uuid(), ${lit(datos(`${nombre} ${MARCA}`))}::jsonb, 'admin') -> 'campania' ->> 'id')`);
    campanias.push(id);
    sql(`select public.mkt_campania_preparar(${lit(id)}, 1, '{"calculado_en": "prueba"}'::jsonb, jsonb_build_array(${tels.map(dest).join(", ")}), 'admin');
         select public.mkt_campania_cambiar(${lit(id)}, 'iniciar', 'admin');`);
    return id;
  };
  const estadoDest = (c: string, i: number) => sql(`select estado || '|' || coalesce(motivo, '') from public.mkt_campania_destinatarios where campania_id = ${lit(c)} and telefono = ${lit(tel(i))}`);

  // ═══ A. Verificación de la suscripción ═══════════════════════════════════
  {
    const get = (q: string) => WH.GET(new Request(`${ORIGEN}/api/whatsapp/webhook?${q}`, { headers: { "x-real-ip": unaIp() } }));
    assert.equal((await get(`hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123`)).status, 403);
    const ok = await get(`hub.mode=subscribe&hub.verify_token=${VERIFICAR}&hub.challenge=987654`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "987654");
    assert.equal(sql(`select webhook_verificado_en is not null from public.mkt_whatsapp_estado`), "t");
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    assert.equal((await get(`hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status, 503);
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFICAR;
  }
  console.log("OK — A: verificación de la suscripción (token en tiempo constante; sin token configurado, 503).");

  // ═══ B. Configuración ausente, firma inválida, cuenta y número ajenos ═════
  {
    const antes = eventos();
    const r0 = rechazos("sin_configuracion");
    delete process.env.WHATSAPP_APP_SECRET;
    assert.equal(await webhook(mensajes([texto(1, `wamid.B0${RUN}`, "BAJA")])), 503, "sin secreto no se procesa");
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    assert.equal(rechazos("sin_configuracion"), r0 + 1);
    const r1 = rechazos("firma_invalida");
    assert.equal(await webhook(mensajes([texto(1, `wamid.B1${RUN}`, "BAJA")]), { firma: "sha256=" + "0".repeat(64) }), 401);
    assert.equal(await webhook(mensajes([texto(1, `wamid.B2${RUN}`, "BAJA")]), { firma: null }), 401);
    const cuerpo = Buffer.from(JSON.stringify(mensajes([texto(1, `wamid.B3${RUN}`, "BAJA")])));
    const firmaOk = firmar(cuerpo);
    const alterado = Buffer.from(cuerpo.toString().replace("BAJA", "baja"));
    assert.equal(await webhook(null, { crudo: alterado, firma: firmaOk }), 401, "la firma va sobre los bytes recibidos");
    assert.equal(rechazos("firma_invalida"), r1 + 3);
    const rc = rechazos("cuenta_ajena");
    const rn = rechazos("numero_ajeno");
    assert.equal(await webhook(mensajes([texto(1, `wamid.B4${RUN}`, "BAJA")], "111111111111111")), 200);
    assert.equal(await webhook(mensajes([texto(1, `wamid.B5${RUN}`, "BAJA")], CUENTA, "222222222222222")), 200);
    assert.deepEqual([rechazos("cuenta_ajena"), rechazos("numero_ajeno")], [rc + 1, rn + 1]);
    assert.equal(eventos(), antes, "nada de lo rechazado se guardó");
    assert.equal(estadoConsent(1), "alta", "ni registró bajas");
    const enorme = Buffer.alloc(3 * 1024 * 1024 + 10, 32);
    assert.equal(await webhook(null, { crudo: enorme }), 413);
  }
  console.log("OK — B: sin configuración 503, firma inválida/ausente/alterada 401, cuenta o número ajenos ignorados, cuerpo enorme 413.");

  // ═══ C. Baja por WhatsApp DESPUÉS de preparar y ANTES del envío ═══════════
  const C1 = preparar("Baja previa", [1, 2]);
  const llamadas = new Map<string, number>();
  const contador = () => {
    const p = crearProveedorSimulado({ fallo_definitivo_pct: 0, fallo_transitorio_pct: 0, incierto_pct: 0, no_entregado_pct: 0 });
    return { nombre: "falso" as const, enviarPlantilla: async (m: Parameters<typeof p.enviarPlantilla>[0]) => {
      llamadas.set(m.claveIdempotencia, (llamadas.get(m.claveIdempotencia) ?? 0) + 1);
      return p.enviarPlantilla(m);
    } };
  };
  const bajaC = mensajes([texto(1, `wamid.C1${RUN}`, "  Baja ")]);
  {
    assert.equal(await webhook(bajaC), 200);
    assert.equal(estadoConsent(1), "baja");
    assert.equal(estadoDest(C1, 1), "excluido|baja_posterior", "excluido en el acto, antes de cualquier lote");
    assert.equal(sql(`select fuente || '|' || (evidencia ->> 'origen') from public.mkt_consentimiento_eventos where telefono = ${lit(tel(1))} and tipo = 'baja'`), "whatsapp|texto");
    for (let i = 0; i < 5; i++) {
      const r = await SRV.ejecutarLote(C1, { proveedor: contador() });
      assert.ok(r.ok, JSON.stringify(r));
      if (r.valor.estado !== "ejecutando") break;
    }
    assert.equal(llamadas.get(`${C1}:${tel(1)}`) ?? 0, 0, "a quien pidió la baja no se le envía");
    assert.equal(llamadas.get(`${C1}:${tel(2)}`), 1);
  }
  console.log("OK — C: \"BAJA\" por WhatsApp después de preparar excluye al destinatario en el acto; nunca se le envía.");

  // ═══ D. Duplicados y un mensaje común ═════════════════════════════════════
  {
    const antes = eventos();
    assert.equal(await webhook(bajaC), 200, "Meta reintenta el mismo webhook");
    assert.equal(await webhook(bajaC), 200);
    assert.equal(eventos(), antes, "la bandeja no duplica");
    assert.equal(contar(`select count(*) from public.mkt_consentimiento_eventos where telefono = ${lit(tel(1))} and tipo = 'baja'`), 1, "una sola baja");
    assert.equal(await webhook(mensajes([texto(3, `wamid.D1${RUN}`, "Hola, ¿cuánto sale?"), texto(3, `wamid.D2${RUN}`, "baja el precio?")])), 200);
    assert.equal(estadoConsent(3), "alta", "un mensaje común no es baja ni autorización");
    assert.equal(sql(`select string_agg(resultado, ',' order by clave) from public.mkt_whatsapp_eventos where clave in (${lit(`mensaje:wamid.D1${RUN}`)}, ${lit(`mensaje:wamid.D2${RUN}`)})`), "ignorado,ignorado");
  }
  console.log("OK — D: reintentos de Meta no duplican; un mensaje común se ignora.");

  // ═══ E. Estados fuera de orden de un envío REAL (insertado a mano) ═══════
  const E = preparar("Estados", [4]);
  const wamidE = `wamid.E${RUN}`;
  {
    const idE = sql(`select id from public.mkt_campania_destinatarios where campania_id = ${lit(E)}`);
    sql(`update public.mkt_campania_destinatarios set estado = 'aceptado', wamid = ${lit(wamidE)}, aceptado_en = now(), intentos = 1 where id = ${lit(idE)};
         insert into public.mkt_whatsapp_envios (destinatario_id, campania_id, intento, origen, resultado, wamid, aceptado_en)
         values (${lit(idE)}, ${lit(E)}, 1, 'real', 'aceptado', ${lit(wamidE)}, now());`);
    const st = (status: string, extra: Record<string, unknown> = {}) => ({ id: wamidE, status, timestamp: ts(), recipient_id: wa(4), ...extra });
    assert.equal(await webhook(estados([st("read")])), 200);
    assert.equal(await webhook(estados([st("delivered", { pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" } }), st("sent")])), 200);
    assert.equal(await webhook(estados([st("read")])), 200, "duplicado");
    assert.equal(await webhook(estados([st("failed", { errors: [{ code: 131026, title: "x" }] })])), 200, "tardío");
    assert.equal(sql(`select estado_meta || '|' || (enviado_en is not null) || '|' || cobrable || '|' || coalesce(error_codigo, '-') from public.mkt_whatsapp_envios where wamid = ${lit(wamidE)}`), "leido|true|true|-");
    assert.equal(sql(`select estado || '|' || (leido_en is not null) || '|' || costo from public.mkt_campania_destinatarios where id = ${lit(idE)}`), "entregado|true|0.050000");
    assert.equal(contar(`select count(*) from public.mkt_whatsapp_eventos where wamid = ${lit(wamidE)}`), 4, "read, delivered, sent, failed: una vez cada uno");
  }
  console.log("OK — E: leído antes que entregado, duplicados y un 'failed' tardío no retroceden ni cuentan dos veces.");

  // ═══ F. Falla de la base: 500, Meta reintenta, se guarda una vez ═════════
  {
    const rpcReal = supabaseAdmin.rpc.bind(supabaseAdmin);
    let fallar = true;
    (supabaseAdmin as unknown as { rpc: unknown }).rpc = ((fn: string, args?: Record<string, unknown>) => {
      if (fn === "mkt_wa_registrar_eventos" && fallar) {
        fallar = false;
        return Promise.resolve({ data: null, error: { code: "08006", message: "conexión perdida (simulada)" } });
      }
      return rpcReal(fn, args);
    }) as typeof supabaseAdmin.rpc;
    const cuerpo = mensajes([texto(5, `wamid.F1${RUN}`, "STOP")]);
    assert.equal(await webhook(cuerpo), 500, "sin guardar no se responde 200");
    assert.equal(estadoConsent(5), "alta");
    assert.equal(await webhook(cuerpo), 200, "el reintento de Meta");
    (supabaseAdmin as unknown as { rpc: unknown }).rpc = rpcReal;
    assert.equal(estadoConsent(5), "baja");
    assert.equal(contar(`select count(*) from public.mkt_whatsapp_eventos where clave = ${lit(`mensaje:wamid.F1${RUN}`)}`), 1);
  }
  console.log("OK — F: si la base falla, 500 y nada a medias; el reintento lo guarda una vez.");

  // ═══ G. Recuperación: guardado pero sin procesar (corte) → el disparador lo procesa ══
  const G = preparar("Recuperación", [6]);
  {
    const { error } = await supabaseAdmin.rpc("mkt_wa_registrar_eventos", { p_eventos: [{
      clave: `mensaje:wamid.G1${RUN}`, tipo: "mensaje", wamid: `wamid.G1${RUN}`, wa_id: wa(6), intencion: "baja_texto", ocurrido_en: new Date().toISOString(),
    }] });
    assert.ifError(error);
    assert.equal(estadoDest(G, 6), "pendiente|", "todavía sin procesar");
    const res = await EJEC.POST(new Request(`${ORIGEN}/api/admin/marketing/campanias/ejecutar`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    assert.equal(res.status, 200);
    const j = (await res.json()) as { whatsapp: { procesados: number } };
    assert.ok(j.whatsapp.procesados >= 1);
    assert.equal(estadoConsent(6), "baja");
    assert.equal(estadoDest(G, 6), "excluido|baja_posterior");
    assert.equal((await EJEC.POST(new Request(`${ORIGEN}/api/admin/marketing/campanias/ejecutar`, { method: "POST" }))).status, 401);
  }
  console.log("OK — G: un evento guardado antes de un corte lo procesa el disparador de servidor (con secreto).");

  // ═══ H. Preferencias de Meta: stop = baja; resume aparte, sin revertir ═══
  {
    const pref = (value: string, t: number) => ({ object: "whatsapp_business_account", entry: [{ id: CUENTA, changes: [{ field: "user_preferences",
      value: { user_preferences: [{ wa_id: wa(7), detail: "x", category: "marketing_messages", value, timestamp: t }] } }] }] });
    const ahora = Math.floor(Date.now() / 1000);
    assert.equal(await webhook(pref("stop", ahora - 120)), 200);
    assert.equal(await webhook(pref("resume", ahora - 60)), 200);
    assert.equal(estadoConsent(7), "baja", "un 'resume' de Meta no borra la baja local");
    assert.equal(sql(`select ultima_preferencia || '|' || estado_local from public.mkt_whatsapp_preferencia_meta where wa_id = ${lit(wa(7))}`), "resume|baja");
    assert.equal(sql(`select (evidencia ->> 'origen') from public.mkt_consentimiento_eventos where telefono = ${lit(tel(7))} and tipo = 'baja'`), "preferencia_meta");
  }
  console.log("OK — H: user_preferences stop registra la baja; resume queda aparte y no la revierte.");

  // ═══ I. Respuesta incierta del proveedor real (transporte simulado): se conserva ══
  const I = preparar("Incierto", [8]);
  {
    let pedidos = 0;
    const cloud = crearProveedorCloud({
      transporte: async () => { pedidos++; return new Response("{}", { status: 502 }); },
      entorno: () => ({ ...process.env, MARKETING_WHATSAPP_ENVIOS_REALES: "true", MARKETING_WHATSAPP_PLANTILLA: "recuperacion_stand_v1", MARKETING_WHATSAPP_IDIOMA: "es_AR" }),
    });
    const r1 = await SRV.ejecutarLote(I, { proveedor: cloud });
    assert.ok(r1.ok && r1.valor.inciertos === 1, JSON.stringify(r1));
    assert.equal(estadoDest(I, 8), "incierto|respuesta_incierta");
    await SRV.ejecutarLote(I, { proveedor: cloud });
    await dormir(50);
    assert.equal(pedidos, 1, "un incierto no se reenvía solo");
    assert.equal(sql(`select resultado || '|' || coalesce(error_codigo, '-') from public.mkt_whatsapp_envios e join public.mkt_campania_destinatarios d on d.id = e.destinatario_id where d.campania_id = ${lit(I)}`), "incierto|http_502");
  }
  console.log("OK — I: 5xx sin código del proveedor = incierto; queda así y no se reenvía.");

  // ═══ J. Finanzas intacto y solo con eventos autenticados ══════════════════
  {
    const antes = aMeta.length;
    assert.equal(await webhook(mensajes([texto(FINANZAS, `wamid.J1${RUN}`, "cancelar")])), 200);
    assert.equal(contar(`select count(*) from public.fin_whatsapp_pendientes where message_id = ${lit(`wamid.J1${RUN}`)}`), 1);
    assert.equal(aMeta.length, antes + 1, "Finanzas responde (interceptado)");
    assert.equal(aMeta[aMeta.length - 1].body.type, "text");
    assert.equal(await webhook(mensajes([texto(FINANZAS, `wamid.J2${RUN}`, "cancelar")]), { firma: null }), 401);
    assert.equal(contar(`select count(*) from public.fin_whatsapp_pendientes where message_id = ${lit(`wamid.J2${RUN}`)}`), 0, "sin firma, Finanzas tampoco");
    assert.ok(aMeta.every((m) => m.body.type === "text"), "ningún envío de plantillas salió (solo respuestas de Finanzas, interceptadas)");
  }
  console.log("OK — J: Finanzas sigue respondiendo a los números autorizados, solo con eventos firmados.");

  // ═══ K. Diagnóstico: verificada por eventos reales, sin secretos ══════════
  {
    const sinPlantilla = (await (await DIAG.GET()).json()) as { estado: string };
    assert.equal(sinPlantilla.estado, "configuracion_incompleta", "sin la plantilla no se puede enviar: no se muestra como lista");
    Object.assign(process.env, { MARKETING_WHATSAPP_PLANTILLA: "recuperacion_stand_v1", MARKETING_WHATSAPP_IDIOMA: "es_AR" });
    const g = await DIAG.GET();
    assert.equal(g.status, 200);
    const d = (await g.json()) as Record<string, unknown> & { estado: string; config: { enviosReales: { habilitado: boolean } }; ultimos: { wa_id: string | null }[] };
    assert.equal(d.estado, "verificada");
    assert.equal(d.config.enviosReales.habilitado, false);
    const crudo = JSON.stringify(d);
    for (const s of [SECRETO, VERIFICAR, ACCESO, NUMERO, CUENTA]) assert.ok(!crudo.includes(s), "sin secretos ni IDs completos");
    for (let i = 1; i <= 8; i++) assert.ok(!crudo.includes(wa(i)), "teléfonos enmascarados");
    cookie = await createSessionToken("staff");
    assert.equal((await DIAG.GET()).status, 403, "solo admin");
    cookie = await createSessionToken("admin");
    const p = await DIAG.POST(new Request(`${ORIGEN}/api/admin/marketing/whatsapp`, { method: "POST", headers: { origin: ORIGEN, "content-type": "application/json" }, body: JSON.stringify({ accion: "reprocesar" }) }));
    assert.equal(p.status, 200);
  }
  console.log("OK — K: diagnóstico 'verificada' por eventos firmados, envíos reales bloqueados, sin secretos; solo admin.");
}

function limpiar() {
  const ids = campanias.map(lit).join(", ") || "''";
  const tels = Array.from({ length: 10 }, (_, i) => lit(tel(i))).join(", ");
  sql(`begin;
       set local session_replication_role = replica;
       delete from public.mkt_whatsapp_eventos where clave like ${lit(`%${RUN}%`)} or wa_id in (${Array.from({ length: 10 }, (_, i) => lit(wa(i))).join(", ")});
       delete from public.mkt_whatsapp_envios where campania_id in (${ids});
       delete from public.mkt_campania_eventos where campania_id in (${ids});
       delete from public.mkt_campania_destinatarios where campania_id in (${ids});
       delete from public.mkt_campanias where id in (${ids});
       delete from public.mkt_consentimiento_eventos where telefono in (${tels});
       delete from public.fin_whatsapp_pendientes where message_id like ${lit(`%${RUN}%`)};
       delete from public.mkt_textos_consentimiento where version = ${lit(TEXTO)};
       ${vigentePrevio ? `update public.mkt_textos_consentimiento set estado = 'vigente', retirado_en = null, retirado_por_rol = null where version = ${lit(vigentePrevio)};` : ""}
       update public.mkt_whatsapp_estado set webhook_verificado_en = null, ultimo_evento_firmado_en = null, rechazos = '{}'::jsonb, ultimo_error = null, ultimo_error_en = null;
       commit;`);
  assert.equal(sql(`select count(*) from public.mkt_campanias where id in (${ids})`), "0");
}

main()
  .then(() => { limpiar(); console.log("Limpieza hecha."); })
  .catch((e) => {
    console.error(e);
    try { limpiar(); } catch (err) { console.error("Limpieza falló:", err); }
    process.exit(1);
  });
