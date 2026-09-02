import { strict as assert } from "node:assert";
import { decidirWeb } from "@/lib/ia/web/decision";
import { contienePII, sanitizarConsultaWeb } from "@/lib/ia/web/sanitizar";
import { costoBusquedasUSD, USD_POR_BUSQUEDA } from "@/lib/ia/web/costo";
import { normalizarUrl, dominioDe, dedupFuentesWeb, esFuenteExterna, recortarFragmento, type FuenteWeb } from "@/lib/ia/web/fuentes";

// Ejecutar: npx tsx lib/ia/web/web.test.ts — puro, sin red ni DB.

function main() {
  // ── §4 Clasificación interna vs externa ──────────────────────────────────────
  // Ejemplo obligatorio INTERNO: no debe habilitar web.
  const interno = decidirWeb("¿Cuántos turnos hizo Federico en agosto de 2026?");
  assert.equal(interno.habilitar, false, "consulta interna NO habilita web");

  // Ejemplo obligatorio EXTERNO: debe habilitar web.
  const externo = decidirWeb("Buscá qué experiencias de simulación de automovilismo existen actualmente en Córdoba.");
  assert.equal(externo.habilitar, true, "consulta de mercado habilita web");
  assert.equal(externo.explicita, true, "verbo 'buscá' → explícita");

  // Ejemplo obligatorio MIXTO: compara SIM con el mercado → habilita web.
  const mixto = decidirWeb("Compará brevemente la propuesta de SIM con lo que encontraste actualmente en Córdoba.");
  assert.equal(mixto.habilitar, true, "comparación con el mercado habilita web");

  // "Sin internet" deshabilita SIEMPRE.
  assert.equal(decidirWeb("Buscá competidores en Córdoba pero sin internet").habilitar, false, "'sin internet' gana");
  assert.equal(decidirWeb("no busques en internet, ¿cuánto facturamos?").habilitar, false, "'no busques en internet' gana");

  // Cálculo/reformulación interna: no habilita.
  assert.equal(decidirWeb("Sumá la facturación de Stand y Reservas de julio").habilitar, false, "cálculo interno no habilita");
  assert.equal(decidirWeb("Resumí lo que dijimos sobre el cronograma").habilitar, false, "reformulación interna no habilita");
  assert.equal(decidirWeb("¿Cuál es la ganancia actual de SIM?").habilitar, false, "dato interno actual no habilita");

  // Temas externos varios habilitan.
  assert.equal(decidirWeb("¿Cuál es la inflación de este mes según el INDEC?").habilitar, true, "inflación/INDEC habilita");
  assert.equal(decidirWeb("¿Qué normativa municipal rige para salones de juegos en Córdoba?").habilitar, true, "normativa habilita");
  assert.equal(decidirWeb("Investigá noticias recientes sobre simuladores").habilitar, true, "noticias habilita");
  assert.equal(decidirWeb("Precios de mercado de simuladores de F1 en Argentina").habilitar, true, "precios externos habilita");

  // PII en la consulta → NO se busca en internet.
  const pii = decidirWeb("Buscá el teléfono +54 351 1234567 del cliente en internet");
  assert.equal(pii.habilitar, false, "PII deshabilita la búsqueda");
  assert.ok(pii.motivo.startsWith("pii:"), "motivo pii");

  // ── Sanitización de PII ──────────────────────────────────────────────────────
  assert.equal(contienePII("mi mail es juan@example.com").hay, true, "detecta email");
  assert.equal(contienePII("llamame al 3511234567").hay, true, "detecta teléfono");
  assert.equal(contienePII("reserva ABC12345").hay, true, "detecta código de reserva");
  assert.equal(contienePII("simuladores en Córdoba precios 2026").hay, false, "consulta pública no es PII");
  assert.ok(!sanitizarConsultaWeb("escribí a juan@example.com hoy").includes("@example.com"), "redacta email");
  assert.ok(!/351123456/.test(sanitizarConsultaWeb("tel 3511234567")), "redacta teléfono");
  assert.ok(!/sk-ant-/.test(sanitizarConsultaWeb("clave sk-ant-abc123def456")), "redacta secreto");

  // ── Costo versionado ─────────────────────────────────────────────────────────
  assert.equal(USD_POR_BUSQUEDA, 0.01, "US$0,01 por búsqueda");
  assert.equal(costoBusquedasUSD(3), 0.03, "3 búsquedas = US$0,03");
  assert.equal(costoBusquedasUSD(0), 0, "0 búsquedas = US$0");
  assert.equal(costoBusquedasUSD(-1), 0, "negativas = 0 (errores no facturables)");
  assert.equal(costoBusquedasUSD(1000), 10, "1000 búsquedas = US$10");

  // ── URL / dominio / dedup / separación ───────────────────────────────────────
  assert.equal(normalizarUrl("https://www.indec.gob.ar/x"), "https://www.indec.gob.ar/x", "https válido");
  assert.equal(normalizarUrl("javascript:alert(1)"), null, "javascript: rechazado");
  assert.equal(normalizarUrl("ftp://x"), null, "ftp rechazado");
  assert.equal(dominioDe("https://www.argentina.gob.ar/a/b"), "argentina.gob.ar", "dominio sin www");
  assert.equal(recortarFragmento("  hola   mundo  "), "hola mundo", "normaliza espacios");
  assert.equal(esFuenteExterna({ url: "https://x.com" }), true, "con URL es externa");
  assert.equal(esFuenteExterna({ }), false, "sin URL es interna");
  const dd = dedupFuentesWeb([
    { url: "https://a.com/1", orden: 0 }, { url: "https://a.com/1#x", orden: 1 }, { url: "https://b.com", orden: 2 },
  ] as FuenteWeb[]);
  assert.equal(dd.length, 2, "dedup por URL (ignora #fragmento)");

  console.log("OK — web (puro): clasificación interna/externa (3 ejemplos obligatorios + sin internet + PII), sanitización PII, costo versionado (US$0,01; fallidas no facturan), URL/dominio/dedup, separación interna/externa.");
}
main();
