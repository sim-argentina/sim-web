import Link from "next/link";

export default function SobreNosotrosPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="relative overflow-hidden border-b border-zinc-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(220,38,38,0.22),transparent_35%),linear-gradient(to_bottom,#050505,#000)]" />

        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <p className="mb-4 text-sm font-bold tracking-[0.35em] text-red-500">
            SIM ARGENTINA
          </p>

          <h1 className="max-w-4xl text-5xl font-black uppercase leading-tight md:text-7xl">
            Sobre nosotros
          </h1>

          <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-300">
            En SIM Argentina llevamos la emoción de la Fórmula 1 a una
            experiencia real, inmersiva y accesible. Nuestro objetivo es que
            cada persona pueda vivir la adrenalina de manejar un monoplaza en
            simuladores profesionales, con movimiento, competencia y ambiente
            racing.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/reserva"
              className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white transition hover:bg-red-700"
            >
              Reservar turno
            </Link>

            <a
              href="https://www.instagram.com/sim_argentina"
              target="_blank"
              className="rounded-xl border border-zinc-700 px-6 py-3 font-bold text-white transition hover:border-red-600 hover:text-red-500"
            >
              Ver Instagram
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-16 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <p className="text-sm font-bold tracking-[0.25em] text-red-500">
            EXPERIENCIA
          </p>
          <h2 className="mt-4 text-2xl font-black">Simulación inmersiva</h2>
          <p className="mt-3 leading-7 text-zinc-400">
            Simuladores de Fórmula 1 con butacas, volante, pedales y movimiento
            para vivir una experiencia mucho más realista que un juego
            tradicional.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <p className="text-sm font-bold tracking-[0.25em] text-red-500">
            UBICACIÓN
          </p>
          <h2 className="mt-4 text-2xl font-black">Nuevo Centro Shopping</h2>
          <p className="mt-3 leading-7 text-zinc-400">
            Nos encontrás en Nuevo Centro Shopping, Córdoba. Una ubicación
            cómoda para venir solo, con amigos, en familia o como parte de una
            salida distinta.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <p className="text-sm font-bold tracking-[0.25em] text-red-500">
            COMUNIDAD
          </p>
          <h2 className="mt-4 text-2xl font-black">Pasión por la F1</h2>
          <p className="mt-3 leading-7 text-zinc-400">
            Creamos torneos, desafíos, rankings, promociones y eventos
            especiales para fanáticos del automovilismo, gamers y personas que
            quieren probar algo diferente.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid gap-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-8 md:grid-cols-2">
          <div>
            <p className="text-sm font-bold tracking-[0.3em] text-red-500">
              NUESTROS SIMULADORES
            </p>

            <h2 className="mt-4 text-4xl font-black uppercase">
              Tecnología, adrenalina y competencia
            </h2>

            <p className="mt-5 leading-8 text-zinc-300">
              La experiencia está pensada para que cualquier persona pueda
              sentirse piloto por unos minutos. Antes de comenzar, nuestro
              equipo acompaña al cliente, explica el funcionamiento básico y
              ayuda a configurar la posición de manejo.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <p className="text-3xl font-black text-red-500">F1</p>
              <p className="mt-2 text-zinc-400">Simuladores temáticos</p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <p className="text-3xl font-black text-red-500">15’ / 30’</p>
              <p className="mt-2 text-zinc-400">Turnos disponibles</p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <p className="text-3xl font-black text-red-500">1,40 m</p>
              <p className="mt-2 text-zinc-400">Altura mínima sugerida</p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <p className="text-3xl font-black text-red-500">110 kg</p>
              <p className="mt-2 text-zinc-400">Peso máximo permitido</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-8">
            <p className="text-sm font-bold tracking-[0.3em] text-red-500">
              CONTACTO
            </p>

            <h2 className="mt-4 text-3xl font-black">Hablemos</h2>

            <div className="mt-6 space-y-4 text-zinc-300">
              <p>
                <span className="font-bold text-white">Ubicación:</span> Nuevo
                Centro Shopping, Córdoba
              </p>

              <p>
                <span className="font-bold text-white">Instagram:</span>{" "}
                <a
                  href="https://www.instagram.com/sim_argentina"
                  target="_blank"
                  className="text-red-500 hover:underline"
                >
                  @sim_argentina
                </a>
              </p>

              <p>
                <span className="font-bold text-white">Reservas:</span>{" "}
                disponibles desde nuestra web
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-red-900/60 bg-gradient-to-br from-red-950/40 to-black p-8">
            <p className="text-sm font-bold tracking-[0.3em] text-red-500">
              EMPRESAS Y EVENTOS
            </p>

            <h2 className="mt-4 text-3xl font-black">
              También trabajamos con marcas
            </h2>

            <p className="mt-5 leading-8 text-zinc-300">
              SIM Argentina también puede funcionar como una activación de alto
              impacto para empresas, eventos, campañas promocionales,
              lanzamientos de marca y acciones comerciales.
            </p>

            <Link
              href="/alquiler"
              className="mt-8 inline-block rounded-xl bg-red-600 px-6 py-3 font-bold text-white transition hover:bg-red-700"
            >
              Ver alquiler de simuladores
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}