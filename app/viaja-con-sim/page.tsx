import Link from "next/link";

const paquetesFull = [
  {
    nombre: "Full Centro",
    hotel: "Hotel Delplaza Excelsior o similar",
    zona: "Zona céntrica",
    sectores: [
      { sector: "G", bsas: "USD 2.490", interior: "USD 2.690" },
      { sector: "H", bsas: "USD 3.190", interior: "USD 3.390" },
    ],
  },
  {
    nombre: "Full Berrini",
    hotel: "Hotel Intercity Berrini o similar",
    zona: "Próximo a Interlagos",
    sectores: [
      { sector: "A", bsas: "USD 2.890", interior: "USD 3.090" },
      { sector: "M", bsas: "USD 3.790", interior: "USD 3.990" },
      { sector: "D", bsas: "USD 3.990", interior: "USD 4.190" },
    ],
  },
];

const alternativos = [
  { sector: "G", bsas: "USD 2.390", interior: "USD 2.590" },
  { sector: "R", bsas: "USD 2.790", interior: "USD 2.990" },
  { sector: "D", bsas: "USD 3.590", interior: "USD 3.790" },
];

const sectores = [
  {
    sector: "G",
    texto:
      "Recta trasera, pasada la curva 3. Butacas sin numerar descubiertas. A 2 km del punto de encuentro. Acceso a Fan Zone.",
  },
  {
    sector: "A",
    texto:
      "Recta de meta con gradas descubiertas. Vista elevada para ver distintos sectores del circuito. A 500 m del punto de encuentro.",
  },
  {
    sector: "R",
    texto:
      "Inicio de la recta de atrás, gradas cubiertas y vista de Curva do Sol. A 1,5 km del punto de encuentro. Acceso a Fan Zone.",
  },
  {
    sector: "H",
    texto:
      "Vista a la S de Senna, recta trasera y salida del pit lane. Gradas cubiertas. A 900 m del punto de encuentro. Acceso a Fan Zone.",
  },
  {
    sector: "M",
    texto:
      "Junto a la curva 1, butacas numeradas cubiertas. Ideal para ver maniobras de sobrepaso. A 700 m del punto de encuentro.",
  },
  {
    sector: "D",
    texto:
      "Final de recta principal e inicio de la S de Senna. Gradas techadas. Incluye snacks y bebidas. A 800 m del punto de encuentro.",
  },
];

export default function ViajaConSimPage() {
  return (
    <main className="min-h-screen bg-[#06120b] text-white overflow-hidden">
      <section className="relative min-h-[92vh] flex items-center px-6 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#00a85955,transparent_35%),radial-gradient(circle_at_bottom_right,#ffdf0050,transparent_35%)]" />
        <div className="absolute inset-0 opacity-20 bg-[linear-gradient(135deg,#009c3b_25%,transparent_25%),linear-gradient(225deg,#009c3b_25%,transparent_25%),linear-gradient(45deg,#ffdf00_25%,transparent_25%),linear-gradient(315deg,#ffdf00_25%,#06120b_25%)] bg-[length:80px_80px]" />

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[#ffdf00] font-black tracking-[0.35em] uppercase mb-4">
              SIM Argentina x Tiul Sports
            </p>

            <h1 className="text-5xl md:text-7xl font-black leading-tight">
              Viví el GP de Brasil en Interlagos
            </h1>

            <p className="mt-6 text-xl text-white/85 max-w-xl">
              Del 5 al 9 de noviembre de 2026 viajamos a São Paulo para vivir
              la Fórmula 1 desde adentro: vuelos, hotel, tickets para los 3
              días, asistencia y toda la energía de Brasil.
            </p>

            <div className="flex flex-wrap gap-4 mt-8">
              <a
                href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20consultar%20por%20el%20viaje%20al%20GP%20de%20Brasil"
                target="_blank"
                className="rounded-full bg-[#ffdf00] text-[#06120b] px-7 py-4 font-black hover:scale-105 transition"
              >
                Consultar disponibilidad
              </a>

              <a
                href="#paquetes"
                className="rounded-full border border-white/30 px-7 py-4 font-black hover:bg-white hover:text-[#06120b] transition"
              >
                Ver paquetes
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-[2.5rem] bg-gradient-to-br from-[#009c3b] via-[#ffdf00] to-[#002776] p-1 shadow-2xl">
              <div className="rounded-[2.4rem] bg-black/80 p-8">
                <div className="text-center">
                  <p className="text-[#ffdf00] text-sm font-black uppercase tracking-widest">
                    Formula 1
                  </p>
                  <h2 className="text-4xl font-black mt-2">GP São Paulo</h2>
                  <p className="text-white/70 mt-2">Noviembre 2026</p>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-4">
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-3xl font-black text-[#ffdf00]">4</p>
                    <p className="text-white/75">noches de hotel</p>
                  </div>
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-3xl font-black text-[#ffdf00]">3</p>
                    <p className="text-white/75">días de F1</p>
                  </div>
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-3xl font-black text-[#ffdf00]">500</p>
                    <p className="text-white/75">USD de seña</p>
                  </div>
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-3xl font-black text-[#ffdf00]">30/09</p>
                    <p className="text-white/75">saldo final</p>
                  </div>
                </div>

                <p className="mt-8 text-center text-white/70">
                  Salidas desde Buenos Aires, Córdoba, Rosario y Mendoza.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20 bg-[#ffdf00] text-[#06120b]">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-6 text-center">
          {["Vuelos con carry on", "Hotel con desayuno", "Tickets 3 días", "Asistencia al viajero"].map(
            (item) => (
              <div key={item} className="rounded-3xl bg-white/70 p-6 font-black">
                {item}
              </div>
            )
          )}
        </div>
      </section>

      <section className="px-6 py-24 bg-[#06120b]">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-[#ffdf00] font-black uppercase tracking-widest">
              Circuito Interlagos
            </p>
            <h2 className="text-4xl md:text-5xl font-black mt-3">
              Donde la F1 se vive con samba, lluvia y sobrepasos imposibles
            </h2>
          </div>
          <p className="text-white/75 text-lg">
            Interlagos es uno de los circuitos más icónicos del calendario:
            combina la mística de la S de Senna, sectores técnicos como Bico de
            Pato y tramos de potencia pura como la Subida dos Boxes.
          </p>
        </div>
      </section>

      <section id="paquetes" className="px-6 py-24 bg-white text-[#06120b]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[#009c3b] font-black uppercase tracking-widest">
              Paquetes disponibles
            </p>
            <h2 className="text-4xl md:text-5xl font-black mt-3">
              Elegí cómo querés vivir Brasil
            </h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {paquetesFull.map((pack) => (
              <div
                key={pack.nombre}
                className="rounded-[2rem] border-2 border-[#009c3b] p-8 shadow-xl"
              >
                <p className="text-[#002776] font-black">{pack.zona}</p>
                <h3 className="text-3xl font-black mt-2">{pack.nombre}</h3>
                <p className="text-black/60 mt-2">{pack.hotel}</p>

                <div className="mt-8 space-y-4">
                  {pack.sectores.map((s) => (
                    <div
                      key={s.sector}
                      className="flex items-center justify-between rounded-2xl bg-[#f4f4f4] p-4"
                    >
                      <span className="font-black text-xl text-[#009c3b]">
                        Sector {s.sector}
                      </span>
                      <div className="text-right">
                        <p className="font-black">{s.bsas} desde Bs.As.</p>
                        <p className="text-sm text-black/60">
                          {s.interior} desde Cba/Ros/Mza
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-[2rem] bg-[#002776] text-white p-8">
            <h3 className="text-3xl font-black">Paquetes alternativos</h3>
            <p className="text-white/75 mt-3">
              Para quienes prefieren manejar sus horarios de ida y vuelta al
              circuito. Incluyen vuelos, hotel Park Inn by Radisson Berrini con
              desayuno y tickets F1 para los 3 días.
            </p>

            <div className="grid md:grid-cols-3 gap-4 mt-8">
              {alternativos.map((s) => (
                <div key={s.sector} className="rounded-2xl bg-white/10 p-5">
                  <p className="text-[#ffdf00] text-2xl font-black">
                    Sector {s.sector}
                  </p>
                  <p className="mt-3 font-black">{s.bsas} desde Bs.As.</p>
                  <p className="text-white/70">{s.interior} desde Cba/Ros/Mza</p>
                </div>
              ))}
            </div>

            <p className="mt-6 text-sm text-white/70">
              También se puede contratar sin vuelos. En ese caso se descuentan
              USD 600 sobre el paquete con salida desde Buenos Aires.
            </p>
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-[#009c3b] text-white">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-[#ffdf00] font-black uppercase tracking-widest">
              Sectores del circuito
            </p>
            <h2 className="text-4xl md:text-5xl font-black mt-3">
              Cada tribuna tiene su propia carrera
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sectores.map((s) => (
              <div
                key={s.sector}
                className="rounded-[2rem] bg-white text-[#06120b] p-6 shadow-xl"
              >
                <p className="text-4xl font-black text-[#002776]">
                  {s.sector}
                </p>
                <p className="mt-4 text-black/75">{s.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-[#06120b]">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-10">
          <div className="rounded-[2rem] bg-white/10 p-8">
            <p className="text-[#ffdf00] font-black uppercase tracking-widest">
              Cómo reservar
            </p>
            <h2 className="text-4xl font-black mt-3">Asegurá tu lugar</h2>

            <div className="mt-8 space-y-4 text-white/80">
              <p>
                <strong className="text-white">Seña:</strong> USD 500 por
                pasajero para confirmar la reserva.
              </p>
              <p>
                <strong className="text-white">Pago:</strong> cuotas mensuales o
                pago total del saldo.
              </p>
              <p>
                <strong className="text-white">Fecha límite:</strong> el viaje
                debe estar abonado antes del 30/09.
              </p>
              <p>
                <strong className="text-white">Importante:</strong> la seña no
                es reembolsable y la preventa es hasta agotar stock.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] bg-[#ffdf00] text-[#06120b] p-8">
            <p className="font-black uppercase tracking-widest">Formas de pago</p>
            <h2 className="text-4xl font-black mt-3">Simple y flexible</h2>

            <div className="mt-8 space-y-4 font-bold">
              <p>Efectivo en sucursales Tiul.</p>
              <p>Transferencia o depósito en dólares.</p>
              <p>Tarjeta de crédito con consumo en dólares.</p>
            </div>

            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20reservar%20mi%20lugar%20para%20el%20GP%20de%20Brasil"
              target="_blank"
              className="inline-block mt-8 rounded-full bg-[#06120b] text-white px-7 py-4 font-black hover:scale-105 transition"
            >
              Quiero reservar
            </a>
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-white text-[#06120b]">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-[#009c3b] font-black uppercase tracking-widest">
            Experiencia comprobada
          </p>
          <h2 className="text-4xl md:text-5xl font-black mt-3">
            Más de 250 personas ya viajaron con Tiul
          </h2>
          <p className="text-black/65 mt-5 max-w-2xl mx-auto text-lg">
            Una propuesta pensada para que no tengas que armar el viaje desde
            cero: elegís sector, confirmás tu lugar y vivís el fin de semana de
            F1 en São Paulo.
          </p>
        </div>
      </section>

      <section className="px-6 py-24 bg-[#002776] text-white">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[#ffdf00] font-black uppercase tracking-widest">
            Brasil te espera
          </p>
          <h2 className="text-4xl md:text-6xl font-black mt-4">
            No es lo mismo simularlo que vivirlo.
          </h2>
          <p className="text-white/75 mt-6 text-lg">
            Consultanos por disponibilidad, sectores y salidas desde tu ciudad.
          </p>

          <div className="flex flex-wrap justify-center gap-4 mt-9">
            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20informaci%C3%B3n%20del%20viaje%20al%20GP%20de%20Brasil"
              target="_blank"
              className="rounded-full bg-[#ffdf00] text-[#06120b] px-8 py-4 font-black hover:scale-105 transition"
            >
              Hablar por WhatsApp
            </a>

            <Link
              href="/"
              className="rounded-full border border-white/30 px-8 py-4 font-black hover:bg-white hover:text-[#002776] transition"
            >
              Volver al inicio
            </Link>
          </div>

          <p className="text-xs text-white/50 mt-10">
            Tarifas por persona en base doble, expresadas en dólares, sujetas a
            modificación y disponibilidad al momento de la reserva.
          </p>
        </div>
      </section>
    </main>
  );
}