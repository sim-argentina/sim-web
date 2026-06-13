"use client";

import { useState } from "react";
import Link from "next/link";
import { Gift, ArrowLeft, ShieldCheck, CircleAlert } from "lucide-react";
import { GIFT_CARD_PRODUCTOS, GIFT_CARD_CONDICIONES } from "@/lib/giftCards";

function formatPrice(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

type CodigoAplicado = {
  codigo: string;
  descuento: number;
  totalOriginal: number;
  totalFinal: number;
};

export default function GiftCardsPage() {
  const [duracion, setDuracion] = useState<number>(GIFT_CARD_PRODUCTOS[0].duracion);
  const [compradorNombre, setCompradorNombre] = useState("");
  const [compradorTelefono, setCompradorTelefono] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [codigoInput, setCodigoInput] = useState("");
  const [codigoAplicado, setCodigoAplicado] = useState<CodigoAplicado | null>(null);
  const [aplicandoCodigo, setAplicandoCodigo] = useState(false);

  const producto =
    GIFT_CARD_PRODUCTOS.find((p) => p.duracion === duracion) ??
    GIFT_CARD_PRODUCTOS[0];

  const totalOriginal = producto.monto;
  const descuento = codigoAplicado?.descuento || 0;
  const totalFinal = Math.max(totalOriginal - descuento, 0);

  const telefonoDigits = compradorTelefono.replace(/\D/g, "");
  const telefonoValido = telefonoDigits.length >= 10;
  const puedePagar = compradorNombre.trim() && telefonoValido && acepto && !loading;

  function elegirDuracion(d: number) {
    setDuracion(d);
    setCodigoAplicado(null); // el monto cambia: hay que revalidar el código
  }

  async function aplicarCodigo() {
    const codigo = codigoInput.trim().toUpperCase();
    if (!codigo) {
      setError("Ingresá un código promocional.");
      return;
    }
    setAplicandoCodigo(true);
    setError("");
    try {
      const res = await fetch("/api/codigos-descuento/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, total: totalOriginal }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.valido) {
        setCodigoAplicado(null);
        setError(data?.error || "No se pudo aplicar el código.");
        return;
      }
      setCodigoAplicado({
        codigo: data.codigo,
        descuento: Number(data.descuento || 0),
        totalOriginal: Number(data.totalOriginal || totalOriginal),
        totalFinal: Number(data.totalFinal || totalOriginal),
      });
      setCodigoInput(data.codigo);
    } catch {
      setError("Error al validar el código.");
    } finally {
      setAplicandoCodigo(false);
    }
  }

  function quitarCodigo() {
    setCodigoAplicado(null);
    setCodigoInput("");
  }

  async function comprar() {
    setError("");
    if (!compradorNombre.trim()) {
      setError("Ingresá tu nombre.");
      return;
    }
    if (!telefonoValido) {
      setError("Ingresá un teléfono con al menos 10 dígitos.");
      return;
    }
    if (!acepto) {
      setError("Tenés que aceptar las condiciones de uso.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/gift-cards/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comprador_nombre: compradorNombre.trim(),
          comprador_telefono: compradorTelefono.trim(),
          destinatario_nombre: destinatario.trim() || null,
          duracion_minutos: duracion,
          codigo_descuento: codigoAplicado?.codigo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo iniciar el pago.");
        return;
      }
      // Gift Card 100% bonificada: salta Mercado Pago
      if (data.free && data.gift_card_id) {
        window.location.href = `/gift-cards/exito?external_reference=gift_card_${data.gift_card_id}`;
        return;
      }
      const url = data.init_point || data.sandbox_init_point;
      if (!url) {
        setError("Mercado Pago no devolvió un enlace de pago.");
        return;
      }
      window.location.href = url;
    } catch {
      setError("Error de conexión. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  const inp =
    "w-full rounded-2xl border border-white/10 bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50";

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-10 md:px-6 lg:px-8">
        <Link
          href="/reservas-gift-cards"
          className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-zinc-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>

        <div className="mb-10">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.45em] text-red-500">
            SIM Argentina
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-6xl">
            Regalá una <span className="text-red-600">Gift Card</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
            Regalá una experiencia de manejo en simuladores de Fórmula 1. Elegí
            la duración, pagá online y recibís una Gift Card descargable con un
            código único para canjear en SIM Argentina.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Selección de producto */}
          <section>
            <h2 className="mb-4 text-2xl font-black">Elegí tu Gift Card</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {GIFT_CARD_PRODUCTOS.map((p) => {
                const activo = p.duracion === duracion;
                return (
                  <button
                    key={p.duracion}
                    type="button"
                    onClick={() => elegirDuracion(p.duracion)}
                    className={`rounded-3xl border p-6 text-left transition ${
                      activo
                        ? "border-red-500/60 bg-red-950/20 shadow-[0_0_24px_rgba(239,68,68,0.12)]"
                        : "border-white/10 bg-zinc-950/80 hover:border-white/25"
                    }`}
                  >
                    <div
                      className={`mb-4 inline-flex rounded-2xl p-3 ${
                        activo ? "bg-red-500/20 text-red-400" : "bg-white/5 text-zinc-400"
                      }`}
                    >
                      <Gift className="h-6 w-6" />
                    </div>
                    <div className="text-3xl font-black">{p.duracion} min</div>
                    <div className="mt-1 text-sm text-zinc-400">{p.descripcion}</div>
                    <div className="mt-4 text-2xl font-black text-red-500">
                      {formatPrice(p.monto)}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-zinc-950/80 p-6">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-zinc-500">
                Condiciones
              </p>
              <ul className="space-y-2 text-sm leading-6 text-zinc-400">
                {GIFT_CARD_CONDICIONES.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="text-red-500">·</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Datos + pago */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[30px] border border-white/10 bg-zinc-950/90 p-6 shadow-2xl">
              <div className="mb-5 flex items-start gap-4">
                <div className="rounded-2xl bg-red-950/70 p-4 text-red-400">
                  <Gift className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-black">Tus datos</h2>
                  <p className="text-zinc-400">Para emitir la Gift Card</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                    Tu nombre y apellido
                  </label>
                  <input
                    className={inp}
                    value={compradorNombre}
                    onChange={(e) => setCompradorNombre(e.target.value)}
                    placeholder="Quién compra"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                    Tu teléfono
                  </label>
                  <input
                    className={inp}
                    value={compradorTelefono}
                    onChange={(e) => setCompradorTelefono(e.target.value)}
                    placeholder="+54 9 351..."
                  />
                  {compradorTelefono.trim().length > 0 && !telefonoValido && (
                    <p className="mt-2 text-sm text-red-400">
                      El teléfono debe tener al menos 10 dígitos.
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                    Nombre del destinatario{" "}
                    <span className="text-zinc-500">(opcional)</span>
                  </label>
                  <input
                    className={inp}
                    value={destinatario}
                    onChange={(e) => setDestinatario(e.target.value)}
                    placeholder="Para quién es el regalo"
                  />
                </div>
              </div>

              {/* Código promocional (misma lógica que reservas) */}
              <div className="mt-5 rounded-[22px] border border-white/10 bg-black/40 p-4">
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Código promocional
                </label>
                <div className="flex gap-2">
                  <input
                    value={codigoInput}
                    onChange={(e) => {
                      setCodigoInput(e.target.value.toUpperCase());
                      setCodigoAplicado(null);
                    }}
                    placeholder="Ej: SIM-ABC123"
                    disabled={loading || aplicandoCodigo}
                    className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm font-bold uppercase text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50 disabled:opacity-60"
                  />
                  {codigoAplicado ? (
                    <button
                      type="button"
                      onClick={quitarCodigo}
                      disabled={loading}
                      className="rounded-2xl bg-zinc-800 px-4 py-3 text-sm font-black text-white transition hover:bg-zinc-700 disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={aplicarCodigo}
                      disabled={loading || aplicandoCodigo || !codigoInput.trim()}
                      className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {aplicandoCodigo ? "..." : "Aplicar"}
                    </button>
                  )}
                </div>
                {codigoAplicado && (
                  <p className="mt-3 text-sm font-medium text-green-400">
                    Código aplicado: {codigoAplicado.codigo}
                  </p>
                )}
              </div>

              <div className="mt-6 rounded-[24px] border border-red-500/30 bg-gradient-to-b from-red-950/50 to-red-950/20 p-5">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Gift Card</span>
                    <span>{producto.duracion} min</span>
                  </div>
                  {codigoAplicado && (
                    <>
                      <div className="flex items-center justify-between text-zinc-200">
                        <span>Subtotal</span>
                        <span>{formatPrice(totalOriginal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-green-400">
                        <span>Descuento {codigoAplicado.codigo}</span>
                        <span>-{formatPrice(descuento)}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="my-4 h-px bg-white/10" />
                <div className="flex items-center justify-between text-3xl font-black">
                  <span>Total</span>
                  <span>{formatPrice(totalFinal)}</span>
                </div>
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300 transition hover:border-red-500/30">
                <input
                  type="checkbox"
                  checked={acepto}
                  onChange={(e) => setAcepto(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-red-600"
                />
                <span className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  Confirmo que leí y acepto las condiciones de uso de la Gift Card
                  (altura mínima 1,40 m, peso máximo 110 kg).
                </span>
              </label>

              {error && (
                <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-900/30 px-4 py-3 text-sm text-red-400">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={comprar}
                disabled={!puedePagar}
                className={`mt-5 w-full rounded-2xl py-4 text-lg font-black transition ${
                  puedePagar
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "cursor-not-allowed bg-zinc-800 text-zinc-500"
                }`}
              >
                {loading
                  ? "Redirigiendo..."
                  : totalFinal <= 0
                  ? "Obtener Gift Card bonificada"
                  : `Pagar ${formatPrice(totalFinal)}`}
              </button>

              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-500">
                <ShieldCheck className="h-4 w-4 text-red-500" />
                Pago seguro con Mercado Pago
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
