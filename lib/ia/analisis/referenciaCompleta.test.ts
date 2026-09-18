import { strict as assert } from "node:assert";
// Import de solo efecto ANTES de "analisis/herramientas": tools.ts y herramientas.ts se
// importan mutuamente (herramientas.ts registra HERRAMIENTAS_ANALISIS dentro de tools.ts). En
// la app real, orchestrator.ts siempre importa tools.ts primero, por eso el ciclo se resuelve
// bien; acá hay que forzar el mismo orden para no pisar la inicialización.
import "@/lib/ia/tools";
import { construirBloqueReferenciaCompleta, MARCADOR_REFERENCIA_COMPLETA } from "@/lib/ia/analisis/herramientas";

// Ejecutar: npx tsx lib/ia/analisis/referenciaCompleta.test.ts — puro.
//
// Bloque 4E (hotfix 3) — el bloque de "referencia del mes completo" es DETERMINÍSTICO: se
// construye acá, en el servidor, a partir del resultado ESTRUCTURADO de comparar_periodos, sin
// que el modelo tenga que narrarlo. Estas pruebas cubren el ensamblado puro (sin DB, sin Claude);
// el recorrido end-to-end (correrChat con proveedor falso) está en servidor4e.integration.ts.

const metrica = (clave: string, valorBFormateado: string) => ({
  clave, etiqueta: clave, valorA: 0, valorB: 0, diferencia: 0, variacionPct: null,
  unidad: "cantidad" as const, valorAFormateado: valorBFormateado, valorBFormateado,
  diferenciaFormateada: "—", variacionFormateada: "no aplica (referencia)",
});

function main() {
  // ── No es modo equivalente → no hay bloque (dos meses cerrados, mismo período, etc.) ────
  {
    assert.equal(construirBloqueReferenciaCompleta({ modoPeriodo: "completos", referenciaCompleta: null }), null);
    assert.equal(construirBloqueReferenciaCompleta({ modoPeriodo: "mismo_periodo", referenciaCompleta: null }), null);
    assert.equal(construirBloqueReferenciaCompleta(null), null);
    assert.equal(construirBloqueReferenciaCompleta(undefined), null);
  }
  console.log("OK — sin modo equivalente (completos/mismo_periodo/ausente) → sin bloque.");

  // ── Modo equivalente pero SIN referenciaCompleta (el motor no pudo traerla): aviso explícito,
  // nunca "0" inventado ni silencio total. ────────────────────────────────────────────────────
  {
    const b = construirBloqueReferenciaCompleta({ modoPeriodo: "equivalente", referenciaCompleta: null });
    assert.ok(b, "hay un bloque (de indisponibilidad)");
    assert.ok(/no se pudo obtener/i.test(b!), "avisa explícitamente que no se pudo obtener");
    assert.ok(!/\d/.test(b!), "no inventa ningún número");
  }
  console.log("OK — modo equivalente sin referenciaCompleta → avisa indisponibilidad, sin inventar cifras.");

  // ── referenciaCompleta presente pero sin turnos/facturación (datos incompletos) — mismo aviso ─
  {
    const b = construirBloqueReferenciaCompleta({
      modoPeriodo: "equivalente",
      referenciaCompleta: { etiqueta: "agosto 2026 (mes completo, referencia histórica)", metricas: [metrica("personas", "500")] },
    });
    assert.ok(b && /no se pudo obtener/i.test(b));
  }
  console.log("OK — referencia incompleta (falta turnos o facturación) → mismo aviso de indisponibilidad.");

  // ── Caso normal: turnos + facturación (+ personas si está), sin diferencia/variación/0% ───
  {
    const b = construirBloqueReferenciaCompleta({
      modoPeriodo: "equivalente",
      referenciaCompleta: {
        etiqueta: "agosto 2026 (mes completo, referencia histórica)",
        metricas: [metrica("turnos", "912"), metrica("personas", "820"), metrica("facturacion_bruta", "$10.404.000")],
      },
    })!;
    assert.ok(b.toLowerCase().includes(MARCADOR_REFERENCIA_COMPLETA), "usa el marcador propio del ensamblador");
    assert.ok(b.includes("agosto 2026"), "nombre del mes dinámico (no hardcodeado en el ensamblador)");
    assert.ok(!b.includes("(mes completo, referencia histórica)"), "se limpia el sufijo interno de la etiqueta");
    assert.ok(b.includes("912"), "turnos del resultado estructurado, no inventados");
    assert.ok(b.includes("820"), "personas, si están disponibles, también se muestran");
    assert.ok(b.includes("$10.404.000"), "facturación bruta con formato argentino ($ y separador de miles)");
    // El texto SÍ puede aclarar en prosa que "no interviene en la diferencia ni en la
    // variación" (es la aclaración que pide el propio requisito); lo que nunca debe aparecer es
    // una diferencia/variación CALCULADA como dato (ej. "Diferencia: -115", "Variación: -18%").
    assert.ok(!/^[-*]?\s*(diferencia|variaci[oó]n)\s*:/im.test(b), "no hay una línea de dato 'Diferencia:'/'Variación:' calculada");
    assert.ok(!/%/.test(b), "el bloque de referencia no tiene ningún porcentaje (ni siquiera 0%)");
  }
  console.log("OK — caso normal: turnos/personas/facturación bruta reales, formato argentino, sin diferencia/variación/0%.");

  // ── Sin personas disponibles: igual arma el bloque solo con lo mínimo obligatorio ─────────
  {
    const b = construirBloqueReferenciaCompleta({
      modoPeriodo: "equivalente",
      referenciaCompleta: { etiqueta: "julio 2026 (mes completo, referencia histórica)", metricas: [metrica("turnos", "700"), metrica("facturacion_bruta", "$8.000.000")] },
    })!;
    assert.ok(b.includes("700") && b.includes("$8.000.000"));
    assert.ok(!/personas/i.test(b), "sin dato de personas, no se inventa ni se menciona");
  }
  console.log("OK — mínimo obligatorio (turnos + facturación) alcanza sin personas.");

  console.log("\nOK — referenciaCompleta (puro): bloque determinístico del mes completo, sin depender del modelo, sin diferencia/variación/0%, con formato argentino y datos siempre del resultado estructurado.");
}
main();
