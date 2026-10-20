// ============================================================================
// Las RPCs de retención de cupones (db/cupones-retencion.sql) sobre una base EN
// MEMORIA, para las pruebas que reemplazan supabaseAdmin por tablas en memoria
// (giftCardsComercial.test.ts y las que lo necesiten). Mismas reglas que el
// SQL, sin concurrencia: la exclusividad bajo concurrencia real se prueba contra
// la base local (lib/cuponesRetencion.integration.ts). No es código de la app.
// ============================================================================

import { randomUUID } from "node:crypto";
import { hoyEnSim } from "@/lib/agenda";

type Fila = Record<string, unknown>;
type Resp = { data: unknown; error: { message: string; code?: string } | null };

const GRACIA_MS = 2 * 60_000;
const MARGEN_MS = 5 * 60_000;

/**
 * Devuelve un manejador: (fn, args) → Promise de la respuesta de la RPC, o null
 * si `fn` no es una RPC de retención (el test sigue con las suyas).
 */
export function rpcRetencionesEnMemoria(tabla: (t: string) => Fila[], reloj: () => Date = () => new Date()) {
  const ret = () => tabla("codigo_retenciones");
  const codigos = () => tabla("codigos_descuento");
  const ok = (data: unknown): Promise<Resp> => Promise.resolve({ data, error: null });
  const falla = (message: string, code = "P0001"): Promise<Resp> => Promise.resolve({ data: null, error: { message, code } });
  const retenidas = (codigoId: unknown) => ret().filter((r) => r.codigo_id === codigoId && r.estado === "retenido");

  return (fn: string, a: Record<string, unknown>): Promise<Resp> | null => {
    const ahora = reloj();
    if (fn === "codigo_retener") {
      const cod = String(a.p_codigo ?? "").trim().toUpperCase();
      const previa = ret().find((r) => r.intento === a.p_intento);
      if (previa) {
        if (previa.huella !== a.p_huella || previa.codigo !== cod || previa.producto !== a.p_producto) return falla("intento_con_otro_pedido", "23505");
        return ok({ ok: true, reutilizada: true, retencion: { ...previa }, codigo: { ...codigos().find((c) => c.id === previa.codigo_id) } });
      }
      const c = codigos().find((x) => x.codigo === cod);
      if (!c || c.deleted_at) return ok({ ok: false, motivo: "inexistente" });
      const max = c.usos_maximos as number | null | undefined;
      if (max != null && Number(c.usos_actuales ?? 0) >= max) return ok({ ok: false, motivo: "agotado" });
      if (!c.activo) return ok({ ok: false, motivo: "inactivo" });
      const hoy = hoyEnSim(ahora);
      if (c.fecha_inicio && hoy < String(c.fecha_inicio)) return ok({ ok: false, motivo: "no_vigente" });
      if (c.fecha_fin && hoy > String(c.fecha_fin)) return ok({ ok: false, motivo: "vencido" });
      if (max == null) return ok({ ok: false, motivo: "sin_limite" });
      const activas = retenidas(c.id);
      if (Number(c.usos_actuales ?? 0) + activas.length >= max) {
        const vencidas = activas.filter((r) => Date.parse(String(r.vence_en)) < ahora.getTime()).map((r) => r.id);
        return ok({ ok: false, motivo: "en_uso", vencidas });
      }
      const nueva: Fila = {
        id: randomUUID(), intento: a.p_intento, huella: a.p_huella, codigo_id: c.id, codigo: c.codigo, producto: a.p_producto,
        estado: "retenido", reserva_id: null, grupo_compra_id: null, external_reference: null, con_pago: false,
        preferencia_id: null, init_point: null, total_original: null, descuento: null, total_final: null, pago_id: null, nota: null,
        retenido_en: ahora.toISOString(), vence_en: new Date(ahora.getTime() + GRACIA_MS).toISOString(),
        consumido_en: null, liberado_en: null, motivo_liberacion: null,
      };
      ret().push(nueva);
      return ok({ ok: true, reutilizada: false, retencion: { ...nueva }, codigo: { ...c } });
    }

    if (fn === "codigo_retencion_vincular") {
      const r = ret().find((x) => x.id === a.p_id);
      if (!r) return falla("retencion_inexistente", "P0002");
      if (r.estado !== "retenido") return falla("retencion_no_retenida", "55000");
      const d = (a.p_datos ?? {}) as Fila;
      for (const k of ["reserva_id", "grupo_compra_id", "external_reference", "total_original", "descuento", "total_final"]) {
        if (!(k in d)) continue;
        const v = ["total_original", "descuento", "total_final", "reserva_id"].includes(k) ? Number(d[k]) : d[k];
        if (r[k] != null && r[k] !== v) return falla("retencion_ya_vinculada", "55000");
        r[k] = v;
      }
      if (d.con_pago === true) {
        if (!d.expira || !r.external_reference) return falla("falta_expira", "22023");
        r.con_pago = true;
      }
      if (d.expira) {
        const vence = Date.parse(String(d.expira)) + MARGEN_MS;
        if (vence > Date.parse(String(r.vence_en))) r.vence_en = new Date(vence).toISOString();
      }
      if (d.preferencia_id || d.init_point) {
        r.preferencia_id = d.preferencia_id;
        r.init_point = d.init_point;
      }
      return ok({ ...r });
    }

    if (fn === "codigo_retencion_consumir") {
      const r = ret().find((x) => x.id === a.p_id);
      if (!r) return falla("retencion_inexistente", "P0002");
      if (r.estado === "consumido") return ok({ resultado: "ya_consumida", pago_id: r.pago_id });
      const c = codigos().find((x) => x.id === r.codigo_id)!;
      let nota: string | null = null;
      if (r.estado === "liberado") {
        const max = c.usos_maximos as number | null;
        if (max != null && Number(c.usos_actuales ?? 0) + retenidas(c.id).length >= max) {
          r.nota = "aprobado_sin_cupo";
          return ok({ resultado: "sin_cupo" });
        }
        nota = "consumida_tras_liberar";
      }
      c.usos_actuales = Number(c.usos_actuales ?? 0) + 1;
      if (c.usos_maximos != null && Number(c.usos_actuales) >= Number(c.usos_maximos)) c.activo = false;
      Object.assign(r, { estado: "consumido", consumido_en: ahora.toISOString(), pago_id: a.p_pago_id || null, nota: nota ?? r.nota });
      tabla("usos_codigos_descuento").push({
        id: tabla("usos_codigos_descuento").length + 1, codigo_id: c.id, codigo: c.codigo, reserva_id: r.reserva_id,
        mercado_pago_payment_id: a.p_pago_id || null, total_original: r.total_original, descuento_aplicado: r.descuento, total_final: r.total_final,
      });
      return ok({ resultado: nota ?? "consumida" });
    }

    if (fn === "codigo_retencion_liberar") {
      const r = ret().find((x) => x.id === a.p_id);
      if (!r) return falla("retencion_inexistente", "P0002");
      if (r.estado === "liberado") return ok({ resultado: "ya_liberada" });
      if (r.estado === "consumido") return ok({ resultado: "consumida" });
      if (a.p_motivo === "sin_oportunidad_de_pago" && r.con_pago) return falla("retencion_con_pago", "55000");
      if (a.p_motivo === "sin_pago_tras_vencer" && (!r.con_pago || ahora.getTime() < Date.parse(String(r.vence_en)))) return falla("retencion_vigente", "55000");
      Object.assign(r, { estado: "liberado", liberado_en: ahora.toISOString(), motivo_liberacion: a.p_motivo });
      return ok({ resultado: "liberada" });
    }
    return null;
  };
}
