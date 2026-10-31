import { CargadorGtm, NoscriptGtm } from "./GoogleTagManagerCarga";

// Google Tag Manager + Consent Mode v2.
// GA4 (Measurement ID G-KBZPBKWVHP) se configura DENTRO del contenedor de GTM
// (GTM-KVM3HXZF); acá solo se instala GTM y se declaran los defaults de consentimiento.
// El ID y el loader viven en GoogleTagManagerCarga.tsx, que no los carga en el área
// comercial del CRM.

// Consent Mode v2: script inline en <head> que se ejecuta en tiempo de parseo,
// ANTES de que cargue GTM (garantiza analytics_storage denegado por defecto).
const consentDefault = `
window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
gtag('consent','default',{
  ad_storage:'denied',
  ad_user_data:'denied',
  ad_personalization:'denied',
  analytics_storage:'denied',
  functionality_storage:'granted',
  security_storage:'granted',
  personalization_storage:'denied',
  wait_for_update: 500
});
try {
  if (localStorage.getItem('sim-analytics-consent') === 'granted') {
    gtag('consent','update',{ analytics_storage:'granted' });
  }
} catch (e) {}
`;

// Para <head>: consentimiento por defecto (parse-time) + loader de GTM.
// El consentimiento por defecto se deja en todas las páginas: no hace red, solo
// declara "denegado" antes de que cualquier GTM pueda cargar.
export function GoogleTagManagerHead() {
  return (
    <>
      {/* Consent Mode v2 — debe correr antes que GTM. */}
      <script id="consent-default" dangerouslySetInnerHTML={{ __html: consentDefault }} />
      {/* Google Tag Manager */}
      <CargadorGtm />
    </>
  );
}

// Fallback <noscript> para navegadores sin JS (va apenas abre <body>).
export function GoogleTagManagerNoscript() {
  return <NoscriptGtm />;
}
