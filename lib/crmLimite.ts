// Límite de intentos del INGRESO COMERCIAL (CRM B0.1). Propio del CRM: no cambia
// lib/rateLimit.ts ni a sus consumidores (login del panel, APIs públicas), que
// siguen como estaban.
//
// Qué cambia respecto de lib/rateLimit.ts, y por qué:
//   · Si Upstash falla, tarda más que el tope o responde algo inválido, NO deja
//     pasar: decide con un contador en memoria que se lleva SIEMPRE en paralelo
//     (así, cuando el remoto cae a mitad de una ventana, el respaldo ya trae la
//     cuenta de esta instancia). Ese respaldo protege POR INSTANCIA: en Vercel
//     cada instancia cuenta lo suyo y se reinicia con ella. No es distribuido.
//   · Ventana FIJA: el vencimiento lo fija el primer intento y no se corre. En
//     Upstash, PEXPIRE ... NX; en memoria, venceEn no se toca. Los intentos
//     rechazados durante un bloqueo no lo extienden.
//   · Sin Upstash configurado, solo memoria (por instancia), igual que hoy.
// Nunca devuelve detalles de la infraestructura: el log dice solo el motivo
// (red, tiempo, http, respuesta), sin URL ni mensaje del proveedor.
//
// Qué protege cada límite (lo usa app/comercial/api/ingresar/route.ts):
//   · ORIGEN (IP que informa la plataforma): todos los intentos de esa IP,
//     correctos o no. Frena a quien prueba muchas cuentas desde un lugar.
//   · USUARIO: solo los intentos FALLIDOS contra ese nombre, vengan de donde
//     vengan. Frena a quien prueba contraseñas de una cuenta desde muchas IPs.
//     Contrapartida: quien conozca el nombre de usuario puede provocar un
//     bloqueo de esa cuenta durante una ventana (y repetirlo al vencer).

import { createHash } from "node:crypto";
import { logSecurityEvent } from "@/lib/apiError";

export const LIMITES_INGRESO = {
  ip: { maximo: 8, ventanaMs: 60_000 },
  usuario: { maximo: 10, ventanaMs: 15 * 60_000 },
} as const;

export type Fuente = "remoto" | "memoria";
export type Cuenta = { cuenta: number; restanteMs: number; fuente: Fuente };
export type Decision = { permitido: boolean; reintentarEnMs: number; fuente: Fuente };

export type DepsLimitador = {
  ahora: () => number;
  fetch: typeof fetch;
  /** Se leen en cada uso (null = sin remoto). */
  remoto: () => { url: string; token: string } | null;
  timeoutMs: number;
};

function remotoDelEntorno(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

const MAX_CLAVES_MEMORIA = 5000;
const AVISO_CADA_MS = 60_000;

export class LimitadorCrm {
  private memoria = new Map<string, { cuenta: number; venceEn: number }>();
  private ultimoAviso = 0;

  constructor(private deps: DepsLimitador) {}

  // ── Memoria (ventana fija) ───────────────────────────────────────────────
  private sumarMemoria(clave: string, ventanaMs: number): Cuenta {
    const t = this.deps.ahora();
    const e = this.memoria.get(clave);
    if (!e || e.venceEn <= t) {
      this.memoria.set(clave, { cuenta: 1, venceEn: t + ventanaMs });
      this.podar(t);
      return { cuenta: 1, restanteMs: ventanaMs, fuente: "memoria" };
    }
    e.cuenta++;
    return { cuenta: e.cuenta, restanteMs: e.venceEn - t, fuente: "memoria" };
  }

  private leerMemoria(clave: string): Cuenta {
    const t = this.deps.ahora();
    const e = this.memoria.get(clave);
    if (!e || e.venceEn <= t) return { cuenta: 0, restanteMs: 0, fuente: "memoria" };
    return { cuenta: e.cuenta, restanteMs: e.venceEn - t, fuente: "memoria" };
  }

  private podar(t: number) {
    if (this.memoria.size <= MAX_CLAVES_MEMORIA) return;
    for (const [k, v] of this.memoria) if (v.venceEn <= t) this.memoria.delete(k);
  }

  // ── Remoto (Upstash REST, pipeline) ──────────────────────────────────────
  private async pipeline(comandos: Array<Array<string>>): Promise<unknown[]> {
    const r = this.deps.remoto();
    if (!r) throw new Error("sin_remoto");
    let res: Response;
    try {
      res = await this.deps.fetch(`${r.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(comandos),
        signal: AbortSignal.timeout(this.deps.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      throw new Error(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "tiempo" : "red");
    }
    if (!res.ok) throw new Error("http");
    const datos = (await res.json().catch(() => null)) as Array<{ result?: unknown; error?: unknown }> | null;
    if (!Array.isArray(datos) || datos.length !== comandos.length || datos.some((d) => !d || d.error !== undefined)) {
      throw new Error("respuesta");
    }
    return datos.map((d) => d.result);
  }

  private aviso(motivo: string) {
    const t = this.deps.ahora();
    if (t - this.ultimoAviso < AVISO_CADA_MS) return;
    this.ultimoAviso = t;
    logSecurityEvent("crm_limite_respaldo_memoria", { motivo });
  }

  private static entero(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  /** Suma un intento y devuelve la cuenta de la ventana. */
  async sumar(clave: string, ventanaMs: number): Promise<Cuenta> {
    const local = this.sumarMemoria(clave, ventanaMs);
    if (!this.deps.remoto()) return local;
    try {
      const [incr, , pttl] = await this.pipeline([
        ["INCR", clave], ["PEXPIRE", clave, String(ventanaMs), "NX"], ["PTTL", clave],
      ]);
      const cuenta = LimitadorCrm.entero(incr);
      const ttl = LimitadorCrm.entero(pttl);
      if (cuenta === null || cuenta < 1 || ttl === null) throw new Error("respuesta");
      return { cuenta, restanteMs: ttl > 0 ? ttl : ventanaMs, fuente: "remoto" };
    } catch (e) {
      this.aviso(e instanceof Error ? e.message : "red");
      return local;
    }
  }

  /** Cuenta actual de la ventana, sin sumar. */
  async leer(clave: string): Promise<Cuenta> {
    const local = this.leerMemoria(clave);
    if (!this.deps.remoto()) return local;
    try {
      const [valor, pttl] = await this.pipeline([["GET", clave], ["PTTL", clave]]);
      const cuenta = valor === null ? 0 : LimitadorCrm.entero(valor);
      const ttl = LimitadorCrm.entero(pttl);
      if (cuenta === null || ttl === null) throw new Error("respuesta");
      return { cuenta, restanteMs: cuenta > 0 && ttl > 0 ? ttl : 0, fuente: "remoto" };
    } catch (e) {
      this.aviso(e instanceof Error ? e.message : "red");
      return local;
    }
  }
}

export const limitadorIngreso = new LimitadorCrm({
  ahora: () => Date.now(),
  fetch: (...a) => fetch(...a),
  remoto: remotoDelEntorno,
  timeoutMs: 800,
});

// Claves propias del CRM (no chocan con las de lib/rateLimit.ts). El usuario va
// resumido: el almacén no guarda nombres en claro.
const claveIp = (ip: string) => `crm:ingreso:ip:${ip}`;
const claveUsuario = (usuario: string) =>
  `crm:ingreso:usuario:${createHash("sha256").update(usuario).digest("base64url").slice(0, 32)}`;

/** Origen: suma TODOS los intentos de la IP; bloquea al superar el máximo de la ventana. */
export async function controlarIp(ip: string, l: LimitadorCrm = limitadorIngreso): Promise<Decision> {
  const { maximo, ventanaMs } = LIMITES_INGRESO.ip;
  const c = await l.sumar(claveIp(ip), ventanaMs);
  return { permitido: c.cuenta <= maximo, reintentarEnMs: c.cuenta <= maximo ? 0 : c.restanteMs, fuente: c.fuente };
}

/** Usuario: consulta sin sumar; bloquea si ya hubo el máximo de FALLOS en la ventana. */
export async function controlarUsuario(usuario: string, l: LimitadorCrm = limitadorIngreso): Promise<Decision> {
  const { maximo } = LIMITES_INGRESO.usuario;
  const c = await l.leer(claveUsuario(usuario));
  return { permitido: c.cuenta < maximo, reintentarEnMs: c.cuenta < maximo ? 0 : c.restanteMs, fuente: c.fuente };
}

/** Registra un intento FALLIDO contra ese usuario. */
export async function registrarFalloUsuario(usuario: string, l: LimitadorCrm = limitadorIngreso): Promise<void> {
  await l.sumar(claveUsuario(usuario), LIMITES_INGRESO.usuario.ventanaMs);
}
