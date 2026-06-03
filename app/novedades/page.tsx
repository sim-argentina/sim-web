import Link from "next/link";

const novedades = [
  {
    fecha: "Actualidad",
    categoria: "Experiencia",
    titulo: "SIM Argentina en Nuevo Centro Shopping",
    descripcion:
      "Viví la experiencia de manejar simuladores de Fórmula 1 con movimiento, competencia y adrenalina en Córdoba.",
    link: "/reserva",
    boton: "Reservar turno",
  },
  {
    fecha: "Disponible",
    categoria: "Gift Cards",
    titulo: "Regalá una experiencia SIM",
    descripcion:
      "Las Gift Cards son virtuales y están disponibles para turnos de 15 o 30 minutos. Una opción distinta para regalar adrenalina.",
    link: "https://wa.me/5493512520927",
    boton: "Consultar por WhatsApp",
  },
  {
    fecha: "Próximamente",
    categoria: "Eventos",
    titulo: "Torneos y desafíos especiales",
    descripcion:
      "Muy pronto vamos a anunciar nuevas competencias, rankings y premios para pilotos SIM.",
    link: "https://www.instagram.com/sim_argentina",
    boton: "Ver Instagram",
  },
];

export default function NovedadesPage() {
  const destacada = novedades[0];
  const resto = novedades.slice(1);

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">
      <section className="relative border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(220,38,38,0.35),transparent_30%),linear-gradient(135deg,#111,#050505_55%,#000)]" />
        <div className="absolute right-0 top-0 hidden h-full w-1/2 skew-x-[-12deg] bg-red-600/10 md:block" />

        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <p className="text-sm font-black tracking-[0.45em] text-red-500">
            ÚLTIMO EN SIM
          </p>

          <h1 className="mt-5 max-w-5xl text-6xl font-black uppercase leading-[0.95] md:text-8xl">
            Novedades
            <span className="block text-red-600">en pista.</span>
          </h1>

          <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-300">
            Promociones, eventos, torneos, experiencias y actualizaciones
            importantes de SIM Argentina.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <article className="grid overflow-hidden rounded-[2rem] border border-white/10 bg-white text-black md:grid-cols-[1.1fr_0.9fr]">
          <div className="p-8 md:p-12">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
                Destacado
              </span>

              <span className="rounded-full border border-black/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-700">
                {destacada.fecha}
              </span>
            </div>

            <p className="mt-8 text-sm font-black tracking-[0.35em] text-red-600">
              {destacada.categoria}
            </p>

            <h2 className="mt-4 text-4xl font-black uppercase leading-tight md:text-6xl">
              {destacada.titulo}
            </h2>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-700">
              {destacada.descripcion}
            </p>

            <Link
              href={destacada.link}
              target={destacada.link.startsWith("http") ? "_blank" : "_self"}
              className="mt-8 inline-block rounded-full bg-black px-7 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-600"
            >
              {destacada.boton}
            </Link>
          </div>

          <div className="relative min-h-[320px] bg-black">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.45),transparent_35%)]" />
            <div className="absolute inset-8 rounded-[2rem] border border-white/10 bg-white/[0.03]" />

            <div className="relative flex h-full flex-col justify-end p-10">
              <p className="text-8xl font-black text-red-600 md:text-9xl">
                SIM
              </p>
              <p className="mt-2 text-sm font-black uppercase tracking-[0.35em] text-zinc-400">
                Racing updates
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mb-10">
          <p className="text-sm font-black tracking-[0.35em] text-red-500">
            ACTUALIZACIONES
          </p>

          <h2 className="mt-3 text-4xl font-black uppercase">Lo último</h2>
        </div>

        <div className="relative space-y-6 border-l border-white/10 pl-6 md:pl-10">
          {resto.map((novedad) => (
            <article
              key={novedad.titulo}
              className="group relative rounded-[2rem] border border-white/10 bg-white/[0.03] p-7 transition hover:border-red-600/70"
            >
              <div className="absolute -left-[33px] top-8 h-4 w-4 rounded-full bg-red-600 md:-left-[49px]" />

              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-400">
                  {novedad.fecha}
                </span>

                <span className="rounded-full bg-red-600/15 px-4 py-2 text-xs font-black uppercase tracking-widest text-red-500">
                  {novedad.categoria}
                </span>
              </div>

              <h3 className="mt-6 text-3xl font-black uppercase leading-tight">
                {novedad.titulo}
              </h3>

              <p className="mt-4 max-w-3xl leading-8 text-zinc-400">
                {novedad.descripcion}
              </p>

              <Link
                href={novedad.link}
                target={novedad.link.startsWith("http") ? "_blank" : "_self"}
                className="mt-6 inline-block text-sm font-black uppercase tracking-widest text-white transition group-hover:text-red-500"
              >
                {novedad.boton} →
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}