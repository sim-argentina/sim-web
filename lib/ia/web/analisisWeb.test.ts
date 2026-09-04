import { strict as assert } from "node:assert";
import { validarAnalisisWeb, LIMITES_ANALISIS_WEB, type FuenteInternaDisponible, type FuenteExternaDisponible } from "@/lib/ia/web/analisisWebSchema";
import { renderAnalisisWeb } from "@/lib/ia/web/renderAnalisisWeb";

// Ejecutar: npx tsx lib/ia/web/analisisWeb.test.ts — puro (sin red ni Supabase).
// Corrección 4D.5.2 — valida el esquema TERMINAL emitir_analisis_web: nunca acepta ids de
// fuente inventados, recorta longitudes/cantidades por encima del límite, y calcula la
// clasificación de cada actor DETERMINÍSTICAMENTE (nunca confía en la autoevaluación del modelo).

const internas: FuenteInternaDisponible[] = [
  { id: "int-1", texto: "SIM Argentina opera en Córdoba.", modulo: "Identidad SIM", actualizado: "2026-09-04T00:00:00.000Z" },
  { id: "int-2", texto: "Canales: Turnero Stand y Reservas web.", modulo: "Canales SIM", actualizado: "2026-09-04T00:00:00.000Z" },
];
const externas: FuenteExternaDisponible[] = [
  { id: "ext-1", titulo: "Aracing inaugura sede en Córdoba", url: "https://infonegocios.info/aracing", dominio: "infonegocios.info", fechaPublicada: null, fragmento: "12 simuladores de carrera." },
  { id: "ext-2", titulo: "Elite Tour Córdoba", url: "https://experienciaelite.com/cordoba", dominio: "experienciaelite.com", fechaPublicada: null, fragmento: "show automotor." },
];

function actorBase(over: Partial<Record<string, unknown>> = {}) {
  return {
    nombre: "Aracing", evidencia: "Sede nueva en Córdoba con 12 simuladores.", fuente_ids: ["ext-1"],
    actividad_comparable: true, ubicacion_cordoba: true, vigencia_reciente: true,
    es_fabricante: false, es_red_nacional: false, es_evento: false,
    ...over,
  };
}
function entradaBase(over: Partial<Record<string, unknown>> = {}) {
  return {
    respuesta_directa: "En Córdoba hay al menos un competidor potencial y un evento no competitivo.",
    datos_internos_ids: ["int-1", "int-2"],
    actores_externos: [actorBase()],
    comparacion: [{ aspecto: "Ubicación", sim: "Córdoba", mercado: "Córdoba (Aracing)", fuente_ids: ["ext-1"] }],
    no_determinable: ["Precio por sesión de Aracing"],
    conclusion: "No hay competidor directo confirmado; Aracing es potencial.",
    ...over,
  };
}

function main() {
  // ── Caso válido: pasa, clasifica determinísticamente, renderiza ──────────────────────
  {
    const val = validarAnalisisWeb(entradaBase(), { internas, externas });
    assert.ok(val.ok, "entrada válida pasa");
    if (!val.ok) return;
    // actividad+cordoba+vigencia+fuente=true → competidor_directo_confirmado (entidad.ts, servidor).
    assert.equal(val.spec.actoresExternos[0].clase, "competidor_directo_confirmado", "con las 4 señales en true, clasifica confirmado (server, no el modelo)");
    const md = renderAnalisisWeb(val.spec, { internas, externas });
    assert.ok(md.includes("## Datos internos de SIM"), "renderiza datos internos citados");
    assert.ok(md.includes("SIM Argentina opera en Córdoba."), "usa el TEXTO del servidor, no uno reescrito");
    assert.ok(md.includes("## Comparación"), "renderiza tabla comparativa");
    assert.ok(md.includes("## Conclusión"), "renderiza conclusión");
    assert.ok(md.includes("[Aracing inaugura sede en Córdoba](https://infonegocios.info/aracing)"), "cita la fuente externa con URL real");
  }

  // ── Clasificación determinística: fabricante gana aunque el modelo diga 'comparable' ──
  {
    const val = validarAnalisisWeb(entradaBase({ actores_externos: [actorBase({ es_fabricante: true })] }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) assert.equal(val.spec.actoresExternos[0].clase, "proveedor_o_fabricante", "es_fabricante domina sobre actividad_comparable (regla de entidad.ts)");
  }
  // Sin sede en Córdoba confirmada → potencial/ambiguo, nunca confirmado.
  {
    const val = validarAnalisisWeb(entradaBase({ actores_externos: [actorBase({ ubicacion_cordoba: false })] }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) assert.equal(val.spec.actoresExternos[0].clase, "competidor_potencial_o_ambiguo", "sin sede Córdoba confirmada, nunca 'confirmado'");
  }

  // ── Rechazo: id de fuente INVENTADO (interno o externo) ───────────────────────────────
  {
    const val = validarAnalisisWeb(entradaBase({ datos_internos_ids: ["int-1", "int-99"] }), { internas, externas });
    assert.equal(val.ok, false, "id interno inexistente → rechazado");
  }
  {
    const val = validarAnalisisWeb(entradaBase({ actores_externos: [actorBase({ fuente_ids: ["ext-9-inventado"] })] }), { internas, externas });
    assert.equal(val.ok, false, "id externo inexistente en un actor → rechazado");
  }
  {
    const val = validarAnalisisWeb(entradaBase({ comparacion: [{ aspecto: "X", sim: "a", mercado: "b", fuente_ids: ["ext-inventada"] }] }), { internas, externas });
    assert.equal(val.ok, false, "id inexistente en una fila de comparación → rechazado");
  }

  // ── Rechazo: cero actores (no se puede simplemente "no responder nada") ───────────────
  {
    const val = validarAnalisisWeb(entradaBase({ actores_externos: [] }), { internas, externas });
    assert.equal(val.ok, false, "cero actores externos → rechazado");
  }
  // ── Rechazo: actor sin fuente_ids (toda afirmación externa debe citar algo) ───────────
  {
    const val = validarAnalisisWeb(entradaBase({ actores_externos: [actorBase({ fuente_ids: [] })] }), { internas, externas });
    assert.equal(val.ok, false, "actor sin fuentes → rechazado");
  }
  // ── Rechazo: faltan campos obligatorios ───────────────────────────────────────────────
  {
    const val = validarAnalisisWeb(entradaBase({ respuesta_directa: "" }), { internas, externas });
    assert.equal(val.ok, false, "respuesta_directa vacía → rechazada");
  }
  {
    const val = validarAnalisisWeb(entradaBase({ conclusion: "" }), { internas, externas });
    assert.equal(val.ok, false, "conclusion vacía → rechazada");
  }

  // ── Recorte (no rechazo) de longitudes y cantidades por encima del límite ─────────────
  {
    const largo = "x".repeat(5000);
    const val = validarAnalisisWeb(entradaBase({ respuesta_directa: largo, conclusion: largo }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) {
      assert.equal(val.spec.respuestaDirecta.length, LIMITES_ANALISIS_WEB.respuestaDirectaLen, "respuesta_directa recortada al máximo");
      assert.equal(val.spec.conclusion.length, LIMITES_ANALISIS_WEB.conclusionLen, "conclusion recortada al máximo");
    }
  }
  {
    const seisActores = Array.from({ length: 7 }, (_, i) => actorBase({ nombre: `Actor ${i}` }));
    const val = validarAnalisisWeb(entradaBase({ actores_externos: seisActores }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) assert.equal(val.spec.actoresExternos.length, LIMITES_ANALISIS_WEB.actoresMax, `actores_externos recortado a ${LIMITES_ANALISIS_WEB.actoresMax}`);
  }
  {
    const ochoFilas = Array.from({ length: 8 }, (_, i) => ({ aspecto: `Aspecto ${i}`, sim: "a", mercado: "b", fuente_ids: ["ext-1"] }));
    const val = validarAnalisisWeb(entradaBase({ comparacion: ochoFilas }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) assert.equal(val.spec.comparacion.length, LIMITES_ANALISIS_WEB.comparacionMax, `comparacion recortada a ${LIMITES_ANALISIS_WEB.comparacionMax} filas`);
  }

  // ── Fila de comparación SIN evidencia comparable: nunca inventa, fuerza el texto fijo ─
  {
    const val = validarAnalisisWeb(entradaBase({ comparacion: [{ aspecto: "Precio", sim: "$5.000", mercado: "un dato inventado sin fuente", fuente_ids: [] }] }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) {
      assert.equal(val.spec.comparacion[0].sim, "No disponible en las fuentes consultadas.", "sin fuente_ids, la celda SIM se fuerza (ignora lo que haya escrito el modelo)");
      assert.equal(val.spec.comparacion[0].mercado, "No disponible en las fuentes consultadas.", "sin fuente_ids, la celda mercado se fuerza (no inventa una comparación)");
    }
  }

  // ── Newlines en texto libre no rompen el Markdown (se colapsan a una línea) ───────────
  {
    const val = validarAnalisisWeb(entradaBase({ conclusion: "Línea 1\n## Encabezado inyectado\n- viñeta inyectada" }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) assert.ok(!val.spec.conclusion.includes("\n"), "sin saltos de línea en un campo de una sola línea");
  }

  console.log("OK — analisisWeb (puro): clasificación determinística (server, no el modelo) para confirmado/potencial/fabricante; rechaza ids de fuente inventados (internos y externos) y cero actores/actor sin fuente/campos vacíos; recorta longitudes y cantidades por encima del límite; fila de comparación sin fuente_ids nunca inventa; sin saltos de línea inyectados; render usa el texto preparado por el servidor y cita URLs reales.");
}
main();
