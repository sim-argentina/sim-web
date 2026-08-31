import type { IAProvider, GenerarParams, TurnoProveedor, Uso } from "@/lib/ia/provider";

// Proveedor FALSO determinístico (solo tests / IA_PROVIDER=fake). No llama a ninguna
// API externa. Permite verificar el orquestador, las herramientas y la UI sin gastar.

// Estima tokens de forma grosera (para medir el pipeline, no para facturar).
function estimarTokens(texto: string): number {
  return Math.max(1, Math.ceil((texto || "").length / 4));
}

export type GuionTurno =
  | { tipo: "texto"; texto: string }
  | { tipo: "herramientas"; texto?: string; llamadas: Array<{ nombre: string; input: Record<string, unknown> }> }
  | { tipo: "error"; mensaje: string }
  | { tipo: "timeout" };

// Proveedor guionado: devuelve los turnos en orden. Ideal para tests deterministas.
export class FakeProviderGuionado implements IAProvider {
  nombre = "fake";
  private i = 0;
  constructor(private guion: GuionTurno[]) {}
  async generar(params: GenerarParams): Promise<TurnoProveedor> {
    const paso = this.guion[this.i] ?? { tipo: "texto", texto: "(fin del guión)" };
    this.i++;
    if (paso.tipo === "error") throw new Error(paso.mensaje);
    if (paso.tipo === "timeout") { await new Promise((r) => setTimeout(r, params.timeoutMs + 50)); throw new Error("timeout"); }
    const inTok = estimarTokens(params.system + JSON.stringify(params.historial));
    // Proveedor compliant: si no se le ofrecen herramientas (tope de rondas), responde texto.
    if (paso.tipo === "herramientas" && params.herramientas.length === 0) {
      return { tipo: "texto", texto: "(sin más herramientas disponibles) respuesta final.", uso: { tokensIn: inTok, tokensOut: 8 } };
    }
    if (paso.tipo === "herramientas") {
      return { tipo: "herramientas", texto: paso.texto, uso: { tokensIn: inTok, tokensOut: 10 }, llamadas: paso.llamadas.map((l, k) => ({ id: `fake-${this.i}-${k}`, nombre: l.nombre, input: l.input })) };
    }
    return { tipo: "texto", texto: paso.texto, uso: { tokensIn: inTok, tokensOut: estimarTokens(paso.texto) } };
  }
}

// Proveedor por defecto para IA_PROVIDER=fake (sin guión): heurística mínima que igual
// consulta una herramienta real y responde con evidencia, para probar el flujo E2E.
export class FakeProviderDefault implements IAProvider {
  nombre = "fake";
  async generar(params: GenerarParams): Promise<TurnoProveedor> {
    const yaHuboTool = params.historial.some((t) => t.rol === "tool");
    const uso: Uso = { tokensIn: estimarTokens(params.system + JSON.stringify(params.historial)), tokensOut: 20 };
    const ultimoUser = [...params.historial].reverse().find((t) => t.rol === "user");
    const pregunta = ultimoUser && ultimoUser.rol === "user" ? ultimoUser.texto : "";

    if (!yaHuboTool && /turno|hora|factur|ganan|equipo|federico|francisco|ramiro|fede|fran|rami/i.test(pregunta) && params.herramientas.some((h) => h.nombre === "consultar_metricas_equipo")) {
      const ahora = new Date();
      return { tipo: "herramientas", uso, llamadas: [{ id: "fake-0", nombre: "consultar_metricas_equipo", input: { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 } }] };
    }
    // Con resultados de herramienta (o sin match), respuesta de texto con nota de proveedor falso.
    const tool = [...params.historial].reverse().find((t) => t.rol === "tool");
    const resumen = tool && tool.rol === "tool" ? tool.resultados.map((r) => r.contenido).join(" ").slice(0, 600) : "Sin datos consultados.";
    const texto = `[proveedor de prueba] Respuesta directa basada en las herramientas consultadas. Datos: ${resumen}`;
    return { tipo: "texto", texto, uso: { ...uso, tokensOut: estimarTokens(texto) } };
  }
}
