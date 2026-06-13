"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GiftCard = {
  id: string;
  created_at: string;
  updated_at: string;
  codigo_unico: string;
  comprador_nombre: string;
  comprador_telefono: string;
  destinatario_nombre: string | null;
  duracion_minutos: number;
  monto: number;
  estado_pago: string;
  estado_uso: string;
  mercado_pago_payment_id: string | null;
  fecha_pago: string | null;
  fecha_uso: string | null;
  observaciones: string | null;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatFechaHora(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function BadgePago({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    pagado: "bg-green-500/15 text-green-400 border-green-500/30",
    pendiente_pago: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    rechazado: "bg-red-500/15 text-red-400 border-red-500/30",
    cancelado: "bg-zinc-600/20 text-zinc-400 border-zinc-600/40",
  };
  const label: Record<string, string> = {
    pagado: "Pagado",
    pendiente_pago: "Pend. pago",
    rechazado: "Rechazado",
    cancelado: "Cancelado",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-black ${map[estado] ?? "bg-zinc-700/40 text-zinc-300 border-zinc-600"}`}>
      {label[estado] ?? estado}
    </span>
  );
}

function BadgeUso({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    lista: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    pendiente: "bg-zinc-600/20 text-zinc-400 border-zinc-600/40",
    usada: "bg-green-500/15 text-green-400 border-green-500/30",
    vencida: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    cancelada: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const label: Record<string, string> = {
    lista: "Lista",
    pendiente: "Pendiente",
    usada: "Usada",
    vencida: "Vencida",
    cancelada: "Cancelada",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-black ${map[estado] ?? "bg-zinc-700/40 text-zinc-300 border-zinc-600"}`}>
      {label[estado] ?? estado}
    </span>
  );
}

export default function AdminGiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [codigo, setCodigo] = useState("");
  const [estadoPago, setEstadoPago] = useState("");
  const [estadoUso, setEstadoUso] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [detalle, setDetalle] = useState<GiftCard | null>(null);
  const [accionId, setAccionId] = useState<string | null>(null);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (codigo.trim()) qs.set("codigo", codigo.trim());
      if (estadoPago) qs.set("estado_pago", estadoPago);
      if (estadoUso) qs.set("estado_uso", estadoUso);
      const res = await fetch(`/api/admin/gift-cards?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setCards(Array.isArray(data) ? data : []);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [codigo, estadoPago, estadoUso]);

  useEffect(() => {
    const t = setTimeout(fetchCards, 250);
    return () => clearTimeout(t);
  }, [fetchCards]);

  const visibles = useMemo(() => {
    // "Pendientes por venir": pagadas y listas, aún no usadas.
    if (soloPendientes) {
      return cards.filter((c) => c.estado_pago === "pagado" && c.estado_uso === "lista");
    }
    return cards;
  }, [cards, soloPendientes]);

  const stats = useMemo(() => {
    const pagadas = cards.filter((c) => c.estado_pago === "pagado");
    const listas = pagadas.filter((c) => c.estado_uso === "lista");
    const usadas = pagadas.filter((c) => c.estado_uso === "usada");
    const recaudado = pagadas.reduce((sum, c) => sum + Number(c.monto), 0);
    return { total: cards.length, listas: listas.length, usadas: usadas.length, recaudado };
  }, [cards]);

  async function accion(id: string, body: Record<string, unknown>) {
    setAccionId(id);
    try {
      const res = await fetch(`/api/admin/gift-cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || "Error al actualizar");
        return;
      }
      await fetchCards();
      setDetalle((prev) => (prev && prev.id === id ? null : prev));
    } finally {
      setAccionId(null);
    }
  }

  const sel =
    "rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-red-500";

  return (
    <div className="min-h-screen bg-black p-4 md:p-8">
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500 mb-1">Panel Admin</p>
        <h1 className="text-3xl font-black text-white">Gift Cards</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {stats.total} gift cards · {stats.listas} listas · {stats.usadas} usadas · {formatPrice(stats.recaudado)} cobrado
        </p>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          className={`${sel} min-w-[180px]`}
          placeholder="Buscar por código..."
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
        <select className={sel} value={estadoPago} onChange={(e) => setEstadoPago(e.target.value)}>
          <option value="">Pago: todos</option>
          <option value="pagado">Pagado</option>
          <option value="pendiente_pago">Pendiente pago</option>
          <option value="rechazado">Rechazado</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select className={sel} value={estadoUso} onChange={(e) => setEstadoUso(e.target.value)}>
          <option value="">Uso: todos</option>
          <option value="pendiente">Pendiente</option>
          <option value="lista">Lista</option>
          <option value="usada">Usada</option>
          <option value="vencida">Vencida</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <button
          onClick={() => setSoloPendientes((v) => !v)}
          className={`rounded-xl px-4 py-2 text-sm font-black transition ${
            soloPendientes ? "bg-red-600 text-white" : "border border-white/10 bg-zinc-900 text-zinc-300 hover:text-white"
          }`}
        >
          Pendientes por venir
        </button>
        {(codigo || estadoPago || estadoUso || soloPendientes) && (
          <button
            onClick={() => { setCodigo(""); setEstadoPago(""); setEstadoUso(""); setSoloPendientes(false); }}
            className="text-xs font-black uppercase tracking-wider text-red-400 hover:text-red-300"
          >
            Limpiar ×
          </button>
        )}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">Cargando...</div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-white/10 py-16 text-center text-zinc-500">
          No hay gift cards para los filtros seleccionados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-zinc-400">
              <tr>
                {["Código", "Comprador", "Duración", "Monto", "Pago", "Uso", "Creada", "Acciones"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibles.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-mono font-bold text-white">{c.codigo_unico}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-white">{c.comprador_nombre}</div>
                    <div className="text-xs text-zinc-500">{c.comprador_telefono}</div>
                    {c.destinatario_nombre && (
                      <div className="text-xs text-zinc-500">→ {c.destinatario_nombre}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{c.duracion_minutos} min</td>
                  <td className="px-4 py-3 font-black text-white">{formatPrice(c.monto)}</td>
                  <td className="px-4 py-3"><BadgePago estado={c.estado_pago} /></td>
                  <td className="px-4 py-3"><BadgeUso estado={c.estado_uso} /></td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{formatFechaHora(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setDetalle(c)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                      >
                        Detalle
                      </button>
                      {c.estado_pago === "pagado" && c.estado_uso !== "lista" && c.estado_uso !== "usada" && (
                        <button
                          disabled={accionId === c.id}
                          onClick={() => accion(c.id, { accion: "marcar_lista" })}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          Marcar lista
                        </button>
                      )}
                      {c.estado_pago === "pagado" && c.estado_uso !== "usada" && (
                        <button
                          disabled={accionId === c.id}
                          onClick={() => accion(c.id, { accion: "marcar_usada" })}
                          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-500 disabled:opacity-50"
                        >
                          Marcar usada
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle */}
      {detalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setDetalle(null)}>
          <div
            className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Gift Card</p>
                <h2 className="mt-1 font-mono text-2xl font-black text-white">{detalle.codigo_unico}</h2>
              </div>
              <button onClick={() => setDetalle(null)} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
              {([
                ["Comprador", detalle.comprador_nombre],
                ["Teléfono", detalle.comprador_telefono],
                ["Destinatario", detalle.destinatario_nombre || "—"],
                ["Duración", `${detalle.duracion_minutos} min`],
                ["Monto", formatPrice(detalle.monto)],
                ["Creada", formatFechaHora(detalle.created_at)],
                ["Pagada", formatFechaHora(detalle.fecha_pago)],
                ["Usada", formatFechaHora(detalle.fecha_uso)],
                ["MP Payment ID", detalle.mercado_pago_payment_id || "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-zinc-500">{k}</span>
                  <span className="text-right font-bold text-white">{v}</span>
                </div>
              ))}
              <div className="flex justify-between gap-4 pt-1">
                <span className="text-zinc-500">Estados</span>
                <span className="flex gap-2"><BadgePago estado={detalle.estado_pago} /><BadgeUso estado={detalle.estado_uso} /></span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {detalle.estado_pago === "pagado" && detalle.estado_uso !== "lista" && detalle.estado_uso !== "usada" && (
                <button
                  disabled={accionId === detalle.id}
                  onClick={() => accion(detalle.id, { accion: "marcar_lista" })}
                  className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Marcar lista
                </button>
              )}
              {detalle.estado_pago === "pagado" && detalle.estado_uso !== "usada" && (
                <button
                  disabled={accionId === detalle.id}
                  onClick={() => accion(detalle.id, { accion: "marcar_usada" })}
                  className="rounded-xl bg-green-600 px-5 py-2 font-bold text-white hover:bg-green-500 disabled:opacity-50"
                >
                  Marcar usada
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
