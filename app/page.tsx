import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  CarFront,
  Clock3,
  Flag,
  Gauge,
  Mail,
  MapPin,
  Music2,
  Phone,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";

type Feature = {
  title: string;
  text: string;
  icon: React.ElementType;
};

const features: Feature[] = [
  {
    title: "Experiencia inmersiva",
    text: "SIM está pensada para que la experiencia se sienta intensa desde el primer vistazo hasta que termina la vuelta.",
    icon: Sparkles,
  },
  {
    title: "Universo F1",
    text: "La estética, el lenguaje y la propuesta giran alrededor del automovilismo y la fantasía de sentirse piloto.",
    icon: Flag,
  },
  {
    title: "Ideal para eventos",
    text: "La experiencia también se adapta a activaciones, empresas, marcas y formatos especiales.",
    icon: Users,
  },
  {
    title: "Propuesta diferencial",
    text: "No compite solo por entretenimiento. Compite por impacto, recordación y potencia visual.",
    icon: Trophy,
  },
];

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-[0.45em] text-red-500">
      {children}
    </p>
  );
}

function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-4 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:bg-red-500"
    >
      {children}
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function HeroStat({
  icon: Icon,
  label,
  value,
  text,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  text: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="mb-3 flex items-center gap-2 text-red-400">
        <Icon className="h-4 w-4" />
        <span className="text-sm">{label}</span>
      </div>

      <div className="text-3xl font-black md:text-4xl">{value}</div>

      <p className="mt-2 text-zinc-400">{text}</p>
    </div>
  );
}

function MissionVisionValuesSection() {
  return (
    <section className="mt-8">
      <div className="mb-5">
        <h2 className="text-2xl font-black md:text-4xl">
          Misión, visión y valores
        </h2>

        <p className="mt-2 text-zinc-400">
          La base conceptual que sostiene la experiencia SIM.
        </p>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <div className="grid gap-5 lg:grid-cols-3">
          <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                <Flag className="h-5 w-5" />
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                  Misión
                </div>

                <div className="text-lg font-bold text-white">
                  Hacer que la adrenalina se viva de verdad
                </div>
              </div>
            </div>

            <p className="leading-8 text-zinc-400">
              Ofrecer una experiencia de simulación inspirada en la Fórmula 1
              que combine emoción, estética, competencia y tecnología.
            </p>
          </article>

          <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                <Gauge className="h-5 w-5" />
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                  Visión
                </div>

                <div className="text-lg font-bold text-white">
                  Ser referentes en sim racing
                </div>
              </div>
            </div>

            <p className="leading-8 text-zinc-400">
              Posicionar a SIM como una propuesta fuerte, escalable y reconocible
              dentro del entretenimiento, los eventos y el automovilismo.
            </p>
          </article>

          <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                <ShieldCheck className="h-5 w-5" />
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                  Valores
                </div>

                <div className="text-lg font-bold text-white">
                  Intensidad e identidad
                </div>
              </div>
            </div>

            <ul className="space-y-3 text-zinc-400">
              <li>• Pasión por el automovilismo.</li>
              <li>• Impacto visual.</li>
              <li>• Calidad en la experiencia.</li>
              <li>• Innovación constante.</li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

function CollageSection() {
  return (
    <section className="mt-8">
      <div className="mb-5">
        <h2 className="text-2xl font-black md:text-4xl">
          Una experiencia para mirar, manejar y compartir
        </h2>

        <p className="mt-2 text-zinc-400">
          Cada simulador está pensado para que la experiencia sea visual,
          competitiva y memorable.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative min-h-[520px] overflow-hidden rounded-[34px] border border-white/10 bg-zinc-950">
          <Image
            src="/sim-home-1.jpg"
            alt="Simuladores SIM Argentina"
            fill
            className="object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

          <div className="absolute bottom-6 left-6 right-6 rounded-[26px] border border-white/10 bg-black/55 p-6 backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-red-500">
              Sim Racing
            </p>

            <h3 className="mt-3 text-3xl font-black md:text-4xl">
              Viví la sensación de estar en pista
            </h3>

            <p className="mt-3 max-w-2xl leading-8 text-zinc-300">
              La propuesta combina simuladores, ambientación, competencia y una
              estética pensada para conectar con fanáticos de la Fórmula 1.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <div className="relative min-h-[250px] overflow-hidden rounded-[34px] border border-white/10 bg-zinc-950">
            <Image
              src="/sim-home-2.jpg"
              alt="Experiencia SIM"
              fill
              className="object-cover"
            />

            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />

            <div className="absolute bottom-5 left-5 right-5">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
                Competencia
              </p>
              <h3 className="mt-2 text-2xl font-black">
                Desafíos, tiempos y rankings
              </h3>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="relative min-h-[250px] overflow-hidden rounded-[34px] border border-white/10 bg-zinc-950">
              <Image
                src="/sim-home-3.jpg"
                alt="Simulador SIM"
                fill
                className="object-cover"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

              <div className="absolute bottom-5 left-5 right-5">
                <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
                  F1
                </p>
                <h3 className="mt-2 text-xl font-black">Adrenalina</h3>
              </div>
            </div>

            <div className="relative min-h-[250px] overflow-hidden rounded-[34px] border border-white/10 bg-zinc-950">
              <Image
                src="/sim-home-4.jpg"
                alt="SIM Argentina"
                fill
                className="object-cover"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

              <div className="absolute bottom-5 left-5 right-5">
                <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
                  Eventos
                </p>
                <h3 className="mt-2 text-xl font-black">Impacto visual</h3>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section className="mt-8">
      <div className="rounded-[34px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl md:p-8">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <SectionEyebrow>Contacto</SectionEyebrow>

            <h2 className="mt-4 text-3xl font-black md:text-5xl">
              Hablemos de tu próxima experiencia SIM
            </h2>

            <p className="mt-5 leading-8 text-zinc-400">
              Consultas por turnos, eventos, alquiler de simuladores, acciones
              para empresas o propuestas especiales.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <a
              href="mailto:sim.cafe.racer@gmail.com"
              className="rounded-[26px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40"
            >
              <Mail className="mb-4 h-6 w-6 text-red-400" />
              <div className="text-sm uppercase tracking-[0.25em] text-zinc-500">
                Mail
              </div>
              <div className="mt-2 font-bold text-white">
                sim.cafe.racer@gmail.com
              </div>
            </a>

            <a
              href="https://wa.me/5493512520927"
              target="_blank"
              className="rounded-[26px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40"
            >
              <Phone className="mb-4 h-6 w-6 text-red-400" />
              <div className="text-sm uppercase tracking-[0.25em] text-zinc-500">
                Teléfono
              </div>
              <div className="mt-2 font-bold text-white">3512520927</div>
            </a>

            <a
              href="https://www.instagram.com/sim_argentina"
              target="_blank"
              className="rounded-[26px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40"
            >
              <Camera className="mb-4 h-6 w-6 text-red-400" />
              <div className="text-sm uppercase tracking-[0.25em] text-zinc-500">
                Instagram
              </div>
              <div className="mt-2 font-bold text-white">@sim_argentina</div>
            </a>

            <a
              href="https://www.tiktok.com/@sim_argentina"
              target="_blank"
              className="rounded-[26px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40"
            >
              <Music2 className="mb-4 h-6 w-6 text-red-400" />
              <div className="text-sm uppercase tracking-[0.25em] text-zinc-500">
                TikTok
              </div>
              <div className="mt-2 font-bold text-white">@sim_argentina</div>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-r from-red-950/40 via-zinc-950 to-zinc-900">
          <div className="grid gap-8 p-6 md:p-10 lg:grid-cols-[1.5fr_0.9fr] lg:p-12">
            <div>
              <SectionEyebrow>Experiencia SIM</SectionEyebrow>

              <h1 className="mt-6 max-w-4xl text-5xl font-black leading-tight md:text-7xl">
                La experiencia más cercana a manejar un Fórmula 1
              </h1>

              <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-300">
                SIM Argentina mezcla adrenalina, estética y competencia para
                transformar un turno en algo mucho más grande.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <PrimaryLink href="/reservas">Reservar turno</PrimaryLink>

                <Link
                  href="/alquiler"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/10"
                >
                  Alquiler para eventos
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <HeroStat
                icon={Gauge}
                label="Intensidad"
                value="F1"
                text="Experiencia inspirada en el automovilismo."
              />

              <HeroStat
                icon={Clock3}
                label="Turnos"
                value="15 min"
                text="Experiencias ágiles y dinámicas."
              />

              <HeroStat
                icon={Flag}
                label="Ubicación"
                value="NC"
                text="Nuevo Centro Shopping."
              />

              <HeroStat
                icon={Users}
                label="Formato"
                value="Eventos"
                text="También adaptable a marcas."
              />
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <article
                key={feature.title}
                className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl transition hover:-translate-y-1 hover:border-red-500/40"
              >
                <div className="mb-5 inline-flex rounded-2xl bg-red-950/70 p-3 text-red-400">
                  <Icon className="h-6 w-6" />
                </div>

                <h3 className="text-xl font-black">{feature.title}</h3>

                <p className="mt-3 leading-7 text-zinc-400">
                  {feature.text}
                </p>
              </article>
            );
          })}
        </section>

        <CollageSection />

        <MissionVisionValuesSection />

        <section className="mt-8">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[34px] border border-white/10 bg-zinc-950/80 p-6 md:p-8">
              <SectionEyebrow>Nuevo Centro Shopping</SectionEyebrow>

              <h2 className="mt-4 text-3xl font-black md:text-5xl">
                Vení a competir, probar y vivir la experiencia
              </h2>

              <p className="mt-5 leading-8 text-zinc-400">
                SIM está pensado para quienes aman la Fórmula 1, para quienes
                quieren probar algo distinto y para quienes buscan una
                experiencia corta, intensa y memorable.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                  <CarFront className="mb-3 h-6 w-6 text-red-400" />
                  <h3 className="font-black">Simuladores F1</h3>
                  <p className="mt-2 text-zinc-400">
                    Experiencia visual, competitiva y dinámica.
                  </p>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                  <Camera className="mb-3 h-6 w-6 text-red-400" />
                  <h3 className="font-black">Contenido para redes</h3>
                  <p className="mt-2 text-zinc-400">
                    Ideal para grabar, compartir y desafiar amigos.
                  </p>
                </div>
              </div>
            </div>

            <div className="relative min-h-[420px] overflow-hidden rounded-[34px] border border-white/10 bg-zinc-950">
              <Image
                src="/sim-home-5.jpg"
                alt="SIM Argentina en Nuevo Centro Shopping"
                fill
                className="object-cover"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />

              <div className="absolute bottom-6 left-6 right-6 rounded-[26px] border border-white/10 bg-black/55 p-6 backdrop-blur">
                <div className="flex items-center gap-3 text-red-400">
                  <MapPin className="h-5 w-5" />
                  <p className="text-xs font-black uppercase tracking-[0.3em]">
                    Ubicación
                  </p>
                </div>

                <h3 className="mt-3 text-3xl font-black">
                  Nuevo Centro Shopping
                </h3>

                <p className="mt-3 text-zinc-300">
                  La experiencia SIM disponible para vivirla en persona.
                </p>
              </div>
            </div>
          </div>
        </section>

        <ContactSection />
      </section>
    </main>
  );
}