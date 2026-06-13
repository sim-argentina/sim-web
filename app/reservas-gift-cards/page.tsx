import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  Clock3,
  Flag,
  CalendarCheck,
  Download,
  ShoppingCart,
  ArrowRight,
} from "lucide-react";

type Stat = { icon: React.ReactNode; label: string; value: string };

function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-5">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="mb-1.5 flex items-center gap-1.5 text-red-500">
            {s.icon}
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400">
              {s.label}
            </span>
          </div>
          <div className="text-xl font-black leading-none text-white md:text-2xl">
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
  title,
  subtitle,
  stats,
  cta,
  priority,
}: {
  href: string;
  image: string;
  imageAlt: string;
  badge: string;
  title: string;
  subtitle: string;
  stats: Stat[];
  cta: string;
  priority?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[460px] flex-col overflow-hidden rounded-[28px] border border-white/10 transition-all duration-300 hover:border-red-500/50 hover:shadow-[0_0_40px_rgba(239,68,68,0.15)] md:min-h-[520px]"
    >
      {/* Imagen de fondo */}
      <Image
        src={image}
        alt={imageAlt}
        fill
        priority={priority}
        sizes="(max-width: 768px) 100vw, 50vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
      />
      {/* Degradados para legibilidad */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
      <div className="absolute inset-0 bg-gradient-to-br from-red-950/30 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      {/* Esquina superior con acento rojo */}
      <div className="pointer-events-none absolute right-5 top-5 h-14 w-14 rounded-tr-2xl border-r-2 border-t-2 border-red-600/80" />

      {/* Contenido */}
      <div className="relative mt-auto p-7 md:p-8">
        <span className="mb-4 inline-flex items-center rounded-full bg-red-600 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">
          {badge}
        </span>

        <h2 className="text-3xl font-black uppercase leading-none text-white md:text-4xl">
          {title}
        </h2>
        <p className="mt-2 text-sm font-medium uppercase tracking-wide text-zinc-400 md:text-base">
          {subtitle}
        </p>

        <div className="mt-6">
          <StatRow stats={stats} />
        </div>

        <div className="mt-7 flex items-center justify-between rounded-2xl bg-white/[0.06] px-5 py-4 backdrop-blur-sm transition-colors group-hover:bg-red-600">
          <span className="text-sm font-black uppercase tracking-widest text-white">
            {cta}
          </span>
          <ArrowRight className="h-5 w-5 text-white transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  );
}

export default function ReservasGiftCardsPage() {
  const iconCls = "h-3.5 w-3.5";

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20 lg:px-8">
        {/* Hero */}
        <div className="text-center">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.5em] text-red-500">
            SIM Argentina
          </p>
          <h1 className="text-4xl font-black uppercase leading-[0.95] md:text-7xl">
            Acelerá tu <span className="text-red-600">adrenalina</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            Reservá tu experiencia en pista o regalá un día inolvidable al
            volante de un simulador profesional de Fórmula 1.
          </p>
        </div>

        {/* Cards */}
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <ExperienceCard
            href="/reservas"
            image="/sim-hero.jpg"
            imageAlt="Cockpit de simulador SIM Argentina"
            badge="Reservá tu turno"
            title="Reservar experiencia"
            subtitle="Viví la pista en primera persona"
            priority
            stats={[
              { icon: <CalendarDays className={iconCls} />, label: "Disponible", value: "15 días" },
              { icon: <Clock3 className={iconCls} />, label: "Duración", value: "15 / 30" },
              { icon: <Flag className={iconCls} />, label: "Pilotos", value: "1-4" },
            ]}
            cta="Reservar ahora"
          />

          <ExperienceCard
            href="/gift-cards"
            image="/sim-home-2.jpg"
            imageAlt="Experiencia de manejo en simulador SIM Argentina"
            badge="Gift Card"
            title="Regalá adrenalina"
            subtitle="El regalo perfecto para fanáticos"
            stats={[
              { icon: <CalendarCheck className={iconCls} />, label: "Validez", value: "30 días" },
              { icon: <Download className={iconCls} />, label: "Entrega", value: "Digital" },
              { icon: <ShoppingCart className={iconCls} />, label: "Desde", value: "$12K" },
            ]}
            cta="Comprar Gift Card"
          />
        </div>
      </section>
    </main>
  );
}
