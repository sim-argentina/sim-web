import { pageMetadata } from "@/lib/seo";

// Layout server-only: solo aporta metadata SEO a la página cliente de reservas.
// No agrega UI ni cambia el comportamiento (renderiza los children tal cual).
export const metadata = pageMetadata({
  title: "Reservar turno de simulador de F1 en Córdoba",
  description:
    "Reservá online tu turno en los simuladores profesionales de Fórmula 1 y GT de SIM Argentina, en Nuevo Centro Shopping, Córdoba. Elegí día, horario y duración.",
  path: "/reservas",
});

export default function ReservasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
