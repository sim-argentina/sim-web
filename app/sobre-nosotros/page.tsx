import Link from "next/link";

export default function SobreNosotrosPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white overflow-hidden">
      <section className="relative min-h-[88vh] flex items-center border-b border-white/10">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(220,38,38,0.28),transparent_38%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.08),transparent_25%)]" />
        <div className="absolute inset-y-0 right-0 hidden w-1/2 skew-x-[-10deg] bg-red-600/15 md:block" />
        <div className="absolute bottom-0 left-0 h-28 w-full bg-gradient-to-t from-[#050505] to-transparent" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-5 text-sm font-black tracking-[0.45em] text-red-500">
              SIM ARGENTINA
            </p>

            <h1 className="text-6xl font-black uppercase leading-[0.92] md:text-8xl">
              No es un juego.
              <span className="block text-red-600">Es carrera.</span>
            </h1>

            <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-300">
              Somos una experiencia de simulación de Fórmula 1 creada en
              Córdoba para acercar la adrenalina del automovilismo a personas,
              grupos, fanáticos, empresas y eventos.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/reserva"
                className="rounded-full bg-red-600 px-7 py-4 text-sm font-black uppercase tracking-widest transition hover:bg-red-700"
              >
                Reservar experiencia
              </Link>

              <a
                href="https://wa.me/5493512520927"
                target="_blank"
                className="rounded-full border border-white/20 px-7 py-4 text-sm font-black uppercase tracking-widest transition hover:border-red-500 hover:text-red-500"
              >
                Escribinos
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-3xl bg-red-600 p-6">
                  <p className="text-5xl font-black">F1</p>
                  <p className="mt-3 text-sm font-bold uppercase tracking-widest">
                    Simulación
                  </p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black p-6">
                  <p className="text-4xl font-black">360°</p>
                  <p className="mt-3 text-sm text-zinc-400">
                    Experiencia inmersiva
                  </p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black p-6">
                  <p className="text-4xl font-black">15’</p>
                  <p className="mt-3 text-sm text-zinc-400">
                    Turnos dinámicos
                  </p>
                </div>

                <div className="rounded-3xl bg-white p-6 text-black">
                  <p className="text-4xl font-black">CBA</p>
                  <p className="mt-3 text-sm font-bold">
                    Nuevo Centro Shopping
                  </p>
                </div>
              </div>
            </div>

            <div className="absolute -bottom-8 -right-8 -z-10 h-48 w-48 rounded-full bg-red-600 blur-3xl opacity-30" />
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-black tracking-[0.35em] text-red-500">
              QUIÉNES SOMOS
            </p>

            <h2 className="mt-5 text-4xl font-black uppercase md:text-5xl">
              Una marca pensada para vivir la velocidad de cerca.
            </h2>
          </div>

          <div className="space-y-6 text-lg leading-9 text-zinc-300">
            <p>
              SIM Argentina nace con una idea simple: transformar la pasión por
              la Fórmula 1 en una experiencia real, accesible y emocionante. No
              buscamos que el cliente solamente juegue; buscamos que sienta que
              está entrando a pista.
            </p>

            <p>
              Nuestro stand combina simuladores, ambientación racing, atención
              personalizada y dinámica competitiva. Es una propuesta para venir
              solo, con amigos, en familia o como parte de una acción comercial
              de marca.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white text-black">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 md:grid-cols-4">
          <div className="md:col-span-1">
            <p className="text-sm font-black tracking-[0.35em] text-red-600">
              DATOS SIM
            </p>
            <h2 className="mt-4 text-4xl font-black uppercase">
              Qué vas a encontrar
            </h2>
          </div>

          <div className="md:col-span-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl border border-black/10 p-6">
              <p className="text-4xl font-black text-red-600">01</p>
              <h3 className="mt-5 text-xl font-black">Simuladores F1</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Experiencia de manejo con estética y sensación de competición.
              </p>
            </div>

            <div className="rounded-3xl border border-black/10 p-6">
              <p className="text-4xl font-black text-red-600">02</p>
              <h3 className="mt-5 text-xl font-black">Movimiento</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Butacas con respuesta física para aumentar la inmersión.
              </p>
            </div>

            <div className="rounded-3xl border border-black/10 p-6">
              <p className="text-4xl font-black text-red-600">03</p>
              <h3 className="mt-5 text-xl font-black">Desafíos</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Rankings, torneos, vueltas rápidas y experiencias grupales.
              </p>
            </div>

            <div className="rounded-3xl border border-black/10 p-6">
              <p className="text-4xl font-black text-red-600">04</p>
              <h3 className="mt-5 text-xl font-black">Eventos</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Activaciones para marcas, empresas, shoppings y campañas.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <div className="rounded-[2rem] bg-red-600 p-8 md:p-10">
            <p className="text-sm font-black tracking-[0.35em] text-black">
              EXPERIENCIA
            </p>

            <h2 className="mt-5 text-4xl font-black uppercase md:text-5xl">
              Del shopping a la pista.
            </h2>

            <p className="mt-6 text-lg leading-8 text-red-50">
              Cada turno está pensado para que el cliente pueda subirse, recibir
              una breve explicación, ajustar la posición de manejo y salir a
              girar. La experiencia es simple de entender, intensa de vivir y
              muy fácil de compartir en redes.
            </p>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 md:p-10">
            <p className="text-sm font-black tracking-[0.35em] text-red-500">
              CONDICIONES
            </p>

            <div className="mt-8 space-y-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="text-zinc-400">Altura mínima</span>
                <strong>1,40 m</strong>
              </div>

              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="text-zinc-400">Peso máximo</span>
                <strong>110 kg</strong>
              </div>

              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="text-zinc-400">Modalidad</span>
                <strong>Turnos por tiempo</strong>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Ubicación</span>
                <strong>Nuevo Centro</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.2),transparent_35%)]" />

        <div className="relative mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-10 rounded-[2rem] border border-white/10 bg-black/70 p-8 backdrop-blur md:grid-cols-[1fr_0.8fr] md:p-12">
            <div>
              <p className="text-sm font-black tracking-[0.35em] text-red-500">
                CONTACTO
              </p>

              <h2 className="mt-5 text-5xl font-black uppercase">
                ¿Querés hablar con SIM?
              </h2>

              <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-300">
                Escribinos para consultas, eventos, acciones con empresas,
                promociones o información general sobre la experiencia.
              </p>
            </div>

            <div className="space-y-4">
              <a
                href="https://wa.me/5493512520927"
                target="_blank"
                className="block rounded-2xl bg-red-600 p-5 font-black uppercase tracking-widest transition hover:bg-red-700"
              >
                WhatsApp
                <span className="block pt-2 text-sm font-medium normal-case tracking-normal text-red-100">
                  +54 9 351 252 0927
                </span>
              </a>

              <a
                href="https://www.instagram.com/sim_argentina"
                target="_blank"
                className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 font-black uppercase tracking-widest transition hover:border-red-500 hover:text-red-500"
              >
                Instagram
                <span className="block pt-2 text-sm font-medium normal-case tracking-normal text-zinc-400">
                  @sim_argentina
                </span>
              </a>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="font-black uppercase tracking-widest">
                  Ubicación
                </p>
                <p className="pt-2 text-sm text-zinc-400">
                  Nuevo Centro Shopping, Córdoba
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}