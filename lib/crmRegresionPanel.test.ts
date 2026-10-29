import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";

// Ejecutar: npx tsx lib/crmRegresionPanel.test.ts
// Regresión del PANEL tras el CRM B0, ejecutable y sin base:
//   1) middleware: las redirecciones de /admin siguen iguales; /admin/crm es
//      solo-admin; una cookie comercial, sola, no abre nada del panel.
//   2) login del panel (/api/admin-login): admin y staff ingresan igual que antes,
//      con la misma cookie; una contraseña incorrecta sigue dando 401.
// El panel no tiene logout propio (no existe ruta ni botón): no hay nada que
// probar ahí.

const SECRETO = "p".repeat(48);
process.env.ADMIN_SESSION_SECRET = SECRETO;
process.env.ADMIN_PASSWORD = "clave-admin-de-prueba";
process.env.STAFF_PASSWORD = "clave-staff-de-prueba";
process.env.CRM_SESSION_SECRET = "c".repeat(48);
for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];

const BASE = "https://simexperience.com.ar";

async function main() {
  const { middleware, config } = await import("@/middleware");
  const { createSessionToken, ADMIN_COOKIE } = await import("@/lib/adminSession");
  const { crearTokenComercial, CRM_COOKIE } = await import("@/lib/crmSesion");
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");
  const comercial = crearTokenComercial("00000000-0000-4000-8000-000000000001", 1);

  const pedir = async (ruta: string, cookies: Record<string, string> = {}) => {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await middleware(new NextRequest(`${BASE}${ruta}`, { headers: cookie ? { cookie } : {} }));
    const destino = res.headers.get("location");
    return destino ? new URL(destino).pathname : res.headers.get("x-middleware-next") === "1" ? "sigue" : `?${res.status}`;
  };

  // ── 1) Middleware ───────────────────────────────────────────────────────
  assert.deepEqual(config.matcher, ["/admin/:path*"], "el matcher no cambió: /comercial no pasa por el middleware");
  const casos: Array<[string, Record<string, string>, string]> = [
    ["/admin/login", {}, "sigue"],
    ["/admin", {}, "/admin/login"],
    ["/admin", { [ADMIN_COOKIE]: admin }, "/admin/metricas"],
    ["/admin", { [ADMIN_COOKIE]: staff }, "/admin/calendario"],
    ["/admin/turnero", {}, "/admin/login"],
    ["/admin/turnero", { [ADMIN_COOKIE]: staff }, "sigue"],
    ["/admin/finanzas", { [ADMIN_COOKIE]: staff }, "/admin/calendario"],
    ["/admin/finanzas", { [ADMIN_COOKIE]: admin }, "sigue"],
    ["/admin/interacciones/analisis", { [ADMIN_COOKIE]: staff }, "/admin/calendario"],
    ["/admin/crm/configuracion", {}, "/admin/login"],
    ["/admin/crm/configuracion", { [ADMIN_COOKIE]: staff }, "/admin/calendario"],
    ["/admin/crm/configuracion", { [ADMIN_COOKIE]: admin }, "sigue"],
    ["/admin/crm", { [ADMIN_COOKIE]: staff }, "/admin/calendario"],
    ["/admin/crmx", { [ADMIN_COOKIE]: staff }, "sigue"],
    // Una cookie comercial válida, sola o mal ubicada, no abre el panel.
    ["/admin", { [CRM_COOKIE]: comercial }, "/admin/login"],
    ["/admin/turnero", { [CRM_COOKIE]: comercial }, "/admin/login"],
    ["/admin/crm/configuracion", { [CRM_COOKIE]: comercial }, "/admin/login"],
    ["/admin/turnero", { [ADMIN_COOKIE]: comercial }, "/admin/login"],
    // Con las dos, manda la del panel (el middleware no mira la comercial).
    ["/admin/finanzas", { [ADMIN_COOKIE]: staff, [CRM_COOKIE]: comercial }, "/admin/calendario"],
  ];
  for (const [ruta, cookies, esperado] of casos) {
    assert.equal(await pedir(ruta, cookies), esperado, `${ruta} con ${Object.keys(cookies).join("+") || "nada"}`);
  }

  // ── 2) Login del panel ──────────────────────────────────────────────────
  const { POST } = await import("@/app/api/admin-login/route");
  const { verifySessionToken } = await import("@/lib/adminSession");
  const login = async (password: string, ip: string) => {
    const res = await POST(new Request(`${BASE}/api/admin-login`, {
      method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify({ password }),
    }));
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE}=`)) ?? "";
    const valor = /^[^=]+=([^;]*)/.exec(cookie)?.[1] ?? "";
    return { status: res.status, json: (await res.json()) as Record<string, unknown>, cookie, rol: await verifySessionToken(valor) };
  };
  const a = await login("clave-admin-de-prueba", "10.0.0.1");
  assert.equal(a.status, 200);
  assert.deepEqual(a.json, { ok: true, role: "admin" });
  assert.equal(a.rol, "admin", "la cookie del panel sigue firmando el rol admin");
  assert.match(a.cookie, /HttpOnly/i);
  assert.match(a.cookie, /SameSite=strict/i);
  assert.match(a.cookie, /Path=\//);
  const s = await login("clave-staff-de-prueba", "10.0.0.2");
  assert.equal(s.status, 200);
  assert.equal(s.rol, "staff");
  const mal = await login("otra-cosa", "10.0.0.3");
  assert.equal(mal.status, 401);
  assert.equal(mal.cookie, "", "sin cookie si falla");

  console.log(`OK — regresión del panel: ${casos.length} redirecciones del middleware y login admin/staff sin cambios.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
