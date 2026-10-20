// ============================================================================
// Marketing · casilla voluntaria de promociones en el checkout. SOLO SERVIDOR.
// ----------------------------------------------------------------------------
// La usan /api/mercadopago/preference y /api/reservas (Reservas) y
// /api/gift-cards/preference (Gift Cards), DESPUÉS de crear la compra.
//   · Es independiente de la compra: nunca lanza, nunca la bloquea y tiene
//     tiempo límite. Pase lo que pase acá, la compra sigue como siempre.
//   · Solo registra si la persona marcó la casilla (promos.acepto === true) con
//     el texto vigente, su huella y el token firmado de cuando se le mostró.
//     Sin casilla → "no_solicitada" y no se toca el registro.
//   · Devuelve lo que pasó de verdad: solo "registrada" permite decir "te
//     anotamos". Cualquier falla es "no_registrada" (la pantalla no confirma).
//   · Clave de idempotencia derivada de la compra: reintentar el mismo pedido no
//     duplica la suscripción.
// ============================================================================

import { createHash } from "node:crypto";
import { logSecurityEvent } from "@/lib/apiError";
import { marketingConsentimientoHabilitado } from "@/lib/featureFlags";
import { leerPromosCheckout, type DatosRpc, type EstadoPromosCheckout } from "@/lib/marketing/consentimiento";
import type { R, Registrado } from "@/lib/marketing/consentimientoServer";
import { huellaIp } from "@/lib/marketing/huellaIp";
import { verificarTokenFormulario } from "@/lib/marketing/tokenFormulario";

export type ArgsPromosCheckout = {
  body: unknown;
  fuente: "checkout_reserva" | "checkout_gift_card";
  telefono: string | null | undefined;
  nombre: string | null | undefined;
  /** La compra que se acaba de crear: evidencia y semilla de la clave de idempotencia. */
  compra: { reserva_id: string } | { grupo_compra_id: string };
  ip: string;
  ahora?: Date;
  deps?: {
    registrar?: (clave: string, datos: DatosRpc, rol: "publico") => Promise<R<Registrado>>;
    habilitada?: () => boolean;
    timeoutMs?: number;
  };
};

export type ResultadoPromosCheckout = { estado: EstadoPromosCheckout; motivo?: string };

/** UUID estable (forma v5) a partir de un texto: la misma compra da siempre la misma clave. */
export function claveDeCompra(semilla: string): string {
  const h = createHash("sha256").update(`sim:marketing-checkout:v1:${semilla}`).digest("hex");
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const TIEMPO_LIMITE_MS = 3000;

export async function registrarPromosCheckout(args: ArgsPromosCheckout): Promise<ResultadoPromosCheckout> {
  const noRegistrada = (motivo: string): ResultadoPromosCheckout => {
    logSecurityEvent("promos_checkout_no_registrada", { fuente: args.fuente, motivo });
    return { estado: "no_registrada", motivo };
  };
  try {
    const p = leerPromosCheckout(args.body);
    if (!p.solicitada) return { estado: "no_solicitada" };
    const habilitada = args.deps?.habilitada ?? marketingConsentimientoHabilitado;
    if (!habilitada()) return noRegistrada("captacion_apagada");
    if (!p.valida) return noRegistrada("pedido_incompleto");
    const token = verificarTokenFormulario(p.token, p.texto_version, args.ahora ?? new Date());
    if (!token.ok) return noRegistrada(token.motivo);

    const pagina = args.fuente === "checkout_reserva" ? "/reservas" : "/gift-cards";
    const evidencia: Record<string, string> = { pagina, ...args.compra };
    const h = huellaIp(args.ip);
    if (h) evidencia.ip_hash = h;
    const nombre = String(args.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
    const datos: DatosRpc = {
      tipo: "alta",
      fuente: args.fuente,
      telefono: String(args.telefono ?? ""),
      texto_version: p.texto_version,
      texto_huella: p.texto_huella,
      nombre,
      solicitado_en: token.emitidoEn.toISOString(),
      evidencia,
    };
    const semilla = "reserva_id" in args.compra ? `reserva:${args.compra.reserva_id}` : `gift_card:${args.compra.grupo_compra_id}`;
    // Import diferido: el módulo de servidor crea el cliente de la base al cargarse.
    const registrar = args.deps?.registrar ?? (await import("@/lib/marketing/consentimientoServer")).registrar;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tiempo = new Promise<"tiempo_agotado">((res) => { reloj = setTimeout(() => res("tiempo_agotado"), args.deps?.timeoutMs ?? TIEMPO_LIMITE_MS); });
    const r = await Promise.race([registrar(claveDeCompra(semilla), datos, "publico"), tiempo]).finally(() => clearTimeout(reloj));
    if (r === "tiempo_agotado") return noRegistrada("tiempo_agotado");
    if (!r.ok) return noRegistrada(r.e?.codigo ?? "error_inesperado");
    return { estado: "registrada" };
  } catch {
    return noRegistrada("error_inesperado");
  }
}
