"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Panel de Códigos · retenciones de UN código: qué compra lo tiene apartado, de
// qué producto, desde cuándo, hasta cuándo, en qué estado y qué dijo la última
// revisión. "Revisar estado" corre la conciliación segura (consulta Mercado
// Pago): nunca libera a mano.

type Compra =
  | { tipo: "reserva"; id: number | null; estado: string | null; fecha: string | null; hora: string | null }
  | { tipo: "gift_card"; grupo: string | null; estado: string | null; tarjetas: number; creada: string | null };

type Retencion = {
  id: string;
  estado: "retenido" | "consumido" | "liberado";
  producto: "reserva" | "gift_card";
  compra: Compra;
  external_reference: string | null;
  con_pago: boolean;
  preferencia: boolean;
  importes: { original: number | null; descuento: number | null; final: number | null };
  pago_id: string | null;
  retenido_en: string;
  vence_en: string;
  consumido_en: string | null;
  liberado_en: string | null;
  motivo_liberacion: string | null;
  nota: string | null;
  revisiones: number;
  revisada_en: string | null;
  revision_resultado: string | null;
  revision_motivo: string | null;
  requiere_revision: string | null;
};

const ESTADO: Record<Retencion["estado"], string> = { retenido: "Retenido", consumido: "Consumido", liberado: "Liberado" };

const MOTIVO: Record<string, string> = {
  vigente: "Todavía vigente",
  preparando_pago: "Preparando el pago",
  compra_completada: "La compra ya estaba completa",
  sin_oportunidad_de_pago: "Nunca hubo pago posible",
  pago_aprobado: "Pago aprobado",
  pago_abierto: "Hay un pago en proceso",
  preferencia_vigente: "El link de pago todavía se puede usar",
  preferencia_sin_vencimiento: "El link de pago no vence (compra anterior)",
  consulta_de_pagos_incompleta: "Mercado Pago no devolvió todos los pagos",
  consulta_de_preferencias_incompleta: "Mercado Pago no devolvió todos los links",
  fuera_de_ventana_de_busqueda: "Demasiado vieja para buscarla en Mercado Pago",
  sin_pago_tras_vencer: "Venció sin pagos",
  aprobado_sin_cupo: "Pagada sin cupo",
  error_al_consumir: "Error al registrar el uso",
  no_se_pudo_leer: "No se pudo leer",
};

const REVISION: Record<string, string> = {
  pagada_sin_cupo: "Pagada cuando el cupón ya no tenía cupo",
  vencida_sin_confirmar: "Venció y Mercado Pago no confirmó que esté cerrada",
  legado_sin_confirmar: "Compra anterior a las retenciones sin confirmar",
};

function motivo(m: string | null) {
  if (!m) return "-";
  if (m.startsWith("mercado_pago_no_responde")) return "Mercado Pago no respondió";
  if (m.startsWith("liberar:")) return "La base no permitió liberar";
  return MOTIVO[m] ?? m;
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
const pesos = (n: number | null) => (n === null ? "-" : `$${n.toLocaleString("es-AR")}`);

function compraTexto(c: Compra) {
  if (c.tipo === "reserva") return `Reserva #${c.id ?? "?"} · ${c.estado ?? "sin datos"}${c.fecha ? ` · ${c.fecha} ${c.hora ?? ""}` : ""}`;
  return `Gift Card${c.tarjetas > 1 ? `s (${c.tarjetas})` : ""} · ${c.estado ?? "sin datos"}${c.creada ? ` · ${fecha(c.creada)}` : ""}`;
}

export default function RetencionesCodigo({ codigoId, codigo, onCambio }: { codigoId: number; codigo: string; onCambio: () => void }) {
  const [filas, setFilas] = useState<Retencion[] | null>(null);
  const [instaladas, setInstaladas] = useState(true);
  const [error, setError] = useState("");
  const [revisando, setRevisando] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const visto = useRef(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/codigos-descuento/${codigoId}/retenciones`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "No se pudieron cargar las retenciones."); return; }
      setInstaladas(d.instaladas !== false);
      setFilas(d.retenciones ?? []);
    } catch {
      setError("Error de conexión.");
    }
  }, [codigoId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function revisar(cuerpo: { retencion_id: string } | { codigo_id: number }, clave: string) {
    setRevisando(clave);
    setAviso("");
    try {
      const res = await fetch("/api/admin/cupones/conciliar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setAviso(d.error || "No se pudo revisar."); return; }
      const r = (d.resultados ?? []) as { resultado: string; motivo: string }[];
      setAviso(r.length === 0
        ? "No había retenciones vencidas para revisar."
        : r.map((x) => `${x.resultado === "retenida" ? "Sigue retenida" : x.resultado === "liberada" ? "Liberada" : x.resultado === "consumida" ? "Consumida" : x.resultado}: ${motivo(x.motivo)}`).join(" · "));
      await cargar();
      onCambio();
    } catch {
      setAviso("Error de conexión. Es seguro volver a intentarlo.");
    } finally {
      setRevisando(null);
    }
  }

  return (
    <div ref={(el) => { if (el && !visto.current) { visto.current = true; el.scrollIntoView({ block: "nearest" }); } }} className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4" aria-label={`Retenciones de ${codigo}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-amber-400">Retenciones de {codigo}</p>
        <button
          type="button"
          disabled={revisando !== null || !instaladas}
          onClick={() => revisar({ codigo_id: codigoId }, "codigo")}
          className="rounded-xl border border-amber-500/40 px-3 py-2 text-xs font-black uppercase text-amber-300 transition hover:bg-amber-500/10 disabled:opacity-40"
        >
          {revisando === "codigo" ? "Revisando…" : "Revisar las vencidas en Mercado Pago"}
        </button>
      </div>
      <p className="mb-3 text-xs text-white/45">
        Una retención solo se libera si Mercado Pago confirma que esa compra ya no se puede pagar. Si no lo confirma, queda retenida con su motivo.
      </p>
      {aviso && <p role="status" className="mb-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white/80">{aviso}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!instaladas && <p className="text-sm text-white/60">Las retenciones todavía no están instaladas en esta base.</p>}
      {filas === null && !error ? (
        <p className="text-sm text-white/50">Cargando…</p>
      ) : filas && filas.length === 0 ? (
        <p className="text-sm text-white/50">Este código no tiene retenciones.</p>
      ) : filas ? (
        <div className="space-y-2">
          {filas.map((r) => (
            <div key={r.id} className={`rounded-xl border p-3 text-xs ${r.requiere_revision ? "border-amber-500/50 bg-black" : "border-white/10 bg-black"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 font-black uppercase ${r.estado === "retenido" ? "bg-amber-500/20 text-amber-300" : r.estado === "consumido" ? "bg-green-600/20 text-green-300" : "bg-zinc-700/40 text-zinc-300"}`}>
                  {ESTADO[r.estado]}
                </span>
                <span className="font-bold text-white">{compraTexto(r.compra)}</span>
                {r.nota === "legado" && <span className="rounded-md border border-white/20 px-1.5 py-0.5 text-[10px] uppercase text-white/60">Compra anterior</span>}
                {r.requiere_revision && (
                  <span className="rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                    Revisar: {REVISION[r.requiere_revision] ?? r.requiere_revision}
                  </span>
                )}
              </div>
              <div className="mt-2 grid gap-1 text-white/60 sm:grid-cols-2 lg:grid-cols-4">
                <span>Retenida: {fecha(r.retenido_en)}</span>
                <span>{r.estado === "retenido" ? `No se revisa antes de: ${fecha(r.vence_en)}` : r.estado === "consumido" ? `Consumida: ${fecha(r.consumido_en)}` : `Liberada: ${fecha(r.liberado_en)} (${motivo(r.motivo_liberacion)})`}</span>
                <span>Importe: {pesos(r.importes.final)} (desc. {pesos(r.importes.descuento)})</span>
                <span>{r.pago_id ? `Pago MP ${r.pago_id}` : r.con_pago ? (r.preferencia ? "Link de pago entregado" : "Pago habilitado, sin link guardado") : "Sin pago"}</span>
                <span className="sm:col-span-2 lg:col-span-3">
                  Última revisión: {r.revisiones > 0 ? `${fecha(r.revisada_en)} · ${motivo(r.revision_motivo)} (${r.revisiones})` : "nunca"}
                </span>
                {r.estado === "retenido" && (
                  <button
                    type="button"
                    disabled={revisando !== null}
                    onClick={() => revisar({ retencion_id: r.id }, r.id)}
                    className="justify-self-start rounded-lg border border-white/20 px-2 py-1 font-black uppercase text-white/80 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    {revisando === r.id ? "Revisando…" : "Revisar estado"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
