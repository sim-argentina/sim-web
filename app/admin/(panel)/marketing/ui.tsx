// Marketing · piezas visuales compartidas por las pestañas del panel.

export const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500";
export const btnRojo = "rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40";
export const btnBorde = "rounded-xl border border-white/20 px-4 py-2 text-sm font-black uppercase text-white/80 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

const FMT = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", dateStyle: "short", timeStyle: "short" });
export const fecha = (iso: string | null | undefined) => (iso ? FMT.format(new Date(iso)) : "—");

export function Seccion({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase text-red-500">{titulo}</h2>
        {accion}
      </div>
      {children}
    </div>
  );
}

export function Tarjeta({ titulo, valor, nota, alerta = false }: { titulo: string; valor: string; nota: string; alerta?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${alerta ? "border-yellow-500/30 bg-yellow-950/10" : "border-white/10 bg-white/[0.03]"}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">{titulo}</p>
      <p className="mt-2 text-2xl font-black text-white">{valor}</p>
      <p className="mt-1 text-xs text-white/50">{nota}</p>
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: React.ReactNode; ayuda?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-white/40">{ayuda}</span>}
    </label>
  );
}

/** Rótulo fijo de todo lo que es simulado: envíos, entregas, costos y beneficios. */
export function Simulado({ className = "" }: { className?: string }) {
  return (
    <span className={`rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-300 ${className}`}>
      Simulado
    </span>
  );
}
