import Image from "next/image";
import Link from "next/link";

const includes = [
  "Vuelos con carry on",
  "Hotel con desayuno",
  "Tickets F1 3 días",
  "Asistencia al viajero",
];

const fullPackages = [
  {
    title: "Full Centro",
    subtitle: "Zona céntrica",
    hotel: "Hotel Delplaza Excelsior o similar",
    sectors: ["G", "H"],
  },
  {
    title: "Full Berrini",
    subtitle: "Próximo a Interlagos",
    hotel: "Hotel Intercity Berrini o similar",
    sectors: ["A", "M", "D"],
  },
];

const alternativePackages = [
  { sector: "G", text: "Hotel en Berrini + tickets F1" },
  { sector: "R", text: "Hotel en Berrini + tickets F1" },
  { sector: "D", text: "Hotel en Berrini + tickets F1" },
];

const sectors = [
  {
    sector: "G",
    title: "Recta trasera",
    text: "Pasada la curva 3. Acceso a Fan Zone.",
  },
  {
    sector: "A",
    title: "Recta de meta",
    text: "Vista elevada de distintos sectores del circuito.",
  },
  {
    sector: "R",
    title: "Curva do Sol",
    text: "Gradas cubiertas y ambiente de Fan Zone.",
  },
  {
    sector: "H",
    title: "S de Senna",
    text: "Vista al pit lane y uno de los sectores más míticos.",
  },
  {
    sector: "M",
    title: "Curva 1",
    text: "Butacas numeradas y maniobras de sobrepaso.",
  },
  {
    sector: "D",
    title: "Largada",
    text: "Final de recta principal e inicio de la S de Senna.",
  },
];

export default function ViajaConSimPage() {
  return (
    <main className="min-h-screen bg-[#060807] text-white overflow-hidden">
      <section className="relative min-h-screen bg-[#080b09]">
        <Image
          src="/viaja-con-sim/interlagos-f1.png"
          alt="F1 en Interlagos"
          fill
          priority
          className="object-cover opacity-60"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060807] via-transparent to-black/40" />

        <Image
          src="/viaja-con-sim/bandera-brasil.jpg"
          alt="Bandera de Brasil"
          width={900}
          height={600}
          className="absolute right-[-150px] bottom-[-120px] w-[720px] rotate-[-14deg] opacity-55"
        />

        <Image
          src="/viaja-con-sim/senna.jpg"
          alt="Ayrton Senna"
          width={500}
          height={700}
          className="absolute right-0 bottom-0 hidden lg:block h-[620px] w-auto object-cover grayscale opacity-85 mix-blend-luminosity"
        />

        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-10 pb-20">
          <header className="flex items-center justify-between mb-20">
            <div className="flex items-center gap-4">
              <Image
                src="/viaja-con-sim/logo-sim.png"
                alt="SIM"
                width={110}
                height={45}
                className="h-10 w-auto"
              />
              <span className="text-white/40 font-black">x</span>
              <Image
                src="/viaja-con-sim/logo-tiul.png"
                alt="Tiul Sports"
                width={130}
                height={45}
                className="h-10 w-auto"
              />
            </div>

            <Link
              href="/"
              className="hidden md:block rounded-full border border-white/20 px-5 py-2 text-sm font-black hover:bg-white hover:text-black transition"
            >
              Volver al inicio
            </Link>
          </header>

          <div className="max-w-3xl">
            <div className="inline-block bg-[#ffdf00] text-black px-5 py-2 font-black uppercase tracking-wider -skew-x-12">
              <span className="block skew-x-12">
                Viví la F1 donde todo pasa
              </span>
            </div>

            <h1 className="mt-7 text-6xl md:text-8xl font-black uppercase leading-[0.88] tracking-tight">
              GP de Brasil
              <span className="block text-[#00b050] italic">Interlagos</span>
              <span className="block text-[#ffdf00]">2026</span>
            </h1>

            <p className="mt-6 text-xl md:text-2xl font-bold text-white/90">
              São Paulo · 5 al 9 de noviembre
            </p>

            <div className="mt-9 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl">
              {includes.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl bg-black/45 border border-[#00b050]/40 p-4 backdrop-blur"
                >
                  <div className="h-9 w-9 rounded-full bg-[#00b050]/20 border border-[#00b050] mb-3 flex items-center justify-center text-[#00ff66] font-black">
                    ✓
                  </div>
                  <p className="text-xs font-black uppercase">{item}</p>
                </div>
              ))}
            </div>

            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20consultar%20por%20el%20viaje%20al%20GP%20de%20Brasil"
              target="_blank"
              className="mt-9 inline-flex rounded-full bg-[#ffdf00] text-black px-9 py-4 font-black uppercase shadow-[0_0_45px_rgba(255,223,0,0.35)] hover:scale-105 transition"
            >
              Consultar disponibilidad
            </a>
          </div>
        </div>
      </section>

      <section className="relative z-20 -mt-16 px-6">
        <div className="max-w-6xl mx-auto rounded-3xl bg-gradient-to-r from-[#053d1e] via-[#075c2d] to-[#053d1e] border border-[#00b050]/40 shadow-2xl p-6 md:p-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <p className="text-5xl font-black">4</p>
            <p className="text-xs uppercase font-bold text-white/70">noches de hotel</p>
          </div>
          <div>
            <p className="text-5xl font-black">3</p>
            <p className="text-xs uppercase font-bold text-white/70">días de F1</p>
          </div>
          <div>
            <p className="text-5xl font-black">USD 500</p>
            <p className="text-xs uppercase font-bold text-white/70">seña para reservar</p>
          </div>
          <div>
            <p className="text-5xl font-black">30/09</p>
            <p className="text-xs uppercase font-bold text-white/70">fecha límite</p>
          </div>
        </div>
      </section>

      <section id="paquetes" className="bg-[#f4f4ef] text-black px-6 pt-24 pb-16">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10">
            <h2 className="text-4xl md:text-5xl font-black uppercase italic">
              Paquetes Full
            </h2>
            <p className="text-[#009c3b] font-black uppercase mt-2">
              Todo incluido para que solo te preocupes por disfrutar
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {fullPackages.map((pack, index) => (
              <div
                key={pack.title}
                className={`rounded-[2rem] overflow-hidden shadow-xl border ${
                  index === 0
                    ? "bg-gradient-to-br from-[#006b32] to-[#003d1c] text-white border-[#00b050]"
                    : "bg-gradient-to-br from-[#ffdf00] to-[#d8a900] text-black border-[#ffdf00]"
                }`}
              >
                <div className="p-8">
                  <p className="font-black uppercase text-sm opacity-80">
                    {pack.subtitle}
                  </p>
                  <h3 className="text-4xl font-black uppercase italic mt-2">
                    {pack.title}
                  </h3>
                  <p className="mt-3 font-bold opacity-80">{pack.hotel}</p>

                  <div className="mt-8 rounded-2xl overflow-hidden bg-white text-black">
                    <div className="grid grid-cols-2 bg-black text-white text-xs uppercase font-black">
                      <div className="p-4">Sector</div>
                      <div className="p-4">Incluye</div>
                    </div>

                    {pack.sectors.map((sector) => (
                      <div
                        key={sector}
                        className="grid grid-cols-2 border-t border-black/10 items-center"
                      >
                        <div className="p-4 text-4xl font-black">{sector}</div>
                        <div className="p-4 font-black text-sm">
                          Vuelo + hotel + ticket F1
                        </div>
                      </div>
                    ))}
                  </div>

                  <a
                    href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20consultar%20por%20los%20paquetes%20Full%20del%20GP%20de%20Brasil"
                    target="_blank"
                    className={`mt-7 inline-flex rounded-full px-7 py-3 font-black uppercase transition hover:scale-105 ${
                      index === 0 ? "bg-[#ffdf00] text-black" : "bg-black text-white"
                    }`}
                  >
                    Consultar paquete
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative bg-[#080b09] px-6 py-20 overflow-hidden">
        <Image
          src="/viaja-con-sim/bandera-brasil.jpg"
          alt="Brasil"
          fill
          className="object-cover opacity-15"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/50" />

        <div className="relative max-w-7xl mx-auto grid lg:grid-cols-[1fr_0.75fr] gap-10 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-black uppercase italic text-[#00b050]">
              Paquetes Alternativos
            </h2>
            <p className="mt-4 max-w-2xl text-white/75">
              Para quienes prefieren manejar sus horarios de ida y vuelta al
              circuito. Incluyen hotel en Berrini, desayuno y tickets F1 para
              los tres días.
            </p>

            <div className="mt-8 grid md:grid-cols-3 gap-5">
              {alternativePackages.map((item) => (
                <div
                  key={item.sector}
                  className="rounded-2xl border border-[#00b050]/60 bg-black/55 p-5"
                >
                  <p className="text-[#00b050] uppercase font-black text-sm">
                    Sector
                  </p>
                  <p className="text-6xl font-black">{item.sector}</p>
                  <p className="text-sm text-white/60 mt-2">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/20 bg-black/60 p-8">
            <p className="text-[#ffdf00] font-black uppercase">
              También se puede contratar sin vuelos
            </p>
            <p className="mt-4 text-white/70">
              Consultá disponibilidad para armar la opción que mejor se adapte a
              tu viaje.
            </p>
          </div>
        </div>
      </section>

      <section id="sectores" className="bg-[#f4f4ef] text-black px-6 py-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black uppercase italic">
            Sectores del circuito
          </h2>
          <p className="text-[#009c3b] font-black uppercase mt-2">
            Elegí tu lugar en la acción
          </p>

          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sectors.map((item) => (
              <div
                key={item.sector}
                className="rounded-2xl bg-[#08110d] text-white overflow-hidden shadow-xl border border-black/10"
              >
                <div className="h-28 relative">
                  <Image
                    src="/viaja-con-sim/interlagos-f1.png"
                    alt="Interlagos"
                    fill
                    className="object-cover opacity-70"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#08110d] to-transparent" />
                </div>

                <div className="p-5">
                  <div className="h-16 w-16 -mt-12 relative z-10 rounded-full border-4 border-[#ffdf00] bg-black flex items-center justify-center text-3xl font-black">
                    {item.sector}
                  </div>

                  <h3 className="mt-4 text-2xl font-black">{item.title}</h3>
                  <p className="mt-3 text-white/65 text-sm">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="reserva" className="relative bg-[#080b09] px-6 py-20 overflow-hidden">
        <Image
          src="/viaja-con-sim/helmet-senna.jpg"
          alt="Casco de Senna"
          width={420}
          height={520}
          className="absolute right-0 bottom-0 hidden lg:block w-[360px] opacity-90"
        />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_40%,rgba(0,156,59,0.25),transparent_30%),radial-gradient(circle_at_70%_50%,rgba(255,223,0,0.15),transparent_25%)]" />

        <div className="relative max-w-7xl mx-auto grid lg:grid-cols-2 gap-10">
          <div className="rounded-3xl bg-black/55 border border-white/10 p-8">
            <p className="text-[#00b050] uppercase font-black">Cómo reservar</p>
            <h2 className="text-4xl font-black uppercase italic mt-2">
              Asegurá tu lugar
            </h2>

            <div className="mt-8 space-y-4">
              {[
                "Seña de USD 500 por pasajero para confirmar la reserva.",
                "Cuotas mensuales o pago total del saldo.",
                "El viaje debe estar abonado antes del 30/09.",
                "La preventa es hasta agotar stock.",
              ].map((item) => (
                <p key={item} className="flex gap-3 text-white/75">
                  <span className="text-[#00b050] font-black">✓</span>
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-black/55 border border-white/10 p-8">
            <p className="text-[#00b050] uppercase font-black">Formas de pago</p>
            <h2 className="text-4xl font-black uppercase italic mt-2">
              Simple y flexible
            </h2>

            <div className="mt-8 space-y-4">
              {[
                "Efectivo en sucursales Tiul.",
                "Transferencia o depósito en dólares.",
                "Tarjeta de crédito con consumo en dólares.",
              ].map((item) => (
                <p key={item} className="flex gap-3 text-white/75">
                  <span className="text-[#ffdf00] font-black">✓</span>
                  {item}
                </p>
              ))}
            </div>

            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20reservar%20mi%20lugar%20para%20el%20GP%20de%20Brasil"
              target="_blank"
              className="mt-8 inline-flex rounded-full bg-[#ffdf00] text-black px-8 py-4 font-black uppercase hover:scale-105 transition"
            >
              Quiero reservar mi lugar
            </a>
          </div>
        </div>
      </section>

      <section className="bg-[#f4f4ef] text-black px-6 py-14">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-[0.6fr_1.4fr] gap-8 items-center">
          <div className="text-center">
            <p className="text-5xl font-black">+250</p>
            <p className="font-black uppercase">personas ya viajaron con Tiul</p>
          </div>

          <div className="relative rounded-3xl overflow-hidden min-h-[190px] p-8 flex items-center">
            <Image
              src="/viaja-con-sim/bandera-brasil.jpg"
              alt="Bandera Brasil"
              fill
              className="object-cover"
            />
            <div className="absolute inset-0 bg-black/45" />
            <div className="relative max-w-xl rounded-2xl bg-black/70 p-6 text-white">
              <p className="text-2xl font-black italic">
                “Una experiencia increíble, todo organizado al detalle para que
                solo tengas que disfrutar la F1.”
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#080b09] px-6 py-16">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-8">
          <div>
            <h2 className="text-5xl md:text-6xl font-black uppercase italic">
              <span className="text-[#00b050]">Brasil</span> te espera
            </h2>
            <p className="mt-3 text-xl text-white/75">
              No es lo mismo simularlo que vivirlo.
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20informaci%C3%B3n%20del%20viaje%20al%20GP%20de%20Brasil"
              target="_blank"
              className="rounded-full bg-[#ffdf00] text-black px-8 py-4 font-black uppercase hover:scale-105 transition"
            >
              Hablar por WhatsApp
            </a>

            <Link
              href="/"
              className="rounded-full border border-white/20 px-8 py-4 font-black uppercase hover:bg-white hover:text-black transition"
            >
              Volver al inicio
            </Link>
          </div>
        </div>

        <p className="max-w-7xl mx-auto mt-10 text-xs text-white/35">
          Información basada en la propuesta de Tiul Sports para GP São Paulo
          2026. Disponibilidad sujeta a confirmación.
        </p>
      </section>
    </main>
  );
}