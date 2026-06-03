import Link from "next/link";

const novedades = [
  {
    categoria: "Experiencia",
    titulo: "SIM Argentina en Nuevo Centro Shopping",
    descripcion:
      "Viví la experiencia de manejar simuladores de Fórmula 1 con movimiento, competencia y adrenalina en Córdoba.",
    fecha: "Actualidad",
    destacado: true,
    cta: "Reservar turno",
    href: "/reserva",
  },
  {
    categoria: "Promociones",
    titulo: "Gift Cards SIM",
    descripcion:
      "Regalá una experiencia distinta. Las Gift Cards están disponibles para turnos de 15 o 30 minutos.",
    fecha: "Disponible",
    destacado: false,
    cta: "Consultar por WhatsApp",
    href: "https://wa.me/5493512520927",
  },
  {
    categoria: "Eventos",
    titulo: "Torneos y desafíos especiales",
    descripcion:
      "Próximamente vamos a estar anunciando nuevas competencias, rankings y premios para pilotos SIM.",
    fecha: "Próximamente",
    destacado: false,
    cta: "Ver Instagram",
    href: "https://www.instagram.com/sim_argentina",
  },
];

export default function NovedadesPage() {
  const principal = novedades.find((n) => n.destacado);
  const secundarias = novedades.filter((n) => !n.destacado);

  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">
      <section className="relative border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(220,38,38,0.35),transparent_32%),linear-gradient(140deg,#111,#050505_55%,#000)]" />
        <div className="absolute right-0 top-0 hidden h-full w-1/2 bg-red-600/10 skew-x-[-12deg] md:block" />

        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <p className="text-sm font-black tracking-[0.45em] text-red-500">
            ÚLTIMO EN SIM
          </p>

          <h1 className="mt-5 max-w-5xl text-6xl font-black uppercase leading-[0.95] md:text-8xl">
            Novedades
            <span className="block text-red-600">en pista.</span>
          </h1>

          <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-300">
            Acá vas a encontrar las últimas noticias, promociones, eventos,
            torneos y actualizaciones importantes de SIM Argentina.
          </p>
        </div>
      </section>

      {principal && (
        <section className="mx-auto max-w-7xl px-6 py-16">
          <div className="grid overflow-hidden rounded-[2rem] border border-white/10 bg-white text-black md:grid-cols-[1.1fr_0.9fr]">
            <div className="p-8 md:p-12">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
                  Destacado
                </span>

                <span className="rounded-full border border-black/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-700">
                  {principal.fecha}
                </span>
              </div>

              <p className="mt-8 text-sm font-black tracking-[0.35em] text-red-600">
                {principal.categoria}
              </p>

              <h2 className="mt-4 text-4xl font-black uppercase leading-tight md:text-6xl">
                {principal.titulo}
              </h2>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-700">
                {principal.descripcion}
              </p>

              <Link
                href={principal.href}
                className="mt-8 inline-block rounded-full bg-black px-7 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-red-600"
              >
                {principal.cta}
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
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-black tracking-[0.35em] text-red-500">
              ACTUALIZACIONES
            </p>
            <h2 className="mt-3 text-4xl font-black uppercase">
              Lo último
            </h2>
          </div>

          <Link
            href="https://www.instagram.com/sim_argentina"
            target="_blank"
            className="hidden rounded-full border border-white/10 px-5 py-3 text-xs font-black uppercase tracking-widest text-zinc-300 transition hover:border-red-500 hover:text-red-500 md:inline-block"
          >
            Instagram
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {secundarias.map((novedad, index) => (
            <article
              key={novedad.titulo}
              className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] p-7 transition hover:border-red-600/70"
            >
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-red-600 opacity-0 blur-3xl transition group-hover:opacity-30" />

              <div className="relative">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-5xl font-black text-red-600">
                    0{index + 1}
                  </span>

                  <span className="rounded-full border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-400">
                    {novedad.fecha}
                  </span>
                </div>

                <p className="mt-8 text-sm font-black tracking-[0.3em] text-red-500">
                  {novedad.categoria}
                </p>

                <h3 className="mt-4 text-2xl font-black uppercase leading-tight">
                  {novedad.titulo}
                </h3>

                <p className="mt-4 min-h-[120px] leading-7 text-zinc-400">
                  {novedad.descripcion}
                </p>

                <Link
                  href={novedad.href}
                  target={novedad.href.startsWith("http") ? "_blank" : "_self"}
                  className="mt-6 inline-block text-sm font-black uppercase tracking-widest text-white transition group-hover:text-red-500"
                >
                  {novedad.cta} →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-white text-black">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-black tracking-[0.35em] text-red-600">
              CÓMO ACTUALIZAR
            </p>

            <h2 className="mt-4 text-4xl font-black uppercase">
              Esta página está preparada para cambiar rápido.
            </h2>
          </div>

          <div className="space-y-5 text-lg leading-8 text-zinc-700">
            <p>
              Para agregar o modificar novedades, solo tenés que editar el array
              <strong className="text-black"> novedades</strong> que está arriba
              del archivo.
            </p>

            <p>
              Podés cambiar título, descripción, fecha, categoría, botón y link.
              Si querés que una novedad aparezca como principal, poné{" "}
              <strong className="text-black">destacado: true</strong>.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}