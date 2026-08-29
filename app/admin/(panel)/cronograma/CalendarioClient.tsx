"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cubreHorarioOperativo } from "@/lib/cronograma";
import ImportadorPdf from "./ImportadorPdf";

type Jornada = {
  empleado_id: string;
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  empleado_activo: boolean;
};
type Dia = { fecha: string; cerrado: boolean; apertura: string; cierre: string; jornadas: Jornada[] };
type EstadoMes = "inexistente" | "borrador" | "confirmado";
type Mes = {
  estado: EstadoMes;
  anio: number;
  mes: number;
  apertura_default: string;
  cierre_default: string;
  confirmado_at: string | null;
  fallback: { id: string; nombre: string } | null;
  dias: Dia[];
};
type Empleado = { id: string; nombre_formal: string };
type JornadaEdit = { empleado_id: string; hora_inicio: string; hora_fin: string };
type HistEvento = { id: string; fecha: string | null; tipo: string; actor: string; antes: unknown; despues: unknown; created_at: string };

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const hoyAR = () => {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const [y, m] = s.split("-").map(Number);
  return { anio: y, mes: m };
};
const pad = (n: number) => String(n).padStart(2, "0");
const fechaStr = (anio: number, mes: number, dia: number) => `${anio}-${pad(mes)}-${pad(dia)}`;
const diasEnMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
// Lunes = 0 … Domingo = 6.
const primerDiaSemana = (anio: number, mes: number) => (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;

const ESTADO_CHIP: Record<EstadoMes, string> = {
  inexistente: "bg-zinc-800 text-zinc-400",
  borrador: "bg-amber-500/20 text-amber-300",
  confirmado: "bg-green-600 text-white",
};
const ESTADO_LABEL: Record<EstadoMes, string> = {
  inexistente: "Sin cronograma",
  borrador: "Borrador",
  confirmado: "Confirmado",
};

export default function CalendarioClient({ role }: { role: string }) {
  const esAdmin = role === "admin";
  const inicial = hoyAR();

  const [anio, setAnio] = useState(inicial.anio);
  const [mes, setMes] = useState(inicial.mes);
  const [data, setData] = useState<Mes | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);

  // Editor de día (solo admin).
  const [editFecha, setEditFecha] = useState<string | null>(null);
  const [edCerrado, setEdCerrado] = useState(false);
  const [edApertura, setEdApertura] = useState("10:00");
  const [edCierre, setEdCierre] = useState("22:00");
  const [edJornadas, setEdJornadas] = useState<JornadaEdit[]>([]);
  const [guardando, setGuardando] = useState(false);

  // Historial de día (solo admin).
  const [histFecha, setHistFecha] = useState<string | null>(null);
  const [histEventos, setHistEventos] = useState<HistEvento[]>([]);

  // Importación PDF/Canva (solo admin).
  const [importar, setImportar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/cronograma?anio=${anio}&mes=${mes}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) {
        alert(j.error || "Error cargando el cronograma");
        return;
      }
      setData(j.mes as Mes);
    } catch {
      alert("Error cargando el cronograma");
    } finally {
      setLoading(false);
    }
  }, [anio, mes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!esAdmin) return;
    fetch("/api/admin/empleados", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEmpleados((j.empleados || []).map((e: { id: string; nombre_formal: string }) => ({ id: e.id, nombre_formal: e.nombre_formal }))))
      .catch(() => {});
  }, [esAdmin]);

  const diaDe = useCallback(
    (fecha: string): Dia | null => data?.dias.find((d) => d.fecha === fecha) ?? null,
    [data],
  );

  // Estado efectivo de un día (día real o valores por defecto para días sin fila).
  const estadoDia = useCallback(
    (fecha: string) => {
      const d = diaDe(fecha);
      if (d) return d;
      return {
        fecha,
        cerrado: false,
        apertura: data?.apertura_default ?? "10:00",
        cierre: data?.cierre_default ?? "22:00",
        jornadas: [] as Jornada[],
      };
    },
    [diaDe, data],
  );

  const mostrarFallback = data?.estado === "confirmado" || (data?.estado === "borrador" && preview);

  function navegar(delta: number) {
    let m = mes + delta;
    let a = anio;
    if (m < 1) { m = 12; a -= 1; }
    if (m > 12) { m = 1; a += 1; }
    setAnio(a);
    setMes(m);
  }

  async function crearBorrador() {
    const res = await fetch("/api/admin/cronograma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anio, mes }),
    });
    const j = await res.json();
    if (!res.ok) { alert(j.error || "No se pudo crear el borrador"); return; }
    setData(j.mes as Mes);
  }

  // Resumen para la confirmación: días cerrados, sin jornadas y con huecos.
  const resumen = useMemo(() => {
    if (!data) return { cerrados: 0, sinJornadas: 0, conHuecos: 0 };
    const total = diasEnMes(anio, mes);
    let cerrados = 0, sinJornadas = 0, conHuecos = 0;
    for (let d = 1; d <= total; d++) {
      const e = estadoDia(fechaStr(anio, mes, d));
      if (e.cerrado) { cerrados++; continue; }
      if (e.jornadas.length === 0) { sinJornadas++; continue; }
      if (!cubreHorarioOperativo(e.apertura, e.cierre, e.jornadas)) conHuecos++;
    }
    return { cerrados, sinJornadas, conHuecos };
  }, [data, anio, mes, estadoDia]);

  async function confirmarMes() {
    const msg =
      `Vas a CONFIRMAR el cronograma de ${MESES[mes - 1]} ${anio}. Se vuelve oficial.\n\n` +
      `• Días cerrados: ${resumen.cerrados}\n` +
      `• Días abiertos SIN jornadas (los cubre Ramiro completo): ${resumen.sinJornadas}\n` +
      `• Días abiertos con huecos (Ramiro cubre los tramos sin nadie): ${resumen.conHuecos}\n\n` +
      `Los días no marcados como cerrados quedan abiertos. ¿Confirmar?`;
    if (!confirm(msg)) return;
    const res = await fetch("/api/admin/cronograma/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anio, mes }),
    });
    const j = await res.json();
    if (!res.ok) { alert(j.error || "No se pudo confirmar"); return; }
    setData(j.mes as Mes);
  }

  function abrirEditor(fecha: string) {
    if (!esAdmin) return;
    const e = estadoDia(fecha);
    setEditFecha(fecha);
    setEdCerrado(e.cerrado);
    setEdApertura(e.apertura);
    setEdCierre(e.cierre);
    setEdJornadas(e.jornadas.map((j) => ({ empleado_id: j.empleado_id, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })));
  }

  function cerrarEditor() {
    setEditFecha(null);
    setEdJornadas([]);
  }

  function addJornada() {
    setEdJornadas((prev) => [...prev, { empleado_id: empleados[0]?.id ?? "", hora_inicio: edApertura, hora_fin: edCierre }]);
  }
  function setJornada(i: number, patch: Partial<JornadaEdit>) {
    setEdJornadas((prev) => prev.map((j, idx) => (idx === i ? { ...j, ...patch } : j)));
  }
  function removeJornada(i: number) {
    setEdJornadas((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function guardarDia() {
    if (!editFecha) return;
    if (data?.estado === "confirmado") {
      if (!confirm(`Este mes ya está CONFIRMADO. La corrección se aplica de inmediato sin despublicar el resto del mes y queda registrada en el historial.\n\n¿Aplicar la corrección al ${editFecha}?`)) return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/admin/cronograma/dia", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anio,
          mes,
          fecha: editFecha,
          cerrado: edCerrado,
          apertura: edApertura,
          cierre: edCierre,
          jornadas: edCerrado ? [] : edJornadas,
        }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error || "No se pudo guardar el día"); return; }
      setData(j.mes as Mes);
      cerrarEditor();
    } catch {
      alert("No se pudo guardar el día");
    } finally {
      setGuardando(false);
    }
  }

  async function verHistorial(fecha: string) {
    setHistFecha(fecha);
    setHistEventos([]);
    const res = await fetch(`/api/admin/cronograma/historial?anio=${anio}&mes=${mes}&fecha=${fecha}`, { cache: "no-store" });
    const j = await res.json();
    if (res.ok) setHistEventos(j.eventos || []);
  }

  // Grilla del mes (lunes a domingo).
  const celdas = useMemo(() => {
    const total = diasEnMes(anio, mes);
    const offset = primerDiaSemana(anio, mes);
    const arr: Array<number | null> = [];
    for (let i = 0; i < offset; i++) arr.push(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [anio, mes]);

  const empleadosEditor = useMemo(() => {
    // Incluye integrantes activos + los archivados que ya figuren en el día editado.
    const base = new Map(empleados.map((e) => [e.id, e.nombre_formal]));
    for (const j of edJornadas) {
      if (!base.has(j.empleado_id)) {
        const nombre = data?.dias.find((d) => d.fecha === editFecha)?.jornadas.find((x) => x.empleado_id === j.empleado_id)?.nombre;
        base.set(j.empleado_id, (nombre ?? "Integrante") + " (archivado)");
      }
    }
    return [...base.entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [empleados, edJornadas, data, editFecha]);

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white md:px-6">
      <section className="mx-auto max-w-6xl">
        {/* Cabecera: navegación + estado */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => navegar(-1)} className="rounded-xl border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10" aria-label="Mes anterior">‹</button>
            <h1 className="min-w-[220px] text-center text-2xl font-black uppercase md:text-3xl">{MESES[mes - 1]} {anio}</h1>
            <button onClick={() => navegar(1)} className="rounded-xl border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10" aria-label="Mes siguiente">›</button>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className={`rounded-xl px-3 py-2 text-xs font-black uppercase ${ESTADO_CHIP[data.estado]}`}>
                {ESTADO_LABEL[data.estado]}
              </span>
            )}
          </div>
        </div>

        {/* Barra de acciones admin */}
        {esAdmin && data && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button onClick={() => setImportar(true)} className="rounded-xl border border-white/20 px-4 py-2 text-sm font-black uppercase text-white/80 hover:bg-white/10">
              Importar PDF/Canva
            </button>
            {data.estado === "inexistente" && (
              <button onClick={crearBorrador} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase hover:bg-red-700">
                Crear borrador
              </button>
            )}
            {data.estado === "borrador" && (
              <>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold">
                  <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="h-4 w-4 accent-red-600" />
                  Previsualizar cobertura de Ramiro (no oficial)
                </label>
                <button onClick={confirmarMes} className="rounded-xl bg-green-600 px-4 py-2 text-sm font-black uppercase hover:bg-green-700">
                  Confirmar mes
                </button>
              </>
            )}
            {data.estado === "confirmado" && (
              <span className="text-xs text-white/50">
                Confirmado. Podés corregir días puntuales; cada corrección queda en el historial.
              </span>
            )}
          </div>
        )}

        {data?.estado === "borrador" && preview && (
          <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Previsualización: la cobertura de Ramiro es tentativa. El mes todavía es un borrador y NO es información oficial.
          </p>
        )}

        {/* Contenido */}
        {loading ? (
          <p className="text-white/60">Cargando…</p>
        ) : !data ? (
          <p className="text-white/60">Sin datos.</p>
        ) : data.estado === "inexistente" ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-white/60">
              {esAdmin
                ? "Todavía no hay cronograma para este mes. Creá un borrador para empezar a cargarlo."
                : "No hay cronograma publicado para este mes."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 md:gap-2">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="pb-1 text-center text-[10px] font-black uppercase tracking-wider text-white/40">{d}</div>
              ))}
              {celdas.map((d, i) => {
                if (d === null) return <div key={`x${i}`} className="min-h-[84px] rounded-xl border border-transparent" />;
                const fecha = fechaStr(anio, mes, d);
                const e = estadoDia(fecha);
                const cubierto = e.jornadas.length > 0 && cubreHorarioOperativo(e.apertura, e.cierre, e.jornadas);
                return (
                  <button
                    key={fecha}
                    type="button"
                    onClick={() => (esAdmin ? abrirEditor(fecha) : undefined)}
                    className={`min-h-[84px] rounded-xl border p-1.5 text-left align-top transition ${
                      e.cerrado
                        ? "border-white/5 bg-white/[0.02]"
                        : "border-white/10 bg-black hover:border-white/25"
                    } ${esAdmin ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-black text-white/70">{d}</span>
                      {e.cerrado && <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[9px] font-black uppercase text-zinc-300">Cerrado</span>}
                    </div>
                    {!e.cerrado && (
                      <div className="space-y-0.5">
                        {e.jornadas.map((j, idx) => (
                          <div key={idx} className="truncate rounded bg-red-600/20 px-1 py-0.5 text-[10px] text-red-200" title={`${j.nombre} ${j.hora_inicio}–${j.hora_fin}`}>
                            {j.nombre} · {j.hora_inicio}–{j.hora_fin}
                          </div>
                        ))}
                        {mostrarFallback && data.fallback && (e.jornadas.length === 0 || !cubierto) && (
                          <div className="truncate rounded border border-dashed border-amber-400/50 bg-amber-400/10 px-1 py-0.5 text-[10px] text-amber-200" title="Cobertura automática de Ramiro">
                            {data.fallback.nombre} {e.jornadas.length === 0 ? "(cobertura)" : "(huecos)"}
                          </div>
                        )}
                        {!mostrarFallback && e.jornadas.length === 0 && (
                          <div className="text-[10px] text-white/30">— sin jornadas</div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-white/50">
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-600/40" /> Jornada manual</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-dashed border-amber-400/60 bg-amber-400/10" /> Cobertura de Ramiro (calculada, no se guarda)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-zinc-700" /> Día cerrado</span>
            </div>
          </>
        )}
      </section>

      {/* Editor de día (admin) */}
      {esAdmin && editFecha && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={cerrarEditor}>
          <div className="mt-10 w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-5" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black uppercase text-red-500">Día {editFecha}</h3>
              <button onClick={cerrarEditor} className="text-2xl leading-none text-white/50 hover:text-white" aria-label="Cerrar">×</button>
            </div>

            <label className="mb-3 flex cursor-pointer items-center gap-3 rounded-xl border border-white/15 bg-black px-3 py-2.5">
              <input type="checkbox" checked={edCerrado} onChange={(e) => setEdCerrado(e.target.checked)} className="h-4 w-4 accent-red-600" />
              <span className="text-sm font-bold">Día cerrado (no trabaja nadie; sin cobertura de Ramiro)</span>
            </label>

            {!edCerrado && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <Campo label="Apertura">
                    <input type="time" value={edApertura} onChange={(e) => setEdApertura(e.target.value)} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
                  </Campo>
                  <Campo label="Cierre">
                    <input type="time" value={edCierre} onChange={(e) => setEdCierre(e.target.value)} className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold outline-none focus:border-red-500" />
                  </Campo>
                </div>

                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-wide text-white/50">Jornadas</p>
                  <button onClick={addJornada} disabled={empleadosEditor.length === 0} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-black uppercase hover:bg-white/10 disabled:opacity-40">+ Agregar</button>
                </div>

                {edJornadas.length === 0 ? (
                  <p className="mb-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white/40">
                    Sin jornadas. Si el día queda abierto sin jornadas, al confirmar lo cubre Ramiro completo.
                  </p>
                ) : (
                  <div className="mb-3 space-y-2">
                    {edJornadas.map((j, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                        <select value={j.empleado_id} onChange={(e) => setJornada(i, { empleado_id: e.target.value })} className="w-full rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500">
                          {empleadosEditor.map((e) => (<option key={e.id} value={e.id}>{e.nombre}</option>))}
                        </select>
                        <input type="time" value={j.hora_inicio} onChange={(e) => setJornada(i, { hora_inicio: e.target.value })} className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500" />
                        <input type="time" value={j.hora_fin} onChange={(e) => setJornada(i, { hora_fin: e.target.value })} className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs font-bold outline-none focus:border-red-500" />
                        <button onClick={() => removeJornada(i)} className="rounded-lg border border-red-500/40 px-2 py-1.5 text-xs font-black text-red-400 hover:bg-red-600 hover:text-white" aria-label="Quitar">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <button onClick={() => verHistorial(editFecha)} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:bg-white/10">Ver historial</button>
              <div className="flex gap-2">
                <button onClick={cerrarEditor} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase text-white/70 hover:bg-white/10">Cancelar</button>
                <button onClick={guardarDia} disabled={guardando} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30">
                  {guardando ? "Guardando…" : "Guardar día"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Importador PDF/Canva (admin) */}
      {esAdmin && importar && (
        <ImportadorPdf empleados={empleados} onAplicada={cargar} onCerrar={() => setImportar(false)} />
      )}

      {/* Historial del día (admin) */}
      {esAdmin && histFecha && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={() => setHistFecha(null)}>
          <div className="mt-10 w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-5" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black uppercase text-red-500">Historial · {histFecha}</h3>
              <button onClick={() => setHistFecha(null)} className="text-2xl leading-none text-white/50 hover:text-white" aria-label="Cerrar">×</button>
            </div>
            {histEventos.length === 0 ? (
              <p className="text-sm text-white/50">Sin eventos para este día.</p>
            ) : (
              <div className="space-y-2">
                {histEventos.map((ev) => (
                  <div key={ev.id} className="rounded-xl border border-white/10 bg-black px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-black uppercase text-white/80">{ev.tipo.replace(/_/g, " ")}</span>
                      <span className="text-white/40">{new Date(ev.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</span>
                    </div>
                    <p className="mt-0.5 text-white/40">Actor: {ev.actor}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{label}</label>
      {children}
    </div>
  );
}
