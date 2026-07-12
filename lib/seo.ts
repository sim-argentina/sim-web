import type { Metadata } from "next";

// Helper de metadata SEO por página. Solo genera <head> (title/description/
// canonical/OpenGraph/Twitter): no cambia nada visible ni funcional.
export const SITE_URL = "https://simexperience.com.ar";
export const SITE_NAME = "SIM Argentina";
const OG_IMAGE = "/sim-logo.png";

export function pageMetadata({
  title,
  description,
  path,
}: {
  title?: string;
  description: string;
  path: string;
}): Metadata {
  const url = path === "/" ? SITE_URL : `${SITE_URL}${path}`;
  const ogTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      locale: "es_AR",
      title: ogTitle,
      description,
      images: [{ url: OG_IMAGE, alt: SITE_NAME }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [OG_IMAGE],
    },
  };
}
