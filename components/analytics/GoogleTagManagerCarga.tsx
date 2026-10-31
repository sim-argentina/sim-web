"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { esAreaComercial } from "@/lib/areaComercial";

// Carga de Google Tag Manager según la ruta. En el área comercial del CRM
// (/comercial) no se carga: ni el loader de gtm.js ni el iframe de <noscript>.
// En el resto del sitio (público y /admin) es exactamente la carga de siempre.
// El código del loader vive acá (y no llega como prop) para que ni siquiera viaje
// en el HTML de las páginas comerciales.
// Ojo: dejar de renderizar esto no descarga un GTM que ya corrió en el documento;
// por eso la entrada al área comercial desde otra página es una navegación de
// documento completo (middleware.ts) y el layout comercial lo vigila
// (app/comercial/AislamientoAnalitica.tsx).

// GA4 (Measurement ID G-KBZPBKWVHP) se configura DENTRO del contenedor de GTM.
const GTM_ID = "GTM-KVM3HXZF";

// Loader oficial de Google Tag Manager (carga única de gtm.js).
const gtmLoader = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`;

export function CargadorGtm() {
  const pathname = usePathname();
  if (esAreaComercial(pathname)) return null;
  return (
    <Script id="gtm-loader" strategy="afterInteractive">
      {gtmLoader}
    </Script>
  );
}

export function NoscriptGtm() {
  const pathname = usePathname();
  if (esAreaComercial(pathname)) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
