// ============================================================================
// Transporte de SOLO LECTURA para leer una base alojada (Marketing).
// ----------------------------------------------------------------------------
// La simulación de audiencia lee datos reales autorizados; no tiene que poder
// escribir, ni siquiera "para probar que se rechaza". Dos barreras, las dos
// ANTES de cualquier salida a la red:
//   1. crearFetchSoloLectura: el fetch que usa el cliente. Solo deja pasar GET y
//      HEAD al host permitido; cualquier otra cosa se corta sin llamar al
//      transporte real.
//   2. blindarCliente: insert/update/upsert/delete y rpc del cliente lanzan en el
//      momento, sin armar el pedido.
// Lo comprueba lib/marketing/soloLectura.test.ts con un transporte SIMULADO.
// ============================================================================

export class EscrituraBloqueada extends Error {
  constructor(detalle: string) {
    super(`solo lectura: ${detalle}`);
    this.name = "EscrituraBloqueada";
  }
}

export type Transporte = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FetchSoloLectura = {
  fetch: Transporte;
  /** Pedidos que salieron (método y ruta, sin query ni cuerpo). */
  pedidos: () => readonly { metodo: string; ruta: string }[];
  /** Intentos cortados antes de salir. */
  bloqueados: () => number;
};

const PERMITIDOS = new Set(["GET", "HEAD"]);

export function crearFetchSoloLectura(transporte: Transporte, hostPermitido: string): FetchSoloLectura {
  const pedidos: { metodo: string; ruta: string }[] = [];
  let bloqueados = 0;
  const host = hostPermitido.toLowerCase();
  const fetch: Transporte = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const metodo = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.host.toLowerCase() !== host) {
      bloqueados++;
      throw new EscrituraBloqueada(`host no permitido (${url.host})`);
    }
    if (!PERMITIDOS.has(metodo)) {
      bloqueados++;
      throw new EscrituraBloqueada(`${metodo} bloqueado`);
    }
    pedidos.push({ metodo, ruta: url.pathname });
    return transporte(input, init);
  };
  return { fetch, pedidos: () => pedidos, bloqueados: () => bloqueados };
}

/** Corta en el cliente toda escritura y toda RPC, sin armar el pedido. Conserva el tipo del cliente. */
export function blindarCliente<T extends { from: unknown; rpc: unknown }>(cliente: T): T {
  const c = cliente as unknown as Record<string, unknown>;
  const fromOriginal = (cliente.from as (t: string) => Record<string, unknown>).bind(cliente);
  c.from = (tabla: string) => {
    const q = fromOriginal(tabla);
    for (const escritura of ["insert", "update", "upsert", "delete"]) {
      q[escritura] = () => { throw new EscrituraBloqueada(`${escritura} sobre ${tabla}`); };
    }
    return q;
  };
  c.rpc = (fn: unknown) => { throw new EscrituraBloqueada(`rpc ${String(fn)}`); };
  return cliente;
}
