import {
  pepperDisponible,
  hashearToken,
  tokenConFormaValida,
  tokenDeAuthorization,
} from "@/lib/simControlCredentials";

// Autenticación de una TERMINAL (máquina), separada por completo de la del admin (persona).
//
// El panel usa la cookie firmada de `lib/adminSession.ts`; una terminal usa su propia credencial en
// `Authorization: Bearer`. Nunca se cruzan: la API de terminales no mira cookies, y el panel no
// acepta tokens de terminal.
//
// Módulo con la decisión pura; la búsqueda en la base entra por parámetro para poder testear todos
// los caminos sin Supabase.

export type CredencialCentral = {
  credentialId: string;
  terminalId: string;
  terminalKey: string;
  displayName: string;
  terminalActiva: boolean;
  credencialRevocada: boolean;
};

export type TerminalAutenticada = {
  id: string;
  terminalKey: string;
  displayName: string;
  credentialId: string;
};

export type FalloAuth = "unauthorized" | "terminal_disabled" | "temporarily_unavailable";

export type ResultadoAuth =
  | { ok: true; terminal: TerminalAutenticada }
  | { ok: false; code: FalloAuth; motivo: string };

/** Busca una credencial por el hash de su token. Devuelve null si no existe ninguna. */
export type BuscarCredencialPorHash = (tokenHash: string) => Promise<CredencialCentral | null>;

/**
 * Autentica una terminal.
 *
 * Reglas de seguridad, en orden:
 *
 *  · Sin pepper del servidor la autenticación NO se degrada a un hash más débil: se apaga. Es
 *    preferible un 503 honesto a validar credenciales de una forma que no es la documentada.
 *  · Todo lo que no sea una credencial válida devuelve `unauthorized` con el MISMO mensaje: token
 *    mal formado, inexistente o de otra terminal son indistinguibles desde afuera. Un atacante no
 *    puede usar las respuestas para averiguar qué terminales existen.
 *  · Solo DESPUÉS de probar que el token es válido se distingue `terminal_disabled`. Eso le sirve al
 *    operador legítimo —que ve "esta terminal está dada de baja" en vez de pelearse con la
 *    credencial— sin darle nada a quien no tiene el token.
 */
export async function autenticarTerminal(args: {
  authorization: string | null | undefined;
  terminalKey: string;
  buscar: BuscarCredencialPorHash;
}): Promise<ResultadoAuth> {
  if (!pepperDisponible()) {
    return {
      ok: false,
      code: "temporarily_unavailable",
      motivo: "falta SIM_CONTROL_CREDENTIAL_PEPPER en el servidor",
    };
  }

  const token = tokenDeAuthorization(args.authorization);
  if (!token || !tokenConFormaValida(token)) {
    return { ok: false, code: "unauthorized", motivo: "credencial ausente o mal formada" };
  }

  const credencial = await args.buscar(hashearToken(token));
  if (!credencial) {
    return { ok: false, code: "unauthorized", motivo: "credencial desconocida" };
  }

  // La credencial tiene que ser de la terminal que dice el header. Si no coincide, es tan
  // "desconocida" como cualquier otra cosa: no se informa la diferencia.
  if (credencial.terminalKey !== args.terminalKey.trim()) {
    return { ok: false, code: "unauthorized", motivo: "la credencial no corresponde a esa terminal" };
  }

  if (credencial.credencialRevocada) {
    return { ok: false, code: "unauthorized", motivo: "credencial revocada" };
  }

  if (!credencial.terminalActiva) {
    return { ok: false, code: "terminal_disabled", motivo: "terminal dada de baja" };
  }

  return {
    ok: true,
    terminal: {
      id: credencial.terminalId,
      terminalKey: credencial.terminalKey,
      displayName: credencial.displayName,
      credentialId: credencial.credentialId,
    },
  };
}
