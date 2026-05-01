import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CarFront,
  Flag,
  Gauge,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Clock3,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
};

type Feature = {
  title: string;
  text: string;
  icon: React.ElementType;
};

const navItems: NavItem[] = [
  { label: "Inicio", href: "/" },
  { label: "Reserva", href: "/reservas" },
  { label: "Alquiler", href: "/alquiler" },
  { label: "Viaja con SIM", href: "/viaja-con-sim" },
  { label: "Novedades", href: "/novedades" },
  { label: "Sobre nosotros", href: "/sobre-nosotros" },
  { label: "Tienda", href: "/tienda" },
];

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

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-4">
          <Image
            src="/sim-logo.jpg"
            alt="Logo SIM"
            width={140}
            height={140}
            className="h-16 w-16 rounded-md object-contain"
            priority
          />

          <div className="flex flex-col justify-center leading-tight">
            <div className="text-xs font-black uppercase tracking-[0.35em] text-red-500">
              SIM ARGENTINA
            </div>
            <div className="mt-1 text-sm text-zinc-400">
              Simuladores de Fórmula 1
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap text-sm font-bold uppercase tracking-[0.08em] text-zinc-300 transition hover:text-white",
                item.href === "/" ? "text-white" : ""
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

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
      className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-4 text-sm font-black text-white transition hover:bg-red-500"
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
              Ofrecer una experiencia de simulación inspirada en la Fórmula 1 que
              combine emoción, estética, tecnología y atención al detalle para que
              cada persona sienta que está entrando en algo especial.
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
                  Ser una marca referente en experiencias de sim racing
                </div>
              </div>
            </div>

            <p className="leading-8 text-zinc-400">
              Posicionar a SIM como una propuesta fuerte, reconocible y escalable,
              capaz de crecer en shoppings, eventos, activaciones y nuevos formatos
              sin perder identidad ni impacto.
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
                  Intensidad, identidad y exigencia
                </div>
              </div>
            </div>

            <ul className="space-y-3 text-zinc-400">
              <li>• Pasión por el automovilismo y la experiencia.</li>
              <li>• Búsqueda constante de impacto visual.</li>
              <li>• Calidad en cada detalle de la propuesta.</li>
              <li>• Innovación para crecer sin volverse genérico.</li>
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
          La experiencia SIM
        </h2>
        <p className="mt-2 text-zinc-400">
          Una propuesta visual pensada para impactar antes, durante y después.
        </p>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-4">
            <div className="relative min-h-[220px] overflow-hidden rounded-[24px] border border-white/10">
              <Image
                src="/sim-home-3.jpg"
                alt="Visual SIM Argentina"
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            </div>

            <div className="relative min-h-[220px] overflow-hidden rounded-[24px] border border-white/10">
              <Image
                src="/sim-home-11.jpg"
                alt="Competencia en SIM"
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            </div>
          </div>

          <div className="relative min-h-[460px] overflow-hidden rounded-[24px] border border-white/10">
            <Image
              src="/sim-home-2.jpg"
              alt="Experiencia principal SIM"
              fill
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

            <div className="absolute bottom-0 left-0 right-0 p-6">
              <div className="max-w-md rounded-[22px] border border-white/10 bg-black/55 p-5 backdrop-blur-md">
                <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500">
                  SIM Argentina
                </p>
                <h3 className="mt-3 text-2xl font-black md:text-3xl">
                  Más que un simulador. Una experiencia con identidad.
                </h3>
                <p className="mt-3 leading-7 text-zinc-300">
                  Velocidad, estética, tensión y universo F1 en una propuesta pensada
                  para sentirse especial desde el primer segundo.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar />

      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-r from-red-950/40 via-zinc-950 to-zinc-900">
          <div className="grid gap-8 p-6 md:p-10 lg:grid-cols-[1.5fr_0.9fr]">
            <div>
              <SectionEyebrow>Experiencia SIM</SectionEyebrow>

              <h1 className="mt-4 max-w-4xl text-4xl font-black leading-tight md:text-6xl">
                La experiencia más cercana a manejar un Fórmula 1
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-300 md:text-xl">
                SIM Argentina mezcla adrenalina, estética, competencia y tecnología
                para transformar un turno en algo mucho más grande. No venís solo a
                sentarte en un simulador: venís a vivir la experiencia.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Simuladores F1
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Experiencia inmersiva
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Nuevo Centro Shopping
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200">
                  Turnos online
                </div>
                <div className="rounded-full border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-300">
                  Universo F1
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-4">
                <PrimaryLink href="/reservas">Reservar ahora</PrimaryLink>

                <Link
                  href="/sobre-nosotros"
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                >
                  Conocer SIM
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="grid gap-4 self-start sm:grid-cols-2">
              <HeroStat
                icon={Gauge}
                label="Intensidad"
                value="F1"
                text="Una propuesta visual y competitiva inspirada en el automovilismo"
              />
              <HeroStat
                icon={Clock3}
                label="Turnos"
                value="15 min"
                text="Experiencias ágiles, dinámicas y pensadas para máxima rotación"
              />
              <HeroStat
                icon={Flag}
                label="Ubicación"
                value="NC"
                text="Stand actual en Nuevo Centro Shopping"
              />
              <HeroStat
                icon={Users}
                label="Formato"
                value="Eventos"
                text="También adaptable a marcas, empresas y activaciones"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.45fr_0.95fr]">
          <section>
            <div className="mb-5">
              <h2 className="text-2xl font-black md:text-4xl">
                Qué es SIM Argentina
              </h2>
              <p className="mt-2 text-zinc-400">
                Una marca pensada para que la experiencia tenga peso propio.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
              <div className="grid gap-5 md:grid-cols-2">
                <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Experiencia
                      </div>
                      <div className="text-lg font-bold text-white">
                        No es solo entretenimiento
                      </div>
                    </div>
                  </div>

                  <p className="leading-8 text-zinc-400">
                    SIM busca que la persona no vea “un juego”, sino una experiencia
                    especial, distinta y digna de probar.
                  </p>
                </article>

                <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Identidad
                      </div>
                      <div className="text-lg font-bold text-white">
                        Una marca con lenguaje propio
                      </div>
                    </div>
                  </div>

                  <p className="leading-8 text-zinc-400">
                    La estética, la temática F1 y la forma de comunicar construyen un
                    universo reconocible y con personalidad.
                  </p>
                </article>

                <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <CarFront className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Escala
                      </div>
                      <div className="text-lg font-bold text-white">
                        Un concepto adaptable
                      </div>
                    </div>
                  </div>

                  <p className="leading-8 text-zinc-400">
                    Puede vivir en un shopping, una activación de marca, un evento
                    privado o una propuesta itinerante.
                  </p>
                </article>

                <article className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                      <Trophy className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">
                        Impacto
                      </div>
                      <div className="text-lg font-bold text-white">
                        Diseñada para recordarse
                      </div>
                    </div>
                  </div>

                  <p className="leading-8 text-zinc-400">
                    La experiencia tiene valor mientras se vive, pero también después:
                    en el recuerdo, en la conversación y en el contenido que genera.
                  </p>
                </article>
              </div>
            </div>
          </section>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[30px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl">
              <div className="relative overflow-hidden rounded-[24px] border border-white/10">
                <div className="relative h-[220px]">
                  <Image
                    src="/sim-home-2.jpg"
                    alt="SIM Argentina"
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500">
                      SIM Argentina
                    </p>
                    <h3 className="mt-2 text-2xl font-black">
                      Corré. Competí. Volvé a intentarlo.
                    </h3>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-red-500/30 bg-gradient-to-b from-red-950/50 to-red-950/20 p-5">
                <div className="mb-4 text-lg font-medium">En este momento</div>

                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between gap-4 text-zinc-200">
                    <span>Ubicación</span>
                    <span className="text-right">Nuevo Centro</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Modalidad</span>
                    <span>Turnos online</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Enfoque</span>
                    <span>F1 y adrenalina</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Siguiente paso</span>
                    <span>Reservar</span>
                  </div>
                </div>

                <div className="my-4 h-px bg-white/10" />

                <div className="text-sm leading-7 text-zinc-300">
                  Entrá a la sección de reservas y elegí fecha, horario y escudería
                  para vivir la experiencia SIM.
                </div>
              </div>

              <div className="mt-5">
                <PrimaryLink href="/reservas">Ir a reservas</PrimaryLink>
              </div>
            </div>
          </aside>
        </div>

        <section className="mt-8">
          <div className="mb-5">
            <h2 className="text-2xl font-black md:text-4xl">
              Por qué elegir SIM
            </h2>
            <p className="mt-2 text-zinc-400">
              Identidad, potencia visual y una propuesta distinta.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
            <div className="grid gap-5 md:grid-cols-2">
              {features.map((item) => {
                const Icon = item.icon;

                return (
                  <article
                    key={item.title}
                    className="rounded-[24px] border border-white/10 bg-black/40 p-5"
                  >
                    <div className="mb-4 flex items-start gap-3">
                      <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
                        <Icon className="h-5 w-5" />
                      </div>

                      <div>
                        <div className="text-lg font-bold text-white">
                          {item.title}
                        </div>
                        <p className="mt-2 leading-8 text-zinc-400">
                          {item.text}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <MissionVisionValuesSection />
        <CollageSection />

        <section className="mt-8">
          <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-r from-red-950/40 via-zinc-950 to-zinc-900">
            <div className="grid gap-8 p-6 md:p-10 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <SectionEyebrow>SIM Argentina</SectionEyebrow>

                <h2 className="mt-4 max-w-3xl text-3xl font-black leading-tight md:text-5xl">
                  Una marca pensada para que la experiencia tenga peso propio
                </h2>

                <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-300 md:text-xl">
                  SIM no vive solo en una página de reservas. Vive en la estética,
                  en la experiencia, en la posibilidad de competir y en su potencial
                  para crecer como propuesta comercial.
                </p>

                <div className="mt-8 flex flex-wrap gap-4">
                  <PrimaryLink href="/reservas">Reservá tu turno</PrimaryLink>

                  <Link
                    href="/alquiler"
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    Ver alquiler
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                <div className="space-y-4">
                  <Link
                    href="/reservas"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span>Reservas</span>
                    <ArrowRight className="h-4 w-4 text-red-400" />
                  </Link>

                  <Link
                    href="/alquiler"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span>Alquiler</span>
                    <ArrowRight className="h-4 w-4 text-red-400" />
                  </Link>

                  <Link
                    href="/viaja-con-sim"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span>Viaja con SIM</span>
                    <ArrowRight className="h-4 w-4 text-red-400" />
                  </Link>

                  <Link
                    href="/sobre-nosotros"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span>Sobre nosotros</span>
                    <ArrowRight className="h-4 w-4 text-red-400" />
                  </Link>

                  <Link
                    href="/novedades"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span>Novedades</span>
                    <ArrowRight className="h-4 w-4 text-red-400" />
                  </Link>

                  <Link
                    href="/tienda"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span>Tienda</span>
                    <ArrowRight className="h-4 w-4 text-red-400" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}