"use client";

import { useState } from "react";
import { CONDICIONES_MENSUALIDAD } from "@/lib/mensualidadesCondiciones";
import type { Plan } from "@/lib/mensualidades";

// Formulario público de compra (Bloque M3). El navegador solo manda el SLUG del
// plan y los datos del comprador: precio, minutos y vigencia los relee el
// servidor de mensualidad_planes. Nada monetario viaja desde acá.

function formatearPrecio(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

function horas(minutos: number) {
  const h = minutos / 60;
  return Number.isInteger(h) ? `${h} ${h === 1 ? "hora" : "horas"}` : `${minutos} minutos`;
}

export default function CompraMensualidad({ planes }: { planes: Plan[] }) {
  const [slug, setSlug] = useState<string>(planes[0]?.slug ?? "");
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  // La casilla NUNCA arranca marcada.
  const [acepto, setAcepto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  // Una clave por intento lógico: el doble clic reusa la misma y no crea dos compras.
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());

  const plan = planes.find((p) => p.slug === slug) ?? planes[0];
  const puedeComprar = Boolean(nombre.trim() && apellido.trim() && telefono.trim() && email.trim() && acepto && plan && !enviando);

  async function comprar() {
    if (!puedeComprar || !plan) return;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch("/api/mensualidades/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre, apellido, telefono, email,
          plan_slug: plan.slug,
          acepto_condiciones: acepto,
          idempotency_key: idemKey,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.init_point) {
        setError(data?.error || "No pudimos iniciar el pago. Probá de nuevo.");
        // Intento nuevo = clave nueva, así un reintento deliberado no queda pegado
        // a la compra anterior.
        setIdemKey(crypto.randomUUID());
        setEnviando(false);
        return;
      }
      window.location.href = data.init_point;
    } catch {
      setError("Error de conexión. Probá de nuevo.");
      setEnviando(false);
    }
  }

  const inp =
    "w-full rounded-2xl border border-white/10 bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50";

  return (
    <>
      {/* ── Planes ── */}
      <div className="grid items-stretch gap-5 md:grid-cols-3">
        {planes.map((p) => {
          const activo = p.slug === slug;
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => setSlug(p.slug)}
              aria-pressed={activo}
              className={`flex flex-col rounded-[26px] border p-6 text-left transition md:p-7 ${
                activo
                  ? "border-red-500 bg-red-950/20 ring-1 ring-red-500/40"
                  : "border-white/10 bg-[#0b0b0d] hover:border-white/25"
              }`}
            >
              <div className="mb-4 flex min-h-[26px] items-center">
                {p.etiqueta && (
                  <span className="rounded-md bg-red-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                    {p.etiqueta}
                  </span>
                )}
              </div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                {horas(p.minutos)}
              </p>
              <p className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                {formatearPrecio(p.precio)}
              </p>
              <p className="mt-2 text-sm font-bold text-zinc-400">
                {p.minutos} minutos de simulador
              </p>
              <div className="my-5 h-px bg-white/10" />
              <p className="flex-1 text-sm leading-6 text-zinc-400">
                Vigencia de {p.vigencia_dias} días desde que se aprueba el pago.
              </p>
              <span
                className={`mt-6 block rounded-2xl px-5 py-3 text-center text-sm font-black uppercase tracking-[0.18em] ${
                  activo ? "bg-red-600 text-white" : "border border-red-600/40 text-red-300"
                }`}
              >
                {activo ? "Plan elegido" : "Elegir"}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Datos del titular ── */}
      <div className="mt-10 rounded-[26px] border border-white/10 bg-[#0b0b0d] p-6 md:p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight">Tus datos</h2>
        <p className="mt-2 text-sm text-zinc-400">
          El código de la mensualidad queda a nombre del titular. Vas a usarlo junto
          con tu teléfono para reservar.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="mens-nombre" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
              Nombre
            </label>
            <input id="mens-nombre" className={inp} value={nombre} maxLength={60}
              autoComplete="given-name" onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div>
            <label htmlFor="mens-apellido" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
              Apellido
            </label>
            <input id="mens-apellido" className={inp} value={apellido} maxLength={60}
              autoComplete="family-name" onChange={(e) => setApellido(e.target.value)} />
          </div>
          <div>
            <label htmlFor="mens-tel" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
              Teléfono
            </label>
            <input id="mens-tel" className={inp} value={telefono} maxLength={40} inputMode="tel"
              autoComplete="tel" placeholder="351 512 3456"
              onChange={(e) => setTelefono(e.target.value)} />
            <p className="mt-1.5 text-xs text-zinc-500">
              Con código de área y sin el 0 ni el 15. También sirve +54 9 351 512 3456.
            </p>
          </div>
          <div>
            <label htmlFor="mens-email" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
              Correo electrónico
            </label>
            <input id="mens-email" className={inp} value={email} maxLength={120} inputMode="email"
              autoComplete="email" placeholder="tu@correo.com"
              onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        {/* ── Condiciones ── */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-black uppercase tracking-[0.1em]">Condiciones de la mensualidad</h3>
          <ul className="mt-3 space-y-2">
            {CONDICIONES_MENSUALIDAD.map((c) => (
              <li key={c} className="flex gap-2.5 text-sm leading-6 text-zinc-400">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-red-500" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
          <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-red-600" />
          <span>
            Leí y acepto las condiciones, y declaro que todos los participantes cumplen
            los requisitos de altura y peso.
          </span>
        </label>

        {error && (
          <p role="alert" className="mt-5 rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={comprar}
          disabled={!puedeComprar}
          className="mt-6 w-full rounded-2xl bg-red-600 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {enviando ? "Redirigiendo a Mercado Pago..." : plan ? `Pagar ${formatearPrecio(plan.precio)}` : "Elegí un plan"}
        </button>
        <p className="mt-3 text-center text-xs text-zinc-500">
          El pago se procesa en Mercado Pago. SIM no guarda datos de tu tarjeta.
        </p>
      </div>
    </>
  );
}
