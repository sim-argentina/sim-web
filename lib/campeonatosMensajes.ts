// Mensajes que ve el piloto DESPUÉS de inscribirse. Puros y testeables, sin DB.
//
// Regla dura: NADA se decide por el NOMBRE del campeonato. Todo sale de su
// configuración — modalidad, fecha_inicio y `config` (presentacion.hora_inicio /
// hora) — o de un texto explícito en `config.inscripcion.mensaje_confirmacion`.
// Así, un eliminatorio futuro con otra fecha y otro horario produce su propio
// mensaje sin tocar una línea de código.
//
// Jerarquía:
//   1) config.inscripcion.mensaje_confirmacion  → gana siempre (override del admin)
//   2) modalidad eliminación                    → cita con fecha y hora reales
//   3) liga                                     → instrucción histórica (tanda
//      clasificatoria en el stand), que sigue siendo la correcta para ese formato

import { esEliminacion } from "@/lib/campeonatosConfig";

export type CampeonatoMensajeRow = {
  modalidad?: string | null;
  fecha_inicio?: string | null;
  config?: Record<string, unknown> | null;
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

// Texto histórico de LIGA. Se conserva tal cual: en una liga el piloto sí tiene
// que hacer su tanda clasificatoria en el stand para que se le asigne categoría.
export const MENSAJE_LIGA =
  "Ahora debés acercarte al stand de SIM Argentina para realizar tu tanda clasificatoria " +
  "y registrar tu mejor tiempo. Con ese tiempo serás ubicado en una categoría competitiva.";

// Eliminación sin fecha/hora cargadas: no se inventa un día.
export const MENSAJE_ELIMINACION_SIN_FECHA =
  "¡Listo! Te vamos a avisar los detalles del campeonato. Nos vemos en SIM Argentina.";

// "2026-09-19" → "19 de septiembre" (y "19 de septiembre de 2027" si el campeonato
// cae en otro año que el corriente: sin el año, esa fecha sería ambigua).
// Formateo manual y no Intl: el resultado tiene que ser idéntico en el navegador,
// en el runtime de Vercel y en los tests, sin depender del ICU disponible.
export function fechaLargaEs(iso: unknown, anioActual = new Date().getFullYear()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const base = `${dia} de ${MESES[mes - 1]}`;
  return anio === anioActual ? base : `${base} de ${anio}`;
}

// "10:20" | "10:20:00" | "10.20" → "10:20". Cualquier otra cosa → null.
export function horaCorta(valor: unknown): string | null {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// Hora a la que hay que estar: la de presentación si está configurada, si no la
// hora general del campeonato.
export function horaPresentacion(camp: CampeonatoMensajeRow): string | null {
  const cfg = (camp.config ?? {}) as {
    presentacion?: { hora_inicio?: unknown };
    hora?: unknown;
  };
  return horaCorta(cfg.presentacion?.hora_inicio) ?? horaCorta(cfg.hora);
}

// Texto que el admin puede fijar por campeonato y que gana sobre todo lo demás.
function mensajeConfigurado(camp: CampeonatoMensajeRow): string | null {
  const cfg = camp.config as { inscripcion?: { mensaje_confirmacion?: unknown } } | null | undefined;
  const txt = cfg?.inscripcion?.mensaje_confirmacion;
  return typeof txt === "string" && txt.trim() ? txt.trim() : null;
}

// Mensaje final para la pantalla de "¡Inscripción confirmada!".
export function mensajeConfirmacion(
  camp: CampeonatoMensajeRow,
  anioActual = new Date().getFullYear(),
): string {
  const custom = mensajeConfigurado(camp);
  if (custom) return custom;

  if (!esEliminacion(camp.modalidad)) return MENSAJE_LIGA;

  const fecha = fechaLargaEs(camp.fecha_inicio, anioActual);
  if (!fecha) return MENSAJE_ELIMINACION_SIN_FECHA;

  const hora = horaPresentacion(camp);
  return hora
    ? `¡Listo! Te esperamos el ${fecha} a las ${hora} hs en SIM Argentina para correr el campeonato.`
    : `¡Listo! Te esperamos el ${fecha} en SIM Argentina para correr el campeonato.`;
}
