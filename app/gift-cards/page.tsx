"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Gift, ArrowLeft, ShieldCheck, CircleAlert } from "lucide-react";
import { GIFT_CARD_CONDICIONES, GIFT_CARD_MAX_CANTIDAD } from "@/lib/giftCards";
import {
  gaEvent, setPendingPurchase,
  trackApplyPromotion, trackCheckoutError, trackPaymentRedirect,
} from "@/lib/analytics";

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

// (B5) La oferta —duraciones, precios y textos— la resuelve el servidor en cada
// request (/api/gift-cards/catalogo, sin caché): antes del corte legacy, desde
// el primer request posterior v2. La página no tiene productos propios.
type ProductoGiftCard = { duracion: number; monto: number; titulo: string; descripcion: string };
type CatalogoGiftCards = { modalidad: string; productos: ProductoGiftCard[] };

function esCatalogo(x: unknown): x is CatalogoGiftCards {
  const c = x as CatalogoGiftCards | null;
  return !!c && typeof c.modalidad === "string" && Array.isArray(c.productos) && c.productos.length > 0;
}

async function pedirCatalogo(): Promise<CatalogoGiftCards | null> {
  try {
    const res = await fetch("/api/gift-cards/catalogo", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    return res.ok && esCatalogo(data) ? data : null;
  } catch {
    return null;
  }
}

export default function GiftCardsPage() {
  const [catalogo, setCatalogo] = useState<CatalogoGiftCards | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState(false);
  // null = ninguna elegida (al abrir se elige la primera; tras un cambio de
  // catálogo la persona vuelve a elegir).
  const [duracion, setDuracion] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState<number>(1);
  const [modoUso, setModoUso] = useState<"juntas" | "separadas">("separadas");
  const [compradorNombre, setCompradorNombre] = useState("");
  const [compradorTelefono, setCompradorTelefono] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [codigoInput, setCodigoInput] = useState("");
  const [codigoAplicado, setCodigoAplicado] = useState<CodigoAplicado | null>(null);
  const [aplicandoCodigo, setAplicandoCodigo] = useState(false);

  const producto = catalogo?.productos.find((p) => p.duracion === duracion) ?? null;

  const unit = producto?.monto ?? 0;
  const totalOriginal = unit * cantidad;
  const descuento = codigoAplicado?.descuento || 0;
  const totalFinal = Math.max(totalOriginal - descuento, 0);

  const telefonoDigits = compradorTelefono.replace(/\D/g, "");
  const telefonoValido = telefonoDigits.length >= 10;
  const puedePagar = compradorNombre.trim() && telefonoValido && acepto && !loading && !!producto;

  // Analytics: vista del "producto" gift card (una vez al montar).
  useEffect(() => {
    gaEvent("view_item", { currency: "ARS", items: [{ item_id: "gift_card", item_name: "Gift Card", item_category: "gift_card" }] });
  }, []);

  // Catálogo vigente al abrir; queda elegida la primera Gift Card.
  useEffect(() => {
    let vivo = true;
    void pedirCatalogo().then((c) => {
      if (!vivo) return;
      if (!c) { setErrorCatalogo(true); return; }
      setCatalogo(c);
      setDuracion((d) => d ?? c.productos[0].duracion);
    });
    return () => { vivo = false; };
  }, []);

  async function recargarCatalogo() {
    setErrorCatalogo(false);
    const c = await pedirCatalogo();
    if (c) setCatalogo(c);
    else setErrorCatalogo(true);
    return c;
  }

  function elegirDuracion(p: ProductoGiftCard) {
    setDuracion(p.duracion);
    setCodigoAplicado(null); // el monto cambia: hay que revalidar el código
    // Funnel: selección de producto/duración (id estable, sin PII).
    gaEvent("select_item", {
      item_list_name: "Gift Cards",
      duration_minutes: p.duracion,
      items: [{ item_id: `gift_card_${p.duracion}`, item_name: `Gift Card ${p.duracion} min`, item_category: "gift_card", price: p.monto }],
    });
  }

  function cambiarCantidad(n: number) {
    setCantidad(n);
    setCodigoAplicado(null); // el total cambia: hay que revalidar el código
    if (n <= 1) setModoUso("separadas");
  }

  async function aplicarCodigo() {
    const codigo = codigoInput.trim().toUpperCase();
    if (!codigo) {
      setError("Ingresá un código promocional.");
      return;
    }
    if (!producto) {
      setError("Elegí una Gift Card.");
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
      trackApplyPromotion("gift_card", Number(data.descuento || 0));
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
    if (!producto || !catalogo) {
      setError("Elegí una Gift Card.");
      return;
    }
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
    // Funnel: configuración válida + decisión de iniciar la compra (ambas ramas).
    gaEvent("begin_checkout", {
      currency: "ARS",
      value: totalFinal,
      duration_minutes: producto.duracion,
      items: [{ item_id: `gift_card_${producto.duracion}`, item_name: "Gift Card", item_category: "gift_card", quantity: cantidad, price: unit }],
    });
    try {
      const res = await fetch("/api/gift-cards/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comprador_nombre: compradorNombre.trim(),
          comprador_telefono: compradorTelefono.trim(),
          destinatario_nombre: destinatario.trim() || null,
          duracion_minutos: producto.duracion,
          cantidad,
          modo_uso: modoUso,
          codigo_descuento: codigoAplicado?.codigo || null,
          // El catálogo que la persona VIO. Si el servidor ya ofrece otro,
          // responde 409 sin crear nada ni cobrar.
          modalidad_vista: catalogo.modalidad,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.codigo === "catalogo_actualizado") {
        // Cambió el catálogo (el corte): no se creó nada. Los datos personales
        // quedan; la Gift Card elegida y el código se limpian y se vuelve a elegir.
        setError(data.error);
        setCodigoAplicado(null);
        setDuracion(null);
        await recargarCatalogo();
        return;
      }
      if (!res.ok) {
        // Error técnico del checkout (no se pudo crear la preferencia).
        trackCheckoutError("gift_card");
        setError(data.error || "No se pudo iniciar el pago.");
        return;
      }
      // Gift Card 100% bonificada: salta Mercado Pago. La conversión (purchase value 0)
      // se emite en /gift-cards/exito con external_reference estable (dedupe).
      if (data.free && data.grupo_compra_id) {
        setPendingPurchase({ value: 0, currency: "ARS", type: "gift_card" });
        window.location.href = `/gift-cards/exito?external_reference=gift_card_${data.grupo_compra_id}`;
        return;
      }
      const url = data.init_point || data.sandbox_init_point;
      if (!url) {
        trackCheckoutError("gift_card");
        setError("Mercado Pago no devolvió un enlace de pago.");
        return;
      }
      // Preferencia OK + init_point válido → redirección efectiva a Mercado Pago.
      trackPaymentRedirect({
        funnel: "gift_card",
        value: totalFinal,
        duration_minutes: producto.duracion,
        quantity: cantidad,
        transaction_id: data.grupo_compra_id ? `gift_card_${data.grupo_compra_id}` : null,
      });
      setPendingPurchase({ value: totalFinal, currency: "ARS", type: "gift_card" });
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
          href="/vivi-sim"
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
            {!catalogo ? (
              <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-6 text-sm text-zinc-400">
                {errorCatalogo ? (
                  <>
                    No pudimos cargar las Gift Cards.{" "}
                    <button type="button" onClick={() => void recargarCatalogo()} className="font-bold text-red-400 underline underline-offset-2">
                      Reintentar
                    </button>
                  </>
                ) : (
                  "Cargando Gift Cards..."
                )}
              </div>
            ) : (
            <div className={catalogo.productos.length >= 3 ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>
              {catalogo.productos.map((p) => {
                const activo = p.duracion === duracion;
                return (
                  <button
                    key={p.duracion}
                    type="button"
                    onClick={() => elegirDuracion(p)}
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
            )}

            {/* Cantidad + modo de uso */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                  Cantidad
                </label>
                <select
                  value={cantidad}
                  onChange={(e) => cambiarCantidad(Number(e.target.value))}
                  className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-red-500/50"
                >
                  {Array.from({ length: GIFT_CARD_MAX_CANTIDAD }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "gift card" : "gift cards"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                  Modo de uso
                </label>
                {cantidad > 1 ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["separadas", "Por separado"],
                        ["juntas", "Van juntas"],
                      ] as const).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setModoUso(v)}
                          className={`rounded-2xl border px-3 py-3 text-sm font-bold transition ${
                            modoUso === v
                              ? "border-red-500/60 bg-red-950/30 text-white"
                              : "border-white/10 text-zinc-400 hover:border-white/25"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      {modoUso === "juntas"
                        ? "Un solo código con todos los usos."
                        : "Un código único por cada gift card."}
                    </p>
                  </>
                ) : (
                  <p className="pt-2 text-sm text-zinc-500">
                    Elegí 2 o más para decidir si van juntas o separadas.
                  </p>
                )}
              </div>
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
                    <span>{producto ? `${producto.duracion} min` : "Elegí una"}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Cantidad</span>
                    <span>
                      {cantidad}
                      {cantidad > 1 ? ` · ${modoUso === "juntas" ? "juntas" : "separadas"}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span>Precio unitario</span>
                    <span>{producto ? formatPrice(unit) : "—"}</span>
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
                  <span>
                    Confirmo que leí y acepto las condiciones de uso de la Gift Card
                    (altura mínima 1,40 m, peso máximo 110 kg), los{" "}
                    <a href="/legales/terminos" target="_blank" rel="noopener noreferrer" className="font-semibold text-red-400 underline underline-offset-2 hover:text-red-300">
                      Términos y Condiciones
                    </a>{" "}
                    y la{" "}
                    <a href="/legales/privacidad" target="_blank" rel="noopener noreferrer" className="font-semibold text-red-400 underline underline-offset-2 hover:text-red-300">
                      Política de Privacidad
                    </a>
                    .
                  </span>
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
                {!producto
                  ? "Elegí una Gift Card"
                  : loading
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
