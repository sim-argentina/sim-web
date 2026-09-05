import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Clock3, Users, Info } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { mensualidadesHabilitadas } from "@/lib/featureFlags";

// Primera versión VISUAL de Mensualidades SIM (Bloque M1). No hay pago, ni
// registros, ni saldo: el CTA está deshabilitado a propósito hasta el bloque M3.
// La ruta entera está detrás de la flag server-side MENSUALIDADES_ENABLED: sin
// esa variable en "true", responde 404 (no existe para el visitante).
//
// force-dynamic para que la flag se evalúe por request y la página nunca quede
// prerenderizada con el valor que tenía el build.
export const dynamic = "force-dynamic";

export const metadata = {
  ...pageMetadata({
    title: "Mensualidades SIM — Horas prepagas de simulador",
    description:
      "Comprá horas por adelantado, reservá cuando quieras y aprovechá un mejor precio durante 30 días en los simuladores de SIM Argentina.",
    path: "/mensualidades",
  }),
  // Sección todavía no lanzada: no debe indexarse aunque la flag se active.
  robots: { index: false, follow: false },
};

type Plan = {
  slug: string;
  horas: string;
  titulo: string;
  precio: string;
  detalle: string;
  etiqueta: string | null;
};

// Catálogo SOLO para maquetar. El precio real vive server-side desde M3.
const PLANES: Plan[] = [
  {
    slug: "1h",
    horas: "1 hora",
    titulo: "60 minutos de simulador",
    precio: "$30.000",
    detalle: "Ideal para probar el formato y usarlo en dos o tres visitas.",
    etiqueta: null,
  },
  {
    slug: "2h",
    horas: "2 horas",
    titulo: "120 minutos de simulador",
    precio: "$55.000",
    detalle: "El equilibrio entre precio y tiempo de pista para venir seguido.",
    etiqueta: "Más elegida",
  },
  {
    slug: "4h",
    horas: "4 horas",
    titulo: "240 minutos de simulador",
    precio: "$100.000",
    detalle: "El mejor valor por minuto, pensado para el que entrena en serio.",
    etiqueta: "Mejor precio",
  },
];

const COMO_FUNCIONA = [
  {
    icon: CalendarCheck,
    titulo: "Vigencia de 30 días",
    texto:
      "El plan arranca cuando se aprueba el pago y dura 30 días. No hay renovación automática: cuando termina, termina.",
  },
  {
    icon: Clock3,
    titulo: "Se usa reservando desde la web",
    texto:
      "Las horas se consumen reservando turnos online, con las mismas fechas y horarios disponibles que una reserva común.",
  },
  {
    icon: Users,
    titulo: "De 1 a 4 simuladores por turno",
    texto:
      "Podés reservar turnos de 15, 30, 45 o 60 minutos y elegir entre 1 y 4 simuladores, según haya disponibilidad.",
  },
  {
    icon: Info,
    titulo: "El saldo se descuenta por simulador",
    texto:
      "Lo que se descuenta es la duración del turno multiplicada por la cantidad de simuladores. Dos simuladores durante 30 minutos consumen 60 minutos de tu saldo.",
  },
];

export default function MensualidadesPage() {
  // Guarda server-side: con la flag apagada la ruta no existe.
  if (!mensualidadesHabilitadas()) notFound();

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-10 md:px-6 lg:px-8">
        <Link
          href="/vivi-sim"
          className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-zinc-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>

        {/* ── Encabezado ── */}
        <div className="mb-10">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">
            SIM Argentina
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-6xl">
            Mensualidades <span className="text-red-600">SIM</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
            Comprá horas por adelantado, reservá cuando quieras y aprovechá un mejor
            precio durante 30 días.
          </p>
        </div>

        {/* ── Planes ── */}
        <div className="grid items-stretch gap-5 md:grid-cols-3">
          {PLANES.map((plan) => (
            <div
              key={plan.slug}
              className="flex flex-col rounded-[26px] border border-white/10 bg-[#0b0b0d] p-6 ring-1 ring-white/[0.03] md:p-7"
            >
              {/* Fila de etiqueta con altura reservada: las tres cards arrancan igual */}
              <div className="mb-4 flex min-h-[26px] items-center">
                {plan.etiqueta && (
                  <span className="rounded-md bg-red-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                    {plan.etiqueta}
                  </span>
                )}
              </div>

              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                {plan.horas}
              </p>
              <p className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                {plan.precio}
              </p>
              <p className="mt-2 text-sm font-bold text-zinc-400">{plan.titulo}</p>

              <div className="my-5 h-px bg-white/10" />

              <p className="flex-1 text-sm leading-6 text-zinc-400">{plan.detalle}</p>

              {/* M1: sin pago. El botón queda inerte hasta el bloque M3. */}
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="mt-6 w-full cursor-not-allowed rounded-2xl border border-red-600/40 bg-red-600/10 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-red-300/70"
              >
                Comprar mensualidad
              </button>
            </div>
          ))}
        </div>

        {/* ── Cómo funciona ── */}
        <div className="mt-14">
          <h2 className="text-2xl font-black uppercase tracking-tight md:text-3xl">
            Cómo funciona
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {COMO_FUNCIONA.map(({ icon: Icon, titulo, texto }) => (
              <div
                key={titulo}
                className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="mt-0.5 shrink-0 rounded-xl bg-red-950/60 p-2.5 text-red-400">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-[0.06em]">
                    {titulo}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-zinc-400">{texto}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-xs leading-6 text-zinc-500">
            Todas las reservas están sujetas a la disponibilidad real de turnos y
            simuladores. Las mensualidades no tienen renovación automática ni se
            descuentan de otras promociones.
          </p>
        </div>
      </section>
    </main>
  );
}
