import Link from "next/link";

const fullPackages = [
  {
    title: "Full Centro",
    badge: "Zona céntrica",
    hotel: "Hotel Delplaza Excelsior o similar",
    sectors: ["G", "H"],
    color: "green",
  },
  {
    title: "Full Berrini",
    badge: "Próximo a Interlagos",
    hotel: "Hotel Intercity Berrini o similar",
    sectors: ["A", "M", "D"],
    color: "yellow",
  },
];

const alternativePackages = [
  { sector: "G", detail: "Alternativo con hotel en Berrini" },
  { sector: "R", detail: "Alternativo con hotel en Berrini" },
  { sector: "D", detail: "Alternativo con hotel en Berrini" },
];

const sectors = [
  {
    sector: "G",
    title: "Recta trasera",
    text: "Pasada la curva 3, con acceso a Fan Zone. Ideal para vivir velocidad pura.",
  },
  {
    sector: "A",
    title: "Recta principal",
    text: "Vista elevada y panorámica de distintos sectores del circuito.",
  },
  {
    sector: "R",
    title: "Curva do Sol",
    text: "Gradas cubiertas, vista a la recta de atrás y ambiente de Fan Zone.",
  },
  {
    sector: "H",
    title: "S de Senna",
    text: "Uno de los puntos más icónicos de Interlagos, con vista al pit lane.",
  },
  {
    sector: "M",
    title: "Curva 1",
    text: "Butacas numeradas y vista directa a maniobras de sobrepaso.",
  },
  {
    sector: "D",
    title: "Largada y Senna",
    text: "Final de recta principal, gradas techadas, snacks y bebidas incluidos.",
  },
];

const includes = [
  "Vuelos con carry on",
  "4 noches de alojamiento",
  "Desayuno incluido",
  "Tickets F1 para los 3 días",
  "Traslados al circuito en paquetes Full",
  "Asistencia al viajero",
  "Coordinación en destino",
  "Kit de regalo",
];

export default function ViajaConSimPage() {
  return (
    <main className="min-h-screen bg-[#050807] text-white overflow-hidden">
      <section className="relative min-h-screen px-6 pt-10 pb-20 flex items-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(0,156,59,0.45),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(255,223,0,0.35),transparent_30%),radial-gradient(circle_at_80%_80%,rgba(0,39,118,0.55),transparent_35%)]" />
        <div className="absolute inset-0 opacity-[0.13] bg-[linear-gradient(120deg,transparent_0%,transparent_48%,#ffffff_49%,transparent_50%)] bg-[length:38px_38px]" />

        <div className="absolute -right-32 top-24 h-[520px] w-[520px] rounded-full border-[55px] border-[#ffdf00]/20" />
        <div className="absolute -left-28 bottom-0 h-[420px] w-[420px] rounded-full border-[45px] border-[#009c3b]/25" />

        <div className="relative z-10 max-w-7xl mx-auto w-full">
          <div className="flex items-center justify-between mb-16">
            <Link href="/" className="text-3xl font-black italic tracking-tight">
              SIM
            </Link>

            <div className="hidden md:flex gap-7 text-sm font-bold text-white/70">
              <a href="#paquetes" className="hover:text-[#ffdf00]">Paquetes</a>
              <a href="#sectores" className="hover:text-[#ffdf00]">Sectores</a>
              <a href="#reserva" className="hover:text-[#ffdf00]">Reserva</a>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full bg-[#ffdf00] px-5 py-2 text-[#06120b] font-black text-sm uppercase tracking-widest">
                🇧🇷 São Paulo · 5 al 9 de noviembre
              </div>

              <h1 className="mt-7 text-6xl md:text-8xl font-black leading-[0.9] tracking-tight">
                GP de <br />
                <span className="text-[#009c3b]">Brasil</span>
                <br />
                <span className="text-[#ffdf00] italic">Interlagos</span>
              </h1>

              <p className="mt-7 max-w-2xl text-xl text-white/78 leading-relaxed">
                Viajá con SIM y Tiul Sports a vivir la Fórmula 1 en uno de los
                circuitos más míticos del mundo: la S de Senna, la energía de
                Brasil y un fin de semana entero de motorsport.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20consultar%20por%20el%20viaje%20al%20GP%20de%20Brasil"
                  target="_blank"
                  className="rounded-full bg-[#ffdf00] text-[#06120b] px-8 py-4 font-black shadow-[0_0_35px_rgba(255,223,0,0.35)] hover:scale-105 transition"
                >
                  Consultar disponibilidad
                </a>

                <a
                  href="#paquetes"
                  className="rounded-full border border-white/25 px-8 py-4 font-black hover:bg-white hover:text-black transition"
                >
                  Ver opciones
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 rounded-[3rem] bg-gradient-to-br from-[#009c3b] via-[#ffdf00] to-[#002776] blur-2xl opacity-40" />

              <div className="relative rounded-[3rem] overflow-hidden bg-[#08110d] border border-white/15 shadow-2xl">
                <div className="h-64 bg-[linear-gradient(135deg,#1b1b1b,#003d1c,#002776)] relative">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,223,0,0.4),transparent_25%)]" />
                  <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#08110d] to-transparent" />

                  <div className="absolute left-8 top-8">
                    <p className="text-[#ffdf00] text-sm font-black uppercase tracking-widest">
                      Espíritu Senna
                    </p>
                    <p className="mt-3 max-w-xs text-2xl font-black italic">
                      “No importa dónde corras, sino cómo lo vivas.”
                    </p>
                  </div>

                  <div className="absolute right-8 bottom-8 h-28 w-28 rounded-full border-4 border-[#ffdf00] flex items-center justify-center text-center font-black">
                    F1
                    <br />
                    2026
                  </div>
                </div>

                <div className="p-8 grid grid-cols-2 gap-4">
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-4xl font-black text-[#ffdf00]">4</p>
                    <p className="text-white/70 text-sm">noches de hotel</p>
                  </div>
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-4xl font-black text-[#ffdf00]">3</p>
                    <p className="text-white/70 text-sm">días de F1</p>
                  </div>
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-4xl font-black text-[#ffdf00]">500</p>
                    <p className="text-white/70 text-sm">USD de seña</p>
                  </div>
                  <div className="rounded-3xl bg-white/10 p-5">
                    <p className="text-4xl font-black text-[#ffdf00]">30/09</p>
                    <p className="text-white/70 text-sm">fecha límite</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 grid md:grid-cols-4 gap-4">
            {["Buenos Aires", "Córdoba", "Rosario", "Mendoza"].map((city) => (
              <div
                key={city}
                className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur p-5 text-center font-black"
              >
                Salidas desde {city}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-6 py-24 bg-white text-[#07100b]">
        <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-r from-[#009c3b] via-[#ffdf00] to-[#002776]" />

        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-12 items-center">
            <div>
              <p className="font-black uppercase tracking-[0.25em] text-[#009c3b]">
                Todo incluido
              </p>
              <h2 className="mt-4 text-5xl font-black leading-tight">
                Vos pensás en la carrera. El viaje ya está armado.
              </h2>
              <p className="mt-5 text-black/65 text-lg">
                La propuesta está pensada para que no tengas que resolver hotel,
                vuelos, entradas y logística por separado.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {includes.map((item) => (
                <div
                  key={item}
                  className="rounded-3xl bg-[#f2f4f0] border border-black/5 p-5 font-bold"
                >
                  <span className="text-[#009c3b] font-black">✓</span> {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="paquetes" className="px-6 py-24 bg-[#07100b]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-[#ffdf00] font-black uppercase tracking-[0.25em]">
              Paquetes
            </p>
            <h2 className="mt-4 text-5xl font-black">Elegí tu forma de viajar</h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-7">
            {fullPackages.map((pack) => (
              <div
                key={pack.title}
                className={`rounded-[2.5rem] p-1 shadow-2xl ${
                  pack.color === "green"
                    ? "bg-gradient-to-br from-[#009c3b] to-[#052e17]"
                    : "bg-gradient-to-br from-[#ffdf00] to-[#a98200]"
                }`}
              >
                <div className="rounded-[2.4rem] bg-[#08110d] p-8 h-full">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p
                        className={`font-black uppercase tracking-widest ${
                          pack.color === "green"
                            ? "text-[#00d85a]"
                            : "text-[#ffdf00]"
                        }`}
                      >
                        {pack.badge}
                      </p>
                      <h3 className="mt-3 text-4xl font-black">{pack.title}</h3>
                      <p className="mt-3 text-white/65">{pack.hotel}</p>
                    </div>

                    <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black">
                      FULL
                    </div>
                  </div>

                  <div className="mt-8">
                    <p className="text-sm text-white/50 uppercase font-black tracking-widest mb-3">
                      Sectores disponibles
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {pack.sectors.map((sector) => (
                        <span
                          key={sector}
                          className="h-16 w-16 rounded-2xl bg-white text-[#07100b] flex items-center justify-center text-3xl font-black"
                        >
                          {sector}
                        </span>
                      ))}
                    </div>
                  </div>

                  <a
                    href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20consultar%20por%20los%20paquetes%20Full%20para%20Brasil"
                    target="_blank"
                    className="mt-8 inline-flex rounded-full bg-[#ffdf00] text-[#07100b] px-7 py-4 font-black hover:scale-105 transition"
                  >
                    Consultar este paquete
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[2.5rem] bg-gradient-to-r from-[#002776] via-[#06120b] to-[#009c3b] p-8 border border-white/10">
            <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-8 items-center">
              <div>
                <p className="text-[#ffdf00] font-black uppercase tracking-widest">
                  Alternativos
                </p>
                <h3 className="mt-3 text-4xl font-black">
                  Para moverte a tu ritmo
                </h3>
                <p className="mt-4 text-white/70">
                  Paquetes sin traslados al circuito, con alojamiento en Berrini,
                  cerca de estación de tren con conexión a Interlagos.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                {alternativePackages.map((item) => (
                  <div
                    key={item.sector}
                    className="rounded-3xl bg-white/10 border border-white/15 p-5"
                  >
                    <p className="text-sm text-[#ffdf00] font-black uppercase">
                      Sector
                    </p>
                    <p className="text-5xl font-black">{item.sector}</p>
                    <p className="text-white/60 text-sm mt-2">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-7 text-sm text-white/55">
              También se puede consultar por opciones sin vuelos.
            </p>
          </div>
        </div>
      </section>

      <section id="sectores" className="px-6 py-24 bg-[#f6f6f1] text-[#07100b]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <p className="text-[#009c3b] font-black uppercase tracking-[0.25em]">
                Interlagos
              </p>
              <h2 className="mt-4 text-5xl font-black">
                Cada sector tiene su propia carrera
              </h2>
            </div>

            <p className="max-w-md text-black/60">
              Elegí entre rectas, curvas, zonas cubiertas, Fan Zone y vistas
              directas a los puntos más calientes del circuito.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sectors.map((item) => (
              <div
                key={item.sector}
                className="group rounded-[2rem] bg-white border border-black/5 p-6 shadow-sm hover:-translate-y-1 hover:shadow-xl transition"
              >
                <div className="flex items-center justify-between">
                  <div className="h-16 w-16 rounded-2xl bg-[#07100b] text-[#ffdf00] flex items-center justify-center text-3xl font-black">
                    {item.sector}
                  </div>
                  <div className="h-2 w-20 rounded-full bg-gradient-to-r from-[#009c3b] via-[#ffdf00] to-[#002776]" />
                </div>

                <h3 className="mt-6 text-2xl font-black">{item.title}</h3>
                <p className="mt-3 text-black/65">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="reserva" className="relative px-6 py-24 bg-[#07100b]">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_50%,#009c3b,transparent_30%),radial-gradient(circle_at_80%_50%,#ffdf00,transparent_25%)]" />

        <div className="relative max-w-7xl mx-auto grid lg:grid-cols-2 gap-8">
          <div className="rounded-[2.5rem] bg-white/10 border border-white/15 p-8">
            <p className="text-[#ffdf00] font-black uppercase tracking-widest">
              Cómo reservar
            </p>
            <h2 className="mt-3 text-4xl font-black">Asegurá tu lugar</h2>

            <div className="mt-8 space-y-5">
              {[
                "Seña de USD 500 por pasajero para confirmar la reserva.",
                "El saldo puede abonarse en cuotas mensuales o en un pago total.",
                "El viaje debe estar abonado antes del 30/09.",
                "La seña no es reembolsable y la preventa es hasta agotar stock.",
              ].map((text) => (
                <div key={text} className="flex gap-4">
                  <span className="mt-1 h-6 w-6 rounded-full bg-[#009c3b] flex items-center justify-center text-sm font-black">
                    ✓
                  </span>
                  <p className="text-white/75">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.5rem] bg-[#ffdf00] text-[#07100b] p-8">
            <p className="font-black uppercase tracking-widest">
              Formas de pago
            </p>
            <h2 className="mt-3 text-4xl font-black">Simple y flexible</h2>

            <div className="mt-8 space-y-4 font-bold">
              <p>Transferencia o depósito en dólares.</p>
              <p>Tarjeta de crédito con consumo en dólares.</p>
              <p>Efectivo en sucursales Tiul.</p>
            </div>

            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20reservar%20mi%20lugar%20para%20el%20GP%20de%20Brasil"
              target="_blank"
              className="mt-9 inline-flex rounded-full bg-[#07100b] text-white px-8 py-4 font-black hover:scale-105 transition"
            >
              Quiero reservar mi lugar
            </a>
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-white text-[#07100b]">
        <div className="max-w-7xl mx-auto rounded-[3rem] overflow-hidden bg-[#07100b] text-white grid lg:grid-cols-[0.9fr_1.1fr]">
          <div className="p-10 md:p-14">
            <p className="text-[#ffdf00] font-black uppercase tracking-widest">
              Experiencia
            </p>
            <h2 className="mt-4 text-5xl font-black leading-tight">
              +250 personas ya viajaron con Tiul
            </h2>
            <p className="mt-6 text-white/70 text-lg">
              Una propuesta para vivir la F1 con una estructura ya resuelta:
              viaje, hotel, entradas y asistencia.
            </p>
          </div>

          <div className="relative min-h-[320px] bg-gradient-to-br from-[#009c3b] via-[#ffdf00] to-[#002776] p-10 flex items-end">
            <div className="absolute inset-0 opacity-30 bg-[linear-gradient(135deg,transparent_0%,transparent_46%,#fff_48%,transparent_50%)] bg-[length:42px_42px]" />
            <div className="relative rounded-3xl bg-black/70 backdrop-blur p-7 max-w-md">
              <p className="text-2xl font-black italic">
                No es lo mismo simularlo que vivirlo.
              </p>
              <p className="mt-3 text-white/65">
                Brasil, F1, Interlagos y una experiencia completa de viaje.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-[#07100b] text-center">
        <div className="max-w-4xl mx-auto">
          <p className="text-[#009c3b] font-black uppercase tracking-[0.25em]">
            Brasil te espera
          </p>
          <h2 className="mt-5 text-5xl md:text-7xl font-black leading-tight">
            Viví la F1 donde la historia pesa.
          </h2>
          <p className="mt-6 text-white/70 text-lg">
            Consultanos por disponibilidad, sectores, vuelos y opciones de
            paquete para el GP de São Paulo 2026.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a
              href="https://wa.me/5493512520927?text=Hola%20SIM%2C%20quiero%20informaci%C3%B3n%20del%20viaje%20al%20GP%20de%20Brasil"
              target="_blank"
              className="rounded-full bg-[#ffdf00] text-[#07100b] px-9 py-4 font-black hover:scale-105 transition"
            >
              Hablar por WhatsApp
            </a>

            <Link
              href="/"
              className="rounded-full border border-white/20 px-9 py-4 font-black hover:bg-white hover:text-black transition"
            >
              Volver al inicio
            </Link>
          </div>

          <p className="mt-10 text-xs text-white/40">
            Información basada en la propuesta de Tiul Sports para GP São Paulo
            2026. Tarifas y disponibilidad sujetas a confirmación.
          </p>
        </div>
      </section>
    </main>
  );
}