// IA SIM · Bloque 4C — Render PNG: un resumen visual descargable (tarjeta-resumen
// con identidad SIM + los gráficos del informe apilados). Determinístico, desde datos
// exactos (nunca IA de imágenes). Se compone con sharp (ya presente en el proyecto).

import sharp from "sharp";
import type { ContextoRender } from "@/lib/ia/informes/render/tipos";
import { graficoPNG, tarjetaResumenPNG } from "@/lib/ia/informes/graficos";
import { formatearCelda } from "@/lib/ia/informes/formato";

const ANCHO = 900, GAP = 16;

// Deriva ítems de la tarjeta: si la primera tabla tiene 2 columnas (etiqueta/valor)
// usa sus primeras filas; si no, muestra contadores del informe.
function itemsTarjeta(ctx: ContextoRender): Array<{ etiqueta: string; valor: string }> {
  const t = ctx.spec.tablas[0];
  if (t && t.columnas.length === 2 && t.filas.length > 0) {
    return t.filas.slice(0, 6).map((fila) => ({ etiqueta: formatearCelda(fila[0] ?? "—", t.columnas[0].tipo), valor: formatearCelda(fila[1] ?? null, t.columnas[1].tipo) }));
  }
  return [
    { etiqueta: "Período", valor: ctx.spec.periodo ?? "—" },
    { etiqueta: "Tablas", valor: String(ctx.spec.tablas.length) },
    { etiqueta: "Gráficos", valor: String(ctx.spec.graficos.length) },
    ...(ctx.spec.registros_utilizados != null ? [{ etiqueta: "Registros", valor: ctx.spec.registros_utilizados.toLocaleString("es-AR") }] : []),
  ];
}

export async function renderPNG(ctx: ContextoRender): Promise<Buffer> {
  const partes: Buffer[] = [tarjetaResumenPNG(ctx.spec.titulo, itemsTarjeta(ctx), 2)];
  for (const g of ctx.spec.graficos) partes.push(graficoPNG(g, 2));

  // Normalizar todas al mismo ancho y medir alturas.
  const norm = await Promise.all(partes.map((b) => sharp(b).resize({ width: ANCHO * 2, withoutEnlargement: false }).png().toBuffer()));
  const metas = await Promise.all(norm.map((b) => sharp(b).metadata()));
  const alturas = metas.map((m) => m.height ?? 0);
  const totalH = alturas.reduce((a, b) => a + b, 0) + GAP * 2 * (norm.length - 1);
  const W = ANCHO * 2;

  let yOff = 0;
  const composites = norm.map((buf, i) => { const c = { input: buf, top: yOff, left: 0 }; yOff += (alturas[i] ?? 0) + GAP * 2; return c; });

  return await sharp({ create: { width: W, height: Math.max(totalH, 1), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite(composites)
    .png()
    .toBuffer();
}
