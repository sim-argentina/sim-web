"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { LIMITES } from "@/lib/marketing/consentimiento";

// Formulario de alta a promociones. Lo que se acepta es el texto vigente TAL CUAL
// llega de /api/promos/texto, y al confirmar viajan su versión y su huella: si el
// texto cambió en el medio, la base lo rechaza y acá se muestra el nuevo.
// La casilla nunca viene marcada. "sitio" es una trampa para bots: invisible y
// fuera del orden de tabulación.

type Texto = { version: string; titulo: string; texto: string; huella: string };

export default function AltaPromos() {
  const [texto, setTexto] = useState<Texto | null>(null);
  // Token firmado del momento en que se mostró el texto: el alta lo devuelve tal cual.
  const [token, setToken] = useState("");
  const [cargaError, setCargaError] = useState("");
  const [telefono, setTelefono] = useState("");
  const [nombre, setNombre] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [sitio, setSitio] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");
  // La misma clave para el mismo pedido: reintentar no duplica; cambiar un dato es otro pedido.
  const intento = useRef<{ clave: string; cuerpo: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/promos/texto", { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => null);
        if (!vivo) return;
        if (res.ok && d?.texto && d?.token) { setTexto(d.texto as Texto); setToken(String(d.token)); }
        else setCargaError(d?.error || "La inscripción no está disponible en este momento.");
      })
      .catch(() => vivo && setCargaError("Error de conexión. Recargá la página."));
    return () => { vivo = false; };
  }, []);

  async function enviar() {
    if (!texto || enviando || !telefono.trim() || !acepto) return;
    setEnviando(true);
    setError("");
    const datos = { telefono, nombre, localidad, acepto, texto_version: texto.version, texto_huella: texto.huella, token, sitio };
    const cuerpo = JSON.stringify(datos);
    if (!intento.current || intento.current.cuerpo !== cuerpo) intento.current = { clave: crypto.randomUUID(), cuerpo };
    try {
      const res = await fetch("/api/promos/alta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotency_key: intento.current.clave, ...datos }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setListo(d?.mensaje || "¡Listo!");
        setTelefono(""); setNombre(""); setLocalidad(""); setAcepto(false);
        intento.current = null;
        return;
      }
      // Texto cambiado o formulario vencido (más de 2 h): llega el texto vigente con un
      // token nuevo y la persona tiene que volver a leerlo y marcar la casilla. Ninguno
      // de los dos depende del número ni de su historial.
      if ((d?.codigo === "texto_desactualizado" || d?.codigo === "formulario_vencido") && d?.texto && d?.token) {
        setTexto(d.texto as Texto);
        setToken(String(d.token));
        setAcepto(false);
        intento.current = null;
        setError(d.codigo === "texto_desactualizado"
          ? "El texto cambió mientras lo leías. Leelo de nuevo y, si estás de acuerdo, volvé a marcar la casilla."
          : "El formulario venció. Leé el texto de nuevo y, si estás de acuerdo, volvé a marcar la casilla.");
        return;
      }
      setError(d?.error || "No pudimos anotarte. Probá de nuevo.");
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  const inp =
    "w-full rounded-2xl border border-white/10 bg-black px-4 py-4 text-white outline-none transition placeholder:text-zinc-500 focus:border-red-500/50";
  const etiqueta = "mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500";

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

  if (!texto) {
    return (
      <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-6 text-zinc-400">
        {cargaError || "Cargando…"}
      </p>
    );
  }

  return (
    <form
      className="mt-8 grid gap-5 rounded-[26px] border border-white/10 bg-white/[0.02] p-6 md:p-8"
      onSubmit={(e) => { e.preventDefault(); void enviar(); }}
    >
      <div>
        <label htmlFor="promos-tel" className={etiqueta}>Teléfono con WhatsApp</label>
        <input
          id="promos-tel" className={inp} value={telefono} maxLength={30} required
          inputMode="tel" autoComplete="tel" placeholder="351 512 3456"
          onChange={(e) => setTelefono(e.target.value)}
        />
        <p className="mt-1.5 text-xs text-zinc-500">Con el código de área, por ejemplo 351 512 3456.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="promos-nombre" className={etiqueta}>Nombre (opcional)</label>
          <input id="promos-nombre" className={inp} value={nombre} maxLength={LIMITES.nombre} autoComplete="given-name" onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label htmlFor="promos-localidad" className={etiqueta}>Localidad (opcional)</label>
          <input id="promos-localidad" className={inp} value={localidad} maxLength={LIMITES.localidad} autoComplete="address-level2" placeholder="Córdoba" onChange={(e) => setLocalidad(e.target.value)} />
        </div>
      </div>

      {/* Trampa para bots: una persona no la ve ni la alcanza con el teclado. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="promos-sitio">Sitio web</label>
        <input id="promos-sitio" tabIndex={-1} autoComplete="off" value={sitio} onChange={(e) => setSitio(e.target.value)} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
        <p className="text-sm font-black text-white">{texto.titulo}</p>
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-6 text-zinc-300">
          <input
            type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)}
            aria-labelledby="promos-texto-aceptacion"
            className="mt-1 h-4 w-4 shrink-0 accent-red-600"
          />
          <span id="promos-texto-aceptacion">{texto.texto}</span>
        </label>
        <p className="mt-3 text-xs text-zinc-500">
          Ver la{" "}
          <a href="/legales/privacidad" target="_blank" rel="noopener noreferrer" className="font-semibold text-red-400 underline underline-offset-2 hover:text-red-300">
            Política de Privacidad
          </a>
          .
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando || !telefono.trim() || !acepto}
        className="rounded-2xl border border-red-600/50 bg-red-600/10 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30"
      >
        {enviando ? "Anotando..." : "Quiero recibir promos"}
      </button>
    </form>
  );
}
