"use client";

// Panel de detalle: las operaciones concretas detrás de una cifra. Usa el mismo
// período y filtros que el dashboard más la selección elegida, y muestra el total
// del conjunto completo (no solo de la página) para conciliar contra la cifra.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { escribirSeleccion, type Criterios, type FilaDetalle, type OrdenDetalle, type Rango, type Totales } from "@/lib/metricasStandDashboard";
import { cx, FOCO, Segmentado } from "./piezas";
import { entero, fechaCorta, pesos, rangoTexto } from "./formato";

export type ConsultaDetalle = {
  titulo: string;
  /** Parámetros del dashboard (período, comparación, filtros). */
  base: string;
  seleccion: Criterios;
  /** Textos de los criterios aplicados (filtros + selección), para el encabezado. */
  criterios: string[];
  periodo: "actual" | "comparacion";
  /** La cifra del dashboard que se está abriendo, para mostrarla al lado del total. */
  cifra?: { etiqueta: string; valor: string };
};

type Respuesta = {
  rango: Rango;
  contexto: Totales & { importeMedio: number | null };
  filas: FilaDetalle[];
  pagina: number;
  paginas: number;
  total: number;
};

const ORDENES: Array<{ valor: OrdenDetalle; texto: string }> = [
  { valor: "reciente", texto: "Recientes" },
  { valor: "antiguo", texto: "Antiguas" },
  { valor: "importe", texto: "Importe" },
  { valor: "personas", texto: "Personas" },
  { valor: "espera", texto: "Espera" },
];

export default function DetalleOperaciones({ consulta, onCerrar }: { consulta: ConsultaDetalle; onCerrar: () => void }) {
  const [pagina, setPagina] = useState(1);
  const [orden, setOrden] = useState<OrdenDetalle>(consulta.seleccion.esperaMin != null ? "espera" : "reciente");
  const [respuesta, setRespuesta] = useState<{ pedido: string; datos: Respuesta } | null>(null);
  const [fallo, setFallo] = useState<{ pedido: string; mensaje: string } | null>(null);
  const [intento, setIntento] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const cerrarBtn = useRef<HTMLButtonElement>(null);
  const ultima = useRef("");

  const clave = `${consulta.base}&${escribirSeleccion(consulta.seleccion).toString()}&periodo=${consulta.periodo}&orden=${orden}&pagina=${pagina}`;

  const pedido = clave + "#" + intento;

  useEffect(() => {
    const ctrl = new AbortController();
    ultima.current = pedido;
    fetch("/api/admin/metricas/stand/operaciones?" + clave, { cache: "no-store", signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || "No se pudieron cargar las operaciones");
        return j as Respuesta;
      })
      .then((j) => {
        if (ultima.current !== pedido) return; // respuesta vieja: se descarta
        setRespuesta({ pedido, datos: j });
        if (j.pagina !== pagina) setPagina(j.pagina);
      })
      .catch((e) => {
        if (ctrl.signal.aborted || ultima.current !== pedido) return;
        setFallo({ pedido, mensaje: e instanceof Error ? e.message : "No se pudieron cargar las operaciones" });
      });
    return () => ctrl.abort();
  }, [pedido, clave, pagina]);

  const datos = respuesta?.datos ?? null;
  const error = fallo?.pedido === pedido ? fallo.mensaje : null;
  const cargando = respuesta?.pedido !== pedido && !error;

  useEffect(() => {
    cerrarBtn.current?.focus();
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCerrar();
      }
      if (e.key === "Tab" && panel.current) {
        const foco = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), select, [tabindex='0'], a[href]")];
        if (!foco.length) return;
        const primero = foco[0];
        const ultimo = foco[foco.length - 1];
        if (e.shiftKey && document.activeElement === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    };
    document.addEventListener("keydown", teclas);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", teclas);
      document.body.style.overflow = overflow;
    };
  }, [onCerrar]);

  const c = datos?.contexto;
  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-black/60" onPointerDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalle-titulo"
        className="flex h-full w-full max-w-5xl flex-col border-l border-white/10 bg-[#0a0a0a] shadow-2xl shadow-black"
      >
        <header className="border-b border-white/10 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-400">Operaciones {consulta.periodo === "comparacion" ? "del período de comparación" : ""}</p>
              <h2 id="detalle-titulo" className="mt-1 text-xl font-bold text-white">
                {consulta.titulo}
              </h2>
              <p className="mt-1 text-sm text-white/55">
                {datos ? rangoTexto(datos.rango.desde, datos.rango.hasta) : "…"}
                {datos?.rango.corteMinuto != null ? ` · último día hasta las ${String(Math.floor(datos.rango.corteMinuto / 60)).padStart(2, "0")}:${String(datos.rango.corteMinuto % 60).padStart(2, "0")}` : ""}
              </p>
            </div>
            <button
              ref={cerrarBtn}
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar el detalle"
              className={cx("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 text-white/70 hover:text-white", FOCO)}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          {consulta.criterios.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Criterios aplicados">
              {consulta.criterios.map((t) => (
                <li key={t} className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs text-white/75">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-white/45">Sin filtros: todas las operaciones del período.</p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite">
            <Dato etiqueta="Operaciones" valor={c ? entero(c.operaciones) : "…"} detalle={c ? `${entero(c.ventas)} ventas · ${entero(c.cortesias)} cortesías` : undefined} />
            <Dato etiqueta="Personas" valor={c ? entero(c.personas) : "…"} detalle={c ? `${entero(c.personasConSubida)} con subida` : undefined} />
            <Dato etiqueta="Facturación comercial" valor={c ? pesos(c.facturacion) : "…"} detalle={c?.ticketPromedio != null ? `Ticket ${pesos(c.ticketPromedio)}` : undefined} />
            {c?.importeMedio != null ? (
              <Dato etiqueta={`Pagado con ${consulta.seleccion.medio?.toLowerCase()}`} valor={pesos(c.importeMedio)} detalle="Solo la parte con ese medio" />
            ) : consulta.cifra ? (
              <Dato etiqueta={consulta.cifra.etiqueta} valor={consulta.cifra.valor} detalle="Cifra del dashboard" />
            ) : null}
          </dl>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <Segmentado etiqueta="Ordenar operaciones" opciones={ORDENES} valor={orden} onChange={(o) => { setOrden(o); setPagina(1); }} chico />
          <Paginador datos={datos} cargando={cargando} onPagina={setPagina} />
        </div>

        <div className={cx("min-h-0 flex-1 overflow-auto transition-opacity duration-150", cargando && datos ? "opacity-60" : "opacity-100")} aria-busy={cargando}>
          {error ? (
            <div className="m-5 rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-100" role="alert">
              {error}
              <button type="button" onClick={() => setIntento((i) => i + 1)} className={cx("ml-3 font-semibold underline", FOCO)}>
                Reintentar
              </button>
            </div>
          ) : !datos ? (
            <p role="status" className="flex items-center gap-2 p-5 text-sm text-white/60">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Cargando operaciones…
            </p>
          ) : datos.total === 0 ? (
            <p className="p-8 text-center text-sm text-white/60">Ninguna operación cumple estos criterios en el período.</p>
          ) : (
            <>
              <table className="hidden w-full text-left text-sm md:table">
                <caption className="sr-only">Operaciones, página {datos.pagina} de {datos.paginas}</caption>
                <thead className="sticky top-0 bg-[#0a0a0a] text-xs uppercase tracking-[0.1em] text-white/45">
                  <tr>
                    {["Fecha", "Venta", "Subida", "Espera", "Pers.", "Duración", "Tipo", "Medio", "Importe", "Origen"].map((h) => (
                      <th key={h} scope="col" className={cx("px-3 py-2.5 font-semibold", ["Pers.", "Importe", "Espera"].includes(h) && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {datos.filas.map((f) => (
                    <tr key={f.id} className="border-t border-white/[0.06] hover:bg-white/[0.03]">
                      <td className="whitespace-nowrap px-3 py-2.5 text-white">
                        {fechaCorta(f.fecha)} <span className="text-white/45">{f.dia}</span>
                      </td>
                      <td className="px-3 py-2.5 text-white/80">{f.horaVenta ?? "—"}</td>
                      <td className="px-3 py-2.5 text-white/80">{f.horaSubida ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right text-white/80">{f.espera != null ? `${f.espera} min` : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-white">{f.personas}</td>
                      <td className="px-3 py-2.5 text-white/80">{f.duracion}</td>
                      <td className="px-3 py-2.5">
                        <span className={cx("rounded-md px-1.5 py-0.5 text-xs font-semibold", f.tipo === "Cortesía" ? "bg-amber-500/10 text-amber-200" : "bg-white/[0.06] text-white/75")}>{f.tipo}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-white/75">{f.medios}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-white">{pesos(f.importe)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-white/55">
                        {f.origen}
                        {f.cliente ? <span className="block text-white/40">{f.cliente}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="divide-y divide-white/[0.06] md:hidden">
                {datos.filas.map((f) => (
                  <li key={f.id} className="p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold text-white">
                        {fechaCorta(f.fecha)} <span className="font-normal text-white/45">{f.dia}</span>
                      </p>
                      <p className="font-bold tabular-nums text-white">{pesos(f.importe)}</p>
                    </div>
                    <p className="mt-1 text-sm text-white/70">
                      {f.personas} {f.personas === 1 ? "persona" : "personas"} · {f.duracion} · {f.tipo} · {f.medios}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-white/50">
                      Venta {f.horaVenta ?? "—"} · Subida {f.horaSubida ?? "—"}
                      {f.espera != null ? ` · espera ${f.espera} min` : ""} · {f.origen}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex justify-end border-t border-white/10 px-4 py-3 sm:px-5">
          <Paginador datos={datos} cargando={cargando} onPagina={setPagina} />
        </div>
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">{etiqueta}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums text-white">{valor}</dd>
      {detalle ? <dd className="text-xs text-white/50">{detalle}</dd> : null}
    </div>
  );
}

function Paginador({ datos, cargando, onPagina }: { datos: Respuesta | null; cargando: boolean; onPagina: (p: number) => void }) {
  if (!datos || datos.total === 0) return null;
  return (
    <nav aria-label="Páginas" className="flex items-center gap-2 text-sm text-white/70">
      <button
        type="button"
        disabled={datos.pagina <= 1 || cargando}
        onClick={() => onPagina(datos.pagina - 1)}
        aria-label="Página anterior"
        className={cx("inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 hover:text-white disabled:opacity-30", FOCO)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <span className="tabular-nums" aria-live="polite">
        {datos.pagina} / {datos.paginas} · {entero(datos.total)} operaciones
      </span>
      <button
        type="button"
        disabled={datos.pagina >= datos.paginas || cargando}
        onClick={() => onPagina(datos.pagina + 1)}
        aria-label="Página siguiente"
        className={cx("inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 hover:text-white disabled:opacity-30", FOCO)}
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
