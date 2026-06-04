"use client";

import Link from "next/link";
import { MessageCircle, ArrowRight, ArrowDown } from "lucide-react";

const WA = "https://wa.me/5493512520927";
const WA_MSG = (butaca: string) =>
  `${WA}?text=${encodeURIComponent(`Hola! Me interesa el Simulador SIM con butaca ${butaca}. ¿Podés darme más información?`)}`;

const COMPONENTES = [
  { num: "01", nombre: "Moza R5 Bundle", detalle: "Base de fuerza directa + volante + pedalera de 3 pedales." },
  { num: "02", nombre: "Pantalla Samsung 49\"", detalle: "Curva ultrawide, resolución 5120×1440, refresh 240 Hz." },
  { num: "03", nombre: "Estructura SIM", detalle: "Chasis de acero fabricado a medida en Argentina. Ajuste de posición." },
  { num: "04", nombre: "PC Gaming", detalle: "Configuración de alto rendimiento. Especificaciones a confirmar." },
];

const BUTACAS = [
  {
    id: "cmf-pro",
    num: "A",
    nombre: "CMF Pro",
    descripcion: "Posición de conducción reclinada, soporte lumbar integrado y tapizado en cuero sintético. La elección para sesiones largas.",
    etiqueta: "Confort extremo",
  },
  {
    id: "bucket",
    num: "B",
    nombre: "Bucket Racing",
    descripcion: "Estructura rígida tipo monoposto, laterales altos de contención y posición de manejo más agresiva. La elección del piloto.",
    etiqueta: "Estilo pista",
  },
];

// Placeholder visual para cuando no hay foto
function Placeholder({ label, tall }: { label?: string; tall?: boolean }) {
  return (
    <div
      className={`relative flex w-full items-center justify-center overflow-hidden bg-zinc-950 ${tall ? "aspect-[16/9]" : "aspect-square"}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 40px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 40px)",
      }}
    >
      {/* cruz central */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute h-px w-16 bg-white/10" />
        <div className="absolute h-16 w-px bg-white/10" />
      </div>

      <div className="relative text-center">
        <p className="text-5xl font-black uppercase tracking-widest text-white/[0.06] select-none">SIM</p>
        {label && (
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.4em] text-white/20">{label}</p>
        )}
      </div>

      {/* esquinas */}
      {[
        "top-3 left-3 border-t border-l",
        "top-3 right-3 border-t border-r",
        "bottom-3 left-3 border-b border-l",
        "bottom-3 right-3 border-b border-r",
      ].map((cls) => (
        <div key={cls} className={`absolute h-5 w-5 border-white/15 ${cls}`} />
      ))}
    </div>
  );
}

export default function TiendaPage() {
  return (
    <main className="min-h-screen bg-black text-white overflow-x-hidden">

      {/* ══════════════════════════════════════════════
          PORTADA
      ══════════════════════════════════════════════ */}
      <section className="relative flex min-h-[92vh] flex-col justify-between border-b border-white/8 px-6 pb-10 pt-24 md:px-16">
        {/* fondo tipográfico */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <p className="select-none text-[22vw] font-black uppercase leading-none text-white/[0.025]">
            SIM
          </p>
        </div>

        {/* línea roja izquierda */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-600" />

        {/* eyebrow */}
        <div className="flex items-center gap-4">
          <div className="h-px w-10 bg-red-600" />
          <p className="text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
            SIM Argentina · Tienda
          </p>
        </div>

        {/* título principal */}
        <div className="relative">
          <p className="mb-4 text-[10px] font-black uppercase tracking-[0.4em] text-white/30 md:text-xs">
            Simuladores de Fórmula 1 &amp; Pista
          </p>
          <h1 className="text-[13vw] font-black uppercase leading-[0.85] md:text-[10vw]">
            La má<span className="text-red-600">quina.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-8 text-white/40 md:ml-2">
            El mismo simulador que usamos en pista, fabricado y configurado en Argentina. Dos opciones de butaca, un nivel de experiencia.
          </p>
        </div>

        {/* bottom bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <Link
            href={WA}
            target="_blank"
            className="inline-flex items-center gap-3 rounded-full bg-red-600 px-7 py-4 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black w-fit"
          >
            <MessageCircle className="h-4 w-4" />
            Consultar por WhatsApp
          </Link>

          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.4em] text-white/20">
            <ArrowDown className="h-4 w-4 animate-bounce" />
            Ver especificaciones
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FOTO HERO + INTRO
      ══════════════════════════════════════════════ */}
      <section className="grid md:grid-cols-[1fr_1px_1fr]">
        {/* imagen grande */}
        <div className="md:col-span-1">
          <Placeholder label="Foto del simulador" tall />
        </div>

        {/* divisor */}
        <div className="hidden bg-white/8 md:block" />

        {/* texto lateral */}
        <div className="flex flex-col justify-between border-b border-white/8 p-8 md:border-b-0 md:p-14">
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
              Descripción
            </p>
            <p className="text-2xl font-black uppercase leading-tight md:text-3xl">
              Ingeniería de pista.<br />
              <span className="text-white/30">Para tu casa.</span>
            </p>
            <p className="mt-6 text-sm leading-8 text-white/40">
              Cada unidad es ensamblada y calibrada en Argentina por el equipo de SIM. No vendemos partes sueltas: vendemos la experiencia completa, lista para encender.
            </p>
          </div>

          {/* stats */}
          <div className="mt-10 grid grid-cols-2 gap-px border border-white/8 overflow-hidden rounded-2xl">
            {[
              { val: "49\"", label: "Pantalla curva" },
              { val: "Moza", label: "R5 Bundle" },
              { val: "2", label: "Opciones de butaca" },
              { val: "ARG", label: "Fabricación local" },
            ].map((s) => (
              <div key={s.label} className="bg-zinc-950 px-5 py-4">
                <p className="text-2xl font-black text-white">{s.val}</p>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-white/25">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          COMPONENTES — estilo magazine técnico
      ══════════════════════════════════════════════ */}
      <section className="border-y border-white/8 bg-white text-black">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-16 md:py-20">

          {/* encabezado */}
          <div className="mb-14 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.5em] text-red-600">
                Especificaciones
              </p>
              <h2 className="text-5xl font-black uppercase leading-[0.9] md:text-6xl">
                Qué incluye<br />de base.
              </h2>
            </div>
            <p className="max-w-xs text-sm leading-7 text-black/40 md:text-right">
              Cada componente fue elegido por el equipo de SIM por rendimiento y durabilidad.
            </p>
          </div>

          {/* grilla de componentes */}
          <div className="grid gap-px bg-black/10 overflow-hidden rounded-2xl md:grid-cols-2">
            {COMPONENTES.map((c) => (
              <div key={c.num} className="flex gap-6 bg-white p-7 md:p-9">
                <span className="mt-1 shrink-0 text-5xl font-black leading-none text-black/8">
                  {c.num}
                </span>
                <div>
                  <h3 className="text-lg font-black uppercase">{c.nombre}</h3>
                  <p className="mt-2 text-sm leading-7 text-black/50">{c.detalle}</p>
                </div>
              </div>
            ))}
          </div>

          {/* nota al pie */}
          <p className="mt-6 text-xs text-black/30">
            * La PC Gaming está en proceso de definición. Consultá por WhatsApp para la configuración actualizada.
          </p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          BUTACAS — doble página editorial
      ══════════════════════════════════════════════ */}
      <section className="border-b border-white/8">
        {/* encabezado de sección */}
        <div className="border-b border-white/8 px-6 py-10 md:px-16">
          <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:gap-8">
            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
              Opciones de butaca
            </p>
            <h2 className="text-4xl font-black uppercase leading-tight md:text-5xl">
              Elegí tu estilo.
            </h2>
          </div>
        </div>

        {/* dos columnas — una por butaca */}
        <div className="grid md:grid-cols-2">
          {BUTACAS.map((b, i) => (
            <div
              key={b.id}
              className={`flex flex-col border-white/8 ${i === 0 ? "md:border-r" : ""} ${i === 1 ? "border-t md:border-t-0" : ""}`}
            >
              {/* imagen placeholder */}
              <Placeholder label={`Butaca ${b.nombre}`} />

              {/* contenido */}
              <div className="flex flex-1 flex-col justify-between p-8 md:p-12">
                <div>
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-7xl font-black text-white/[0.06]">{b.num}</span>
                    <span className="rounded-full border border-red-600/40 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-red-500">
                      {b.etiqueta}
                    </span>
                  </div>

                  <h3 className="text-3xl font-black uppercase leading-tight">
                    {b.nombre}
                  </h3>
                  <p className="mt-4 text-sm leading-8 text-white/40">
                    {b.descripcion}
                  </p>
                </div>

                <Link
                  href={WA_MSG(b.nombre)}
                  target="_blank"
                  className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/15 px-6 py-3.5 text-xs font-black uppercase tracking-widest text-white/60 transition hover:border-red-600 hover:bg-red-600 hover:text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  Consultar — Butaca {b.nombre}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FRANJA TÉCNICA
      ══════════════════════════════════════════════ */}
      <section className="overflow-hidden border-b border-white/8 bg-zinc-950 py-5">
        <div className="flex animate-[marquee_25s_linear_infinite] gap-0 whitespace-nowrap">
          {[...Array(4)].flatMap(() => [
            "Moza R5 Bundle",
            "·",
            "Pantalla Curva 49\"",
            "·",
            "Fuerza Directa",
            "·",
            "Fabricación Argentina",
            "·",
            "Butaca CMF Pro",
            "·",
            "Estructura Custom SIM",
            "·",
          ]).map((t, i) => (
            <span
              key={i}
              className={`px-6 text-xs font-black uppercase tracking-[0.3em] ${t === "·" ? "text-red-600" : "text-white/20"}`}
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          CTA FINAL
      ══════════════════════════════════════════════ */}
      <section className="relative overflow-hidden px-6 py-24 md:px-16 md:py-32">
        {/* número de fondo */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end overflow-hidden pr-4 md:pr-10">
          <p className="select-none text-[20vw] font-black uppercase leading-none text-white/[0.02]">
            SIM
          </p>
        </div>

        <div className="relative flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="mb-4 text-[10px] font-black uppercase tracking-[0.5em] text-red-500">
              ¿Te interesa?
            </p>
            <h2 className="text-5xl font-black uppercase leading-[0.88] md:text-7xl">
              Hablemos<br />
              <span className="text-red-600">sin vueltas.</span>
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-8 text-white/35">
              Precio a consultar. Te respondemos por WhatsApp con toda la información, presupuesto y tiempos de entrega.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Link
              href={WA}
              target="_blank"
              className="flex items-center justify-center gap-3 rounded-2xl bg-red-600 px-10 py-5 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
            >
              <MessageCircle className="h-5 w-5" />
              Consultar por WhatsApp
            </Link>
            <Link
              href="/reservas"
              className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 px-10 py-5 text-sm font-black uppercase tracking-widest text-white/40 transition hover:border-white/30 hover:text-white"
            >
              Probar el simulador primero
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <style jsx global>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </main>
  );
}
