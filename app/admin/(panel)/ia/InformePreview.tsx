"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// IA SIM · Bloque 4C — Vista previa editable del informe dentro de la conversación.
// Edición persistente (PATCH), marca de valores modificados manualmente, elección de
// formatos, confirmación con doble confirmación para PII / cambios manuales, y descarga.

type Col = { clave: string; etiqueta: string; tipo: string };
type Tabla = { titulo: string; columnas: Col[]; filas: (string | number | boolean | null)[][]; nota?: string | null };
type Grafico = { tipo: string; titulo: string; categorias: string[]; series: { nombre: string; valores: number[] }[] };
type Cambio = { ubicacion: string; etiqueta: string; valor_original: unknown; valor_nuevo: unknown; motivo?: string | null };
type Spec = {
  titulo: string; subtitulo?: string | null; tipo_informe: string; periodo?: string | null; fecha_corte?: string | null;
  resumen_ejecutivo: string; conclusiones: string[]; hallazgos: string[]; secciones: { titulo: string; cuerpo: string }[];
  tablas: Tabla[]; graficos: Grafico[]; fuentes: { modulo: string; periodo?: string | null; registros?: number | null }[];
  metodologia?: string | null; modulos_consultados: string[]; registros_utilizados?: number | null; anexo: Tabla[];
  advertencias: string[]; datos_faltantes: string[]; cambios_manuales: Cambio[]; incluye_pii: boolean;
};
type Recon = { ok: boolean; contradicciones: { etiqueta: string; detalle: string }[]; respaldo: { total_cifras: number; respaldadas: number; sin_respaldo: number } };
type Archivo = { id: string; formato: string; nombre_descarga: string; tamano_bytes: number };
type Requisitos = { componentes: string[]; formatos: string[] };
type Integridad = { estado: "completo" | "incompleto" | "bloqueado"; faltantes: string[]; faltantes_labels: string[]; formatos_faltantes: string[]; contradicciones: string[]; presencia: Record<string, boolean> };
type Preview = { informe: { id: string; tipo_informe: string; periodo?: string | null; estado: string; version_actual: number }; version: { version: number; estado: string }; spec: Spec; reconciliacion: Recon; archivos: Archivo[]; requisitos: Requisitos | null; formatos_seleccionados: string[]; integridad: Integridad | null };

const FORMATOS = ["pdf", "docx", "xlsx", "csv", "png"] as const;
const FORMATO_LABEL: Record<string, string> = { pdf: "PDF", docx: "Word", xlsx: "Excel", csv: "CSV", png: "Imagen/PNG" };
const TIPO_LABEL: Record<string, string> = { analitico_mensual: "Informe analítico mensual", analitico: "Informe analítico", comparacion: "Comparación", foda: "Análisis FODA" };
const tipoLabel = (t: string) => TIPO_LABEL[t] ?? (t ? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Informe");
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export default function InformePreview({ informeId }: { informeId: string }) {
  const [p, setP] = useState<Preview | null>(null);
  const [spec, setSpec] = useState<Spec | null>(null);
  const original = useRef<Spec | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [formatos, setFormatos] = useState<string[]>(["pdf"]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/admin/ia/informes/${informeId}`, { cache: "no-store" }).catch(() => null);
    if (r && r.ok) { const j = (await r.json()) as Preview; setP(j); setSpec(structuredClone(j.spec)); original.current = structuredClone(j.spec); setFormatos(j.formatos_seleccionados?.length ? j.formatos_seleccionados : ["pdf"]); }
  }, [informeId]);
  // informeId es estable por instancia (el componente va key-ado por id) → el efecto
  // corre una vez y el setState ocurre tras el await (no es síncrono ni cascada).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar(); }, [cargar]);

  if (!p || !spec) return null;
  const generado = p.informe.estado === "generado" && p.archivos.length > 0;
  const rec = p.reconciliacion;
  const integ = p.integridad;
  const COMPLETABLES = ["tablas", "graficos", "fuentes", "metodologia", "anexo", "periodo", "conclusiones"];
  const puedeCompletar = Boolean(integ && integ.estado !== "completo" && integ.faltantes.some((f) => COMPLETABLES.includes(f)));
  const bloqueadoParaGenerar = Boolean(integ && integ.estado !== "completo");

  // Detecta y marca cambios manuales sobre valores numéricos del sistema.
  const marcarCambios = (s: Spec): Spec => {
    const orig = original.current!;
    const cambios: Cambio[] = [];
    s.tablas.forEach((t, ti) => t.filas.forEach((fila, fi) => t.columnas.forEach((c, ci) => {
      const ov = orig.tablas[ti]?.filas[fi]?.[ci];
      const nv = fila[ci];
      if (esNum(ov) && nv !== ov) cambios.push({ ubicacion: `tabla:${orig.tablas[ti].titulo}/fila ${fi + 1}/col ${c.etiqueta}`, etiqueta: `${t.titulo} · ${c.etiqueta}`, valor_original: ov, valor_nuevo: esNum(Number(nv)) ? Number(nv) : nv, motivo: null });
    })));
    return { ...s, cambios_manuales: cambios };
  };

  const guardar = async (s: Spec) => {
    const conMarcas = marcarCambios(s);
    setSpec(conMarcas);
    const r = await fetch(`/api/admin/ia/informes/${informeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: conMarcas }) });
    if (r.ok) { await cargar(); setMsg("Cambios guardados."); } else setMsg("No se pudo guardar.");
  };

  const confirmar = async (extra: { confirmar_pii?: boolean; confirmar_manuales?: boolean } = {}) => {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/admin/ia/informes/${informeId}/confirmar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatos, ...extra }) });
    const j = await r.json();
    setBusy(false);
    if (r.status === 428) {
      if (j.error?.includes("PII")) { if (confirm("El informe incluye datos personales (PII). ¿Generar de todas formas?")) return confirmar({ ...extra, confirmar_pii: true }); return; }
      if (confirm("Hay valores modificados manualmente. ¿Confirmás que querés generarlo así?")) return confirmar({ ...extra, confirmar_manuales: true });
      return;
    }
    if (r.status === 409 && j.detalle?.integridad) { setMsg(`Falta completar lo solicitado: ${(j.detalle.integridad.faltantes_labels || []).join(", ") || "requisitos"}. Usá “Completar desde los datos guardados”.`); return; }
    if (r.status === 409 && j.detalle?.contradicciones) { setMsg(`No reconcilia: ${j.detalle.contradicciones.map((c: { etiqueta: string }) => c.etiqueta).join(", ")}. Corregí el borrador.`); return; }
    if (!r.ok) { setMsg(j.error || "No se pudo generar."); return; }
    setMsg(`Generado: ${j.archivos.length} archivo(s).`); await cargar();
  };

  // Completar determinísticamente desde el snapshot (NO consume IA).
  const completar = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/admin/ia/informes/${informeId}/completar`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg(j.error || "No se pudo completar."); return; }
    setMsg(`Completado desde los datos guardados (${(j.agregados || []).length} componente(s)). No consumió IA.`); await cargar();
  };

  // Alternar un formato seleccionado y persistir la selección.
  const toggleFormato = async (f: string, on: boolean) => {
    const next = on ? [...new Set([...formatos, f])] : formatos.filter((x) => x !== f);
    setFormatos(next);
    await fetch(`/api/admin/ia/informes/${informeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatos: next }) }).catch(() => null);
  };

  const descargar = async (archivoId: string) => {
    const r = await fetch(`/api/admin/ia/informes/archivos/${archivoId}`, { cache: "no-store" });
    if (!r.ok) { setMsg("No se pudo descargar."); return; }
    const { url } = await r.json();
    window.open(url, "_blank");
  };

  const accion = async (accion: string) => {
    if (accion === "papelera" && !confirm("¿Enviar el informe a la papelera?")) return;
    await fetch(`/api/admin/ia/informes/${informeId}/acciones`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion }) });
    cargar();
  };

  return (
    <div className="my-3 rounded-xl border border-red-600/40 bg-red-950/10 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-red-500">Vista previa del informe</p>
          <p className="font-bold text-white">{spec.titulo}</p>
          <p className="text-xs text-white/50">{tipoLabel(spec.tipo_informe)}{spec.periodo ? ` · ${spec.periodo}` : ""} · {spec.tablas.length} tabla(s) · {spec.graficos.length} gráfico(s) · {spec.fuentes.length} fuente(s) · estado {p.informe.estado}{p.informe.version_actual > 1 ? ` (v${p.informe.version_actual})` : ""}</p>
        </div>
        <button onClick={() => setAbierto((v) => !v)} className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20">{abierto ? "Cerrar" : "Ver"}</button>
      </div>

      {/* Integridad: qué pidió el admin vs qué tiene el borrador */}
      {integ && integ.estado !== "completo" && (
        <div className="mt-2 rounded-lg bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200">
          {integ.faltantes_labels.length > 0 && <div>⚠ Faltan componentes solicitados: <span className="font-bold">{integ.faltantes_labels.join(", ")}</span>.</div>}
          {integ.formatos_faltantes.length > 0 && <div>⚠ Formatos pedidos no seleccionados: <span className="font-bold">{integ.formatos_faltantes.map((f) => FORMATO_LABEL[f] ?? f).join(", ")}</span>.</div>}
          {puedeCompletar && <div className="mt-1"><button onClick={completar} disabled={busy} className="rounded-lg bg-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/25 disabled:opacity-50">{busy ? "Completando…" : "Completar desde los datos guardados"}</button> <span className="text-white/40">(no consume IA)</span></div>}
        </div>
      )}
      {integ && integ.estado === "completo" && p.requisitos && <div className="mt-2 rounded-lg bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-300">✓ El borrador cumple lo solicitado.</div>}

      {/* Reconciliación */}
      {!rec.ok ? (
        <div className="mt-2 rounded-lg bg-red-950/60 px-2 py-1 text-[11px] text-red-300">⚠ El contenido no reconcilia con las fuentes: {rec.contradicciones.map((c) => c.etiqueta).join(", ")}. Corregí antes de generar.</div>
      ) : rec.respaldo.sin_respaldo > 0 ? (
        <div className="mt-2 rounded-lg bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">{rec.respaldo.respaldadas}/{rec.respaldo.total_cifras} cifras con respaldo directo en fuentes; {rec.respaldo.sin_respaldo} son agregados o ediciones a revisar.</div>
      ) : null}
      {spec.cambios_manuales.length > 0 && <div className="mt-1 rounded-lg bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">✎ {spec.cambios_manuales.length} valor(es) modificado(s) manualmente (no provienen del sistema).</div>}
      {spec.incluye_pii && <div className="mt-1 rounded-lg bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">Incluye datos personales (PII).</div>}

      {abierto && (
        <div className="mt-3 space-y-3">
          {!editando ? (
            <>
              <Resumen spec={spec} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setEditando(true)} className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20">Editar</button>
              </div>
            </>
          ) : (
            <Editor spec={spec} onChange={setSpec} onGuardar={() => guardar(spec)} onCerrar={() => { setEditando(false); cargar(); }} />
          )}

          {/* Archivos generados */}
          {generado && (
            <div className="rounded-lg border border-white/10 p-2">
              <p className="mb-1 text-[11px] font-black uppercase text-white/40">Archivos (v{p.informe.version_actual})</p>
              <div className="flex flex-wrap gap-2">
                {p.archivos.map((a) => (
                  <button key={a.id} onClick={() => descargar(a.id)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">⬇ {a.formato.toUpperCase()} · {a.nombre_descarga} · {kb(a.tamano_bytes)}</button>
                ))}
              </div>
            </div>
          )}

          {/* Formatos + confirmar */}
          <div className="rounded-lg border border-white/10 p-2">
            <p className="mb-1 text-[11px] font-black uppercase text-white/40">Formatos a generar</p>
            <div className="mb-2 flex flex-wrap gap-3">
              {FORMATOS.map((f) => {
                const pedido = p.requisitos?.formatos?.includes(f);
                return (
                  <label key={f} className="flex items-center gap-1 text-xs text-white/70">
                    <input type="checkbox" checked={formatos.includes(f)} onChange={(e) => toggleFormato(f, e.target.checked)} aria-label={FORMATO_LABEL[f]} /> {FORMATO_LABEL[f]}{pedido ? <span className="text-red-400" title="Solicitado en el pedido"> ★</span> : null}
                  </label>
                );
              })}
            </div>
            {bloqueadoParaGenerar && <p className="mb-1 text-[11px] text-amber-300">No se puede generar hasta completar lo solicitado{integ && integ.estado === "bloqueado" ? " (hay contradicciones de datos)" : ""}.</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => confirmar()} disabled={busy || !rec.ok || formatos.length === 0 || bloqueadoParaGenerar} title={bloqueadoParaGenerar ? "Faltan requisitos solicitados o hay contradicciones" : undefined} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black uppercase hover:bg-red-700 disabled:opacity-40">{busy ? "Generando…" : generado ? "Regenerar / nueva versión" : "Confirmar y generar"}</button>
              <button onClick={() => accion("papelera")} className="rounded-lg px-2 py-1 text-xs text-white/50 hover:text-red-400">Papelera</button>
            </div>
          </div>
          {msg && <p className="text-[11px] text-white/70">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function Resumen({ spec }: { spec: Spec }) {
  return (
    <div className="space-y-2 text-xs text-white/70">
      <p><span className="text-white/40">Resumen:</span> {spec.resumen_ejecutivo}</p>
      {spec.conclusiones.length > 0 && <div><span className="text-white/40">Conclusiones:</span><ul className="ml-4 list-disc">{spec.conclusiones.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      {spec.tablas.map((t, i) => (
        <div key={i} className="overflow-x-auto"><p className="text-white/40">{t.titulo}</p>
          <table className="min-w-full text-[11px]"><thead><tr>{t.columnas.map((c, ci) => <th key={ci} className="border-b border-white/10 px-1 py-0.5 text-left text-white/50">{c.etiqueta}</th>)}</tr></thead>
            <tbody>{t.filas.slice(0, 12).map((fila, fi) => <tr key={fi}>{t.columnas.map((_, ci) => <td key={ci} className="px-1 py-0.5">{String(fila[ci] ?? "—")}</td>)}</tr>)}</tbody></table>
        </div>
      ))}
      <p className="text-white/40">Módulos: {spec.modulos_consultados.join(", ") || "—"} · Fuentes: {spec.fuentes.length}</p>
    </div>
  );
}

function Editor({ spec, onChange, onGuardar, onCerrar }: { spec: Spec; onChange: (s: Spec) => void; onGuardar: () => void; onCerrar: () => void }) {
  const set = (patch: Partial<Spec>) => onChange({ ...spec, ...patch });
  const inp = "w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white text-xs";
  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2 text-xs">
      <label className="block text-white/50">Título<input value={spec.titulo} onChange={(e) => set({ titulo: e.target.value })} className={inp} /></label>
      <label className="block text-white/50">Subtítulo<input value={spec.subtitulo ?? ""} onChange={(e) => set({ subtitulo: e.target.value })} className={inp} /></label>
      <label className="block text-white/50">Resumen ejecutivo<textarea value={spec.resumen_ejecutivo} onChange={(e) => set({ resumen_ejecutivo: e.target.value })} rows={3} className={inp} /></label>
      <label className="block text-white/50">Conclusiones (una por línea)<textarea value={spec.conclusiones.join("\n")} onChange={(e) => set({ conclusiones: e.target.value.split("\n").filter(Boolean) })} rows={2} className={inp} /></label>

      {/* Secciones: reordenar / excluir / editar */}
      {spec.secciones.length > 0 && <p className="text-white/40">Secciones</p>}
      {spec.secciones.map((s, i) => (
        <div key={i} className="rounded border border-white/10 p-1">
          <div className="flex items-center gap-1">
            <input value={s.titulo} onChange={(e) => { const sec = [...spec.secciones]; sec[i] = { ...s, titulo: e.target.value }; set({ secciones: sec }); }} className={inp} />
            <button onClick={() => { const sec = [...spec.secciones]; if (i > 0) { [sec[i - 1], sec[i]] = [sec[i], sec[i - 1]]; set({ secciones: sec }); } }} className="px-1 text-white/40">↑</button>
            <button onClick={() => { const sec = [...spec.secciones]; if (i < sec.length - 1) { [sec[i + 1], sec[i]] = [sec[i], sec[i + 1]]; set({ secciones: sec }); } }} className="px-1 text-white/40">↓</button>
            <button onClick={() => set({ secciones: spec.secciones.filter((_, j) => j !== i) })} className="px-1 text-white/40 hover:text-red-400">✕</button>
          </div>
          <textarea value={s.cuerpo} onChange={(e) => { const sec = [...spec.secciones]; sec[i] = { ...s, cuerpo: e.target.value }; set({ secciones: sec }); }} rows={2} className={inp} />
        </div>
      ))}

      {/* Tablas: editar celdas (numéricas se marcan como cambio manual al guardar) */}
      {spec.tablas.map((t, ti) => (
        <div key={ti} className="rounded border border-white/10 p-1">
          <p className="text-white/40">{t.titulo}</p>
          <div className="overflow-x-auto">
            <table className="text-[11px]"><tbody>
              {t.filas.map((fila, fi) => (
                <tr key={fi}>{t.columnas.map((_, ci) => (
                  <td key={ci} className="p-0.5"><input value={String(fila[ci] ?? "")} onChange={(e) => {
                    const tablas = structuredClone(spec.tablas); const raw = e.target.value; const num = Number(raw);
                    tablas[ti].filas[fi][ci] = raw !== "" && !Number.isNaN(num) && /^-?\d*\.?\d+$/.test(raw) ? num : raw;
                    set({ tablas });
                  }} className="w-24 rounded border border-white/10 bg-black/40 px-1 text-white" /></td>
                ))}</tr>
              ))}
            </tbody></table>
          </div>
        </div>
      ))}

      {/* Gráficos: incluir + tipo */}
      {spec.graficos.map((g, gi) => (
        <div key={gi} className="flex items-center gap-2 rounded border border-white/10 p-1">
          <span className="flex-1 text-white/60">{g.titulo}</span>
          <select value={g.tipo} onChange={(e) => { const gr = [...spec.graficos]; gr[gi] = { ...g, tipo: e.target.value }; set({ graficos: gr }); }} className="rounded border border-white/10 bg-black/40 px-1 text-white">
            <option value="barras">Barras</option><option value="lineas">Líneas</option><option value="circular">Circular</option>
          </select>
          <button onClick={() => set({ graficos: spec.graficos.filter((_, j) => j !== gi) })} className="text-white/40 hover:text-red-400">✕</button>
        </div>
      ))}

      <label className="flex items-center gap-2 text-white/50"><input type="checkbox" checked={spec.incluye_pii} onChange={(e) => set({ incluye_pii: e.target.checked })} /> Incluir datos personales (PII) — requiere confirmación al generar</label>

      <div className="flex justify-end gap-2">
        <button onClick={onCerrar} className="rounded-lg px-3 py-1 text-white/60 hover:text-white">Cerrar</button>
        <button onClick={onGuardar} className="rounded-lg bg-red-600 px-3 py-1 font-black uppercase hover:bg-red-700">Guardar cambios</button>
      </div>
    </div>
  );
}
