import { strict as assert } from "node:assert";
import { renderResultadoAnalitico, formatearValor, MARCADOR_TABLA_ANALITICA } from "@/lib/ia/analisis/renderAnalitico";
import type { ResultadoAnalitico } from "@/lib/ia/analisis/ejecutorAnalitico";

// Ejecutar: npx tsx lib/ia/analisis/renderAnalitico.test.ts — puro (el tipo del ejecutor se
// importa solo como tipo: no se toca la base de datos).
//
// Bloque 5A — la tabla la arma el SERVIDOR. Estas cifras son las reales de agosto 2026
// (lunes a viernes) verificadas contra Finanzas, así que el render queda anclado a datos ciertos.

const AGOSTO: Extract<ResultadoAnalitico, { ok: true }> = {
  ok: true,
  metrica: "facturacion_bruta",
  etiquetaMetrica: "Facturación bruta",
  unidad: "ars",
  ventana: { desde: "2026-08-01", hasta: "2026-08-31" },
  filtros: { diasSemana: [1, 2, 3, 4, 5], fuentes: null, metodosPago: null },
  agruparPor: "semana",
  filas: [
    { clave: "2026-08-03", etiqueta: "3–7 de agosto", detalle: "lunes a viernes", fechas: [], dias: 5, valor: 1_248_000 },
    { clave: "2026-08-10", etiqueta: "10–14 de agosto", detalle: "lunes a viernes", fechas: [], dias: 5, valor: 954_000 },
    { clave: "2026-08-17", etiqueta: "17–21 de agosto", detalle: "lunes a viernes", fechas: [], dias: 5, valor: 1_354_000 },
    { clave: "2026-08-24", etiqueta: "24–28 de agosto", detalle: "lunes a viernes", fechas: [], dias: 5, valor: 1_042_000 },
    { clave: "2026-08-31", etiqueta: "31 de agosto", detalle: "lunes", fechas: [], dias: 1, valor: 132_000 },
  ],
  total: 4_730_000,
  totalDias: 21,
  porFuente: [
    { fuente: "turnero", etiqueta: "Turnero", valor: 4_000_000 },
    { fuente: "reservas_online", etiqueta: "Reservas online", valor: 730_000 },
  ],
  fuentesInternas: ["Turnero", "Reservas online"],
  advertencias: [],
  truncado: false,
};

function main() {
  // ── La tabla de la consulta productiva ───────────────────────────────────────────────────
  {
    const md = renderResultadoAnalitico(AGOSTO);
    assert.ok(md.startsWith(MARCADOR_TABLA_ANALITICA), "la tabla lleva su marcador para no duplicarse");
    assert.ok(md.includes("Facturación bruta de lunes a viernes — agosto de 2026"), "el título describe métrica, filtro y período");
    assert.ok(md.includes("| $1.248.000 |") && md.includes("| $954.000 |") && md.includes("| $1.354.000 |") && md.includes("| $1.042.000 |"), "las cuatro semanas completas");
    assert.ok(md.includes("| $132.000 |"), "la semana parcial del lunes 31 NO se pierde");
    assert.ok(md.includes("**$4.730.000**"), "el total del período está presente y resaltado");
    assert.ok(md.includes("**21 días**"), "el total informa cuántos días hábiles entraron");
    assert.ok(/\|\s*Semana\s*\|\s*Días incluidos\s*\|/.test(md), "el encabezado nombra la agrupación");
    assert.equal((md.match(/^\|/gm) ?? []).length, 8, "5 semanas + encabezado + separador + total");
  }
  console.log("OK — tabla semanal de agosto 2026: 5 semanas (incluida la del 31), total $4.730.000 sobre 21 días.");

  // ── El criterio contable se explicita: nadie tiene que adivinar qué se sumó ───────────────
  {
    const md = renderResultadoAnalitico(AGOSTO);
    assert.ok(md.includes("fecha de servicio") && md.includes("fecha de pago"), "declara la base de imputación de cada fuente");
    assert.ok(md.includes("Finanzas"), "aclara que es la misma composición que Finanzas");
    assert.ok(md.includes("- Turnero: $4.000.000") && md.includes("- Reservas online: $730.000"), "desagrega el total por fuente interna");
  }
  console.log("OK — la tabla declara el criterio contable y desagrega por fuente interna.");

  // ── Solo fuentes internas: ninguna referencia externa ────────────────────────────────────
  {
    const md = renderResultadoAnalitico(AGOSTO).toLowerCase();
    for (const externo of ["http", "fuente externa", "según ", "web", "google", "noticia"]) {
      assert.ok(!md.includes(externo), `la tabla interna no menciona "${externo}"`);
    }
  }
  console.log("OK — la tabla no contiene ninguna referencia externa ni enlaces.");

  // ── Determinismo: dos renders del mismo resultado son idénticos ───────────────────────────
  {
    assert.equal(renderResultadoAnalitico(AGOSTO), renderResultadoAnalitico(AGOSTO));
  }
  console.log("OK — el render es determinístico: mismo resultado, mismo texto.");

  // ── Período vacío, período parcial y agrupaciones sin detalle ─────────────────────────────
  {
    const vacio = renderResultadoAnalitico({ ...AGOSTO, filas: [], total: 0, totalDias: 0, porFuente: [] });
    assert.ok(vacio.includes("No hay datos registrados"), "sin datos lo dice, no inventa ceros con tabla");

    const parcial = renderResultadoAnalitico({ ...AGOSTO, ventana: { desde: "2026-08-03", hasta: "2026-08-07" } });
    assert.ok(parcial.includes("3–7 de agosto de 2026"), "un rango parcial se titula por días, no como mes completo");

    const porMetodo = renderResultadoAnalitico({
      ...AGOSTO,
      agruparPor: "metodo_pago",
      filas: [{ clave: "efectivo", etiqueta: "Efectivo", detalle: "", fechas: [], dias: 21, valor: 4_730_000 }],
    });
    assert.ok(porMetodo.includes("| Método de pago | Facturación bruta |"), "las agrupaciones no temporales usan dos columnas");
    assert.ok(!porMetodo.includes("Días incluidos"));
  }
  console.log("OK — período vacío, rango parcial y agrupaciones no temporales se renderizan correctamente.");

  // ── Advertencias y truncado se muestran, no se ocultan ───────────────────────────────────
  {
    const md = renderResultadoAnalitico({ ...AGOSTO, advertencias: ["Se muestran las primeras 200 filas."] });
    assert.ok(md.includes("Se muestran las primeras 200 filas."), "las advertencias del ejecutor llegan al usuario");
  }
  console.log("OK — las advertencias del ejecutor se publican junto con la tabla.");

  // ── Formato de valores ──────────────────────────────────────────────────────────────────
  {
    assert.equal(formatearValor(4_730_000, "ars"), "$4.730.000");
    assert.equal(formatearValor(-12_500, "ars"), "-$12.500", "el signo va ANTES del símbolo de moneda");
    assert.equal(formatearValor(1234.5, "ars"), "$1.234,50");
    assert.equal(formatearValor(90, "minutos"), "90 min");
    assert.equal(formatearValor(21, "turnos"), "21");
  }
  console.log("OK — formato es-AR con el signo antes del símbolo de moneda.");

  // ── Un resultado fallido no se disfraza de tabla ──────────────────────────────────────────
  {
    const md = renderResultadoAnalitico({ ok: false, motivo: "No pude leer los turnos del stand." });
    assert.ok(!md.includes("|"), "sin tabla");
    assert.ok(md.includes("No pude leer los turnos del stand."));
  }
  console.log("OK — un fallo del ejecutor se informa como fallo, nunca como tabla vacía.");

  console.log("\nOK — render analítico (puro): tabla determinística, criterio contable explícito y sin fuentes externas.");
}
main();
