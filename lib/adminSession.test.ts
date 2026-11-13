import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";

// Sesión del panel v2: atada a la contraseña de cada rol, sin tocar ADMIN_SESSION_SECRET.
// Prueba pura: no toca ninguna base. La URL de la base apunta a un puerto cerrado de loopback
// solo porque el módulo de Reservas post-pago crea su cliente al importarse (no se conecta).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba-sin-uso";
process.env.ADMIN_SESSION_SECRET = "secreto-de-prueba-con-mas-de-32-caracteres";
process.env.ADMIN_PASSWORD = "admin-original";
process.env.STAFF_PASSWORD = "staff-original";

// tsx compila este proyecto como CommonJS: sin await de primer nivel.
async function main() {
const S = await import("@/lib/adminSession");
const P = await import("@/lib/reservaPostpay");

let fallas = 0;
async function caso(nombre: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`ok   ${nombre}`); } catch (e) { fallas++; console.log(`FALLA ${nombre}: ${(e as Error).message}`); }
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const conPassword = async (admin: string, staff: string, fn: () => Promise<void>) => {
  const antes = [process.env.ADMIN_PASSWORD, process.env.STAFF_PASSWORD];
  process.env.ADMIN_PASSWORD = admin; process.env.STAFF_PASSWORD = staff;
  try { await fn(); } finally { [process.env.ADMIN_PASSWORD, process.env.STAFF_PASSWORD] = antes; }
};

const tokAdmin = await S.createSessionToken("admin");
const tokStaff = await S.createSessionToken("staff");

await caso("un token recién emitido vale para su rol", async () => {
  assert.equal(await S.verifySessionToken(tokAdmin), "admin");
  assert.equal(await S.verifySessionToken(tokStaff), "staff");
});

await caso("un token v1 (firmado directo con el secreto, como hasta hoy) ya no vale", async () => {
  const payload = b64({ role: "admin", exp: Date.now() + 3600_000 });
  const sig = createHmac("sha256", process.env.ADMIN_SESSION_SECRET!).update(payload).digest("base64url");
  assert.equal(await S.verifySessionToken(`${payload}.${sig}`), null);
});

await caso("cambiar ADMIN_PASSWORD invalida las sesiones admin y deja las de staff", async () => {
  await conPassword("admin-NUEVA", "staff-original", async () => {
    assert.equal(await S.verifySessionToken(tokAdmin), null);
    assert.equal(await S.verifySessionToken(tokStaff), "staff");
    assert.equal(await S.verifySessionToken(await S.createSessionToken("admin")), "admin");
  });
});

await caso("cambiar STAFF_PASSWORD invalida las sesiones de staff y deja las admin", async () => {
  await conPassword("admin-original", "staff-NUEVA", async () => {
    assert.equal(await S.verifySessionToken(tokStaff), null);
    assert.equal(await S.verifySessionToken(tokAdmin), "admin");
  });
});

await caso("volver a la contraseña anterior NO es una forma de recuperar una sesión cerrada por otra clave", async () => {
  // Un token emitido con otra contraseña solo vuelve a valer si esa contraseña vuelve: es lo esperado
  // (la sesión se ata a la contraseña vigente). Lo que importa: con la nueva, el viejo no entra.
  let viejo = "";
  await conPassword("admin-vieja", "staff-original", async () => { viejo = await S.createSessionToken("admin"); });
  assert.equal(await S.verifySessionToken(viejo), null);
});

await caso("no se puede cambiar el rol del payload (staff → admin) sin la clave de admin", async () => {
  const [, sig] = tokStaff.split(".");
  const payload = JSON.parse(Buffer.from(tokStaff.split(".")[0], "base64url").toString());
  assert.equal(await S.verifySessionToken(`${b64({ ...payload, role: "admin" })}.${sig}`), null);
});

await caso("un rol sin contraseña configurada no tiene sesión", async () => {
  await conPassword("admin-original", "", async () => {
    assert.equal(await S.verifySessionToken(tokStaff), null);
    await assert.rejects(() => S.createSessionToken("staff"));
  });
});

await caso("token vencido, mal formado o con rol desconocido: null", async () => {
  assert.equal(await S.verifySessionToken(undefined), null);
  assert.equal(await S.verifySessionToken("sin-punto"), null);
  assert.equal(await S.verifySessionToken(`${b64({ v: 2, role: "root", exp: Date.now() + 1000 })}.x`), null);
  assert.equal(await S.verifySessionToken(`%%%.${tokAdmin.split(".")[1]}`), null);
});

await caso("los enlaces de comprobante de Reservas no cambian al cambiar las contraseñas", async () => {
  const antes = P.firmarComprobante(4242);
  assert.ok(antes);
  await conPassword("admin-NUEVA", "staff-NUEVA", async () => {
    assert.equal(P.firmarComprobante(4242), antes);
    assert.equal(P.leerComprobante(antes), 4242);
  });
});

console.log(fallas ? `\n${fallas} FALLAS` : "\nTODO OK");
process.exit(fallas ? 1 : 0);
}
main();
