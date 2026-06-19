import { useEffect, useState } from "react";

// Lógica reutilizable del temporizador de turnos (stand + campeonatos).
// El cálculo es 100% en frontend; la DB solo guarda hora_subida, minutos y el
// check de listo. No genera tráfico extra.

export type TurnoTimerStatus = "listo" | "rojo" | "amarillo" | "neutral";

export type TurnoTimerInput = {
  fecha?: string | null; // YYYY-MM-DD
  horaSubida?: string | null; // HH:mm o HH:mm:ss
  minutos?: number | null;
  listo?: boolean | null;
  cancelado?: boolean | null;
};

export type TurnoTimerState = {
  status: TurnoTimerStatus;
  label: string;
  remainingMs: number | null; // null si no corre temporizador
};

const RED_THRESHOLD_MS = 2 * 60 * 1000; // < 2 min => rojo

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// mm:ss; hh:mm:ss si supera la hora.
function fmtDuracion(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

// Combina fecha (YYYY-MM-DD) + hora (HH:mm[:ss]) en ms epoch usando la hora
// LOCAL (hora de pared del staff). Si no hay fecha válida, usa el día de hoy.
// La aritmética en ms maneja correctamente el cruce de medianoche.
function parseInicio(fecha?: string | null, hora?: string | null): number | null {
  if (!hora) return null;
  const hm = String(hora).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!hm) return null;
  const hh = Number(hm[1]);
  const mm = Number(hm[2]);
  const ss = Number(hm[3] ?? 0);
  if (hh > 23 || mm > 59 || ss > 59) return null;

  const now = new Date();
  let y = now.getFullYear();
  let mo = now.getMonth();
  let d = now.getDate();
  const fm = fecha
    ? String(fecha).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    : null;
  if (fm) {
    y = Number(fm[1]);
    mo = Number(fm[2]) - 1;
    d = Number(fm[3]);
  }
  const t = new Date(y, mo, d, hh, mm, ss, 0).getTime();
  return Number.isFinite(t) ? t : null;
}

// Estado del temporizador. El verde (listo) tiene prioridad absoluta, incluso
// si el tiempo ya venció.
export function getTurnoTimerState(
  input: TurnoTimerInput,
  nowMs: number = Date.now()
): TurnoTimerState {
  if (input.listo) return { status: "listo", label: "Listo", remainingMs: 0 };
  if (input.cancelado) return { status: "neutral", label: "—", remainingMs: null };

  const inicio = parseInicio(input.fecha, input.horaSubida);
  const minutos = Number(input.minutos);
  if (inicio == null || !Number.isFinite(minutos) || minutos <= 0) {
    return { status: "neutral", label: "Sin iniciar", remainingMs: null };
  }

  const fin = inicio + minutos * 60_000;
  const restante = fin - nowMs;

  if (restante <= 0) {
    const pasado = -restante;
    const label =
      pasado >= 3_600_000 ? "Tiempo cumplido" : `Pasado ${fmtDuracion(pasado)}`;
    return { status: "rojo", label, remainingMs: restante };
  }
  if (restante < RED_THRESHOLD_MS) {
    return { status: "rojo", label: `Faltan ${fmtDuracion(restante)}`, remainingMs: restante };
  }
  return { status: "amarillo", label: `Faltan ${fmtDuracion(restante)}`, remainingMs: restante };
}

// Clases del badge por estado (consistentes entre turnero y campeonatos).
export const TURNO_BADGE_CLASS: Record<TurnoTimerStatus, string> = {
  listo: "bg-green-500/15 text-green-300 ring-1 ring-green-500/30",
  rojo: "bg-red-500/20 text-red-300 ring-1 ring-red-500/40",
  amarillo: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  neutral: "bg-white/5 text-zinc-400 ring-1 ring-white/10",
};

// Re-renderiza cada `intervalMs` para actualizar los contadores en vivo.
// Un único intervalo por componente; se limpia al desmontar (sin memory leaks).
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
