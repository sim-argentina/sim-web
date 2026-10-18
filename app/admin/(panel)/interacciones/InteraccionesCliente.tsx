"use client";

// Interacciones · pantalla del personal (Bloque 3). Se carga DESPUÉS de atender:
// nunca es un paso del Turnero, que sigue a un toque ("Ir al Turnero").

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChartColumn, Eye, Link2, MessageCircle, CircleCheckBig, TriangleAlert } from "lucide-react";
import { ETIQUETAS, LISTADO, type InteraccionDto, type Resultado, type Rol } from "@/lib/interacciones";
import { hoyEnSim, sumarDias } from "@/lib/agenda";
import { api, borradores, etiquetaFecha, formularioVacio, nuevaClave, type BorradorAlta } from "./cliente";
import Detalle, { tonoEstado } from "./Detalle";
import Formulario from "./Formulario";
import { Aviso, Boton, Cargando, Dialogo, Etiqueta, cx } from "./ui";

type EstadoModulo = "cargando" | "listo" | "no_habilitado" | "no_instalado" | "error";
type Lista = { items: InteraccionDto[]; siguiente: string | null; cargando: boolean; error: string | null; cargada: boolean };
const listaVacia: Lista = { items: [], siguiente: null, cargando: false, error: null, cargada: false };

const ACCESOS: Array<{ r: Resultado; Icono: typeof Eye; texto: string }> = [
  { r: "miro", Icono: Eye, texto: "Pasó y miró el stand o los simuladores." },
  { r: "pregunto", Icono: MessageCircle, texto: "Consultó precios, disponibilidad, experiencia…" },
  { r: "subio", Icono: CircleCheckBig, texto: "Se subió y su turno ya está en el Turnero." },
];

export default function InteraccionesCliente({ rol }: { rol: Rol }) {
  const hoy = hoyEnSim();
  const ayer = sumarDias(hoy, -1);
  const [modulo, setModulo] = useState<EstadoModulo>("cargando");
  const [vista, setVista] = useState<"recientes" | "pendientes">("recientes");
  const [dia, setDia] = useState(hoy);
  const [incluirAnuladas, setIncluirAnuladas] = useState(false);
  const [recientes, setRecientes] = useState<Lista>(listaVacia);
  const [pendientes, setPendientes] = useState<Lista>(listaVacia);
  const [borradorGuardado, setBorradorGuardado] = useState<BorradorAlta | null>(null);
  const [alta, setAlta] = useState<BorradorAlta | null>(null);
  const [preguntaBorrador, setPreguntaBorrador] = useState<Resultado | null>(null);
  const [edicion, setEdicion] = useState<InteraccionDto | null>(null);
  const [detalle, setDetalle] = useState<{ id: string; accion?: "vincular" } | null>(null);
  const [exito, setExito] = useState<{ i: InteraccionDto; repetida: boolean; edicion?: boolean } | null>(null);
  const seq = useRef({ recientes: 0, pendientes: 0 });

  useEffect(() => {
    setBorradorGuardado(borradores.alta());
  }, []);

  const cargar = useCallback(async (tipo: "recientes" | "pendientes", cursor: string | null) => {
    const mio = ++seq.current[tipo];
    const set = tipo === "recientes" ? setRecientes : setPendientes;
    set((l) => ({ ...l, cargando: true, error: null, ...(cursor ? {} : { items: [], siguiente: null }) }));
    const q = new URLSearchParams({ limite: String(LISTADO.limite_defecto) });
    if (tipo === "recientes") {
      q.set("desde", dia);
      q.set("hasta", dia);
      if (incluirAnuladas) q.set("incluir_anuladas", "1");
    } else {
      q.set("estado", "pendiente");
    }
    if (cursor) q.set("cursor", cursor);
    const r = await api.listar(q);
    if (mio !== seq.current[tipo]) return;
    if (r.ok) {
      set((l) => ({ items: cursor ? [...l.items, ...r.data.items] : r.data.items, siguiente: r.data.siguiente, cargando: false, error: null, cargada: true }));
      setModulo(r.data.modulo.habilitado ? "listo" : "no_habilitado");
    } else {
      set((l) => ({ ...l, cargando: false, error: r.error, cargada: true }));
      if (r.codigo === "modulo_no_instalado") setModulo("no_instalado");
      else if (r.codigo === "modulo_no_habilitado") setModulo("no_habilitado");
      else setModulo((m) => (m === "cargando" ? "error" : m));
    }
  }, [dia, incluirAnuladas]);

  useEffect(() => {
    void cargar("recientes", null);
  }, [cargar]);
  useEffect(() => {
    void cargar("pendientes", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refrescar = () => {
    void cargar("recientes", null);
    void cargar("pendientes", null);
  };

  function abrirAlta(r: Resultado) {
    const previo = borradores.alta();
    if (previo) {
      setBorradorGuardado(previo);
      setPreguntaBorrador(r);
      return;
    }
    empezarAlta(r);
  }
  function empezarAlta(r: Resultado) {
    const b: BorradorAlta = { clave: nuevaClave(), form: formularioVacio(r), turnos: [], estado: "editando", actualizado: new Date().toISOString() };
    borradores.guardarAlta(b);
    setBorradorGuardado(b);
    setAlta(b);
  }
  function descartarBorrador() {
    borradores.borrarAlta();
    setBorradorGuardado(null);
    setAlta(null);
  }
  function guardado(i: InteraccionDto, info: { repetida: boolean }, esEdicion = false) {
    setAlta(null);
    setEdicion(null);
    setBorradorGuardado(borradores.alta());
    setExito({ i, repetida: info.repetida, edicion: esEdicion });
    if (esEdicion) setDetalle({ id: i.id });
    refrescar();
  }

  const disponible = modulo === "listo";
  const lista = vista === "recientes" ? recientes : pendientes;

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
            <h1 id="titulo-pagina" tabIndex={-1} className="text-3xl font-black uppercase outline-none md:text-5xl">Interacciones</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Registrá la interacción después de atender. Primero el Turnero: esto nunca frena una venta.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {rol === "admin" ? (
              <Link href="/admin/interacciones/analisis"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-black uppercase text-white/80 hover:border-white hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
                <ChartColumn className="h-4 w-4" aria-hidden /> Análisis
              </Link>
            ) : null}
            <Link href="/admin/turnero"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-black uppercase text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400">
              Ir al Turnero <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          {modulo === "no_habilitado" || modulo === "no_instalado" ? (
            <Aviso tipo="alerta" titulo="La carga de Interacciones todavía no está habilitada">
              Podés seguir usando el Turnero normalmente. Cuando se habilite, vas a poder registrar las interacciones acá.
            </Aviso>
          ) : null}
          {modulo === "error" ? (
            <Aviso tipo="error" titulo="No pudimos cargar Interacciones" acciones={<Boton onClick={refrescar}>Reintentar</Boton>}>
              {recientes.error ?? "Probá de nuevo en un momento."} El Turnero sigue funcionando.
            </Aviso>
          ) : null}

          {exito ? (
            <Aviso tipo="exito" titulo={exito.edicion ? "Cambios guardados" : exito.repetida ? "Ya estaba guardada (no se duplicó)" : "Interacción guardada"}
              acciones={(
                <>
                  <Boton onClick={() => setDetalle({ id: exito.i.id })}>Ver o editar</Boton>
                  {exito.i.vinculo.estado === "pendiente" ? (
                    <Boton variante="primario" onClick={() => setDetalle({ id: exito.i.id, accion: "vincular" })}><Link2 className="h-4 w-4" aria-hidden /> Vincular turno</Boton>
                  ) : null}
                  <Boton variante="fantasma" onClick={() => setExito(null)}>Cerrar aviso</Boton>
                </>
              )}>
              {ETIQUETAS.resultado[exito.i.resultado]} · {exito.i.personas_grupo} {exito.i.personas_grupo === 1 ? "persona" : "personas"} · {ETIQUETAS.vinculo[exito.i.vinculo.estado]}
            </Aviso>
          ) : null}

          {borradorGuardado && !alta && disponible ? (
            <Aviso tipo={borradorGuardado.estado === "incierto" ? "alerta" : "info"}
              titulo={borradorGuardado.estado === "incierto" ? "Hay una carga que no sabemos si se guardó" : "Tenés una carga sin guardar"}
              acciones={(
                <>
                  <Boton variante="primario" onClick={() => setAlta(borradorGuardado)}>{borradorGuardado.estado === "incierto" ? "Revisar y reintentar" : "Continuar"}</Boton>
                  {borradorGuardado.estado === "editando" ? <Boton onClick={descartarBorrador}>Descartar</Boton> : null}
                </>
              )}>
              {ETIQUETAS.resultado[borradorGuardado.form.resultado]} · {borradorGuardado.form.personas} {borradorGuardado.form.personas === 1 ? "persona" : "personas"}
              {borradorGuardado.turnos.length ? ` · ${borradorGuardado.turnos.length} turno(s) elegido(s)` : ""}
            </Aviso>
          ) : null}

          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {ACCESOS.map(({ r, Icono, texto }) => (
              <button key={r} type="button" disabled={!disponible} onClick={() => abrirAlta(r)}
                className={cx(
                  "flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl border p-3 text-center transition sm:min-h-40 sm:p-5",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  r === "subio" ? "border-red-500/60 bg-red-950/20 hover:bg-red-950/40" : "border-white/10 bg-white/[0.04] hover:border-white/30",
                )}>
                <Icono className="h-7 w-7 text-red-400 sm:h-9 sm:w-9" aria-hidden />
                <span className="text-sm font-black uppercase leading-tight sm:text-lg">{ETIQUETAS.resultado[r]}</span>
                <span className="hidden text-xs text-white/55 sm:block">{texto}</span>
              </button>
            ))}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <div role="tablist" aria-label="Listas" className="mb-4 flex gap-2">
              {(["recientes", "pendientes"] as const).map((v) => (
                <button key={v} role="tab" type="button" aria-selected={vista === v} onClick={() => setVista(v)}
                  className={cx("min-h-11 rounded-xl px-4 text-sm font-black uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400",
                    vista === v ? "bg-red-600 text-white" : "border border-white/15 text-white/70 hover:text-white")}>
                  {v === "recientes" ? "Recientes" : `Pendientes${pendientes.cargada ? ` (${pendientes.items.length}${pendientes.siguiente ? "+" : ""})` : ""}`}
                </button>
              ))}
            </div>

            {vista === "recientes" ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {[hoy, ayer, sumarDias(hoy, -2)].map((f) => (
                  <button key={f} type="button" aria-pressed={dia === f} onClick={() => setDia(f)}
                    className={cx("min-h-11 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400",
                      dia === f ? "bg-white text-black" : "border border-white/15 text-white/70 hover:text-white")}>
                    {f === hoy ? "Hoy" : f === ayer ? "Ayer" : "Anteayer"}
                  </button>
                ))}
                {rol === "admin" ? (
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <span className="sr-only">Otra fecha</span>
                    <input type="date" value={dia} max={hoy} onChange={(e) => e.target.value && setDia(e.target.value)}
                      className="min-h-11 rounded-lg border border-white/15 bg-black/40 px-2 text-white outline-none [color-scheme:dark] focus:border-red-500" />
                  </label>
                ) : null}
                <label className="ml-auto flex min-h-11 items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={incluirAnuladas} onChange={(e) => setIncluirAnuladas(e.target.checked)} className="h-4 w-4 accent-red-600" />
                  Ver anuladas
                </label>
              </div>
            ) : (
              <p className="mb-4 text-sm text-white/60">“Se subió” sin turno vinculado, de cualquier fecha. Abrila para vincular el turno del Turnero.</p>
            )}

            {lista.error && lista.cargada && modulo === "listo" ? (
              <Aviso tipo="error" acciones={<Boton onClick={() => void cargar(vista, null)}>Reintentar</Boton>}>{lista.error}</Aviso>
            ) : null}
            {!lista.cargada && lista.cargando ? <Cargando /> : null}
            {lista.cargada && !lista.error && lista.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/55">
                {vista === "pendientes" ? "No hay subidas pendientes de vincular." : `No hay interacciones registradas ${dia === hoy ? "hoy" : "ese día"}.`}
              </p>
            ) : null}

            <ul className="space-y-2">
              {lista.items.map((i) => (
                <Tarjeta key={i.id} i={i} hoy={hoy} ayer={ayer}
                  onAbrir={() => setDetalle({ id: i.id })}
                  onVincular={vista === "pendientes" && i.permisos.vincular ? () => setDetalle({ id: i.id, accion: "vincular" }) : undefined} />
              ))}
            </ul>
            {lista.siguiente ? (
              <div className="mt-4 flex justify-center">
                <Boton cargando={lista.cargando} onClick={() => void cargar(vista, lista.siguiente)}>Cargar más</Boton>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {preguntaBorrador ? (
        <Dialogo titulo="Tenés una carga sin terminar" onCerrar={() => setPreguntaBorrador(null)}
          acciones={(
            <>
              {borradorGuardado?.estado === "editando" ? (
                <Boton variante="peligro" onClick={() => { const r = preguntaBorrador; setPreguntaBorrador(null); borradores.borrarAlta(); empezarAlta(r); }}>
                  Descartarla y empezar otra
                </Boton>
              ) : null}
              <Boton variante="primario" onClick={() => { setPreguntaBorrador(null); setAlta(borradorGuardado); }}>Continuarla</Boton>
            </>
          )}>
          {borradorGuardado?.estado === "incierto"
            ? "Antes de empezar otra, resolvé esa: se envió y no sabemos si llegó. Reintentarla no la duplica."
            : `${borradorGuardado ? ETIQUETAS.resultado[borradorGuardado.form.resultado] : ""} · ${borradorGuardado?.form.personas ?? ""} persona(s). Podés continuarla o descartarla.`}
        </Dialogo>
      ) : null}

      {alta ? (
        <Formulario key={alta.clave} modo="alta" rol={rol} borrador={alta}
          onCerrar={() => { setAlta(null); setBorradorGuardado(borradores.alta()); }}
          onDescartar={descartarBorrador}
          onGuardado={(i, info) => guardado(i, info)} />
      ) : null}
      {edicion ? (
        <Formulario key={`${edicion.id}-${edicion.version}`} modo="edicion" rol={rol} base={edicion}
          onCerrar={() => { const id = edicion.id; setEdicion(null); setDetalle({ id }); }}
          onGuardado={(i, info) => guardado(i, info, true)} />
      ) : null}
      {detalle ? (
        <Detalle key={`${detalle.id}-${detalle.accion ?? ""}`} id={detalle.id} rol={rol} accionInicial={detalle.accion}
          onCerrar={() => setDetalle(null)}
          onEditar={(i) => { setDetalle(null); setEdicion(i); }}
          onCambio={() => refrescar()} />
      ) : null}
    </main>
  );
}

function Tarjeta({ i, hoy, ayer, onAbrir, onVincular }: {
  i: InteraccionDto;
  hoy: string;
  ayer: string;
  onAbrir: () => void;
  onVincular?: () => void;
}) {
  const perfil = [
    i.rango_etario ? ETIQUETAS.rango_etario[i.rango_etario] : null,
    i.hombres !== null ? `${i.hombres} H · ${i.mujeres} M` : null,
  ].filter(Boolean).join(" · ");
  const alertas = i.advertencias.filter((a) => a.codigo !== "pendiente_de_vinculo" && a.codigo !== "subida_declarada_sin_turno").length;
  return (
    <li className={cx("rounded-2xl border bg-black/40", i.anulacion ? "border-white/5 opacity-60" : "border-white/10")}>
      <button type="button" onClick={onAbrir}
        className="flex w-full flex-col gap-1.5 rounded-2xl p-3 text-left hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 sm:p-4">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-black tabular-nums">{i.hora_negocio}</span>
          {i.fecha_negocio !== hoy ? <span className="text-sm text-white/55">{etiquetaFecha(i.fecha_negocio, hoy, ayer)}</span> : null}
          <Etiqueta tono="rojo">{ETIQUETAS.resultado[i.resultado]}</Etiqueta>
          {i.resultado === "subio" || i.anulacion ? <Etiqueta tono={tonoEstado(i.vinculo.estado)}>{ETIQUETAS.vinculo[i.vinculo.estado]}</Etiqueta> : null}
          {alertas > 0 ? <TriangleAlert className="h-4 w-4 text-amber-300" aria-label={`${alertas} cosa(s) para revisar`} /> : null}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-white/70">
          <span>{i.personas_grupo} {i.personas_grupo === 1 ? "persona" : "personas"}</span>
          {perfil ? <span>{perfil}</span> : null}
          {i.motivo ? <span>Motivo: {ETIQUETAS.motivo[i.motivo]}</span> : null}
          {i.atendio ? <span>Atendió: {i.atendio.nombre ?? "—"}{i.atendio.activo ? "" : " (inactivo)"}</span> : null}
          {i.turnos.length ? <span>Turno {i.turnos.map((t) => t.hora ?? "?").join(", ")}</span> : null}
        </span>
      </button>
      {onVincular ? (
        <div className="border-t border-white/10 px-3 py-2 sm:px-4">
          <Boton variante="primario" onClick={onVincular}><Link2 className="h-4 w-4" aria-hidden /> Vincular turno</Boton>
        </div>
      ) : null}
    </li>
  );
}
