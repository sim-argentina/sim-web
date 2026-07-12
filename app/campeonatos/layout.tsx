import { pageMetadata } from "@/lib/seo";

// Layout server-only: solo aporta metadata SEO a la página cliente. No agrega UI.
export const metadata = pageMetadata({
  title: "Campeonatos de simuladores (sim racing) en Córdoba",
  description:
    "Competí en los campeonatos oficiales de simuladores de SIM Argentina en Córdoba. Inscribite, marcá tu mejor tiempo y sumá puntos por categoría en el ranking.",
  path: "/campeonatos",
});

export default function CampeonatosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
