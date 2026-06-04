// app/novedades/page.tsx
import Link from "next/link";
import { Trophy, Tag, Gift, Zap, Flag, ArrowRight } from "lucide-react";

const novedades = [
  {
    id: "torneo-sim-2026",
    fecha: "Junio 2026",
    categoria: "Torneo",
    tag: "PRÓXIMAMENTE",
    tagColor: "bg-yellow-500 text-black",
    titulo: "Gran Torneo SIM 2026",
    subtitulo: "Clasificación · Finales · Podio",
    descripcion:
      "La competencia más grande del año está llegando. Clasificación abierta, formato de eliminación directa y un podio con premios que ningún piloto va a querer perderse. Seguí nuestro Instagram para no perderte la apertura de inscripciones.",
    link: "https://www.instagram.com/sim_argentina",
    boton: "Seguir en Instagram",
    icon: Trophy,
    acento: "from-yellow-600/20 to-transparent",
    borde: "border-yellow-500/30 group-hover:border-yellow-400",
    tagBg: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
  },
  {
    id: "promo-vigente",
    fecha: "Promo activa",
    categoria: "Promoción",
    tag: "ACTIVO AHORA",
    tagColor: "bg-red-600 text-white",
    titulo: "Promos especiales en días seleccionados",
    subtitulo: "Precio especial · Reserva grupal · Acceso prioritario",
    descripcion:
      "En días seleccionados lanzamos promos con precios especiales para que vengas a correr con amigos. Seguí de cerca nuestras redes para enterarte antes que nadie.",
    link: "/reservas",
    boton: "Reservar turno ahora",
    icon: Tag,
    acento: "from-red-600/20 to-transparent",
    borde: "border-red-600/30 group-hover:border-red-500",
    tagBg: "bg-red-600/10 text-red-400 border border-red-600/20",
  },
  {
    id: "gift-card",
    fecha: "Siempre disponible",
    categoria: "Gift Card",
    tag: "DISPONIBLE",
    tagColor: "bg-white text-black",
    titulo: "Regalá adrenalina pura",
    subtitulo: "15 min · 30 min · Edición especial",
    descripcion:
      "Gift Cards virtuales para regalar una experiencia de Fórmula 1 real. Perfectas para cumpleaños, regalos corporativos o sorprender a alguien que vive la velocidad. Consultanos por WhatsApp y lo resolvemos al instante.",
    link: "https://wa.me/5493512520927",
    boton: "Consultar por WhatsApp",
    icon: Gift,
    acento: "from-white/10 to-transparent",
    borde: "border-white/20 group-hover:border-white/50",
    tagBg: "bg-white/10 text-white border border-white/20",
  },
  {
    id: "experiencia-vip",
    fecha: "Bajo pedido",
    categoria: "VIP",
    tag: "EXCLUSIVO",
    tagColor: "bg-red-600 text-white",
    titulo: "Experiencia VIP SIM",
    subtitulo: "Eventos privados · Empresas · Activaciones",
    descripcion:
      "¿Querés hacer algo diferente? SIM se adapta a eventos privados, activaciones de marca y experiencias corporativas. Formato 100% personalizado, inmersión total y un impacto visual que no se olvida más.",
    link: "https://wa.me/5493512520927",
    boton: "Hablar con el equipo",
    icon: Zap,
    acento: "from-red-900/20 to-transparent",
    borde: "border-red-900/30 group-hover:border-red-600",
    tagBg: "bg-red-600/10 text-red-400 border border-red-600/20",
  },
];

const stats = [
  { valor: "+500", label: "Pilotos en pista" },
  { valor: "2", label: "Simuladores F1" },
  { valor: "15/30", label: "Min por sesión" },
  { valor: "100%", label: "Adrenalina real" },
];

export default function NovedadesPage() {
  const [principal, ...resto] = novedades;
  const IconoPrincipal = principal.icon;

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">

      {/* HERO */}
      <section className="relative border-b border-white/10">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(220,38,38,0.3),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(220,38,38,0.1),transparent_60%)]" />
          {/* Racing stripes */}
          <div className="absolute top-0 right-0 h-full w-px bg-gradient-to-b from-red-600 via-red-600/20 to-transparent" />
          <div className="absolute top-0 right-8 h-full w-px bg-gradient-to-b from-red-600/30 via-transparent to-transparent" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-16">
          <div className="flex items-center gap-3 mb-8">
            <Flag className="h-4 w-4 text-red-500" />
            <p className="text-sm font-black tracking-[0.45em] text-red-500 uppercase">
              SIM Argentina · Novedades
            </p>
          </div>

          <h1 className="max-w-4xl text-7xl font-black uppercase leading-[0.9] md:text-[7rem]">
            Todo lo que
            <span className="block text-red-600">pasa en</span>
            <span className="block">pista.</span>
          </h1>

          <p className="mt-8 max-w-xl text-lg leading-8 text-zinc-400">
            Torneos, promos, eventos especiales y actualizaciones del universo
            SIM. Acá enterás primero.
          </p>

          {/* Stats bar */}
          <div className="mt-16 grid grid-cols-2 gap-px bg-white/10 overflow-hidden rounded-2xl md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-[#050505] px-8 py-6">
                <p className="text-4xl font-black text-red-600">{s.valor}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-widest text-zinc-500">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CARD PRINCIPAL */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <p className="mb-6 text-xs font-black tracking-[0.4em] text-zinc-600 uppercase">
          — Destacado
        </p>

        <article className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] transition-all duration-500 hover:border-white/20 md:grid md:grid-cols-[1.2fr_0.8fr]">
          <div className={`absolute inset-0 bg-gradient-to-r ${principal.acento}`} />

          <div className="relative p-8 md:p-14">
            <div className="flex flex-wrap items-center gap-3 mb-8">
              <span className={`rounded-full px-4 py-1.5 text-[10px] font-black tracking-[0.3em] ${principal.tagColor}`}>
                {principal.tag}
              </span>
              <span className={`rounded-full px-4 py-1.5 text-[10px] font-black tracking-[0.3em] ${principal.tagBg}`}>
                {principal.categoria}
              </span>
              <span className="text-xs font-bold text-zinc-600">{principal.fecha}</span>
            </div>

            <p className="text-xs font-black tracking-[0.35em] text-red-500 uppercase mb-4">
              {principal.subtitulo}
            </p>

            <h2 className="text-5xl font-black uppercase leading-[0.95] md:text-6xl">
              {principal.titulo}
            </h2>

            <p className="mt-6 max-w-lg text-base leading-8 text-zinc-400">
              {principal.descripcion}
            </p>

            <Link
              href={principal.link}
              target={principal.link.startsWith("http") ? "_blank" : "_self"}
              className="mt-10 inline-flex items-center gap-3 rounded-full bg-red-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
            >
              {principal.boton}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Panel derecho */}
          <div className="relative min-h-[280px] bg-black/40 flex flex-col items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.2),transparent_60%)]" />
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-red-600/50 to-transparent" />
            <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-red-600/20 to-transparent" />

            <IconoPrincipal className="relative h-28 w-28 text-red-600/30" strokeWidth={1} />

            <div className="relative mt-6 text-center">
              <p className="text-6xl font-black text-white/5">SIM</p>
              <p className="mt-2 text-xs font-black tracking-[0.5em] text-zinc-700 uppercase">
                Argentina
              </p>
            </div>
          </div>
        </article>
      </section>

      {/* GRILLA DE CARDS */}
      <section className="mx-auto max-w-7xl px-6 pb-28">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.4em] text-zinc-600 uppercase mb-2">
              — Actualizaciones
            </p>
            <h2 className="text-4xl font-black uppercase">Lo último</h2>
          </div>
          <Link
            href="https://www.instagram.com/sim_argentina"
            target="_blank"
            className="hidden text-xs font-black tracking-widest uppercase text-zinc-500 transition hover:text-red-500 md:block"
          >
            Ver todo en Instagram →
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {resto.map((novedad) => {
            const Icono = novedad.icon;
            return (
              <article
                key={novedad.id}
                className={`group relative overflow-hidden rounded-3xl border bg-white/[0.02] p-8 transition-all duration-300 ${novedad.borde}`}
              >
                <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-600/30 to-transparent`} />
                <div className={`absolute inset-0 bg-gradient-to-b ${novedad.acento} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                <div className="relative">
                  <div className="mb-6 flex items-start justify-between">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-black tracking-[0.3em] uppercase ${novedad.tagBg}`}>
                      {novedad.tag}
                    </span>
                    <Icono className="h-5 w-5 text-zinc-700 group-hover:text-red-500 transition-colors" />
                  </div>

                  <p className="text-[10px] font-black tracking-[0.35em] text-zinc-600 uppercase mb-3">
                    {novedad.subtitulo}
                  </p>

                  <h3 className="text-2xl font-black uppercase leading-tight">
                    {novedad.titulo}
                  </h3>

                  <p className="mt-4 text-sm leading-7 text-zinc-500">
                    {novedad.descripcion}
                  </p>

                  <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-6">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">
                      {novedad.fecha}
                    </span>
                    <Link
                      href={novedad.link}
                      target={novedad.link.startsWith("http") ? "_blank" : "_self"}
                      className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white transition group-hover:text-red-400"
                    >
                      {novedad.boton}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="relative border-t border-white/10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.15),transparent_70%)]" />
        <div className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-red-600/30 to-transparent" />
        <div className="absolute right-0 top-0 h-full w-px bg-gradient-to-b from-red-600/30 to-transparent" />

        <div className="relative mx-auto max-w-3xl px-6 py-28 text-center">
          <Flag className="mx-auto mb-6 h-8 w-8 text-red-600" />
          <h2 className="text-5xl font-black uppercase leading-tight md:text-6xl">
            ¿Listo para
            <span className="block text-red-600">acelerar?</span>
          </h2>
          <p className="mt-6 text-lg text-zinc-400">
            No esperes más. Reservá tu turno y viví la experiencia de Fórmula 1
            en Córdoba.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/reservas"
              className="rounded-full bg-red-600 px-10 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
            >
              Reservar ahora
            </Link>
            <Link
              href="https://www.instagram.com/sim_argentina"
              target="_blank"
              className="rounded-full border border-white/20 px-10 py-4 text-sm font-black uppercase tracking-widest text-zinc-300 transition hover:border-red-600 hover:text-white"
            >
              Seguirnos en Instagram
            </Link>
          </div>
        </div>
      </section>

    </main>
  );
}