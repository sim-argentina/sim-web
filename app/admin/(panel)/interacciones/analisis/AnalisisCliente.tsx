"use client";

// Análisis de Interacciones (Bloque 5, solo admin). Datos reales de
// /api/admin/interacciones/metricas; ninguna cifra de ejemplo ni hueco relleno.
// Mide visitas espontáneas REGISTRADAS: no hay fuente para el tránsito del
// pasillo y las reservas web no forman parte de este embudo.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { hoyEnSim } from "@/lib/agenda";
import { ETIQUETAS, INICIADORES, MOTIVOS, RANGOS_ETARIOS, RESPUESTAS, RESULTADOS } from "@/lib/interacciones";
import {
  CLAVES_FRANJA, FRANJAS, TAMANOS, rangoAnterior, rangoRapido, tasa,
  type ClaveRango, type Distribucion, type Filtros, type RespuestaMetricas, type Tasa,
} from "@/lib/interaccionesMetricas";
import { pedir } from "../cliente";
import { Aviso, Boton, Cargando, cx } from "../ui";
import { BarraTasa, Barras, COLORES, Dona, LineaDiaria, Seccion, Tarjeta, fmtBase, fmtN, fmtPct, fmtPp, fmtVar } from "./graficos";

type Rango = { desde: string; hasta: string };
type ModoComparar = "ninguno" | "anterior" | "otro";

const fecha = (f: string) => f.split("-").reverse().join("/");
const etiquetaFranja = (c: string) => (c === "otros" ? "Otros horarios" : FRANJAS.find((f) => f.clave === c)?.etiqueta ?? c);
const ETQ_FILTRO: Record<keyof Filtros, string> = {
  resultado: "Resultado", franja: "Franja", rango_etario: "Rango", conocia_sim: "Conocían SIM", se_subio_antes: "Ya se habían subido",
  iniciador: "Inició", motivo: "Motivo", atendio: "Atendió", tamano: "Tamaño del grupo",
};

export default function AnalisisCliente() {
  const hoy = hoyEnSim();
  const [rapido, setRapido] = useState<ClaveRango | "personalizado">("7d");
  const [personalizado, setPersonalizado] = useState<Rango>(rangoRapido("7d", hoy));
  const [modoComparar, setModoComparar] = useState<ModoComparar>("anterior");
  const [otro, setOtro] = useState<Rango>(rangoAnterior(rangoRapido("7d", hoy).desde, hoy));
  const [filtros, setFiltros] = useState<Filtros>({});
  const [verFiltros, setVerFiltros] = useState(false);
  const [datos, setDatos] = useState<RespuestaMetricas | null>(null);
  // Última respuesta y a qué consulta corresponde: "cargando" = la consulta
  // pedida todavía no tiene respuesta (no se marca a mano dentro del efecto).
  const [ultima, setUltima] = useState<{ clave: string; tipo: "ok" | "error" | "no_disponible"; error?: string } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [opcionesAtendio, setOpcionesAtendio] = useState<Array<{ id: string; nombre: string }>>([]);
  const seq = useRef(0);

  const rango: Rango = rapido === "personalizado" ? personalizado : rangoRapido(rapido, hoy);
  const comparar: Rango | null = modoComparar === "ninguno" ? null : modoComparar === "anterior" ? rangoAnterior(rango.desde, rango.hasta) : otro;
  const rangoValido = rango.desde <= rango.hasta && (!comparar || comparar.desde <= comparar.hasta);
  const q = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
  if (comparar) {
    q.set("comp_desde", comparar.desde);
    q.set("comp_hasta", comparar.hasta);
  }
  for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, String(v));
  const consulta = q.toString();
  const clave = `${consulta}#${recarga}`;
  const conAtendio = Boolean(filtros.atendio);

  useEffect(() => {
    if (!rangoValido) return;
    // Cada consulta lleva su número: si una vieja llega tarde, la más nueva ya manda.
    const mio = ++seq.current;
    const ctrl = new AbortController();
    void (async () => {
      const r = await pedir<RespuestaMetricas>(`/api/admin/interacciones/metricas?${consulta}`, {}, ctrl.signal);
      if (mio !== seq.current || (!r.ok && r.codigo === "cancelado")) return;
      if (r.ok) {
        setDatos(r.data);
        setUltima({ clave, tipo: "ok" });
        if (!conAtendio) {
          setOpcionesAtendio(r.data.actual.metricas.atendio.filter((a) => a.empleado_id).map((a) => ({ id: a.empleado_id!, nombre: `${a.nombre}${a.activo ? "" : " (inactivo)"}` })));
        }
      } else if (r.codigo === "modulo_no_instalado" || r.codigo === "modulo_no_habilitado") {
        setUltima({ clave, tipo: "no_disponible" });
      } else {
        setUltima({ clave, tipo: "error", error: r.error });
      }
    })();
    return () => ctrl.abort();
  }, [consulta, clave, rangoValido, conAtendio]);

  const estado: "cargando" | "listo" | "error" | "no_disponible" =
    !ultima || ultima.clave !== clave ? "cargando" : ultima.tipo === "ok" ? "listo" : ultima.tipo;
  const error = ultima?.error ?? null;

  const filtro = <K extends keyof Filtros>(k: K, v: Filtros[K] | "") =>
    setFiltros((f) => {
      const n = { ...f };
      if (v === "" || v === undefined) delete n[k];
      else n[k] = v as Filtros[K];
      return n;
    });
  const hayFiltros = Object.keys(filtros).length > 0;
  const a = datos?.actual;
  const m = a?.metricas;
  const cargando = estado === "cargando";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 className="text-3xl font-black uppercase md:text-5xl">Análisis de interacciones</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/60">
              Visitas espontáneas registradas en el stand. No incluye reservas web ni el tránsito del pasillo (no hay una fuente para medirlo).
            </p>
          </div>
          <Link href="/admin/interacciones" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-black uppercase text-white/80 hover:border-white hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Interacciones
          </Link>
        </div>

        {/* ── Período, comparación y filtros ── */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="Período" className="flex flex-wrap gap-1 rounded-xl border border-white/15 p-1">
              {([["hoy", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["personalizado", "Personalizado"]] as const).map(([k, t]) => (
                <button key={k} type="button" aria-pressed={rapido === k} onClick={() => setRapido(k)}
                  className={cx("min-h-11 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400",
                    rapido === k ? "bg-red-600 text-white" : "text-white/70 hover:text-white")}>{t}</button>
              ))}
            </div>
            {rapido === "personalizado" ? (
              <RangoFechas valor={personalizado} max={hoy} onCambio={setPersonalizado} etiqueta="Período" />
            ) : null}
            <label className="flex flex-col gap-1 text-xs text-white/60">
              Comparar con
              <select value={modoComparar} onChange={(e) => setModoComparar(e.target.value as ModoComparar)}
                className="min-h-11 rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-white outline-none focus:border-red-500">
                <option value="ninguno">Sin comparar</option>
                <option value="anterior">Período anterior</option>
                <option value="otro">Otro rango</option>
              </select>
            </label>
            {modoComparar === "otro" ? <RangoFechas valor={otro} max={hoy} onCambio={setOtro} etiqueta="Comparar" /> : null}
            <Boton onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros}>Filtros{hayFiltros ? ` (${Object.keys(filtros).length})` : ""}</Boton>
            <Boton variante="fantasma" onClick={() => setRecarga((n) => n + 1)} aria-label="Actualizar"><RefreshCw className="h-4 w-4" aria-hidden /></Boton>
          </div>

          {verFiltros ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Selector etiqueta="Resultado" valor={filtros.resultado} onCambio={(v) => filtro("resultado", v as Filtros["resultado"])}
                opciones={RESULTADOS.map((r) => [r, ETIQUETAS.resultado[r]])} />
              <Selector etiqueta="Franja horaria" valor={filtros.franja} onCambio={(v) => filtro("franja", v as Filtros["franja"])}
                opciones={CLAVES_FRANJA.map((c) => [c, etiquetaFranja(c)])} />
              <Selector etiqueta="Rango aproximado" valor={filtros.rango_etario} onCambio={(v) => filtro("rango_etario", v as Filtros["rango_etario"])}
                opciones={[...RANGOS_ETARIOS.map((r) => [r, ETIQUETAS.rango_etario[r]] as [string, string]), ["sin_dato", "Sin dato"]]} />
              <Selector etiqueta="Tamaño del grupo" valor={filtros.tamano} onCambio={(v) => filtro("tamano", v as Filtros["tamano"])}
                opciones={TAMANOS.map((t) => [t, t === "5+" ? "5 o más" : `${t}`])} />
              <Selector etiqueta="¿Conocían SIM?" valor={filtros.conocia_sim} onCambio={(v) => filtro("conocia_sim", v as Filtros["conocia_sim"])}
                opciones={[...RESPUESTAS.map((r) => [r, ETIQUETAS.respuesta[r]] as [string, string]), ["sin_dato", "Sin dato"]]} />
              <Selector etiqueta="¿Ya se habían subido?" valor={filtros.se_subio_antes} onCambio={(v) => filtro("se_subio_antes", v as Filtros["se_subio_antes"])}
                opciones={[...RESPUESTAS.map((r) => [r, ETIQUETAS.respuesta[r]] as [string, string]), ["sin_dato", "Sin dato"]]} />
              <Selector etiqueta="Inició" valor={filtros.iniciador} onCambio={(v) => filtro("iniciador", v as Filtros["iniciador"])}
                opciones={[...INICIADORES.map((r) => [r, ETIQUETAS.iniciador[r]] as [string, string]), ["sin_dato", "Sin dato"]]} />
              <Selector etiqueta="Motivo" valor={filtros.motivo} onCambio={(v) => filtro("motivo", v as Filtros["motivo"])}
                opciones={[...MOTIVOS.map((r) => [r, ETIQUETAS.motivo[r]] as [string, string]), ["sin_motivo", "Sin motivo"]]} />
              <Selector etiqueta="Atendió (declarado)" valor={filtros.atendio} onCambio={(v) => filtro("atendio", v)}
                opciones={[...opcionesAtendio.map((o) => [o.id, o.nombre] as [string, string]), ["sin_asignar", "Sin asignar"]]} />
              {hayFiltros ? <div className="flex items-end"><Boton variante="fantasma" onClick={() => setFiltros({})}>Limpiar filtros</Boton></div> : null}
            </div>
          ) : null}

          <div className="mt-3 space-y-1 text-xs text-white/60" aria-live="polite">
            <p>Período: <strong className="text-white">{fecha(rango.desde)} al {fecha(rango.hasta)}</strong> (inclusive, hora de Córdoba)
              {comparar ? <> · comparado con <strong className="text-white">{fecha(comparar.desde)} al {fecha(comparar.hasta)}</strong></> : null}</p>
            {hayFiltros ? (
              <p>Filtros: {Object.entries(filtros).map(([k, v]) => `${ETQ_FILTRO[k as keyof Filtros]}: ${textoFiltro(k as keyof Filtros, String(v), opcionesAtendio)}`).join(" · ")}. Se aplican a los dos períodos; la cobertura general no cambia con ellos.</p>
            ) : null}
            {!rangoValido ? <p className="text-amber-200">La fecha inicial tiene que ser anterior o igual a la final.</p> : null}
          </div>
        </div>

        {/* ── Estados ── */}
        {estado === "no_disponible" ? (
          <Aviso tipo="alerta" titulo="El análisis todavía no está disponible">La carga de Interacciones todavía no está habilitada, así que no hay registros para analizar.</Aviso>
        ) : estado === "error" ? (
          <Aviso tipo="error" titulo="No pudimos calcular el análisis" acciones={<Boton onClick={() => setRecarga((n) => n + 1)}>Reintentar</Boton>}>{error}</Aviso>
        ) : !datos || !a || !m ? (
          <Cargando texto="Calculando el análisis…" />
        ) : (
          <div className={cx("space-y-5", cargando && "opacity-60")} aria-busy={cargando}>
            <EstadoPeriodo datos={datos} hayFiltros={hayFiltros} />
            {a.periodo.cubierto && m.embudo.interacciones > 0 ? <Tablero datos={datos} /> : null}
          </div>
        )}
      </section>
    </main>
  );
}

function textoFiltro(k: keyof Filtros, v: string, atendio: Array<{ id: string; nombre: string }>): string {
  if (v === "sin_dato") return "Sin dato";
  if (v === "sin_motivo") return "Sin motivo";
  if (v === "sin_asignar") return "Sin asignar";
  if (k === "resultado") return ETIQUETAS.resultado[v as keyof typeof ETIQUETAS.resultado];
  if (k === "franja") return etiquetaFranja(v);
  if (k === "rango_etario") return ETIQUETAS.rango_etario[v as keyof typeof ETIQUETAS.rango_etario];
  if (k === "conocia_sim" || k === "se_subio_antes") return ETIQUETAS.respuesta[v as keyof typeof ETIQUETAS.respuesta];
  if (k === "iniciador") return ETIQUETAS.iniciador[v as keyof typeof ETIQUETAS.iniciador];
  if (k === "motivo") return ETIQUETAS.motivo[v as keyof typeof ETIQUETAS.motivo];
  if (k === "atendio") return atendio.find((a) => a.id === v)?.nombre ?? "Integrante";
  return v;
}

function RangoFechas({ valor, onCambio, max, etiqueta }: { valor: Rango; onCambio: (r: Rango) => void; max: string; etiqueta: string }) {
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-white/60">{etiqueta}: desde
        <input type="date" value={valor.desde} max={max} onChange={(e) => e.target.value && onCambio({ ...valor, desde: e.target.value })}
          className="min-h-11 rounded-xl border border-white/15 bg-black/40 px-2 text-sm text-white outline-none [color-scheme:dark] focus:border-red-500" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-white/60">hasta
        <input type="date" value={valor.hasta} max={max} onChange={(e) => e.target.value && onCambio({ ...valor, hasta: e.target.value })}
          className="min-h-11 rounded-xl border border-white/15 bg-black/40 px-2 text-sm text-white outline-none [color-scheme:dark] focus:border-red-500" />
      </label>
    </div>
  );
}

function Selector({ etiqueta, valor, opciones, onCambio }: { etiqueta: string; valor: string | undefined; opciones: Array<[string, string]>; onCambio: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/60">{etiqueta}
      <select value={valor ?? ""} onChange={(e) => onCambio(e.target.value)}
        className="min-h-11 rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-white outline-none focus:border-red-500">
        <option value="">Todos</option>
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

function EstadoPeriodo({ datos, hayFiltros }: { datos: RespuestaMetricas; hayFiltros: boolean }) {
  const a = datos.actual;
  const c = datos.comparacion;
  const inicio = datos.modulo.inicio_registro ? new Date(datos.modulo.inicio_registro).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Cordoba" }) : null;
  const avisos: React.ReactNode[] = [];
  if (!datos.modulo.habilitado) avisos.push(<Aviso key="h" tipo="alerta" titulo="El registro todavía no empezó">No hay datos de registro: el módulo no tiene fecha de inicio.</Aviso>);
  else if (a.periodo.estado === "sin_registro") avisos.push(<Aviso key="s" tipo="alerta" titulo="Sin datos de registro">El período es anterior al inicio del registro ({inicio}). No se reconstruyen visitas con ventas.</Aviso>);
  else if (a.periodo.estado === "parcial" && a.periodo.cubierto) avisos.push(
    <Aviso key="p" tipo="info" titulo="Período parcial">Con registro del {fecha(a.periodo.cubierto.desde)} al {fecha(a.periodo.cubierto.hasta)} ({a.periodo.cubierto.dias} de {a.periodo.dias} días). El registro empezó el {inicio}.</Aviso>);
  if (a.periodo.cubierto && a.metricas.embudo.interacciones === 0) avisos.push(
    <Aviso key="v" tipo="info" titulo={hayFiltros ? "Ninguna interacción con estos filtros" : "Sin interacciones registradas"}>
      {hayFiltros ? "Probá quitar filtros." : "Días sin cargas son días sin interacciones registradas, no prueba de que no hubo público."}
    </Aviso>);
  if (c) {
    if (c.periodo.estado === "sin_registro" || c.periodo.estado === "sin_inicio") avisos.push(<Aviso key="c" tipo="info">El período de comparación es anterior al inicio del registro: las variaciones figuran como “Sin base” o “Sin datos”.</Aviso>);
    else if (c.deltas && !c.deltas.mismos_dias) avisos.push(
      <Aviso key="d" tipo="alerta">Los períodos cubren distinta cantidad de días ({a.periodo.cubierto?.dias ?? 0} frente a {c.periodo.cubierto?.dias ?? 0}): las cantidades no son directamente comparables; mirá las tasas.</Aviso>);
  }
  const carga = [a.carga.interacciones, a.carga.turnos, c?.carga.interacciones, c?.carga.turnos].filter(Boolean);
  if (carga.some((x) => x && !x.consistente)) avisos.push(<Aviso key="k" tipo="alerta">Hubo cargas mientras se calculaba: actualizá para ver números consistentes.</Aviso>);
  return avisos.length ? <div className="space-y-3">{avisos}</div> : null;
}

function Delta({ v, tipo }: { v: { diferencia?: number; variacion?: number | null; diferencia_pp?: number | null } | undefined; tipo: "cantidad" | "tasa" }) {
  if (!v) return null;
  if (tipo === "tasa") return <span>vs. comparación: {fmtPp(v.diferencia_pp ?? null)}</span>;
  return <span>vs. comparación: {v.diferencia !== undefined && v.diferencia > 0 ? "+" : ""}{fmtN(v.diferencia ?? 0)} ({fmtVar(v.variacion ?? null)})</span>;
}

function Tablero({ datos }: { datos: RespuestaMetricas }) {
  const a = datos.actual;
  const m = a.metricas;
  const e = m.embudo;
  const d = datos.comparacion?.deltas;
  const v = m.vinculo;
  const cob = a.cobertura;
  const serie = m.serie.map((s) => ({ ...s }));
  return (
    <>
      {/* 1. Tarjetas */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tarjeta titulo="Interacciones" valor={fmtN(e.interacciones)} detalle="Visitas o grupos registrados" delta={<Delta v={d?.interacciones} tipo="cantidad" />} />
        <Tarjeta titulo="Personas observadas" valor={fmtN(e.personas)} detalle={`En esos grupos · ${e.tamano_promedio === null ? "sin promedio" : `${e.tamano_promedio.toLocaleString("es-AR", { maximumFractionDigits: 1 })} personas por grupo`}`} delta={<Delta v={d?.personas} tipo="cantidad" />} />
        <Tarjeta titulo="Preguntaron" valor={fmtN(e.preguntaron)} detalle={`${fmtPct(e.tasas.miro_pregunto)} de las que miraron`} delta={<Delta v={d?.preguntaron} tipo="cantidad" />} />
        <Tarjeta titulo="Se subieron" valor={fmtN(e.subieron)} detalle={`${fmtPct(e.tasas.pregunto_subio)} de las que preguntaron`} delta={<Delta v={d?.subieron} tipo="cantidad" />} />
        <Tarjeta tono="rojo" titulo="Miró → Se subió" valor={fmtPct(e.tasas.miro_subio)} detalle={e.tasas.miro_subio.den ? `${fmtBase(e.tasas.miro_subio)} interacciones` : "Sin denominador"} delta={<Delta v={d?.miro_subio} tipo="tasa" />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 2. Embudo acumulativo */}
        <Seccion titulo="Embudo acumulativo" descripcion="Por interacción: quien se subió también miró y preguntó. Las tasas indican su base.">
          <div className="space-y-4">
            {([["Miraron", e.miraron, COLORES.miraron], ["Preguntaron", e.preguntaron, COLORES.preguntaron], ["Se subieron", e.subieron, COLORES.subieron]] as const).map(([t, n, color]) => (
              <div key={t}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-white/80">{t}</span><span className="font-semibold tabular-nums">{fmtN(n)}</span></div>
                <div className="h-6 overflow-hidden rounded-lg bg-white/10" aria-hidden><div className="h-full rounded-lg" style={{ width: `${e.miraron ? (n / e.miraron) * 100 : 0}%`, backgroundColor: color }} /></div>
              </div>
            ))}
            <div className="grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-3">
              <BarraTasa etiqueta="Miró → Preguntó" tasa={e.tasas.miro_pregunto} color={COLORES.preguntaron} />
              <BarraTasa etiqueta="Preguntó → Se subió" tasa={e.tasas.pregunto_subio} color={COLORES.subieron} />
              <BarraTasa etiqueta="Miró → Se subió" tasa={e.tasas.miro_subio} color={COLORES.subieron} />
            </div>
            {d ? (
              <p className="text-xs text-white/55">Vs. comparación: Miró → Preguntó {fmtPp(d.miro_pregunto.diferencia_pp)} · Preguntó → Se subió {fmtPp(d.pregunto_subio.diferencia_pp)} · Miró → Se subió {fmtPp(d.miro_subio.diferencia_pp)}</p>
            ) : null}
          </div>
        </Seccion>

        {/* 6. Distribución exclusiva */}
        <Seccion titulo="Distribución del resultado" descripcion="Exclusiva: cada interacción cuenta una sola vez, por su resultado máximo.">
          <Dona centro={fmtN(e.interacciones)} subtitulo="interacciones"
            partes={RESULTADOS.map((r) => ({ etiqueta: r === "pregunto" ? "Preguntaron (no se subieron)" : r === "miro" ? "Solo miraron" : "Se subieron", n: e.exclusivos[r], color: r === "miro" ? COLORES.miraron : r === "pregunto" ? COLORES.preguntaron : COLORES.subieron }))} />
        </Seccion>
      </div>

      {/* 3. Evolución diaria */}
      <Seccion titulo="Evolución diaria" descripcion={`Por fecha de la interacción (Córdoba). ${a.periodo.cubierto ? `${a.periodo.cubierto.dias} días con registro.` : ""} Un día en cero es un día sin cargas, no prueba de ausencia de público.`}>
        <LineaDiaria puntos={serie} series={[
          { clave: "miraron", etiqueta: "Miraron", color: COLORES.miraron },
          { clave: "preguntaron", etiqueta: "Preguntaron", color: COLORES.preguntaron },
          { clave: "subieron", etiqueta: "Se subieron", color: COLORES.subieron },
        ]} />
      </Seccion>

      {/* 4. Día y franja */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Seccion titulo="Conversión por día de la semana" descripcion="Tasas dentro de cada día; n = interacciones de ese día.">
          <TablaTasas filas={m.dias_semana.map((x) => ({ etiqueta: x.etiqueta, embudo: x.embudo }))} />
        </Seccion>
        <Seccion titulo="Conversión por franja horaria" descripcion="Franjas [desde, hasta): las 12:00 son de 12–14. Lo que cae fuera de 10–22 va a “Otros horarios”.">
          <TablaTasas filas={m.franjas.map((x) => ({ etiqueta: x.etiqueta, embudo: x.embudo }))} />
        </Seccion>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 7. Motivos */}
        <Seccion titulo="Motivos de no compra"
          descripcion={`Base: ${fmtN(m.motivos.base)} que preguntaron y no se subieron · con motivo ${fmtN(m.motivos.con_motivo)} (${fmtPct(m.motivos.cobertura)}) · sin motivo ${fmtN(m.motivos.sin_motivo)}. % sobre las que tienen motivo.`}>
          <Barras filas={m.motivos.valores.filter((x) => x.n > 0).sort((p, q) => q.n - p.n).map((x) => ({ etiqueta: ETIQUETAS.motivo[x.motivo], n: x.n, detalle: fmtPct(x.pct) }))}
            vacio="Ninguna consulta tiene motivo cargado en este período." />
          {m.motivos.solo_miro.con_motivo > 0 ? (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="mb-2 text-xs text-white/55">Aparte: motivos cargados en “Solo miró” ({fmtN(m.motivos.solo_miro.con_motivo)} de {fmtN(m.motivos.solo_miro.base)}). No se suman a los anteriores.</p>
              <Barras filas={m.motivos.solo_miro.valores.filter((x) => x.n > 0).map((x) => ({ etiqueta: ETIQUETAS.motivo[x.motivo], n: x.n, detalle: fmtPct(x.pct), color: COLORES.miraron }))} />
            </div>
          ) : null}
        </Seccion>

        {/* 8. Perfil */}
        <Seccion titulo="Perfil aproximado de los grupos" descripcion="Datos opcionales y aproximados. El rango describe al grupo, no la edad de cada persona.">
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-white/50">Tamaño del grupo (interacciones)</p>
              <Barras filas={m.perfil.tamano.map((t) => ({ etiqueta: t.valor === "5+" ? "5 o más" : t.valor === "1" ? "1 persona" : `${t.valor} personas`, n: t.n, detalle: fmtPct(t.pct) }))} />
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-white/50">Género (solo grupos con desglose)</p>
              {m.perfil.genero.personas_con_desglose > 0 ? (
                <>
                  <Barras filas={[
                    { etiqueta: "Hombres", n: m.perfil.genero.hombres, detalle: fmtPct(m.perfil.genero.hombres_pct) },
                    { etiqueta: "Mujeres", n: m.perfil.genero.mujeres, detalle: fmtPct(m.perfil.genero.mujeres_pct), color: COLORES.preguntaron },
                  ]} />
                  <p className="mt-2 text-xs text-white/55">{fmtN(m.perfil.genero.registros_con_desglose)} grupos con desglose: {fmtBase(m.perfil.genero.cobertura)} personas observadas ({fmtPct(m.perfil.genero.cobertura)}).</p>
                </>
              ) : <p className="text-sm text-white/55">Ningún grupo con desglose cargado.</p>}
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-white/50">Rango aproximado (grupos)</p>
              <DistribucionLista dist={m.perfil.rango_etario} etiqueta={(x) => ETIQUETAS.rango_etario[x]} />
            </div>
          </div>
        </Seccion>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 9. Conocimiento y repetición */}
        <Seccion titulo="Conocimiento previo y repetición declarada" descripcion="“No sabe” es una respuesta; “Sin dato” es que no se cargó. Tasa = Miró → Se subió dentro de cada respuesta.">
          <div className="space-y-5">
            <div><p className="mb-2 text-xs uppercase tracking-wide text-white/50">¿Ya conocían SIM?</p><DistribucionLista dist={m.perfil.conocia_sim} etiqueta={(x) => ETIQUETAS.respuesta[x]} conTasa /></div>
            <div><p className="mb-2 text-xs uppercase tracking-wide text-white/50">¿Ya se habían subido antes?</p><DistribucionLista dist={m.perfil.se_subio_antes} etiqueta={(x) => ETIQUETAS.respuesta[x]} conTasa /></div>
            <div><p className="mb-2 text-xs uppercase tracking-wide text-white/50">¿Quién inició?</p><DistribucionLista dist={m.perfil.iniciador} etiqueta={(x) => ETIQUETAS.iniciador[x]} conTasa /></div>
          </div>
        </Seccion>

        {/* 10. Atribución declarada */}
        <Seccion titulo="Atribución por empleado (declarada)" descripcion="“Atendió” lo declara quien carga; no es quien registró ni una evaluación de desempeño. Mirá el volumen antes que la tasa.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-xs text-white/55">
                <tr><th className="py-1.5 pr-2 font-medium">Atendió</th><th className="py-1.5 pr-2 text-right font-medium">Interacciones</th><th className="py-1.5 pr-2 text-right font-medium">Preguntaron</th><th className="py-1.5 pr-2 text-right font-medium">Se subieron</th><th className="py-1.5 text-right font-medium">Miró → Se subió</th></tr>
              </thead>
              <tbody>
                {m.atendio.map((x) => (
                  <tr key={x.empleado_id ?? "sin"} className="border-t border-white/5">
                    <td className="py-1.5 pr-2 text-white/85">{x.nombre}{x.empleado_id && !x.activo ? <span className="ml-1 text-xs text-white/45">(inactivo)</span> : null}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtN(x.embudo.interacciones)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtN(x.embudo.preguntaron)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtN(x.embudo.subieron)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtPct(x.embudo.tasas.miro_subio)} <span className="text-xs text-white/45">({fmtBase(x.embudo.tasas.miro_subio)})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Seccion>
      </div>

      {/* 11. Cobertura, pendientes e inconsistencias */}
      <Seccion titulo="Cobertura del registro, vínculos y advertencias"
        descripcion="La cobertura general sigue SOLO al período (fecha del turno), no a los filtros. No mide miradas ni consultas que no se registraron.">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-wide text-white/50">Cobertura general del stand en el período</p>
            <p className="mt-2 text-2xl font-bold">{fmtPct(cob.tasa)}</p>
            <p className="mt-1 text-xs text-white/60">{fmtN(cob.vinculados)} de {fmtN(cob.turnos)} turnos del Turnero tienen una interacción vinculada.</p>
            <p className="mt-2 text-xs text-white/60">Pagos: {fmtN(cob.pagos.vinculados)} de {fmtN(cob.pagos.total)} · Gratis: {fmtN(cob.gratis.vinculados)} de {fmtN(cob.gratis.total)}</p>
            {d ? <p className="mt-1 text-xs text-white/55">Vs. comparación: {fmtPp(d.cobertura.diferencia_pp)}</p> : null}
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm">
            <p className="text-xs uppercase tracking-wide text-white/50">Subidas declaradas: {fmtN(v.subidas_declaradas)}</p>
            <ul className="mt-2 space-y-1 text-white/80">
              <li>Con turno vinculado: <strong>{fmtN(v.con_turno)}</strong></li>
              <li>Con turno pago: <strong>{fmtN(v.con_turno_pago)}</strong> <span className="text-xs text-white/50">(venta registrada en el Turnero, no una acreditación)</span></li>
              <li>Pendientes de vincular: <strong>{fmtN(v.pendientes)}</strong></li>
              <li>Cerradas sin turno (declaradas): <strong>{fmtN(v.cerradas_sin_turno)}</strong></li>
              {v.turno_no_activo ? <li>Con turno no activo: <strong>{fmtN(v.turno_no_activo)}</strong></li> : null}
            </ul>
            <p className="mt-2 text-xs text-white/50">Las categorías se superponen (un turno pago también es un turno): no suman como partes.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm">
            <p className="text-xs uppercase tracking-wide text-white/50">Para revisar</p>
            <ul className="mt-2 space-y-1 text-white/80">
              <li>Subidas con un turno de pago contradictorio: <strong>{fmtN(v.con_pago_contradictorio)}</strong></li>
              <li>Turnos del período con total y método contradictorios: <strong>{fmtN(cob.contradictorios.total)}</strong></li>
              <li>Turnos vinculados: <strong>{fmtN(v.turnos_vinculados)}</strong> · participaciones: <strong>{fmtN(v.participaciones)}</strong></li>
            </ul>
            <p className="mt-2 text-xs text-white/50">Participaciones = suma de personas de los turnos vinculados; no son personas distintas.</p>
            {v.pendientes > 0 ? <Link href="/admin/interacciones" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-red-300 hover:text-red-200">Ver pendientes en Interacciones →</Link> : null}
          </div>
        </div>
      </Seccion>
    </>
  );
}

function TablaTasas({ filas }: { filas: Array<{ etiqueta: string; embudo: { interacciones: number; tasas: { miro_pregunto: Tasa; pregunto_subio: Tasa } } }> }) {
  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.etiqueta} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
          <span className="text-sm text-white/80">{f.etiqueta}<span className="block text-xs text-white/45">n = {fmtN(f.embudo.interacciones)}</span></span>
          <div className="space-y-1.5">
            <BarraTasa etiqueta="Miró → Preguntó" tasa={f.embudo.tasas.miro_pregunto} color={COLORES.preguntaron} />
            <BarraTasa etiqueta="Preguntó → Se subió" tasa={f.embudo.tasas.pregunto_subio} color={COLORES.subieron} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DistribucionLista<T extends string>({ dist, etiqueta, conTasa }: { dist: Distribucion<T>; etiqueta: (v: T) => string; conTasa?: boolean }) {
  if (dist.total === 0) return <p className="text-sm text-white/55">Sin interacciones.</p>;
  return (
    <div>
      <Barras filas={[
        ...dist.valores.map((x) => ({ etiqueta: etiqueta(x.valor), n: x.n, detalle: `${fmtPct(x.pct)}${conTasa ? ` · Miró→Se subió ${fmtPct(x.miro_subio)}` : ""}` })),
        { etiqueta: "Sin dato", n: dist.sin_dato, detalle: conTasa ? `Miró→Se subió ${fmtPct(dist.sin_dato_miro_subio)}` : "", color: "#52525b" },
      ]} />
      <p className="mt-2 text-xs text-white/50">Base: {fmtN(dist.con_dato)} de {fmtN(dist.total)} con dato ({fmtPct(tasa(dist.con_dato, dist.total))}); los % son sobre las que tienen dato.</p>
    </div>
  );
}
