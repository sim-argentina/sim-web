import { pageMetadata } from "@/lib/seo";

// Layout server-only: solo aporta metadata SEO a la página cliente. No agrega UI.
export const metadata = pageMetadata({
  title: "Viajá con SIM — Experiencias de automovilismo",
  description:
    "Viví la pasión por el automovilismo con SIM Argentina: experiencias, viajes y actividades para fanáticos de la Fórmula 1 y las carreras en Córdoba y Argentina.",
  path: "/viaja-con-sim",
});

export default function ViajaConSimLayout({ children }: { children: React.ReactNode }) {
  return children;
}
