import { ArrowUpRight } from "lucide-react";

// 03 · Lo que destacaron los clientes en sus reseñas de Google Maps.
//
// Contenido ESTÁTICO escrito por SIM: resume con palabras propias lo que
// destacaron reseñas públicas de la ficha. No copia reseñas ni muestra nombres,
// iniciales, fotos o datos de perfil, y no consulta a Google en el build, en el
// servidor ni en el navegador: va en el HTML de la Home y se ve desde la carga.
// Las reseñas completas están en la ficha, a la que lleva un único botón.

const DESTACADOS = [
  {
    titulo: "Sensación de Fórmula 1",
    texto: "La experiencia de manejo se sintió como estar en un Fórmula 1 de verdad.",
  },
  {
    titulo: "Un plan para compartir",
    texto: "Una experiencia divertida para ir con amigos o en familia.",
  },
  {
    titulo: "Variedad y buena atención",
    texto: "Destacaron la variedad de pistas y modos de manejo, y la atención del equipo.",
  },
] as const;

export default function ResenasDestacadas({ fichaUrl }: { fichaUrl: string }) {
  return (
    <section
      aria-labelledby="resenas-titulo"
      className="relative overflow-hidden border-y border-white/5 bg-black text-white"
    >
      {/* degradado sutil + leve glow rojo racing */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-black" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-red-600/10 blur-[100px]" />

      <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-14 md:px-12 md:pb-20 md:pt-16">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.55em] text-red-500">
          Lo que importa
        </p>
        <h2 id="resenas-titulo" className="text-2xl font-black uppercase leading-[1.05] md:text-[2.6rem]">
          Clientes que ya vivieron la{" "}
          <span className="whitespace-nowrap text-red-600">experiencia SIM.</span>
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-6 text-white/55">
          Lo que algunos clientes destacaron en Google Maps.
        </p>

        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {DESTACADOS.map((d) => (
            <li key={d.titulo} className="relative border border-white/10 bg-white/[0.03] px-6 pb-7 pt-8 md:px-7">
              <div className="absolute left-0 top-0 h-[3px] w-12 bg-red-600" />
              <h3 className="text-lg font-black uppercase leading-snug">{d.titulo}</h3>
              <p className="mt-3 text-sm leading-6 text-white/65">{d.texto}</p>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex justify-center">
          <a
            href={fichaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-3 border border-white/15 px-6 py-4 text-center text-xs font-black uppercase tracking-[0.15em] text-white/70 transition-all hover:border-red-600 hover:text-white sm:w-auto sm:px-8 sm:tracking-widest"
          >
            Ver todas las reseñas en Google Maps
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">(se abre en una pestaña nueva)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
