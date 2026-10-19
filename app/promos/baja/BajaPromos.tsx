"use client";

import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

// Baja de promociones. La respuesta es la misma esté o no anotado el número: la
// página no confirma qué teléfonos hay en el registro. "sitio" es la trampa para bots.

export default function BajaPromos() {
  const [telefono, setTelefono] = useState("");
  const [sitio, setSitio] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");
  const intento = useRef<{ clave: string; cuerpo: string } | null>(null);

  async function enviar() {
    if (enviando || !telefono.trim()) return;
    setEnviando(true);
    setError("");
    const datos = { telefono, sitio };
    const cuerpo = JSON.stringify(datos);
    if (!intento.current || intento.current.cuerpo !== cuerpo) intento.current = { clave: crypto.randomUUID(), cuerpo };
    try {
      const res = await fetch("/api/promos/baja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotency_key: intento.current.clave, ...datos }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setListo(d?.mensaje || "Listo.");
        setTelefono("");
        intento.current = null;
        return;
      }
      setError(d?.error || "No pudimos registrar la baja. Probá de nuevo.");
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div role="status" className="mt-8 rounded-[26px] border border-green-500/30 bg-green-950/20 p-6 md:p-8">
        <p className="flex items-start gap-3 text-lg font-bold text-green-300">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
          {listo}
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-8 grid gap-5 rounded-[26px] border border-white/10 bg-white/[0.02] p-6 md:p-8"
      onSubmit={(e) => { e.preventDefault(); void enviar(); }}
    >
      <div>
        <label htmlFor="baja-tel" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Teléfono</label>
        <input
          id="baja-tel" value={telefono} maxLength={30} required inputMode="tel" autoComplete="tel" placeholder="351 512 3456"
          className="w-full rounded-2xl border border-white/10 bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50"
          onChange={(e) => setTelefono(e.target.value)}
        />
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="baja-sitio">Sitio web</label>
        <input id="baja-sitio" tabIndex={-1} autoComplete="off" value={sitio} onChange={(e) => setSitio(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">{error}</p>
      )}
      <button
        type="submit" disabled={enviando || !telefono.trim()}
        className="rounded-2xl border border-red-600/50 bg-red-600/10 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30"
      >
        {enviando ? "Registrando..." : "Darme de baja"}
      </button>
    </form>
  );
}
