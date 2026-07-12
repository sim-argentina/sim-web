import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import Image from "next/image";
import {
  Clock3,
  Users,
  Zap,
  CalendarCheck,
  Download,
  Gift,
  ArrowRight,
} from "lucide-react";

export const metadata = pageMetadata({
  title: "Reservá o regalá simuladores de F1 en Córdoba",
  description:
    "Elegí tu experiencia SIM Argentina: reservá tu turno en los simuladores de F1 o regalá una gift card. Simuladores profesionales en Nuevo Centro Shopping, Córdoba.",
  path: "/reservas-gift-cards",
});

type Stat = { icon: React.ReactNode; label: string; value: string };

function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-white/10">
      {stats.map((s) => (
        <div key={s.label} className="px-3 first:pl-0 last:pr-0">
          <div className="mb-2 flex items-center gap-1.5 text-red-500">
            {s.icon}
            <span className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500 md:text-[10px]">
              {s.label}
            </span>
          </div>
          <div className="text-lg font-black leading-none text-white md:text-2xl">
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExperienceCard({
  href,
  image,
  imageAlt,
  badge,
  titleLines,
  subtitle,
  stats,
  cta,
  ctaVariant,
  priority,
}: {
  href: string;
  image: string;
  imageAlt: string;
  badge: string;
  titleLines: [string, string];
  subtitle: string;
  stats: Stat[];
  cta: string;
  ctaVariant: "primary" | "secondary";
  priority?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-[26px] border border-red-600/25 bg-[#0b0b0d] shadow-[0_30px_70px_-25px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.04] transition-all duration-500 hover:border-red-500/60 hover:shadow-[0_0_60px_-12px_rgba(239,68,68,0.4)]"
    >
      {/* ── Imagen poster ── */}
      <div className="relative h-[300px] overflow-hidden md:h-[360px]">
        <Image
          src={image}
          alt={imageAlt}
          fill
          priority={priority}
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.07]"
        />
        {/* Funde la imagen hacia el cuerpo de la card */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0d] via-[#0b0b0d]/55 to-transparent" />
        {/* Resplandor rojo sutil en hover */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(239,68,68,0.18),transparent_60%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        {/* Etiqueta roja + marcas de carrera */}
        <div className="absolute left-5 top-5 z-20 flex items-center gap-2">
          <span className="rounded-md bg-red-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-red-950/50">
            {badge}
          </span>
          <span className="flex gap-1">
            <span className="h-4 w-[3px] -skew-x-[20deg] bg-red-600/90" />
            <span className="h-4 w-[3px] -skew-x-[20deg] bg-red-600/50" />
          </span>
        </div>

        {/* Grilla de puntos decorativa */}
        <div
          className="pointer-events-none absolute right-4 top-16 h-16 w-24 opacity-50"
          style={{
            backgroundImage: "radial-gradient(rgba(239,68,68,0.7) 1.2px, transparent 1.2px)",
            backgroundSize: "9px 9px",
            maskImage: "linear-gradient(to top right, transparent, black)",
            WebkitMaskImage: "linear-gradient(to top right, transparent, black)",
          }}
        />
      </div>

      {/* ── Cuerpo ── */}
      <div className="relative z-10 -mt-16 flex flex-1 flex-col px-6 pb-6 md:px-7 md:pb-7">
        <h2 className="bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text text-4xl font-black uppercase italic leading-[0.84] tracking-tight text-transparent drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] md:text-5xl">
          {titleLines[0]}
          <br />
          {titleLines[1]}
        </h2>

        <div className="mt-3 flex items-center gap-2">
          <span className="h-4 w-[3px] -skew-x-[20deg] bg-red-600" />
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400 md:text-sm">
            {subtitle}
          </p>
        </div>

        <div className="my-5 h-px bg-white/10" />

        <StatRow stats={stats} />

        <div
          className={`mt-7 flex items-center justify-between rounded-2xl px-5 py-4 transition-all duration-300 ${
            ctaVariant === "primary"
              ? "bg-red-600 group-hover:bg-red-500"
              : "border border-red-600/40 bg-white/[0.03] group-hover:border-red-600 group-hover:bg-red-600"
          }`}
        >
          <span className="text-sm font-black uppercase tracking-[0.18em] text-white">
            {cta}
          </span>
          <ArrowRight className="h-5 w-5 text-white transition-transform duration-300 group-hover:translate-x-1.5" />
        </div>

        {/* Kerb / rayas de carrera en las esquinas inferiores */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-[10px] w-24 opacity-50"
          style={{ backgroundImage: "repeating-linear-gradient(-45deg, #ef4444 0 7px, transparent 7px 14px)" }}
        />
        <div
          className="pointer-events-none absolute bottom-0 right-0 h-[10px] w-24 opacity-50"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, #ef4444 0 7px, transparent 7px 14px)" }}
        />
      </div>
    </Link>
  );
}

export default function ReservasGiftCardsPage() {
  const iconCls = "h-3.5 w-3.5";

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Glow ambiental rojo de fondo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.14),transparent_65%)]" />

      <section className="relative mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20 lg:px-8">
        {/* Hero */}
        <div className="text-center">
          <p className="mb-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.5em] text-red-500">
            <span className="h-px w-6 bg-red-600" />
            SIM Argentina
            <span className="h-px w-6 bg-red-600" />
          </p>
          <h1 className="text-4xl font-black uppercase leading-[0.92] tracking-tight md:text-7xl">
            Acelerá tu <span className="text-red-600">adrenalina</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            Reservá tu experiencia en pista o regalá un día inolvidable al
            volante de un simulador profesional de Fórmula 1.
          </p>
        </div>

        {/* Cards */}
        <div className="mt-12 grid items-stretch gap-6 md:grid-cols-2 lg:gap-8">
          <ExperienceCard
            href="/reservas"
            image="/sim-hero.jpg"
            imageAlt="Cockpit de simulador SIM Argentina"
            badge="Experiencia F1"
            titleLines={["Reservar", "Experiencia"]}
            subtitle="Viví la pista en primera persona"
            priority
            stats={[
              { icon: <Clock3 className={iconCls} />, label: "Duración", value: "15 / 30" },
              { icon: <Users className={iconCls} />, label: "Pilotos", value: "1-4" },
              { icon: <Zap className={iconCls} />, label: "Ranking", value: "En vivo" },
            ]}
            cta="Reservar ahora"
            ctaVariant="primary"
          />

          <ExperienceCard
            href="/gift-cards"
            image="/sim-giftcard.jpg"
            imageAlt="Gift Card SIM Argentina"
            badge="Regalo digital"
            titleLines={["Regalá", "Adrenalina"]}
            subtitle="El regalo perfecto para fanáticos"
            stats={[
              { icon: <CalendarCheck className={iconCls} />, label: "Validez", value: "30 días" },
              { icon: <Download className={iconCls} />, label: "Entrega", value: "Digital" },
              { icon: <Gift className={iconCls} />, label: "Desde", value: "$12.000" },
            ]}
            cta="Comprar Gift Card"
            ctaVariant="secondary"
          />
        </div>
      </section>
    </main>
  );
}
