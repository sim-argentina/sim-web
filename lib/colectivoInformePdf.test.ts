import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { armarInformeEvento, formatearMontoAR, formatearPorcentajeAR, formatearFechaAR, fechaHoraArgentina, etiquetaMedioEgreso } from "@/lib/colectivo";
import { generarPdfInformeEvento, nombreArchivoInformePdf } from "@/lib/colectivoInformePdf";
import type { DatosInformeEvento, MovimientoInforme } from "@/lib/colectivoInforme";

// PDF del Informe del Colectivo: dibuja el MISMO resultado que la pantalla.
// Ejecutar: npx tsx lib/colectivoInformePdf.test.ts
// Pura: genera PDFs en memoria y los lee con pdfjs-dist; no toca ninguna base.

type PdfjsLike = { getDocument: (o: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> }> } };
async function textoPorPagina(pdf: Buffer): Promise<string[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false }).promise;
  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    paginas.push(tc.items.map((x) => x.str ?? "").join("\n"));
  }
  return paginas;
}
const monto = (v: number | string) => formatearMontoAR(v, "-");
const ocurrencias = (texto: string, buscado: string) => texto.split(buscado).length - 1;
// Títulos con espaciado entre letras: el extractor los devuelve con espacios en el medio.
const espaciado = (texto: string, buscado: string) =>
  new RegExp(buscado.split("").filter((c) => c !== " ").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")).test(texto);

function mov(i: number, tipo: "costo" | "gasto", categoria: string, monto: number, medio: string, concepto: string, fecha = "2026-10-11"): MovimientoInforme {
  return { id: `m${i}`, fecha, categoria_id: `c-${categoria}`, categoria_nombre: categoria, tipo, concepto, monto, medio_pago: medio, observaciones: null, created_at: `2026-10-11T12:${String(i % 60).padStart(2, "0")}:00Z` };
}
function datos(nombre: string, partes: { turnos?: Parameters<typeof armarInformeEvento>[0]["turnos"]; ventas?: Parameters<typeof armarInformeEvento>[0]["ventas"]; movimientos?: MovimientoInforme[] }, estado = "activo"): DatosInformeEvento {
  const movimientos = partes.movimientos ?? [];
  const informe = armarInformeEvento({ turnos: partes.turnos ?? [], ventas: partes.ventas ?? [], movimientos });
  return {
    evento: { id: "e1", nombre, fecha_inicio: "2026-10-10", fecha_fin: "2026-10-11", localidad: "Villa Carlos Paz", provincia: "Córdoba", ubicacion: "Peatonal ñandú", estado },
    informe, movimientos,
  };
}

async function main() {
  // ── A: evento completo (pagos divididos, costos y gastos, centavos) ───────
  const A = datos("Fiesta del Ñandú — Edición ¡2026!", {
    turnos: [
      { total: 20000, estado: "activo", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 20000 }], cantidad_turnos: 2, cantidad_personas: 2, cantidad_minutos: 10 },
      { total: 40000, estado: "activo", metodo_pago: "mixto", pagos_detalle: [{ metodo_pago: "qr", monto: 25000 }, { metodo_pago: "transferencia", monto: 15000 }], cantidad_turnos: 4, cantidad_personas: 4, cantidad_minutos: 20 },
      { total: 0, estado: "activo", metodo_pago: "gratis", pagos_detalle: [], cantidad_turnos: 1, cantidad_personas: 1, cantidad_minutos: 10 },
    ],
    ventas: [
      { total: 40000, estado: "activa", metodo_pago: "mixto", pagos_detalle: [{ metodo_pago: "credito", monto: 30000 }, { metodo_pago: "efectivo", monto: 10000 }], producto_nombre: "Gorra", cantidad: 2 },
      { total: 20000, estado: "bonificada", metodo_pago: null, pagos_detalle: [], producto_nombre: "Gorra", cantidad: 1 },
      { total: 50000, estado: "anulada", metodo_pago: "efectivo", pagos_detalle: [{ metodo_pago: "efectivo", monto: 50000 }], producto_nombre: "Buzo", cantidad: 1 },
    ],
    movimientos: [
      mov(1, "gasto", "Publicidad", 9000, "transferencia", "Flyers y cartelería"),
      mov(2, "gasto", "Otros", 2000.25, "otro", "Varios"),
      mov(3, "costo", "Alojamiento", 15000, "transferencia", "Hotel"),
      mov(4, "costo", "Peajes", 12500, "tarjeta", "Peajes ruta 9"),
      mov(5, "costo", "Combustible", 30000, "efectivo", "Nafta"),
    ],
  });
  const generado = new Date("2026-10-14T21:05:00Z");
  const pdfA = generarPdfInformeEvento(A, generado);
  assert.equal(pdfA.subarray(0, 5).toString("latin1"), "%PDF-", "es un PDF");
  const pagA = await textoPorPagina(pdfA);
  const txtA = pagA.join("\n");
  const r = A.informe.resumen;
  // Todas las cifras de la pantalla, con el mismo formato.
  const cifras = [
    monto(r.ingresos), monto(r.costos), monto(r.gastos), monto(r.neto), formatearPorcentajeAR(A.informe.margen),
    monto(r.ingresosTurnos), monto(r.ingresosProductos), monto(A.informe.egresos),
    ...A.informe.ingresosPorMetodo.flatMap((l) => [l.etiqueta, monto(l.total)]),
    ...A.informe.costosPorCategoria.flatMap((l) => [l.etiqueta, monto(l.total)]),
    ...A.informe.gastosPorCategoria.flatMap((l) => [l.etiqueta, monto(l.total)]),
    ...A.informe.egresosPorMedio.flatMap((l) => [l.etiqueta, monto(l.total)]),
    ...A.informe.productos.items.flatMap((p) => [p.nombre, monto(p.total)]),
  ];
  for (const c of cifras) assert.ok(txtA.includes(c), `el PDF muestra «${c}»`);
  assert.deepEqual([monto(r.ingresos), monto(r.costos), monto(r.gastos), monto(r.neto), formatearPorcentajeAR(A.informe.margen)],
    ["$100.000", "$57.500", "$11.000,25", "$31.499,75", "31,5 %"], "formato argentino: miles con punto, centavos solo si hay");
  for (const m of A.movimientos) {
    for (const c of [formatearFechaAR(m.fecha), m.concepto, monto(m.monto), etiquetaMedioEgreso(m.medio_pago)]) assert.ok(txtA.includes(c), `detalle: «${c}»`);
  }
  assert.ok(espaciado(txtA, "COLECTIVO") && espaciado(txtA, "RESUMEN EJECUTIVO"), "títulos con espaciado");
  for (const t of ["SIM", "INFORME DEL EVENTO", "Fiesta del Ñandú - Edición ¡2026!", "Fecha: 10/10/2026 al 11/10/2026", "Ubicación: Villa Carlos Paz · Córdoba · Peatonal ñandú",
    "Estado: Activo", "Informe interno del Colectivo. No forma parte de Finanzas SIM.", `Generado: ${fechaHoraArgentina(generado)}`, "Generado: 14/10/2026 18:05",
    "INGRESOS", "EGRESOS", "POR MÉTODO DE PAGO", "ACTIVIDAD DEL EVENTO", "PRODUCTOS VENDIDOS", "COSTOS POR CATEGORÍA", "GASTOS POR CATEGORÍA",
    "EGRESOS POR MEDIO DE PAGO", "DETALLE DE COSTOS Y GASTOS", "Facturación de turnos", "Minutos totales", "2 + 1 bonif.", "COSTO", "GASTO", "SIM - Colectivo | Informe interno"]) {
    assert.ok(txtA.includes(t), `el PDF muestra «${t}»`);
  }
  assert.ok(!txtA.includes("Sin detalle de pago"), "«Sin detalle de pago» solo si existe");
  assert.ok(!/Finanzas SIM/.test(txtA.replace("Informe interno del Colectivo. No forma parte de Finanzas SIM.", "")), "Finanzas SIM solo en la aclaración del encabezado");
  assert.equal(pagA.length, 1, "un evento normal entra en una página");
  assert.ok(pagA[0].includes("Página 1 de 1"));
  console.log(`OK — A (completo): ${cifras.length} cifras del informe en el PDF con formato argentino, acentos y ñ, una página.`);

  // ── B: sin egresos ni productos ─────────────────────────────────────────────
  const B = datos("Evento sin egresos", { turnos: [{ total: 30000, estado: "activo", metodo_pago: "efectivo", pagos_detalle: [], cantidad_turnos: 3, cantidad_personas: 3, cantidad_minutos: 10 }] });
  const txtB = (await textoPorPagina(generarPdfInformeEvento(B, generado))).join("\n");
  for (const t of ["Sin costos cargados.", "Sin gastos cargados.", "Sin egresos.", "Sin ventas de productos.", "Sin costos ni gastos cargados.", "100,0 %", "$30.000"]) assert.ok(txtB.includes(t), `B: «${t}»`);
  console.log("OK — B (sin egresos ni productos): secciones vacías con aviso discreto, sin tablas vacías.");

  // ── C: sin ingresos, neto negativo, margen indefinido ───────────────────────
  const C = datos("Evento en rojo", { movimientos: [mov(1, "costo", "Combustible", 5000.5, "efectivo", "Nafta")] }, "finalizado");
  const txtC = (await textoPorPagina(generarPdfInformeEvento(C, generado))).join("\n");
  assert.equal(C.informe.margen, null);
  for (const t of ["-$5.000,50", "—", "Sin cobros.", "Estado: Finalizado"]) assert.ok(txtC.includes(t), `C: «${t}»`);
  console.log("OK — C (sin ingresos, finalizado): neto -$5.000,50 y margen «—» sin dividir por cero.");

  // ── D: muchos movimientos → varias páginas, encabezado repetido, sin cortes ─
  const muchos = Array.from({ length: 140 }, (_, i) => mov(i, i % 3 ? "costo" : "gasto", ["Combustible", "Peajes", "Personal", "Otros", "Publicidad"][i % 5],
    1000 + i * 37.5, ["efectivo", "transferencia", "tarjeta", "otro"][i % 4], `Movimiento ${String(i).padStart(3, "0")}${i % 7 === 0 ? " con un concepto bastante largo para que la celda tenga que partir la línea" : ""}`));
  const D = datos("Evento con muchos movimientos", { turnos: [{ total: 900000, estado: "activo", metodo_pago: "efectivo", pagos_detalle: [], cantidad_turnos: 90, cantidad_personas: 90, cantidad_minutos: 10 }], movimientos: muchos });
  const pagD = await textoPorPagina(generarPdfInformeEvento(D, generado));
  assert.ok(pagD.length >= 3, `varias páginas (${pagD.length})`);
  pagD.forEach((p, i) => {
    assert.ok(p.includes(`Página ${i + 1} de ${pagD.length}`), `pie con número en la página ${i + 1}`);
    assert.ok(p.includes("SIM - Colectivo | Informe interno"));
    if (i > 0) assert.ok(p.includes("Concepto") && p.includes("Monto"), `encabezado de tabla repetido en la página ${i + 1}`);
  });
  const txtD = pagD.join("\n");
  for (let i = 0; i < 140; i++) assert.equal(ocurrencias(txtD, `Movimiento ${String(i).padStart(3, "0")}`), 1, `fila ${i} una sola vez (no se corta ni se repite)`);
  assert.ok(txtD.includes(monto(D.informe.resumen.costos)) && txtD.includes(monto(D.informe.resumen.gastos)));
  console.log(`OK — D (140 movimientos): ${pagD.length} páginas, encabezado de tabla repetido, cada fila una sola vez, «Página X de Y».`);

  // ── Nombre de archivo ───────────────────────────────────────────────────────
  assert.equal(nombreArchivoInformePdf({ nombre: "Fiesta del Ñandú — Edición ¡2026! / Córdoba", fecha_inicio: "2026-10-10" }), "SIM-Colectivo-Fiesta-del-Nandu-Edicion-2026-Cordoba-2026-10-10.pdf");
  assert.equal(nombreArchivoInformePdf({ nombre: "¡¡!!", fecha_inicio: "2026-10-10" }), "SIM-Colectivo-evento-2026-10-10.pdf");
  assert.equal(nombreArchivoInformePdf({ nombre: "Nocturna", fecha_inicio: "x" }), "SIM-Colectivo-Nocturna-sin-fecha.pdf");
  console.log("OK — nombre de archivo SIM-Colectivo-[evento]-[fecha].pdf sin acentos, símbolos ni barras.");

  // ── Contratos de fuente ─────────────────────────────────────────────────────
  const leer = (p: string) => readFileSync(p, "utf8");
  const gen = leer("lib/colectivoInformePdf.ts");
  const rutaPdf = leer("app/api/admin/colectivo/eventos/[id]/informe/pdf/route.ts");
  const rutaInf = leer("app/api/admin/colectivo/eventos/[id]/informe/route.ts");
  assert.ok(!/armarInformeEvento\(|calcularCajaEvento\(|turnoFacturable|ventaFacturable|movimientoVigente|supabaseAdmin/.test(gen), "el generador no calcula ni consulta: solo dibuja");
  assert.ok(/cargarInformeEvento\(id\)/.test(rutaPdf) && /cargarInformeEvento\(id\)/.test(rutaInf), "pantalla y PDF usan la misma carga");
  assert.ok(/requireStaffOrAdmin/.test(rutaPdf) && /"application\/pdf"/.test(rutaPdf) && /attachment; filename=/.test(rutaPdf), "PDF: admin y staff, application/pdf, attachment");
  assert.ok(!/\.(insert|update|upsert|delete)\(|storage|fin_[a-z]/.test(rutaPdf + gen), "PDF: no guarda nada ni toca Finanzas");
  assert.ok(!/puppeteer|chromium/i.test(leer("package.json")), "sin Chromium");
  console.log("OK — contratos: el PDF solo dibuja cargarInformeEvento (lo mismo que la pantalla), sin escrituras, storage ni Finanzas.");
}
main().catch((e) => { console.error(e); process.exit(1); });
