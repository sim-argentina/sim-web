// Marketing · evidencia del formulario web. SOLO SERVIDOR (node:crypto), sin base.
//
// Huella de la IP: HMAC con una clave derivada del secreto de sesión (contexto
// propio, como lib/reservaPostpay.ts), recortada a 32 hex. Sirve para ver si
// muchas altas salieron del mismo lugar sin guardar la IP. Sin secreto o sin IP
// conocida, no se guarda nada.

import { createHmac } from "node:crypto";

const CONTEXTO = "sim:marketing-consentimiento:v1";

export function huellaIp(ip: string, entorno: Record<string, string | undefined> = process.env): string | undefined {
  const secreto = entorno.ADMIN_SESSION_SECRET;
  if (!secreto || !ip || ip === "unknown") return undefined;
  const clave = createHmac("sha256", secreto).update(CONTEXTO).digest();
  return createHmac("sha256", clave).update(ip).digest("hex").slice(0, 32);
}
