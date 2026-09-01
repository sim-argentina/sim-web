"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SafeMarkdown from "./SafeMarkdown";
import Conocimiento from "./Conocimiento";
import SaldoCreditos, { type Resumen as SaldoResumen } from "./SaldoCreditos";

type Adjunto = { id: string; nombre_original: string; estado_procesamiento: string; metodo_extraccion: string; advertencias?: string[] | null; promovido_documento_id?: string | null };

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
  const [saldo, setSaldo] = useState<SaldoResumen | null>(null);
  const [fuentesAbiertas, setFuentesAbiertas] = useState<Record<string, boolean>>({});
  const [vista, setVista] = useState<"chat" | "conocimiento">("chat");
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [adjuntando, setAdjuntando] = useState(false);
  const [ocrModal, setOcrModal] = useState<{ adj: Adjunto; detalle: { tipo_ocr: string; paginas_o_imagenes: number | null; tamano: number } } | null>(null);
  const [ocrConfirmado, setOcrConfirmado] = useState(false);
  const [ocrProcesando, setOcrProcesando] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const enfocar = () => setTimeout(() => textareaRef.current?.focus(), 0);

  const cargarConvs = useCallback(async () => {
    const r = await fetch("/api/admin/ia/conversaciones", { cache: "no-store" });
    if (r.ok) setConvs((await r.json()).conversaciones ?? []);
  }, []);
  const cargarSaldo = useCallback(async () => {
    const res = await fetch("/api/admin/ia/creditos", { cache: "no-store" }).catch(() => null);
    if (res && res.ok) setSaldo(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/admin/ia/config", { cache: "no-store" }).then((r) => r.json()).then(setConfig).catch(() => setConfig({ configurada: false, faltantes: ["ANTHROPIC_API_KEY"], proveedor: "anthropic", modelos: { economico: "", potente: "" } }));
    cargarConvs();
    cargarSaldo();
  }, [cargarConvs, cargarSaldo]);

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
    setActiva(c.id); setMensajes([]); setAdjuntos([]); setError(null); enfocar();
  }
  async function abrir(id: string) {
    setActiva(id); setError(null);
    const r = await fetch(`/api/admin/ia/conversaciones/${id}`, { cache: "no-store" });
    if (r.ok) setMensajes((await r.json()).mensajes ?? []);
    cargarAdjuntos(id);
    enfocar();
  }

  async function cargarAdjuntos(id: string) {
    const r = await fetch(`/api/admin/ia/conversaciones/${id}/adjuntos`, { cache: "no-store" });
    if (r.ok) setAdjuntos((await r.json()).adjuntos ?? []);
    else setAdjuntos([]);
  }

  async function subirAdjuntos(files: FileList) {
    let convId = activa;
    if (!convId) {
      const r = await fetch("/api/admin/ia/conversaciones", { method: "POST" });
      if (!r.ok) { setError("No se pudo crear la conversación."); return; }
      const c = (await r.json()).conversacion as Conv; setConvs((p) => [c, ...p]); convId = c.id; setActiva(c.id);
    }
    setAdjuntando(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("archivos", f);
      const r = await fetch(`/api/admin/ia/conversaciones/${convId}/adjuntos`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "No se pudo adjuntar."); return; }
      const fallidos = (j.resultados || []).filter((x: { ok: boolean }) => !x.ok);
      if (fallidos.length) setError(fallidos.map((x: { nombre: string; error: string }) => `${x.nombre}: ${x.error}`).join(" · "));
      await cargarAdjuntos(convId!);
    } finally { setAdjuntando(false); }
  }

  async function guardarComoConocimiento(adj: Adjunto) {
    const det = await (await fetch(`/api/admin/ia/adjuntos/${adj.id}`, { cache: "no-store" })).json();
    const titulo = window.prompt("Título del documento de conocimiento:", adj.nombre_original) ;
    if (!titulo) return;
    const contenido = window.prompt("Contenido a guardar (editá/confirmá):", det.contenido || "");
    if (contenido === null) return;
    const r = await fetch(`/api/admin/ia/adjuntos/${adj.id}/promover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo, contenido }) });
    const j = await r.json();
    if (!r.ok) { setError(j.error || "No se pudo guardar."); return; }
    if (activa) cargarAdjuntos(activa);
    alert("Guardado como conocimiento. Ya está disponible en todas las conversaciones.");
  }

  async function quitarAdjunto(id: string) {
    await fetch(`/api/admin/ia/adjuntos/${id}`, { method: "DELETE" });
    if (activa) cargarAdjuntos(activa);
  }

  // OCR/visión: abrir confirmación (NO consume la API todavía).
  async function abrirOCR(adj: Adjunto) {
    const det = await (await fetch(`/api/admin/ia/adjuntos/${adj.id}`, { cache: "no-store" })).json();
    setOcrModal({ adj, detalle: { tipo_ocr: det.tipo_ocr, paginas_o_imagenes: det.paginas_o_imagenes, tamano: det.tamano } });
    setOcrConfirmado(false); setOcrMsg(null);
  }
  async function analizarOCR(reprocesar = false) {
    if (!ocrModal || (!ocrConfirmado && !reprocesar)) return;
    setOcrProcesando(true); setOcrMsg(null);
    try {
      const r = await fetch(`/api/admin/ia/adjuntos/${ocrModal.adj.id}/ocr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmacion: true, reprocesar }) });
      const j = await r.json();
      if (!r.ok) { setOcrMsg(j.error || "No se pudo analizar."); return; }
      if (activa) cargarAdjuntos(activa);
      cargarSaldo(); // el OCR consume: refrescar el saldo/consumo sin recargar
      setOcrModal(null);
      alert(j.ocr?.reutilizado ? "Se reutilizó una extracción existente (sin nuevo consumo)." : `Extracción lista (confianza ${j.ocr?.confianza}). Revisala y, si querés, guardala como conocimiento.`);
    } finally { setOcrProcesando(false); }
  }
  async function cargarManual(adj: Adjunto) {
    const contenido = window.prompt("Pegá o escribí el contenido representativo del archivo:", "");
    if (contenido === null) return;
    await fetch(`/api/admin/ia/adjuntos/${adj.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido }) });
    if (activa) cargarAdjuntos(activa);
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
      cargarConvs(); cargarSaldo();
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

  const noConfig = !!(config && !config.configurada);
  const cardNoConfig = (
    <div className="p-6">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-red-500">IA SIM</p>
        <h1 className="mt-3 text-2xl font-black uppercase">IA SIM todavía no está configurada</h1>
        <p className="mt-4 text-white/70">Para activar el chat, configurá en el servidor: <span className="font-bold text-white">{config?.faltantes.join(", ") || "el proveedor de IA"}</span>.</p>
        <p className="mt-2 text-sm text-white/40">La clave se carga solo como variable de entorno; nunca se guarda en la base ni en el chat. La sección Conocimiento funciona igual.</p>
      </div>
    </div>
  );

  return (
    <main className="bg-black text-white">
      {/* Alto acotado al viewport MENOS el pt-20 (80px = 5rem) del layout del panel:
          así el composer del final queda SIEMPRE dentro de la pantalla. */}
      <div className="mx-auto flex h-[calc(100dvh-5rem)] max-w-7xl flex-col gap-0 md:flex-row">
        {/* Historial */}
        <aside className="max-h-[34vh] shrink-0 overflow-y-auto border-b border-white/10 p-4 md:max-h-none md:w-72 md:border-b-0 md:border-r">
          <div className="mb-3 flex rounded-xl border border-white/10 bg-black/40 p-1">
            <button onClick={() => setVista("chat")} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-black uppercase ${vista === "chat" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"}`}>Chat</button>
            <button onClick={() => setVista("conocimiento")} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-black uppercase ${vista === "conocimiento" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"}`}>Conocimiento</button>
          </div>
          <button onClick={nueva} className="mb-3 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black uppercase hover:bg-red-700">+ Nueva conversación</button>
          <SaldoCreditos data={saldo} recargar={cargarSaldo} />
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
          {vista === "conocimiento" ? (
            <div className="min-h-0 flex-1 overflow-y-auto"><Conocimiento /></div>
          ) : noConfig ? (
            <div className="min-h-0 flex-1 overflow-y-auto">{cardNoConfig}</div>
          ) : (
          <>
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
            {adjuntos.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {adjuntos.map((a) => (
                  <span key={a.id} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80">
                    📎 {a.nombre_original}
                    <span className={`text-[10px] uppercase ${a.estado_procesamiento === "listo" ? "text-green-400" : a.estado_procesamiento === "error" ? "text-red-400" : "text-amber-400"}`}>{a.estado_procesamiento === "sin_extractor" ? "sin extractor" : a.estado_procesamiento === "necesita_ocr" ? "necesita OCR" : a.estado_procesamiento === "necesita_revision" ? "revisar" : a.estado_procesamiento}</span>
                    {a.estado_procesamiento === "necesita_ocr" ? (
                      <>
                        <button onClick={() => abrirOCR(a)} className="text-red-400 hover:text-red-300">Analizar con IA</button>
                        <button onClick={() => cargarManual(a)} className="text-white/60 hover:text-white">Cargar texto</button>
                      </>
                    ) : a.promovido_documento_id ? <span className="text-[10px] text-white/40">· en conocimiento</span> : a.estado_procesamiento === "sin_extractor" ? (
                      <button onClick={() => cargarManual(a)} className="text-white/60 hover:text-white">Cargar texto</button>
                    ) : (
                      <button onClick={() => guardarComoConocimiento(a)} className="text-red-400 hover:text-red-300">guardar</button>
                    )}
                    <button onClick={() => quitarAdjunto(a.id)} className="text-white/40 hover:text-white">✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className={`cursor-pointer rounded-2xl border border-white/15 px-3 py-3 text-sm text-white/60 hover:text-white ${adjuntando ? "opacity-50" : ""}`} title="Adjuntar archivos">
                {adjuntando ? "…" : "📎"}
                <input type="file" multiple className="hidden" disabled={adjuntando} onChange={(e) => { if (e.target.files?.length) subirAdjuntos(e.target.files); e.target.value = ""; }} />
              </label>
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
          </>
          )}
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

      {ocrModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-amber-500/30 bg-zinc-950 p-6 text-white">
            <p className="text-sm uppercase tracking-[0.25em] text-amber-400">Analizar con IA</p>
            <h3 className="mt-2 text-xl font-black uppercase">{ocrModal.adj.nombre_original}</h3>
            <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Este archivo necesita OCR/visión para poder interpretarse. El análisis utilizará la API de Claude y consumirá créditos.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-white/70">
              <div>Tipo: <b className="text-white">{ocrModal.detalle.tipo_ocr === "imagen" ? "Imagen" : "PDF escaneado"}</b></div>
              <div>Tamaño: <b className="text-white">{Math.round(ocrModal.detalle.tamano / 1024)} KB</b></div>
              <div>{ocrModal.detalle.tipo_ocr === "imagen" ? "Imágenes" : "Páginas"}: <b className="text-white">{ocrModal.detalle.paginas_o_imagenes ?? "—"}</b></div>
              <div>Se analizará: <b className="text-white">texto visible + tablas</b></div>
            </div>
            <p className="mt-3 text-xs text-white/40">El costo exacto puede variar y no se muestra antes del análisis. Se respetan los límites diarios/mensuales de IA.</p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/15 bg-black p-4">
              <input type="checkbox" checked={ocrConfirmado} onChange={(e) => setOcrConfirmado(e.target.checked)} className="mt-1 h-5 w-5 accent-amber-500" />
              <span className="text-sm font-bold text-white/90">Confirmo que quiero utilizar IA para extraer e interpretar este archivo.</span>
            </label>
            {ocrMsg && <p className="mt-3 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm font-bold text-red-300">{ocrMsg}</p>}
            <div className="mt-5 flex gap-3">
              <button onClick={() => setOcrModal(null)} disabled={ocrProcesando} className="flex-1 rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase text-white/70 hover:text-white disabled:opacity-40">Cancelar</button>
              <button onClick={() => analizarOCR(false)} disabled={!ocrConfirmado || ocrProcesando} className="flex-1 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black uppercase text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
                {ocrProcesando ? "Analizando con IA…" : "Analizar con IA"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
