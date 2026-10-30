import { strict as assert } from "node:assert";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

// Firma de los webhooks de Mercado Pago: falla cerrada sin secreto y compatibilidad
// con el formato oficial.
// Ejecutar: npx tsx lib/mercadopagoFirma.test.ts
//
// NO toca nada real: la red queda bloqueada (cada intento de fetch se cuenta y falla),
// la base apunta a un puerto loopback cerrado, la consulta del pago a Mercado Pago se
// intercepta y la firma usa un secreto DESCARTABLE. Se ejercitan las cuatro rutas reales.

// Entorno descartable ANTES de importar nada que lea la configuración (la regresión
// segura corre con --env-file=.env.local: esto pisa esas variables en este proceso).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-descartable-sin-uso";
process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-firma-sin-red";
for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];

const red: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  red.push(String(input).slice(0, 40));
  throw new Error("el test no usa la red");
}) as typeof fetch;

const errores: string[] = [];
const avisos: string[] = [];
console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

// Réplica literal de buildManifest del validador oficial (mercadopago 3.6.1,
// dist/utils/webhook): los pares ausentes se omiten. El data.id llega en minúsculas,
// como indica la documentación para ids alfanuméricos.
function manifiestoOficial(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return parts.join(";") + ";";
}
const firmaOficial = (secreto: string, dataId: string, requestId: string | undefined, ts: string) =>
  createHmac("sha256", secreto).update(manifiestoOficial(dataId.toLowerCase(), requestId, ts)).digest("hex");

let ip = 0;
function notificacion(ruta: string, o: { id: string; firma?: string; requestId?: string; tipo?: string }): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": `10.77.0.${++ip}` };
  if (o.firma !== undefined) headers["x-signature"] = o.firma;
  if (o.requestId !== undefined) headers["x-request-id"] = o.requestId;
  const tipo = o.tipo ?? "payment";
  return new Request(`https://simexperience.com.ar${ruta}?data.id=${encodeURIComponent(o.id)}&type=${tipo}`, {
    method: "POST", headers,
    body: JSON.stringify({ id: 1, live_mode: true, type: tipo, action: `${tipo}.updated`, api_version: "v1", data: { id: o.id } }),
  });
}

async function main() {
  const SECRETO = randomBytes(24).toString("hex");
  const { verifyMpWebhook } = await import("@/lib/mercadopago");

  // ── 1) Sin secreto: falla cerrada, con error de configuración sin datos ────────────
  {
    for (const valor of [undefined, "", "   "]) {
      if (valor === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      else process.env.MERCADOPAGO_WEBHOOK_SECRET = valor;
      errores.length = 0;
      const id = "123456789", rid = randomUUID(), ts = String(Math.floor(Date.now() / 1000));
      const firma = `ts=${ts},v1=${firmaOficial(SECRETO, id, rid, ts)}`;
      const req = notificacion("/api/mercadopago/webhook", { id, firma, requestId: rid });
      assert.equal(verifyMpWebhook(req, id), false, `sin secreto (${JSON.stringify(valor)}) se rechaza`);
      assert.equal(errores.length, 1, "se registra un error de configuración");
      assert.ok(errores[0].includes("MERCADOPAGO_WEBHOOK_SECRET no configurado"), errores[0]);
      for (const dato of [id, rid, ts, firma]) assert.ok(!errores[0].includes(dato), "el registro no lleva datos de la solicitud");
    }
  }
  console.log("OK — firma MP (1): sin secreto la notificación se rechaza y queda un error de configuración sin datos.");

  // ── 2) Con secreto: formato oficial aceptado ───────────────────────────────────────
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
  {
    const ts = String(Math.floor(Date.now() / 1000));
    const casos: Array<[string, string, string | undefined]> = [
      ["pago numérico", "1325461791", randomUUID()],
      ["id alfanumérico en mayúsculas (orders)", "ORD01M28P44G5FG8RJPM579EH56FV", randomUUID()],
      ["sin x-request-id (el par se omite)", "1325461792", undefined],
    ];
    for (const [nombre, id, rid] of casos) {
      const req = notificacion("/api/mercadopago/webhook", { id, requestId: rid, firma: `ts=${ts},v1=${firmaOficial(SECRETO, id, rid, ts)}` });
      assert.equal(verifyMpWebhook(req, id), true, nombre);
    }
    const id = "1325461793", rid = randomUUID(), v1 = firmaOficial(SECRETO, id, rid, ts);
    const conEspacios = notificacion("/api/mercadopago/webhook", { id, requestId: rid, firma: ` ts=${ts} , v1=${v1} , v2=otra-version` });
    assert.equal(verifyMpWebhook(conEspacios, id), true, "espacios y versiones desconocidas se toleran como en el validador oficial");
    const secretoConSalto = notificacion("/api/mercadopago/webhook", { id, requestId: rid, firma: `ts=${ts},v1=${v1}` });
    process.env.MERCADOPAGO_WEBHOOK_SECRET = `${SECRETO}\n`;
    assert.equal(verifyMpWebhook(secretoConSalto, id), true, "un salto de línea al final de la variable no rompe la firma");
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
  }
  console.log("OK — firma MP (2): se aceptan las firmas armadas con la regla oficial (incluido sin x-request-id).");

  // ── 3) Con secreto: todo lo que no es la firma exacta se rechaza ───────────────────
  {
    const ts = String(Math.floor(Date.now() / 1000));
    const id = "1325461794", rid = randomUUID(), v1 = firmaOficial(SECRETO, id, rid, ts);
    const ruta = "/api/mercadopago/webhook";
    const rechazos: Array<[string, Request, string]> = [
      ["sin x-signature", notificacion(ruta, { id, requestId: rid }), id],
      ["v1 alterado", notificacion(ruta, { id, requestId: rid, firma: `ts=${ts},v1=${v1.slice(0, -1)}0` }), id],
      ["v1 de otro largo", notificacion(ruta, { id, requestId: rid, firma: `ts=${ts},v1=00` }), id],
      ["sin ts", notificacion(ruta, { id, requestId: rid, firma: `v1=${v1}` }), id],
      ["ts no numérico", notificacion(ruta, { id, requestId: rid, firma: `ts=abc,v1=${v1}` }), id],
      ["sin v1", notificacion(ruta, { id, requestId: rid, firma: `ts=${ts}` }), id],
      ["otro ts", notificacion(ruta, { id, requestId: rid, firma: `ts=${Number(ts) + 1},v1=${v1}` }), id],
      ["otro request-id", notificacion(ruta, { id, requestId: randomUUID(), firma: `ts=${ts},v1=${v1}` }), id],
      ["firma reutilizada para otro pago", notificacion(ruta, { id: "999", requestId: rid, firma: `ts=${ts},v1=${v1}` }), "999"],
      ["firma con otro secreto", notificacion(ruta, { id, requestId: rid, firma: `ts=${ts},v1=${firmaOficial("otro", id, rid, ts)}` }), id],
      ["sin data.id", notificacion(ruta, { id, requestId: rid, firma: `ts=${ts},v1=${v1}` }), ""],
    ];
    for (const [nombre, req, dataId] of rechazos) assert.equal(verifyMpWebhook(req, dataId), false, nombre);
  }
  console.log("OK — firma MP (3): firmas ausentes, mal formadas, alteradas, reutilizadas o de otro secreto se rechazan.");

  // ── 4) Las cuatro rutas reales: sin efectos cuando no hay firma válida ─────────────
  const { Payment } = await import("mercadopago");
  const consultas: string[] = [];
  (Payment.prototype as unknown as { get: (a: { id: string }) => Promise<unknown> }).get = async ({ id }) => {
    consultas.push(String(id));
    // Pago pendiente de otro producto: cada ruta lo descarta antes de tocar la base.
    return { id: Number(id), status: "pending", external_reference: "zz_otro_producto", transaction_amount: 1, currency_id: "ARS" };
  };
  const RUTAS: Array<[string, string]> = [
    ["/api/mercadopago/webhook", "@/app/api/mercadopago/webhook/route"],
    ["/api/gift-cards/webhook", "@/app/api/gift-cards/webhook/route"],
    ["/api/mensualidades/webhook", "@/app/api/mensualidades/webhook/route"],
    ["/api/campeonatos/webhook", "@/app/api/campeonatos/webhook/route"],
  ];
  for (const [ruta, modulo] of RUTAS) {
    const { POST } = (await import(modulo)) as { POST: (r: Request) => Promise<Response> };
    const ts = String(Math.floor(Date.now() / 1000));
    const id = String(1_400_000_000 + ip), rid = randomUUID();
    const valida = `ts=${ts},v1=${firmaOficial(SECRETO, id, rid, ts)}`;
    const antes = () => ({ mp: consultas.length, red: red.length });

    // a) Sin secreto, aun con una firma bien armada: 401, ni Mercado Pago ni base.
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    errores.length = 0;
    let a = antes();
    let r = await POST(notificacion(ruta, { id, requestId: rid, firma: valida }));
    assert.equal(r.status, 401, `${ruta}: sin secreto → 401`);
    assert.deepEqual(antes(), a, `${ruta}: sin secreto no consulta el pago ni la base`);
    assert.ok(errores.some((e) => e.includes("MERCADOPAGO_WEBHOOK_SECRET no configurado")), `${ruta}: registra el error de configuración`);

    // b) Sin secreto, notificación que no es de pagos: igual que siempre (200, nada).
    a = antes();
    r = await POST(notificacion(ruta, { id, requestId: rid, firma: valida, tipo: "merchant_order" }));
    assert.equal(r.status, 200, `${ruta}: merchant_order se acepta sin procesar`);
    assert.deepEqual(antes(), a, `${ruta}: merchant_order no consulta nada`);

    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
    // c) Firma inválida y sin firma: 401 sin efectos.
    for (const firma of [`ts=${ts},v1=${"0".repeat(64)}`, undefined]) {
      a = antes();
      r = await POST(notificacion(ruta, { id, requestId: rid, firma }));
      assert.equal(r.status, 401, `${ruta}: firma ${firma ? "inválida" : "ausente"} → 401`);
      assert.deepEqual(antes(), a, `${ruta}: firma ${firma ? "inválida" : "ausente"} no consulta el pago ni la base`);
    }

    // d) Firma válida (formato oficial): consulta el pago UNA vez y lo descarta (otro producto).
    a = antes();
    r = await POST(notificacion(ruta, { id, requestId: rid, firma: valida }));
    assert.equal(r.status, 200, `${ruta}: firma válida → 200`);
    assert.equal(consultas.length, a.mp + 1, `${ruta}: con firma válida consulta el pago`);
    assert.equal(consultas.at(-1), id, `${ruta}: consulta exactamente el pago firmado`);
    assert.equal(red.length, a.red, `${ruta}: un pago de otro producto no toca la base`);
  }
  assert.equal(red.length, 0, "ningún caso intentó salir a la red");
  console.log("OK — firma MP (4): las cuatro rutas rechazan sin efectos (sin secreto, firma inválida o ausente) y procesan la firma válida.");
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
