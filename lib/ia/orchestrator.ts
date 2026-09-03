import type { IAProvider, HistorialTurno, ResultadoHerramienta, WebSearchParam } from "@/lib/ia/provider";
import { IAProviderError } from "@/lib/ia/provider";
import type { IALimites, ModeloClase } from "@/lib/ia/config";
import { SYSTEM_PROMPT } from "@/lib/ia/systemPrompt";
import { elegirModelo, debeEscalar } from "@/lib/ia/router";
import { HERRAMIENTAS, defsParaProveedor, ToolParamError, type ToolFuente } from "@/lib/ia/tools";
import { dedupFuentesWeb, type FuenteWeb } from "@/lib/ia/web/fuentes";
import { capacidadesWeb, UBICACION_BUSQUEDA } from "@/lib/ia/web/capacidades";

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
  // Bloque 4D.3 — la síntesis final se cortó por límite de salida (stop_reason=max_tokens):
  // el servidor NO debe publicar el texto parcial (integridad fuerte).
  truncado?: boolean;
  // Bloque 4D — búsqueda web (server tool de Anthropic).
  web: {
    habilitada: boolean;      // se ofreció la herramienta al modelo
    explicita: boolean;       // el admin pidió internet explícitamente
    motivo: string;           // por qué se habilitó/deshabilitó (determinístico)
    busquedasFacturables: number;
    fuentes: FuenteWeb[];
    error?: string;           // código de error normalizado (si lo hubo)
    consultas: string[];      // queries EJECUTADAS por el modelo (se completan en el server)
  };
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
  // Bloque 4D — decisión DETERMINÍSTICA de búsqueda web (tomada antes de llamar al proveedor).
  web?: { habilitar: boolean; explicita: boolean; motivo: string; maxUsos: number; version: string };
  // Bloque 4D.2 — subconjunto de herramientas por intención (menos schemas = menos tokens).
  herramientasPermitidas?: string[];
  // Bloque 4D.2 — override del máximo de tokens de salida (evita truncar síntesis complejas).
  maxTokensSalida?: number;
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

  // ── Estado de la búsqueda web (Bloque 4D) ──────────────────────────────────
  const webConf = p.web;
  const webHabilitadaGeneral = Boolean(webConf?.habilitar);
  let webBusquedas = 0;
  const webFuentesAcum: FuenteWeb[] = [];
  const webConsultas: string[] = [];
  let webError: string | undefined;
  let webDegradada = false; // si el proveedor rechazó la web (400) y se siguió sin ella

  const restante = () => p.limites.tiempoEjecucionMsMax - (Date.now() - inicio);
  const construirWeb = (): EjecucionResultado["web"] => ({
    habilitada: webHabilitadaGeneral, explicita: Boolean(webConf?.explicita),
    motivo: webConf?.motivo ?? "sin_web", busquedasFacturables: webBusquedas,
    fuentes: dedupFuentesWeb(webFuentesAcum), error: webDegradada ? "web_no_disponible" : webError, consultas: [...webConsultas],
  });
  const fin = (r: Partial<EjecucionResultado> & Pick<EjecucionResultado, "estado" | "texto">): EjecucionResultado => ({
    fuentes, herramientas: herramientasEjecutadas, modelo, claseModelo: clase, motivoRouter: decision.motivo, escalado, rondas, uso: { tokensIn, tokensOut }, duracion_ms: Date.now() - inicio, error: undefined, web: construirWeb(), ...r,
  });

  // Tope de búsquedas web POR RESPUESTA (no se aumenta silenciosamente). Al agotarse, se
  // deja de ofrecer la herramienta en las rondas siguientes.
  const presupuestoWeb = webConf?.maxUsos ?? 0;
  const acumular = (turno: { web?: { busquedasFacturables: number; fuentes: FuenteWeb[]; error?: string; consultas?: string[] } }) => {
    if (!turno.web) return;
    webBusquedas += turno.web.busquedasFacturables || 0;
    for (const f of turno.web.fuentes) webFuentesAcum.push(f);
    for (const q of turno.web.consultas ?? []) webConsultas.push(q);
    if (turno.web.error) webError = turno.web.error;
  };

  try {
    while (true) {
      if (restante() <= 0) return fin({ estado: "error", texto: "", error: "Se agotó el tiempo de ejecución." });
      const permitirHerramientas = rondas < p.limites.rondasHerramientasMax;
      // Ofrecer web solo si está habilitada y queda presupuesto (y no fue degradada por 400).
      const restanteWeb = Math.max(0, presupuestoWeb - webBusquedas);
      const ofrecerWeb = webHabilitadaGeneral && !webDegradada && restanteWeb > 0;
      // Capacidades resueltas por el MODELO actual (versión básica salvo config moderna explícita).
      const cap = capacidadesWeb(modelo);
      const webParam: WebSearchParam | undefined = ofrecerWeb ? { habilitado: true, maxUsos: restanteWeb, version: cap.version, filtradoDinamico: cap.filtradoDinamico, responseInclusionExcluded: cap.responseInclusionExcluded, ubicacion: UBICACION_BUSQUEDA } : undefined;

      let turno;
      try {
        turno = await p.provider.generar({
          modelo, system, historial,
          herramientas: permitirHerramientas ? defsParaProveedor(p.herramientasPermitidas) : [],
          maxTokensSalida: Math.min(p.maxTokensSalida ?? p.limites.tokensSalidaMax, 8000),
          timeoutMs: Math.max(1000, restante()),
          webSearch: webParam,
        });
      } catch (e) {
        // Degradación (§15): si el proveedor rechaza la búsqueda web (400: deshabilitada en
        // Console o incompatible), se reintenta UNA vez SIN web para responder la parte interna.
        if (e instanceof IAProviderError && e.status === 400 && ofrecerWeb && !webDegradada) {
          webDegradada = true;
          continue; // misma ronda, ahora sin web
        }
        throw e;
      }
      tokensIn += turno.uso.tokensIn; tokensOut += turno.uso.tokensOut;
      acumular(turno);

      if (turno.tipo === "texto") {
        return fin({ estado: "completa", texto: turno.texto, truncado: turno.stopReason === "max_tokens" });
      }

      // Turno con herramientas
      let llamadas = turno.llamadas;
      if (llamadas.length > p.limites.herramientasPorRespuestaMax) {
        llamadas = llamadas.slice(0, p.limites.herramientasPorRespuestaMax);
      }
      // Se conservan los bloques crudos del proveedor (web/cifrados) para continuar el turno.
      historial.push({ rol: "assistant", texto: turno.texto, llamadas, rawContent: turno.rawContent });

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
