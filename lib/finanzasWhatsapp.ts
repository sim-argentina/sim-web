// Interpretación y guardado de movimientos de Finanzas recibidos por WhatsApp.
// Reutiliza el clasificador y los validadores existentes: NO duplica lógica contable.
// Nada se persiste sin confirmación explícita del usuario (el webhook maneja OK/CANCELAR).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  clasificarTexto,
  getCategorias,
  getCuentas,
  registrarFinLog,
  type FinCuenta,
} from "@/lib/finanzas";
import { validarMovimiento } from "@/lib/finanzasValidation";
import { validarEvento, sumarMesesFecha, hoyISO } from "@/lib/finanzasEventos";

// ── Planes (serializables a JSON, se guardan como interpretacion_json) ──────────

type MovBody = {
  fecha: string;
  tipo: "ingreso" | "egreso" | "transferencia";
  clasificacion: string;
  cuenta_origen_id: string | null;
  cuenta_destino_id: string | null;
  categoria_id: string | null;
  descripcion: string;
  monto: number;
};
type EventoBody = {
  fecha: string;
  tipo: "pago_futuro" | "cobro_futuro";
  monto: number;
  cuenta_estimada: "efectivo" | "mercado_pago";
  descripcion: string;
  proveedor_cliente: string | null;
};
type DeudaBody = {
  descripcion: string;
  proveedor: string | null;
  monto_total: number;
  cuotas: number;
  monto_cuota: number;
  fecha_primera_cuota: string;
  cuenta_estimada: "efectivo" | "mercado_pago";
};

export type Plan =
  | { kind: "movimiento"; movimiento: MovBody }
  | { kind: "transferencia"; movimiento: MovBody }
  | { kind: "evento"; evento: EventoBody }
  | { kind: "deuda"; deuda: DeudaBody };

// ── Utilidades ──────────────────────────────────────────────────────────────

function dinero(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

// dd/mm | dd-mm | dd/mm/yyyy → YYYY-MM-DD (si ya pasó este año, rueda al siguiente).
function parseFechaCorta(texto: string): string | null {
  const m = texto.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mesN = Number(m[2]);
  if (dia < 1 || dia > 31 || mesN < 1 || mesN > 12) return null;
  const hoy = hoyISO();
  let anio: number;
  if (m[3]) {
    anio = Number(m[3]);
    if (anio < 100) anio += 2000;
  } else {
    anio = Number(hoy.slice(0, 4));
  }
  const iso = `${anio}-${String(mesN).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (!m[3] && iso < hoy) {
    return `${anio + 1}-${String(mesN).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return iso;
}

function cuentaTexto(texto: string): "efectivo" | "mercado_pago" {
  const t = texto.toLowerCase();
  if (/\befectivo\b|\bcash\b|contado/.test(t)) return "efectivo";
  return "mercado_pago"; // default: todo lo no-efectivo
}

// ── Interpretación ────────────────────────────────────────────────────────────

export async function interpretarMensaje(texto: string): Promise<Plan | null> {
  const t = texto.toLowerCase().trim();

  // 1) Deuda con cuotas: "deuda 1000000 en 5 cuotas desde 15/08"
  if (/\bdeuda\b/.test(t) && /cuota/.test(t)) {
    const s = await clasificarTexto(texto);
    const monto = s.monto;
    if (!monto || monto <= 0) return null;
    const mCuotas = t.match(/(\d{1,3})\s*cuota/);
    const cuotas = mCuotas ? Math.min(120, Math.max(1, Number(mCuotas[1]))) : 1;
    const fecha = parseFechaCorta(t) || hoyISO();
    const montoCuota = Math.round((monto / cuotas) * 100) / 100;
    return {
      kind: "deuda",
      deuda: {
        descripcion: texto.trim().slice(0, 200),
        proveedor: null,
        monto_total: monto,
        cuotas,
        monto_cuota: montoCuota,
        fecha_primera_cuota: fecha,
        cuenta_estimada: cuentaTexto(t),
      },
    };
  }

  // 2) Evento futuro: "pago futuro 150000 proveedor 10/08 mp" / "cobro futuro ..."
  if (/pago\s*futuro|cobro\s*futuro|a\s*futuro/.test(t)) {
    const s = await clasificarTexto(texto);
    const monto = s.monto;
    if (!monto || monto <= 0) return null;
    const fecha = parseFechaCorta(t);
    if (!fecha) return null; // sin fecha no es un evento futuro válido
    const esCobro = /cobro/.test(t);
    return {
      kind: "evento",
      evento: {
        fecha,
        tipo: esCobro ? "cobro_futuro" : "pago_futuro",
        monto,
        cuenta_estimada: cuentaTexto(t),
        descripcion: texto.trim().slice(0, 300),
        proveedor_cliente: null,
      },
    };
  }

  // 3) Movimiento (gasto / ingreso / sueldo / transferencia) vía clasificador existente.
  const s = await clasificarTexto(texto);
  if (!s.monto || s.monto <= 0) return null;

  if (s.tipo === "transferencia") {
    if (!s.cuenta_origen_id || !s.cuenta_destino_id) return null;
    return {
      kind: "transferencia",
      movimiento: {
        fecha: hoyISO(),
        tipo: "transferencia",
        clasificacion: "otro",
        cuenta_origen_id: s.cuenta_origen_id,
        cuenta_destino_id: s.cuenta_destino_id,
        categoria_id: null,
        descripcion: texto.trim().slice(0, 300),
        monto: s.monto,
      },
    };
  }

  if (s.tipo === "ajuste") return null; // fuera del alcance del MVP por WhatsApp

  return {
    kind: "movimiento",
    movimiento: {
      fecha: hoyISO(),
      tipo: s.tipo,
      clasificacion: s.clasificacion,
      cuenta_origen_id: s.cuenta_origen_id,
      cuenta_destino_id: null,
      categoria_id: s.categoria_id,
      descripcion: texto.trim().slice(0, 300),
      monto: s.monto,
    },
  };
}

// ── Resumen para confirmar ────────────────────────────────────────────────────

const PIE = "\n\nRespondé OK para guardar o CANCELAR.";

export async function resumenPlan(plan: Plan): Promise<string> {
  const [cuentas, categorias] = await Promise.all([getCuentas(), getCategorias()]);
  const nombreCuenta = (id: string | null) => cuentas.find((c: FinCuenta) => c.id === id)?.nombre || "—";
  const nombreCuentaTipo = (tipo: string) => (tipo === "efectivo" ? "Efectivo" : "Mercado Pago");
  const nombreCat = (id: string | null) => categorias.find((c) => c.id === id)?.nombre || "sin categoría";

  if (plan.kind === "transferencia") {
    const m = plan.movimiento;
    return `Detecté: Transferencia ${dinero(m.monto)} de ${nombreCuenta(m.cuenta_origen_id)} a ${nombreCuenta(m.cuenta_destino_id)}.${PIE}`;
  }
  if (plan.kind === "movimiento") {
    const m = plan.movimiento;
    const etiqueta =
      m.tipo === "ingreso"
        ? "Ingreso"
        : m.clasificacion === "sueldo_personal"
        ? "Gasto de sueldo"
        : m.clasificacion === "costo"
        ? "Costo"
        : m.clasificacion === "inversion"
        ? "Inversión"
        : "Gasto";
    return `Detecté: ${etiqueta} ${dinero(m.monto)}, categoría ${nombreCat(m.categoria_id)}, fuente ${nombreCuenta(m.cuenta_origen_id)}.${PIE}`;
  }
  if (plan.kind === "evento") {
    const e = plan.evento;
    const etiqueta = e.tipo === "cobro_futuro" ? "Cobro futuro" : "Pago futuro";
    return `Detecté: ${etiqueta} ${dinero(e.monto)} el ${e.fecha.slice(8)}/${e.fecha.slice(5, 7)}, fuente ${nombreCuentaTipo(e.cuenta_estimada)}.${PIE}`;
  }
  // deuda
  const d = plan.deuda;
  return `Detecté: Deuda ${dinero(d.monto_total)} en ${d.cuotas} cuota/s de ${dinero(d.monto_cuota)} desde el ${d.fecha_primera_cuota.slice(8)}/${d.fecha_primera_cuota.slice(5, 7)}, fuente ${nombreCuentaTipo(d.cuenta_estimada)}.${PIE}`;
}

// ── Guardado final (reutiliza validadores existentes) ─────────────────────────

export async function guardarPlan(
  plan: Plan,
  rol = "whatsapp"
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    if (plan.kind === "movimiento" || plan.kind === "transferencia") {
      const val = await validarMovimiento(plan.movimiento as unknown as Record<string, unknown>);
      if (!val.ok) return { ok: false, error: val.error };
      const { data, error } = await supabaseAdmin
        .from("fin_movimientos")
        .insert([{ ...val.row, creado_por: rol }])
        .select()
        .single();
      if (error) throw error;
      await registrarFinLog("crear", "fin_movimientos", data.id, { via: "whatsapp", tipo: data.tipo, monto: data.monto }, rol);
      return { ok: true, id: data.id };
    }

    if (plan.kind === "evento") {
      const val = await validarEvento(plan.evento as unknown as Record<string, unknown>);
      if (!val.ok) return { ok: false, error: val.error };
      const { data, error } = await supabaseAdmin
        .from("fin_eventos_futuros")
        .insert([{ ...val.row, creado_por: rol }])
        .select()
        .single();
      if (error) throw error;
      await registrarFinLog("crear", "fin_eventos_futuros", data.id, { via: "whatsapp", tipo: data.tipo, monto: data.monto }, rol);
      return { ok: true, id: data.id };
    }

    // deuda: misma forma que /api/admin/finanzas/deudas
    const d = plan.deuda;
    const { data: deuda, error: errDeuda } = await supabaseAdmin
      .from("fin_deudas")
      .insert([{ descripcion: d.descripcion, proveedor: d.proveedor, monto_total: d.monto_total, cuotas_total: d.cuotas }])
      .select()
      .single();
    if (errDeuda) throw errDeuda;

    const eventos: Array<Record<string, unknown>> = [];
    for (let i = 0; i < d.cuotas; i++) {
      const fecha = i === 0 ? d.fecha_primera_cuota : sumarMesesFecha(d.fecha_primera_cuota, i);
      eventos.push({
        fecha,
        mes_contable: fecha.slice(0, 7),
        tipo: d.cuotas === 1 ? "deuda" : "cuota_deuda",
        estado: "pendiente",
        descripcion: d.cuotas === 1 ? d.descripcion : `${d.descripcion} · cuota ${i + 1}/${d.cuotas}`,
        monto: d.monto_cuota,
        cuenta_estimada: d.cuenta_estimada,
        probabilidad: 100,
        deuda_id: deuda.id,
        cuota_numero: i + 1,
        creado_por: rol,
      });
    }
    const { error: errEv } = await supabaseAdmin.from("fin_eventos_futuros").insert(eventos);
    if (errEv) throw errEv;

    await registrarFinLog("crear_deuda", "fin_deudas", deuda.id, { via: "whatsapp", monto_total: d.monto_total, cuotas: d.cuotas }, rol);
    return { ok: true, id: deuda.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error guardando" };
  }
}
