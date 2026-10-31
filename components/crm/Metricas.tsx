"use client";

// CRM B4 · Métricas (solo Administración). Seis tarjetas y cuatro secciones; toda
// cifra abre su detalle, que es el MISMO conjunto de filas con el que se calcula
// (lib/crmB4.ts). Lectura: los registros vigentes hoy. Nada de esto escribe.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Aviso, Cargando, Etiqueta, Panel, Plegable, cx } from "@/app/admin/(panel)/interacciones/ui";
import { pedir } from "./api";
import { INPUT, fechaCorta, fechaHora } from "./campos";
import { formatoPesos } from "@/lib/crmB3";
import {
  DEFINICIONES, DIMENSIONES, PRESETS, PRESET_INICIAL, SEMANTICA_FILTROS, TEXTO_CLASE,
  type Definicion, type Detalle, type Dimension, type FilaJornada, type IdMetrica, type Preset, type ResultadoMetrica, type Tablero, type Valor,
} from "@/lib/crmB4";

const API = "/api/admin/crm/metricas";
const F_NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const F_PCT = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const TARJETAS: IdMetrica[] = ["negocios_visitados", "leads", "ventas", "importe_acordado", "cobrado", "comision_generada"];
const LECTURA: Record<Definicion["lectura"], string> = { periodo: "Del período", actual: "Lectura de hoy", cohorte: "Cohorte (resultados hasta hoy)" };

type Consulta = { preset: Preset; desde: string; hasta: string; comercial: string; zona: string; rubro: string; necesidad: string };
type Abierto = { id: string; extra?: Record<string, string> } | null;

export function textoValor(v: Valor): string {
  switch (v.tipo) {
    case "conteo": return F_NUM.format(v.n);
    case "dinero": return formatoPesos(v.c);
    case "km": return `${F_NUM.format(v.v)} km`;
    case "no_aplica": return "No aplica con este filtro";
    case "sin_datos": return "Sin datos";
    case "razon":
      if (v.v === null) return "Sin datos";
      return v.porcentaje ? F_PCT.format(v.v) : v.dinero ? formatoPesos(Math.round(v.v)) : F_NUM.format(Math.round(v.v * 100) / 100);
  }
}
const baseRazon = (v: Valor) => (v.tipo === "razon" ? `${v.dinero ? formatoPesos(v.num) : F_NUM.format(Math.round(v.num * 100) / 100)} ÷ ${F_NUM.format(v.den)}` : null);

export default function Metricas() {
  const [q, setQ] = useState<Consulta>({ preset: PRESET_INICIAL, desde: "", hasta: "", comercial: "", zona: "", rubro: "", necesidad: "" });
  const [d, setD] = useState<Tablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [verFiltros, setVerFiltros] = useState(false);
  const [abierto, setAbierto] = useState<Abierto>(null);
  const [dim, setDim] = useState<Dimension>("rubro");

  const params = useMemo(() => {
    const u = new URLSearchParams({ preset: q.preset });
    if (q.preset === "personalizado") { if (q.desde) u.set("desde", q.desde); if (q.hasta) u.set("hasta", q.hasta); }
    for (const k of ["comercial", "zona", "rubro", "necesidad"] as const) if (q[k]) u.set(k, q[k]);
    return u.toString();
  }, [q]);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      setCargando(true);
      pedir<Tablero>(`${API}?${params}`).then((r) => {
        if (!vivo) return;
        setCargando(false);
        if (r.ok) { setD(r.data); setError(null); } else setError(r.error);
      });
    }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [params]);

  const activos = (["comercial", "zona", "rubro", "necesidad"] as const).filter((k) => q[k]).length;
  const met = (id: IdMetrica) => d?.metricas[id];
  const abrir = (id: string, extra?: Record<string, string>) => setAbierto({ id, extra });

  return (
    <div className="space-y-6">
      <div>
        <h1 id="titulo-pagina" tabIndex={-1} className="text-3xl font-black outline-none">Métricas</h1>
        <p className="mt-1 text-sm text-white/60">Prospección, conversión, jornadas y resultados del CRM. Solo lectura: nada de acá cambia datos ni toca Finanzas.</p>
      </div>

      <section aria-label="Período y filtros" className="space-y-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.valor} type="button" role="radio" aria-checked={q.preset === p.valor} onClick={() => setQ({ ...q, preset: p.valor })}
              className={cx("min-h-11 rounded-xl px-3.5 text-sm font-bold", q.preset === p.valor ? "bg-white text-black" : "border border-white/15 text-white/80 hover:border-white/40")}>{p.texto}</button>
          ))}
        </div>
        {q.preset === "personalizado" ? (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Desde<input type="date" className={INPUT} value={q.desde} max={d?.hoy} onChange={(e) => setQ({ ...q, desde: e.target.value })} /></label>
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Hasta<input type="date" className={INPUT} value={q.hasta} max={d?.hoy} onChange={(e) => setQ({ ...q, hasta: e.target.value })} /></label>
          </div>
        ) : null}
        <Plegable titulo="Filtros" abierto={verFiltros} onAlternar={() => setVerFiltros((x) => !x)} resumen={activos ? `${activos} activo${activos > 1 ? "s" : ""}` : "ninguno"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Filtro etiqueta="Comercial" ayuda={SEMANTICA_FILTROS.comercial} valor={q.comercial} onCambio={(v) => setQ({ ...q, comercial: v })} opciones={d?.opciones.comerciales ?? []} />
            <Filtro etiqueta="Zona del negocio" ayuda={SEMANTICA_FILTROS.zona} valor={q.zona} onCambio={(v) => setQ({ ...q, zona: v })} opciones={d?.opciones.zonas ?? []} />
            <Filtro etiqueta="Rubro" ayuda={SEMANTICA_FILTROS.rubro} valor={q.rubro} onCambio={(v) => setQ({ ...q, rubro: v })} opciones={d?.opciones.rubros ?? []} />
            <Filtro etiqueta="Necesidad" ayuda={SEMANTICA_FILTROS.necesidad} valor={q.necesidad} onCambio={(v) => setQ({ ...q, necesidad: v })} opciones={d?.opciones.necesidades ?? []} />
          </div>
          {activos ? <button type="button" className="min-h-11 text-sm font-semibold text-white/70 underline" onClick={() => setQ({ ...q, comercial: "", zona: "", rubro: "", necesidad: "" })}>Quitar filtros</button> : null}
        </Plegable>
        {d ? (
          <p className="text-xs text-white/50">
            {fechaCorta(d.periodo.desde)} al {fechaCorta(d.periodo.hasta)} ({d.periodo.dias} días{d.periodo.incompleto ? ", en curso" : ""}) · consultado el {fechaHora(d.consultado_en)} (hoy en SIM: {fechaCorta(d.hoy)}).
            {" "}Se calcula con los registros vigentes hoy: una corrección o anulación posterior también cambia los meses anteriores. No es un cierre.
          </p>
        ) : null}
      </section>

      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!d ? <Cargando /> : (
        <div className={cx("space-y-8", cargando && "opacity-60")} aria-busy={cargando}>
          <section aria-label="Principales" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {TARJETAS.map((id) => <Tarjeta key={id} r={met(id)!} onAbrir={() => abrir(id)}
              sub={id === "leads" ? `${d.leads_desglose.nuevas} nuevos · ${d.leads_desglose.clientes} de clientes` : null} />)}
          </section>

          <Seccion titulo="Prospección y conversión">
            <Lista>
              {(["visitas", "negocios_visitados", "responsables", "decisores", "leads", "interesados", "recompras_admin"] as IdMetrica[]).map((id) =>
                <Fila key={id} r={met(id)!} onAbrir={() => abrir(id)} sub={id === "leads" ? `${d.leads_desglose.nuevas} nuevos · ${d.leads_desglose.clientes} de clientes que ya habían comprado` : null} />)}
            </Lista>
            <Aviso tipo="info" titulo="Actividad del período ≠ conversión">Visitas, leads, ventas y cobros de arriba cuentan cada hecho por su fecha: las ventas del período pueden venir de leads anteriores, así que no se dividen entre sí. Las tasas de abajo comparan siempre la misma población.</Aviso>
            <div className="space-y-3 rounded-2xl border border-white/10 p-4">
              <h3 className="font-black">Cohorte: leads originados en el período</h3>
              <p className="text-sm text-white/70">
                {d.cohorte.leads} lead{d.cohorte.leads === 1 ? "" : "s"} · resultados observados hasta {fechaCorta(d.cohorte.observado_hasta)}
                {d.cohorte.antiguedad ? ` · antigüedad: de ${d.cohorte.antiguedad.minima} a ${d.cohorte.antiguedad.maxima} días` : ""}
                {` · hoy: ${d.cohorte.abiertas} abiertas, ${d.cohorte.ganadas} ganadas, ${d.cohorte.perdidas} perdidas.`}
                {d.cohorte.abiertas ? " Con oportunidades abiertas la tasa todavía puede subir." : ""}
              </p>
              <Lista>
                <Fila r={met("cohorte_interesados")!} onAbrir={() => abrir("cohorte_interesados")} />
                <Fila r={met("cohorte_ventas")!} onAbrir={() => abrir("cohorte_ventas")} />
              </Lista>
              <Tabla columnas={["Tipo", "Leads", "Interesados", "Ventas", "Leads → ventas"]}
                filas={d.cohorte.por_clase.map((x) => [TEXTO_CLASE[x.clase] + (x.clase === "recompra_admin" ? " (fuera de la cohorte de calle)" : ""), x.leads, x.interesados, x.ventas,
                  x.leads ? `${F_PCT.format(x.ventas / x.leads)} (${x.ventas} ÷ ${x.leads})` : "Sin datos"])} />
            </div>
            <Lista>
              <Fila r={met("visitas_con_lead")!} onAbrir={() => abrir("visitas_con_lead")} />
              <Fila r={met("negocios_compradores")!} onAbrir={() => abrir("negocios_compradores")} />
            </Lista>
          </Seccion>

          <Seccion titulo="Jornadas y eficiencia">
            {d.filtro_negocio ? <Aviso tipo="alerta">Con filtros de zona, rubro o necesidad, las jornadas muestran solo sus visitas y leads de ese segmento; km, movilidad y eficiencia no aplican (no se reparten gastos entre negocios).</Aviso> : null}
            <Lista>
              {(["jornadas", "visitas_por_jornada", "km", "km_por_visita", "km_por_lead", "movilidad", "movilidad_por_visita", "movilidad_por_lead", "movilidad_por_venta",
                "ventas_por_jornada", "importe_por_jornada"] as IdMetrica[]).map((id) => <Fila key={id} r={met(id)!} onAbrir={() => abrir(id)} />)}
            </Lista>
            <div className="grid gap-3 sm:grid-cols-2">
              <Caja titulo="Ventas cerradas en el período" valor={textoValor(met("ventas")!.valor)}
                detalle={`Por fecha del acuerdo, de cualquier jornada. Sin jornada atribuible: ${d.sin_jornada.ventas} (${formatoPesos(d.sin_jornada.importe)}).`} onAbrir={() => abrir("ventas")} />
              <Caja titulo={DEFINICIONES.ventas_jornadas.nombre} valor={textoValor(met("ventas_jornadas")!.valor)}
                detalle={`Importe: ${formatoPesos(met("ventas_jornadas")!.extra.importe ?? 0)}. ${DEFINICIONES.ventas_jornadas.ayuda}`} onAbrir={() => abrir("ventas_jornadas")} />
            </div>
            <Jornadas filas={d.jornadas} onAbrir={(id) => abrir("jornada", { jornada: id })} />
          </Seccion>

          <Seccion titulo="Segmentos y motivos de pérdida">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Comparar por">
              {DIMENSIONES.map((x) => (
                <button key={x.valor} type="button" role="radio" aria-checked={dim === x.valor} onClick={() => setDim(x.valor)}
                  className={cx("min-h-11 rounded-xl border px-3 text-sm font-semibold", dim === x.valor ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/80")}>{x.texto}</button>
              ))}
            </div>
            <Segmento t={d.segmentos[dim]} onAbrir={(valor) => abrir("segmento", { dimension: dim, valor })} />
            <p className="text-xs text-white/50">Sobre los leads de calle del período. Muestran asociaciones, no causas: con pocos casos, una diferencia puede ser azar.</p>
            <div className="space-y-2 rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-black">Motivos de pérdida</h3>
                <button type="button" onClick={() => abrir("perdidas")} className="min-h-11 text-sm font-semibold underline">Ver episodios</button>
              </div>
              <p className="text-sm text-white/70">{d.perdidas.episodios} episodio{d.perdidas.episodios === 1 ? "" : "s"} en {d.perdidas.oportunidades} oportunidad{d.perdidas.oportunidades === 1 ? "" : "es"} distinta{d.perdidas.oportunidades === 1 ? "" : "s"} (por fecha de la pérdida){d.perdidas.reabiertas ? ` · ${d.perdidas.reabiertas} se reabrieron después` : ""}. Una reapertura no es un lead nuevo.</p>
              {d.perdidas.filas.length ? (
                <Tabla columnas={["Motivo", "Episodios", "Oportunidades"]} filas={d.perdidas.filas.map((x) => [x.texto, x.episodios, x.oportunidades])}
                  pie={["Total", d.perdidas.episodios, `${d.perdidas.oportunidades} distintas (no se suman: una puede perderse por motivos distintos)`]} />
              ) : <p className="text-sm text-white/60">Sin pérdidas en el período.</p>}
            </div>
          </Seccion>

          <Seccion titulo="Detalle de resultados económicos">
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/60">Flujos del período (cada hecho por su fecha)</h3>
            <Lista>
              {(["ventas", "importe_acordado", "experiencias", "cobrado", "comision_generada", "comision_pagada", "cobros_menos_comisiones"] as IdMetrica[]).map((id) =>
                <Fila key={id} r={met(id)!} onAbrir={() => abrir(id)} />)}
            </Lista>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/60">Estado de hoy de las ventas del período</h3>
            <Lista>
              {(["saldo_actual", "comision_prevista", "comision_a_pagar"] as IdMetrica[]).map((id) => <Fila key={id} r={met(id)!} onAbrir={() => abrir(id)} />)}
            </Lista>
            {d.productos.length ? (
              <Tabla columnas={["Producto", "Ventas", "Experiencias", "Importe acordado"]} filas={d.productos.map((p) => [p.nombre, p.ventas, p.experiencias, formatoPesos(p.importe)])}
                pie={["Total", d.productos.reduce((s, p) => s + p.ventas, 0), d.productos.reduce((s, p) => s + p.experiencias, 0), formatoPesos(d.productos.reduce((s, p) => s + p.importe, 0))]} />
            ) : null}
            <Aviso tipo="info">Importe acordado y cobrado según CRM no son facturación ni movimientos de Finanzas (que no se toca). La movilidad registrada no se descuenta de nada: todavía no está definido quién la paga.</Aviso>
          </Seccion>
        </div>
      )}

      {abierto ? <PanelDetalle params={params} abierto={abierto} onCerrar={() => setAbierto(null)} /> : null}
    </div>
  );
}

function Filtro({ etiqueta, ayuda, valor, onCambio, opciones }: { etiqueta: string; ayuda: string; valor: string; onCambio: (v: string) => void; opciones: Array<{ id: string; nombre: string }> }) {
  return (
    <label className="block space-y-1.5 text-sm font-semibold text-white/80">{etiqueta}
      <select className={INPUT} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Todos</option>
        {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </select>
      <span className="block text-xs font-normal text-white/50">{ayuda}</span>
    </label>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-4" aria-label={titulo}>
      <h2 className="border-b border-white/10 pb-2 text-xl font-black">{titulo}</h2>
      {children}
    </section>
  );
}

function Tarjeta({ r, sub, onAbrir }: { r: ResultadoMetrica; sub: string | null; onAbrir: () => void }) {
  const def = DEFINICIONES[r.id];
  return (
    <button type="button" onClick={onAbrir} className="flex min-h-32 flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
      <span className="text-xs font-bold uppercase tracking-wide text-white/60">{def.nombre}</span>
      <span className="mt-1 text-2xl font-black md:text-3xl">{textoValor(r.valor)}</span>
      {sub ? <span className="text-xs text-white/70">{sub}</span> : null}
      <span className="mt-1 text-xs text-white/50">{def.ayuda}</span>
      <span className="mt-2 text-xs font-semibold text-red-300">Ver detalle →</span>
    </button>
  );
}

function Lista({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">{children}</ul>;
}

function notaExtra(r: ResultadoMetrica): string | null {
  const e = r.extra;
  const partes: string[] = [];
  if (e.pendientes) partes.push(`${e.pendientes} jornada${e.pendientes === 1 ? "" : "s"} fuera por información pendiente`);
  if (e.parcial) partes.push(`ya cargado en ellas: ${formatoPesos(e.parcial)} (parcial, no se suma)`);
  if (e.oportunidades !== undefined) partes.push(`${e.oportunidades} oportunidad${e.oportunidades === 1 ? "" : "es"} distinta${e.oportunidades === 1 ? "" : "s"}`);
  if (r.valor.tipo === "no_aplica" || r.valor.tipo === "sin_datos") partes.push(r.valor.motivo);
  return partes.length ? partes.join(" · ") : null;
}

function Fila({ r, sub, onAbrir }: { r: ResultadoMetrica; sub?: string | null; onAbrir: () => void }) {
  const def = DEFINICIONES[r.id];
  const [ayuda, setAyuda] = useState(false);
  const base = baseRazon(r.valor);
  const nota = notaExtra(r);
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-semibold">{def.nombre}
          <button type="button" aria-expanded={ayuda} aria-label={`Qué cuenta «${def.nombre}»`} onClick={() => setAyuda((x) => !x)}
            className="inline-flex h-11 w-11 items-center justify-center text-white/50 hover:text-white"><Info className="h-4 w-4" aria-hidden /></button>
        </p>
        {ayuda ? <p className="text-xs text-white/70">{def.ayuda} <span className="text-white/50">({LECTURA[def.lectura]})</span></p> : null}
        {sub ? <p className="text-xs text-white/60">{sub}</p> : null}
        {nota ? <p className="text-xs text-amber-200/80">{nota}</p> : null}
      </div>
      <button type="button" onClick={onAbrir} className="min-h-11 text-right">
        <span className={cx("block text-lg font-black", (r.valor.tipo === "no_aplica" || r.valor.tipo === "sin_datos" || (r.valor.tipo === "razon" && r.valor.v === null)) && "text-base text-white/50")}>{textoValor(r.valor)}</span>
        {base ? <span className="block text-xs text-white/50">{base}</span> : null}
        <span className="block text-xs font-semibold text-red-300">Detalle →</span>
      </button>
    </li>
  );
}

function Caja({ titulo, valor, detalle, onAbrir }: { titulo: string; valor: string; detalle: string; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-white/30">
      <span className="block text-xs font-bold uppercase tracking-wide text-white/60">{titulo}</span>
      <span className="block text-2xl font-black">{valor}</span>
      <span className="block text-xs text-white/60">{detalle}</span>
    </button>
  );
}

function Tabla({ columnas, filas, pie }: { columnas: string[]; filas: Array<Array<ReactNode>>; pie?: Array<ReactNode> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[28rem] text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-white/50">{columnas.map((c, i) => <th key={c} className={cx("p-2", i > 0 && "text-right")}>{c}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i} className="border-t border-white/5">{f.map((c, j) => <td key={j} className={cx("p-2", j > 0 && "text-right")}>{c}</td>)}</tr>)}</tbody>
        {pie ? <tfoot><tr className="border-t border-white/20 font-bold">{pie.map((c, j) => <td key={j} className={cx("p-2", j > 0 && "text-right")}>{c}</td>)}</tr></tfoot> : null}
      </table>
    </div>
  );
}

function Jornadas({ filas, onAbrir }: { filas: FilaJornada[]; onAbrir: (id: string) => void }) {
  if (!filas.length) return <p className="text-sm text-white/60">Sin jornadas en el período.</p>;
  return (
    <div className="space-y-2">
      <h3 className="font-black">Por jornada</h3>
      <p className="text-xs text-white/50">Interesados = negocios con una visita de la jornada que anotó interés tibio o caliente. Ventas = las atribuidas a la jornada por la visita de origen de su oportunidad (o la visita de intervención de una recompra trabajada), cerradas hasta hoy. Zona = la de la jornada.</p>
      <ul className="space-y-2">
        {filas.map((j) => (
          <li key={j.id}>
            <button type="button" onClick={() => onAbrir(j.id)} className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left text-sm hover:border-white/30">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{fechaCorta(j.fecha)} · {j.comercial.nombre}</strong>{j.zona ? <span className="text-white/60">· {j.zona}</span> : null}
                {j.pendientes.map((p) => <Etiqueta key={p} tono="ambar">{p}</Etiqueta>)}
              </span>
              <span className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 text-white/80 sm:grid-cols-6">
                <Dato e="Visitas" v={j.visitas} /><Dato e="Negocios" v={j.negocios} /><Dato e="Responsables" v={j.responsables} />
                <Dato e="Decisores" v={j.decisores} /><Dato e="Leads" v={j.leads} /><Dato e="Interesados" v={j.interesados} />
                <Dato e="Ventas" v={j.ventas ? `${j.ventas} · ${formatoPesos(j.importe)}` : 0} />
                <Dato e="Km" v={j.km === null ? "—" : F_NUM.format(j.km)} /><Dato e="Movilidad" v={j.movilidad === null ? "—" : formatoPesos(j.movilidad)} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
const Dato = ({ e, v }: { e: string; v: ReactNode }) => <span><span className="block text-[11px] uppercase text-white/45">{e}</span><span className="font-semibold">{v}</span></span>;

function Segmento({ t, onAbrir }: { t: Tablero["segmentos"][Dimension]; onAbrir: (valor: string) => void }) {
  const max = Math.max(...t.filas.map((f) => (f.conversion.tipo === "razon" && f.conversion.v !== null ? f.conversion.v : 0)), 0.0001);
  return (
    <div className="space-y-2">
      <p className="text-xs text-white/60">{t.lectura}</p>
      {!t.sumable ? <Etiqueta tono="ambar">Filas superpuestas: no se suman; el total está deduplicado</Etiqueta> : null}
      {t.filas.length === 0 ? <p className="text-sm text-white/60">Sin leads en el período.</p> : (
        <ul className="space-y-2">
          {t.filas.map((f) => {
            const v = f.conversion.tipo === "razon" ? f.conversion.v : null;
            return (
              <li key={f.valor}>
                <button type="button" onClick={() => onAbrir(f.valor)} className="w-full rounded-xl border border-white/10 p-3 text-left text-sm hover:border-white/30">
                  <span className="flex flex-wrap justify-between gap-2"><strong>{f.texto}</strong>
                    <span className="text-white/70">{f.oportunidades} leads · {f.interesados} interesados · {f.ventas} ventas · {formatoPesos(f.importe)}</span></span>
                  <span className="mt-2 flex items-center gap-2">
                    <span className="h-2 flex-1 rounded-full bg-white/10" aria-hidden><span className="block h-2 rounded-full bg-red-500" style={{ width: `${v === null ? 0 : (v / max) * 100}%` }} /></span>
                    <span className="w-36 text-right text-xs">Leads → ventas: {textoValor(f.conversion)}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <li className="rounded-xl border border-white/20 p-3 text-sm font-bold">Total{!t.sumable ? " (deduplicado)" : ""}: {t.total.oportunidades} leads · {t.total.interesados} interesados · {t.total.ventas} ventas · {formatoPesos(t.total.importe)} · {textoValor(t.total.conversion)}</li>
        </ul>
      )}
    </div>
  );
}

function PanelDetalle({ params, abierto, onCerrar }: { params: string; abierto: NonNullable<Abierto>; onCerrar: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(50);
  useEffect(() => {
    let vivo = true;
    const u = new URLSearchParams(params);
    u.set("detalle", abierto.id);
    for (const [k, v] of Object.entries(abierto.extra ?? {})) u.set(k, v);
    pedir<Detalle>(`${API}?${u.toString()}`).then((r) => { if (vivo) { if (r.ok) setD(r.data); else setError(r.error); } });
    return () => { vivo = false; };
  }, [params, abierto]);
  const celda = (v: string | number | null, tipo: string) => (v === null ? "—" : tipo === "dinero" ? formatoPesos(v as number) : tipo === "fecha" ? fechaCorta(String(v)) : typeof v === "number" ? F_NUM.format(v) : v);
  return (
    <Panel titulo={d?.titulo ?? "Detalle"} onCerrar={onCerrar} ancho="max-w-4xl">
      {error ? <Aviso tipo="error">{error}</Aviso> : !d ? <Cargando /> : (
        <div className="space-y-4">
          {d.definicion ? (
            <dl className="grid gap-2 rounded-2xl border border-white/10 p-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-xs text-white/50">Qué cuenta</dt><dd>{d.definicion.ayuda}</dd></div>
              <div><dt className="text-xs text-white/50">Fuente</dt><dd>{d.definicion.fuente}</dd></div>
              <div><dt className="text-xs text-white/50">Fecha que usa</dt><dd>{d.definicion.fecha}</dd></div>
              <div><dt className="text-xs text-white/50">Unidad</dt><dd>{d.definicion.unidad}</dd></div>
              <div><dt className="text-xs text-white/50">Lectura</dt><dd>{LECTURA[d.definicion.lectura]}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-white/50">Fórmula</dt><dd>{d.definicion.formula}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-white/50">No cuenta</dt><dd>{d.definicion.exclusiones}</dd></div>
            </dl>
          ) : null}
          {d.nota ? <Aviso tipo="info">{d.nota}</Aviso> : null}
          <p className="text-sm text-white/70">{d.filas.length} fila{d.filas.length === 1 ? "" : "s"} · los totales son de todas las filas.</p>
          {d.filas.length === 0 ? <p className="text-sm text-white/60">Sin datos en el período.</p> : (
            <ul className="space-y-2">
              {d.filas.slice(0, mostrar).map((f) => (
                <li key={f.id} className="rounded-xl border border-white/10 p-3 text-sm">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                    {d.columnas.map((c, i) => c.soloTotal ? null : (
                      <div key={c.titulo} className="min-w-0"><dt className="text-[11px] uppercase text-white/45">{c.titulo}</dt><dd className="truncate font-semibold">{celda(f.celdas[i], c.tipo)}</dd></div>
                    ))}
                  </dl>
                  {f.href ? <Link href={f.href} className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold underline">Abrir</Link> : null}
                </li>
              ))}
            </ul>
          )}
          {d.filas.length > mostrar ? <button type="button" className="min-h-11 text-sm font-semibold underline" onClick={() => setMostrar((n) => n + 50)}>Mostrar 50 más</button> : null}
          {d.filas.length ? (
            <div className="rounded-xl border border-white/20 p-3 text-sm">
              <p className="font-bold">Totales</p>
              <p className="flex flex-wrap gap-x-4">{d.columnas.map((c, i) => (d.totales[i] === null ? null : <span key={c.titulo}>{c.titulo}: <strong>{celda(d.totales[i], c.tipo)}</strong></span>))}</p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
