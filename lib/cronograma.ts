// Cronograma mensual manual (IA SIM · Bloque 2) — lógica PURA y testeable.
// Sin dependencias de servidor. Contiene:
//   · Resolución determinística de PRESENCIA (qué integrantes están presentes en
//     una fecha+hora) — reutilizable para atribución en bloques posteriores.
//   · Validación de un día (horario operativo, jornadas, superposiciones).
//   · Helpers de fecha/hora (nunca se usan strings para lógica de negocio sin
//     parsear a minutos).
// El acceso a datos y las validaciones que requieren DB (integrante activo, etc.)
// viven en lib/cronogramaServer.ts.

export const APERTURA_DEFAULT = "10:00";
export const CIERRE_DEFAULT = "22:00";

export type EstadoMes = "inexistente" | "borrador" | "confirmado";
export type FuentePresencia = "manual" | "fallback" | "ninguno";

// ── Helpers de tiempo ─────────────────────────────────────────────────────────
// Acepta "HH:MM" o "HH:MM:SS" y devuelve minutos desde medianoche, o null si es
// inválido. No admite horas >= 24 (los horarios son dentro de un mismo día).
export function horaAMinutos(h: unknown): number | null {
  if (typeof h !== "string") return null;
  const m = h.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 60 + mm + ss / 60; // minutos (los segundos rara vez se usan)
}

// Normaliza a "HH:MM" (para comparaciones/serialización estables).
export function normalizarHora(h: unknown): string | null {
  if (typeof h !== "string") return null;
  const m = h.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ── Resolución de presencia (determinística) ──────────────────────────────────
export type JornadaResol = { empleado_id: string; hora_inicio: string; hora_fin: string };
export type DiaResol = {
  cerrado: boolean;
  apertura: string;
  cierre: string;
  jornadas: JornadaResol[];
};
export type ResolucionInput = {
  estado: EstadoMes;
  dia: DiaResol;
  hora: string;
  fallbackEmpleadoId: string;
  // preview=true trata un borrador como si estuviera confirmado para PREVISUALIZAR
  // la cobertura de Ramiro. `oficial` sigue siendo false salvo estado confirmado.
  preview?: boolean;
};
export type Resolucion = {
  presentes: string[]; // empleado_ids, sin duplicados, en orden de aparición
  fuente: FuentePresencia;
  oficial: boolean;
};

// Reglas (ver Bloque 2):
//  - Mes inexistente → nadie (nunca fallback). La ausencia de cronograma NO
//    significa que trabajó Ramiro.
//  - Día cerrado → nadie, sin fallback.
//  - Fuera del horario operativo [apertura, cierre) → nadie.
//  - Con jornadas manuales activas [inicio, fin) → ese conjunto de integrantes.
//  - Sin jornadas, día abierto, dentro del horario, y mes confirmado (o preview)
//    → únicamente el fallback (Ramiro), calculado, no persistido.
export function resolverPresencia(input: ResolucionInput): Resolucion {
  const oficial = input.estado === "confirmado";
  const vacio = (fuente: FuentePresencia): Resolucion => ({ presentes: [], fuente, oficial });

  if (input.estado === "inexistente") return { presentes: [], fuente: "ninguno", oficial: false };
  if (input.dia.cerrado) return vacio("ninguno");

  const t = horaAMinutos(input.hora);
  const ap = horaAMinutos(input.dia.apertura);
  const ci = horaAMinutos(input.dia.cierre);
  if (t === null || ap === null || ci === null) return vacio("ninguno");
  if (t < ap || t >= ci) return vacio("ninguno"); // [apertura, cierre)

  const activos: string[] = [];
  for (const j of input.dia.jornadas) {
    const ini = horaAMinutos(j.hora_inicio);
    const fin = horaAMinutos(j.hora_fin);
    if (ini === null || fin === null) continue;
    if (ini <= t && t < fin) {
      // [inicio, fin): una jornada que termina a las 18:00 NO está activa a las 18:00.
      if (!activos.includes(j.empleado_id)) activos.push(j.empleado_id);
    }
  }
  if (activos.length > 0) return { presentes: activos, fuente: "manual", oficial };

  const aplicaFallback = input.estado === "confirmado" || input.preview === true;
  if (aplicaFallback) return { presentes: [input.fallbackEmpleadoId], fuente: "fallback", oficial };
  return vacio("ninguno");
}

// ── Validación de un día (para el guardado atómico) ───────────────────────────
export type JornadaInput = { empleado_id: string; hora_inicio: string; hora_fin: string };
export type DiaInput = {
  cerrado: boolean;
  apertura: string;
  cierre: string;
  jornadas: JornadaInput[];
};
export type DiaNormalizado = {
  cerrado: boolean;
  apertura: string;
  cierre: string;
  jornadas: Array<{ empleado_id: string; hora_inicio: string; hora_fin: string }>;
};
export type ValidacionDiaOk = { ok: true; dia: DiaNormalizado };
export type ValidacionDiaFail = { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida estructura y reglas de un día. NO valida existencia/estado de los
// integrantes (eso es server-side, requiere DB). Interpreta intervalos como
// [inicio, fin). Rechaza: horario operativo inválido, jornadas fuera del horario,
// inicio>=fin (incluye jornadas nocturnas que cruzan medianoche), superposición
// del MISMO integrante. Permite superposición entre integrantes distintos.
export function validarDia(input: unknown): ValidacionDiaOk | ValidacionDiaFail {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const cerrado = obj.cerrado === true;

  const apertura = normalizarHora(obj.apertura);
  const cierre = normalizarHora(obj.cierre);
  if (!apertura || !cierre) return { ok: false, error: "Horario operativo inválido." };
  const apMin = horaAMinutos(apertura)!;
  const ciMin = horaAMinutos(cierre)!;
  if (apMin >= ciMin) return { ok: false, error: "La apertura debe ser anterior al cierre." };

  const rawJornadas = Array.isArray(obj.jornadas) ? obj.jornadas : [];

  if (cerrado && rawJornadas.length > 0) {
    return { ok: false, error: "Un día cerrado no puede tener jornadas." };
  }

  const jornadas: DiaNormalizado["jornadas"] = [];
  for (const raw of rawJornadas) {
    const j = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const empleadoId = String(j.empleado_id ?? "");
    if (!UUID_RE.test(empleadoId)) return { ok: false, error: "Integrante inválido en una jornada." };
    const ini = normalizarHora(j.hora_inicio);
    const fin = normalizarHora(j.hora_fin);
    if (!ini || !fin) return { ok: false, error: "Horario de jornada inválido." };
    const iniMin = horaAMinutos(ini)!;
    const finMin = horaAMinutos(fin)!;
    if (iniMin >= finMin) {
      return { ok: false, error: "El inicio de la jornada debe ser anterior a su fin (no se admiten jornadas nocturnas)." };
    }
    if (iniMin < apMin || finMin > ciMin) {
      return { ok: false, error: "La jornada debe estar dentro del horario operativo del día." };
    }
    jornadas.push({ empleado_id: empleadoId, hora_inicio: ini, hora_fin: fin });
  }

  // Superposición del mismo integrante: [inicio, fin), tocar extremos NO es solapar.
  const porEmpleado = new Map<string, Array<{ ini: number; fin: number }>>();
  for (const j of jornadas) {
    const arr = porEmpleado.get(j.empleado_id) ?? [];
    arr.push({ ini: horaAMinutos(j.hora_inicio)!, fin: horaAMinutos(j.hora_fin)! });
    porEmpleado.set(j.empleado_id, arr);
  }
  for (const arr of porEmpleado.values()) {
    arr.sort((a, b) => a.ini - b.ini);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].ini < arr[i - 1].fin) {
        return { ok: false, error: "Un integrante no puede tener jornadas superpuestas en el mismo día." };
      }
    }
  }

  return { ok: true, dia: { cerrado, apertura, cierre, jornadas } };
}

// ── Cobertura del horario operativo (para el resumen de confirmación) ─────────
// Devuelve true si las jornadas manuales cubren SIN huecos todo [apertura, cierre).
// Con 0 jornadas devuelve false (ese día lo cubre entero Ramiro; se cuenta aparte).
export function cubreHorarioOperativo(
  apertura: string,
  cierre: string,
  jornadas: Array<{ hora_inicio: string; hora_fin: string }>,
): boolean {
  const ap = horaAMinutos(apertura);
  const ci = horaAMinutos(cierre);
  if (ap === null || ci === null || ap >= ci) return false;
  if (jornadas.length === 0) return false;

  const ivs = jornadas
    .map((j) => [horaAMinutos(j.hora_inicio), horaAMinutos(j.hora_fin)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null)
    .sort((a, b) => a[0] - b[0]);

  let cursor = ap;
  for (const [a, b] of ivs) {
    if (a > cursor) return false; // hueco antes de esta jornada
    if (b > cursor) cursor = b;
    if (cursor >= ci) return true;
  }
  return cursor >= ci;
}

// ── Validación de mes/fecha ───────────────────────────────────────────────────
export function validarAnioMes(anio: unknown, mes: unknown): { ok: true; anio: number; mes: number } | { ok: false; error: string } {
  const a = Number(anio);
  const m = Number(mes);
  if (!Number.isInteger(a) || a < 2020 || a > 2100) return { ok: false, error: "Año inválido." };
  if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, error: "Mes inválido." };
  return { ok: true, anio: a, mes: m };
}

// Valida "YYYY-MM-DD" y que pertenezca a (anio, mes).
export function fechaEnMes(fecha: unknown, anio: number, mes: number): boolean {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [y, mm, dd] = fecha.split("-").map(Number);
  if (y !== anio || mm !== mes) return false;
  const d = new Date(Date.UTC(y, mm - 1, dd));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd;
}
