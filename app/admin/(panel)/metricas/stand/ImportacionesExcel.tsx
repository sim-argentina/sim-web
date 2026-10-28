"use client";

// Históricos importados (Excel) del Stand: subir con confirmación de mes y año
// por archivo (lib/historicosStand.ts) y administrar lo ya importado.
//   · SheetJS se descarga SOLO al elegir un archivo (import dinámico): no pesa
//     en la carga del dashboard.
//   · La lista sale de /api/turnos-historicos?resumen=archivos (una fila por
//     archivo y año), sin bajar las ventas.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, LoaderCircle, Trash2, Upload } from "lucide-react";
import { hoyEnSim } from "@/lib/agenda";
import {
  aniosSeleccionables,
  analizarArchivo,
  construirTurnos,
  MESES,
  nombreMes,
  numberValue,
  type ArchivoAnalizado,
  type TurnoHistoricoImportado,
} from "@/lib/historicosStand";
import { cx, FOCO } from "./piezas";
import { pesos } from "./formato";

type ArchivoPendiente = { analisis: ArchivoAnalizado; mes: string; anio: string };
type Importacion = { archivo_key: string; archivo_nombre: string; anio: string; meses: string[]; ventas: number; facturacion: number };

const capitalizar = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function ImportacionesExcel({ onCambio }: { onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Importacion[] | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [pendientes, setPendientes] = useState<ArchivoPendiente[]>([]);

  const cargarLista = useCallback(async () => {
    setErrorLista(null);
    try {
      const r = await fetch("/api/turnos-historicos?resumen=archivos", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo cargar la lista");
      setLista(j.importaciones ?? []);
    } catch (e) {
      setErrorLista(e instanceof Error ? e.message : "No se pudo cargar la lista");
    }
  }, []);

  // La lista se pide al abrir la sección (o al elegir un archivo, para los avisos).
  useEffect(() => {
    if ((abierto || pendientes.length) && lista === null) void cargarLista();
  }, [abierto, pendientes.length, lista, cargarLista]);

  // Años en los que ya está cargado cada archivo: reimportarlo con el MISMO año
  // no duplica (mismo hash_unico); con OTRO año crea ventas nuevas en ese año.
  const aniosPorArchivo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const i of lista ?? []) {
      if (!m.has(i.archivo_key)) m.set(i.archivo_key, new Set());
      m.get(i.archivo_key)!.add(i.anio);
    }
    return m;
  }, [lista]);

  const revision = useMemo(() => {
    const hoy = hoyEnSim();
    return pendientes.map((p) => {
      const { turnos, errores } = construirTurnos(p.analisis, p.anio ? Number(p.anio) : null, p.mes || null, hoy);
      const sinVentas = errores.length === 0 && turnos.length === 0;
      return {
        turnos,
        errores: sinVentas ? ["No se encontraron ventas en las hojas de días."] : errores,
        bloqueado: sinVentas || errores.length > 0,
        aniosPrevios: [...(aniosPorArchivo.get(p.analisis.archivoKey) ?? [])].sort(),
      };
    });
  }, [pendientes, aniosPorArchivo]);

  // Paso 1: leer los Excel elegidos. Nada se guarda todavía; el año NUNCA se toma
  // de la fecha actual (así se guardaron como 2026 los Excel de oct–dic de 2025).
  async function elegirExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = "";
    if (files.length === 0) return;
    const MAX_EXCEL_BYTES = 5 * 1024 * 1024;
    const hoy = hoyEnSim();
    const nuevos: ArchivoPendiente[] = [];
    const rechazados: string[] = [];
    setLeyendo(true);
    try {
      const { leerHojasExcel } = await import("@/lib/historicosStandExcel");
      for (const file of files) {
        if (file.size > MAX_EXCEL_BYTES) {
          rechazados.push(`${file.name}: supera el máximo de 5 MB.`);
          continue;
        }
        if (!/\.(xlsx|xls)$/i.test(file.name)) {
          rechazados.push(`${file.name}: formato inválido. Subí un archivo .xlsx.`);
          continue;
        }
        try {
          const analisis = analizarArchivo(file.name, leerHojasExcel(await file.arrayBuffer()), hoy);
          nuevos.push({ analisis, mes: analisis.mesDetectado ?? "", anio: analisis.anioDetectado ? String(analisis.anioDetectado) : "" });
        } catch (error) {
          console.error(error);
          rechazados.push(`${file.name}: no se pudo leer el Excel.`);
        }
      }
    } finally {
      setLeyendo(false);
    }
    if (rechazados.length) alert(rechazados.join("\n"));
    if (nuevos.length) setPendientes(nuevos);
  }

  function actualizarPendiente(i: number, cambios: Partial<Pick<ArchivoPendiente, "mes" | "anio">>) {
    setPendientes((prev) => prev.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  }

  // Paso 2: con mes y año confirmados en TODOS los archivos, se guardan.
  async function confirmarImportacion() {
    if (!revision.length || revision.some((r) => r.bloqueado)) return;
    const turnos: TurnoHistoricoImportado[] = revision.flatMap((r) => r.turnos);
    let insertados = 0;
    try {
      setImportando(true);
      for (let i = 0; i < turnos.length; i += 500) {
        const res = await fetch("/api/turnos-historicos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnos: turnos.slice(i, i + 500) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error guardando turnos históricos");
        insertados += Number(json.insertados ?? 0);
      }
      const facturacion = turnos.reduce((acc, t) => acc + numberValue(t.total), 0);
      const turnosVendidos = turnos.reduce((acc, t) => acc + numberValue(t.cantidad_turnos), 0);
      const detalle = pendientes.map((p) => `· ${p.analisis.nombre}: ${nombreMes(p.mes)} de ${p.anio}`).join("\n");
      alert(
        `Excel importado y guardado en Supabase.\n${detalle}\nVentas leídas: ${turnos.length}\nVentas nuevas: ${insertados}\nYa importadas (ignoradas): ${turnos.length - insertados}\nTurnos vendidos leídos: ${turnosVendidos}\nFacturación leída: ${pesos(facturacion)}`,
      );
      setPendientes([]);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error && error.message ? error.message : "Error importando Excel");
    } finally {
      setImportando(false);
      // Puede haberse guardado una parte: se refresca todo. Reintentar no duplica (hash).
      setLista(null);
      onCambio();
    }
  }

  async function borrarImportacion(imp: Importacion) {
    if (!confirm(`¿Seguro que querés borrar la importación "${imp.archivo_nombre}"${imp.anio ? ` de ${imp.anio}` : ""}?`)) return;
    try {
      // Con el año: el mismo archivo puede estar importado en dos años distintos.
      const params = new URLSearchParams({ archivo_key: imp.archivo_key });
      if (/^\d{4}$/.test(imp.anio)) params.set("anio", imp.anio);
      const res = await fetch(`/api/turnos-historicos?${params.toString()}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error borrando importación");
      setLista(null);
      onCambio();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Error borrando importación");
    }
  }

  const totalVentas = (lista ?? []).reduce((s, i) => s + i.ventas, 0);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0e0e0e]" aria-labelledby="importaciones-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <button
          type="button"
          aria-expanded={abierto}
          aria-controls="importaciones-cuerpo"
          onClick={() => setAbierto((a) => !a)}
          className={cx("flex min-h-11 items-center gap-3 rounded-xl text-left", FOCO)}
        >
          <FileSpreadsheet className="h-5 w-5 text-red-400" aria-hidden />
          <span>
            <span id="importaciones-titulo" className="block text-base font-semibold text-white">
              Históricos importados (Excel)
            </span>
            <span className="block text-sm text-white/50">
              Planillas anteriores al Turnero. Se suman al dashboard como cualquier operación.
              {lista ? ` ${lista.length} importaciones · ${totalVentas.toLocaleString("es-AR")} ventas.` : ""}
            </span>
          </span>
        </button>
        <label className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-semibold text-white hover:bg-red-500/20", (leyendo || importando) && "pointer-events-none opacity-60")}>
          {leyendo ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {leyendo ? "Leyendo…" : importando ? "Importando…" : "Subir Excel"}
          <input type="file" multiple accept=".xlsx,.xls" onChange={elegirExcel} disabled={leyendo || importando} className="sr-only" />
        </label>
      </div>

      {abierto ? (
        <div id="importaciones-cuerpo" className="border-t border-white/10 p-4 sm:p-5">
          {errorLista ? (
            <p role="alert" className="text-sm text-red-300">
              {errorLista}{" "}
              <button type="button" onClick={() => void cargarLista()} className={cx("font-semibold underline", FOCO)}>
                Reintentar
              </button>
            </p>
          ) : lista === null ? (
            <p role="status" className="flex items-center gap-2 text-sm text-white/60">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Cargando importaciones…
            </p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-white/55">Todavía no hay Excel importados.</p>
          ) : (
            <ul className="space-y-2">
              {lista.map((imp) => (
                <li key={`${imp.archivo_key}|${imp.anio}`} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{imp.archivo_nombre}</p>
                    <p className="text-sm text-white/50">
                      {capitalizar(imp.meses.map((m) => nombreMes(m)).join(", "))} {imp.anio} · {imp.ventas.toLocaleString("es-AR")} ventas · {pesos(imp.facturacion)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void borrarImportacion(imp)}
                    className={cx("inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-red-500/40 px-3 text-sm text-red-200 hover:bg-red-950/40 sm:self-auto", FOCO)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> Borrar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {pendientes.length > 0 && (
        <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/75 p-4 md:p-10" role="dialog" aria-modal="true" aria-labelledby="titulo-confirmar-anio">
          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6">
            <h2 id="titulo-confirmar-anio" className="text-2xl font-bold text-white">
              Confirmá el mes y el año de cada Excel
            </h2>
            <p className="mt-2 text-sm text-white/60">
              No se guarda nada hasta que confirmes. El año no se toma de la fecha de hoy: si el archivo lo indica se propone, y si no, elegilo.
            </p>
            <div className="mt-6 space-y-4">
              {pendientes.map((p, i) => {
                const r = revision[i];
                if (!r) return null;
                const faltaElegir = !p.mes || !p.anio;
                const yaEnEseAnio = Boolean(p.anio) && r.aniosPrevios.includes(p.anio);
                const enOtroAnio = Boolean(p.anio) && r.aniosPrevios.length > 0 && !r.aniosPrevios.includes(p.anio);
                const fechas = r.turnos.map((t) => t.fecha).sort();
                const fmt = (f: string) => f.split("-").reverse().join("/");
                return (
                  <div key={`${p.analisis.archivoKey}-${i}`} className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="break-words font-semibold text-white">{p.analisis.nombre}</p>
                    <p className="mt-1 text-sm text-white/50">
                      {p.analisis.ventasLeidas} {p.analisis.ventasLeidas === 1 ? "venta" : "ventas"} en {p.analisis.dias.length}{" "}
                      {p.analisis.dias.length === 1 ? "hoja de día" : "hojas de días"} · {p.analisis.motivoAnio}
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`importar-mes-${i}`} className="mb-1 block text-xs text-white/60">
                          Mes
                        </label>
                        <select
                          id={`importar-mes-${i}`}
                          value={p.mes}
                          onChange={(e) => actualizarPendiente(i, { mes: e.target.value })}
                          disabled={importando}
                          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                        >
                          <option value="">Elegí el mes</option>
                          {[...new Set(Object.values(MESES))].map((m) => (
                            <option key={m} value={m}>
                              {capitalizar(nombreMes(m))}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`importar-anio-${i}`} className="mb-1 block text-xs text-white/60">
                          Año
                        </label>
                        <select
                          id={`importar-anio-${i}`}
                          value={p.anio}
                          onChange={(e) => actualizarPendiente(i, { anio: e.target.value })}
                          disabled={importando}
                          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-red-500"
                        >
                          <option value="">Elegí el año</option>
                          {aniosSeleccionables(hoyEnSim()).map((a) => (
                            <option key={a} value={String(a)}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {faltaElegir ? (
                      <p className="mt-3 text-sm text-amber-300">Elegí el mes y el año para continuar.</p>
                    ) : r.errores.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-sm text-red-400">
                        {r.errores.slice(0, 5).map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                        {r.errores.length > 5 && <li>…y {r.errores.length - 5} más.</li>}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-emerald-300">
                        {r.turnos.length === 1
                          ? `Se importa 1 venta, del ${fmt(fechas[0])}.`
                          : `Se importan ${r.turnos.length} ventas, del ${fmt(fechas[0])} al ${fmt(fechas[fechas.length - 1])}.`}
                      </p>
                    )}
                    {lista === null ? <p className="mt-2 text-xs text-white/45">Revisando importaciones existentes…</p> : null}
                    {yaEnEseAnio && <p className="mt-2 text-sm text-white/60">Este archivo ya está importado en {p.anio}: las ventas repetidas se ignoran.</p>}
                    {enOtroAnio && (
                      <p className="mt-2 text-sm text-amber-300">
                        Atención: este archivo ya está importado en {r.aniosPrevios.join(", ")}. Importarlo como {p.anio} agrega sus ventas también en {p.anio}: entre años distintos no se deduplican.
                      </p>
                    )}
                    {p.analisis.hojasIgnoradas.length > 0 && (
                      <p className="mt-2 text-xs text-white/45">Hojas que no son un día y no se importan: {p.analisis.hojasIgnoradas.join(", ")}.</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendientes([])}
                disabled={importando}
                className={cx("min-h-11 rounded-xl border border-white/15 px-4 py-3 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40", FOCO)}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarImportacion()}
                disabled={importando || lista === null || revision.some((r) => r.bloqueado)}
                className={cx("min-h-11 rounded-xl border border-red-500/40 bg-red-500/20 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40", FOCO)}
              >
                {importando ? "Importando..." : `Importar ${pendientes.length} ${pendientes.length === 1 ? "archivo" : "archivos"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
