// Validación server-side de movimientos del módulo Finanzas.
// Separada del route handler para poder reutilizarla en POST y PUT.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  AMBITOS_MOVIMIENTO,
  CLASIFICACIONES,
  FECHA_RE,
  TIPOS_MOVIMIENTO,
  mesEstaCerrado,
  mesValido,
} from "@/lib/finanzas";

export type MovimientoValidado =
  | { ok: true; row: Record<string, unknown>; mes: string }
  | { ok: false; error: string };

export async function validarMovimiento(body: Record<string, unknown>): Promise<MovimientoValidado> {
  const fecha = String(body.fecha || "").trim();
  if (!FECHA_RE.test(fecha)) return { ok: false, error: "Fecha inválida (YYYY-MM-DD)" };

  const mes = String(body.mes_contable || fecha.slice(0, 7)).trim();
  if (!mesValido(mes)) return { ok: false, error: "Mes contable inválido" };

  const ambito = String(body.ambito || "").trim();
  if (!(AMBITOS_MOVIMIENTO as readonly string[]).includes(ambito)) {
    return { ok: false, error: "Ámbito inválido" };
  }

  const tipo = String(body.tipo || "").trim();
  if (!(TIPOS_MOVIMIENTO as readonly string[]).includes(tipo)) {
    return { ok: false, error: "Tipo inválido" };
  }

  const clasificacion = String(body.clasificacion || "").trim();
  if (!(CLASIFICACIONES as readonly string[]).includes(clasificacion)) {
    return { ok: false, error: "Clasificación inválida" };
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0 || monto > 1e12) {
    return { ok: false, error: "Monto inválido" };
  }

  const cuentaOrigen = body.cuenta_origen_id ? String(body.cuenta_origen_id) : null;
  const cuentaDestino = body.cuenta_destino_id ? String(body.cuenta_destino_id) : null;
  const categoriaId = body.categoria_id ? String(body.categoria_id) : null;

  if (tipo === "transferencia") {
    if (!cuentaOrigen || !cuentaDestino || cuentaOrigen === cuentaDestino) {
      return { ok: false, error: "Transferencia requiere cuenta origen y destino distintas" };
    }
  } else if (tipo === "ingreso" || tipo === "egreso") {
    if (!cuentaOrigen) return { ok: false, error: "Indicá la cuenta del movimiento" };
  } else if (tipo === "ajuste") {
    const tieneUna = Boolean(cuentaOrigen) !== Boolean(cuentaDestino);
    if (!tieneUna) {
      return { ok: false, error: "Ajuste requiere una sola cuenta (origen resta, destino suma)" };
    }
  }

  const idsCuentas = [cuentaOrigen, cuentaDestino].filter(Boolean) as string[];
  if (idsCuentas.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("fin_cuentas")
      .select("id")
      .in("id", idsCuentas);
    if (error || (data || []).length !== new Set(idsCuentas).size) {
      return { ok: false, error: "Cuenta inexistente" };
    }
  }
  if (categoriaId) {
    const { data, error } = await supabaseAdmin
      .from("fin_categorias")
      .select("id")
      .eq("id", categoriaId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Categoría inexistente" };
  }

  if (await mesEstaCerrado(mes)) {
    return { ok: false, error: `El mes ${mes} está cerrado. Reabrilo para modificarlo.` };
  }

  return {
    ok: true,
    mes,
    row: {
      fecha,
      mes_contable: mes,
      ambito,
      tipo,
      clasificacion,
      cuenta_origen_id: cuentaOrigen,
      cuenta_destino_id: cuentaDestino,
      categoria_id: categoriaId,
      subcategoria: body.subcategoria ? String(body.subcategoria).slice(0, 120) : null,
      descripcion: String(body.descripcion || "").slice(0, 300),
      monto,
      observaciones: body.observaciones ? String(body.observaciones).slice(0, 500) : null,
      origen: tipo === "transferencia" ? "transferencia" : "manual",
      referencia_externa: body.referencia_externa ? String(body.referencia_externa).slice(0, 200) : null,
    },
  };
}
