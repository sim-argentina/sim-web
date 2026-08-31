"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SafeMarkdown from "./SafeMarkdown";

// IA SIM · Bloque 4A — Interfaz del chat (admin-only). Estética SIM (negro/rojo/blanco).

type Fuente = { modulo: string; periodo?: string; registros?: number; estadoMes?: string; exclusiones?: number; actualizado?: string };
type Herr = { nombre: string; ok: boolean; error?: string };
type Mensaje = { id: string; rol: "user" | "assistant"; contenido: string; modelo?: string; clase_modelo?: string; escalado?: boolean; fuentes?: Fuente[]; herramientas?: Herr[]; estado?: string };
type Conv = { id: string; titulo: string | null; updated_at?: string };
type Config = { configurada: boolean; faltantes: string[]; proveedor: string; modelos: { economico: string; potente: string } };

const SUGERIDAS = [
  "¿Cuál fue la ganancia de SIM este mes?",
  "Compará la actividad de Francisco y Federico.",
  "¿Cuántos turnos hizo Ramiro en agosto?",
  "¿Qué anomalías detectás este mes?",
  "Hacé un FODA de SIM con los datos disponibles.",
];
const PASOS = ["Analizando la pregunta…", "Consultando los módulos…", "Preparando respuesta…"];

export default function IAChat() {
  const [config, setConfig] = useState<Config | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [papelera, setPapelera] = useState<Conv[]>([]);
  const [verPapelera, setVerPapelera] = useState(false);
  const [activa, setActiva] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [paso, setPaso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [consumo, setConsumo] = useState<{ mes: { tokens_total: number; costo_estimado_usd: number }; porcentaje: { tokens_mes: number } } | null>(null);
  const [fuentesAbiertas, setFuentesAbiertas] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const enfocar = () => setTimeout(() => textareaRef.current?.focus(), 0);

  const cargarConvs = useCallback(async () => {
    const r = await fetch("/api/admin/ia/conversaciones", { cache: "no-store" });
    if (r.ok) setConvs((await r.json()).conversaciones ?? []);
  }, []);
  const cargarConsumo = useCallback(async () => {
    const r = await fetch("/api/admin/ia/consumo", { cache: "no-store" });
    if (r.ok) setConsumo(await r.json());
  }, []);

  useEffect(() => {
    fetch("/api/admin/ia/config", { cache: "no-store" }).then((r) => r.json()).then(setConfig).catch(() => setConfig({ configurada: false, faltantes: ["ANTHROPIC_API_KEY"], proveedor: "anthropic", modelos: { economico: "", potente: "" } }));
    cargarConvs();
    cargarConsumo();
  }, [cargarConvs, cargarConsumo]);

  useEffect(() => {
    if (!enviando) return;
    setPaso(0);
    const t = setInterval(() => setPaso((p) => (p + 1) % PASOS.length), 1500);
    return () => clearInterval(t);
  }, [enviando]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [mensajes, enviando]);

  async function nueva() {
    const r = await fetch("/api/admin/ia/conversaciones", { method: "POST" });
    if (!r.ok) return;
    const c = (await r.json()).conversacion as Conv;
    setConvs((prev) => [c, ...prev]);
    setActiva(c.id); setMensajes([]); setError(null); enfocar();
  }
  async function abrir(id: string) {
    setActiva(id); setError(null);
    const r = await fetch(`/api/admin/ia/conversaciones/${id}`, { cache: "no-store" });
    if (r.ok) setMensajes((await r.json()).mensajes ?? []);
    enfocar();
  }
  async function eliminar(id: string) {
    await fetch(`/api/admin/ia/conversaciones/${id}`, { method: "DELETE" });
    setConvs((p) => p.filter((c) => c.id !== id));
    if (activa === id) { setActiva(null); setMensajes([]); }
  }
  async function renombrar(id: string) {
    const titulo = prompt("Nuevo título:");
    if (!titulo) return;
    await fetch(`/api/admin/ia/conversaciones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo }) });
    cargarConvs();
  }
  async function cargarPapelera() {
    const r = await fetch("/api/admin/ia/papelera", { cache: "no-store" });
    if (r.ok) setPapelera((await r.json()).conversaciones ?? []);
    setVerPapelera(true);
  }
  async function restaurar(id: string) {
    await fetch(`/api/admin/ia/conversaciones/${id}/restaurar`, { method: "POST" });
    setPapelera((p) => p.filter((c) => c.id !== id));
    cargarConvs();
  }

  async function enviar(texto?: string) {
    const pregunta = (texto ?? input).trim();
    if (!pregunta || enviando) return;
    setError(null);
    let convId = activa;
    if (!convId) {
      const r = await fetch("/api/admin/ia/conversaciones", { method: "POST" });
      if (!r.ok) { setError("No se pudo crear la conversación."); return; }
      const c = (await r.json()).conversacion as Conv;
      setConvs((prev) => [c, ...prev]); convId = c.id; setActiva(c.id);
    }
    const idem = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? String(Date.now());
    const userMsg: Mensaje = { id: `tmp-${idem}`, rol: "user", contenido: pregunta };
    setMensajes((m) => [...m, userMsg]);
    setInput(""); setEnviando(true);
    try {
      const r = await fetch(`/api/admin/ia/conversaciones/${convId}/mensajes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pregunta, idempotency_key: idem }) });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error || "No se pudo responder.");
        setInput(pregunta); // conservar el texto si falló
        setMensajes((m) => m.filter((x) => x.id !== userMsg.id));
        return;
      }
      setMensajes((m) => [...m, { id: j.mensajeId, rol: "assistant", contenido: j.texto, modelo: j.modelo, clase_modelo: j.claseModelo, escalado: j.escalado, fuentes: j.fuentes, herramientas: j.herramientas, estado: j.estado }]);
      cargarConvs(); cargarConsumo();
    } catch {
      setError("Error de red."); setInput(pregunta);
      setMensajes((m) => m.filter((x) => x.id !== userMsg.id));
    } finally {
      setEnviando(false);
    }
  }

  async function feedback(mensajeId: string, tipo: "util" | "no_util" | "error") {
    let comentario: string | null = null;
    if (tipo === "error") { comentario = prompt("Contanos qué salió mal (opcional):") || ""; }
    await fetch("/api/admin/ia/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mensaje_id: mensajeId, tipo, comentario }) });
    alert(tipo === "util" ? "¡Gracias!" : "Registrado. Gracias por el feedback.");
  }

  if (config && !config.configurada) {
    return (
      <main className="min-h-screen bg-black px-6 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-red-500">IA SIM</p>
          <h1 className="mt-3 text-2xl font-black uppercase">IA SIM todavía no está configurada</h1>
          <p className="mt-4 text-white/70">Para activarla, configurá en el servidor: <span className="font-bold text-white">{config.faltantes.join(", ") || "el proveedor de IA"}</span>.</p>
          <p className="mt-2 text-sm text-white/40">La clave se carga solo como variable de entorno; nunca se guarda en la base ni en el chat.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-black text-white">
      {/* Alto acotado al viewport MENOS el pt-20 (80px = 5rem) del layout del panel:
          así el composer del final queda SIEMPRE dentro de la pantalla. */}
      <div className="mx-auto flex h-[calc(100dvh-5rem)] max-w-7xl flex-col gap-0 md:flex-row">
        {/* Historial */}
        <aside className="max-h-[34vh] shrink-0 overflow-y-auto border-b border-white/10 p-4 md:max-h-none md:w-72 md:border-b-0 md:border-r">
          <button onClick={nueva} className="mb-3 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black uppercase hover:bg-red-700">+ Nueva conversación</button>
          {consumo && (
            <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
              Mes: {consumo.mes.tokens_total.toLocaleString("es-AR")} tokens · ~US${consumo.mes.costo_estimado_usd} · {consumo.porcentaje.tokens_mes}% del tope
            </div>
          )}
          <div className="space-y-1">
            {convs.map((c) => (
              <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-3 py-2 text-sm ${activa === c.id ? "bg-white/10" : "hover:bg-white/5"}`}>
                <button onClick={() => abrir(c.id)} className="flex-1 truncate text-left text-white/80">{c.titulo || "Nueva conversación"}</button>
                <button onClick={() => renombrar(c.id)} title="Renombrar" className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white">✎</button>
                <button onClick={() => eliminar(c.id)} title="Eliminar" className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400">🗑</button>
              </div>
            ))}
            {convs.length === 0 && <p className="px-3 py-2 text-xs text-white/40">Sin conversaciones todavía.</p>}
          </div>
          <button onClick={cargarPapelera} className="mt-4 text-xs text-white/40 hover:text-white">Ver papelera</button>
        </aside>

        {/* Chat */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="mb-2">
              <p className="text-sm uppercase tracking-[0.3em] text-red-500">IA SIM</p>
              <h1 className="text-2xl font-black uppercase">Asistente analítico</h1>
              <p className="mt-1 text-sm text-white/50">Consulta datos reales de SIM (Finanzas, Cronograma, Equipo, Stand, Reservas). No modifica nada.</p>
            </div>

            {mensajes.length === 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGERIDAS.map((q) => (
                  <button key={q} onClick={() => enviar(q)} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-white/80 hover:border-red-500 hover:text-white">{q}</button>
                ))}
              </div>
            )}

            {mensajes.map((m) => (
              <div key={m.id} className={m.rol === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.rol === "user" ? "bg-red-600 text-white" : "border border-white/10 bg-white/[0.04] text-white/90"}`}>
                  {m.rol === "assistant"
                    ? <SafeMarkdown text={m.contenido} />
                    : <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.contenido}</p>}
                  {m.rol === "assistant" && (
                    <div className="mt-3 border-t border-white/10 pt-2 text-xs text-white/50">
                      {m.fuentes && m.fuentes.length > 0 && (
                        <div>
                          <button onClick={() => setFuentesAbiertas((s) => ({ ...s, [m.id]: !s[m.id] }))} className="font-bold text-white/70 hover:text-white">
                            Fuentes: {m.fuentes.map((f) => f.modulo).filter((v, i, a) => a.indexOf(v) === i).join(" · ")} {fuentesAbiertas[m.id] ? "▾" : "▸"}
                          </button>
                          {fuentesAbiertas[m.id] && (
                            <ul className="mt-2 space-y-1">
                              {m.fuentes.map((f, k) => (
                                <li key={k} className="text-white/50">• {f.modulo}{f.periodo ? ` · ${f.periodo}` : ""}{f.registros != null ? ` · ${f.registros} registros` : ""}{f.estadoMes ? ` · mes ${f.estadoMes}` : ""}{f.exclusiones ? ` · ${f.exclusiones} exclusiones` : ""}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase text-white/40">{m.clase_modelo === "potente" ? "Modelo potente" : "Modelo económico"}{m.escalado ? " · escalado" : ""}</span>
                        {!m.id.startsWith("tmp-") && (
                          <>
                            <button onClick={() => feedback(m.id, "util")} className="hover:text-green-400">👍 Útil</button>
                            <button onClick={() => feedback(m.id, "no_util")} className="hover:text-amber-400">👎 No útil</button>
                            <button onClick={() => feedback(m.id, "error")} className="hover:text-red-400">⚠ Reportar</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {enviando && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/60">
                  <span className="inline-block animate-pulse">{PASOS[paso]}</span>
                </div>
              </div>
            )}
          </div>

          {error && <div className="mx-5 mb-2 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm font-bold text-red-300">{error}</div>}

          {/* Composer: SIEMPRE visible cuando hay una conversación activa, incluso vacía. */}
          <div className="shrink-0 border-t border-white/10 p-4">
            <div className="flex items-end gap-2">
              <label htmlFor="ia-composer" className="sr-only">Escribí tu pregunta para IA SIM</label>
              <textarea
                id="ia-composer"
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Preguntale algo a IA SIM…"
                aria-label="Escribí tu pregunta para IA SIM"
                rows={2}
                disabled={enviando}
                className="flex-1 resize-none rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-red-500 disabled:opacity-50"
              />
              <button onClick={() => enviar()} disabled={enviando || !input.trim()} aria-label="Enviar" className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-black uppercase hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
                {enviando ? "…" : "Enviar"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {verPapelera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={() => setVerPapelera(false)}>
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-black uppercase text-white">Papelera</h3>
            <p className="mb-3 text-xs text-white/40">Las conversaciones se eliminan definitivamente a los 30 días.</p>
            <div className="space-y-2">
              {papelera.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2 text-sm">
                  <span className="truncate text-white/70">{c.titulo || "Nueva conversación"}</span>
                  <button onClick={() => restaurar(c.id)} className="text-red-400 hover:text-red-300">Restaurar</button>
                </div>
              ))}
              {papelera.length === 0 && <p className="text-sm text-white/40">Papelera vacía.</p>}
            </div>
            <button onClick={() => setVerPapelera(false)} className="mt-5 w-full rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-black uppercase hover:bg-red-700">Cerrar</button>
          </div>
        </div>
      )}
    </main>
  );
}
