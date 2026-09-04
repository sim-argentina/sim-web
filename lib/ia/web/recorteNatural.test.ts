import { strict as assert } from "node:assert";
import { recortarNatural } from "@/lib/ia/web/recorteNatural";

// Ejecutar: npx tsx lib/ia/web/recorteNatural.test.ts — puro (sin red ni Supabase).
// Corrección 4D.5.3 — el helper de recorte natural reemplaza el `.slice(0, max)` ciego que
// cortó la conclusión real a mitad de palabra ("...septiembre 2026 (49 tur"). Nunca agrega
// datos ni completa una idea: solo decide DÓNDE cortar.

function main() {
  // ── Texto corto: SIN modificación ─────────────────────────────────────────────────────
  {
    const corto = "SIM opera en Córdoba desde 2023.";
    assert.equal(recortarNatural(corto, 700), corto, "texto dentro del límite no se toca");
  }

  // ── El caso REAL: "...septiembre 2026 (49 tur" cortado a 700 chars por el .slice ciego ──
  {
    const real = "Con la evidencia disponible, Aracing Córdoba es el actor más cercano a un competidor directo confirmado: sede propia en Córdoba, actividad comparable (simuladores de carrera) y vigencia reciente (apertura reportada en 2025/2026), aunque falta información de precios y modalidad para una comparación más fina. Elite Tour y Pirelli Experience son eventos/activaciones puntuales, no operadores permanentes, y no compiten estructuralmente con SIM. El hallazgo de Instagram es ambiguo por falta de datos de sede y vigencia, por lo que no puede clasificarse como competidor sin más evidencia. SIM mantiene su posición de operador confirmado con sede fija y datos internos propios de septiembre 2026 (49 turnos y $558.000 ARS de facturación bruta al corte).";
    const cortado = recortarNatural(real, 700);
    assert.ok(!cortado.endsWith("(49 tur"), "ya no corta a mitad de palabra dentro de un paréntesis");
    assert.ok(cortado.endsWith("sin más evidencia."), "prefiere la última oración completa dentro del límite");
    assert.ok(cortado.length <= 700, "nunca excede el máximo");
    assert.ok(!/\(\s*$/.test(cortado) && !cortado.includes("(49"), "no deja un paréntesis abierto colgando");
  }

  // ── Palabra incompleta (sin oración completa disponible): corta en el último espacio ────
  {
    const largo = "Aracing Córdoba tiene doce simuladores de carrera profesional instalados en su nueva sede del centro comercial Nuevo Centro Shopping de la ciudad de Córdoba capital argentina";
    const cortado = recortarNatural(largo, 60);
    assert.ok(cortado.length <= 60, "respeta el máximo");
    assert.ok(/[.!?…]$/.test(cortado), "termina con puntuación válida (elipsis si cortó a mitad de idea)");
    const palabras = cortado.replace(/…$/, "").trim().split(/\s+/);
    assert.ok(largo.startsWith(palabras.slice(0, -1).join(" ")) || palabras.length <= 1, "cada palabra previa a la última proviene literalmente del texto original");
  }

  // ── Paréntesis abierto sin cerrar al final: se elimina el paréntesis colgante entero ────
  {
    const conParentesis = "SIM factura fuerte este mes gracias a la campaña (con descuentos especiales para grupos grandes de mas de diez per";
    const cortado = recortarNatural(conParentesis, 70);
    assert.ok(!cortado.includes("("), "el paréntesis sin cerrar se elimina por completo, no queda colgando");
    assert.ok(/[.!?…]$/.test(cortado), "termina con puntuación válida");
  }

  // ── Comillas abiertas sin cerrar al final: se eliminan ───────────────────────────────────
  {
    const conComillas = 'El cliente dijo: "esta es la mejor experiencia de simulacion que probe en toda mi vi';
    const cortado = recortarNatural(conComillas, 70);
    assert.equal((cortado.match(/"/g) || []).length % 2, 0, "las comillas rectas quedan balanceadas (0 o par)");
    assert.ok(/[.!?…]$/.test(cortado), "termina con puntuación válida");
  }

  // ── Markdown abierto (negrita) sin cerrar: se elimina el marcador colgante ──────────────
  {
    const conNegrita = "Aracing es el **competidor mas fuerte de la zona norte de la ciu";
    const cortado = recortarNatural(conNegrita, 50);
    assert.equal((cortado.match(/\*\*/g) || []).length % 2, 0, "los marcadores ** quedan balanceados");
  }

  // ── Última oración completa preferida sobre un corte de palabra más largo ───────────────
  {
    const dosOraciones = "SIM es el operador local confirmado. Aracing es un competidor potencial con evidencia parcial y sede reportada en Córdoba capital";
    const cortado = recortarNatural(dosOraciones, 60);
    assert.equal(cortado, "SIM es el operador local confirmado.", "usa la oración completa aunque deje margen sin usar");
  }

  // ── Nunca agrega datos: el resultado es siempre un PREFIJO del original (+ elipsis) ─────
  {
    const original = "Datos internos de SIM: 49 turnos, 44 personas y facturación bruta de quinientos cincuenta y ocho mil pesos en lo que va del mes";
    const cortado = recortarNatural(original, 45).replace(/…$/, "").trim();
    assert.ok(original.startsWith(cortado), "el texto recortado es siempre un prefijo literal del original (sin invención)");
  }

  console.log("OK — recorteNatural (puro): texto corto sin modificación; el caso real '(49 tur' ya no corta a mitad de palabra (usa la última oración completa); palabra incompleta corta en el último espacio; paréntesis/comillas/Markdown abiertos se eliminan por completo; termina siempre con puntuación válida; nunca excede el máximo; nunca inventa texto (resultado siempre prefijo literal del original).");
}
main();
