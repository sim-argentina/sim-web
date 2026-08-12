import { strict as assert } from "node:assert";
import { analyticsAllowedFor } from "./analytics";

// Pruebas de la política central de Analytics (isAnalyticsAllowed).
// El proyecto no tiene runner de tests; este archivo se ejecuta con:
//   npx tsx lib/analytics.allowed.test.ts

function allowedForUrl(u: string): boolean {
  const url = new URL(u);
  return analyticsAllowedFor(url.hostname, url.pathname);
}

const permitidos: string[] = [
  "https://simexperience.com.ar/",
  "https://www.simexperience.com.ar/reservas",
  "https://www.simexperience.com.ar/gift-cards/exito",
  // "/administracion" NO debe bloquearse (no es "/admin" ni empieza con "/admin/").
  "https://simexperience.com.ar/administracion",
  "https://www.simexperience.com.ar/administracion/algo",
];

const bloqueados: string[] = [
  "https://simexperience.com.ar/admin",
  "https://simexperience.com.ar/admin/finanzas",
  "http://localhost:3000/",
  "http://localhost:3000/reservas",
  "https://sim-xxxx.vercel.app/reservas",
  "https://otro-dominio.com/",
];

for (const u of permitidos) assert.equal(allowedForUrl(u), true, `debería PERMITIR: ${u}`);
for (const u of bloqueados) assert.equal(allowedForUrl(u), false, `debería BLOQUEAR: ${u}`);

// Distinción exacta /admin vs /administracion.
assert.equal(analyticsAllowedFor("simexperience.com.ar", "/admin"), false);
assert.equal(analyticsAllowedFor("simexperience.com.ar", "/admin/"), false);
assert.equal(analyticsAllowedFor("simexperience.com.ar", "/admin/turnero"), false);
assert.equal(analyticsAllowedFor("simexperience.com.ar", "/administracion"), true);
assert.equal(analyticsAllowedFor("www.simexperience.com.ar", "/adminx"), true);

// Hostname productivo pero mayúsculas / otro host → bloqueado (allowlist estricta).
assert.equal(analyticsAllowedFor("SIMEXPERIENCE.COM.AR", "/"), false);
assert.equal(analyticsAllowedFor("preview.simexperience.com.ar", "/"), false);

console.log(
  `OK — ${permitidos.length} permitidos, ${bloqueados.length} bloqueados y casos /admin vs /administracion pasan.`
);
