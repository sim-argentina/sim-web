import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";
import { COOKIE_SESION, leerSesion } from "@/lib/mensualidadSesion";
import { getMiPlan } from "@/lib/mensualidadesMiPlan";
import { CONDICIONES_RESERVA } from "@/lib/mensualidadesCondiciones";
import ReservarConMensualidad from "./ReservarConMensualidad";

// Reservar con la mensualidad (Bloque M5A).
//
// La URL no lleva PII ni identificadores: quién es el titular sale de la cookie
// HttpOnly de M4. Para EMPEZAR una reserva hacen falta las cuatro condiciones:
//   · feature flag encendida (es un acceso nuevo);
//   · sesión temporal válida;
//   · mensualidad no bloqueada;
//   · mensualidad vigente y con saldo.
// Cualquier falla devuelve 404 neutral: no se revela que la función existe.

export const dynamic = "force-dynamic";

export const metadata = {
  ...pageMetadata({
    title: "Reservar con mi mensualidad",
    description: "Usá el saldo de tu mensualidad para reservar un turno en SIM Argentina.",
    path: "/mensualidades/reservar",
  }),
  robots: { index: false, follow: false },
};

export default async function ReservarPage() {
  if (!mensualidadesHabilitadas()) notFound();

  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_SESION)?.value);
  if (!sesion) notFound();

  const plan = await getMiPlan(sesion.mensualidadId);
  if (!plan) notFound();
  // puede_reservar ya resume bloqueada / vencida / agotada.
  if (!plan.puede_reservar) notFound();

  return (
    <main className="min-h-screen bg-black px-4 py-16 text-white md:py-24">
      <section className="mx-auto max-w-4xl">
        <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Reservar con mi mensualidad
        </p>
        <ReservarConMensualidad
          saldoInicial={plan.saldo_minutos}
          venceEl={plan.vence_el}
          condiciones={[...CONDICIONES_RESERVA]}
        />
      </section>
    </main>
  );
}
