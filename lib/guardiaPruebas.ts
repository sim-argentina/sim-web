// GUARDIÁN DE BASE DE PRUEBAS — fail-closed. Puro y testeable.
//
// Por qué existe: las suites de integración se corrían con `--env-file=.env.local`, y ese
// archivo apunta al proyecto de PRODUCCIÓN. Cada suite mutante creaba clientes, mensualidades,
// campeonatos, inscripciones pagadas y reservas en la base real, y confiaba en un `finally` para
// borrarlos. Un proceso interrumpido (Ctrl-C, timeout, kill, fin de sesión) nunca ejecuta ese
// `finally`: así quedaron 87 filas sintéticas visibles en el panel, con $800.000 de recaudación
// ficticia en Campeonatos de octubre de 2026.
//
// La defensa no puede ser "acordarse de limpiar". Tiene que ser imposible escribir: una suite
// mutante ABORTA antes de la primera escritura si el destino no es una base de pruebas aislada.
//
// Reglas:
//  - Se decide por el DESTINO (project ref / host), nunca por NODE_ENV ni por un flag genérico.
//  - Hay una lista explícita de refs prohibidos. Si el destino es uno de ellos: bloqueado.
//  - El destino aceptado por defecto es un LOOPBACK validado: el Supabase local del repositorio
//    (supabase/config.toml, API en 127.0.0.1). Un host que solo *parece* local no pasa.
//  - Hace falta configuración de pruebas EXPLÍCITA (SIM_TEST_SUPABASE_URL + su service role).
//    Si falta, está bloqueado. No hay default permisivo.
//  - Se revisa TODO el entorno del proceso: si cualquier variable contiene el project ref o la
//    URL de Producción, se bloquea. Un proceso mutante no puede tener a mano la base real.

/** Proyectos donde una prueba no puede escribir nunca. */
export const REFS_PROHIBIDOS: Record<string, string> = {
  bcmoewwhsyxsiyvroarj: "SIM WEB — Production (la base real del negocio)",
  unwoaqagnbrcaohxackc: "SIM TURNOS — fuera de alcance del proyecto",
};

export const VAR_URL_TEST = "SIM_TEST_SUPABASE_URL";
export const VAR_KEY_TEST = "SIM_TEST_SUPABASE_SERVICE_ROLE_KEY";

export type CodigoBloqueo =
  | "destino_prohibido"
  | "sin_config_de_pruebas"
  | "url_de_pruebas_invalida"
  | "ref_de_pruebas_prohibido"
  | "host_no_loopback"
  | "falta_clave_de_pruebas"
  | "entorno_contaminado";

export type Destino =
  | { ok: true; ref: string; url: string; motivo: string }
  | { ok: false; codigo: CodigoBloqueo; motivo: string };

/**
 * Project ref de una URL de Supabase alojada. Devuelve null si no se puede determinar: un
 * destino que no se puede identificar NO se considera seguro.
 */
export function refDeUrl(url: string | undefined | null): string | null {
  const s = String(url ?? "").trim();
  if (!s) return null;
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)(\/|$)/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/**
 * ¿Es un loopback de verdad? Se exige que el HOST sea exactamente 127.0.0.1, localhost o [::1].
 * No alcanza con que la URL contenga "localhost": `http://localhost.evil.com`,
 * `http://127.0.0.1.evil.com`, `http://user:pass@localhost@evil.com` y
 * `http://evil.com/?h=localhost` quedan afuera, y también cualquier URL con credenciales
 * embebidas, que es la forma clásica de disfrazar el host real.
 */
export function esLoopback(url: string | undefined | null): boolean {
  const s = String(url ?? "").trim();
  if (!s) return false;
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;           // credenciales embebidas: no
  if (u.pathname !== "" && u.pathname !== "/") return false; // la URL base no lleva path
  if (u.search || u.hash) return false;
  const host = u.hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

/**
 * ¿Alguna variable del entorno expone la base real? Si el proceso mutante tiene a mano el ref o
 * la URL de Producción, algo cargó `.env.local` y el aislamiento ya no se sostiene.
 */
export function entornoContaminado(env: Record<string, string | undefined>): string | null {
  for (const [k, v] of Object.entries(env)) {
    if (!v) continue;
    // Las variables del guardián y de la configuración de pruebas se revisan igual.
    for (const ref of Object.keys(REFS_PROHIBIDOS)) {
      if (v.includes(ref)) return `${k} contiene el project ref de ${REFS_PROHIBIDOS[ref]}`;
    }
  }
  return null;
}

/**
 * Decide si una suite mutante puede escribir. `principal` es a dónde apunta el entorno cargado
 * (lo que usaría supabaseAdmin); `urlTest`/`keyTest` son la configuración de pruebas explícita.
 * `entorno` es el entorno completo del proceso, para la revisión de contaminación.
 */
export function evaluarDestino(env: {
  principal?: string | null;
  urlTest?: string | null;
  keyTest?: string | null;
  entorno?: Record<string, string | undefined>;
}): Destino {
  const urlTest = String(env.urlTest ?? "").trim();
  const keyTest = String(env.keyTest ?? "").trim();

  // 1) Sin configuración de pruebas explícita: bloqueado, pase lo que pase con el resto.
  if (!urlTest) {
    const refPrincipal = refDeUrl(env.principal);
    const prohibido = refPrincipal ? REFS_PROHIBIDOS[refPrincipal] : undefined;
    return {
      ok: false,
      codigo: prohibido ? "destino_prohibido" : "sin_config_de_pruebas",
      motivo: prohibido
        ? `el entorno cargado apunta a ${refPrincipal} (${prohibido}) y no hay base de pruebas configurada en ${VAR_URL_TEST}`
        : `no hay base de pruebas configurada en ${VAR_URL_TEST}`,
    };
  }

  // 2) Un ref prohibido no se vuelve permitido por estar escrito en la variable de pruebas.
  const refTest = refDeUrl(urlTest);
  if (refTest && REFS_PROHIBIDOS[refTest]) {
    return {
      ok: false,
      codigo: "ref_de_pruebas_prohibido",
      motivo: `${VAR_URL_TEST} apunta a ${refTest} (${REFS_PROHIBIDOS[refTest]}): es un destino prohibido para pruebas`,
    };
  }

  // 3) El destino aceptado es un loopback validado. Cualquier host alojado —incluso uno que no
  //    esté en la lista de prohibidos— queda afuera: no se autoriza lo que no se conoce.
  if (!esLoopback(urlTest)) {
    if (!/^https?:\/\//i.test(urlTest)) {
      return { ok: false, codigo: "url_de_pruebas_invalida", motivo: `${VAR_URL_TEST} no es una URL http(s) reconocible` };
    }
    return {
      ok: false,
      codigo: "host_no_loopback",
      motivo: `${VAR_URL_TEST} no es un loopback validado (se esperaba 127.0.0.1, localhost o [::1], sin credenciales ni path)`,
    };
  }

  // 4) Sin service role de pruebas no se puede escribir nada igual.
  if (!keyTest) {
    return { ok: false, codigo: "falta_clave_de_pruebas", motivo: `falta ${VAR_KEY_TEST}` };
  }

  // 5) Y el proceso no puede tener a mano la base real por otra variable.
  const sucio = entornoContaminado(env.entorno ?? {});
  if (sucio) {
    return { ok: false, codigo: "entorno_contaminado", motivo: sucio };
  }

  return { ok: true, ref: "local", url: urlTest, motivo: "Supabase local del repositorio" };
}

/** Lee el entorno del proceso y evalúa el destino. */
export function destinoActual(): Destino {
  return evaluarDestino({
    principal: process.env.NEXT_PUBLIC_SUPABASE_URL,
    urlTest: process.env[VAR_URL_TEST],
    keyTest: process.env[VAR_KEY_TEST],
    entorno: process.env as Record<string, string | undefined>,
  });
}

export const CODIGO_SALIDA_BLOQUEADA = 78; // EX_CONFIG: configuración, no un test que falló

export function mensajeBloqueo(d: Extract<Destino, { ok: false }>): string {
  return [
    "",
    "═══ GUARDIA DE BASE DE PRUEBAS — suite mutante BLOQUEADA ═══",
    `Motivo: ${d.motivo} [${d.codigo}]`,
    "",
    "Esta suite escribe en la base, y las pruebas no pueden escribir en Production.",
    "Para habilitarla hace falta el Supabase local del repositorio:",
    "    npm run pruebas:iniciar     (levanta el stack y escribe .env.test.local)",
    "    npm run pruebas:esquema     (aplica el esquema desde db/orden.txt)",
    "    npm run pruebas:mutantes    (corre las suites contra la base local)",
    "",
    "Mientras el destino no sea esa base, la suite queda bloqueada a propósito.",
    "No es un test que falló.",
    "",
  ].join("\n");
}

/**
 * Lo que llama una suite mutante antes de cualquier escritura. No devuelve: o el destino es una
 * base de pruebas aislada, o el proceso termina acá.
 */
export function exigirBaseDePruebas(): Extract<Destino, { ok: true }> {
  const d = destinoActual();
  if (d.ok) return d;
  process.stderr.write(mensajeBloqueo(d));
  process.exit(CODIGO_SALIDA_BLOQUEADA);
}
