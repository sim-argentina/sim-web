"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Flag } from "lucide-react";

type Novedad = {
  id: string;
  titulo: string;
  subtitulo: string | null;
  descripcion: string;
  categoria: string;
  tag: string | null;
  link: string | null;
  boton: string | null;
  destacado: boolean;
  orden: number;
  fecha_fin: string | null;
  fecha_inicio: string | null;
  created_at: string;
};

const MOCK: Novedad[] = [
  {
    id: "1",
    titulo: "Gran Torneo SIM 2026",
    subtitulo: "Clasificación · Finales · Podio",
    descripcion:
      "La competencia más grande del año está llegando. Clasificación abierta, formato de eliminación directa y premios que ningún piloto va a querer perderse. Seguí nuestras redes para no perderte la apertura de inscripciones.",
    categoria: "Torneo",
    tag: "PRÓXIMAMENTE",
    link: "https://www.instagram.com/sim_argentina",
    boton: "Seguir en Instagram",
    destacado: true,
    orden: 0,
    fecha_fin: "2026-07-20",
    fecha_inicio: null,
    created_at: "",
  },
  {
    id: "2",
    titulo: "Promo días seleccionados",
    subtitulo: "Precio especial · Grupos",
    descripcion:
      "En días seleccionados lanzamos promos con precios especiales para que vengas a correr con amigos. Seguí nuestras redes para enterarte antes que nadie.",
    categoria: "Promo",
    tag: "ACTIVO",
    link: "/reservas",
    boton: "Reservar turno",
    destacado: false,
    orden: 1,
    fecha_fin: "2026-06-30",
    fecha_inicio: null,
    created_at: "",
  },
  {
    id: "3",
    titulo: "Regalá adrenalina",
    subtitulo: "15 · 30 minutos",
    descripcion:
      "Gift Cards virtuales para regalar una experiencia de Fórmula 1 real. Perfectas para cumpleaños o regalos corporativos. Consultanos por WhatsApp.",
    categoria: "Gift Card",
    tag: "DISPONIBLE",
    link: "https://wa.me/5493512520927",
    boton: "Consultar por WhatsApp",
    destacado: false,
    orden: 2,
    fecha_fin: null,
    fecha_inicio: null,
    created_at: "",
  },
  {
    id: "4",
    titulo: "Experiencia VIP",
    subtitulo: "Empresas · Eventos privados",
    descripcion:
      "SIM se adapta a activaciones de marca y eventos privados. Formato 100% personalizado, inmersión total y un impacto que no se olvida.",
    categoria: "VIP",
    tag: "EXCLUSIVO",
    link: "https://wa.me/5493512520927",
    boton: "Hablar con el equipo",
    destacado: false,
    orden: 3,
    fecha_fin: null,
    fecha_inicio: null,
    created_at: "",
  },
];

function diasRestantes(fecha: string) {
  return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
}

function TagFecha({ fecha }: { fecha: string }) {
  const d = diasRestantes(fecha);
  if (d < 0) return null;
  if (d === 0)
    return (
      <span className="bg-red-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
        Último día
      </span>
    );
  if (d <= 7)
    return (
      <span className="border border-red-600 text-red-600 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
        {d}d restantes
      </span>
    );
  return (
    <span className="border border-black/20 text-black/40 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
      Hasta{" "}
      {new Date(fecha).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
      })}
    </span>
  );
}

function TagFechaInverted({ fecha }: { fecha: string }) {
  const d = diasRestantes(fecha);
  if (d < 0) return null;
  if (d === 0)
    return (
      <span className="bg-white text-red-600 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
        Último día
      </span>
    );
  if (d <= 7)
    return (
      <span className="border border-white/40 text-white/70 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
        {d}d restantes
      </span>
    );
  return (
    <span className="border border-white/20 text-white/40 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
      Hasta{" "}
      {new Date(fecha).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
      })}
    </span>
  );
}

// Card principal — fondo blanco, texto negro
function CardPrincipal({ n }: { n: Novedad }) {
  return (
    <article className="relative overflow-hidden rounded-3xl bg-white">
      {/* franja roja lateral */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-600" />

      <div className="flex flex-col gap-8 p-8 pl-10 md:flex-row md:items-stretch md:p-12 md:pl-14">
        {/* contenido */}
        <div className="flex flex-1 flex-col justify-between">
          <div>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className="bg-red-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
                Destacado
              </span>
              <span className="border border-black/15 text-black/50 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
                {n.categoria}
              </span>
              {n.tag && (
                <span className="text-[10px] font-black uppercase tracking-widest text-black/30">
                  {n.tag}
                </span>
              )}
              {n.fecha_fin && <TagFecha fecha={n.fecha_fin} />}
            </div>

            {n.subtitulo && (
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.4em] text-red-600">
                {n.subtitulo}
              </p>
            )}

            <h2 className="text-5xl font-black uppercase leading-[0.88] text-black md:text-6xl">
              {n.titulo}
            </h2>

            <p className="mt-5 max-w-lg text-[15px] leading-8 text-black/55">
              {n.descripcion}
            </p>
          </div>

          {n.link && n.boton && (
            <Link
              href={n.link}
              target={n.link.startsWith("http") ? "_blank" : "_self"}
              className="mt-8 inline-flex w-fit items-center gap-3 rounded-full bg-black px-7 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-600"
            >
              {n.boton}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {/* panel derecho decorativo */}
        <div className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:items-center md:justify-center md:rounded-2xl md:bg-black md:py-10">
          <p className="text-7xl font-black text-white leading-none">SIM</p>
          <div className="my-4 h-px w-10 bg-red-600" />
          <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/30">
            Argentina
          </p>
        </div>
      </div>
    </article>
  );
}

// Card negra — fondo negro, texto blanco
function CardNegra({ n }: { n: Novedad }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-black p-7 transition hover:ring-1 hover:ring-red-600">
      <div className="absolute top-0 left-6 right-6 h-px bg-red-600/40" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="border border-white/15 text-white/50 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
          {n.categoria}
        </span>
        {n.tag && (
          <span className="text-[10px] font-black uppercase tracking-widest text-white/25">
            {n.tag}
          </span>
        )}
        {n.fecha_fin && <TagFechaInverted fecha={n.fecha_fin} />}
      </div>

      {n.subtitulo && (
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.4em] text-red-500">
          {n.subtitulo}
        </p>
      )}

      <h3 className="text-2xl font-black uppercase leading-tight text-white">
        {n.titulo}
      </h3>

      <p className="mt-4 flex-1 text-sm leading-7 text-white/40">
        {n.descripcion}
      </p>

      {n.link && n.boton && (
        <div className="mt-7 flex items-center justify-between border-t border-white/8 pt-5">
          <span className="text-[10px] font-black uppercase tracking-widest text-white/20">
            {n.fecha_inicio
              ? new Date(n.fecha_inicio).toLocaleDateString("es-AR", { day: "numeric", month: "short" })
              : "Disponible"}
          </span>
          <Link
            href={n.link}
            target={n.link.startsWith("http") ? "_blank" : "_self"}
            className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/40 transition group-hover:text-red-500"
          >
            {n.boton} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </article>
  );
}

// Card roja — para una novedad que se quiere resaltar sin ser la principal
function CardRoja({ n }: { n: Novedad }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl bg-red-600 p-7 transition hover:bg-red-700 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
            {n.categoria}
          </span>
          {n.tag && (
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">
              {n.tag}
            </span>
          )}
          {n.fecha_fin && <TagFechaInverted fecha={n.fecha_fin} />}
        </div>

        {n.subtitulo && (
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.4em] text-white/60">
            {n.subtitulo}
          </p>
        )}

        <h3 className="text-2xl font-black uppercase leading-tight text-white">
          {n.titulo}
        </h3>
        <p className="mt-2 text-sm leading-7 text-white/70 line-clamp-2">
          {n.descripcion}
        </p>
      </div>

      {n.link && n.boton && (
        <Link
          href={n.link}
          target={n.link.startsWith("http") ? "_blank" : "_self"}
          className="mt-5 shrink-0 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-xs font-black uppercase tracking-widest text-black transition hover:bg-black hover:text-white sm:mt-0"
        >
          {n.boton} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </article>
  );
}

const FILTROS = [
  { key: "all", label: "Todo" },
  { key: "Torneo", label: "Torneos" },
  { key: "Promo", label: "Promos" },
  { key: "Evento", label: "Eventos" },
  { key: "Gift Card", label: "Gift Cards" },
  { key: "VIP", label: "VIP" },
];

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

  const principal = filtradas.find((n) => n.destacado) ?? filtradas[0];
  const resto = filtradas.filter((n) => n.id !== principal?.id);

  const filtrosVisibles = FILTROS.filter(
    (f) => f.key === "all" || novedades.some((n) => n.categoria === f.key)
  );

  return (
    <main className="min-h-screen bg-white text-black">

      {/* ── HEADER ─────────────────────────────────────── */}
      <section className="border-b border-black/8 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 max-w-[3rem] bg-red-600" />
            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-red-600">
              SIM Argentina
            </p>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <h1 className="text-[4.5rem] font-black uppercase leading-[0.85] md:text-[7rem]">
              Nove<span className="text-red-600">dades</span>
            </h1>
            <p className="max-w-xs text-sm leading-7 text-black/40 md:text-right md:pb-2">
              Torneos, promos, eventos y todo lo que mueve el universo SIM.
            </p>
          </div>

          {/* barra de datos */}
          {!loading && (
            <div className="mt-10 flex flex-wrap gap-8 border-t border-black/8 pt-8">
              {[
                { label: "Novedades", val: novedades.length },
                { label: "Torneos", val: novedades.filter((n) => n.categoria === "Torneo").length },
                { label: "Promos", val: novedades.filter((n) => n.categoria === "Promo").length },
                { label: "Gift Cards", val: novedades.filter((n) => n.categoria === "Gift Card").length },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-3xl font-black text-black">{s.val}</p>
                  <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-black/30">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── FILTROS ────────────────────────────────────── */}
      <div className="sticky top-[68px] z-30 border-b border-black/8 bg-white/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center gap-1 overflow-x-auto py-3 scrollbar-none">
            {filtrosVisibles.map((f) => {
              const active = filtro === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFiltro(f.key)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                    active
                      ? "bg-black text-white"
                      : "text-black/35 hover:text-black"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── CONTENIDO ──────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-6 py-12">

        {loading && (
          <div className="flex flex-col items-center justify-center py-40 gap-4">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-black/10 border-t-red-600" />
          </div>
        )}

        {!loading && filtradas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-40 gap-4 text-center">
            <Flag className="h-9 w-9 text-black/10" />
            <p className="font-black uppercase text-black/25">Sin novedades en esta categoría</p>
            <button
              onClick={() => setFiltro("all")}
              className="mt-1 text-xs font-black uppercase tracking-widest text-red-600 hover:underline"
            >
              Ver todas
            </button>
          </div>
        )}

        {!loading && filtradas.length > 0 && (
          <div className="space-y-4">

            {/* card principal */}
            {principal && <CardPrincipal n={principal} />}

            {/* resto — layout dinámico */}
            {resto.length > 0 && (() => {
              const bloques = [];
              let i = 0;
              while (i < resto.length) {
                bloques.push(resto.slice(i, i + 3));
                i += 3;
              }
              return bloques.map((bloque, bi) => {
                const [a, b, c] = bloque;
                // bloque par: roja ancha + negra chica
                // bloque impar: 2 negras + 1 roja
                if (bi % 2 === 0) {
                  return (
                    <div key={bi} className="grid gap-4 md:grid-cols-3">
                      <div className="md:col-span-2">
                        <CardRoja n={a} />
                      </div>
                      {b && (
                        <div className="md:col-span-1">
                          <CardNegra n={b} />
                        </div>
                      )}
                      {c && (
                        <div className="md:col-span-3">
                          <CardNegra n={c} />
                        </div>
                      )}
                    </div>
                  );
                } else {
                  return (
                    <div key={bi} className="grid gap-4 md:grid-cols-3">
                      {b && (
                        <div className="md:col-span-1">
                          <CardNegra n={a} />
                        </div>
                      )}
                      {b && (
                        <div className="md:col-span-1">
                          <CardNegra n={b} />
                        </div>
                      )}
                      {c && (
                        <div className="md:col-span-1">
                          <CardNegra n={c} />
                        </div>
                      )}
                      {!b && (
                        <div className="md:col-span-3">
                          <CardRoja n={a} />
                        </div>
                      )}
                    </div>
                  );
                }
              });
            })()}

          </div>
        )}
      </div>

      {/* ── CTA ────────────────────────────────────────── */}
      <section className="bg-black">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
                ¿Listo para correr?
              </p>
              <h2 className="text-4xl font-black uppercase leading-tight text-white md:text-5xl">
                Reservá tu turno<br />
                <span className="text-red-600">en SIM Argentina.</span>
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/reservas"
                className="rounded-full bg-red-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
              >
                Reservar ahora
              </Link>
              <Link
                href="https://www.instagram.com/sim_argentina"
                target="_blank"
                className="rounded-full border border-white/15 px-8 py-4 text-sm font-black uppercase tracking-widest text-white/50 transition hover:border-white/40 hover:text-white"
              >
                Instagram
              </Link>
            </div>
          </div>
        </div>
      </section>

      <style jsx global>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </main>
  );
}
