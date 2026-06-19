import { NextResponse } from "next/server";
import { logSecurityEvent } from "@/lib/apiError";

// Rate limiting durable para serverless (Upstash Redis REST) con fallback en
// memoria para desarrollo. En producción sin Upstash configurado, advierte
// fuerte y degrada a memoria (no falla silenciosamente).
//
// Variables de entorno (producción): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.

// Acepta tanto los nombres originales como los que genera automáticamente la
// integración de Vercel/Upstash (prefijados con el nombre del store).
// Se usa el par REST de ESCRITURA (KV_REST_API_URL + KV_REST_API_TOKEN), nunca
// el READ_ONLY_TOKEN (necesitamos INCR) ni las URLs redis:// (KV_URL/REDIS_URL).
const UPSTASH_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;

const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

const IS_PROD = process.env.NODE_ENV === "production";

let warnedNoDurable = false;

// ── Fallback en memoria (por instancia; solo dev o degradación) ──────────────
const memBuckets = new Map<string, number[]>();

function memRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = memBuckets.get(key) ?? [];
  const recent = prev.filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    memBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  memBuckets.set(key, recent);
  if (memBuckets.size > 5000) {
    for (const [k, v] of memBuckets) {
      if (v.every((t) => now - t >= windowMs)) memBuckets.delete(k);
    }
  }
  return true;
}

// ── Upstash Redis REST (ventana fija con INCR + PEXPIRE NX) ──────────────────
async function upstashRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
      ]),
      signal: AbortSignal.timeout(800),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstash status ${res.status}`);
    const data = (await res.json()) as Array<{ result?: number; error?: string }>;
    const count = Number(data?.[0]?.result ?? 0);
    return count <= limit;
  } catch (e) {
    // Fail-open: ante un error de Upstash no rompemos disponibilidad.
    console.warn(
      "[rateLimit] Upstash no disponible, se permite la request:",
      e instanceof Error ? e.message : "error"
    );
    return true;
  }
}

// Devuelve true si la request está permitida, false si superó el límite.
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    return upstashRateLimit(key, limit, windowMs);
  }
  if (IS_PROD && !warnedNoDurable) {
    warnedNoDurable = true;
    console.warn(
      "[rateLimit] PRODUCCIÓN sin Upstash configurado: no se encontró ni " +
        "UPSTASH_REDIS_REST_URL/TOKEN ni UPSTASH_REDIS_REST_KV_REST_API_URL/TOKEN. " +
        "Rate limit en memoria (no durable). El durable se activa con cualquiera de los dos pares."
    );
  }
  return memRateLimit(key, limit, windowMs);
}

// IP del cliente priorizando headers de plataforma (Vercel) y evitando confiar
// ciegamente en x-forwarded-for (spoofeable).
export function clientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// Respuesta 429 consistente y genérica (sin detalles internos).
export function tooManyResponse(): NextResponse {
  logSecurityEvent("rate_limit_429");
  return NextResponse.json(
    { error: "Demasiadas solicitudes. Esperá un momento e intentá de nuevo." },
    { status: 429 }
  );
}
