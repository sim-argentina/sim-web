import type { IAProvider, HistorialTurno, ResultadoHerramienta } from "@/lib/ia/provider";
import { IAProviderError } from "@/lib/ia/provider";
import type { IALimites, ModeloClase } from "@/lib/ia/config";
import { SYSTEM_PROMPT } from "@/lib/ia/systemPrompt";
import { elegirModelo, debeEscalar } from "@/lib/ia/router";
import { HERRAMIENTAS, defsParaProveedor, ToolParamError, type ToolFuente } from "@/lib/ia/tools";

// IA SIM · Bloque 4A — Orquestador determinístico del chat. Corre el loop
// proveedor ↔ herramientas con TODAS las guardas (rondas, herramientas por ronda,
// tiempo, herramienta inexistente, params inválidos). No persiste: devuelve todo
// para que el endpoint lo guarde/audite.

export type HerramientaEjecutada = { nombre: string; params: Record<string, unknown>; resumen: Record<string, unknown> | null; ok: boolean; error?: string; duracion_ms: number };

export type EjecucionResultado = {
  estado: "completa" | "error";
  texto: string;
  error?: string;
  fuentes: ToolFuente[];
  herramientas: HerramientaEjecutada[];
  modelo: string;
  claseModelo: ModeloClase;
  motivoRouter: string;
  escalado: boolean;
  rondas: number;
  uso: { tokensIn: number; tokensOut: number };
  duracion_ms: number;
  // Bloque 4C.1: si una herramienta TERMINAL (preparar_informe) se ejecutó OK, el loop
  // se detiene acá (sin otra llamada a Claude) y el servidor persiste el borrador.
  terminalInforme?: boolean;
  borradorSpec?: unknown;
};

// Respuesta LOCAL determinística tras preparar el borrador (no consume tokens).
export const TEXTO_BORRADOR_LISTO = "Preparé el borrador del informe. Revisalo y editá lo que necesites antes de generar los archivos.";

export type EjecutarChatParams = {
  provider: IAProvider;
  modelos: Record<ModeloClase, string>;
  limites: IALimites;
  historialPrevio: HistorialTurno[];
  pregunta: string;
  contextoUsuario?: string; // contexto dinámico (conocimiento/adjuntos) como DATO de nivel USUARIO
};

export async function ejecutarChat(p: EjecutarChatParams): Promise<EjecucionResultado> {
  const inicio = Date.now();
  const decision = elegirModelo(p.pregunta);
  let clase: ModeloClase = decision.clase;
  let modelo = p.modelos[clase];
  let escalado = false;

  // El prompt del sistema es ESTÁTICO (reglas estables). El conocimiento/adjuntos
  // recuperados NUNCA se concatenan al sistema: viajan como CONTEXTO de nivel USUARIO.
  const system = SYSTEM_PROMPT;
  const turnoUsuario = p.contextoUsuario ? `${p.contextoUsuario}\n\n[PREGUNTA DEL ADMINISTRADOR]\n${p.pregunta}` : p.pregunta;
  const historial: HistorialTurno[] = [...p.historialPrevio, { rol: "user", texto: turnoUsuario }];
  const herramientasEjecutadas: HerramientaEjecutada[] = [];
  const fuentes: ToolFuente[] = [];
  let tokensIn = 0, tokensOut = 0;
  let rondas = 0;

  const restante = () => p.limites.tiempoEjecucionMsMax - (Date.now() - inicio);
  const fin = (r: Partial<EjecucionResultado> & Pick<EjecucionResultado, "estado" | "texto">): EjecucionResultado => ({
    fuentes, herramientas: herramientasEjecutadas, modelo, claseModelo: clase, motivoRouter: decision.motivo, escalado, rondas, uso: { tokensIn, tokensOut }, duracion_ms: Date.now() - inicio, error: undefined, ...r,
  });

  try {
    while (true) {
      if (restante() <= 0) return fin({ estado: "error", texto: "", error: "Se agotó el tiempo de ejecución." });
      const permitirHerramientas = rondas < p.limites.rondasHerramientasMax;
      const turno = await p.provider.generar({
        modelo, system, historial,
        herramientas: permitirHerramientas ? defsParaProveedor() : [],
        maxTokensSalida: p.limites.tokensSalidaMax,
        timeoutMs: Math.max(1000, restante()),
      });
      tokensIn += turno.uso.tokensIn; tokensOut += turno.uso.tokensOut;

      if (turno.tipo === "texto") {
        return fin({ estado: "completa", texto: turno.texto });
      }

      // Turno con herramientas
      let llamadas = turno.llamadas;
      if (llamadas.length > p.limites.herramientasPorRespuestaMax) {
        llamadas = llamadas.slice(0, p.limites.herramientasPorRespuestaMax);
      }
      historial.push({ rol: "assistant", texto: turno.texto, llamadas });

      const resultados: ResultadoHerramienta[] = [];
      let terminalSpec: unknown;
      let hayTerminal = false;
      for (const ll of llamadas) {
        const t0 = Date.now();
        const def = HERRAMIENTAS[ll.nombre];
        if (!def) {
          herramientasEjecutadas.push({ nombre: ll.nombre, params: ll.input, resumen: null, ok: false, error: "herramienta_inexistente", duracion_ms: Date.now() - t0 });
          resultados.push({ id: ll.id, nombre: ll.nombre, ok: false, contenido: JSON.stringify({ error: "Herramienta no permitida o inexistente." }) });
          continue;
        }
        // Si ya se preparó un borrador en esta ronda, no ejecutamos más herramientas.
        if (hayTerminal) {
          resultados.push({ id: ll.id, nombre: ll.nombre, ok: false, contenido: JSON.stringify({ error: "El borrador ya fue preparado; no se ejecutan más herramientas." }) });
          continue;
        }
        try {
          const r = await def.ejecutar(ll.input);
          fuentes.push(r.fuente);
          herramientasEjecutadas.push({ nombre: ll.nombre, params: ll.input, resumen: r.resumen, ok: true, duracion_ms: Date.now() - t0 });
          resultados.push({ id: ll.id, nombre: ll.nombre, ok: true, contenido: r.contenido });
          // Herramienta TERMINAL exitosa (preparar_informe): capturar el spec y cortar.
          if (def.terminal && (r.resumen as { es_preparar_informe?: boolean } | null)?.es_preparar_informe) {
            terminalSpec = (r.resumen as { spec?: unknown }).spec;
            hayTerminal = true;
          }
        } catch (e) {
          const msg = e instanceof ToolParamError ? e.message : "No se pudo ejecutar la herramienta.";
          herramientasEjecutadas.push({ nombre: ll.nombre, params: ll.input, resumen: null, ok: false, error: msg, duracion_ms: Date.now() - t0 });
          resultados.push({ id: ll.id, nombre: ll.nombre, ok: false, contenido: JSON.stringify({ error: msg }) });
        }
      }
      historial.push({ rol: "tool", resultados });
      rondas++;

      // TERMINAL: el pedido se cumplió (borrador preparado). Cortamos el loop y devolvemos
      // una respuesta LOCAL determinística. NO hay otra llamada a Claude.
      if (hayTerminal) {
        return fin({ estado: "completa", texto: TEXTO_BORRADOR_LISTO, terminalInforme: true, borradorSpec: terminalSpec });
      }

      if (debeEscalar(clase, rondas) && !escalado) {
        clase = "potente"; modelo = p.modelos.potente; escalado = true;
      }
      // Si se alcanzó el máximo de rondas, forzar una respuesta de texto (sin herramientas)
      // en la próxima iteración: permitirHerramientas será false.
    }
  } catch (e) {
    const msg = e instanceof IAProviderError ? e.message : "Error del proveedor de IA.";
    return fin({ estado: "error", texto: "", error: msg });
  }
}
