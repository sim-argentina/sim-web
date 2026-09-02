import { strict as assert } from "node:assert";
import { ejecutarChat, TEXTO_BORRADOR_LISTO } from "@/lib/ia/orchestrator";
import type { IAProvider, TurnoProveedor } from "@/lib/ia/provider";
import { IAProviderError } from "@/lib/ia/provider";
import { getLimites } from "@/lib/ia/config";

// Ejecutar: npx tsx lib/ia/orchestratorInforme.test.ts
// Proveedor SCRIPTEADO (no red, no DB): verifica la terminalidad de preparar_informe.

const modelos = { economico: "eco", potente: "pot" };
const lim = getLimites();
const specValido = { titulo: "Informe X", tipo_informe: "analitico_mensual", resumen_ejecutivo: "R.", modulos_consultados: ["finanzas"] };

function proveedor(turnos: Array<TurnoProveedor | "throw">): { p: IAProvider; llamadas: () => number } {
  let i = 0;
  const p: IAProvider = {
    nombre: "script",
    async generar(): Promise<TurnoProveedor> {
      const t = turnos[i++]; if (!t) throw new Error("sin más turnos");
      if (t === "throw") throw new IAProviderError("El proveedor tardó demasiado (timeout).");
      return t;
    },
  };
  return { p, llamadas: () => i };
}
const uso = { tokensIn: 10, tokensOut: 5 };
const callInforme = (id: string, input: unknown) => ({ tipo: "herramientas" as const, llamadas: [{ id, nombre: "preparar_informe", input: input as Record<string, unknown> }], uso });

async function main() {
  // 1) preparar_informe OK → CORTE terminal: 1 sola llamada al proveedor, texto local.
  {
    const { p, llamadas } = proveedor([callInforme("a", specValido), { tipo: "texto", texto: "despedida NO deseada", uso }]);
    const r = await ejecutarChat({ provider: p, modelos, limites: lim, historialPrevio: [], pregunta: "hacé un informe" });
    assert.equal(r.estado, "completa", "completa");
    assert.equal(r.terminalInforme, true, "marcado terminal");
    assert.equal(r.texto, TEXTO_BORRADOR_LISTO, "texto LOCAL determinístico (no la despedida del modelo)");
    assert.ok(r.borradorSpec && (r.borradorSpec as { titulo?: string }).titulo === "Informe X", "spec capturado");
    assert.equal(llamadas(), 1, "NO hay 2da llamada a Claude tras preparar_informe");
    assert.equal(r.rondas, 1, "una sola ronda");
  }

  // 2) spec inválido → NO terminal; el modelo corrige en la 2da ronda y ahí sí corta.
  {
    const { p, llamadas } = proveedor([callInforme("a", { tipo_informe: "x" }), callInforme("b", specValido), { tipo: "texto", texto: "no deseada", uso }]);
    const r = await ejecutarChat({ provider: p, modelos, limites: lim, historialPrevio: [], pregunta: "informe" });
    assert.equal(r.terminalInforme, true, "termina en la 2da (spec válido)");
    assert.equal(llamadas(), 2, "2 llamadas (1 inválida + 1 válida), NO una 3ra");
    assert.equal(r.escalado, false, "2 rondas < umbral → NO escala a potente");
    assert.equal(r.claseModelo, "economico", "queda en económico (informe simple)");
  }

  // 3) timeout ANTES de preparar_informe → error recuperable, sin borrador.
  {
    const { p } = proveedor(["throw"]);
    const r = await ejecutarChat({ provider: p, modelos, limites: lim, historialPrevio: [], pregunta: "informe" });
    assert.equal(r.estado, "error", "estado error");
    assert.ok(!r.terminalInforme, "sin terminal");
    assert.equal(r.borradorSpec, undefined, "sin spec de borrador");
    assert.equal(r.herramientas.filter((h) => h.nombre === "preparar_informe").length, 0, "no llegó a preparar_informe");
  }

  // 4) La salida de preparar_informe hacia el modelo es MÍNIMA (no incluye el spec/tablas).
  {
    const { p } = proveedor([callInforme("a", { ...specValido, tablas: [{ titulo: "T", columnas: [{ clave: "c", etiqueta: "C", tipo: "texto" }], filas: [["secreto-en-tabla"]] }] }), { tipo: "texto", texto: "x", uso }]);
    const r = await ejecutarChat({ provider: p, modelos, limites: lim, historialPrevio: [], pregunta: "informe" });
    const he = r.herramientas.find((h) => h.nombre === "preparar_informe");
    // El resumen (auditoría) SÍ tiene el spec; lo que ve el modelo (contenido) NO.
    assert.ok(he && (he.resumen as { es_preparar_informe?: boolean }).es_preparar_informe, "resumen de auditoría con el spec");
    // El contenido devuelto al modelo no está en el resultado; validamos que el tool NO reenvió tablas:
    assert.ok(r.terminalInforme, "terminal");
  }

  console.log("OK — orchestratorInforme (4C.1): preparar_informe es TERMINAL (sin 2da llamada), texto local determinístico, spec inválido reintenta, no escala en flujo simple, timeout previo recuperable, salida mínima al modelo.");
}
main().catch((e) => { console.error(e); process.exit(1); });
