import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { randomUUID } from "node:crypto";

// Ejecutar: npx tsx lib/crmAuth.test.ts
// Autorización del CRM (B0), pura:
//   1) resolverActorCrm con dependencias falsas: matriz de cookies que conviven
//      (admin, staff, comercial válida, vieja, desactivada, inexistente, base caída,
//      clave faltante);
//   2) cableado estático: cada ruta nueva usa su guard; ninguna ruta existente lee
//      la sesión comercial; el panel sigue igual (verifySessionToken, guards,
//      matcher, menú).
// No toca ninguna base: el cliente de servidor se crea apuntando a un puerto
// cerrado y no se usa.

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sin-uso";

type Estado = { id: string; nombre: string; activo: boolean; sesion_version: number };

async function main() {
  const { resolverActorCrm } = await import("@/lib/crmAuth");

  const U1 = randomUUID(), U2 = randomUUID(), U3 = randomUUID(), U4 = randomUUID(), U5 = randomUUID();
  const sesiones: Record<string, { uid: string; sv: number }> = {
    C_OK: { uid: U1, sv: 3 },
    C_VIEJA: { uid: U1, sv: 2 },
    C_DESACT: { uid: U2, sv: 1 },
    C_INEXISTENTE: { uid: U3, sv: 1 },
    C_BASE_CAIDA: { uid: U4, sv: 1 },
    C_OTRO_ID: { uid: U5, sv: 1 },
  };
  const usuarios: Record<string, Estado | "error"> = {
    [U1]: { id: U1, nombre: "Uno", activo: true, sesion_version: 3 },
    [U2]: { id: U2, nombre: "Dos", activo: false, sesion_version: 1 },
    [U4]: "error",
    [U5]: { id: U1, nombre: "Otro", activo: true, sesion_version: 1 },
  };
  let configurado = true;
  let consultasComerciales = 0;
  const deps = {
    verificarPanel: async (t: string | undefined) => (t === "ADM" ? "admin" as const : t === "STF" ? "staff" as const : null),
    comercialConfigurado: () => configurado,
    verificarComercial: (t: string | undefined) => {
      consultasComerciales++;
      const s = t ? sesiones[t] : undefined;
      return s ? { ...s, iat: 0, exp: Number.MAX_SAFE_INTEGER } : null;
    },
    estadoUsuario: async (id: string) => {
      const u = usuarios[id];
      if (u === "error") throw new Error("base caída");
      return u ?? null;
    },
  };
  const r = (panel?: string, comercial?: string) => resolverActorCrm({ panel, comercial }, deps);
  const esComercial = (x: Awaited<ReturnType<typeof r>>, id: string) =>
    x.estado === "ok" && x.actor.tipo === "comercial" && x.actor.usuarioId === id;
  const esAdmin = (x: Awaited<ReturnType<typeof r>>) => x.estado === "ok" && x.actor.tipo === "admin" && x.actor.nombre === "Administración";

  // ── 1) Una sola credencial ──────────────────────────────────────────────
  assert.equal((await r()).estado, "no_autenticado", "sin cookies");
  assert.equal((await r("basura")).estado, "no_autenticado", "cookie del panel inválida");
  assert.equal((await r("STF")).estado, "denegado", "staff → 403");
  assert.ok(esAdmin(await r("ADM")), "admin → Administración");
  assert.ok(esComercial(await r(undefined, "C_OK"), U1), "comercial válida");
  for (const c of ["C_VIEJA", "C_DESACT", "C_INEXISTENTE", "C_OTRO_ID", "basura"]) {
    assert.equal((await r(undefined, c)).estado, "no_autenticado", `comercial ${c} → 401`);
  }
  assert.equal((await r(undefined, "C_BASE_CAIDA")).estado, "no_disponible", "base caída → falla cerrado");

  // ── 2) Cookies que conviven ─────────────────────────────────────────────
  assert.ok(esComercial(await r("ADM", "C_OK"), U1), "admin + comercial válida → comercial");
  for (const c of ["C_VIEJA", "C_DESACT", "C_INEXISTENTE", "basura"]) {
    assert.ok(esAdmin(await r("ADM", c)), `una comercial inválida (${c}) no anula al admin`);
  }
  assert.equal((await r("ADM", "C_BASE_CAIDA")).estado, "no_disponible", "admin + comercial no verificable → no se cae a admin");
  assert.ok(esComercial(await r("STF", "C_OK"), U1), "staff + comercial válida → comercial");
  assert.equal((await r("STF", "C_VIEJA")).estado, "denegado", "staff + comercial vieja → 403");

  // ── 3) Sin clave comercial: falla cerrado para lo comercial ─────────────
  configurado = false;
  consultasComerciales = 0;
  assert.equal((await r(undefined, "C_OK")).estado, "no_disponible", "sin clave, la comercial no vale");
  assert.ok(esAdmin(await r("ADM", "C_OK")), "sin clave, el admin sigue entrando");
  assert.equal((await r()).estado, "no_autenticado", "sin clave y sin cookies → 401");
  assert.equal(consultasComerciales, 0, "sin clave ni siquiera se lee el token");
  configurado = true;

  // ── 4) Cableado estático ────────────────────────────────────────────────
  const leer = (p: string) => readFileSync(p, "utf8");
  const handler = (src: string, m: string) => {
    const i = src.search(new RegExp(`export async function ${m}\\b`));
    assert.ok(i >= 0, `existe ${m}`);
    const resto = src.slice(i + 1);
    const j = resto.search(/export async function /);
    return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
  };

  const sesion = leer("app/comercial/api/sesion/route.ts");
  assert.match(handler(sesion, "GET"), /requireCrmActor\(\)[\s\S]*if \(!auth\.ok\) return auth\.response/, "GET sesión usa requireCrmActor");

  const lista = leer("app/api/admin/crm/usuarios/route.ts");
  const una = leer("app/api/admin/crm/usuarios/[id]/route.ts");
  for (const [nombre, src, ms] of [["usuarios", lista, ["GET", "POST"]], ["usuarios/[id]", una, ["PATCH"]]] as const) {
    for (const m of ms) {
      const h = handler(src, m);
      assert.match(h, /requireAdmin\(\)[\s\S]*if \(!auth\.ok\) return auth\.response/, `${nombre} ${m} usa requireAdmin`);
      assert.ok(!/requireStaffOrAdmin|requireCrmActor/.test(h), `${nombre} ${m} no admite staff ni comercial`);
      if (m !== "GET") {
        assert.ok(h.indexOf("isAllowedOrigin") >= 0 && h.indexOf("isAllowedOrigin") < h.indexOf("requireAdmin"), `${nombre} ${m} controla el origen primero`);
      }
    }
  }
  for (const p of ["app/comercial/api/ingresar/route.ts", "app/comercial/api/salir/route.ts"]) {
    assert.match(handler(leer(p), "POST"), /if \(!isAllowedOrigin\(req\)\) return forbiddenOrigin\(\)/, `${p} controla el origen`);
  }
  assert.match(leer("app/comercial/page.tsx"), /actorCrmActual\(\)[\s\S]*redirect\("\/comercial\/ingresar"\)/, "inicio comercial protegido en el servidor");
  assert.match(leer("app/admin/(panel)/crm/layout.tsx"), /getCurrentAdminRole\(\)\) !== "admin"\) redirect\(/, "todo /admin/crm: solo admin en el servidor");
  assert.match(leer("middleware.ts"), /"\/admin\/crm"/, "/admin/crm sigue en la lista solo-admin del middleware");

  // Ninguna ruta o página fuera de las del CRM lee la sesión comercial.
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p.split(sep).join("/"));
    }
    return out;
  };
  const DEL_CRM = /^app\/comercial\/|^app\/api\/admin\/crm\/|^app\/admin\/\(panel\)\/crm\//;
  const leenComercial = walk("app").filter((f) => !DEL_CRM.test(f) && /crmAuth|crmSesion|CRM_COOKIE|sim-crm-session/.test(leer(f)));
  assert.deepEqual(leenComercial, [], `rutas existentes que leen la sesión comercial: ${leenComercial.join(", ")}`);
  const guards = leer("lib/adminGuards.ts");
  assert.ok(!/crm/i.test(guards), "requireAdmin / requireStaffOrAdmin no conocen la sesión comercial");
  assert.ok(leer("lib/adminSession.ts").includes('data.role !== "admin" && data.role !== "staff"'), "verifySessionToken sigue admitiendo solo admin|staff");
  assert.ok(!leer("middleware.ts").includes("crmSesion") && !leer("middleware.ts").includes("CRM_COOKIE"), "el middleware no usa la sesión comercial");
  assert.match(leer("middleware.ts"), /matcher: \["\/admin\/:path\*", "\/comercial", "\/comercial\/:path\*"\]/, "matcher: /admin igual, más el área comercial (solo aislamiento)");

  // El enlace del CRM en el panel: solo admin.
  const sidebar = leer("components/AdminSidebar.tsx");
  const enlace = /label: "CRM",\s*href: "([^"]+)",\s*roles: (\[[^\]]*\])/.exec(sidebar);
  assert.ok(enlace, "existe el enlace CRM");
  assert.equal(enlace![1], "/admin/crm/negocios");
  assert.equal(enlace![2], '["admin"]', "el enlace CRM es solo para admin");
  // La interfaz comercial no usa el menú del panel.
  const comerciales = walk("app/comercial");
  assert.ok(comerciales.every((f) => !leer(f).includes("AdminSidebar")), "la interfaz comercial no usa el menú del panel");

  // ── 5) Aislamiento de la analítica: navegación ──────────────────────────
  // Se entra al área comercial con navegación de documento (el middleware cubre
  // al router, pero ninguna página de afuera debería intentarlo) y se sale igual.
  const fuera = [...walk("app"), ...walk("components")].filter((f) => !f.startsWith("app/comercial/"));
  const entranPorRouter = fuera.filter((f) =>
    /<Link[^>]*href=\{?["'`]\/comercial|router\.(push|replace|prefetch)\(\s*["'`]\/comercial/.test(leer(f)));
  assert.deepEqual(entranPorRouter, [], `entran al área comercial con el router (usar <a>): ${entranPorRouter.join(", ")}`);
  // Dentro del área se navega con <Link> (el layout comercial no carga GTM), pero
  // todo <Link> del área apunta al área: se sale con <a>. Los componentes compartidos
  // (components/crm) reciben las rutas por props y el área les pasa rutas propias.
  const destinoArea = (d: string) => d === "/comercial" || d.startsWith("/comercial/") || d.startsWith("/comercial?");
  const linksArea = comerciales.flatMap((f) => [...leer(f).matchAll(/<Link[^>]*?href=\{?["'`]([^"'`]*)/g)].map((m) => [f, m[1]] as const));
  assert.ok(linksArea.length > 0, "el área usa <Link> internos");
  for (const [f, d] of linksArea) assert.ok(destinoArea(d), `<Link> que sale del área en ${f}: ${d}`);
  const dinamicos = comerciales.flatMap((f) => [...leer(f).matchAll(/<Link[^>]*?href=\{(?!["'`])([^}]+)\}/g)].map((m) => m[1]));
  assert.ok(dinamicos.every((x) => x === "volver.href"), `<Link> con destino no literal: ${dinamicos.join(", ")}`);
  const rutasProps = comerciales.flatMap((f) => [...leer(f).matchAll(/(?:volver=\{\{ href:|baseNegocio=|baseJornada=|rutaNuevo=|rutaNuevaVisita=|apiBase=)\s*\{?["'`]([^"'`]+)/g)].map((m) => m[1]));
  assert.ok(rutasProps.length >= 10 && rutasProps.every(destinoArea), `rutas que el área pasa a los componentes: ${rutasProps.join(", ")}`);
  const compartidos = walk("components/crm");
  assert.ok(compartidos.every((f) => !/<Link[^>]*?href=\{?["'`]\//.test(leer(f))), "los componentes compartidos no tienen rutas <Link> fijas");
  const destinosRouter = comerciales.flatMap((f) => [...leer(f).matchAll(/router\.(?:push|replace)\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]));
  assert.ok(destinosRouter.length > 0 && destinosRouter.every((d) => d === "/comercial" || d.startsWith("/comercial/")), "dentro del área, el router solo navega al área");
  const gtm = leer("components/analytics/GoogleTagManager.tsx");
  assert.ok(gtm.includes("<CargadorGtm") && gtm.includes("<NoscriptGtm") && !gtm.includes('from "next/script"'), "GTM se carga por CargadorGtm/NoscriptGtm");
  const carga = leer("components/analytics/GoogleTagManagerCarga.tsx");
  assert.equal((carga.match(/if \(esAreaComercial\(pathname\)\) return null;/g) ?? []).length, 2, "loader e iframe se omiten en el área comercial");
  assert.ok(leer("app/comercial/layout.tsx").includes("<AislamientoAnalitica />"), "el layout comercial vigila que no haya GTM");

  // ── 6) Límite de intentos propio del CRM; lib/rateLimit.ts sin cambios de uso ──
  const ingreso = leer("app/comercial/api/ingresar/route.ts");
  assert.ok(/controlarIp\(ip\)/.test(ingreso) && /controlarUsuario\(usuario\)/.test(ingreso) && /registrarFalloUsuario\(usuario\)/.test(ingreso), "el ingreso usa lib/crmLimite.ts");
  assert.ok(!/\brateLimit\(/.test(ingreso), "el ingreso comercial no usa el limitador general");
  assert.ok(!/crm/i.test(leer("lib/rateLimit.ts")), "lib/rateLimit.ts no conoce al CRM");
  assert.match(leer("app/api/admin-login/route.ts"), /await rateLimit\(`login:\$\{clientIp\(req\)\}`, 8, 60_000\)/, "el login del panel sigue con su limitador de siempre");

  console.log("OK — crmAuth: matriz de cookies que conviven, falla cerrada y cableado de rutas, panel y menú.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
