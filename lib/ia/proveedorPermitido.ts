// ¿Puede el proveedor FALSO procesar una consulta en este entorno?
//
// El 03/10/2026 quedaron 1.558 ejecuciones con `proveedor = 'fake'` en la base REAL: las
// suites de IA corrían con `IA_PROVIDER=fake` apuntando a Producción, así que cada corrida
// escribía ejecuciones, consumo y conversaciones de mentira en el negocio. El bloque 5C.2
// las borró; esto evita que vuelvan a entrar.
//
// Decide por DESTINO, igual que lib/guardiaPruebas.ts, no por `NODE_ENV` —que en Vercel es
// "production" tanto en Production como en Preview— ni por un flag que cualquiera pueda
// poner. Y falla CERRADA: ante un entorno que no puede clasificar, no permite el falso.
//
// El proveedor falso se permite únicamente cuando se puede establecer POSITIVAMENTE que la
// base de datos de destino es un loopback validado, o que el despliegue es Preview o
// Development de Vercel. Un portátil con `.env.local` —que apunta a Producción— queda
// afuera: es exactamente el camino por el que entró la contaminación.

export const CODIGO_FAKE_EN_PRODUCCION = "fake_en_vercel_production";
export const CODIGO_FAKE_VERCEL_INDETERMINADO = "fake_en_vercel_indeterminado";
export const CODIGO_FAKE_DESTINO_NO_LOOPBACK = "fake_con_destino_no_loopback";

export type VeredictoProveedor =
  | { ok: true; motivo: string }
  | { ok: false; codigo: string; motivo: string };

type Entorno = Record<string, string | undefined>;

// Loopback de verdad: el HOST tiene que ser 127.0.0.1, localhost o [::1]. Una URL que
// apenas CONTIENE "localhost" (un subdominio, un usuario, un path) no alcanza.
export function destinoEsLoopback(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  // `new URL()` devuelve el host IPv6 entre corchetes: "[::1]".
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

const ENTORNOS_VERCEL_NO_PRODUCTIVOS = new Set(["preview", "development"]);

export function evaluarProveedor(entorno: Entorno = process.env): VeredictoProveedor {
  const proveedor = (entorno.IA_PROVIDER || "anthropic").toLowerCase();
  if (proveedor !== "fake") return { ok: true, motivo: "proveedor_real" };

  const vercelEnv = (entorno.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "production") {
    return {
      ok: false,
      codigo: CODIGO_FAKE_EN_PRODUCCION,
      motivo: "IA_PROVIDER=fake no puede atender consultas en Vercel Production.",
    };
  }

  // En Vercel pero sin poder clasificar el entorno: se rechaza, no se asume.
  const enVercel = Boolean(entorno.VERCEL || entorno.VERCEL_URL);
  if (enVercel && !ENTORNOS_VERCEL_NO_PRODUCTIVOS.has(vercelEnv)) {
    return {
      ok: false,
      codigo: CODIGO_FAKE_VERCEL_INDETERMINADO,
      motivo: `IA_PROVIDER=fake en un despliegue de Vercel con VERCEL_ENV="${entorno.VERCEL_ENV ?? ""}": no se puede descartar Production.`,
    };
  }

  // La señal fuerte: la base de destino es un loopback validado.
  if (destinoEsLoopback(entorno.NEXT_PUBLIC_SUPABASE_URL)) {
    return { ok: true, motivo: "destino_loopback" };
  }
  if (ENTORNOS_VERCEL_NO_PRODUCTIVOS.has(vercelEnv)) {
    return { ok: true, motivo: `vercel_${vercelEnv}` };
  }

  return {
    ok: false,
    codigo: CODIGO_FAKE_DESTINO_NO_LOOPBACK,
    motivo: "IA_PROVIDER=fake solo puede escribir en una base loopback; este destino no lo es.",
  };
}

// Mensaje para el usuario: no expone el entorno ni la configuración.
export const MENSAJE_FAKE_BLOQUEADO =
  "IA SIM no está disponible en este entorno: está configurada con un proveedor de pruebas. No se registró ninguna consulta.";
