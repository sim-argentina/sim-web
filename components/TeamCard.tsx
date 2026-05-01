"use client";

type TeamCardProps = {
  name: string;
  code: string;
  car: string;
  subtitle: string;
  time: string;
  price: number;
  selected: boolean;
  reserved: boolean;
  colorFrom: string;
  colorTo: string;
  accent: string;
  logoSrc?: string;
  logoAlt?: string;
  onClick: () => void;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

export default function TeamCard({
  name,
  code,
  car,
  subtitle,
  time,
  price,
  selected,
  reserved,
  colorFrom,
  colorTo,
  accent,
  logoSrc,
  logoAlt,
  onClick,
}: TeamCardProps) {
  const statusLabel = reserved
    ? "Reservado"
    : selected
    ? "Seleccionado"
    : "Disponible";

  const statusColor = reserved
    ? "text-zinc-500"
    : selected
    ? "text-red-400"
    : "text-emerald-400";

  const buttonLabel = reserved ? "Ocupado" : selected ? "Quitar" : "Seleccionar";

  return (
    <div
      className={cn(
        "rounded-[30px] border p-4 transition",
        selected
          ? "border-red-500/40 bg-zinc-950 shadow-[0_0_30px_rgba(239,68,68,0.10)]"
          : "border-white/10 bg-black/60"
      )}
    >
      <div
        className={cn(
          "rounded-[28px] border border-white/10 bg-gradient-to-br p-4",
          colorFrom,
          colorTo
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs tracking-[0.55em] text-white">{code}</div>
            <h3 className="mt-2 text-3xl font-black text-white md:text-4xl">
              {name}
            </h3>
          </div>

          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 p-2">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={logoAlt ?? `${name} logo`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[10px] font-bold text-white/70">LOGO</span>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-[22px] border border-white/10 bg-black/35 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl font-black text-white">{car}</div>
            <div className="text-sm text-white/80">SIM</div>
          </div>

          <div className="mt-4 h-2 rounded-full bg-white/10">
            <div className={cn("h-2 rounded-full w-[88%]", accent)} />
          </div>

          <div className="mt-4 text-base text-white">{subtitle}</div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
          <div className={cn("text-sm font-bold", statusColor)}>{statusLabel}</div>

          <button
            type="button"
            onClick={onClick}
            disabled={reserved}
            className={cn(
              "rounded-full px-5 py-2.5 text-sm font-black transition",
              reserved
                ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                : selected
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-zinc-800 text-white hover:bg-zinc-700"
            )}
          >
            {buttonLabel}
          </button>
        </div>
      </div>

      <div className="px-1 pt-4">
        <div className="text-base text-zinc-300">
          Horario: <span className="font-semibold text-white">{time}</span>
        </div>

        <div className="mt-2 text-base text-zinc-300">
          Valor: <span className="font-semibold text-white">{formatPrice(price)}</span>
        </div>
      </div>
    </div>
  );
}