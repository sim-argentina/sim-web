import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  COOKIE_SESION, crearSesion, leerSesion, revocarSesion, hashToken, nuevoTokenSesion,
  DURACION_SESION_MS,
} from "@/lib/mensualidadSesion";
import { getMiPlan, buscarPorCodigoYTelefono } from "@/lib/mensualidadesMiPlan";

// Integración del Bloque M4 contra la DB REAL, con datos TEMPORALES que se
// ELIMINAN al final. Teléfonos con área 2966 (Río Gallegos, fuera del área de
// SIM) y códigos MEN-ZZ.. para no chocar con datos reales.
// Ejecutar:
//   npx tsx --env-file=.env.local lib/mensualidadesM4.integration.ts

const MARCA = `zzm4_${Date.now()}`;
const creados = { mensualidades: [] as string[], compras: [] as string[] };

let seq = 0;
const nuevoTel = () => `296697${String((Date.now() % 10_000) + seq++).padStart(4, "0").slice(-4)}`;
// Código con el alfabeto válido (sin 0/O/1/I).
const nuevoCodigo = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `MEN-${b()}-${b()}`;
};

async function crearMensualidad(opts: {
  telefonoNorm: string; saldo: number; diasVence: number; bloqueada?: boolean;
}) {
  const { data: hoy } = await supabaseAdmin.rpc("mensualidad_hoy");
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + opts.diasVence);
  const { data, error } = await supabaseAdmin.from("mensualidades").insert({
    codigo: nuevoCodigo(), titular_nombre: "Ana María", titular_apellido: "Pérez",
    titular_telefono: opts.telefonoNorm, telefono_norm: opts.telefonoNorm,
    titular_email: `${MARCA}@test.local`, saldo_minutos: opts.saldo,
    vence_el: d.toISOString().slice(0, 10), bloqueada: opts.bloqueada ?? false,
    bloqueo_motivo: opts.bloqueada ? "MOTIVO INTERNO CONFIDENCIAL" : null,
  }).select("id, codigo, vence_el").single();
  if (error) throw new Error(`crearMensualidad: ${error.message}`);
  creados.mensualidades.push(data.id);
  return data as { id: string; codigo: string; vence_el: string };
}

async function limpiar() {
  const ids = Array.from(new Set(creados.mensualidades));
  if (creados.compras.length) {
    await supabaseAdmin.from("mensualidad_compras").delete().in("id", creados.compras);
  }
  if (ids.length) {
    await supabaseAdmin.from("mensualidad_sesiones").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidad_movimientos").delete().in("mensualidad_id", ids);
    await supabaseAdmin.from("mensualidades").delete().in("id", ids);
  }
}

// Llama a un route handler con cookie opcional.
let ipSeq = 0;
function pedido(url: string, opts: { metodo?: string; cookie?: string; body?: unknown; ip?: string } = {}) {
  // Cada llamada usa una IP distinta: el rate limit real (8/min) es correcto y se
  // prueba aparte; acá no debe cortar el recorrido de los demás escenarios.
  const headers: Record<string, string> = {
    origin: "https://simexperience.com.ar",
    "x-real-ip": opts.ip ?? `10.4.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`,
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = `${COOKIE_SESION}=${opts.cookie}`;
  return new Request(`https://simexperience.com.ar${url}`, {
    method: opts.metodo ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

function cookieDe(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const m = raw.match(new RegExp(`${COOKIE_SESION}=([^;]*)`));
  return m ? m[1] : null;
}

async function main() {
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;
  const { POST: postSesion, DELETE: deleteSesion } = await import("@/app/api/mensualidades/sesion/route");
  const { GET: getMiPlanRoute } = await import("@/app/api/mensualidades/mi-plan/route");

  // ── M4-1 · Con la flag apagada no se puede identificar ───────────────────
  delete process.env.MENSUALIDADES_ENABLED;
  const mFlag = await crearMensualidad({ telefonoNorm: nuevoTel(), saldo: 120, diasVence: 20 });
  const resFlagOff = await postSesion(pedido("/api/mensualidades/sesion", {
    metodo: "POST", body: { codigo: mFlag.codigo, telefono: mFlag.id ? "2966970000" : "" },
  }));
  assert.equal(resFlagOff.status, 404, "M4-1 con la flag apagada el endpoint no existe");
  assert.equal((await resFlagOff.json()).error, "No encontrado", "M4-1 respuesta neutral");
  assert.equal(cookieDe(resFlagOff), null, "M4-1 no se entrega cookie");
  console.log("M4-1 flag apagada bloquea accesos nuevos OK");

  process.env.MENSUALIDADES_ENABLED = "true";

  // ── M4-2 · Identificación correcta con los tres formatos de teléfono ─────
  const telOk = nuevoTel();
  const mOk = await crearMensualidad({ telefonoNorm: telOk, saldo: 150, diasVence: 20 });
  // El teléfono canónico 2966xxxxxx se puede escribir de varias formas.
  const formatos = [telOk, `0${telOk.slice(0, 4)} 15-${telOk.slice(4)}`, `+54 9 ${telOk.slice(0, 4)} ${telOk.slice(4)}`];
  const cookies: string[] = [];
  for (const tel of formatos) {
    const res = await postSesion(pedido("/api/mensualidades/sesion", {
      metodo: "POST", body: { codigo: mOk.codigo, telefono: tel },
    }));
    assert.equal(res.status, 200, `M4-2 debería identificar con "${tel}"`);
    const c = cookieDe(res);
    assert.ok(c && c.length >= 40, "M4-2 la cookie trae un token con entropía");
    cookies.push(c!);
    // La cookie es HttpOnly y no cachea.
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.ok(/HttpOnly/i.test(setCookie), "M4-2 la cookie debe ser HttpOnly");
    assert.ok(/SameSite=Lax/i.test(setCookie), "M4-2 SameSite=Lax");
    assert.ok(/no-store/i.test(res.headers.get("cache-control") ?? ""), "M4-2 sin cache");
    // El cuerpo NO trae datos.
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ["ok"], "M4-2 la respuesta no lleva datos ni PII");
  }
  // El código también se acepta escrito de cualquier forma.
  const resCodigoSuelto = await postSesion(pedido("/api/mensualidades/sesion", {
    metodo: "POST", body: { codigo: mOk.codigo.replace(/-/g, "").toLowerCase(), telefono: telOk },
  }));
  assert.equal(resCodigoSuelto.status, 200, "M4-2 el código se normaliza");
  console.log("M4-2 identificación con formatos equivalentes OK");

  // ── M4-3 · Sesiones nuevas revocan la del MISMO navegador, no otras ──────
  // cookies[0] se creó sin cookie previa; cookies[1] se creó mandando... nada,
  // así que las tres siguen vivas: son "dispositivos" distintos.
  for (const c of cookies) {
    assert.ok(await leerSesion(c), "M4-3 las sesiones de otros dispositivos siguen vivas");
  }
  // Ahora sí, con la cookie anterior en el pedido: se revoca solo esa.
  const resReemplazo = await postSesion(pedido("/api/mensualidades/sesion", {
    metodo: "POST", cookie: cookies[0], body: { codigo: mOk.codigo, telefono: telOk },
  }));
  assert.equal(resReemplazo.status, 200);
  const cookieNueva = cookieDe(resReemplazo)!;
  assert.equal(await leerSesion(cookies[0]), null, "M4-3 la sesión del mismo navegador se revoca");
  assert.ok(await leerSesion(cookies[1]), "M4-3 la de otro dispositivo NO se toca");
  assert.ok(await leerSesion(cookieNueva), "M4-3 la sesión nueva funciona");
  console.log("M4-3 reemplazo de sesión por navegador OK");

  // ── M4-4 · Credenciales inválidas: SIEMPRE la misma respuesta ────────────
  const telAjeno = nuevoTel();
  await crearMensualidad({ telefonoNorm: telAjeno, saldo: 60, diasVence: 10 });
  const casosMalos: Array<[string, unknown, unknown]> = [
    ["código inexistente", nuevoCodigo(), telOk],
    ["teléfono de otra mensualidad", mOk.codigo, telAjeno],
    ["teléfono inválido", mOk.codigo, "1234"],
    ["teléfono extranjero", mOk.codigo, "+1 555 123 4567"],
    ["código con formato inválido", "MEN-ABC0-2345", telOk],
    ["código vacío", "", telOk],
    ["teléfono vacío", mOk.codigo, ""],
    ["campos ausentes", undefined, undefined],
  ];
  const respuestas = new Set<string>();
  for (const [nota, codigo, telefono] of casosMalos) {
    const res = await postSesion(pedido("/api/mensualidades/sesion", {
      metodo: "POST", body: { codigo, telefono },
    }));
    assert.equal(res.status, 401, `M4-4 ${nota} debería dar 401`);
    assert.equal(cookieDe(res), null, `M4-4 ${nota} no debe entregar cookie`);
    respuestas.add(JSON.stringify(await res.json()));
  }
  assert.equal(respuestas.size, 1, "M4-4 todos los fallos devuelven EXACTAMENTE el mismo mensaje");
  const [unico] = [...respuestas];
  assert.ok(!unico.toLowerCase().includes("codigo") || !unico.toLowerCase().includes("existe"),
    "M4-4 el mensaje no puede decir cuál de los dos datos falló");
  console.log("M4-4 respuesta neutral e indistinguible OK");

  // ── M4-5 · Validaciones de transporte ────────────────────────────────────
  const sinCt = new Request("https://simexperience.com.ar/api/mensualidades/sesion", {
    method: "POST", headers: { origin: "https://simexperience.com.ar" },
    body: JSON.stringify({ codigo: mOk.codigo, telefono: telOk }),
  });
  assert.equal((await postSesion(sinCt)).status, 415, "M4-5 Content-Type obligatorio");
  const enorme = await postSesion(new Request("https://simexperience.com.ar/api/mensualidades/sesion", {
    method: "POST", headers: { origin: "https://simexperience.com.ar", "content-type": "application/json" },
    body: "x".repeat(2000),
  }));
  assert.equal(enorme.status, 413, "M4-5 body acotado");
  const ajeno = await postSesion(new Request("https://simexperience.com.ar/api/mensualidades/sesion", {
    method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ codigo: mOk.codigo, telefono: telOk }),
  }));
  assert.equal(ajeno.status, 403, "M4-5 origen ajeno rechazado");
  console.log("M4-5 Content-Type, tamaño y origen OK");

  // ── M4-5b · El rate limit estricto corta la fuerza bruta ────────────────
  // Misma IP para todos: identificarse es adivinable si no se limita.
  const ipFuerzaBruta = "10.99.99.99";
  let corto = 0;
  for (let i = 0; i < 14; i++) {
    const res = await postSesion(pedido("/api/mensualidades/sesion", {
      metodo: "POST", ip: ipFuerzaBruta, body: { codigo: nuevoCodigo(), telefono: telOk },
    }));
    if (res.status === 429) corto++;
  }
  assert.ok(corto > 0, "M4-5b el rate limit tiene que cortar los intentos repetidos");
  console.log(`M4-5b rate limit corta la fuerza bruta OK (${corto}/14 bloqueados)`);

  // ── M4-6 · La base guarda el HASH, nunca el token ───────────────────────
  const { data: filas } = await supabaseAdmin
    .from("mensualidad_sesiones").select("token_hash").eq("mensualidad_id", mOk.id);
  assert.ok((filas ?? []).length > 0);
  for (const f of filas ?? []) {
    assert.match(String(f.token_hash), /^[a-f0-9]{64}$/, "M4-6 solo hashes en la base");
    for (const c of [...cookies, cookieNueva]) {
      assert.notEqual(String(f.token_hash), c, "M4-6 el token NO puede estar guardado");
    }
  }
  assert.ok((filas ?? []).some((f) => String(f.token_hash) === hashToken(cookieNueva)),
    "M4-6 el hash guardado corresponde al token entregado");
  console.log("M4-6 solo se persiste el hash OK");

  // ── M4-7 · /api/mensualidades/mi-plan con y sin sesión ──────────────────
  const sinCookie = await getMiPlanRoute(pedido("/api/mensualidades/mi-plan"));
  assert.equal(sinCookie.status, 404, "M4-7 sin sesión no revela la función");
  assert.equal((await sinCookie.json()).error, "No encontrado");

  const tokenInventado = nuevoTokenSesion();
  const conBasura = await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: tokenInventado }));
  assert.equal(conBasura.status, 404, "M4-7 un token inventado no sirve");
  assert.ok(/max-age=0/i.test(conBasura.headers.get("set-cookie") ?? ""),
    "M4-7 una cookie inservible se borra");

  const conSesion = await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: cookieNueva }));
  assert.equal(conSesion.status, 200);
  const plan = await conSesion.json();
  assert.equal(plan.codigo, mOk.codigo);
  assert.equal(plan.estado, "vigente");
  assert.equal(plan.saldo_minutos, 150);
  assert.equal(plan.saldo_texto, "2 h 30 min", "M4-7 saldo también en horas y minutos");
  assert.equal(plan.nombre, "Ana", "M4-7 saluda solo con el nombre, sin apellido");
  assert.equal(plan.puede_reservar, true);
  assert.equal(plan.motivo, "ok");
  console.log("M4-7 endpoint de consulta OK");

  // ── M4-8 · Lo que NO debe salir nunca ────────────────────────────────────
  const prohibidos = [
    "id", "mensualidad_id", "titular_apellido", "apellido", "titular_email", "email",
    "telefono", "telefono_norm", "titular_telefono", "bloqueo_motivo", "observaciones",
    "external_reference", "mp_payment_id", "mp_preference_id", "importe_bruto",
    "comision_mp", "importe_neto", "movimientos", "auditoria", "created_at", "updated_at",
  ];
  for (const campo of prohibidos) {
    assert.equal(campo in plan, false, `M4-8 la respuesta no debe exponer "${campo}"`);
  }
  const crudo = JSON.stringify(plan);
  assert.ok(!crudo.includes(telOk), "M4-8 el teléfono no puede aparecer");
  assert.ok(!crudo.includes(MARCA), "M4-8 el email no puede aparecer");
  assert.ok(!crudo.includes("Pérez"), "M4-8 el apellido no puede aparecer");
  assert.ok(!crudo.includes(mOk.id), "M4-8 los ids internos no pueden aparecer");
  console.log("M4-8 sin PII ni datos internos OK");

  // ── M4-9 · Los cuatro estados se pueden consultar ────────────────────────
  const escenarios: Array<[string, { saldo: number; diasVence: number; bloqueada?: boolean }, string, boolean, string]> = [
    ["vigente",   { saldo: 120, diasVence: 15 },                  "vigente",   true,  "ok"],
    ["agotada",   { saldo: 0, diasVence: 15 },                    "agotada",   false, "sin_saldo"],
    ["vencida",   { saldo: 45, diasVence: -3 },                   "vencida",   false, "vencida"],
    ["bloqueada", { saldo: 90, diasVence: 15, bloqueada: true },  "bloqueada", false, "bloqueada"],
  ];
  for (const [nota, opts, estadoEsperado, puede, motivo] of escenarios) {
    const tel = nuevoTel();
    const m = await crearMensualidad({ telefonoNorm: tel, ...opts });
    // Identificarse NO exige estar vigente.
    const res = await postSesion(pedido("/api/mensualidades/sesion", {
      metodo: "POST", body: { codigo: m.codigo, telefono: tel },
    }));
    assert.equal(res.status, 200, `M4-9 debería poder identificarse una mensualidad ${nota}`);
    const c = cookieDe(res)!;
    const datos = await (await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: c }))).json();
    assert.equal(datos.estado, estadoEsperado, `M4-9 estado de ${nota}`);
    assert.equal(datos.puede_reservar, puede, `M4-9 puede_reservar de ${nota}`);
    assert.equal(datos.motivo, motivo, `M4-9 motivo de ${nota}`);
    assert.equal(datos.saldo_minutos, opts.saldo, `M4-9 ${nota} muestra su saldo`);
    assert.ok(datos.vence_el, `M4-9 ${nota} muestra el vencimiento`);
    if (opts.bloqueada) {
      assert.ok(!JSON.stringify(datos).includes("CONFIDENCIAL"),
        "M4-9 el motivo interno del bloqueo NO puede salir");
    }
  }
  console.log("M4-9 los cuatro estados consultables OK");

  // ── M4-10 · El estado sale de la vista calculada, no de un campo viejo ──
  const telCalc = nuevoTel();
  const mCalc = await crearMensualidad({ telefonoNorm: telCalc, saldo: 60, diasVence: 5 });
  assert.equal((await getMiPlan(mCalc.id))?.estado, "vigente");
  // Se vence sin tocar ningún "estado" persistido: el cálculo tiene que seguirlo.
  const { data: hoy2 } = await supabaseAdmin.rpc("mensualidad_hoy");
  const ayer = new Date(`${hoy2}T12:00:00Z`);
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  await supabaseAdmin.from("mensualidades")
    .update({ vence_el: ayer.toISOString().slice(0, 10) }).eq("id", mCalc.id);
  assert.equal((await getMiPlan(mCalc.id))?.estado, "vencida", "M4-10 el estado se recalcula solo");
  await supabaseAdmin.from("mensualidades").update({ saldo_minutos: 0 }).eq("id", mCalc.id);
  assert.equal((await getMiPlan(mCalc.id))?.estado, "vencida", "M4-10 vencida gana sobre agotada");
  await supabaseAdmin.from("mensualidades").update({ bloqueada: true }).eq("id", mCalc.id);
  assert.equal((await getMiPlan(mCalc.id))?.estado, "bloqueada", "M4-10 bloqueada gana sobre todo");
  console.log("M4-10 estado calculado OK");

  // ── M4-11 · Cerrar sesión ────────────────────────────────────────────────
  const resSalir = await deleteSesion(pedido("/api/mensualidades/sesion", {
    metodo: "DELETE", cookie: cookieNueva,
  }));
  assert.equal(resSalir.status, 200);
  assert.ok(/max-age=0/i.test(resSalir.headers.get("set-cookie") ?? ""), "M4-11 la cookie se borra");
  assert.equal(await leerSesion(cookieNueva), null, "M4-11 la sesión queda revocada");
  const trasSalir = await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: cookieNueva }));
  assert.equal(trasSalir.status, 404, "M4-11 después de salir no se puede consultar");
  // Cerrar sesión sin cookie no explota.
  assert.equal((await deleteSesion(pedido("/api/mensualidades/sesion", { metodo: "DELETE" }))).status, 200);
  console.log("M4-11 cierre de sesión OK");

  // ── M4-12 · Sesión vencida y revocada ────────────────────────────────────
  const tokenVenc = await crearSesion(mOk.id);
  assert.ok(tokenVenc);
  await supabaseAdmin.from("mensualidad_sesiones")
    .update({ creada_at: new Date(Date.now() - 2 * DURACION_SESION_MS).toISOString(),
              expira_at: new Date(Date.now() - 1000).toISOString() })
    .eq("token_hash", hashToken(tokenVenc!));
  assert.equal(await leerSesion(tokenVenc), null, "M4-12 una sesión vencida no sirve");
  assert.equal((await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: tokenVenc! }))).status, 404);

  const tokenRev = await crearSesion(mOk.id);
  await revocarSesion(tokenRev!);
  assert.equal(await leerSesion(tokenRev), null, "M4-12 una sesión revocada no sirve");

  // Consultar NO extiende la sesión (duración absoluta).
  const tokenAbs = await crearSesion(mOk.id);
  const { data: antes } = await supabaseAdmin
    .from("mensualidad_sesiones").select("expira_at").eq("token_hash", hashToken(tokenAbs!)).single();
  await leerSesion(tokenAbs);
  await leerSesion(tokenAbs);
  const { data: despues } = await supabaseAdmin
    .from("mensualidad_sesiones").select("expira_at, ultimo_uso_at").eq("token_hash", hashToken(tokenAbs!)).single();
  assert.equal(despues?.expira_at, antes?.expira_at, "M4-12 consultar NO renueva la sesión");
  assert.ok(despues?.ultimo_uso_at, "M4-12 se registra el último uso");
  console.log("M4-12 vencimiento, revocación y duración absoluta OK");

  // ── M4-13 · Una sesión sirve para UNA sola mensualidad ───────────────────
  const telOtra = nuevoTel();
  const mOtra = await crearMensualidad({ telefonoNorm: telOtra, saldo: 30, diasVence: 10 });
  const tokenOtra = await crearSesion(mOtra.id);
  const datosOtra = await (await getMiPlanRoute(pedido("/api/mensualidades/mi-plan", { cookie: tokenOtra! }))).json();
  assert.equal(datosOtra.codigo, mOtra.codigo, "M4-13 cada sesión ve solo su mensualidad");
  assert.notEqual(datosOtra.codigo, mOk.codigo);
  console.log("M4-13 aislamiento entre sesiones OK");

  // ── M4-14 · buscarPorCodigoYTelefono exige las dos cosas ────────────────
  assert.equal(await buscarPorCodigoYTelefono(mOk.codigo, telOk), mOk.id);
  assert.equal(await buscarPorCodigoYTelefono(mOk.codigo, telAjeno), null, "M4-14 teléfono ajeno no entra");
  assert.equal(await buscarPorCodigoYTelefono(nuevoCodigo(), telOk), null, "M4-14 código ajeno no entra");
  console.log("M4-14 código + teléfono obligatorios OK");

  // ── M4-15 · anon sin acceso a la tabla de sesiones ──────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(url && anonKey, "M4-15 faltan credenciales anon en .env.local");
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  for (const tabla of ["mensualidad_sesiones", "mensualidades", "mensualidades_estado"]) {
    const { data, error } = await anon.from(tabla).select("*").limit(1);
    assert.ok(error || (data ?? []).length === 0, `M4-15 anon pudo leer ${tabla}`);
  }
  const { error: insAnon } = await anon.from("mensualidad_sesiones").insert({
    mensualidad_id: mOk.id, token_hash: "a".repeat(64),
    expira_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.ok(insAnon, "M4-15 anon pudo crear una sesión");
  console.log("M4-15 anon sin acceso OK");

  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  else delete process.env.MENSUALIDADES_ENABLED;

  console.log("\nTODOS LOS TESTS DE INTEGRACIÓN M4 OK");
}

main()
  .catch((e) => { console.error("\nFALLÓ:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => {
    await limpiar();
    const { count } = await supabaseAdmin
      .from("mensualidades").select("*", { count: "exact", head: true })
      .like("titular_email", `${MARCA}%`);
    console.log(`limpieza: ${count ?? 0} mensualidades temporales restantes (debe ser 0)`);
  });
