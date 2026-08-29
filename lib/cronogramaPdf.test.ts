import { strict as assert } from "node:assert";
import {
  parseCronogramaPdf,
  parseTituloMesAnio,
  parseRangoHoras,
  construirGrilla,
  type TextItem,
  type PdfMeta,
} from "@/lib/cronogramaPdf";

// Ejecutar: npx tsx lib/cronogramaPdf.test.ts
// Pruebas PURAS con fixtures sintéticas que reproducen la plantilla de Canva
// (mismos centros de columna, anclas de fila, números de día, semanas y NOTAS).
// No usa el PDF real (que no se commitea).

const COL_CENTROS = [235, 407, 579, 750, 921, 1091, 1263]; // Lun..Dom
const SEMANA_X = 115;
const HEADER_Y = 251;
const ROW_ANCHORS = [287, 364, 441, 518, 595, 672];
const DIAS_HDR = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const META: PdfMeta = { numPages: 1, width: 1440, height: 810 };

const item = (str: string, x: number, y: number, width: number): TextItem => ({ str, x, y, width });

// Genera items sintéticos para un mes con contenidos por fecha (jornadas de texto).
function generar(mes: number, anio: number, contenidos: Record<string, string[]>, extras: TextItem[] = []): TextItem[] {
  const items: TextItem[] = [];
  // Título
  const nombreMes = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][mes - 1];
  items.push(item(`${nombreMes} ${anio}`, 101, 168, 400));
  items.push(item("NOTAS:", 913, 125, 66)); // debe ignorarse (arriba del header)
  // Header
  items.push(item("SEMANA", 92, HEADER_Y, 47));
  for (let c = 0; c < 7; c++) {
    const w = 60;
    items.push(item(DIAS_HDR[c], COL_CENTROS[c] - w / 2, HEADER_Y, w));
  }
  const grid = construirGrilla(anio, mes);
  const semanas = [31, 32, 33, 34, 35, 36];
  for (let r = 0; r < 6; r++) {
    items.push(item(String(semanas[r]), SEMANA_X - 8, ROW_ANCHORS[r] + 20, 16)); // número de semana (ignorar)
    for (let c = 0; c < 7; c++) {
      const fecha = grid[r][c];
      const anchorY = ROW_ANCHORS[r];
      if (!fecha) {
        // celda gris (mes adyacente): solo un número de día gris (debe ignorarse)
        items.push(item("15", COL_CENTROS[c] - 8, anchorY, 16));
        continue;
      }
      const dd = fecha.slice(8);
      items.push(item(dd, COL_CENTROS[c] - 8, anchorY, 16)); // número de día
      const js = contenidos[fecha] ?? [];
      js.forEach((txt, k) => {
        const w = 110;
        items.push(item(txt, COL_CENTROS[c] - w / 2, anchorY + 10 + k * 20, w));
      });
    }
  }
  return [...items, ...extras];
}

// ── parseTituloMesAnio ────────────────────────────────────────────────────────
assert.deepEqual(parseTituloMesAnio("Agosto 2026"), { mes: 8, anio: 2026 });
assert.deepEqual(parseTituloMesAnio("  AGOSTO   2026 "), { mes: 8, anio: 2026 });
assert.deepEqual(parseTituloMesAnio("Setiembre 2027"), { mes: 9, anio: 2027 });
assert.equal(parseTituloMesAnio("Hola 2026"), null);
assert.equal(parseTituloMesAnio("Agosto"), null);

// ── parseRangoHoras: "H:H hs" es RANGO de horas ───────────────────────────────
assert.deepEqual(parseRangoHoras("10:20hs"), { inicio: "10:00", fin: "20:00" });
assert.deepEqual(parseRangoHoras("16:22 hs"), { inicio: "16:00", fin: "22:00" });
assert.deepEqual(parseRangoHoras("10:16hs"), { inicio: "10:00", fin: "16:00" });
assert.equal(parseRangoHoras("20:10hs"), null, "inicio>=fin inválido");
assert.equal(parseRangoHoras("10:25hs"), null, "fin>24 inválido");
assert.equal(parseRangoHoras("10:20"), null, "sin 'hs' no es jornada");

// ── construirGrilla: Agosto 2026 (1 = sábado) ─────────────────────────────────
const g = construirGrilla(2026, 8);
assert.equal(g[0][5], "2026-08-01", "fila0 col5 (sábado) = 1 ago");
assert.equal(g[0][6], "2026-08-02", "fila0 col6 (domingo) = 2 ago");
assert.equal(g[0][0], null, "fila0 col0 = gris (julio)");
assert.equal(g[1][0], "2026-08-03", "fila1 col0 (lunes) = 3 ago");
assert.equal(g[5][0], "2026-08-31", "fila5 col0 = 31 ago");
assert.equal(g[5][1], null, "fila5 col1 = gris (septiembre)");

// ── Parseo completo con la estructura real ────────────────────────────────────
const contenidos: Record<string, string[]> = {
  "2026-08-01": ["Fede 10:20hs", "Fran 16:22hs"],
  "2026-08-02": ["Fran 10:20hs", "Fede 16:22hs"],
  "2026-08-03": ["Fede 10:16hs", "Fran 16:22hs"],
  "2026-08-06": ["Fede 10:18hs"],
  "2026-08-21": ["Fran 10:19hs"],
  "2026-08-31": ["Fede 10:16hs", "Fran 16:22hs"],
};
const res = parseCronogramaPdf(generar(8, 2026, contenidos), META);
assert.ok(res.ok, "parseo OK");
if (res.ok) {
  assert.equal(res.mes, 8);
  assert.equal(res.anio, 2026);
  assert.equal(res.incidencias.length, 0, "sin incidencias");
  const by: Record<string, string[]> = {};
  for (const j of res.jornadas) (by[j.fecha] ??= []).push(`${j.alias_texto} ${j.hora_inicio}-${j.hora_fin}`);
  // 6) 10:20hs → 10:00-20:00
  assert.deepEqual(by["2026-08-01"].slice().sort(), ["Fede 10:00-20:00", "Fran 16:00-22:00"], "1 ago");
  assert.deepEqual(by["2026-08-02"].slice().sort(), ["Fede 16:00-22:00", "Fran 10:00-20:00"], "2 ago");
  assert.deepEqual(by["2026-08-03"].slice().sort(), ["Fede 10:00-16:00", "Fran 16:00-22:00"], "3 ago");
  assert.deepEqual(by["2026-08-06"], ["Fede 10:00-18:00"], "6 ago");
  assert.deepEqual(by["2026-08-21"], ["Fran 10:00-19:00"], "21 ago");
  assert.deepEqual(by["2026-08-31"].slice().sort(), ["Fede 10:00-16:00", "Fran 16:00-22:00"], "31 ago");
  // 3/4/5) sin jornadas fuera de agosto; semanas y NOTAS ignoradas
  assert.equal(res.jornadas.filter((j) => !j.fecha.startsWith("2026-08")).length, 0, "sin jornadas de meses adyacentes");
  assert.deepEqual([...new Set(res.aliasesTexto)].sort(), ["Fede", "Fran"], "alias reconocidos");
}

// ── 9) Horario ambiguo/inválido → incidencia bloqueante ───────────────────────
const resAmb = parseCronogramaPdf(generar(8, 2026, { "2026-08-05": ["Fede 25:30hs"] }), META);
assert.ok(resAmb.ok);
if (resAmb.ok) {
  assert.ok(resAmb.incidencias.some((i) => i.tipo === "horario_invalido" && i.severidad === "bloqueante"), "horario inválido bloqueante");
  assert.equal(resAmb.jornadas.some((j) => j.fecha === "2026-08-05"), false, "no crea jornada inválida");
}

// ── Entrada no reconocida → advertencia ───────────────────────────────────────
const resNR = parseCronogramaPdf(generar(8, 2026, { "2026-08-07": ["Reunión equipo"] }), META);
assert.ok(resNR.ok && resNR.incidencias.some((i) => i.tipo === "entrada_no_reconocida"), "entrada no reconocida");

// ── Día "Cerrado" reconocido ──────────────────────────────────────────────────
const resC = parseCronogramaPdf(generar(8, 2026, { "2026-08-10": ["Cerrado"] }), META);
assert.ok(resC.ok && resC.diasCerrados.includes("2026-08-10"), "día cerrado reconocido");

// ── 10) PDF sin texto → rechazo ───────────────────────────────────────────────
const resVacio = parseCronogramaPdf([], META);
assert.equal(resVacio.ok, false, "sin texto rechazado");

// ── 11) Formato incompatible (sin mes/año) → rechazo ──────────────────────────
const soloHeader = generar(8, 2026, {}).filter((it) => !/\d{4}/.test(it.str)); // quita el título
const resSinTitulo = parseCronogramaPdf(soloHeader, META);
assert.equal(resSinTitulo.ok, false, "sin mes/año rechazado");

// ── Más de una página → rechazo ───────────────────────────────────────────────
const resMulti = parseCronogramaPdf(generar(8, 2026, {}), { ...META, numPages: 2 });
assert.equal(resMulti.ok, false, "multipágina rechazada");

console.log("OK — cronogramaPdf (puro): mes/año, grilla, exclusión de grises/semanas/NOTAS, 10:20hs→rango, horario inválido bloqueante, no reconocido, cerrado, sin-texto/sin-título/multipágina rechazados.");
