"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Trophy, Tag, Gift, Zap, Flag, ArrowRight, Star,
  CalendarDays, Clock, Megaphone, Sparkles,
} from "lucide-react";

type Novedad = {
  id: string;
  titulo: string;
  subtitulo: string | null;
  descripcion: string;
  categoria: string;
  tag: string | null;
  link: string | null;
  boton: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  created_at: string;
};

// ─── Datos de prueba (reemplazar por fetch a /api/novedades) ────────────────
const MOCK: Novedad[] = [
  {
    id: "1",
    titulo: "Gran Torneo SIM 2026",
    subtitulo: "Clasificación · Finales · Podio",
    descripcion:
      "La competencia más grande del año está llegando. Clasificación abierta, formato de eliminación directa y un podio con premios que ningún piloto va a querer perderse.",
    categoria: "torneo",
    tag: "PRÓXIMAMENTE",
    link: "https://www.instagram.com/sim_argentina",
    boton: "Seguir en Instagram",
    activo: true,
    destacado: true,
    orden: 0,
    fecha_inicio: null,
    fecha_fin: "2026-07-20",
    created_at: "",
  },
  {
    id: "2",
    titulo: "Promo días seleccionados",
    subtitulo: "Precio especial · Grupos · Acceso prioritario",
    descripcion:
      "En días seleccionados lanzamos promos con precios especiales para que vengas a correr con amigos. Seguí nuestras redes para enterarte antes que nadie.",
    categoria: "promo",
    tag: "ACTIVO AHORA",
    link: "/reservas",
    boton: "Reservar turno",
    activo: true,
    destacado: false,
    orden: 1,
    fecha_inicio: null,
    fecha_fin: "2026-06-30",
    created_at: "",
  },
  {
    id: "3",
    titulo: "Regalá adrenalina pura",
    subtitulo: "15 min · 30 min · Edición especial",
    descripcion:
      "Gift Cards virtuales para regalar una experiencia de Fórmula 1 real. Perfectas para cumpleaños o regalos corporativos. Consultanos por WhatsApp.",
    categoria: "gift",
    tag: "DISPONIBLE",
    link: "https://wa.me/5493512520927",
    boton: "Consultar por WhatsApp",
    activo: true,
    destacado: false,
    orden: 2,
    fecha_inicio: null,
    fecha_fin: null,
    created_at: "",
  },
  {
    id: "4",
    titulo: "Experiencia VIP SIM",
    subtitulo: "Eventos privados · Empresas · Activaciones",
    descripcion:
      "¿Querés hacer algo diferente? SIM se adapta a eventos privados y activaciones de marca. Formato 100% personalizado, inmersión total.",
    categoria: "vip",
    tag: "EXCLUSIVO",
    link: "https://wa.me/5493512520927",
    boton: "Hablar con el equipo",
    activo: true,
    destacado: false,
    orden: 3,
    fecha_inicio: null,
    fecha_fin: null,
    created_at: "",
  },
];

// ─── Config por categoría ───────────────────────────────────────────────────
const CAT: Record<string, {
  label: string;
  icon: React.ElementType;
  text: string;
  strip: string;
  badge: string;
  glow: string;
}> = {
  torneo: {
    label: "Torneo", icon: Trophy,
    text: "text-yellow-400", strip: "bg-yellow-500",
    badge: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25",
    glow: "hover:shadow-[0_0_60px_rgba(234,179,8,0.12)]",
  },
  promo: {
    label: "Promo", icon: Tag,
    text: "text-red-400", strip: "bg-red-600",
    badge: "bg-red-600/15 text-red-400 border border-red-600/25",
    glow: "hover:shadow-[0_0_60px_rgba(220,38,38,0.15)]",
  },
  evento: {
    label: "Evento", icon: Megaphone,
    text: "text-blue-400", strip: "bg-blue-500",
    badge: "bg-blue-500/15 text-blue-400 border border-blue-500/25",
    glow: "hover:shadow-[0_0_60px_rgba(96,165,250,0.12)]",
  },
  gift: {
    label: "Gift Card", icon: Gift,
    text: "text-white", strip: "bg-white",
    badge: "bg-white/10 text-white border border-white/20",
    glow: "hover:shadow-[0_0_60px_rgba(255,255,255,0.04)]",
  },
  vip: {
    label: "VIP", icon: Sparkles,
    text: "text-amber-400", strip: "bg-amber-500",
    badge: "bg-amber-500/15 text-amber-400 border border-amber-500/25",
    glow: "hover:shadow-[0_0_60px_rgba(251,191,36,0.12)]",
  },
  general: {
    label: "Info", icon: Zap,
    text: "text-zinc-300", strip: "bg-zinc-600",
    badge: "bg-zinc-800 text-zinc-300 border border-zinc-700",
    glow: "",
  },
};

function cat(categoria: string) {
  return CAT[categoria] ?? CAT.general;
}

// ─── Chips utilitarios ──────────────────────────────────────────────────────
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

function CountdownChip({ fecha }: { fecha: string }) {
  const dias = Math.ceil(
    (new Date(fecha).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (dias < 0) return null;
  if (dias === 0)
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white animate-pulse">
        <Clock className="h-3 w-3" /> Último día
      </span>
    );
  if (dias <= 7)
    return (
      <span className="flex items-center gap-1 rounded-full bg-orange-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-orange-400 border border-orange-500/25">
        <Clock className="h-3 w-3" /> {dias}d restantes
      </span>
    );
  return (
    <span className="flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-600 border border-zinc-800">
      <CalendarDays className="h-3 w-3" />
      Hasta{" "}
      {new Date(fecha).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
      })}
    </span>
  );
}

// ─── Ticker ─────────────────────────────────────────────────────────────────
function Ticker({ novedades }: { novedades: Novedad[] }) {
  const items = [...novedades, ...novedades, ...novedades];
  return (
    <div className="relative overflow-hidden border-y border-white/5 bg-black/60 py-3 select-none">
      <div className="flex animate-[marquee_40s_linear_infinite] gap-0 whitespace-nowrap">
        {items.map((n, i) => {
          const c = cat(n.categoria);
          const Icono = c.icon;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-3 px-8 text-[11px] font-black uppercase tracking-widest text-zinc-700"
            >
              <Icono className={`h-3 w-3 ${c.text}`} />
              <span className={n.destacado ? "text-zinc-400" : ""}>{n.titulo}</span>
              <span className="text-zinc-900">·</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Filtros ─────────────────────────────────────────────────────────────────
const FILTROS = [
  { key: "all", label: "Todo" },
  { key: "torneo", label: "Torneos" },
  { key: "promo", label: "Promos" },
  { key: "evento", label: "Eventos" },
  { key: "gift", label: "Gift Cards" },
  { key: "vip", label: "VIP" },
];

// ─── Cards ───────────────────────────────────────────────────────────────────

function CardHero({ n }: { n: Novedad }) {
  const c = cat(n.categoria);
  const Icono = c.icon;
  return (
    <article className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#080808] transition-all duration-500 md:grid md:grid-cols-[1fr_320px]">
      {/* fondo */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 right-1/3 h-[500px] w-[500px] rounded-full bg-red-600/5 blur-3xl" />
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/[0.025] to-transparent"
            style={{ left: `${10 + i * 14}%` }}
          />
        ))}
      </div>

      <div className="relative p-8 md:p-14">
        {/* tags */}
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.4em] text-red-500">
            <LiveDot /> Destacado
          </span>
          <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${c.badge}`}>
            {c.label}
          </span>
          {n.tag && (
            <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-black">
              {n.tag}
            </span>
          )}
          {n.fecha_fin && <CountdownChip fecha={n.fecha_fin} />}
        </div>

        {n.subtitulo && (
          <p className={`mb-4 text-[10px] font-black uppercase tracking-[0.45em] ${c.text} opacity-70`}>
            {n.subtitulo}
          </p>
        )}

        <h2 className="text-5xl font-black uppercase leading-[0.88] md:text-7xl">
          {n.titulo}
        </h2>

        <p className="mt-6 max-w-md text-base leading-8 text-zinc-500">
          {n.descripcion}
        </p>

        {n.link && n.boton && (
          <Link
            href={n.link}
            target={n.link.startsWith("http") ? "_blank" : "_self"}
            className="mt-10 inline-flex items-center gap-3 rounded-full bg-red-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
          >
            {n.boton}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* panel derecho */}
      <div className="relative hidden overflow-hidden border-l border-white/5 md:flex md:flex-col md:items-center md:justify-center bg-black/40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.08),transparent_70%)]" />
        {/* checkered corners */}
        <div className="absolute top-0 right-0 h-20 w-20 opacity-[0.06]"
          style={{ backgroundImage: "repeating-conic-gradient(#fff 0% 25%,transparent 0% 50%)", backgroundSize: "10px 10px" }} />
        <div className="absolute bottom-0 left-0 h-20 w-20 opacity-[0.06]"
          style={{ backgroundImage: "repeating-conic-gradient(#fff 0% 25%,transparent 0% 50%)", backgroundSize: "10px 10px" }} />

        <Icono className={`relative h-28 w-28 ${c.text} opacity-[0.08]`} strokeWidth={0.7} />
        <p className="relative mt-2 text-7xl font-black text-white/[0.04] select-none">SIM</p>

        {/* sector strip */}
        <div className="absolute bottom-0 inset-x-0 flex h-[3px]">
          <div className={`flex-1 ${c.strip}`} />
          <div className="flex-1 bg-red-600/40" />
          <div className="flex-1 bg-white/5" />
        </div>
      </div>
    </article>
  );
}

function CardHorizontal({ n }: { n: Novedad }) {
  const c = cat(n.categoria);
  const Icono = c.icon;
  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-[1.5rem] border border-white/[0.07] bg-[#080808] p-6 transition-all duration-300 hover:border-white/15 sm:flex-row sm:items-center sm:gap-7 ${c.glow}`}>
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${c.strip} opacity-30 rounded-t-[1.5rem]`} />

      <div className={`mb-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.025] sm:mb-0`}>
        <Icono className={`h-5 w-5 ${c.text}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${c.badge}`}>
            {c.label}
          </span>
          {n.tag && (
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">{n.tag}</span>
          )}
          {n.fecha_fin && <CountdownChip fecha={n.fecha_fin} />}
        </div>
        {n.subtitulo && (
          <p className={`mb-0.5 text-[10px] font-black uppercase tracking-[0.35em] ${c.text} opacity-60`}>
            {n.subtitulo}
          </p>
        )}
        <h3 className="text-xl font-black uppercase leading-tight">{n.titulo}</h3>
        <p className="mt-1.5 text-sm leading-7 text-zinc-600 line-clamp-2">{n.descripcion}</p>
      </div>

      {n.link && n.boton && (
        <Link
          href={n.link}
          target={n.link.startsWith("http") ? "_blank" : "_self"}
          className="mt-4 shrink-0 flex items-center gap-2 self-end rounded-full border border-white/10 px-5 py-2.5 text-xs font-black uppercase tracking-widest text-zinc-500 transition group-hover:border-white/25 group-hover:text-white sm:mt-0 sm:self-center"
        >
          {n.boton}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </article>
  );
}

function CardVertical({ n }: { n: Novedad }) {
  const c = cat(n.categoria);
  const Icono = c.icon;
  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-[1.5rem] border border-white/[0.07] bg-[#080808] p-6 transition-all duration-300 hover:border-white/15 hover:-translate-y-0.5 ${c.glow}`}>
      <div className={`absolute top-0 left-5 right-5 h-[2px] ${c.strip} opacity-25 rounded-full`} />

      <div className="mb-5 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/[0.025]">
          <Icono className={`h-5 w-5 ${c.text}`} />
        </div>
        {n.destacado && <Star className="h-4 w-4 text-yellow-500/40" />}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${c.badge}`}>
          {c.label}
        </span>
        {n.tag && (
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">{n.tag}</span>
        )}
      </div>

      {n.subtitulo && (
        <p className={`mb-1.5 text-[10px] font-black uppercase tracking-[0.35em] ${c.text} opacity-55`}>
          {n.subtitulo}
        </p>
      )}

      <h3 className="text-xl font-black uppercase leading-tight">{n.titulo}</h3>
      <p className="mt-3 flex-1 text-sm leading-7 text-zinc-600 line-clamp-3">{n.descripcion}</p>

      {n.fecha_fin && (
        <div className="mt-4">
          <CountdownChip fecha={n.fecha_fin} />
        </div>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-800">
          {n.fecha_inicio
            ? new Date(n.fecha_inicio).toLocaleDateString("es-AR", { day: "numeric", month: "short" })
            : "Disponible"}
        </span>
        {n.link && n.boton && (
          <Link
            href={n.link}
            target={n.link.startsWith("http") ? "_blank" : "_self"}
            className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-zinc-600 transition group-hover:text-white`}
          >
            {n.boton} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </article>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function NovedadesPage() {
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("all");

  useEffect(() => {
    fetch("/api/novedades")
      .then((r) => r.json())
      .then((d) => setNovedades(d.novedades?.length ? d.novedades : MOCK))
      .catch(() => setNovedades(MOCK))
      .finally(() => setLoading(false));
  }, []);

  const filtradas =
    filtro === "all" ? novedades : novedades.filter((n) => n.categoria === filtro);

  const hero = filtradas.find((n) => n.destacado) ?? filtradas[0];
  const resto = filtradas.filter((n) => n.id !== hero?.id);

  // Bloques: ancha + 2 chicas, alternados
  const bloques: Array<{ ancha: Novedad; chicas: Novedad[] }> = [];
  let i = 0;
  while (i < resto.length) {
    bloques.push({
      ancha: resto[i],
      chicas: resto.slice(i + 1, i + 3),
    });
    i += 3;
  }

  const filtrosVisibles = FILTROS.filter(
    (f) => f.key === "all" || novedades.some((n) => n.categoria === f.key)
  );

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-x-hidden">

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative border-b border-white/5">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 h-[500px] w-[700px] bg-[radial-gradient(ellipse_at_top_left,rgba(220,38,38,0.18),transparent_65%)]" />
          <div className="absolute right-0 top-0 h-full w-px bg-gradient-to-b from-red-600/50 via-red-600/10 to-transparent" />
          <div className="absolute right-7 top-0 h-2/3 w-px bg-gradient-to-b from-red-600/15 to-transparent" />
          <div className="absolute right-14 top-0 h-1/3 w-px bg-gradient-to-b from-red-600/08 to-transparent" />
          <div className="absolute bottom-0 right-0 h-36 w-36 opacity-[0.035]"
            style={{ backgroundImage: "repeating-conic-gradient(#fff 0% 25%,transparent 0% 50%)", backgroundSize: "10px 10px" }} />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-16">
          <div className="mb-5 flex items-center gap-3">
            <LiveDot />
            <p className="text-xs font-black tracking-[0.5em] text-red-500 uppercase">
              SIM Argentina · Novedades
            </p>
          </div>

          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <h1 className="text-[5rem] font-black uppercase leading-[0.85] md:text-[8.5rem]">
              En
              <span className="block text-red-600">pista.</span>
            </h1>
            <p className="max-w-xs text-sm leading-7 text-zinc-600 md:text-right">
              Torneos, promos, eventos y todo lo que mueve el universo SIM Argentina.
            </p>
          </div>

          {/* telemetría */}
          <div className="mt-12 flex flex-wrap gap-px overflow-hidden rounded-2xl border border-white/[0.06]">
            {[
              { label: "Novedades activas", val: novedades.length },
              { label: "Torneos", val: novedades.filter((n) => n.categoria === "torneo").length },
              { label: "Promos vigentes", val: novedades.filter((n) => n.categoria === "promo").length },
              { label: "Gift Cards", val: novedades.filter((n) => n.categoria === "gift").length },
            ].map((s) => (
              <div key={s.label} className="min-w-[120px] flex-1 bg-[#090909] px-6 py-5">
                <p className="text-3xl font-black">{loading ? "—" : s.val}</p>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-700">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TICKER ───────────────────────────────────────── */}
      {novedades.length > 0 && <Ticker novedades={novedades} />}

      {/* ── FILTROS ──────────────────────────────────────── */}
      <div className="sticky top-[68px] z-30 border-b border-white/5 bg-[#050505]/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center gap-1 overflow-x-auto py-4 scrollbar-none">
            {filtrosVisibles.map((f) => {
              const active = filtro === f.key;
              const c = CAT[f.key];
              const count =
                f.key === "all"
                  ? novedades.length
                  : novedades.filter((n) => n.categoria === f.key).length;
              return (
                <button
                  key={f.key}
                  onClick={() => setFiltro(f.key)}
                  className={`relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                    active ? "bg-white text-black" : "text-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  {active && c && (
                    <span className={`h-1.5 w-1.5 rounded-full ${c.strip}`} />
                  )}
                  {f.label}
                  {!active && (
                    <span className="text-[10px] text-zinc-800">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── CONTENIDO ────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-6 py-14">

        {loading && (
          <div className="flex flex-col items-center justify-center py-40 gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-red-600" />
            <p className="text-xs uppercase tracking-widest text-zinc-700">Cargando novedades</p>
          </div>
        )}

        {!loading && filtradas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-40 gap-4 text-center">
            <Flag className="h-10 w-10 text-zinc-800" />
            <p className="text-lg font-black uppercase text-zinc-700">Sin novedades en esta categoría</p>
            <button
              onClick={() => setFiltro("all")}
              className="mt-2 text-xs font-black uppercase tracking-widest text-red-500 hover:text-red-400"
            >
              Ver todas →
            </button>
          </div>
        )}

        {!loading && filtradas.length > 0 && (
          <div className="space-y-5">

            {/* card hero */}
            {hero && <CardHero n={hero} />}

            {/* bloques alternados */}
            {bloques.map((bloque, bi) => (
              <div key={bi} className="grid gap-5 md:grid-cols-3">
                <div className="md:col-span-2">
                  <CardHorizontal n={bloque.ancha} />
                </div>
                {bloque.chicas[0] && (
                  <div className="md:col-span-1">
                    <CardVertical n={bloque.chicas[0]} />
                  </div>
                )}
                {bloque.chicas[1] && (
                  <>
                    <div className="md:col-span-1">
                      <CardVertical n={bloque.chicas[1]} />
                    </div>
                    {/* relleno para que la próxima ancha empiece en la col correcta */}
                    <div className="hidden md:block md:col-span-2" />
                  </>
                )}
              </div>
            ))}

          </div>
        )}
      </div>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/5">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.1),transparent_65%)]" />
          {/* pista a cuadros */}
          <div className="absolute bottom-0 left-0 right-0 flex h-1">
            {[...Array(24)].map((_, i) => (
              <div key={i} className={`flex-1 ${i % 2 === 0 ? "bg-white/5" : ""}`} />
            ))}
          </div>
        </div>

        <div className="relative mx-auto max-w-2xl px-6 py-24 text-center">
          <Flag className="mx-auto mb-5 h-7 w-7 text-red-600" />
          <h2 className="text-5xl font-black uppercase leading-[0.9] md:text-6xl">
            ¿Listo para
            <span className="block text-red-600">acelerar?</span>
          </h2>
          <p className="mt-5 text-sm leading-8 text-zinc-600">
            Reservá tu turno y viví la experiencia de Fórmula 1 en Córdoba.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/reservas"
              className="rounded-full bg-red-600 px-9 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
            >
              Reservar ahora
            </Link>
            <Link
              href="https://www.instagram.com/sim_argentina"
              target="_blank"
              className="rounded-full border border-white/10 px-9 py-4 text-sm font-black uppercase tracking-widest text-zinc-500 transition hover:border-white/25 hover:text-white"
            >
              Instagram
            </Link>
          </div>
        </div>
      </section>

      <style jsx global>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.333%); }
        }
        .animate-\\[marquee_40s_linear_infinite\\] {
          animation: marquee 40s linear infinite;
        }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </main>
  );
}
