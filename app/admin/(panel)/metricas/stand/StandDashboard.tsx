"use client";

// Dashboard del Stand (Métricas → Stand). Pide un RESUMEN ya agregado al
// servidor (/api/admin/metricas/stand) y, a demanda, el detalle paginado de
// cualquier cifra (/api/admin/metricas/stand/operaciones). Las dos rutas usan
// las mismas definiciones (lib/metricasStandDashboard.ts).
//
// Interacción: tocar/clickear una marca abre un menú que dice explícitamente qué
// hace cada opción — FILTRAR el dashboard (cambia todas las cifras) o VER LAS
// OPERACIONES (abre el detalle, sin tocar el dashboard).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarRange, Filter, List, RefreshCw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import {
  CLASES_DURACION,
  DIAS_CORTOS,
  DIAS_SEMANA,
  ETIQUETA_DURACION,
  diaSemanaDe,
  escribirParametros,
  leerParametros,
  sumarDiasFecha,
  type ClaseDuracion,
  type Comparacion,
  type Criterios,
  type Hallazgo,
  type ModoComparacion,
  type ParametrosStand,
  type Preset,
  type Resumen,
} from "@/lib/metricasStandDashboard";
import DetalleOperaciones, { type ConsultaDetalle } from "./DetalleOperaciones";
import ImportacionesExcel from "./ImportacionesExcel";
import { BarraParticipacion, BarrasHorizontales, GraficoEvolucion, Histograma, MapaCalor, RAMPA_DURACION, type FilaBarra, type PuntoEvolucion } from "./graficos";
import { Chip, cx, Delta, Esqueleto, FOCO, Kpi, ProveedorInteraccion, Segmentado, SinDatos, Tarjeta, TipContenido, useMenuAcciones } from "./piezas";
import { decimal, entero, fechaCorta, fechaDiaMes, horaRango, mesCorto, mesLargo, minutos, minutoTexto, pesos, pesosCorto, porcentaje, rangoTexto } from "./formato";

type Respuesta = {
  generado: string;
  hoy: string;
  minuto: number;
  datosDesde: string | null;
  parametros: ParametrosStand;
  actual: Resumen;
  anterior: Resumen | null;
  comparacion: Comparacion | null;
  lectura: Hallazgo[];
};

type Metrica = "facturacion" | "ventas" | "personas";
const METRICAS: Array<{ valor: Metrica; texto: string }> = [
  { valor: "facturacion", texto: "Facturación" },
  { valor: "ventas", texto: "Ventas" },
  { valor: "personas", texto: "Personas" },
];
const UNIDAD: Record<Metrica, string> = { facturacion: "facturación comercial", ventas: "ventas comerciales", personas: "personas registradas" };
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtMetrica = (m: Metrica) => (m === "facturacion" ? pesos : entero);
const fmtEje = (m: Metrica) => (m === "facturacion" ? pesosCorto : entero);

const PRESETS: Array<{ valor: Preset; texto: string }> = [
  { valor: "hoy", texto: "Hoy" },
  { valor: "7d", texto: "7 días" },
  { valor: "semana", texto: "Semana" },
  { valor: "mes", texto: "Mes" },
  { valor: "mes_anterior", texto: "Mes anterior" },
  { valor: "30d", texto: "30 días" },
  { valor: "anio", texto: "Año" },
  { valor: "todo", texto: "Todo" },
  { valor: "personalizado", texto: "Personalizado" },
];

const COMPARAR: Array<{ valor: ModoComparacion; texto: string }> = [
  { valor: "anterior", texto: "vs. anterior" },
  { valor: "anio", texto: "vs. año anterior" },
  { valor: "ninguna", texto: "Sin comparar" },
];

const PARAMETROS_INICIALES: ParametrosStand = { preset: "mes", comparar: "anterior", filtros: {} };

function alternar<T>(lista: T[] | undefined, v: T): T[] | undefined {
  const l = lista ?? [];
  const r = l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
  return r.length ? r : undefined;
}

/** Textos legibles de un conjunto de criterios (chips, encabezado del detalle). */
export function textosCriterios(c: Criterios): string[] {
  const out: string[] = [];
  if (c.duraciones?.length) out.push(`Duración: ${c.duraciones.map((d) => ETIQUETA_DURACION[d]).join(", ")}`);
  if (c.dias?.length) out.push(`Días: ${[...c.dias].sort().map((d) => DIAS_CORTOS[d]).join(", ")}`);
  if (c.horas?.length) out.push(`Venta: ${[...c.horas].sort((a, b) => a - b).map(horaRango).join(", ")}`);
  if (c.horasSubida?.length) out.push(`Subida: ${[...c.horasSubida].sort((a, b) => a - b).map(horaRango).join(", ")}`);
  if (c.tipo === "comerciales") out.push("Solo ventas comerciales");
  if (c.tipo === "cortesias") out.push("Solo cortesías");
  if (c.fecha) out.push(`Día ${fechaCorta(c.fecha)}`);
  if (c.fechaDesde && c.fechaHasta) out.push(`Del ${fechaCorta(c.fechaDesde)} al ${fechaCorta(c.fechaHasta)}`);
  if (c.grupo != null) out.push(c.grupo >= 4 ? "Grupos de 4 o más personas" : `Grupos de ${c.grupo} ${c.grupo === 1 ? "persona" : "personas"}`);
  if (c.medio) out.push(`Medio: ${c.medio === "GRATIS" ? "cortesía" : c.medio.toLowerCase()}`);
  if (c.conSubida === true) out.push("Con subida confirmada");
  if (c.esperaMin != null || c.esperaMax != null) {
    out.push(c.esperaMax != null ? `Espera de ${c.esperaMin ?? 0} a ${c.esperaMax} min` : `Espera ≥ ${c.esperaMin} min`);
  }
  if (c.id) out.push(`Operación ${c.id.startsWith("t:") ? "Turnero" : "Excel"} #${c.id.slice(2)}`);
  return out;
}

const valorDe = (m: Metrica, x: { facturacion: number; ventas: number; personas: number }) => x[m];

// ── Agrupación de la serie diaria (día / semana / mes) ──────────────────────

type Agrupacion = "auto" | "dia" | "semana" | "mes";
type Cubeta = { clave: string; desde: string; hasta: string; facturacion: number; ventas: number; personas: number; operaciones: number; cortesias: number };

function agrupar(serie: Resumen["serie"], modo: Exclude<Agrupacion, "auto">): Cubeta[] {
  const m = new Map<string, Cubeta>();
  for (const d of serie) {
    const clave = modo === "dia" ? d.fecha : modo === "semana" ? sumarDiasFecha(d.fecha, -diaSemanaDe(d.fecha)) : d.fecha.slice(0, 7);
    if (!m.has(clave)) m.set(clave, { clave, desde: d.fecha, hasta: d.fecha, facturacion: 0, ventas: 0, personas: 0, operaciones: 0, cortesias: 0 });
    const c = m.get(clave)!;
    c.hasta = d.fecha;
    c.facturacion += d.facturacion;
    c.ventas += d.ventas;
    c.personas += d.personas;
    c.operaciones += d.operaciones;
    c.cortesias += d.cortesias;
  }
  return [...m.values()];
}

function etiquetasCubeta(c: Cubeta, modo: Exclude<Agrupacion, "auto">) {
  if (modo === "dia") return { corta: fechaDiaMes(c.desde), larga: `${DIAS_SEMANA[diaSemanaDe(c.desde)]} ${fechaCorta(c.desde)}` };
  if (modo === "semana") return { corta: fechaDiaMes(c.desde), larga: `Semana ${rangoTexto(c.desde, c.hasta)}` };
  return { corta: mesCorto(c.clave), larga: mesLargo(c.clave) };
}

// ════════════════════════════════════════════════════════════════════════════

export default function StandDashboard() {
  return (
    <ProveedorInteraccion>
      <Tablero />
    </ProveedorInteraccion>
  );
}

function Tablero() {
  // Estado inicial desde la URL (enlaces reproducibles).
  const busqueda = useSearchParams();
  const [params, setParams] = useState<ParametrosStand>(() =>
    busqueda.has("p") ? leerParametros(new URLSearchParams(busqueda.toString())) : PARAMETROS_INICIALES,
  );
  const [respuesta, setRespuesta] = useState<{ pedido: string; clave: string; datos: Respuesta } | null>(null);
  const [fallo, setFallo] = useState<{ pedido: string; mensaje: string } | null>(null);
  const [refresco, setRefresco] = useState(0);
  const [detalle, setDetalle] = useState<ConsultaDetalle | null>(null);
  const [panelFiltros, setPanelFiltros] = useState(false);
  const [borrador, setBorrador] = useState<{ desde: string; hasta: string }>({ desde: "", hasta: "" });
  const [mEvol, setMEvol] = useState<Metrica>("facturacion");
  const [agrup, setAgrup] = useState<Agrupacion>("auto");
  const [mDur, setMDur] = useState<Metrica>("personas");
  const [mCalor, setMCalor] = useState<Metrica>("personas");
  const [momento, setMomento] = useState<"venta" | "subida">("venta");
  const [mDias, setMDias] = useState<Metrica>("personas");
  const ultima = useRef("");
  const disparador = useRef<HTMLElement | null>(null);
  const abrirMenu = useMenuAcciones();

  // Barra de filtros siempre a mano. `position: sticky` no funciona acá (el <main>
  // del panel tiene overflow-x-auto), así que al salir de la pantalla pasa a
  // `fixed` y un espacio del mismo alto evita que el contenido salte.
  const centinela = useRef<HTMLDivElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const [fija, setFija] = useState<{ alto: number } | null>(null);
  useEffect(() => {
    const el = centinela.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setFija(null);
      else if (e.boundingClientRect.top < 0) setFija({ alto: barraRef.current?.offsetHeight ?? 0 });
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const clave = useMemo(() => escribirParametros(params).toString(), [params]);
  const pedido = clave + "#" + refresco;

  // URL siempre al día, sin navegación.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    escribirParametros(params, sp);
    sp.set("vista", "stand");
    window.history.replaceState(null, "", window.location.pathname + "?" + sp.toString());
  }, [params]);

  // Resumen: una petición por combinación; una respuesta que ya no corresponde
  // a la consulta vigente (cambio rápido de período o filtro) se descarta.
  useEffect(() => {
    const ctrl = new AbortController();
    ultima.current = pedido;
    const fresco = pedido.endsWith("#0") ? "" : "&fresco=1";
    fetch("/api/admin/metricas/stand?" + clave + fresco, { cache: "no-store", signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || "No se pudieron cargar las métricas del Stand");
        return j as Respuesta;
      })
      .then((j) => {
        if (ultima.current === pedido) setRespuesta({ pedido, clave, datos: j });
      })
      .catch((e) => {
        if (ctrl.signal.aborted || ultima.current !== pedido) return;
        setFallo({ pedido, mensaje: e instanceof Error ? e.message : "No se pudieron cargar las métricas del Stand" });
      });
    return () => ctrl.abort();
  }, [pedido, clave]);

  const datos = respuesta?.datos ?? null;
  const claveDatos = respuesta?.clave ?? "";
  const error = fallo?.pedido === pedido ? fallo.mensaje : null;
  const cargando = respuesta?.pedido !== pedido && !error;

  const f = params.filtros;
  const hayFiltros = Boolean(f.duraciones?.length || f.dias?.length || f.horas?.length || f.horasSubida?.length || (f.tipo && f.tipo !== "todas"));
  const setFiltros = useCallback((cambio: (x: Criterios) => Criterios) => setParams((p) => ({ ...p, filtros: cambio(p.filtros) })), []);
  const desactualizado = Boolean(datos) && claveDatos !== clave;

  const abrirDetalle = useCallback(
    (titulo: string, seleccion: Criterios, opciones: { periodo?: "actual" | "comparacion"; cifra?: ConsultaDetalle["cifra"] } = {}) => {
      disparador.current = document.activeElement as HTMLElement | null;
      setDetalle({
        titulo,
        base: claveDatos || clave,
        seleccion,
        criterios: [...textosCriterios(params.filtros).map((t) => `Filtro · ${t}`), ...textosCriterios(seleccion)],
        periodo: opciones.periodo ?? "actual",
        cifra: opciones.cifra,
      });
    },
    [claveDatos, clave, params.filtros],
  );
  const cerrarDetalle = useCallback(() => {
    setDetalle(null);
    disparador.current?.focus?.();
  }, []);

  const a = datos?.actual;
  const b = datos?.anterior ?? null;
  const cmp = datos?.comparacion ?? null;
  const sinComparacionUtil = !b || b.totales.operaciones === 0;

  return (
    <div className="pb-16">
      {/* ── Barra de filtros (fija al hacer scroll) ── */}
      <div ref={centinela} aria-hidden className="h-px" />
      {fija ? <div aria-hidden style={{ height: fija.alto }} /> : null}
      <div
        ref={barraRef}
        className={cx(
          "z-40 border-b border-white/10 bg-[#050505]/95 backdrop-blur",
          fija ? "fixed inset-x-0 top-0 max-h-[85vh] overflow-y-auto shadow-xl shadow-black/50" : "-mx-4 sm:-mx-6",
        )}
      >
      <div className={cx("px-4 py-3 sm:px-6", fija && "mx-auto max-w-7xl")}>
        <div className="flex flex-wrap items-center gap-2 pl-16 2xl:pl-0">
          <Segmentado
            etiqueta="Período"
            opciones={PRESETS}
            valor={params.preset}
            onChange={(v) => {
              if (v === "personalizado") {
                const d = datos?.actual.rango ?? { desde: "", hasta: "" };
                setBorrador({ desde: params.desde ?? d.desde, hasta: params.hasta ?? d.hasta });
              }
              setParams((p) => ({ ...p, preset: v, ...(v === "personalizado" ? { desde: p.desde ?? datos?.actual.rango.desde, hasta: p.hasta ?? datos?.actual.rango.hasta } : { desde: undefined, hasta: undefined }) }));
            }}
            chico
          />
          <label className="sr-only" htmlFor="stand-comparar">
            Comparar con
          </label>
          <select
            id="stand-comparar"
            value={params.comparar}
            onChange={(e) => setParams((p) => ({ ...p, comparar: e.target.value as ModoComparacion }))}
            disabled={params.preset === "todo"}
            className={cx("min-h-10 max-w-[9rem] rounded-xl border border-white/10 bg-black/40 px-3 text-xs font-semibold text-white/80 disabled:opacity-40", FOCO)}
          >
            {COMPARAR.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.texto}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPanelFiltros((v) => !v)}
            aria-expanded={panelFiltros}
            aria-controls="stand-panel-filtros"
            className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold", hayFiltros ? "border-red-500/50 bg-red-500/10 text-white" : "border-white/10 text-white/70 hover:text-white", FOCO)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filtros{hayFiltros ? ` (${textosCriterios(f).length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setRefresco((n) => n + 1)}
            aria-label="Actualizar datos"
            title="Actualizar datos"
            className={cx("inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/70 hover:text-white", FOCO)}
          >
            <RefreshCw className={cx("h-4 w-4", cargando && "animate-spin motion-reduce:animate-none")} aria-hidden />
          </button>
          <span className="sr-only text-xs text-white/45 sm:not-sr-only" aria-live="polite">
            {cargando ? "Actualizando…" : datos ? `Datos de las ${new Date(datos.generado).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>

        {params.preset === "personalizado" ? (
          <form
            className="mt-2 flex flex-wrap items-end gap-2 pl-16 2xl:pl-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (borrador.desde && borrador.hasta) setParams((p) => ({ ...p, desde: borrador.desde, hasta: borrador.hasta }));
            }}
          >
            <label className="text-xs text-white/60">
              Desde
              <input type="date" value={borrador.desde} max={borrador.hasta || undefined} onChange={(e) => setBorrador((x) => ({ ...x, desde: e.target.value }))} className={cx("mt-1 block min-h-10 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white", FOCO)} />
            </label>
            <label className="text-xs text-white/60">
              Hasta
              <input type="date" value={borrador.hasta} min={borrador.desde || undefined} max={datos?.hoy} onChange={(e) => setBorrador((x) => ({ ...x, hasta: e.target.value }))} className={cx("mt-1 block min-h-10 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white", FOCO)} />
            </label>
            <button type="submit" className={cx("min-h-10 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700", FOCO)}>
              Aplicar
            </button>
          </form>
        ) : null}

        {panelFiltros ? <PanelFiltros filtros={f} setFiltros={setFiltros} horasDisponibles={(a?.horasVenta ?? []).map((h) => h.hora)} /> : null}

        {hayFiltros ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-16 2xl:pl-0" aria-label="Filtros activos">
            <span className="text-xs font-semibold text-white/50">Filtrando:</span>
            {f.duraciones?.length ? <Chip texto={textosCriterios({ duraciones: f.duraciones })[0]} onQuitar={() => setFiltros((x) => ({ ...x, duraciones: undefined }))} /> : null}
            {f.dias?.length ? <Chip texto={textosCriterios({ dias: f.dias })[0]} onQuitar={() => setFiltros((x) => ({ ...x, dias: undefined }))} /> : null}
            {f.horas?.length ? <Chip texto={textosCriterios({ horas: f.horas })[0]} onQuitar={() => setFiltros((x) => ({ ...x, horas: undefined }))} /> : null}
            {f.horasSubida?.length ? <Chip texto={textosCriterios({ horasSubida: f.horasSubida })[0]} onQuitar={() => setFiltros((x) => ({ ...x, horasSubida: undefined }))} /> : null}
            {f.tipo && f.tipo !== "todas" ? <Chip texto={textosCriterios({ tipo: f.tipo })[0]} onQuitar={() => setFiltros((x) => ({ ...x, tipo: undefined }))} /> : null}
            <button type="button" onClick={() => setFiltros(() => ({}))} className={cx("min-h-9 rounded-full px-3 text-xs font-semibold text-red-300 hover:text-red-200 hover:underline", FOCO)}>
              Limpiar filtros
            </button>
          </div>
        ) : null}
      </div>
      </div>

      {/* ── Encabezado del período ── */}
      <div className="mt-6">
        {datos ? (
          <EncabezadoPeriodo datos={datos} />
        ) : (
          <Esqueleto className="h-14 w-full max-w-xl" />
        )}
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-100">
          <TriangleAlert className="h-5 w-5" aria-hidden />
          {error}
          {datos ? <span className="text-red-100/70">Se muestran los últimos datos cargados.</span> : null}
          <button type="button" onClick={() => setRefresco((n) => n + 1)} className={cx("font-semibold underline", FOCO)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {!datos ? (
        error ? null : <EsqueletoTablero />
      ) : (
        <div className={cx("mt-5 space-y-6 transition-opacity duration-150", desactualizado || cargando ? "opacity-60" : "opacity-100")} aria-busy={cargando}>
          {a && a.totales.operaciones === 0 ? (
            <SinDatos
              titulo={hayFiltros ? "Ninguna operación cumple los filtros en este período" : "No hay operaciones registradas en este período"}
              accion={
                hayFiltros ? (
                  <button type="button" onClick={() => setFiltros(() => ({}))} className={cx("min-h-11 rounded-xl bg-red-600 px-4 text-sm font-bold text-white", FOCO)}>
                    Limpiar filtros
                  </button>
                ) : undefined
              }
            >
              {datos.datosDesde && a.rango.hasta < datos.datosDesde
                ? `El primer registro del Stand es del ${fechaCorta(datos.datosDesde)}. Esto es “sin datos”, no un cero de ventas.`
                : "Sin operaciones no es lo mismo que ventas en cero: probá otro período o quitá filtros."}
            </SinDatos>
          ) : a ? (
            <>
              <ResumenComercial a={a} b={b} cmp={cmp} sinComparacion={sinComparacionUtil} abrirDetalle={abrirDetalle} />
              {datos.lectura.length ? <Lectura lectura={datos.lectura} /> : null}

              <Evolucion
                a={a}
                b={sinComparacionUtil ? null : b}
                metrica={mEvol}
                setMetrica={setMEvol}
                agrupacion={agrup}
                setAgrupacion={setAgrup}
                onElegir={(c, modo, el) => {
                  const etq = etiquetasCubeta(c, modo).larga;
                  const sel: Criterios = c.desde === c.hasta ? { fecha: c.desde } : { fechaDesde: c.desde, fechaHasta: c.hasta };
                  abrirMenu(el, etq, [
                    {
                      etiqueta: `Ver ${entero(c.operaciones)} operaciones`,
                      descripcion: "Abre el detalle; el dashboard no cambia",
                      icono: <List className="h-4 w-4" />,
                      onClick: () => abrirDetalle(etq, sel, { cifra: { etiqueta: UNIDAD[mEvol], valor: fmtMetrica(mEvol)(valorDe(mEvol, c)) } }),
                    },
                    {
                      etiqueta: `Ir a ${modo === "dia" ? "ese día" : modo === "semana" ? "esa semana" : "ese mes"}`,
                      descripcion: "Cambia el período de todo el dashboard",
                      icono: <CalendarRange className="h-4 w-4" />,
                      onClick: () => setParams((p) => ({ ...p, preset: "personalizado", desde: c.desde, hasta: c.hasta })),
                    },
                  ]);
                }}
              />

              <h2 className="pt-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Preferencias de compra</h2>
              <div className="grid gap-6 xl:grid-cols-5">
                <Duraciones
                  className="xl:col-span-3"
                  a={a}
                  b={sinComparacionUtil ? null : b}
                  cmp={cmp}
                  metrica={mDur}
                  setMetrica={setMDur}
                  filtradas={f.duraciones}
                  onElegir={(clase, el) => {
                    const fila = a.duraciones.find((d) => d.clase === clase)!;
                    abrirMenu(el, ETIQUETA_DURACION[clase], [
                      {
                        etiqueta: f.duraciones?.includes(clase) ? `Quitar el filtro ${ETIQUETA_DURACION[clase]}` : `Filtrar por ${ETIQUETA_DURACION[clase]}`,
                        descripcion: "Todas las cifras pasan a contar solo esta duración",
                        icono: <Filter className="h-4 w-4" />,
                        onClick: () => setFiltros((x) => ({ ...x, duraciones: alternar(x.duraciones, clase) })),
                      },
                      {
                        etiqueta: `Ver ${entero(fila.operaciones)} operaciones`,
                        descripcion: "Abre el detalle; el dashboard no cambia",
                        icono: <List className="h-4 w-4" />,
                        onClick: () => abrirDetalle(`Duración ${ETIQUETA_DURACION[clase]}`, { duraciones: [clase] }, { cifra: { etiqueta: UNIDAD[mDur], valor: fmtMetrica(mDur)(valorDe(mDur, fila)) } }),
                      },
                    ]);
                  }}
                />
                <Grupos
                  className="xl:col-span-2"
                  a={a}
                  b={sinComparacionUtil ? null : b}
                  cmp={cmp}
                  onElegir={(g, el) => {
                    const fila = a.grupos[g - 1];
                    const nombre = g >= 4 ? "Grupos de 4 o más" : `Grupos de ${g} ${g === 1 ? "persona" : "personas"}`;
                    abrirMenu(el, nombre, [
                      {
                        etiqueta: `Ver ${entero(fila.operaciones)} operaciones`,
                        descripcion: "Abre el detalle; el dashboard no cambia",
                        icono: <List className="h-4 w-4" />,
                        onClick: () => abrirDetalle(nombre, { grupo: g }, { cifra: { etiqueta: "operaciones", valor: entero(fila.operaciones) } }),
                      },
                    ]);
                  }}
                />
              </div>

              <h2 className="pt-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Demanda registrada</h2>
              <Calor
                a={a}
                metrica={mCalor}
                setMetrica={setMCalor}
                momento={momento}
                setMomento={setMomento}
                filtros={f}
                onElegir={(d, h, el) => {
                  const r = (momento === "venta" ? a.calorVenta : a.calorSubida).find((c) => c.dia === d && c.hora === h);
                  const etq = `${DIAS_SEMANA[d]} ${horaRango(h)} (${momento === "venta" ? "venta" : "subida"})`;
                  abrirMenu(el, etq, [
                    {
                      etiqueta: `Filtrar por ${DIAS_CORTOS[d]} ${horaRango(h)}`,
                      descripcion: `Todo el dashboard pasa a contar ese día y franja de ${momento}`,
                      icono: <Filter className="h-4 w-4" />,
                      onClick: () => setFiltros((x) => ({ ...x, dias: [d], ...(momento === "venta" ? { horas: [h], horasSubida: undefined } : { horasSubida: [h], horas: undefined }) })),
                    },
                    {
                      etiqueta: `Ver ${entero(r?.operaciones ?? 0)} operaciones`,
                      descripcion: "Abre el detalle; el dashboard no cambia",
                      icono: <List className="h-4 w-4" />,
                      onClick: () => abrirDetalle(etq, { dias: [d], ...(momento === "venta" ? { horas: [h] } : { horasSubida: [h] }) }, { cifra: { etiqueta: UNIDAD[mCalor], valor: fmtMetrica(mCalor)(r ? valorDe(mCalor, r) : 0) } }),
                    },
                  ]);
                }}
              />
              <div className="grid gap-6 lg:grid-cols-2">
                <DiasSemana
                  a={a}
                  b={sinComparacionUtil ? null : b}
                  metrica={mDias}
                  setMetrica={setMDias}
                  onElegir={(d, el) => {
                    const fila = a.diasSemana[d];
                    abrirMenu(el, DIAS_SEMANA[d], [
                      {
                        etiqueta: f.dias?.includes(d) && f.dias.length === 1 ? `Quitar el filtro ${DIAS_SEMANA[d]}` : `Filtrar por ${DIAS_SEMANA[d]}`,
                        descripcion: "Todas las cifras pasan a contar solo ese día de la semana",
                        icono: <Filter className="h-4 w-4" />,
                        onClick: () => setFiltros((x) => ({ ...x, dias: x.dias?.length === 1 && x.dias[0] === d ? undefined : [d] })),
                      },
                      {
                        etiqueta: `Ver ${entero(fila.operaciones)} operaciones`,
                        descripcion: "Abre el detalle; el dashboard no cambia",
                        icono: <List className="h-4 w-4" />,
                        onClick: () => abrirDetalle(`Todos los ${DIAS_SEMANA[d]}`, { dias: [d] }, { cifra: { etiqueta: `${UNIDAD[mDias]} (total)`, valor: fmtMetrica(mDias)(valorDe(mDias, fila)) } }),
                      },
                    ]);
                  }}
                />
                <Franjas
                  a={a}
                  metrica={mDias}
                  onElegir={(h, el) => {
                    const fila = a.horasVenta.find((x) => x.hora === h)!;
                    abrirMenu(el, `Venta ${horaRango(h)}`, [
                      {
                        etiqueta: f.horas?.includes(h) ? `Quitar la franja ${horaRango(h)}` : `Filtrar por ${horaRango(h)}`,
                        descripcion: "Todas las cifras pasan a contar ventas de esa franja",
                        icono: <Filter className="h-4 w-4" />,
                        onClick: () => setFiltros((x) => ({ ...x, horas: alternar(x.horas, h) })),
                      },
                      {
                        etiqueta: `Ver ${entero(fila.operaciones)} operaciones`,
                        descripcion: "Abre el detalle; el dashboard no cambia",
                        icono: <List className="h-4 w-4" />,
                        onClick: () => abrirDetalle(`Ventas de ${horaRango(h)}`, { horas: [h] }, { cifra: { etiqueta: UNIDAD[mDias], valor: fmtMetrica(mDias)(valorDe(mDias, fila)) } }),
                      },
                    ]);
                  }}
                />
              </div>

              <h2 className="pt-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Operación</h2>
              <Operacion a={a} b={sinComparacionUtil ? null : b} cmp={cmp} abrirDetalle={abrirDetalle} abrirMenu={abrirMenu} />

              <Pagos
                a={a}
                onElegir={(metodo, el) => {
                  const fila = a.pagos.find((p) => p.metodo === metodo)!;
                  const nombre = metodo === "GRATIS" ? "Cortesía (sin cargo)" : metodo;
                  abrirMenu(el, nombre, [
                    {
                      etiqueta: `Ver ${entero(fila.operaciones)} operaciones`,
                      descripcion: "Incluye pagos mixtos que usaron este medio",
                      icono: <List className="h-4 w-4" />,
                      onClick: () => abrirDetalle(`Pagado con ${nombre.toLowerCase()}`, { medio: metodo }, { cifra: { etiqueta: "monto con este medio", valor: pesos(fila.monto) } }),
                    },
                  ]);
                }}
              />
            </>
          ) : null}

          <ImportacionesExcel onCambio={() => setRefresco((n) => n + 1)} />
          <NotaDatos />
        </div>
      )}

      {detalle ? <DetalleOperaciones key={JSON.stringify(detalle)} consulta={detalle} onCerrar={cerrarDetalle} /> : null}
    </div>
  );
}

// ── Panel de filtros (accesible sin usar los gráficos) ───────────────────────

function PanelFiltros({ filtros, setFiltros, horasDisponibles }: { filtros: Criterios; setFiltros: (c: (x: Criterios) => Criterios) => void; horasDisponibles: number[] }) {
  const horas = [...new Set([...horasDisponibles, ...(filtros.horas ?? [])])].sort((a, b) => a - b);
  const boton = (activo: boolean) =>
    cx("min-h-9 rounded-lg border px-2.5 text-xs font-semibold", activo ? "border-red-500/60 bg-red-500/15 text-white" : "border-white/10 text-white/65 hover:text-white", FOCO);
  return (
    <div id="stand-panel-filtros" className="mt-3 grid gap-4 rounded-2xl border border-white/10 bg-[#0c0c0c] p-4 md:grid-cols-2 xl:grid-cols-4">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-white/55">Tipo de operación</legend>
        <Segmentado
          etiqueta="Tipo de operación"
          chico
          opciones={[
            { valor: "todas", texto: "Todas" },
            { valor: "comerciales", texto: "Comerciales" },
            { valor: "cortesias", texto: "Cortesías" },
          ]}
          valor={filtros.tipo ?? "todas"}
          onChange={(v) => setFiltros((x) => ({ ...x, tipo: v === "todas" ? undefined : v }))}
        />
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-white/55">Duración comprada</legend>
        <div className="flex flex-wrap gap-1.5">
          {CLASES_DURACION.map((c) => (
            <button key={c} type="button" aria-pressed={Boolean(filtros.duraciones?.includes(c))} onClick={() => setFiltros((x) => ({ ...x, duraciones: alternar(x.duraciones, c as ClaseDuracion) }))} className={boton(Boolean(filtros.duraciones?.includes(c)))}>
              {ETIQUETA_DURACION[c]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-white/55">Día de la semana</legend>
        <div className="flex flex-wrap gap-1.5">
          {DIAS_CORTOS.map((d, i) => (
            <button key={d} type="button" aria-pressed={Boolean(filtros.dias?.includes(i))} onClick={() => setFiltros((x) => ({ ...x, dias: alternar(x.dias, i) }))} className={boton(Boolean(filtros.dias?.includes(i)))}>
              {d}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-white/55">Franja horaria (momento de venta)</legend>
        <div className="flex flex-wrap gap-1.5">
          {horas.length ? (
            horas.map((h) => (
              <button key={h} type="button" aria-pressed={Boolean(filtros.horas?.includes(h))} aria-label={`Venta ${horaRango(h)}`} onClick={() => setFiltros((x) => ({ ...x, horas: alternar(x.horas, h) }))} className={boton(Boolean(filtros.horas?.includes(h)))}>
                {String(h).padStart(2, "0")} h
              </button>
            ))
          ) : (
            <span className="text-xs text-white/45">Sin horarios en el período.</span>
          )}
        </div>
      </fieldset>
    </div>
  );
}

// ── Encabezado y estados ─────────────────────────────────────────────────────

function EncabezadoPeriodo({ datos }: { datos: Respuesta }) {
  const r = datos.actual.rango;
  const c = datos.anterior?.rango;
  const corte = c?.corteMinuto != null ? ` hasta las ${minutoTexto(c.corteMinuto)} del último día` : "";
  const sinDatosComp = datos.anterior && datos.anterior.totales.operaciones === 0;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-500">Stand · Nuevo Centro</p>
        <h2 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold text-white sm:text-3xl">
          {rangoTexto(r.desde, r.hasta)}
          {r.incompleto ? (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-200">
              En curso · hasta las {minutoTexto(datos.minuto)}
            </span>
          ) : null}
        </h2>
        <p className="mt-1 text-sm text-white/55">
          {c ? (
            <>
              Comparado con {rangoTexto(c.desde, c.hasta)}
              {corte}
              {r.incompleto && c.corteMinuto != null ? " (corte equivalente)" : ""}.
              {sinDatosComp ? ` Ese período no tiene operaciones registradas${datos.datosDesde ? ` (el primer registro es del ${fechaCorta(datos.datosDesde)})` : ""}: no hay comparación.` : ""}
            </>
          ) : (
            "Sin período de comparación."
          )}
        </p>
      </div>
    </div>
  );
}

function EsqueletoTablero() {
  return (
    <div className="mt-5 space-y-6" role="status" aria-label="Cargando métricas del Stand">
      <div className="grid gap-4 lg:grid-cols-12">
        <Esqueleto className="h-44 lg:col-span-4" />
        <div className="grid grid-cols-2 gap-4 lg:col-span-8">
          {[0, 1, 2, 3].map((i) => (
            <Esqueleto key={i} className="h-[84px]" />
          ))}
        </div>
      </div>
      <Esqueleto className="h-28" />
      <Esqueleto className="h-80" />
      <div className="grid gap-6 xl:grid-cols-5">
        <Esqueleto className="h-72 xl:col-span-3" />
        <Esqueleto className="h-72 xl:col-span-2" />
      </div>
    </div>
  );
}

// ── Resultado ────────────────────────────────────────────────────────────────

function ResumenComercial({
  a,
  b,
  cmp,
  sinComparacion,
  abrirDetalle,
}: {
  a: Resumen;
  b: Resumen | null;
  cmp: Comparacion | null;
  sinComparacion: boolean;
  abrirDetalle: (t: string, s: Criterios, o?: { cifra?: ConsultaDetalle["cifra"] }) => void;
}) {
  const t = a.totales;
  const c = sinComparacion ? null : cmp;
  const cob = a.cobertura;
  return (
    <section aria-labelledby="resultado-titulo">
      <h2 id="resultado-titulo" className="sr-only">
        Resultado comercial
      </h2>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Kpi
            destacado
            titulo="Facturación comercial"
            valor={pesos(t.facturacion)}
            delta={<Delta v={c?.facturacion} formatoAnterior={pesos} />}
            detalle={
              <>
                {entero(t.ventas)} ventas comerciales · ticket {pesos(t.ticketPromedio)}
                {c && c.efectoVentas != null && c.efectoTicket != null && c.facturacion.diferencia ? (
                  <span className="mt-1 block text-xs text-white/45">
                    Variación: {signo(c.efectoVentas)} por cantidad de ventas y {signo(c.efectoTicket)} por ticket.
                  </span>
                ) : null}
              </>
            }
            ayuda={
              <>
                Suma de los importes de las ventas comerciales (excluye cortesías). En el Turnero coincide al peso con la fuente “Turnero” de Finanzas. Es facturación, no rentabilidad: no descuenta costos.
                {b ? " La variación se descompone en cantidad de ventas × ticket anterior más ventas actuales × cambio de ticket; las dos partes suman exactamente la diferencia." : ""}
              </>
            }
            onDetalle={() => abrirDetalle("Ventas comerciales", { tipo: "comerciales" }, { cifra: { etiqueta: "Facturación comercial", valor: pesos(t.facturacion) } })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
          <Kpi
            titulo="Ventas comerciales"
            valor={entero(t.ventas)}
            delta={<Delta v={c?.ventas} formatoAnterior={entero} />}
            detalle={t.cortesias ? `+ ${entero(t.cortesias)} cortesías (${entero(t.personasCortesia)} personas), aparte` : "Sin cortesías en el período"}
            ayuda="Operaciones con cargo. Una operación puede incluir varias personas. Las cortesías (medio “gratis” o importe 0) se cuentan aparte."
            onDetalle={() => abrirDetalle("Ventas comerciales", { tipo: "comerciales" }, { cifra: { etiqueta: "Ventas comerciales", valor: entero(t.ventas) } })}
          />
          <Kpi
            titulo="Personas registradas"
            valor={entero(t.personas)}
            delta={<Delta v={c?.personas} formatoAnterior={entero} />}
            detalle={`${entero(t.personasConSubida)} con subida confirmada (${porcentaje(t.personas ? t.personasConSubida / t.personas : null)})`}
            ayuda={`Suma de personas de todas las operaciones (incluye cortesías). No son clientes únicos: quien vuelve cuenta otra vez. Subida confirmada: operaciones con hora de subida (${entero(cob.conHoraSubida)} de ${entero(cob.operaciones)}).`}
          />
          <Kpi
            titulo="Ticket promedio"
            valor={pesos(t.ticketPromedio)}
            delta={<Delta v={c?.ticketPromedio} formatoAnterior={pesos} />}
            detalle={`${decimal(t.personasPorOperacion, 2)} personas por operación`}
            ayuda="Facturación comercial ÷ ventas comerciales. Es por operación (grupo), no por persona."
          />
          <Kpi
            titulo="Ingreso por persona"
            valor={pesos(t.ingresoPorPersona)}
            delta={<Delta v={c?.ingresoPorPersona} formatoAnterior={pesos} />}
            detalle={t.ingresoPorMinuto != null ? `${pesos(t.ingresoPorMinuto)} por minuto vendido` : undefined}
            ayuda="Facturación comercial ÷ personas de las ventas comerciales (sin cortesías). Por minuto: facturación ÷ minutos-persona comprados de las ventas con duración conocida."
          />
        </div>
      </div>
    </section>
  );
}

function signo(n: number) {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${pesos(Math.abs(n))}`;
}

function Lectura({ lectura }: { lectura: Hallazgo[] }) {
  return (
    <Tarjeta
      titulo="Lectura del período"
      id="lectura"
      subtitulo="Cambios calculados con los datos registrados; no atribuyen causas."
      ayuda="Cada frase sale de los mismos cálculos que las tarjetas. Cuando hay comparación, la facturación se descompone en cantidad de ventas y ticket promedio; las duraciones, en puntos porcentuales de participación de personas."
    >
      <ul className="grid gap-3 md:grid-cols-2">
        {lectura.map((h) => (
          <li key={h.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <p className="text-sm font-semibold text-white">{h.titulo}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/65">{h.texto}</p>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

// ── Evolución ────────────────────────────────────────────────────────────────

function Evolucion({
  a,
  b,
  metrica,
  setMetrica,
  agrupacion,
  setAgrupacion,
  onElegir,
}: {
  a: Resumen;
  b: Resumen | null;
  metrica: Metrica;
  setMetrica: (m: Metrica) => void;
  agrupacion: Agrupacion;
  setAgrupacion: (g: Agrupacion) => void;
  onElegir: (c: Cubeta, modo: Exclude<Agrupacion, "auto">, el: HTMLElement) => void;
}) {
  const dias = a.serie.length;
  const modo: Exclude<Agrupacion, "auto"> = agrupacion !== "auto" ? agrupacion : dias <= 45 ? "dia" : dias <= 190 ? "semana" : "mes";
  const cubetas = useMemo(() => agrupar(a.serie, modo), [a.serie, modo]);
  const cubetasB = useMemo(() => (b ? agrupar(b.serie, modo) : null), [b, modo]);
  const puntos: PuntoEvolucion[] = cubetas.map((c, i) => {
    const e = etiquetasCubeta(c, modo);
    return { clave: c.clave, etiqueta: e.corta, etiquetaLarga: e.larga, valor: valorDe(metrica, c), incompleto: a.rango.incompleto && i === cubetas.length - 1 };
  });
  const comp = cubetasB ? cubetasB.map((c) => ({ etiquetaLarga: etiquetasCubeta(c, modo).larga, valor: valorDe(metrica, c) })) : null;
  const opcionesAgrup: Array<{ valor: Agrupacion; texto: string }> = [
    { valor: "auto", texto: "Auto" },
    { valor: "dia", texto: "Día" },
    { valor: "semana", texto: "Semana" },
    { valor: "mes", texto: "Mes" },
  ];
  return (
    <Tarjeta
      titulo="Evolución"
      id="evolucion"
      subtitulo={
        <>
          {mayuscula(UNIDAD[metrica])} por {modo === "dia" ? "día" : modo === "semana" ? "semana (lunes a domingo)" : "mes"}.{" "}
          {b ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block h-0.5 w-3 bg-[#d93030]" aria-hidden /> período actual
              <span className="ml-2 inline-block h-0.5 w-3 bg-[#9a9a94]" aria-hidden /> comparación (alineada por posición)
            </span>
          ) : null}
        </>
      }
      ayuda="Barras: el período elegido. Línea gris: el período de comparación, alineado por posición (1.er día contra 1.er día). La última barra de un período en curso se ve más clara. Tocá una barra para ver sus operaciones o ir a ese período."
      acciones={
        <>
          <Segmentado etiqueta="Métrica de la evolución" opciones={METRICAS} valor={metrica} onChange={setMetrica} chico />
          <Segmentado etiqueta="Agrupar por" opciones={opcionesAgrup} valor={agrupacion} onChange={setAgrupacion} chico />
        </>
      }
    >
      <GraficoEvolucion
        puntos={puntos}
        comparacion={comp}
        formatear={fmtMetrica(metrica)}
        formatearEje={fmtEje(metrica)}
        nombreMetrica={UNIDAD[metrica]}
        onElegir={(i, el) => onElegir(cubetas[i], modo, el)}
        tooltipExtra={(i) => (
          <p className="text-white/55">
            {entero(cubetas[i].operaciones)} operaciones · {entero(cubetas[i].personas)} personas{cubetas[i].cortesias ? ` · ${cubetas[i].cortesias} cortesías` : ""}
          </p>
        )}
      />
      <TablaAccesible
        titulo="Ver la evolución como tabla"
        columnas={["Período", "Facturación", "Ventas", "Personas", ...(comp ? ["Comparación"] : [])]}
        filas={cubetas.map((c, i) => [etiquetasCubeta(c, modo).larga, pesos(c.facturacion), entero(c.ventas), entero(c.personas), ...(comp ? [comp[i] ? fmtMetrica(metrica)(comp[i].valor) : "—"] : [])])}
      />
    </Tarjeta>
  );
}

function TablaAccesible({ titulo, columnas, filas }: { titulo: string; columnas: string[]; filas: string[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className={cx("inline-flex min-h-9 cursor-pointer items-center rounded-lg text-xs font-semibold text-white/55 hover:text-white", FOCO)}>{titulo}</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#141414] text-white/50">
            <tr>
              {columnas.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums text-white/80">
            {filas.map((f, i) => (
              <tr key={i} className="border-t border-white/[0.06]">
                {f.map((v, j) => (
                  <td key={j} className="px-3 py-1.5">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── Preferencias: duración y grupos ──────────────────────────────────────────

function Duraciones({
  a,
  b,
  cmp,
  metrica,
  setMetrica,
  filtradas,
  onElegir,
  className,
}: {
  a: Resumen;
  b: Resumen | null;
  cmp: Comparacion | null;
  metrica: Metrica;
  setMetrica: (m: Metrica) => void;
  filtradas?: ClaseDuracion[];
  onElegir: (c: ClaseDuracion, el: HTMLElement) => void;
  className?: string;
}) {
  const t = a.totales;
  const filas = a.duraciones.filter((d) => d.operaciones > 0 || (b?.duraciones.find((x) => x.clase === d.clase)?.operaciones ?? 0) > 0);
  const totalMetrica = valorDe(metrica, t);
  const barras: FilaBarra[] = filas.map((d) => {
    const ant = b?.duraciones.find((x) => x.clase === d.clase);
    const share = totalMetrica ? valorDe(metrica, d) / totalMetrica : 0;
    const pp = cmp?.participacionDuracion.find((x) => x.clase === d.clase);
    return {
      clave: d.clase,
      etiqueta: `${ETIQUETA_DURACION[d.clase]}${filtradas?.includes(d.clase) ? " · filtrando" : ""}`,
      valor: valorDe(metrica, d),
      texto: `${fmtMetrica(metrica)(valorDe(metrica, d))} · ${porcentaje(share)}`,
      secundario: `${entero(d.ventas)} ventas · ${entero(d.personas)} personas · ticket ${pesos(d.ticketPromedio)}${d.cortesias ? ` · ${d.cortesias} cortesías` : ""}`,
      color: RAMPA_DURACION[d.clase],
      comparacion: ant ? valorDe(metrica, ant) : null,
      tooltip: () => (
        <TipContenido
          titulo={ETIQUETA_DURACION[d.clase]}
          filas={[
            [UNIDAD[metrica], `${fmtMetrica(metrica)(valorDe(metrica, d))} (${porcentaje(share)})`],
            ["Personas", `${entero(d.personas)} (${porcentaje(d.participacionPersonas)})`],
            ["Ventas comerciales", entero(d.ventas)],
            ["Facturación", pesos(d.facturacion)],
            ["Ticket promedio", pesos(d.ticketPromedio)],
            ...(ant ? ([["Comparación", `${fmtMetrica(metrica)(valorDe(metrica, ant))}${pp ? ` · ${pp.puntos > 0 ? "+" : ""}${decimal(pp.puntos, 1)} p.p. de personas` : ""}`]] as Array<[string, string]>) : []),
          ]}
          nota={d.clase === "otra" ? "Duraciones fuera del catálogo (por ejemplo 25, 45 o 60 min por persona)." : d.clase === "sin_dato" ? "Operaciones sin duración registrada (Excel sin “Tiempo”)." : "Minutos por persona de la operación."}
        />
      ),
    };
  });
  const segmentos = filas
    .filter((d) => d.personas > 0)
    .map((d) => ({ clave: d.clase, etiqueta: ETIQUETA_DURACION[d.clase], valor: d.participacionPersonas, color: RAMPA_DURACION[d.clase], detalle: `${entero(d.personas)} personas de ${entero(t.personas)}` }));
  return (
    <Tarjeta
      className={className}
      titulo="Duración comprada"
      id="duraciones"
      subtitulo="Minutos por persona de cada operación. Marca gris: período de comparación."
      ayuda="Cada operación se clasifica por los minutos por persona que compró: 15/30 min hasta el 30/09/2026 y 10/20/30 min desde el 01/10/2026. “Otra duración” agrupa valores fuera del catálogo y “Sin dato” las operaciones sin duración. Una operación no registra duraciones mezcladas: si un grupo compró tiempos distintos, quedó cargado como operaciones separadas."
      acciones={<Segmentado etiqueta="Métrica de duración" opciones={METRICAS} valor={metrica} onChange={setMetrica} chico />}
    >
      <BarraParticipacion segmentos={segmentos} etiqueta="Participación de personas por duración" />
      {cmp?.modalidadesDistintas ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3 text-xs text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          El período de comparación usa otro catálogo de duraciones (15/30 min hasta el 30/09/2026; 10/20/30 min desde el 01/10/2026). Las barras no son comparables una a una.
        </p>
      ) : null}
      <div className="mt-4">
        <BarrasHorizontales filas={barras} etiqueta="Duraciones" onElegir={(fila, el) => onElegir(fila.clave as ClaseDuracion, el)} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm">
        <div>
          <dt className="text-xs text-white/50">Duración promedio por persona</dt>
          <dd className="mt-0.5 text-xl font-bold text-white">{minutos(t.duracionPromedioPersona)}</dd>
          <dd className="text-xs text-white/45">
            Ponderada por personas · {entero(t.personasConDuracion)} de {entero(t.personas)} con dato
            {cmp?.duracionPromedioPersona.anterior != null ? ` · antes ${minutos(cmp.duracionPromedioPersona.anterior)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-white/50">Minutos-persona vendidos</dt>
          <dd className="mt-0.5 text-xl font-bold text-white">{entero(t.minutosPersona)}</dd>
          <dd className="text-xs text-white/45">Σ minutos × personas (incluye cortesías)</dd>
        </div>
      </dl>
    </Tarjeta>
  );
}

function Grupos({ a, b, cmp, onElegir, className }: { a: Resumen; b: Resumen | null; cmp: Comparacion | null; onElegir: (g: number, el: HTMLElement) => void; className?: string }) {
  const t = a.totales;
  const barras: FilaBarra[] = a.grupos.map((g) => {
    const ant = b?.grupos[g.grupo - 1];
    const nombre = g.grupo >= 4 ? "4 o más personas" : `${g.grupo} ${g.grupo === 1 ? "persona" : "personas"}`;
    return {
      clave: String(g.grupo),
      etiqueta: nombre,
      valor: g.operaciones,
      texto: `${entero(g.operaciones)} · ${porcentaje(g.participacionOperaciones)}`,
      secundario: `${entero(g.personas)} personas · ${pesos(g.facturacion)}`,
      comparacion: ant ? ant.operaciones : null,
      tooltip: () => (
        <TipContenido
          titulo={`Operaciones de ${nombre}`}
          filas={[
            ["Operaciones", `${entero(g.operaciones)} (${porcentaje(g.participacionOperaciones)})`],
            ["Personas", entero(g.personas)],
            ["Facturación", pesos(g.facturacion)],
            ...(ant ? ([["Comparación", `${entero(ant.operaciones)} (${porcentaje(ant.participacionOperaciones)})`]] as Array<[string, string]>) : []),
          ]}
        />
      ),
      deshabilitado: g.operaciones === 0,
    };
  });
  return (
    <Tarjeta
      className={className}
      titulo="Tamaño de los grupos"
      id="grupos"
      subtitulo="Personas por operación. Marca gris: período de comparación."
      ayuda="Cuenta operaciones según cuántas personas incluyen. El promedio es Σ personas ÷ operaciones (incluye cortesías)."
    >
      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{decimal(t.personasPorOperacion, 2)}</span>
        <span className="text-sm text-white/55">personas por operación</span>
      </div>
      <Delta v={cmp?.personasPorOperacion} modo="absoluto" decimales={2} formatoAnterior={(n) => decimal(n, 2)} />
      <div className="mt-4">
        <BarrasHorizontales filas={barras} etiqueta="Tamaño de los grupos" onElegir={(f, el) => onElegir(Number(f.clave), el)} />
      </div>
    </Tarjeta>
  );
}

// ── Demanda: mapa de calor, días y franjas ───────────────────────────────────

function Calor({
  a,
  metrica,
  setMetrica,
  momento,
  setMomento,
  filtros,
  onElegir,
}: {
  a: Resumen;
  metrica: Metrica;
  setMetrica: (m: Metrica) => void;
  momento: "venta" | "subida";
  setMomento: (m: "venta" | "subida") => void;
  filtros: Criterios;
  onElegir: (d: number, h: number, el: HTMLElement) => void;
}) {
  const celdas = momento === "venta" ? a.calorVenta : a.calorSubida;
  const mapa = new Map(celdas.map((c) => [c.dia * 24 + c.hora, c]));
  const todas = [...a.calorVenta, ...a.calorSubida].map((c) => c.hora);
  const horas = todas.length ? Array.from({ length: Math.max(...todas) - Math.min(...todas) + 1 }, (_, i) => Math.min(...todas) + i) : [];
  const conHora = momento === "venta" ? a.cobertura.conHoraVenta : a.cobertura.conHoraSubida;
  return (
    <Tarjeta
      titulo="Actividad por día y hora"
      id="calor"
      subtitulo={`${mayuscula(UNIDAD[metrica])} en el período, por ${momento === "venta" ? "hora de la venta (toma del turno)" : "hora de subida al simulador"}. ${entero(conHora)} de ${entero(a.cobertura.operaciones)} operaciones tienen esa hora.`}
      ayuda="Total del período en cada día de la semana y franja de una hora. El momento de venta es la hora en que se tomó el turno; el de subida, cuando la persona subió al simulador. No es ocupación: no se registra la capacidad disponible ni el horario de apertura."
      acciones={
        <>
          <Segmentado
            etiqueta="Momento"
            chico
            opciones={[
              { valor: "venta", texto: "Venta" },
              { valor: "subida", texto: "Subida" },
            ]}
            valor={momento}
            onChange={setMomento}
          />
          <Segmentado etiqueta="Métrica del mapa" opciones={METRICAS} valor={metrica} onChange={setMetrica} chico />
        </>
      }
    >
      {horas.length ? (
        <MapaCalor
          dias={DIAS_CORTOS}
          horas={horas}
          etiqueta={`Mapa de calor de ${UNIDAD[metrica]} por día y hora de ${momento}`}
          valor={(d, h) => {
            const c = mapa.get(d * 24 + h);
            return c ? valorDe(metrica, c) : 0;
          }}
          formatear={metrica === "facturacion" ? (n) => pesosCorto(n).replace("$ ", "") : entero}
          seleccion={filtros.dias?.length && (momento === "venta" ? filtros.horas : filtros.horasSubida)?.length ? { dias: filtros.dias, horas: (momento === "venta" ? filtros.horas : filtros.horasSubida)! } : undefined}
          tooltip={(d, h) => {
            const c = mapa.get(d * 24 + h);
            const occ = a.diasSemana[d].ocurrencias;
            return (
              <TipContenido
                titulo={`${DIAS_SEMANA[d]} ${horaRango(h)} · ${momento}`}
                filas={[
                  ["Personas", entero(c?.personas ?? 0)],
                  ["Ventas comerciales", entero(c?.ventas ?? 0)],
                  ["Facturación", pesos(c?.facturacion ?? 0)],
                  ["Operaciones", entero(c?.operaciones ?? 0)],
                ]}
                nota={occ ? `Promedio por ${DIAS_SEMANA[d]}: ${decimal((c ? valorDe(metrica, c) : 0) / occ, metrica === "facturacion" ? 0 : 1)} ${metrica === "facturacion" ? "$" : UNIDAD[metrica]} (${occ} ${DIAS_SEMANA[d]} en el período).` : undefined}
              />
            );
          }}
          onElegir={onElegir}
        />
      ) : (
        <SinDatos titulo="Sin horarios registrados en el período" />
      )}
    </Tarjeta>
  );
}

function DiasSemana({ a, b, metrica, setMetrica, onElegir }: { a: Resumen; b: Resumen | null; metrica: Metrica; setMetrica: (m: Metrica) => void; onElegir: (d: number, el: HTMLElement) => void }) {
  const barras: FilaBarra[] = a.diasSemana.map((d) => {
    const prom = d.ocurrencias ? valorDe(metrica, d) / d.ocurrencias : 0;
    const ant = b?.diasSemana[d.dia];
    const promAnt = ant && ant.ocurrencias ? valorDe(metrica, ant) / ant.ocurrencias : null;
    return {
      clave: String(d.dia),
      etiqueta: DIAS_SEMANA[d.dia],
      valor: prom,
      texto: d.ocurrencias ? `${metrica === "facturacion" ? pesos(prom) : decimal(prom, 1)} por día` : "Sin días en el período",
      secundario: `${d.ocurrencias} ${d.ocurrencias === 1 ? "día" : "días"} en el período · total ${fmtMetrica(metrica)(valorDe(metrica, d))}`,
      comparacion: promAnt,
      tooltip: () => (
        <TipContenido
          titulo={`${DIAS_SEMANA[d.dia]} · promedio por día`}
          filas={[
            [UNIDAD[metrica], metrica === "facturacion" ? pesos(prom) : decimal(prom, 1)],
            ["Total del período", fmtMetrica(metrica)(valorDe(metrica, d))],
            [`${DIAS_SEMANA[d.dia]} en el período`, String(d.ocurrencias)],
            ...(promAnt != null ? ([["Comparación (promedio)", metrica === "facturacion" ? pesos(promAnt) : decimal(promAnt, 1)]] as Array<[string, string]>) : []),
          ]}
          nota="Promedio = total ÷ cantidad de ese día de la semana en el período, para comparar meses con distinta cantidad de sábados, lunes, etc. Un día sin registros cuenta igual (puede haber estado cerrado)."
        />
      ),
      deshabilitado: d.operaciones === 0,
    };
  });
  return (
    <Tarjeta
      titulo="Promedio por día de la semana"
      id="dias"
      subtitulo={`${mayuscula(UNIDAD[metrica])} por cada lunes, martes… del período. Marca gris: comparación.`}
      ayuda="Divide el total de cada día de la semana por cuántas veces aparece en el período: un mes con cinco sábados no parece mejor solo por tener un sábado más."
      acciones={<Segmentado etiqueta="Métrica por día" opciones={METRICAS} valor={metrica} onChange={setMetrica} chico />}
    >
      <BarrasHorizontales filas={barras} etiqueta="Días de la semana" onElegir={(f, el) => onElegir(Number(f.clave), el)} />
    </Tarjeta>
  );
}

function Franjas({ a, metrica, onElegir }: { a: Resumen; metrica: Metrica; onElegir: (h: number, el: HTMLElement) => void }) {
  const total = a.horasVenta.reduce((s, h) => s + valorDe(metrica, h), 0);
  const barras: FilaBarra[] = a.horasVenta.map((h) => ({
    clave: String(h.hora),
    etiqueta: horaRango(h.hora),
    valor: valorDe(metrica, h),
    texto: `${fmtMetrica(metrica)(valorDe(metrica, h))} · ${porcentaje(total ? valorDe(metrica, h) / total : 0)}`,
    tooltip: () => (
      <TipContenido
        titulo={`Ventas tomadas ${horaRango(h.hora)}`}
        filas={[
          ["Personas", entero(h.personas)],
          ["Ventas comerciales", entero(h.ventas)],
          ["Facturación", pesos(h.facturacion)],
        ]}
        nota={`Participación sobre las operaciones con hora de venta (${entero(a.cobertura.conHoraVenta)} de ${entero(a.cobertura.operaciones)}).`}
      />
    ),
  }));
  return (
    <Tarjeta titulo="Franjas horarias de venta" id="franjas" subtitulo={`${mayuscula(UNIDAD[metrica])} según la hora en que se tomó el turno.`} ayuda="Momento de venta (toma del turno). Para ver cuándo se usan los simuladores, cambiá el mapa de calor a “Subida”.">
      {barras.length ? <BarrasHorizontales filas={barras} etiqueta="Franjas horarias" onElegir={(f, el) => onElegir(Number(f.clave), el)} /> : <SinDatos titulo="Sin horarios de venta" />}
    </Tarjeta>
  );
}

// ── Operación ────────────────────────────────────────────────────────────────

function Operacion({
  a,
  b,
  cmp,
  abrirDetalle,
  abrirMenu,
}: {
  a: Resumen;
  b: Resumen | null;
  cmp: Comparacion | null;
  abrirDetalle: (t: string, s: Criterios, o?: { cifra?: ConsultaDetalle["cifra"] }) => void;
  abrirMenu: ReturnType<typeof useMenuAcciones>;
}) {
  const t = a.totales;
  const e = a.espera;
  const cob = a.cobertura;
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <Tarjeta
        className="xl:col-span-3"
        titulo="Espera entre la toma y la subida"
        id="espera"
        subtitulo={`Minutos desde que se tomó el turno hasta que la persona subió. Calculado sobre ${entero(e.validas)} de ${entero(cob.operaciones)} operaciones (${porcentaje(cob.operaciones ? e.validas / cob.operaciones : null)}).`}
        ayuda={`Subida − toma. Se excluyen ${entero(e.fueraDeRango)} operaciones con la subida antes de la toma o más de 4 h después, y ${entero(e.sinDato)} sin alguna de las dos horas. No se informa la duración realizada: el Turnero calcula la bajada sumando la duración comprada, no la mide.`}
      >
        <dl className="grid grid-cols-3 gap-3">
          <Cifra etiqueta="Mediana" valor={minutos(e.mediana)} detalle={cmp?.medianaEspera.anterior != null ? `antes ${minutos(cmp.medianaEspera.anterior)}` : "la mitad sube en este tiempo o menos"} />
          <Cifra etiqueta="Promedio" valor={minutos(e.promedio)} detalle={b?.espera.promedio != null ? `antes ${minutos(b.espera.promedio)}` : "influido por las esperas largas"} />
          <Cifra etiqueta="9 de cada 10" valor={e.p90 != null ? `≤ ${minutos(e.p90, 0)}` : "—"} detalle="percentil 90" />
        </dl>
        <div className="mt-5">
          <Histograma
            etiqueta="Operaciones por tramo de espera"
            barras={e.tramos.map((x) => ({
              clave: String(x.desde),
              etiqueta: x.hasta == null ? `≥ ${x.desde}` : `${x.desde}–${x.hasta}`,
              valor: x.operaciones,
              texto: entero(x.operaciones),
              tooltip: () => (
                <TipContenido
                  titulo={x.hasta == null ? `Espera de ${x.desde} min o más` : `Espera de ${x.desde} a ${x.hasta} min`}
                  filas={[
                    ["Operaciones", `${entero(x.operaciones)} (${porcentaje(e.validas ? x.operaciones / e.validas : null)})`],
                    ["Personas", entero(x.personas)],
                  ]}
                />
              ),
            }))}
            onElegir={(i, el) => {
              const x = e.tramos[i];
              const nombre = x.hasta == null ? `Espera de ${x.desde} min o más` : `Espera de ${x.desde} a ${x.hasta} min`;
              abrirMenu(el, nombre, [
                {
                  etiqueta: `Ver ${entero(x.operaciones)} operaciones`,
                  descripcion: "Abre el detalle; el dashboard no cambia",
                  icono: <List className="h-4 w-4" />,
                  onClick: () => abrirDetalle(nombre, { esperaMin: x.desde, ...(x.hasta != null ? { esperaMax: x.hasta } : {}) }, { cifra: { etiqueta: "operaciones", valor: entero(x.operaciones) } }),
                },
              ]);
            }}
          />
          <p className="mt-1 text-center text-xs text-white/40">Minutos de espera</p>
        </div>
        {e.conDemoraAnunciada.operaciones ? (
          <p className="mt-4 text-xs text-white/55">
            En {entero(e.conDemoraAnunciada.operaciones)} operaciones el personal cargó una hora estimada de subida (demora anunciada); su espera promedio fue {minutos(e.conDemoraAnunciada.promedioEspera)}.
          </p>
        ) : null}
      </Tarjeta>

      <div className="space-y-6 xl:col-span-2">
        <Tarjeta titulo="Subida confirmada" id="subida" ayuda="Operaciones con hora de subida registrada en el Turnero o en el Excel. Las que no la tienen pueden no haberse realizado o no haberse cargado.">
          <p className="text-3xl font-bold text-white">{entero(t.personasConSubida)}</p>
          <p className="text-sm text-white/55">
            personas de {entero(t.personas)} registradas ({porcentaje(t.personas ? t.personasConSubida / t.personas : null)}) · {entero(t.operacionesConSubida)} operaciones
          </p>
          <div className="mt-2">
            <Delta v={cmp?.personasConSubida} formatoAnterior={entero} />
          </div>
          {t.operacionesConSubida < t.operaciones ? (
            <button
              type="button"
              onClick={() => abrirDetalle("Operaciones sin subida registrada", { conSubida: false })}
              className={cx("mt-3 text-xs font-semibold text-red-300 hover:underline", FOCO)}
            >
              Ver las {entero(t.operaciones - t.operacionesConSubida)} sin subida
            </button>
          ) : null}
        </Tarjeta>
        <Tarjeta titulo="Mayores esperas" id="top-esperas" subtitulo="Las 10 operaciones con más minutos entre toma y subida.">
          {e.top.length ? (
            <ol className="space-y-1">
              {e.top.map((x, i) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => abrirDetalle(`Operación del ${fechaCorta(x.fecha)}`, { id: x.id })}
                    className={cx("flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-white/[0.04]", FOCO)}
                  >
                    <span className="w-5 text-xs font-bold text-red-400">{i + 1}</span>
                    <span className="flex-1 text-white/80">
                      {fechaCorta(x.fecha)} · toma {x.horaVenta} → subida {x.horaSubida}
                      <span className="block text-xs text-white/45">
                        {x.personas} {x.personas === 1 ? "persona" : "personas"}
                        {x.conDemoraAnunciada ? " · demora anunciada" : ""}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums text-white">{x.espera} min</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-white/55">Sin esperas medibles en el período.</p>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <dt className="text-xs text-white/50">{etiqueta}</dt>
      <dd className="mt-0.5 text-xl font-bold tabular-nums text-white sm:text-2xl">{valor}</dd>
      {detalle ? <dd className="text-[11px] leading-snug text-white/45">{detalle}</dd> : null}
    </div>
  );
}

// ── Medios de pago ───────────────────────────────────────────────────────────

function Pagos({ a, onElegir }: { a: Resumen; onElegir: (metodo: string, el: HTMLElement) => void }) {
  const barras: FilaBarra[] = a.pagos.map((p) => ({
    clave: p.metodo,
    etiqueta: p.metodo === "GRATIS" ? "Cortesía (sin cargo)" : p.metodo.charAt(0) + p.metodo.slice(1).toLowerCase(),
    valor: p.monto,
    texto: p.metodo === "GRATIS" ? `${entero(p.operaciones)} operaciones` : `${pesos(p.monto)} · ${porcentaje(p.participacion)}`,
    secundario: p.metodo === "GRATIS" ? undefined : `${entero(p.operaciones)} operaciones`,
    tooltip: () => (
      <TipContenido
        titulo={p.metodo === "GRATIS" ? "Cortesías" : p.metodo}
        filas={[
          ["Monto", pesos(p.monto)],
          ["Participación", porcentaje(p.participacion)],
          ["Operaciones", entero(p.operaciones)],
        ]}
        nota="Los pagos mixtos se reparten por medio según el detalle de pagos del Turnero (igual que en Finanzas)."
      />
    ),
  }));
  return (
    <Tarjeta titulo="Medios de pago" id="pagos" subtitulo="Monto cobrado por medio. Un pago mixto suma en cada medio que usó." ayuda="Usa el detalle de pagos de cada operación (pagos_detalle), la misma regla que Finanzas. La suma de todos los medios es la facturación comercial.">
      <BarrasHorizontales filas={barras} etiqueta="Medios de pago" onElegir={(f, el) => onElegir(f.clave, el)} />
    </Tarjeta>
  );
}

function NotaDatos() {
  return (
    <details className="rounded-2xl border border-white/10 bg-[#0e0e0e] p-4 text-sm text-white/60 sm:p-5">
      <summary className={cx("cursor-pointer font-semibold text-white/80", FOCO)}>Qué datos usa este tablero y qué no muestra</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5">
        <li>Fuentes: Turnero del stand (desde julio de 2026) y Excel históricos importados (octubre de 2025 a junio de 2026). No incluye reservas web, campeonatos ni el Colectivo.</li>
        <li>“Personas” es la suma de personas por operación: no hay identificación fiable para contar clientes únicos.</li>
        <li>No se muestra ocupación: no se registran la capacidad disponible ni los horarios de apertura del stand.</li>
        <li>No se muestra la duración realizada: el Turnero calcula la bajada sumando la duración comprada a la subida.</li>
        <li>La facturación es bruta: no descuenta comisiones ni costos. Para resultados netos, ver Finanzas.</li>
      </ul>
    </details>
  );
}
