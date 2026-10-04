// GUARDIÁN DE BASE DE PRUEBAS — fail-closed. Puro y testeable.
//
// Por qué existe: las suites de integración se corren con `--env-file=.env.local`, y ese archivo
// apunta al proyecto de PRODUCCIÓN. Cada suite mutante creaba clientes, mensualidades,
// campeonatos, inscripciones pagadas y reservas en la base real, y confiaba en un `finally` para
// borrarlos. Un proceso interrumpido (Ctrl-C, timeout, kill, fin de sesión) nunca ejecuta ese
// `finally`: así quedaron 87 filas sintéticas visibles en el panel, con $800.000 de recaudación
// ficticia en Campeonatos de octubre de 2026.
//
// La defensa no puede ser "acordarse de limpiar". Tiene que ser imposible escribir: una suite
// mutante ABORTA antes de la primera escritura si el destino no es una base de pruebas aislada.
//
// Reglas:
//  - Se decide por el PROJECT REF de la URL, nunca por NODE_ENV ni por un flag genérico.
//  - Hay una lista explícita de refs prohibidos. Si el destino es uno de ellos: bloqueado.
//  - Hace falta configuración de pruebas EXPLÍCITA (SIM_TEST_SUPABASE_URL + su service role).
//    Si falta, está bloqueado. No hay default permisivo.
//  - El ref de pruebas tiene que ser DISTINTO de todos los prohibidos.

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
  | "falta_clave_de_pruebas";

export type Destino =
  | { ok: true; ref: string; url: string; motivo: string }
  | { ok: false; codigo: CodigoBloqueo; motivo: string };

/**
 * Project ref de una URL de Supabase. Devuelve null si no se puede determinar: un destino que no
 * se puede identificar NO se considera seguro (fail-closed), se considera no configurado.
 */
export function refDeUrl(url: string | undefined | null): string | null {
  const s = String(url ?? "").trim();
  if (!s) return null;
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)(\/|$)/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/** ¿Es un destino local de desarrollo (supabase start)? Esos sí pueden escribirse. */
function esLocal(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());
}

/**
 * Decide si una suite mutante puede escribir. `principal` es a dónde apunta el entorno cargado
 * (lo que usaría supabaseAdmin); `urlTest`/`keyTest` son la configuración de pruebas explícita.
 */
export function evaluarDestino(env: {
  principal?: string | null;
  urlTest?: string | null;
  keyTest?: string | null;
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

  // 2) La URL de pruebas tiene que ser identificable: un proyecto de Supabase o un local.
  const local = esLocal(urlTest);
  const refTest = refDeUrl(urlTest);
  if (!local && !refTest) {
    return { ok: false, codigo: "url_de_pruebas_invalida", motivo: `${VAR_URL_TEST} no es una URL de Supabase reconocible` };
  }

  // 3) Un ref prohibido no se vuelve permitido por estar escrito en la variable de pruebas.
  if (refTest && REFS_PROHIBIDOS[refTest]) {
    return {
      ok: false,
      codigo: "ref_de_pruebas_prohibido",
      motivo: `${VAR_URL_TEST} apunta a ${refTest} (${REFS_PROHIBIDOS[refTest]}): es un destino prohibido para pruebas`,
    };
  }

  // 4) Sin service role de pruebas no se puede escribir nada igual.
  if (!keyTest) {
    return { ok: false, codigo: "falta_clave_de_pruebas", motivo: `falta ${VAR_KEY_TEST}` };
  }

  return {
    ok: true,
    ref: refTest ?? "local",
    url: urlTest,
    motivo: local ? "base local de desarrollo" : `proyecto de pruebas ${refTest}`,
  };
}

/** Lee el entorno del proceso y evalúa el destino. */
export function destinoActual(): Destino {
  return evaluarDestino({
    principal: process.env.NEXT_PUBLIC_SUPABASE_URL,
    urlTest: process.env[VAR_URL_TEST],
    keyTest: process.env[VAR_KEY_TEST],
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
    `Para habilitarla hace falta una base de pruebas aislada: ${VAR_URL_TEST} y ${VAR_KEY_TEST}.`,
    "Mientras no exista, la suite queda bloqueada a propósito. No es un test que falló.",
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
