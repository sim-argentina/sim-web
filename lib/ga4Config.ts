// Lectura PURA de la configuración GA4 desde variables de entorno (sin SDK). Testeable
// sin credenciales reales. NO expone secretos: sólo indica si están presentes y arma el
// objeto de credenciales para el cliente server-side.
export type Env = Record<string, string | undefined>;

export function credencialesFromEnv(env: Env): { client_email: string; private_key: string } | null {
  const email = env.GA4_SA_CLIENT_EMAIL;
  const rawKey = env.GA4_SA_PRIVATE_KEY;
  if (email && rawKey) {
    // Las private keys suelen venir con "\n" escapados en las env vars.
    return { client_email: email, private_key: rawKey.replace(/\\n/g, "\n") };
  }
  const json = env.GA4_SA_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return { client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, "\n") };
      }
    } catch { /* JSON inválido → no configurado */ }
  }
  return null;
}

export function ga4Configured(env: Env): boolean {
  return Boolean(env.GA4_PROPERTY_ID && credencialesFromEnv(env));
}
