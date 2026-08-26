import { strict as assert } from "node:assert";
import { credencialesFromEnv, ga4Configured } from "@/lib/ga4Config";

// Ejecutar: npx tsx lib/ga4.config.test.ts
// Manejo controlado de la configuración GA4 (sin importar el SDK ni exponer secretos).

// Sin nada → no configurado, sin lanzar.
assert.equal(ga4Configured({}), false);
assert.equal(credencialesFromEnv({}), null);

// Falta el Property ID aunque haya credenciales → no configurado.
assert.equal(ga4Configured({ GA4_SA_CLIENT_EMAIL: "a@b.com", GA4_SA_PRIVATE_KEY: "k" }), false);

// Credenciales por email + private key (con \n escapados → se desescapan).
{
  const creds = credencialesFromEnv({ GA4_SA_CLIENT_EMAIL: "svc@proj.iam", GA4_SA_PRIVATE_KEY: "-----A\\nB-----" });
  assert.ok(creds && creds.client_email === "svc@proj.iam");
  assert.equal(creds!.private_key, "-----A\nB-----", "desescapa \\n");
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "123", GA4_SA_CLIENT_EMAIL: "svc@proj.iam", GA4_SA_PRIVATE_KEY: "k" }), true);
}

// Credenciales por JSON completo.
{
  const json = JSON.stringify({ client_email: "svc@proj.iam", private_key: "-----X\\nY-----" });
  const creds = credencialesFromEnv({ GA4_SA_JSON: json });
  assert.ok(creds && creds.client_email === "svc@proj.iam");
  assert.equal(creds!.private_key, "-----X\nY-----");
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "123", GA4_SA_JSON: json }), true);
}

// JSON inválido → no rompe, no configurado.
assert.equal(credencialesFromEnv({ GA4_SA_JSON: "{not json" }), null);
assert.equal(ga4Configured({ GA4_PROPERTY_ID: "123", GA4_SA_JSON: "{not json" }), false);

console.log("OK — GA4 config: sin credenciales = no configurado (controlado), email+key y JSON válidos, desescape de \\n, JSON inválido tolerado.");
