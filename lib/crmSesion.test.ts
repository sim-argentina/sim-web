import { strict as assert } from "node:assert";
import { createHmac, randomUUID } from "node:crypto";

// Ejecutar: npx tsx lib/crmSesion.test.ts
// Sesión comercial del CRM (B0), pura: firma, tipo, identidad, versión,
// vencimiento, configuración y tokens cruzados con la sesión del panel.

const SECRETO_CRM = "c".repeat(48);
const SECRETO_PANEL = "p".repeat(48);
process.env.CRM_SESSION_SECRET = SECRETO_CRM;
process.env.ADMIN_SESSION_SECRET = SECRETO_PANEL;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const firmar = (clave: string, payload: string) =>
  createHmac("sha256", clave).update(`sim-crm-sesion-comercial-v1.${payload}`).digest("base64url");
const tokenCon = (datos: unknown, clave = SECRETO_CRM) => {
  const p = b64(datos);
  return `crm1.${p}.${firmar(clave, p)}`;
};

async function main() {
  const S = await import("@/lib/crmSesion");
  const P = await import("@/lib/adminSession");
  const ahora = Date.now();
  const uid = randomUUID();

  // ── 1) Ida y vuelta ─────────────────────────────────────────────────────
  const t = S.crearTokenComercial(uid, 3, ahora);
  assert.ok(t.startsWith("crm1.") && t.split(".").length === 3, "formato crm1.<payload>.<firma>");
  const s = S.verificarTokenComercial(t, ahora);
  assert.deepEqual(s && { uid: s.uid, sv: s.sv }, { uid, sv: 3 }, "verifica uid y versión");
  assert.equal(s!.exp - s!.iat, S.CRM_SESION_MAX_MS, "vence a los 7 días");

  // ── 2) Manipulaciones ───────────────────────────────────────────────────
  const [pre, payload, firma] = t.split(".");
  const otroPayload = b64({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sv: 99 });
  assert.equal(S.verificarTokenComercial(`${pre}.${otroPayload}.${firma}`, ahora), null, "payload cambiado sin refirmar");
  const firmaRota = (firma[0] === "A" ? "B" : "A") + firma.slice(1);
  assert.equal(S.verificarTokenComercial(`${pre}.${payload}.${firmaRota}`, ahora), null, "firma cambiada");
  assert.equal(S.verificarTokenComercial(`crm2.${payload}.${firma}`, ahora), null, "otro prefijo");
  assert.equal(S.verificarTokenComercial(`${payload}.${firma}`, ahora), null, "dos partes (formato del panel)");
  assert.equal(S.verificarTokenComercial(`${t}.x`, ahora), null, "cuatro partes");
  assert.equal(S.verificarTokenComercial("", ahora), null, "vacío");
  assert.equal(S.verificarTokenComercial(undefined, ahora), null, "ausente");
  assert.equal(S.verificarTokenComercial("crm1." + "a".repeat(2000) + ".b", ahora), null, "demasiado largo");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid, sv: 3, iat: ahora, exp: ahora + 1000 }, "x".repeat(48)), ahora), null, "firmado con otra clave");

  // ── 3) Vencimiento y reloj ──────────────────────────────────────────────
  const viejo = S.crearTokenComercial(uid, 3, ahora - S.CRM_SESION_MAX_MS - 1000);
  assert.equal(S.verificarTokenComercial(viejo, ahora), null, "vencido");
  const futuro = S.crearTokenComercial(uid, 3, ahora + 5 * 60_000);
  assert.equal(S.verificarTokenComercial(futuro, ahora), null, "emitido en el futuro (más allá de la tolerancia)");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid, sv: 3, iat: ahora, exp: ahora + S.CRM_SESION_MAX_MS + 60_000 }), ahora), null, "vigencia más larga que la permitida");

  // ── 4) Tipo, identidad y versión (bien firmados, contenido inválido) ────
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "admin", uid, sv: 3, iat: ahora, exp: ahora + 1000 }), ahora), null, "tipo incorrecto");
  assert.equal(S.verificarTokenComercial(tokenCon({ role: "admin", exp: ahora + 1000 }), ahora), null, "payload del panel firmado como comercial");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid: "no-es-uuid", sv: 3, iat: ahora, exp: ahora + 1000 }), ahora), null, "uid inválido");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid, sv: 0, iat: ahora, exp: ahora + 1000 }), ahora), null, "versión 0");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid, sv: 2.5, iat: ahora, exp: ahora + 1000 }), ahora), null, "versión no entera");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid, sv: "3", iat: ahora, exp: ahora + 1000 }), ahora), null, "versión como texto");
  assert.throws(() => S.crearTokenComercial("no-es-uuid", 1), "no firma un uid inválido");
  assert.throws(() => S.crearTokenComercial(uid, 0), "no firma la versión 0");

  // ── 5) Tokens cruzados con el panel ─────────────────────────────────────
  const admin = await P.createSessionToken("admin");
  const staff = await P.createSessionToken("staff");
  assert.equal(S.verificarTokenComercial(admin, ahora), null, "un token admin no es comercial");
  assert.equal(S.verificarTokenComercial(staff, ahora), null, "un token staff no es comercial");
  assert.equal(await P.verifySessionToken(t), null, "un token comercial no es del panel");
  // Un token con el formato del panel y role "comercial", firmado con la clave del
  // panel: verifySessionToken lo rechaza (sigue admitiendo solo admin|staff).
  const payloadPanel = Buffer.from(JSON.stringify({ role: "comercial", exp: ahora + 60_000 })).toString("base64url");
  const firmaPanel = createHmac("sha256", SECRETO_PANEL).update(payloadPanel).digest("base64url");
  assert.equal(await P.verifySessionToken(`${payloadPanel}.${firmaPanel}`), null, "el panel no admite role comercial");
  assert.equal(await P.verifySessionToken(admin), "admin", "control: el token admin sigue valiendo en el panel");

  // ── 6) Configuración: falla cerrada ─────────────────────────────────────
  process.env.CRM_SESSION_SECRET = "";
  assert.equal(S.sesionComercialConfigurada(), false, "sin clave");
  assert.throws(() => S.crearTokenComercial(uid, 1), "sin clave no firma");
  assert.equal(S.verificarTokenComercial(t, ahora), null, "sin clave no acepta");
  process.env.CRM_SESSION_SECRET = "corta";
  assert.equal(S.sesionComercialConfigurada(), false, "clave corta");
  process.env.CRM_SESSION_SECRET = SECRETO_PANEL;
  assert.equal(S.sesionComercialConfigurada(), false, "la misma clave del panel no sirve");
  assert.equal(S.verificarTokenComercial(tokenCon({ t: "crm_comercial", uid, sv: 3, iat: ahora, exp: ahora + 1000 }, SECRETO_PANEL), ahora), null, "ni firmado con ella");
  process.env.CRM_SESSION_SECRET = SECRETO_CRM;
  assert.equal(S.sesionComercialConfigurada(), true, "control: clave propia");

  // ── 7) Cookie ───────────────────────────────────────────────────────────
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = "development";
  const dev = S.opcionesCookieComercial();
  assert.deepEqual(dev, { httpOnly: true, secure: false, sameSite: "strict", path: "/comercial", maxAge: 604800 }, "cookie en desarrollo");
  env.NODE_ENV = "production";
  assert.equal(S.opcionesCookieComercial().secure, true, "Secure en producción");
  env.NODE_ENV = nodeEnv;
  assert.equal(S.opcionesCookieComercialBorrar().maxAge, 0, "borrar = vencida");
  assert.equal(S.opcionesCookieComercialBorrar().path, "/comercial", "borrar con el mismo Path");
  assert.notEqual(S.CRM_COOKIE as string, P.ADMIN_COOKIE as string, "cookie distinta de la del panel");

  console.log("OK — crmSesion: firma, tipo, versión, vencimiento, tokens cruzados, configuración y cookie.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
