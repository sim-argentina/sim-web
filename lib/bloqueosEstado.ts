// Estado EFECTIVO de un bloqueo de reservas, derivado de fecha/hora + su flag manual.
// No se persiste (evita cron y datos desactualizados): se calcula on-read. Argentina es
// UTC-3 (sin DST): se compara contra la hora Argentina construyendo los instantes con
// offset -03:00, de forma independiente del timezone del server/cliente.
export type BloqueoEstadoInput = {
  activo: boolean;
  fecha: string;              // "YYYY-MM-DD"
  todo_el_dia: boolean;
  hora_inicio: string | null; // "HH:MM"
  hora_fin: string | null;    // "HH:MM"
};
export type EstadoBloqueo = "programado" | "activo" | "inactivo";

const AR = "-03:00";

// programado: aún no empezó · activo: vigente ahora · inactivo: manual off o ya vencido.
// La desactivación MANUAL siempre prevalece (nunca se reactiva solo).
export function estadoBloqueoEfectivo(b: BloqueoEstadoInput, nowMs: number = Date.now()): EstadoBloqueo {
  if (!b.activo) return "inactivo"; // manual off prevalece
  const iniHHMM = b.todo_el_dia ? "00:00" : (b.hora_inicio || "00:00");
  const finHHMMSS = b.todo_el_dia ? "23:59:59" : `${(b.hora_fin || "23:59")}:00`;
  const start = Date.parse(`${b.fecha}T${iniHHMM}:00${AR}`);
  const end = Date.parse(`${b.fecha}T${finHHMMSS}${AR}`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "activo"; // fecha inválida → no romper
  if (nowMs > end) return "inactivo";     // vencido
  if (nowMs < start) return "programado"; // futuro
  return "activo";
}

// ¿El bloqueo debe TENERSE EN CUENTA para impedir reservas? Sí salvo que esté
// inactivo (manual off o vencido). Un "programado" sigue aplicando a su ventana futura.
export function bloqueoAplicable(b: BloqueoEstadoInput, nowMs: number = Date.now()): boolean {
  return estadoBloqueoEfectivo(b, nowMs) !== "inactivo";
}
