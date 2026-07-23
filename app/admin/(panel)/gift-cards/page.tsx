"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GiftCardDownloadable from "@/components/GiftCardDownloadable";

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
  monto_original: number | null;
  descuento_aplicado: number | null;
  codigo_descuento: string | null;
  cantidad: number;
  modo_uso: string;
  grupo_compra_id: string | null;
  usos_totales: number;
  usos_disponibles: number;
  estado_uso: string;
  mercado_pago_payment_id: string | null;
  fecha_pago: string | null;
  fecha_uso: string | null;
  fecha_vencimiento: string | null;
  observaciones: string | null;
  deleted_at?: string | null;
};

type GiftCardLog = {
  id: string;
  accion: string;
  rol: string | null;
  detalle: Record<string, unknown> | null;
  created_at: string;
};

function fechaHoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatPrice(value: number | null) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
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

const USO_LABEL: Record<string, string> = {
  pendiente: "Pendiente de usar",
  usada: "Usada",
  vencida: "Vencida",
  cancelada: "Cancelada",
};

function BadgeUso({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    pendiente: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    usada: "bg-green-500/15 text-green-400 border-green-500/30",
    vencida: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    cancelada: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-black ${map[estado] ?? "bg-zinc-700/40 text-zinc-300 border-zinc-600"}`}>
      {USO_LABEL[estado] ?? estado}
    </span>
  );
}

function ModoBadge({ modo }: { modo: string }) {
  const isJuntas = modo === "juntas";
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-black ${
        isJuntas
          ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
          : "bg-zinc-600/20 text-zinc-300 border-zinc-600/40"
      }`}
    >
      {isJuntas ? "Juntas" : "Separadas"}
    </span>
  );
}

export default function AdminGiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [codigo, setCodigo] = useState("");
  // Filtro por defecto: Activas (pendiente). Oculta las usadas por defecto (#6/#7).
  const [estadoUso, setEstadoUso] = useState("pendiente");
  const [detalle, setDetalle] = useState<GiftCard | null>(null);
  const [accionId, setAccionId] = useState<string | null>(null);
  // Modales de las nuevas acciones.
  const [visual, setVisual] = useState<GiftCard | null>(null);
  const [renovar, setRenovar] = useState<GiftCard | null>(null);
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [audit, setAudit] = useState<GiftCard | null>(null);
  const [logs, setLogs] = useState<GiftCardLog[] | null>(null);
  // Eliminación (archivado) — solo admin.
  const [role, setRole] = useState<string | null>(null);
  const esAdmin = role === "admin";
  const [verArchivadas, setVerArchivadas] = useState(false);
  const [aEliminar, setAEliminar] = useState<GiftCard | null>(null);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then((d) => setRole(d.role)).catch(() => {});
  }, []);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      const termino = codigo.trim();
      if (termino) qs.set("codigo", termino);
      // Al buscar por código se ignora el filtro de estado para poder encontrar
      // también las usadas/vencidas (#7). Sin búsqueda, aplica el estado elegido.
      if (estadoUso && !termino) qs.set("estado_uso", estadoUso);
      if (verArchivadas) qs.set("mostrar", "eliminadas");
      const res = await fetch(`/api/admin/gift-cards?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setCards(Array.isArray(data) ? data : []);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [codigo, estadoUso, verArchivadas]);

  useEffect(() => {
    const t = setTimeout(fetchCards, 250);
    return () => clearTimeout(t);
  }, [fetchCards]);

  const stats = useMemo(() => {
    const pendientes = cards.filter((c) => c.estado_uso === "pendiente").length;
    const usadas = cards.filter((c) => c.estado_uso === "usada").length;
    const recaudado = cards
      .filter((c) => c.estado_uso !== "cancelada")
      .reduce((sum, c) => sum + Number(c.monto), 0);
    return { total: cards.length, pendientes, usadas, recaudado };
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

  // Eliminar (archivar): solo admin. No borra pago ni datos de MP.
  async function eliminarCard() {
    if (!aEliminar) return;
    setAccionId(aEliminar.id);
    try {
      const res = await fetch(`/api/admin/gift-cards/${aEliminar.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(d?.error || "No se pudo eliminar");
        return;
      }
      setAEliminar(null);
      await fetchCards();
    } finally {
      setAccionId(null);
    }
  }

  function abrirRenovar(c: GiftCard) {
    const base = c.fecha_vencimiento ? c.fecha_vencimiento.slice(0, 10) : fechaHoyISO();
    setNuevaFecha(base);
    setRenovar(c);
  }

  async function guardarRenovar() {
    if (!renovar) return;
    if (!nuevaFecha) { alert("Elegí una fecha de vencimiento."); return; }
    await accion(renovar.id, { accion: "renovar", fecha_vencimiento: nuevaFecha });
    setRenovar(null);
  }

  async function abrirAudit(c: GiftCard) {
    setAudit(c);
    setLogs(null);
    try {
      const res = await fetch(`/api/admin/gift-cards/${c.id}`, { cache: "no-store" });
      const data = await res.json();
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
    } catch {
      setLogs([]);
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
          {stats.total} vendidas · {stats.pendientes} por usar · {stats.usadas} usadas · {formatPrice(stats.recaudado)} cobrado
        </p>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          className={`${sel} min-w-[200px]`}
          placeholder="Buscar por código..."
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
        <select className={sel} value={estadoUso} onChange={(e) => setEstadoUso(e.target.value)}>
          <option value="pendiente">Activas</option>
          <option value="usada">Usadas</option>
          <option value="vencida">Vencidas</option>
          <option value="cancelada">Canceladas</option>
          <option value="">Todas</option>
        </select>
        {(codigo || estadoUso !== "pendiente") && (
          <button
            onClick={() => { setCodigo(""); setEstadoUso("pendiente"); }}
            className="text-xs font-black uppercase tracking-wider text-red-400 hover:text-red-300"
          >
            Limpiar ×
          </button>
        )}
        {esAdmin && (
          <button
            onClick={() => setVerArchivadas((v) => !v)}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${verArchivadas ? "bg-zinc-700 text-white" : "border border-white/10 text-zinc-300 hover:text-white"}`}
          >
            {verArchivadas ? "Ver activas" : "Ver archivadas"}
          </button>
        )}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">Cargando...</div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl border border-white/10 py-16 text-center text-zinc-500">
          No hay gift cards vendidas para los filtros seleccionados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-zinc-400">
              <tr>
                {["Código", "Comprador", "Duración", "Usos", "Disp.", "Modo", "Monto", "Estado", "Vendida", "Acciones"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {cards.map((c) => (
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
                  <td className="px-4 py-3 text-zinc-300 tabular-nums">{c.usos_totales}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className={c.usos_disponibles > 0 ? "text-white font-bold" : "text-zinc-500"}>
                      {c.usos_disponibles}
                    </span>
                  </td>
                  <td className="px-4 py-3"><ModoBadge modo={c.modo_uso} /></td>
                  <td className="px-4 py-3 font-black text-white">{formatPrice(c.monto)}</td>
                  <td className="px-4 py-3"><BadgeUso estado={c.estado_uso} /></td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{formatFechaHora(c.fecha_pago || c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setDetalle(c)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                      >
                        Detalle
                      </button>
                      <button
                        onClick={() => setVisual(c)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                      >
                        Visualizar
                      </button>
                      <button
                        onClick={() => abrirRenovar(c)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                      >
                        Renovar
                      </button>
                      <button
                        onClick={() => abrirAudit(c)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                      >
                        Historial
                      </button>
                      {!verArchivadas && c.estado_uso === "pendiente" && (
                        <>
                          {c.usos_totales > 1 && c.usos_disponibles > 0 && (
                            <button
                              disabled={accionId === c.id}
                              onClick={() => accion(c.id, { accion: "registrar_uso" })}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                            >
                              Registrar uso
                            </button>
                          )}
                          <button
                            disabled={accionId === c.id}
                            onClick={() => accion(c.id, { accion: "marcar_usada" })}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-500 disabled:opacity-50"
                          >
                            Marcar usada
                          </button>
                          <button
                            disabled={accionId === c.id}
                            onClick={() => accion(c.id, { accion: "marcar_vencida" })}
                            className="rounded-lg border border-orange-500/40 px-3 py-1.5 text-xs font-bold text-orange-400 hover:bg-orange-500/10 disabled:opacity-50"
                          >
                            Vencida
                          </button>
                          <button
                            disabled={accionId === c.id}
                            onClick={() => { if (confirm("¿Cancelar esta Gift Card?")) accion(c.id, { accion: "marcar_cancelada" }); }}
                            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      {!verArchivadas && c.estado_uso !== "pendiente" && (
                        <button
                          disabled={accionId === c.id}
                          onClick={() => accion(c.id, { accion: "marcar_pendiente" })}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white disabled:opacity-50"
                        >
                          Volver a pendiente
                        </button>
                      )}
                      {esAdmin && !verArchivadas && (
                        <button
                          disabled={accionId === c.id}
                          onClick={() => setAEliminar(c)}
                          className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      )}
                      {esAdmin && verArchivadas && (
                        <button
                          disabled={accionId === c.id}
                          onClick={() => accion(c.id, { accion: "restaurar" })}
                          className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-600 disabled:opacity-50"
                        >
                          Restaurar
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
                ["Duración individual", `${detalle.duracion_minutos} min`],
                ["Modo", detalle.modo_uso === "juntas" ? "Juntas" : "Separadas"],
                ["Usos totales", String(detalle.usos_totales)],
                ["Usos disponibles", String(detalle.usos_disponibles)],
                ["Monto", formatPrice(detalle.monto)],
                ["Código descuento", detalle.codigo_descuento || "—"],
                ["Vendida", formatFechaHora(detalle.fecha_pago || detalle.created_at)],
                ["Vence", formatFechaHora(detalle.fecha_vencimiento)],
                ["Usada", formatFechaHora(detalle.fecha_uso)],
                ["MP Payment ID", detalle.mercado_pago_payment_id || "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-zinc-500">{k}</span>
                  <span className="text-right font-bold text-white">{v}</span>
                </div>
              ))}
              <div className="flex justify-between gap-4 pt-1">
                <span className="text-zinc-500">Estado</span>
                <BadgeUso estado={detalle.estado_uso} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {detalle.estado_uso === "pendiente" && (
                <>
                  {detalle.usos_totales > 1 && detalle.usos_disponibles > 0 && (
                    <button
                      disabled={accionId === detalle.id}
                      onClick={() => accion(detalle.id, { accion: "registrar_uso" })}
                      className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      Registrar uso
                    </button>
                  )}
                  <button
                    disabled={accionId === detalle.id}
                    onClick={() => accion(detalle.id, { accion: "marcar_usada" })}
                    className="rounded-xl bg-green-600 px-5 py-2 font-bold text-white hover:bg-green-500 disabled:opacity-50"
                  >
                    Marcar usada
                  </button>
                  <button
                    disabled={accionId === detalle.id}
                    onClick={() => accion(detalle.id, { accion: "marcar_vencida" })}
                    className="rounded-xl border border-orange-500/40 px-5 py-2 font-bold text-orange-400 hover:bg-orange-500/10 disabled:opacity-50"
                  >
                    Marcar vencida
                  </button>
                  <button
                    disabled={accionId === detalle.id}
                    onClick={() => { if (confirm("¿Cancelar esta Gift Card?")) accion(detalle.id, { accion: "marcar_cancelada" }); }}
                    className="rounded-xl border border-red-500/40 px-5 py-2 font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </>
              )}
              {detalle.estado_uso !== "pendiente" && (
                <button
                  disabled={accionId === detalle.id}
                  onClick={() => accion(detalle.id, { accion: "marcar_pendiente" })}
                  className="rounded-xl border border-white/10 px-5 py-2 font-bold text-zinc-300 hover:text-white disabled:opacity-50"
                >
                  Volver a pendiente
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Visualizar (#4): muestra la Gift Card existente tal cual la recibió el cliente. */}
      {visual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setVisual(null)}>
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Gift Card</p>
                <h2 className="mt-1 font-mono text-xl font-black text-white">{visual.codigo_unico}</h2>
              </div>
              <button onClick={() => setVisual(null)} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button>
            </div>
            <GiftCardDownloadable
              card={{
                codigo_unico: visual.codigo_unico,
                duracion_minutos: visual.duracion_minutos,
                monto: visual.monto,
                destinatario_nombre: visual.destinatario_nombre,
                fecha: visual.fecha_pago || visual.created_at,
                usos_totales: visual.usos_totales,
                modo_uso: visual.modo_uso,
              }}
            />
          </div>
        </div>
      )}

      {/* Renovar (#5): solo cambia la fecha de vencimiento. */}
      {renovar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setRenovar(null)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Renovar vencimiento</p>
                <h2 className="mt-1 font-mono text-lg font-black text-white">{renovar.codigo_unico}</h2>
              </div>
              <button onClick={() => setRenovar(null)} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button>
            </div>
            <p className="mb-3 text-sm text-zinc-400">
              Solo se actualiza la fecha de vencimiento. No cambia el código, comprador, importe, estado ni la imagen.
            </p>
            <label className="mb-1 block text-xs font-black uppercase tracking-wider text-zinc-500">Nueva fecha de vencimiento</label>
            <input
              type="date"
              value={nuevaFecha}
              onChange={(e) => setNuevaFecha(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRenovar(null)} className="rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white">Cancelar</button>
              <button
                onClick={guardarRenovar}
                disabled={accionId === renovar.id || !nuevaFecha}
                className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50"
              >
                {accionId === renovar.id ? "Guardando..." : "Renovar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auditoría (#8): historial de acciones de la Gift Card. */}
      {audit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setAudit(null)}>
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Historial</p>
                <h2 className="mt-1 font-mono text-lg font-black text-white">{audit.codigo_unico}</h2>
              </div>
              <button onClick={() => setAudit(null)} className="text-2xl leading-none text-zinc-500 hover:text-white">×</button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {logs === null ? (
                <p className="py-6 text-center text-sm text-zinc-500">Cargando historial...</p>
              ) : (
                <>
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
                      <span className="text-sm font-bold text-white">{l.accion}</span>
                      <span className="text-xs text-zinc-500">
                        {l.rol ? `${l.rol} · ` : ""}{formatFechaHora(l.created_at)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
                    <span className="text-sm font-bold text-white">Creada</span>
                    <span className="text-xs text-zinc-500">{formatFechaHora(audit.fecha_pago || audit.created_at)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Eliminar (archivar): solo admin. Confirmación con el código. */}
      {aEliminar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setAEliminar(null)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-white">Eliminar Gift Card</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Este registro dejará de mostrarse y de utilizarse, pero se conservará en el historial. El pago, los datos de Mercado Pago y los movimientos financieros no se tocan.
            </p>
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 font-mono font-bold text-white">{aEliminar.codigo_unico}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setAEliminar(null)} disabled={accionId === aEliminar.id} className="rounded-xl border border-white/10 px-5 py-2 text-sm font-bold text-zinc-300 hover:text-white disabled:opacity-50">Cancelar</button>
              <button onClick={eliminarCard} disabled={accionId === aEliminar.id} className="rounded-xl bg-red-600 px-6 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50">{accionId === aEliminar.id ? "..." : "Eliminar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
