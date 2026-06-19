"use client";

import { useEffect, useMemo, useState } from "react";
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

// Assets del diseño. Cambiá BG_IMAGE_URL por tu archivo exacto si lo agregás a /public.
const BG_IMAGE_URL = "/gift-card-bg.jpg";
const LOGO_URL = "/sim-logo.png";

// Contacto (sin URL cruda). Si cambia el número, editar acá.
const WHATSAPP_TEL = "+54 9 351 252 0927";

type GiftCardAssets = { bg: string; logo: string };

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

// Convierte un asset estático a data-URI base64. Embeberlo así (en lugar de una
// URL externa) evita el "taint" del canvas, manteniendo la descarga PNG.
async function fetchDataUri(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

// Cache a nivel módulo: los assets se descargan/codifican una sola vez y se
// reutilizan tanto para el preview como para la descarga ("descargar todas").
let assetsPromise: Promise<GiftCardAssets> | null = null;
function getGiftCardAssets(): Promise<GiftCardAssets> {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      fetchDataUri(BG_IMAGE_URL),
      fetchDataUri(LOGO_URL),
    ]).then(([bg, logo]) => ({ bg, logo }));
  }
  return assetsPromise;
}

// SVG autocontenido: vectores, texto e imágenes embebidas como data-URI (no
// tinta el canvas). El logo usa mix-blend screen para descartar su fondo negro.
function buildGiftCardSvg(card: GiftCardData, assets?: GiftCardAssets): string {
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

  const tel = escapeXml(WHATSAPP_TEL);

  const bgImage = assets?.bg
    ? `<image href="${assets.bg}" xlink:href="${assets.bg}" x="0" y="0" width="1000" height="600" preserveAspectRatio="xMidYMid slice"/>`
    : "";

  const logoImage = assets?.logo
    ? `<image href="${assets.logo}" xlink:href="${assets.logo}" x="42" y="30" width="92" height="110" preserveAspectRatio="xMidYMid meet" style="mix-blend-mode:screen"/>`
    : "";

  // Ícono de WhatsApp (path oficial 24x24) escalado y ubicado a la izquierda del número.
  const waIcon = `<g transform="translate(792 566) scale(0.7)" fill="#e4e4e7"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="600" viewBox="0 0 1000 600">
  <defs>
    <linearGradient id="bgFallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="55%" stop-color="#111113"/>
      <stop offset="100%" stop-color="#1c0808"/>
    </linearGradient>
    <radialGradient id="cornerShade" cx="0" cy="0" r="0.62">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bottomShade" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="card"><rect width="1000" height="600" rx="28"/></clipPath>
  </defs>

  <g clip-path="url(#card)">
    <!-- base + fondo (carbono) -->
    <rect width="1000" height="600" fill="url(#bgFallback)"/>
    ${bgImage}
    <!-- overlays de legibilidad (la imagen ya trae los acentos rojos) -->
    <rect width="1000" height="600" fill="#000000" opacity="0.16"/>
    <rect width="1000" height="600" fill="url(#cornerShade)"/>
    <rect width="1000" height="600" fill="url(#bottomShade)"/>
  </g>
  <rect x="6" y="6" width="988" height="588" rx="24" fill="none" stroke="#3f3f46" stroke-width="1.5" opacity="0.7"/>

  <!-- logo (esquina superior izquierda) -->
  ${logoImage}
  ${indexLabel ? `<text x="952" y="78" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" letter-spacing="2" fill="#a1a1aa">${indexLabel}</text>` : ""}

  <!-- título -->
  <text x="48" y="210" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="800" letter-spacing="2" fill="#ffffff">GIFT CARD</text>

  <!-- duración + monto -->
  <text x="48" y="290" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="800" fill="#ef4444">${duracion}</text>
  <text x="48" y="324" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#d4d4d8">${subtitulo}</text>

  <!-- código -->
  <rect x="48" y="360" width="560" height="92" rx="16" fill="#000000" fill-opacity="0.78" stroke="#52525b" stroke-width="1.5"/>
  <text x="72" y="392" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="4" fill="#a1a1aa">CÓDIGO ÚNICO</text>
  <text x="72" y="432" font-family="'Courier New', monospace" font-size="38" font-weight="700" letter-spacing="4" fill="#ffffff">${codigo}</text>

  <!-- datos derecha -->
  <text x="640" y="392" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="3" fill="#a1a1aa">PARA</text>
  <text x="640" y="420" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${para}</text>
  <text x="640" y="452" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#d4d4d8">Compra: ${fecha}</text>

  <!-- condiciones -->
  <line x1="48" y1="500" x2="952" y2="500" stroke="#3f3f46" stroke-width="1" opacity="0.8"/>
  <text x="48" y="528" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="3" fill="#a1a1aa">CONDICIONES</text>
  <text x="48" y="552" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#d4d4d8">${cond1}</text>
  <text x="48" y="574" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#d4d4d8">${cond2}</text>

  <!-- ubicación + contacto -->
  <text x="952" y="550" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="2" fill="#a1a1aa">Nuevo Centro Shopping · Córdoba</text>
  ${waIcon}
  <text x="952" y="578" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" letter-spacing="1" fill="#e4e4e7">${tel}</text>
</svg>`;
}

// Genera y dispara la descarga PNG de una gift card. Reutilizable (ej: "descargar todas").
export function downloadGiftCardPng(card: GiftCardData): Promise<void> {
  return new Promise((resolve) => {
    (async () => {
      try {
        const assets = await getGiftCardAssets();
        const svg = buildGiftCardSvg(card, assets);
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
    })();
  });
}

export default function GiftCardDownloadable({ card }: { card: GiftCardData }) {
  const [downloading, setDownloading] = useState(false);
  const [assets, setAssets] = useState<GiftCardAssets | null>(null);

  useEffect(() => {
    let mounted = true;
    getGiftCardAssets().then((a) => {
      if (mounted) setAssets(a);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const svg = useMemo(
    () => buildGiftCardSvg(card, assets ?? undefined),
    [card, assets]
  );
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
