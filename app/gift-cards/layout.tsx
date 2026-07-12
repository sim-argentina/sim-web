import { pageMetadata } from "@/lib/seo";

// Layout server-only: solo aporta metadata SEO a la página cliente. No agrega UI.
export const metadata = pageMetadata({
  title: "Gift Card de simuladores — Regalo original en Córdoba",
  description:
    "Regalá una experiencia de manejo en simuladores de Fórmula 1. Comprá online tu Gift Card de SIM Argentina y sorprendé en Córdoba con un regalo original.",
  path: "/gift-cards",
});

export default function GiftCardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
