import { SITE_URL, SITE_NAME } from "@/lib/seo";

// Datos estructurados Schema.org (JSON-LD). Server-rendered e invisible: no afecta
// diseño, textos visibles, layout ni funcionalidad. Solo mejora cómo Google entiende
// el negocio (SEO local + rich results). Datos tomados de data/site.ts.
export default function StructuredData() {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/sim-logo.png`,
        image: `${SITE_URL}/sim-logo.png`,
        sameAs: ["https://www.instagram.com/sim_argentina/"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "es-AR",
      },
      {
        "@type": "EntertainmentBusiness",
        "@id": `${SITE_URL}/#localbusiness`,
        name: SITE_NAME,
        url: SITE_URL,
        image: `${SITE_URL}/sim-logo.png`,
        logo: `${SITE_URL}/sim-logo.png`,
        description:
          "Simuladores profesionales de Fórmula 1 y GT en Córdoba. Turnos, gift cards, campeonatos y alquiler de simuladores para eventos y empresas.",
        telephone: "+5493512520927",
        priceRange: "$$",
        address: {
          "@type": "PostalAddress",
          streetAddress: "Nuevo Centro Shopping",
          addressLocality: "Córdoba",
          addressRegion: "Córdoba",
          addressCountry: "AR",
        },
        areaServed: { "@type": "AdministrativeArea", name: "Córdoba, Argentina" },
        parentOrganization: { "@id": `${SITE_URL}/#organization` },
        sameAs: ["https://www.instagram.com/sim_argentina/"],
        openingHoursSpecification: [
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            opens: "10:00",
            closes: "22:00",
          },
        ],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify escapa el contenido; sin datos de usuario, sin riesgo XSS.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
