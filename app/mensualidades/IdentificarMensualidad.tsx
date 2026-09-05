"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

// Identificación de un titular que ya compró (Bloque M4).
// El código y el teléfono se mandan por POST y no quedan en la URL, ni en
// localStorage, ni en sessionStorage: la respuesta trae una cookie HttpOnly.

export default function IdentificarMensualidad() {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function consultar() {
    if (enviando || !codigo.trim() || !telefono.trim()) return;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch("/api/mensualidades/sesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, telefono }),
      });
      if (res.ok) {
        // Los datos no se guardan en el cliente: se limpian antes de navegar.
        setCodigo("");
        setTelefono("");
        router.push("/mensualidades/mi-plan");
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => null);
      setError(d?.error || "No pudimos consultar tu mensualidad. Probá de nuevo.");
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  const inp =
    "w-full rounded-2xl border border-white/10 bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50";

  return (
    <div id="mi-mensualidad" className="mt-12 scroll-mt-24 rounded-[26px] border border-white/10 bg-white/[0.02] p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-red-950/60 p-2.5 text-red-400">
          <KeyRound className="h-5 w-5" />
        </span>
        <h2 className="text-2xl font-black uppercase tracking-tight">
          ¿Ya tenés una mensualidad?
        </h2>
      </div>
      <p className="mt-3 max-w-2xl text-zinc-400">
        Ingresá tu código y el teléfono utilizado en la compra para consultar tu saldo.
      </p>

      <form
        className="mt-6 grid gap-4 md:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); void consultar(); }}
      >
        <div>
          <label htmlFor="mens-codigo" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
            Código de mensualidad
          </label>
          <input
            id="mens-codigo" className={`${inp} font-mono uppercase`} value={codigo}
            maxLength={40} autoComplete="off" spellCheck={false} placeholder="MEN-XXXX-XXXX"
            onChange={(e) => setCodigo(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="mens-tel-consulta" className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
            Teléfono
          </label>
          <input
            id="mens-tel-consulta" className={inp} value={telefono} maxLength={40}
            inputMode="tel" autoComplete="tel" placeholder="351 512 3456"
            onChange={(e) => setTelefono(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-zinc-500">El mismo que usaste al comprar.</p>
        </div>

        {error && (
          <p role="alert" className="md:col-span-2 rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando || !codigo.trim() || !telefono.trim()}
          className="md:col-span-2 rounded-2xl border border-red-600/50 bg-red-600/10 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30"
        >
          {enviando ? "Consultando..." : "Consultar mi mensualidad"}
        </button>
      </form>
    </div>
  );
}
