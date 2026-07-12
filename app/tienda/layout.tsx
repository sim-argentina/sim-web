import { pageMetadata } from "@/lib/seo";

// Layout server-only: solo aporta metadata SEO a la página cliente. No agrega UI.
export const metadata = pageMetadata({
  title: "Tienda de simuladores de F1 profesionales",
  description:
    "Comprá tu propio simulador de automovilismo profesional. Simuladores de Fórmula 1 y GT de SIM Argentina para tu casa, gamer room o negocio. Consultá por WhatsApp.",
  path: "/tienda",
});

export default function TiendaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
