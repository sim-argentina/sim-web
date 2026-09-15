import { strict as assert } from "node:assert";
import { validarFoda, LIMITES_FODA, type FuenteInternaDisponible, type FuenteExternaDisponible } from "@/lib/ia/analisis/fodaSchema";
import { renderFoda } from "@/lib/ia/analisis/renderFoda";

// Ejecutar: npx tsx lib/ia/analisis/fodaSchema.test.ts — puro.

const internas: FuenteInternaDisponible[] = [
  { id: "int-1", texto: "SIM opera en Córdoba desde 2023.", modulo: "Identidad SIM", actualizado: "2026-09-14T00:00:00.000Z" },
  { id: "int-2", texto: "Ganancia SIM de agosto: $500.000 ARS.", modulo: "Finanzas SIM", periodo: "2026-08", actualizado: "2026-09-14T00:00:00.000Z" },
];
const externas: FuenteExternaDisponible[] = [
  { id: "ext-1", titulo: "Aracing abre en Córdoba", url: "https://infonegocios.info/aracing", dominio: "infonegocios.info", fechaPublicada: null, fragmento: "Nueva sede." },
];

function entradaBase(over: Partial<Record<string, unknown>> = {}) {
  return {
    fortalezas: [{ texto: "Equipo estable con baja rotación.", fuente_ids: ["int-1"], confianza: "media" }],
    debilidades: [{ texto: "Ganancia por debajo del promedio histórico en agosto.", fuente_ids: ["int-2"], confianza: "alta" }],
    oportunidades: [{ texto: "Mercado de simuladores en expansión en Córdoba.", fuente_ids: ["ext-1"], confianza: "baja" }],
    amenazas: [],
    conclusion: "SIM tiene una base interna sólida; la principal incertidumbre es el nuevo competidor potencial detectado.",
    ...over,
  };
}

function main() {
  // ── FODA interno (sin fuentes externas disponibles): solo cita ids internos ────────────
  {
    const val = validarFoda(entradaBase({ oportunidades: [], amenazas: [] }), { internas, externas: [] });
    assert.ok(val.ok, "FODA interno válido");
    if (val.ok) {
      assert.equal(val.spec.oportunidades.length, 0, "sin fuentes externas, el cuadrante queda vacío (no se inventa)");
      assert.equal(val.spec.fortalezas[0].fuenteIds[0], "int-1");
      const md = renderFoda(val.spec, { internas, externas: [] });
      assert.ok(md.includes("### Fortalezas"));
      assert.ok(md.includes("### Oportunidades") && md.includes("Sin puntos respaldados"), "cuadrante vacío SIGUE apareciendo (con la sección), declarado explícitamente en vez de omitido");
    }
  }

  // ── No completa artificialmente 4 puntos: 1 fortaleza y 0 amenazas es válido ────────────
  {
    const val = validarFoda(entradaBase(), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) {
      assert.equal(val.spec.fortalezas.length, 1, "no se fuerza a más puntos de los respaldados");
      assert.equal(val.spec.amenazas.length, 0, "un cuadrante sin evidencia queda vacío, no relleno artificialmente");
    }
  }

  // ── Rechazo: id de fuente INVENTADO ──────────────────────────────────────────────────────
  {
    const val = validarFoda(entradaBase({ oportunidades: [{ texto: "Algo inventado.", fuente_ids: ["ext-99-inventado"], confianza: "media" }] }), { internas, externas });
    assert.equal(val.ok, false, "id externo inexistente → rechazado");
  }

  // ── Rechazo: un punto sin fuente_ids (procedencia obligatoria en cada punto) ────────────
  {
    const val = validarFoda(entradaBase({ fortalezas: [{ texto: "Sin fuente.", fuente_ids: [], confianza: "media" }] }), { internas, externas });
    assert.equal(val.ok, false, "punto sin fuente_ids → rechazado (todo punto debe mostrar procedencia)");
  }

  // ── Rechazo: FODA totalmente vacío (los 4 cuadrantes sin nada) ──────────────────────────
  {
    const val = validarFoda(entradaBase({ fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] }), { internas, externas });
    assert.equal(val.ok, false, "FODA sin ningún punto respaldado → rechazado");
  }

  // ── Recorte natural aplicado a los textos largos (reutiliza recorteNatural, no un slice ciego)
  {
    const largo = "Fortaleza. ".repeat(50); // > 220 chars, con oraciones completas
    const val = validarFoda(entradaBase({ fortalezas: [{ texto: largo, fuente_ids: ["int-1"], confianza: "media" }] }), { internas, externas });
    assert.ok(val.ok);
    if (val.ok) {
      assert.ok(val.spec.fortalezas[0].texto.length <= LIMITES_FODA.textoPuntoLen, "recortado al máximo");
      assert.ok(/[.!?…]$/.test(val.spec.fortalezas[0].texto), "termina con puntuación válida (recorte natural, no a mitad de palabra)");
    }
  }

  console.log("OK — fodaSchema (puro): FODA interno sin fuentes externas deja oportunidades/amenazas vacías (no inventa); no completa artificialmente 4 puntos por cuadrante; rechaza ids de fuente inventados y puntos sin fuente_ids; rechaza FODA totalmente vacío; recorte natural en textos largos (nunca a mitad de palabra).");
}
main();
