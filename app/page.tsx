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
  Mail,
  Phone,
  Instagram,
  Music2,
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

function SectionEyebrow({
  children,
}: {
  children: React.ReactNode;
}) {
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

      <div className="text-3xl font-black md:text-4xl">
        {value}
      </div>

      <p className="mt-2 text-zinc-400">
        {text}
      </p>
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
              Ofrecer una experiencia de simulación inspirada en la Fórmula 1 que combine emoción, estética y tecnología.
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
              Posicionar a SIM como una propuesta fuerte, escalable y reconocible.
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
          La experiencia SIM
        </h2>

        <p className="mt-2 text-zinc-400">
          Una propuesta visual pensada para impactar.
        </p>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-5 shadow-xl">
        <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-4">
            <div className="relative min-h-[220px] overflow-hidden rounded-[24px] border border-white/10">
              <Image
                src="/sim-home-3.jpg"
                alt="SIM"
                fill
                className="object-cover"
              />
            </div>

            <div className="relative min-h-[220px] overflow-hidden rounded-[24px] border border-white/10">
              <Image
                src="/sim-home-11.jpg"
                alt="SIM"
                fill
                className="object-cover"
              />
            </div>
          </div>

          <div className="relative min-h-[460px] overflow-hidden rounded-[24px] border border-white/10">
            <Image
              src="/sim-home-2.jpg"
              alt="SIM"
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
                  Más que un simulador.
                </h3>

                <p className="mt-3 leading-7 text-zinc-300">
                  Velocidad, estética y universo F1 en una propuesta diseñada para impactar.
                </p>
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
      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/90 p-6 shadow-xl md:p-8">
        <div className="mb-6">
          <SectionEyebrow>Contacto</SectionEyebrow>

          <h2 className="mt-4 text-3xl font-black md:text-5xl">
            Hablemos de SIM
          </h2>

          <p className="mt-3 max-w-2xl text-zinc-400">
            Consultas, reservas, eventos o propuestas comerciales.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <a
            href="mailto:sim.cafe.racer@gmail.com"
            className="rounded-[24px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40 hover:bg-black/60"
          >
            <div className="mb-4 inline-flex rounded-2xl bg-red-950/70 p-3 text-red-400">
              <Mail className="h-5 w-5" />
            </div>

            <h3 className="text-lg font-bold text-white">
              Mail
            </h3>

            <p className="mt-2 break-words text-zinc-400">
              sim.cafe.racer@gmail.com
            </p>
          </a>

          <a
            href="https://wa.me/5493512520927"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[24px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40 hover:bg-black/60"
          >
            <div className="mb-4 inline-flex rounded-2xl bg-red-950/70 p-3 text-red-400">
              <Phone className="h-5 w-5" />
            </div>

            <h3 className="text-lg font-bold text-white">
              WhatsApp
            </h3>

            <p className="mt-2 text-zinc-400">
              3512520927
            </p>
          </a>

          <a
            href="https://www.instagram.com/sim_argentina"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[24px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40 hover:bg-black/60"
          >
            <div className="mb-4 inline-flex rounded-2xl bg-red-950/70 p-3 text-red-400">
              <Instagram className="h-5 w-5" />
            </div>

            <h3 className="text-lg font-bold text-white">
              Instagram
            </h3>

            <p className="mt-2 text-zinc-400">
              @sim_argentina
            </p>
          </a>

          <a
            href="https://www.tiktok.com/@sim_argentina"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[24px] border border-white/10 bg-black/40 p-5 transition hover:border-red-500/40 hover:bg-black/60"
          >
            <div className="mb-4 inline-flex rounded-2xl bg-red-950/70 p-3 text-red-400">
              <Music2 className="h-5 w-5" />
            </div>

            <h3 className="text-lg font-bold text-white">
              TikTok
            </h3>

            <p className="mt-2 text-zinc-400">
              @sim_argentina
            </p>
          </a>
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
              <SectionEyebrow>
                Experiencia SIM
              </SectionEyebrow>

              <h1 className="mt-4 max-w-4xl text-4xl font-black leading-tight md:text-6xl">
                La experiencia más cercana a manejar un Fórmula 1
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-300 md:text-xl">
                SIM Argentina mezcla adrenalina, estética y competencia para transformar un turno en algo mucho más grande.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <PrimaryLink href="/reservas">
                  Reservar ahora
                </PrimaryLink>
              </div>
            </div>

            <div className="grid gap-4 self-start sm:grid-cols-2">
              <HeroStat
                icon={Gauge}
                label="Intensidad"
                value="F1"
                text="Experiencia inspirada en el automovilismo"
              />

              <HeroStat
                icon={Clock3}
                label="Turnos"
                value="15 min"
                text="Experiencias ágiles y dinámicas"
              />

              <HeroStat
                icon={Flag}
                label="Ubicación"
                value="NC"
                text="Nuevo Centro Shopping"
              />

              <HeroStat
                icon={Users}
                label="Formato"
                value="Eventos"
                text="También adaptable a marcas"
              />
            </div>
          </div>
        </div>

        <MissionVisionValuesSection />
        <CollageSection />
        <ContactSection />
      </section>
    </main>
  );
}