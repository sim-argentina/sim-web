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
import { mensualidadesHabilitadas } from "@/lib/featureFlags";

// Pantalla selectora pública "Viví SIM". Antes vivía en /reservas-gift-cards
// (esa ruta ahora redirige acá con 308 desde next.config.ts). La card de
// Mensualidades solo se renderiza si MENSUALIDADES_ENABLED === "true" en el
// servidor: sin la variable, la pantalla es exactamente la de siempre.
//
// La flag se evalúa por request (no en build) gracias a force-dynamic, así que
// activarla en Vercel no necesita un redeploy.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Viví SIM — Reservá o regalá simuladores de F1 en Córdoba",
  description:
    "Elegí tu experiencia SIM Argentina: reservá tu turno en los simuladores de F1 o regalá una gift card. Simuladores profesionales en Nuevo Centro Shopping, Córdoba.",
  path: "/vivi-sim",
});

type Stat = { icon: React.ReactNode; label: string; value: string };

// `compacto` = grilla de 3 cards: la columna de cada stat baja de ~157px a ~79px,
// así que los valores largos ($30.000) necesitan menos cuerpo y menos gutter para
// no desbordar. Con 2 cards queda exactamente como estaba en producción.
function StatRow({ stats, compacto }: { stats: Stat[]; compacto: boolean }) {
  const pad = compacto ? "px-3 lg:px-2" : "px-3";
  const label = compacto
    ? "text-[9px] md:text-[10px] lg:text-[9px]"
    : "text-[9px] md:text-[10px]";
  const valor = compacto
    ? "text-lg md:text-2xl lg:text-base xl:text-lg"
    : "text-lg md:text-2xl";

  return (
    <div className="grid grid-cols-3 divide-x divide-white/10">
      {stats.map((s) => (
        <div key={s.label} className={`${pad} first:pl-0 last:pr-0`}>
          <div className="mb-2 flex items-center gap-1.5 text-red-500">
            {s.icon}
            <span className={`font-black uppercase tracking-[0.12em] text-zinc-500 ${label}`}>
              {s.label}
            </span>
          </div>
          <div className={`font-black leading-none text-white ${valor}`}>
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
  titleClass,
  subtitle,
  stats,
  compacto,
  cta,
  ctaVariant,
  priority,
}: {
  href: string;
  image: string;
  imageAlt: string;
  badge: string;
  title: string;
  titleClass: string;
  subtitle: string;
  stats: Stat[];
  compacto: boolean;
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
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
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
        <h2
          className={`bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text font-black uppercase italic leading-[0.84] tracking-tight text-transparent drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] [overflow-wrap:anywhere] ${titleClass}`}
        >
          {title}
        </h2>

        {/* flex-1: la descripción absorbe la diferencia de largo entre cards, así
            los stats y el CTA quedan siempre a la misma altura en las tres. */}
        <div className="mt-3 flex flex-1 items-start gap-2">
          <span className="mt-[3px] h-4 w-[3px] shrink-0 -skew-x-[20deg] bg-red-600" />
          {/* min-h de 3 líneas: apiladas en móvil las tres cards quedan de la
              misma altura aunque las descripciones tengan largos distintos. */}
          <p className="min-h-[3lh] text-xs font-bold uppercase tracking-[0.12em] text-zinc-400 md:text-sm">
            {subtitle}
          </p>
        </div>

        <div className="my-5 h-px bg-white/10" />

        <StatRow stats={stats} compacto={compacto} />

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
          <ArrowRight className="h-5 w-5 shrink-0 text-white transition-transform duration-300 group-hover:translate-x-1.5" />
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

export default function ViviSimPage() {
  const iconCls = "h-3.5 w-3.5";
  const conMensualidades = mensualidadesHabilitadas();

  // Con las tres opciones visibles la grilla pasa a 3 columnas en lg (nunca deja
  // una card huérfana en una fila) y el título baja de escala en los anchos donde
  // la card es angosta: "Mensualidades" es una sola palabra y no puede partirse.
  const grid = conMensualidades ? "lg:grid-cols-3" : "md:grid-cols-2";
  // Medido sobre la tipografía real: "Mensualidades" ocupa ~9.26× el font-size.
  // Los tamaños de abajo lo dejan siempre en una línea (320px: 24px→222 de 240
  // disponibles · lg 1024: 24px→222 de 238 · xl: 28px→259 de 284).
  const tituloCls = conMensualidades
    ? "text-2xl sm:text-4xl md:text-5xl lg:text-2xl xl:text-[1.75rem]"
    : "text-4xl md:text-5xl";

  // Con las tres cards, todas comparten el mismo destaque (ninguna domina). Con
  // solo dos se conserva la jerarquía que ya tiene producción.
  const variante = (actual: "primary" | "secondary"): "primary" | "secondary" =>
    conMensualidades ? "primary" : actual;

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
            Viví <span className="text-red-600">SIM</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            {conMensualidades
              ? "Reservá tu experiencia en pista, comprá horas por adelantado o regalá un día inolvidable al volante de un simulador profesional de Fórmula 1."
              : "Reservá tu experiencia en pista o regalá un día inolvidable al volante de un simulador profesional de Fórmula 1."}
          </p>
        </div>

        {/* Cards */}
        <div className={`mt-12 grid items-stretch gap-6 ${grid} lg:gap-8`}>
          <ExperienceCard
            href="/reservas"
            image="/sim-hero.jpg"
            imageAlt="Cockpit de simulador SIM Argentina"
            badge="Experiencia F1"
            title="Reservas"
            titleClass={tituloCls}
            compacto={conMensualidades}
            subtitle="Viví la pista en primera persona"
            priority
            stats={[
              { icon: <Clock3 className={iconCls} />, label: "Duración", value: "15 / 30" },
              { icon: <Users className={iconCls} />, label: "Pilotos", value: "1-4" },
              { icon: <Zap className={iconCls} />, label: "Ranking", value: "En vivo" },
            ]}
            cta="Reservar ahora"
            ctaVariant={variante("primary")}
          />

          {conMensualidades && (
            <ExperienceCard
              href="/mensualidades"
              image="/sim-driver.jpg"
              imageAlt="Piloto en un simulador de SIM Argentina"
              badge="Plan prepago"
              title="Mensualidades"
              titleClass={tituloCls}
              compacto={conMensualidades}
              subtitle="Comprá horas, reservá cuando quieras y disfrutá SIM durante 30 días."
              stats={[
                { icon: <Clock3 className={iconCls} />, label: "Desde", value: "$30.000" },
                { icon: <CalendarCheck className={iconCls} />, label: "Validez", value: "30 días" },
                { icon: <Users className={iconCls} />, label: "Pilotos", value: "1-4" },
              ]}
              cta="Ver mensualidades"
              ctaVariant={variante("primary")}
            />
          )}

          <ExperienceCard
            href="/gift-cards"
            image="/sim-giftcard.jpg"
            imageAlt="Gift Card SIM Argentina"
            badge="Regalo digital"
            title="Gift Cards"
            titleClass={tituloCls}
            compacto={conMensualidades}
            subtitle="El regalo perfecto para fanáticos"
            stats={[
              { icon: <CalendarCheck className={iconCls} />, label: "Validez", value: "30 días" },
              { icon: <Download className={iconCls} />, label: "Entrega", value: "Digital" },
              { icon: <Gift className={iconCls} />, label: "Desde", value: "$12.000" },
            ]}
            cta="Comprar Gift Card"
            ctaVariant={variante("secondary")}
          />
        </div>
      </section>
    </main>
  );
}
