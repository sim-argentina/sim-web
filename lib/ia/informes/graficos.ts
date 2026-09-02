// IA SIM · Bloque 4C — Gráficos determinísticos desde datos EXACTOS (nunca IA de
// imágenes). Se construye un SVG y se rasteriza a PNG con resvg + fuente embebida
// (Vercel no tiene fuentes de sistema). Identidad SIM: rojo/negro/blanco, fondo
// claro apto para impresión.

import { Resvg } from "@resvg/resvg-js";
import type { Grafico } from "@/lib/ia/informes/schema";
import { fuenteSansBuffer } from "@/lib/ia/informes/assets/fuenteBase64";

export const SIM = {
  rojo: "#dc2626", rojoOscuro: "#991b1b", negro: "#0a0a0a", blanco: "#ffffff",
  grisTexto: "#404040", grisSuave: "#9ca3af", grid: "#e5e7eb",
};
// Paleta para series (rojo SIM primero, luego negro/grises/tintes).
const SERIE_COLORES = ["#dc2626", "#0a0a0a", "#737373", "#f87171", "#b91c1c", "#a3a3a3", "#7f1d1d", "#525252"];

// Opciones de fuente para resvg. `fontBuffers` existe en runtime pero falta en el
// .d.ts de esta versión: se castea para no perder el render de texto en Vercel.
function opcionesFuente() {
  return { fontBuffers: [fuenteSansBuffer()], defaultFontFamily: "Liberation Sans", loadSystemFonts: false } as unknown as { loadSystemFonts: boolean };
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

// Escala "linda": máximo redondeado hacia arriba a 1/2/5 × 10^k.
function ejeMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 2.5, 5, 10]) if (base * m >= max) return base * m;
  return base * 10;
}

const W = 900, H = 520, ML = 90, MR = 30, MT = 64, MB = 110;
const PW = W - ML - MR, PH = H - MT - MB;

function encabezado(titulo: string): string {
  return (
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${SIM.blanco}"/>` +
    `<rect x="0" y="0" width="${W}" height="8" fill="${SIM.rojo}"/>` +
    `<text x="${ML}" y="40" font-family="sans-serif" font-size="22" font-weight="bold" fill="${SIM.negro}">${esc(titulo)}</text>` +
    `<text x="${W - MR}" y="40" text-anchor="end" font-family="sans-serif" font-size="12" fill="${SIM.grisSuave}">SIM</text>`
  );
}

function leyenda(nombres: string[]): string {
  let x = ML, out = "";
  nombres.forEach((n, i) => {
    const c = SERIE_COLORES[i % SERIE_COLORES.length];
    out += `<rect x="${x}" y="${H - 34}" width="12" height="12" fill="${c}"/>`;
    out += `<text x="${x + 18}" y="${H - 24}" font-family="sans-serif" font-size="13" fill="${SIM.grisTexto}">${esc(n)}</text>`;
    x += 30 + n.length * 8;
  });
  return out;
}

function ejeY(max: number): string {
  let out = "";
  const pasos = 5;
  for (let i = 0; i <= pasos; i++) {
    const v = (max / pasos) * i;
    const y = MT + PH - (PH * i) / pasos;
    out += `<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="${SIM.grid}" stroke-width="1"/>`;
    out += `<text x="${ML - 8}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="${SIM.grisTexto}">${esc(fmt(v))}</text>`;
  }
  return out;
}

function etiquetasX(cats: string[]): string {
  const n = cats.length;
  const bw = PW / n;
  return cats.map((c, i) => {
    const x = ML + bw * i + bw / 2;
    const txt = c.length > 14 ? c.slice(0, 13) + "…" : c;
    return `<text x="${x}" y="${MT + PH + 20}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${SIM.grisTexto}" transform="rotate(0 ${x} ${MT + PH + 20})">${esc(txt)}</text>`;
  }).join("");
}

function barrasSVG(g: Grafico): string {
  const todos = g.series.flatMap((s) => s.valores);
  const max = ejeMax(Math.max(1, ...todos.map((v) => Math.abs(v))));
  const n = g.categorias.length, ns = g.series.length;
  const grupo = PW / n, bw = (grupo * 0.8) / ns;
  let barras = "";
  g.series.forEach((s, si) => {
    const c = SERIE_COLORES[si % SERIE_COLORES.length];
    s.valores.forEach((v, ci) => {
      const h = (PH * Math.abs(v)) / max;
      const x = ML + grupo * ci + grupo * 0.1 + bw * si;
      const y = MT + PH - h;
      barras += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}"/>`;
    });
  });
  return encabezado(g.titulo) + ejeY(max) + barras + etiquetasX(g.categorias) + leyenda(g.series.map((s) => s.nombre));
}

function lineasSVG(g: Grafico): string {
  const todos = g.series.flatMap((s) => s.valores);
  const max = ejeMax(Math.max(1, ...todos.map((v) => Math.abs(v))));
  const n = g.categorias.length;
  const paso = n > 1 ? PW / (n - 1) : PW;
  let lineas = "";
  g.series.forEach((s, si) => {
    const c = SERIE_COLORES[si % SERIE_COLORES.length];
    const pts = s.valores.map((v, ci) => {
      const x = ML + (n > 1 ? paso * ci : PW / 2);
      const y = MT + PH - (PH * Math.abs(v)) / max;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    lineas += `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${pts.join(" ")}"/>`;
    pts.forEach((p) => { const [x, y] = p.split(","); lineas += `<circle cx="${x}" cy="${y}" r="3.5" fill="${c}"/>`; });
  });
  return encabezado(g.titulo) + ejeY(max) + lineas + etiquetasX(g.categorias) + leyenda(g.series.map((s) => s.nombre));
}

function circularSVG(g: Grafico): string {
  const vals = g.series[0]?.valores ?? [];
  const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
  const cx = ML + PW / 2, cy = MT + PH / 2, r = Math.min(PW, PH) / 2 - 10;
  let ang = -Math.PI / 2, slices = "";
  vals.forEach((v, i) => {
    const frac = Math.abs(v) / total;
    const a2 = ang + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    const c = SERIE_COLORES[i % SERIE_COLORES.length];
    slices += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${c}"/>`;
    const mid = (ang + a2) / 2, lx = cx + (r * 0.6) * Math.cos(mid), ly = cy + (r * 0.6) * Math.sin(mid);
    if (frac > 0.04) slices += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="${SIM.blanco}">${Math.round(frac * 100)}%</text>`;
    ang = a2;
  });
  return encabezado(g.titulo) + slices + leyenda(g.categorias);
}

export function graficoSVG(g: Grafico): string {
  const inner = g.tipo === "lineas" ? lineasSVG(g) : g.tipo === "circular" ? circularSVG(g) : barrasSVG(g);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
}

export function graficoPNG(g: Grafico, escala = 2): Buffer {
  const svg = graficoSVG(g);
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: W * escala },
    font: opcionesFuente(),
    background: SIM.blanco,
  });
  return Buffer.from(r.render().asPng());
}

// Tarjeta-resumen visual con identidad SIM (fondo negro, acentos rojos).
export function tarjetaResumenPNG(titulo: string, items: Array<{ etiqueta: string; valor: string }>, escala = 2): Buffer {
  const w = 900, h = 120 + items.length * 64;
  let body = `<rect x="0" y="0" width="${w}" height="${h}" fill="${SIM.negro}"/>` +
    `<rect x="0" y="0" width="${w}" height="10" fill="${SIM.rojo}"/>` +
    `<text x="40" y="66" font-family="sans-serif" font-size="26" font-weight="bold" fill="${SIM.blanco}">${esc(titulo)}</text>`;
  items.forEach((it, i) => {
    const y = 120 + i * 64;
    body += `<text x="40" y="${y}" font-family="sans-serif" font-size="15" fill="${SIM.grisSuave}">${esc(it.etiqueta)}</text>`;
    body += `<text x="${w - 40}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="24" font-weight="bold" fill="${SIM.rojo}">${esc(it.valor)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const r = new Resvg(svg, { fitTo: { mode: "width", value: w * escala }, font: opcionesFuente(), background: SIM.negro });
  return Buffer.from(r.render().asPng());
}
