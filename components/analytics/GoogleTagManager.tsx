import Script from "next/script";

// Google Tag Manager + Consent Mode v2.
// GA4 (Measurement ID G-KBZPBKWVHP) se configura DENTRO del contenedor de GTM
// (GTM-KVM3HXZF); acá solo se instala GTM y se declaran los defaults de consentimiento.
const GTM_ID = "GTM-KVM3HXZF";

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

// Loader oficial de Google Tag Manager (carga única de gtm.js).
const gtmLoader = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`;

// Para <head>: consentimiento por defecto (parse-time) + loader de GTM.
export function GoogleTagManagerHead() {
  return (
    <>
      {/* Consent Mode v2 — debe correr antes que GTM. */}
      <script id="consent-default" dangerouslySetInnerHTML={{ __html: consentDefault }} />
      {/* Google Tag Manager */}
      <Script id="gtm-loader" strategy="afterInteractive">
        {gtmLoader}
      </Script>
    </>
  );
}

// Fallback <noscript> para navegadores sin JS (va apenas abre <body>).
export function GoogleTagManagerNoscript() {
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
