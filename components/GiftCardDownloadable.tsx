"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { GIFT_CARD_CONDICIONES } from "@/lib/giftCards";

export type GiftCardData = {
  codigo_unico: string;
  duracion_minutos: number;
  monto: number;
  destinatario_nombre?: string | null;
  fecha?: string | null;
  usos_totales?: number | null;
  modo_uso?: string | null;
  indexLabel?: string | null; // ej: "2 / 5" para compras separadas
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatFecha(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// SVG autocontenido (solo vectores + texto) para evitar "taint" del canvas.
function buildGiftCardSvg(card: GiftCardData): string {
  const monto = escapeXml(formatPrice(Number(card.monto)));
  const duracion = `${card.duracion_minutos} MIN`;
  const codigo = escapeXml(card.codigo_unico);
  const fecha = escapeXml(formatFecha(card.fecha));
  const para = card.destinatario_nombre
    ? escapeXml(card.destinatario_nombre)
    : "—";

  const usos = Number(card.usos_totales) || 1;
  const subtitulo =
    usos > 1
      ? escapeXml(`${usos} usos en este código · valor total ${formatPrice(Number(card.monto))}`)
      : escapeXml(`Sesión de simulador · valor ${formatPrice(Number(card.monto))}`);

  const indexLabel = card.indexLabel ? escapeXml(card.indexLabel) : "";

  const cond1 = escapeXml(GIFT_CARD_CONDICIONES[0]);
  const cond2 = escapeXml(GIFT_CARD_CONDICIONES[1]);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="55%" stop-color="#111113"/>
      <stop offset="100%" stop-color="#1c0808"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="100%" stop-color="#b91c1c"/>
    </linearGradient>
  </defs>

  <rect width="1000" height="600" rx="28" fill="url(#bg)"/>
  <rect x="6" y="6" width="988" height="588" rx="24" fill="none" stroke="#27272a" stroke-width="2"/>

  <!-- acento diagonal -->
  <polygon points="1000,0 1000,260 720,600 1000,600" fill="#ef4444" opacity="0.06"/>
  <rect x="48" y="150" width="64" height="6" rx="3" fill="url(#red)"/>

  <!-- marca -->
  <text x="48" y="84" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" letter-spacing="10" fill="#ef4444">SIM ARGENTINA</text>
  <text x="48" y="116" font-family="Arial, Helvetica, sans-serif" font-size="15" letter-spacing="3" fill="#71717a">SIMULADORES DE FÓRMULA 1</text>
  ${indexLabel ? `<text x="952" y="84" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" letter-spacing="2" fill="#71717a">${indexLabel}</text>` : ""}

  <!-- título -->
  <text x="48" y="210" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="800" letter-spacing="2" fill="#ffffff">GIFT CARD</text>

  <!-- duración + monto -->
  <text x="48" y="290" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="800" fill="#ef4444">${duracion}</text>
  <text x="48" y="324" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#a1a1aa">${subtitulo}</text>

  <!-- código -->
  <rect x="48" y="360" width="560" height="92" rx="16" fill="#000000" stroke="#3f3f46" stroke-width="2"/>
  <text x="72" y="392" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="4" fill="#71717a">CÓDIGO ÚNICO</text>
  <text x="72" y="432" font-family="'Courier New', monospace" font-size="38" font-weight="700" letter-spacing="4" fill="#ffffff">${codigo}</text>

  <!-- datos derecha -->
  <text x="640" y="392" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="3" fill="#71717a">PARA</text>
  <text x="640" y="420" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${para}</text>
  <text x="640" y="452" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#a1a1aa">Compra: ${fecha}</text>

  <!-- condiciones -->
  <line x1="48" y1="500" x2="952" y2="500" stroke="#27272a" stroke-width="1"/>
  <text x="48" y="528" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="3" fill="#71717a">CONDICIONES</text>
  <text x="48" y="552" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#a1a1aa">${cond1}</text>
  <text x="48" y="574" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#a1a1aa">${cond2}</text>

  <text x="952" y="556" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="2" fill="#52525b">Nuevo Centro Shopping · Córdoba</text>
  <text x="952" y="576" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="2" fill="#52525b">wa.me/5493512520927</text>
</svg>`;
}

// Genera y dispara la descarga PNG de una gift card. Reutilizable (ej: "descargar todas").
export function downloadGiftCardPng(card: GiftCardData): Promise<void> {
  return new Promise((resolve) => {
    try {
      const svg = buildGiftCardSvg(card);
      const scale = 2;
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000 * scale;
        canvas.height = 600 * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve();
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((png) => {
          if (png) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(png);
            a.download = `gift-card-${card.codigo_unico}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(a.href);
          }
          resolve();
        }, "image/png");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    } catch {
      resolve();
    }
  });
}

export default function GiftCardDownloadable({ card }: { card: GiftCardData }) {
  const [downloading, setDownloading] = useState(false);
  const svg = useMemo(() => buildGiftCardSvg(card), [card]);
  const previewUrl = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    [svg]
  );

  async function descargar() {
    setDownloading(true);
    await downloadGiftCardPng(card);
    setDownloading(false);
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Gift Card SIM Argentina" className="block w-full" />
      </div>

      <button
        type="button"
        onClick={descargar}
        disabled={downloading}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-3.5 text-base font-black text-white transition hover:bg-red-500 disabled:opacity-50"
      >
        <Download className="h-5 w-5" />
        {downloading ? "Generando..." : "Descargar"}
      </button>
    </div>
  );
}
