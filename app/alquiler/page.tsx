import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Car,
  CheckCircle2,
  MapPin,
  PartyPopper,
  Sparkles,
  Truck,
  Users,
  Zap,
  Flag,
} from "lucide-react";

const services = [
  {
    title: "Alquiler para empresas",
    text: "Llevamos la experiencia SIM a eventos corporativos, lanzamientos, acciones de marca, shoppings, ferias y activaciones comerciales.",
    icon: Building2,
  },
  {
    title: "Eventos particulares",
    text: "También podés contratar simuladores para cumpleaños, juntadas, eventos privados o experiencias especiales.",
    icon: PartyPopper,
  },
  {
    title: "Colectivo SIM",
    text: "Una propuesta móvil de alto impacto visual, pensada para recorrer ciudades, eventos y puntos estratégicos.",
    icon: Truck,
  },
  {
    title: "Simuladores individuales",
    text: "Si no necesitás el colectivo completo, también se pueden alquilar simuladores para montar una experiencia en tu espacio.",
    icon: Car,
  },
];

const benefits = [
  "Experiencia inmersiva inspirada en Fórmula 1",
  "Ideal para generar tráfico, contenido y recordación de marca",
  "Formato adaptable a empresas, eventos y consumidor final",
  "Simuladores con estética profesional y alto impacto visual",
  "Propuesta atractiva para público joven, familias y fanáticos del automovilismo",
  "Posibilidad de activar competencias, rankings y premios",
];

export default function AlquilerPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-black text-white">
      {/* HERO */}
      <section className="relative px-4 py-10 md:px-6 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(0,102,255,0.22),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(255,0,128,0.22),transparent_28%),linear-gradient(180deg,#050505,#000)]" />

        <div className="mx-auto max-w-7xl">
          <div className="grid gap-6 lg:grid-cols-[1fr_430px] lg:items-stretch">
            {/* TEXTO */}
            <div className="flex min-h-[620px] flex-col justify-center rounded-[36px] border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur md:p-10">
              <p className="text-xs font-black uppercase tracking-[0.45em] text-pink-400">
                Alquiler SIM
              </p>

              <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight md:text-6xl">
                Llevá la experiencia de Fórmula 1 a tu evento
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
                Alquilá simuladores profesionales o el colectivo SIM completo
                para empresas, activaciones, eventos privados y experiencias de
                alto impacto. Una propuesta distinta, visual y competitiva.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20consultar%20disponibilidad%20para%20alquilar%20simuladores%20o%20el%20colectivo."
                  target="_blank"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-pink-600 px-6 py-4 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:scale-[1.02]"
                >
                  Consultar disponibilidad
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* VIDEO VERTICAL */}
            <div className="grid gap-4">
              <div className="relative min-h-[620px] overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950 shadow-2xl">
                <video
                  src="/colectivo-sim.mp4"
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

                <div className="absolute bottom-5 left-5 right-5 rounded-3xl border border-white/10 bg-black/55 p-5 backdrop-blur">
                  <p className="text-xs font-bold uppercase tracking-[0.35em] text-blue-300">
                    Formato móvil
                  </p>

                  <h2 className="mt-2 text-2xl font-black">
                    Colectivo + simuladores
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-3xl border border-blue-400/25 bg-blue-500/10 p-4">
                  <Zap className="mb-3 h-5 w-5 text-blue-300" />
                  <p className="text-2xl font-black">F1</p>
                  <p className="mt-1 text-xs text-zinc-400">Adrenalina</p>
                </div>

                <div className="rounded-3xl border border-pink-400/25 bg-pink-500/10 p-4">
                  <Users className="mb-3 h-5 w-5 text-pink-300" />
                  <p className="text-2xl font-black">B2B</p>
                  <p className="mt-1 text-xs text-zinc-400">Empresas</p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <MapPin className="mb-3 h-5 w-5 text-white" />
                  <p className="text-2xl font-black">ON</p>
                  <p className="mt-1 text-xs text-zinc-400">Eventos</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      <section className="px-4 py-10 md:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.45em] text-blue-400">
                Qué podés contratar
              </p>

              <h2 className="mt-4 text-3xl font-black md:text-5xl">
                Dos formatos, una misma experiencia
              </h2>
            </div>

            <p className="max-w-xl leading-7 text-zinc-400">
              La propuesta se puede adaptar según el espacio, el objetivo del
              evento y el tipo de público: desde una activación de marca hasta
              una experiencia privada.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {services.map((service) => {
              const Icon = service.icon;

              return (
                <article
                  key={service.title}
                  className="group rounded-[28px] border border-white/10 bg-zinc-950 p-6 transition hover:-translate-y-1 hover:border-pink-400/40 hover:bg-white/[0.04]"
                >
                  <div className="mb-5 inline-flex rounded-2xl bg-gradient-to-br from-blue-600/25 to-pink-600/25 p-3 text-white">
                    <Icon className="h-6 w-6" />
                  </div>

                  <h3 className="text-xl font-black">{service.title}</h3>

                  <p className="mt-3 leading-7 text-zinc-400">
                    {service.text}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* BLOQUE VISUAL */}
      <section className="px-4 py-10 md:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-[34px] border border-white/10 bg-gradient-to-br from-blue-950/50 via-zinc-950 to-pink-950/40 p-6 md:p-8">
              <Sparkles className="h-8 w-8 text-pink-300" />

              <h2 className="mt-5 text-3xl font-black md:text-5xl">
                Una activación que no pasa desapercibida
              </h2>

              <p className="mt-5 leading-8 text-zinc-300">
                SIM funciona muy bien cuando el objetivo es atraer gente,
                generar fotos, videos, competencia y conversación alrededor de
                una marca o evento.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex gap-3">
                  <CalendarDays className="mt-1 h-5 w-5 shrink-0 text-blue-300" />
                  <p className="text-zinc-300">
                    Ideal para eventos de uno o varios días.
                  </p>
                </div>

                <div className="flex gap-3">
                  <Flag className="mt-1 h-5 w-5 shrink-0 text-pink-300" />
                  <p className="text-zinc-300">
                    Se pueden crear rankings, desafíos y premios.
                  </p>
                </div>

                <div className="flex gap-3">
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-pink-300" />
                  <p className="text-zinc-300">
                    Adaptable a espacios cerrados, stands o acciones especiales.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="relative min-h-[280px] overflow-hidden rounded-[34px] border border-white/10">
                <Image
                  src="/sim-alquiler-1.jpg"
                  alt="Simuladores SIM"
                  fill
                  className="object-cover"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

                <div className="absolute bottom-5 left-5 right-5">
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-pink-300">
                    Empresas
                  </p>

                  <h3 className="mt-2 text-2xl font-black">
                    Activaciones de marca
                  </h3>
                </div>
              </div>

              <div className="relative min-h-[280px] overflow-hidden rounded-[34px] border border-white/10 md:translate-y-8">
                <Image
                  src="/sim-alquiler-2.jpg"
                  alt="Evento SIM"
                  fill
                  className="object-cover"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

                <div className="absolute bottom-5 left-5 right-5">
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-blue-300">
                    Consumidor final
                  </p>

                  <h3 className="mt-2 text-2xl font-black">
                    Eventos privados
                  </h3>
                </div>
              </div>

              <div className="relative min-h-[340px] overflow-hidden rounded-[34px] border border-white/10 md:col-span-2">
                <Image
                  src="/sim-alquiler-3.jpg"
                  alt="Colectivo SIM"
                  fill
                  className="object-cover"
                />

                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/30 to-transparent" />

                <div className="absolute bottom-5 left-5 max-w-md">
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-white">
                    Experiencia móvil
                  </p>

                  <h3 className="mt-2 max-w-xl text-3xl font-black leading-tight md:text-4xl">
  El colectivo SIM como punto de atracción
</h3>

                  <p className="mt-3 text-zinc-300">
                    Un formato pensado para que la experiencia viaje hacia el
                    público.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section className="px-4 py-10 md:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[36px] border border-white/10 bg-white/[0.03] p-6 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.45em] text-pink-400">
                Por qué SIM
              </p>

              <h2 className="mt-4 text-3xl font-black md:text-5xl">
                Mucho más que poner simuladores
              </h2>

              <p className="mt-5 leading-8 text-zinc-400">
                La diferencia está en cómo se presenta, cómo se comunica y cómo
                se convierte en una experiencia que la gente quiere probar,
                grabar y compartir.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {benefits.map((benefit) => (
                <div
                  key={benefit}
                  className="flex gap-3 rounded-3xl border border-white/10 bg-black/40 p-5"
                >
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-blue-300" />

                  <p className="leading-7 text-zinc-300">{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}