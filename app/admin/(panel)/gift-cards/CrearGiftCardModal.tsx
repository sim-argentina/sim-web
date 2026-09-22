"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import GiftCardDownloadable from "@/components/GiftCardDownloadable";
import {
  GIFT_CARD_MAX_CANTIDAD,
  GIFT_CARD_OBSERVACIONES_MAX,
  GIFT_CARD_PRODUCTOS,
  GIFT_CARD_VIGENCIA_DIAS,
  MEDIOS_PAGO_GIFT_CARD,
  MEDIO_PAGO_GIFT_CARD_LABEL,
} from "@/lib/giftCards";

// Emisión manual de una Gift Card desde el panel (solo admin).
//
// Esta pantalla NO calcula nada de lo que importa. El precio sale del catálogo
// server-side, el código lo genera el servidor con el mismo generador del flujo
// público y el vencimiento lo pone la regla de vigencia. El total que se muestra
// acá es informativo: si esta pantalla mintiera, el resultado sería el mismo.
//
// No hay Mercado Pago: al confirmar, la Gift Card queda emitida y disponible.

type CardEmitida = {
  id: string;
  codigo_unico: string;
  duracion_minutos: number;
  monto: number;
  usos_totales: number;
  modo_uso: string;
  destinatario_nombre: string | null;
  estado_uso: string;
  fecha_pago: string;
  fecha_vencimiento: string | null;
};

type Emitido = {
  cantidad: number;
  monto_total: number;
  vigencia_dias: number;
  cards: CardEmitida[];
};

function pesos(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function fechaLarga(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

const campo =
  "w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-red-500";
const etiqueta = "mb-1 block text-xs font-black uppercase tracking-wider text-zinc-500";

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Navegador sin permiso de portapapeles: no se rompe nada, el código está
      // a la vista y se puede seleccionar a mano.
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-zinc-300 transition hover:text-white"
    >
      {copiado ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
      {copiado ? "Copiado" : "Copiar código"}
    </button>
  );
}

export default function CrearGiftCardModal({
  onCerrar,
  onCreada,
}: {
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [duracion, setDuracion] = useState(String(GIFT_CARD_PRODUCTOS[0]?.duracion ?? 15));
  const [cantidad, setCantidad] = useState(1);
  const [modoUso, setModoUso] = useState<"separadas" | "juntas">("separadas");
  const [comprador, setComprador] = useState("");
  const [telefono, setTelefono] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [medioPago, setMedioPago] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campoError, setCampoError] = useState<string | null>(null);
  const [emitido, setEmitido] = useState<Emitido | null>(null);

  const producto = useMemo(
    () => GIFT_CARD_PRODUCTOS.find((p) => String(p.duracion) === duracion) ?? null,
    [duracion],
  );
  const totalEstimado = (producto?.monto ?? 0) * cantidad;

  async function emitir() {
    setEnviando(true);
    setError(null);
    setCampoError(null);
    try {
      const res = await fetch("/api/admin/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duracion_minutos: Number(duracion),
          cantidad,
          modo_uso: cantidad > 1 ? modoUso : "separadas",
          comprador_nombre: comprador,
          comprador_telefono: telefono,
          destinatario_nombre: destinatario,
          medio_pago: medioPago,
          observaciones,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "No se pudo emitir la Gift Card.");
        setCampoError(typeof data?.campo === "string" ? data.campo : null);
        return;
      }
      setEmitido({
        cantidad: Number(data.cantidad) || 0,
        monto_total: Number(data.monto_total) || 0,
        vigencia_dias: Number(data.vigencia_dias) || GIFT_CARD_VIGENCIA_DIAS,
        cards: Array.isArray(data.cards) ? (data.cards as CardEmitida[]) : [],
      });
      onCreada();
    } catch {
      setError("No se pudo emitir la Gift Card.");
    } finally {
      setEnviando(false);
    }
  }

  const borde = (nombre: string) =>
    campoError === nombre ? `${campo} border-red-500` : campo;

  // ── Confirmación: la Gift Card ya existe y se puede usar ──────────────────
  if (emitido) {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 p-4">
        <div className="my-8 w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-green-500">
                Gift Card creada
              </p>
              <h2 className="mt-1 text-2xl font-black text-white">
                {emitido.cantidad === 1
                  ? "Ya está disponible para usar"
                  : `${emitido.cantidad} Gift Cards disponibles`}
              </h2>
            </div>
            <button
              onClick={onCerrar}
              className="text-2xl leading-none text-zinc-500 hover:text-white"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>

          <p className="mb-4 text-sm text-zinc-400">
            Se emitió sin pasar por Mercado Pago. Queda paga y pendiente de usar, igual que una
            comprada por la web, y ya aparece en el listado.
          </p>

          <div className="space-y-5">
            {emitido.cards.map((c, i) => (
              <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-500">
                      Código único {emitido.cards.length > 1 ? `· ${i + 1} de ${emitido.cards.length}` : ""}
                    </p>
                    <p className="font-mono text-2xl font-black text-white">{c.codigo_unico}</p>
                  </div>
                  <BotonCopiar texto={c.codigo_unico} />
                </div>

                <div className="mb-4 space-y-1.5 text-sm">
                  {(
                    [
                      ["Producto", `Gift Card · ${c.duracion_minutos} min`],
                      ["Valor", pesos(c.monto)],
                      ...(c.usos_totales > 1
                        ? ([["Usos", `${c.usos_totales} en este código`]] as [string, string][])
                        : []),
                      ["Vence", fechaLarga(c.fecha_vencimiento)],
                      ["Estado", "Paga · pendiente de usar"],
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <span className="text-zinc-500">{k}</span>
                      <span className="text-right font-bold text-white">{v}</span>
                    </div>
                  ))}
                </div>

                {/* Misma imagen que recibe un cliente que compró por la web. */}
                <GiftCardDownloadable
                  card={{
                    codigo_unico: c.codigo_unico,
                    duracion_minutos: c.duracion_minutos,
                    monto: c.monto,
                    destinatario_nombre: c.destinatario_nombre,
                    fecha: c.fecha_pago,
                    usos_totales: c.usos_totales,
                    modo_uso: c.modo_uso,
                    indexLabel:
                      emitido.cards.length > 1 ? `${i + 1} / ${emitido.cards.length}` : null,
                  }}
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={onCerrar}
              className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-red-500"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Formulario ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 p-4">
      <div className="my-8 w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Panel Admin</p>
            <h2 className="mt-1 text-2xl font-black text-white">Crear Gift Card</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Se emite en el momento, sin checkout. Vigencia de {GIFT_CARD_VIGENCIA_DIAS} días desde hoy.
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="text-zinc-500 transition hover:text-white"
            aria-label="Cerrar"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={etiqueta}>Gift Card *</label>
            <select
              className={borde("duracion_minutos")}
              value={duracion}
              onChange={(e) => setDuracion(e.target.value)}
            >
              {GIFT_CARD_PRODUCTOS.map((p) => (
                <option key={p.duracion} value={String(p.duracion)}>
                  {p.titulo} — {pesos(p.monto)}
                </option>
              ))}
            </select>
            {producto && <p className="mt-1 text-xs text-zinc-500">{producto.descripcion}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={etiqueta}>Cantidad</label>
              <select
                className={borde("cantidad")}
                value={String(cantidad)}
                onChange={(e) => setCantidad(Number(e.target.value))}
              >
                {Array.from({ length: GIFT_CARD_MAX_CANTIDAD }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Modo de uso</label>
              <select
                className={campo}
                value={modoUso}
                disabled={cantidad < 2}
                onChange={(e) => setModoUso(e.target.value === "juntas" ? "juntas" : "separadas")}
              >
                <option value="separadas">Separadas (un código cada una)</option>
                <option value="juntas">Juntas (un solo código)</option>
              </select>
            </div>
          </div>

          <div>
            <label className={etiqueta}>Nombre del comprador *</label>
            <input
              className={borde("comprador_nombre")}
              value={comprador}
              onChange={(e) => setComprador(e.target.value)}
              placeholder="Quién la compró"
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={etiqueta}>Teléfono *</label>
              <input
                className={borde("comprador_telefono")}
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="351 252 0927"
                maxLength={30}
              />
            </div>
            <div>
              <label className={etiqueta}>Destinatario</label>
              <input
                className={borde("destinatario_nombre")}
                value={destinatario}
                onChange={(e) => setDestinatario(e.target.value)}
                placeholder="Para quién es (opcional)"
                maxLength={80}
              />
            </div>
          </div>

          <div>
            <label className={etiqueta}>Cómo se cobró *</label>
            <div className="grid grid-cols-4 gap-2">
              {MEDIOS_PAGO_GIFT_CARD.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMedioPago(m)}
                  className={`rounded-xl border px-2 py-2 text-xs font-black transition ${
                    medioPago === m
                      ? "border-red-500 bg-red-500/15 text-white"
                      : "border-white/10 text-zinc-400 hover:text-white"
                  }`}
                >
                  {MEDIO_PAGO_GIFT_CARD_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Define en qué cuenta entra el ingreso en Finanzas.
            </p>
          </div>

          <div>
            <label className={etiqueta}>Observación administrativa</label>
            <textarea
              className={`${borde("observaciones")} min-h-[70px] resize-y`}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value.slice(0, GIFT_CARD_OBSERVACIONES_MAX))}
              placeholder="Opcional: por qué se emitió a mano, quién autorizó…"
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-xs font-black uppercase tracking-wider text-zinc-500">
              Total a registrar
            </span>
            <span className="text-xl font-black text-white">{pesos(totalEstimado)}</span>
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCerrar}
            disabled={enviando}
            className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-bold text-zinc-300 transition hover:text-white disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={emitir}
            disabled={enviando || !comprador.trim() || !telefono.trim() || !medioPago}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-black text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            {enviando ? "Emitiendo..." : "Crear Gift Card"}
          </button>
        </div>
      </div>
    </div>
  );
}
