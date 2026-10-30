"use client";

// CRM B2 · "Contactos para seguir" (solo Administración). Bandeja con grupos sin
// repeticiones (lib/crmB2.ts: grupoDe) y detalle de la oportunidad en un panel
// (pantalla completa en el celular, lateral en escritorio) que se abre con ?op=<id>
// sin perder la bandeja. Toda escritura va a /api/admin/crm/oportunidades/[id] con
// una clave por envío: un resultado incierto se reintenta con la MISMA clave.
// Consultar, abrir WhatsApp o mirar la ficha no registran nada.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, CalendarClock, MessageCircle, Phone, Search, TriangleAlert } from "lucide-react";
import { Aviso, Boton, Cargando, Chips, Etiqueta, Panel, Plegable, cx } from "@/app/admin/(panel)/interacciones/ui";
import { pedir, enviar } from "@/components/crm/api";
import { INPUT, fechaCorta, fechaHora, hechosVisita } from "@/components/crm/campos";
import { hoyEnSim, sumarDias } from "@/lib/agenda";
import { DECISOR, INTERESES, NECESIDADES, PACKS, texto } from "@/lib/crmB1";
import {
  ESTADOS_OPORTUNIDAD, ETAPAS, GRUPOS, MOTIVOS_PERDIDA, TEXTO_ADVERTENCIA, TIPOS_ACTIVIDAD,
  enlaceWhatsappManual, esRetroceso, estadoTrasActividad, textoActividad, textoEstado, textoMotivoPerdida,
  type FilaBandeja, type Grupo,
} from "@/lib/crmB2";
import type { BandejaDto, DetalleOportunidadDto } from "@/lib/crmB2Server";
import { formatoPesos } from "@/lib/crmB3";
import RegistrarVenta from "@/components/crm/RegistrarVenta";
import { EtiquetaCobro, EtiquetaComision } from "@/components/crm/ventasCampos";

const API = "/api/admin/crm";
const tonoEstado = (e: string) => (e === "ganada" ? "verde" : e === "perdida" ? "gris" : e === "pausada" ? "ambar" : e === "negociacion" ? "verde" : e === "interesado" ? "rojo" : "neutro");

// ── Bandeja ─────────────────────────────────────────────────────────────────
export default function Seguimiento() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const op = params.get("op");
  const [vista, setVista] = useState<"abiertas" | "perdidas" | "ganadas">("abiertas");
  const [grupo, setGrupo] = useState<Grupo | "">("");
  const [q, setQ] = useState("");
  const [f, setF] = useState({ estado: "", origen: "", interes: "", rubro: "", zona: "", proxima: "" });
  const [verFiltros, setVerFiltros] = useState(false);
  const [datos, setDatos] = useState<BandejaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const consulta = useMemo(() => {
    const u = new URLSearchParams({ vista });
    if (grupo && vista === "abiertas") u.set("grupo", grupo);
    if (q.trim()) u.set("q", q.trim());
    for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
    return u.toString();
  }, [vista, grupo, q, f]);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      pedir<BandejaDto>(`${API}/seguimiento?${consulta}`).then((r) => {
        if (!vivo) return;
        if (r.ok) { setDatos(r.data); setError(null); } else setError(r.error);
      });
    }, q ? 250 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [consulta, q, recarga]);

  const abrir = (id: string) => {
    const u = new URLSearchParams(params.toString());
    u.set("op", id);
    router.push(`${pathname}?${u.toString()}`, { scroll: false });
  };
  const cerrar = () => {
    const u = new URLSearchParams(params.toString());
    u.delete("op");
    router.replace(u.size ? `${pathname}?${u.toString()}` : pathname, { scroll: false });
  };
  const recargar = useCallback(() => setRecarga((n) => n + 1), []);
  const filtrosActivos = Object.values(f).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 id="titulo-pagina" tabIndex={-1} className="text-3xl font-black outline-none">Contactos para seguir</h1>
        <p className="mt-1 text-sm text-white/60">Leads de la prospección y su seguimiento comercial. Todo es manual: nada se envía solo.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Vista">
        {(["abiertas", "perdidas", "ganadas"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => { setVista(v); setGrupo(""); }}
            className={cx("min-h-11 rounded-xl px-4 text-sm font-bold", vista === v ? "bg-white text-black" : "border border-white/15 text-white/80 hover:border-white/40")}>
            {v === "abiertas" ? "Para seguir" : v === "perdidas" ? "Perdidas" : "Ganadas"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-white/40" aria-hidden />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar negocio o contacto" aria-label="Buscar negocio o contacto" />
        </div>
        <Plegable titulo="Filtros" abierto={verFiltros} onAlternar={() => setVerFiltros((x) => !x)} resumen={filtrosActivos ? `${filtrosActivos} activo${filtrosActivos > 1 ? "s" : ""}` : "ninguno"}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FiltroSelect etiqueta="Estado" valor={f.estado} onCambio={(v) => setF({ ...f, estado: v })}
              opciones={ESTADOS_OPORTUNIDAD.filter((e) => (vista === "perdidas" ? e.valor === "perdida" : vista === "ganadas" ? e.valor === "ganada" : e.valor !== "perdida" && e.valor !== "ganada")).map((e) => ({ valor: e.valor, texto: e.texto }))} />
            <FiltroSelect etiqueta="Originado por" valor={f.origen} onCambio={(v) => setF({ ...f, origen: v })} opciones={(datos?.opciones.origenes ?? []).map((o) => ({ valor: o.id, texto: o.nombre }))} />
            <FiltroSelect etiqueta="Interés" valor={f.interes} onCambio={(v) => setF({ ...f, interes: v })}
              opciones={[...INTERESES.map((i) => ({ valor: i.valor, texto: i.texto })), { valor: "no_evaluado", texto: "No evaluado" }]} />
            <FiltroSelect etiqueta="Rubro" valor={f.rubro} onCambio={(v) => setF({ ...f, rubro: v })}
              opciones={[...(datos?.opciones.rubros ?? []).map((r) => ({ valor: r.id, texto: r.nombre })), { valor: "sin_clasificar", texto: "Sin rubro de la lista" }]} />
            <FiltroSelect etiqueta="Zona" valor={f.zona} onCambio={(v) => setF({ ...f, zona: v })} opciones={(datos?.opciones.zonas ?? []).map((z) => ({ valor: z.id, texto: z.nombre }))} />
            {vista === "abiertas" ? (
              <FiltroSelect etiqueta="Próxima acción" valor={f.proxima} onCambio={(v) => setF({ ...f, proxima: v })}
                opciones={[{ valor: "vencida", texto: "Vencida" }, { valor: "hoy", texto: "Hoy" }, { valor: "futura", texto: "Programada" }, { valor: "sin", texto: "Sin próxima acción" }]} />
            ) : null}
          </div>
          {filtrosActivos ? <Boton variante="fantasma" onClick={() => setF({ estado: "", origen: "", interes: "", rubro: "", zona: "", proxima: "" })}>Quitar filtros</Boton> : null}
        </Plegable>
      </div>

      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!datos ? <Cargando /> : vista !== "abiertas" ? (
        <ListaFilas filas={datos.filas} hoy={datos.hoy} onAbrir={abrir}
          vacio={vista === "perdidas" ? "No hay oportunidades perdidas con estos filtros." : "No hay oportunidades ganadas con estos filtros. Las ventas, sus cobros y comisiones están en «Ventas»."} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Grupos">
            <BotonGrupo activo={grupo === ""} onClick={() => setGrupo("")} texto="Todas" n={datos.total} />
            {GRUPOS.map((g) => <BotonGrupo key={g.id} activo={grupo === g.id} onClick={() => setGrupo(grupo === g.id ? "" : g.id)} texto={g.texto} n={datos.conteos[g.id]}
              alerta={(g.id === "vencidos" || g.id === "retomar") && datos.conteos[g.id] > 0} />)}
          </div>
          {grupo ? (
            <ListaFilas filas={datos.filas} hoy={datos.hoy} onAbrir={abrir} vacio="Nada en este grupo." />
          ) : datos.total === 0 ? (
            <p className="text-sm text-white/60">No hay oportunidades abiertas con estos filtros.</p>
          ) : (
            <div className="space-y-8">
              {GRUPOS.filter((g) => datos.conteos[g.id] > 0).map((g) => (
                <section key={g.id} aria-labelledby={`g-${g.id}`} className="space-y-2">
                  <h2 id={`g-${g.id}`} className="text-sm font-bold uppercase tracking-wide text-white/70">{g.texto} <span className="text-white/40">({datos.conteos[g.id]})</span></h2>
                  <ListaFilas filas={datos.filas.filter((o) => o.grupo === g.id)} hoy={datos.hoy} onAbrir={abrir} vacio="" />
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {op ? <DetalleOportunidad key={op} id={op} onCerrar={cerrar} onCambio={recargar} /> : null}
    </div>
  );
}

function FiltroSelect({ etiqueta, valor, onCambio, opciones }: { etiqueta: string; valor: string; onCambio: (v: string) => void; opciones: Array<{ valor: string; texto: string }> }) {
  return (
    <label className="block space-y-1.5 text-sm font-semibold text-white/80">{etiqueta}
      <select className={INPUT} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Todos</option>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  );
}

function BotonGrupo({ activo, onClick, texto, n, alerta }: { activo: boolean; onClick: () => void; texto: string; n: number; alerta?: boolean }) {
  return (
    <button type="button" aria-pressed={activo} onClick={onClick}
      className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold",
        activo ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/80 hover:border-white/40")}>
      {texto}
      <span className={cx("rounded-full px-2 text-xs font-black", activo ? "bg-white/20" : alerta ? "bg-red-600 text-white" : "bg-white/10")}>{n}</span>
    </button>
  );
}

function VenceEtiqueta({ vence, hoy, tipo }: { vence: string; hoy: string; tipo: "seguimiento" | "retomar" }) {
  const pasada = vence < hoy;
  const esHoy = vence === hoy;
  return (
    <span className={cx("inline-flex items-center gap-1 text-sm font-semibold", pasada ? "text-red-300" : esHoy ? "text-amber-200" : "text-white/70")}>
      <CalendarClock className="h-4 w-4" aria-hidden />
      {tipo === "retomar" ? "Retomar" : "Próxima acción"}: {esHoy ? "hoy" : fechaCorta(vence)}{pasada ? " (vencida)" : ""}
    </span>
  );
}

function ListaFilas({ filas, hoy, onAbrir, vacio }: { filas: FilaBandeja[]; hoy: string; onAbrir: (id: string) => void; vacio: string }) {
  if (!filas.length) return vacio ? <p className="text-sm text-white/60">{vacio}</p> : null;
  return (
    <ul className="space-y-2">
      {filas.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => onAbrir(o.id)}
            className="block w-full space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-black">{o.empresa.nombre}</span>
              <Etiqueta tono={tonoEstado(o.estado)}>{textoEstado(o.estado)}</Etiqueta>
              {!o.gestionada && o.estado !== "perdida" && o.estado !== "ganada" ? <Etiqueta tono="rojo">Nuevo</Etiqueta> : null}
              {o.ciclo > 1 ? <Etiqueta tono="gris">Reabierta</Etiqueta> : null}
              {o.advertencias.map((a) => <Etiqueta key={a} tono="ambar">{TEXTO_ADVERTENCIA[a]}</Etiqueta>)}
            </span>
            <span className="block text-sm text-white/80">
              {o.contacto ? <>{o.contacto.nombre ?? o.contacto.telefono ?? "Contacto"}{o.contacto.cargo ? ` · ${o.contacto.cargo}` : ""}{o.contacto.es_decisor === "si" ? " · decide" : o.contacto.es_decisor === "no" ? " · no decide" : ""}</> : "Sin contacto principal"}
              {o.empresa.zona ? <span className="text-white/50"> · {o.empresa.zona}</span> : null}
            </span>
            <span className="block text-sm text-white/60">
              Interés: {o.interes ? texto(INTERESES, o.interes) : "no evaluado"}
              {o.pack ? ` · ${texto(PACKS, o.pack)}` : ""}
              {o.necesidades.length ? ` · ${o.necesidades.map((n) => texto(NECESIDADES, n)).join(", ")}` : ""}
            </span>
            {o.nota_comercial ? <span className="block truncate text-sm italic text-white/60">«{o.nota_comercial.texto}» — {o.origen.nombre}</span> : null}
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {o.perdida ? (
                <span className="text-sm text-white/70">Perdida el {fechaHora(o.perdida.en)} · {textoMotivoPerdida(o.perdida.motivo)}{o.perdida.visitas_posteriores ? ` · ${o.perdida.visitas_posteriores} visita(s) después` : ""}</span>
              ) : o.estado === "ganada" ? <span className="text-sm text-green-200">Venta registrada · se sigue en «Ventas»</span>
                : o.pendiente ? <VenceEtiqueta vence={o.pendiente.vence_el} hoy={hoy} tipo={o.pendiente.tipo} /> : <span className="text-sm text-white/50">Sin próxima acción</span>}
              <span className="text-xs text-white/50">
                {o.ultima_gestion ? `Última gestión: ${textoActividad(o.ultima_gestion.tipo)} · ${fechaHora(o.ultima_gestion.ocurrida_en)}` : `Lead del ${fechaHora(o.origen.lead_en)} · ${o.origen.nombre}`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Detalle de una oportunidad ──────────────────────────────────────────────
type Modo = null | "gestion" | "programar" | "reprogramar" | "pausar" | "retomar" | "perder" | "reabrir" | "contacto" | "venta";
type Envio = { accion: string; datos: Record<string, unknown> };

function DetalleOportunidad({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio: () => void }) {
  const [d, setD] = useState<DetalleOportunidadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>(null);
  const [recarga, setRecarga] = useState(0);
  // Una clave por envío del formulario abierto: el reintento de un resultado
  // incierto usa la MISMA; un formulario nuevo, otra.
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [incierto, setIncierto] = useState<Envio | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    pedir<DetalleOportunidadDto>(`${API}/oportunidades/${id}`).then((r) => {
      if (!vivo) return;
      if (r.ok) { setD(r.data); setError(null); } else setError(r.error);
    });
    return () => { vivo = false; };
  }, [id, recarga]);

  const abrirModo = (m: Modo) => { setModo(m); setClave(crypto.randomUUID()); setIncierto(null); setAviso(null); setError(null); };

  async function enviarAccion(e: Envio, exito: string) {
    if (!d || enviando) return;
    setEnviando(true);
    setError(null);
    const r = await enviar<{ repetida: boolean }>(`${API}/oportunidades/${id}`, "POST", { clave, version: d.fila.version, ...e });
    setEnviando(false);
    if (r.ok) {
      setIncierto(null);
      setModo(null);
      setClave(crypto.randomUUID());
      setAviso(r.data.repetida ? `${exito} (ya se había guardado: no se duplicó).` : exito);
      setRecarga((n) => n + 1);
      onCambio();
      return;
    }
    if (r.incierto) {
      setIncierto(e);
      setError("No sabemos si se guardó (sin respuesta del servidor). Reintentá: si ya había llegado, no se duplica.");
      return;
    }
    if (r.codigo === "version_desactualizada" || r.codigo === "seguimiento_no_vigente") {
      setRecarga((n) => n + 1);
      setClave(crypto.randomUUID());
    }
    setError(r.error);
  }

  if (!d) {
    return (
      <Panel titulo="Oportunidad" onCerrar={onCerrar} ancho="max-w-3xl">
        {error ? <Aviso tipo="error">{error}</Aviso> : <Cargando />}
      </Panel>
    );
  }
  const o = d.fila;
  const pausada = o.estado === "pausada";
  const perdida = o.estado === "perdida";
  const ganada = o.estado === "ganada";
  const wa = o.contacto ? enlaceWhatsappManual(o.contacto.telefono) : null;
  const bloqueado = enviando || !!incierto;
  const pie = ganada ? (
    <div className="flex flex-wrap gap-2">
      {d.venta ? <Link href={`/admin/crm/ventas/${d.venta.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700">Ver la venta</Link> : null}
      <Boton onClick={() => abrirModo("gestion")} disabled={bloqueado}>Agregar nota</Boton>
    </div>
  ) : perdida ? (
    <div className="flex flex-wrap gap-2">
      <Boton variante="primario" onClick={() => abrirModo("reabrir")} disabled={bloqueado}>Reabrir</Boton>
      <Boton onClick={() => abrirModo("gestion")} disabled={bloqueado}>Agregar nota</Boton>
    </div>
  ) : (
    <div className="flex flex-wrap gap-2">
      <Boton variante="primario" onClick={() => abrirModo("gestion")} disabled={bloqueado}>Registrar gestión</Boton>
      <Boton onClick={() => abrirModo("venta")} disabled={bloqueado || pausada} title={pausada ? "Retomala para registrar la venta" : undefined}><BadgeCheck className="h-4 w-4" aria-hidden />Registrar venta</Boton>
      {pausada ? <Boton onClick={() => abrirModo("retomar")} disabled={bloqueado}>Retomar ahora</Boton> : <Boton onClick={() => abrirModo("pausar")} disabled={bloqueado}>Retomar más adelante</Boton>}
      <Boton variante="peligro" onClick={() => abrirModo("perder")} disabled={bloqueado}>Marcar perdida</Boton>
    </div>
  );

  return (
    <Panel titulo={o.empresa.nombre} onCerrar={onCerrar} ancho="max-w-3xl" pie={pie} etiquetaCerrar="Volver a la bandeja">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Etiqueta tono={tonoEstado(o.estado)}>{textoEstado(o.estado)}</Etiqueta>
          {pausada && o.estado_previo ? <span className="text-sm text-white/60">(estaba en {textoEstado(o.estado_previo)}; retomar el {fechaCorta(d.oportunidad.retomar_el)})</span> : null}
          {o.ciclo > 1 ? <Etiqueta tono="gris">Ciclo {o.ciclo}</Etiqueta> : null}
          {!o.gestionada && !perdida && !ganada ? <Etiqueta tono="rojo">Nuevo: sin gestión</Etiqueta> : null}
          {d.oportunidad.origen_tipo === "recompra_admin" ? <Etiqueta tono="gris">Recompra creada por Administración</Etiqueta> : null}
          <Link href={`/admin/crm/negocios/${o.empresa.id}`} className="ml-auto inline-flex min-h-11 items-center text-sm font-semibold text-white/70 underline-offset-2 hover:underline">Ver ficha del negocio</Link>
        </div>

        <div aria-live="polite" className="space-y-2">
          {aviso ? <Aviso tipo="exito">{aviso}</Aviso> : null}
          {error ? <Aviso tipo={incierto ? "alerta" : "error"} acciones={incierto ? (
            <>
              <Boton variante="primario" cargando={enviando} onClick={() => void enviarAccion(incierto, "Guardado")}>Reintentar</Boton>
              <Boton variante="fantasma" onClick={() => { setIncierto(null); setError(null); setModo(null); setRecarga((n) => n + 1); }}>Descartar y recargar</Boton>
            </>
          ) : undefined}>{error}</Aviso> : null}
        </div>

        {o.advertencias.length ? (
          <Aviso tipo="alerta" titulo="Para resolver">
            <ul className="space-y-2">
              {o.advertencias.map((a) => (
                <li key={a} className="flex flex-wrap items-center gap-2">
                  <TriangleAlert className="h-4 w-4" aria-hidden />{TEXTO_ADVERTENCIA[a]}
                  {a === "negocio_archivado" ? (
                    <Link href={`/admin/crm/negocios/${o.empresa.id}`} className="inline-flex min-h-11 items-center font-bold underline">Desarchivar o revisar el negocio</Link>
                  ) : (
                    <>
                      {d.contactos.some((c) => !c.archivado && c.id !== o.contacto?.id) ? <Boton variante="secundario" onClick={() => abrirModo("contacto")}>Elegir otro contacto principal</Boton> : null}
                      <Link href={`/admin/crm/negocios/${o.empresa.id}`} className="inline-flex min-h-11 items-center font-bold underline">Cargar o editar contactos</Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Aviso>
        ) : null}

        {ganada ? (
          <Aviso tipo="exito" titulo={`Ganado el ${fechaHora(d.oportunidad.ganada_en)}`}>
            {d.venta ? (
              <div className="space-y-2">
                <p>{d.venta.producto.nombre} · {formatoPesos(d.venta.importe)} acordados · cobrado según CRM {formatoPesos(d.venta.cobrado)} · saldo {formatoPesos(d.venta.saldo)}</p>
                <p className="flex flex-wrap gap-1.5"><EtiquetaCobro estado={d.venta.estado_cobro} /><EtiquetaComision estado={d.venta.comision.estado} />
                  <Etiqueta tono={d.venta.entrega.estado === "entregada" ? "verde" : "ambar"}>{d.venta.entrega.estado === "entregada" ? "Tarjetas entregadas" : "Tarjetas sin entregar"}</Etiqueta></p>
                <p className="text-xs">Salió de los seguimientos abiertos: cobros, comisión y entrega se gestionan en la venta.</p>
              </div>
            ) : "La venta no se encontró."}
          </Aviso>
        ) : null}

        {modo === "venta" ? (
          <section className="rounded-2xl border border-green-500/40 bg-green-950/10 p-4">
            <RegistrarVenta oportunidadId={o.id} onCancelar={() => setModo(null)} onRegistrada={(_ventaId, repetida) => {
              setModo(null);
              setAviso(repetida ? "Venta registrada (ya se había guardado: no se duplicó)." : "Venta registrada: la oportunidad pasó a Ganado.");
              setRecarga((n) => n + 1);
              onCambio();
            }} />
          </section>
        ) : modo ? (
          <section className="rounded-2xl border border-red-500/40 bg-red-950/10 p-4">
            <FormularioAccion modo={modo} d={d} bloqueado={bloqueado} enviando={enviando} onCancelar={() => setModo(null)}
              onEnviar={(e, exito) => void enviarAccion(e, exito)} />
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/60">Contacto principal</h3>
            {o.contacto ? (
              <div className="space-y-1">
                <p className="font-bold">{o.contacto.nombre ?? "Sin nombre"}{o.contacto.cargo ? ` · ${o.contacto.cargo}` : ""}</p>
                <p className="text-white/70">¿Decide la compra? {texto(DECISOR, o.contacto.es_decisor)}</p>
                {o.contacto.telefono ? <a href={`tel:${o.contacto.telefono.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center gap-1 font-semibold underline-offset-2 hover:underline"><Phone className="h-4 w-4" aria-hidden />{o.contacto.telefono}</a> : null}
                {wa && "url" in wa ? (
                  <a href={wa.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1 font-semibold text-green-300 underline-offset-2 hover:underline">
                    <MessageCircle className="h-4 w-4" aria-hidden />Abrir WhatsApp
                  </a>
                ) : wa ? <p className="text-xs text-white/50">WhatsApp: {wa.motivo}</p> : null}
                <p className="text-xs text-white/50">Abrir WhatsApp no registra nada: si lo mandaste, registrá «WhatsApp enviado».</p>
              </div>
            ) : <p className="text-white/60">Sin contacto principal.</p>}
            {!perdida && !ganada && d.contactos.filter((c) => !c.archivado).length > 1 ? <Boton variante="fantasma" className="mt-1 px-0" onClick={() => abrirModo("contacto")}>Cambiar contacto principal</Boton> : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/60">De la visita</h3>
            <p>Interés: <strong>{o.interes ? texto(INTERESES, o.interes) : "no evaluado"}</strong>{o.pack ? <> · {texto(PACKS, o.pack)}</> : null}</p>
            <p className="mt-1 text-white/80">{o.necesidades.length ? o.necesidades.map((n) => texto(NECESIDADES, n)).join(", ") : "Sin necesidades anotadas"}{o.necesidad_otra.length ? ` (${o.necesidad_otra.join("; ")})` : ""}</p>
            {o.nota_comercial ? <p className="mt-2 italic text-white/70">«{o.nota_comercial.texto}» <span className="not-italic text-white/50">— {fechaHora(o.nota_comercial.en)}</span></p> : null}
            <p className="mt-2 text-xs text-white/50">Lead de {o.origen.nombre} · {fechaHora(o.origen.lead_en)}</p>
          </div>
        </section>

        {ganada ? null : !perdida ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/60">Próxima acción</h3>
            {o.pendiente ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <VenceEtiqueta vence={o.pendiente.vence_el} hoy={d.hoy} tipo={o.pendiente.tipo} />
                  {o.pendiente.descripcion ? <p className="text-sm text-white/80">{o.pendiente.descripcion}</p> : null}
                </div>
                <Boton onClick={() => abrirModo("reprogramar")} disabled={bloqueado}>{o.pendiente.tipo === "retomar" ? "Cambiar fecha" : "Reprogramar"}</Boton>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white/60">Sin próxima acción programada.</p>
                <Boton onClick={() => abrirModo("programar")} disabled={bloqueado}>Programar próxima acción</Boton>
              </div>
            )}
          </section>
        ) : (
          <Aviso tipo="info" titulo={`Perdida el ${fechaHora(o.perdida?.en ?? null)}`}>
            Motivo: {textoMotivoPerdida(o.perdida?.motivo ?? null)}{o.perdida?.detalle ? ` — ${o.perdida.detalle}` : ""}.
            {o.perdida?.visitas_posteriores ? ` Hubo ${o.perdida.visitas_posteriores} visita(s) después de la pérdida.` : ""}
          </Aviso>
        )}

        <Historial d={d} />
      </div>
    </Panel>
  );
}

// ── Formularios de acción ───────────────────────────────────────────────────
const RAPIDAS = [["Mañana", 1], ["En 3 días", 3], ["En una semana", 7]] as const;
const RAPIDAS_PAUSA = [["En 2 semanas", 14], ["En un mes", 30], ["En 3 meses", 90]] as const;

function ElegirFecha({ etiqueta, valor, onCambio, hoy, rapidas, min, permitirSin }: {
  etiqueta: string; valor: string | null; onCambio: (v: string | null) => void; hoy: string; rapidas: ReadonlyArray<readonly [string, number]>; min: string; permitirSin?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-white/80">{etiqueta}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {rapidas.map(([t, n]) => {
          const f = sumarDias(hoy, n);
          return <button key={t} type="button" aria-pressed={valor === f} onClick={() => onCambio(valor === f ? null : f)}
            className={cx("min-h-11 rounded-xl border px-3 text-sm font-semibold", valor === f ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/80")}>{t}</button>;
        })}
        <input type="date" min={min} value={valor ?? ""} onChange={(e) => onCambio(e.target.value || null)} className={`${INPUT} w-auto`} aria-label={`${etiqueta}: elegir fecha`} />
        {permitirSin ? <button type="button" aria-pressed={valor === null} onClick={() => onCambio(null)}
          className={cx("min-h-11 rounded-xl border px-3 text-sm font-semibold", valor === null ? "border-white bg-white text-black" : "border-white/15 text-white/80")}>Sin próxima acción</button> : null}
      </div>
      <p className="text-xs text-white/50">{valor ? `Vence el ${fechaCorta(valor)}` : permitirSin ? "Va a quedar en «Sin próxima acción»." : "Elegí una fecha."}</p>
    </fieldset>
  );
}

function FormularioAccion({ modo, d, bloqueado, enviando, onCancelar, onEnviar }: {
  modo: Exclude<Modo, null>; d: DetalleOportunidadDto; bloqueado: boolean; enviando: boolean; onCancelar: () => void; onEnviar: (e: Envio, exito: string) => void;
}) {
  const o = d.fila;
  const hoy = d.hoy || hoyEnSim();
  // Perdida o ganada: solo se agregan notas (sin próxima acción ni cambio de estado).
  const perdida = o.estado === "perdida" || o.estado === "ganada";
  const [tipo, setTipo] = useState<string | null>(perdida ? "nota" : null);
  const [destino, setDestino] = useState<string | null>(modo === "reabrir" ? d.oportunidad.estado_al_perder : null);
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [obs, setObs] = useState("");
  const [cuando, setCuando] = useState("");
  const [contacto, setContacto] = useState(o.contacto?.id ?? "");
  const [resolver, setResolver] = useState(false);
  const [vence, setVence] = useState<string | null>(modo === "reprogramar" ? o.pendiente?.vence_el ?? null : null);
  const [desc, setDesc] = useState(modo === "reprogramar" ? o.pendiente?.descripcion ?? "" : "");
  const [motivoPerdida, setMotivoPerdida] = useState<string | null>(null);

  const pend = o.pendiente;
  const puedeResolver = !!pend && pend.tipo === "seguimiento" && tipo !== "nota" && !!tipo;
  const estadoFinal = tipo ? estadoTrasActividad(o.estado, tipo, destino) : o.estado;
  const retro = tipo === "cambio_estado" && !!destino && esRetroceso(o.estado, destino);
  const contactosActivos = d.contactos.filter((c) => !c.archivado);

  if (modo === "gestion") {
    const proximaBloqueada = !!pend && !(resolver && puedeResolver);
    const tipos = perdida ? TIPOS_ACTIVIDAD.filter((t) => t.valor === "nota")
      : o.estado === "pausada" ? TIPOS_ACTIVIDAD.filter((t) => t.valor !== "inicio_negociacion" && t.valor !== "cambio_estado") : TIPOS_ACTIVIDAD;
    const falta = !tipo ? "Elegí qué gestión registrás." : tipo === "nota" && !obs.trim() ? "Escribí la nota."
      : tipo === "cambio_estado" && !destino ? "Elegí el estado." : retro && !motivo.trim() ? "Un retroceso necesita motivo." : null;
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-black">{perdida ? "Agregar nota" : "Registrar gestión"}</h3>
        <Chips etiqueta="¿Qué hiciste o qué pasó?" opciones={tipos} valor={tipo as never} onCambio={(v) => { setTipo(v); if (v === "nota") setResolver(false); }} deshabilitado={bloqueado} />
        {tipo === "cambio_estado" ? (
          <Chips etiqueta="Nuevo estado" opciones={ESTADOS_OPORTUNIDAD.filter((e) => (ETAPAS as readonly string[]).includes(e.valor) && e.valor !== o.estado)} valor={destino as never}
            onCambio={(v) => setDestino(v)} deshabilitado={bloqueado} />
        ) : null}
        {tipo && tipo !== "nota" ? (
          <p className="text-sm text-white/70">Estado: <strong>{textoEstado(o.estado)}</strong>{estadoFinal !== o.estado ? <> → <strong>{textoEstado(estadoFinal)}</strong></> : " (no cambia)"}
            {tipo === "propuesta_enviada" ? " · queda registrada la propuesta; la negociación se marca aparte." : ""}
            {tipo === "respondio" && o.estado !== "contacto" ? " · responder no cambia una etapa más avanzada." : ""}</p>
        ) : null}
        {retro || tipo === "cambio_estado" ? (
          <label className="block space-y-1.5 text-sm font-semibold text-white/80">Motivo{retro ? " (obligatorio: es un retroceso)" : " (opcional)"}
            <input className={INPUT} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
        ) : null}
        {tipo && tipo !== "cambio_estado" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Contacto
              <select className={INPUT} value={contacto} onChange={(e) => setContacto(e.target.value)}>
                <option value="">Sin contacto</option>
                {d.contactos.map((c) => <option key={c.id} value={c.id}>{c.nombre ?? c.telefono ?? "Contacto"}{c.cargo ? ` · ${c.cargo}` : ""}{c.archivado ? " (archivado)" : ""}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">¿Cuándo fue? (Córdoba)
              <input type="datetime-local" className={INPUT} value={cuando} onChange={(e) => setCuando(e.target.value)} />
              <span className="block text-xs font-normal text-white/50">Vacío = ahora. Se guarda aparte del momento en que lo registrás.</span>
            </label>
          </div>
        ) : null}
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Observación{tipo === "nota" ? "" : " (opcional)"}
          <textarea className={`${INPUT} min-h-20`} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} />
          {tipo === "nota" ? <span className="block text-xs font-normal text-white/50">Una nota no cambia el estado ni completa la próxima acción.</span> : null}
        </label>
        {!perdida && pend?.tipo === "seguimiento" ? (
          <label className={cx("flex items-start gap-3 rounded-xl border p-3 text-sm", puedeResolver ? "border-white/15" : "border-white/5 opacity-60")}>
            <input type="checkbox" className="mt-1 h-5 w-5" checked={resolver && puedeResolver} disabled={!puedeResolver || bloqueado} onChange={(e) => setResolver(e.target.checked)} />
            <span>Esta gestión <strong>resuelve la próxima acción</strong>: «{pend.descripcion ?? "Seguimiento"}» (vence {pend.vence_el === hoy ? "hoy" : fechaCorta(pend.vence_el)}).
              {tipo === "nota" ? " Una nota no la resuelve." : ""}</span>
          </label>
        ) : null}
        {!perdida && o.estado !== "pausada" ? (
          proximaBloqueada ? (
            <p className="text-xs text-white/50">Ya hay una próxima acción pendiente: marcá que esta gestión la resuelve para programar la siguiente, o reprogramala desde «Próxima acción».</p>
          ) : (
            <>
              <ElegirFecha etiqueta="Próxima acción" valor={vence} onCambio={setVence} hoy={hoy} rapidas={RAPIDAS} min={hoy} permitirSin />
              {vence ? <label className="block space-y-1.5 text-sm font-semibold text-white/80">¿Qué hay que hacer? (opcional)
                <input className={INPUT} maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Llamar para cerrar la propuesta…" />
              </label> : null}
            </>
          )
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Boton variante="primario" cargando={enviando} disabled={bloqueado || !!falta} onClick={() => onEnviar({
            accion: "gestion", datos: {
              tipo, ...(tipo === "cambio_estado" ? { estado: destino } : {}), ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
              ...(obs.trim() ? { observacion: obs.trim() } : {}), ...(contacto && tipo !== "cambio_estado" ? { contacto_id: contacto } : {}),
              ...(cuando && tipo !== "cambio_estado" ? { ocurrida_en: `${cuando}:00-03:00` } : {}),
              ...(resolver && puedeResolver ? { resolver: pend!.id } : {}),
              ...(vence && !proximaBloqueada ? { proxima: { vence_el: vence, ...(desc.trim() ? { descripcion: desc.trim() } : {}) } } : {}),
            },
          }, "Gestión registrada")}>Guardar gestión</Boton>
          <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        </div>
        {falta ? <p className="text-xs text-white/50">{falta}</p> : null}
      </div>
    );
  }

  if (modo === "programar" || modo === "reprogramar") {
    const retomar = modo === "reprogramar" && pend?.tipo === "retomar";
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-black">{modo === "programar" ? "Programar próxima acción" : retomar ? "Cambiar la fecha para retomar" : "Reprogramar la próxima acción"}</h3>
        {modo === "reprogramar" && pend ? <p className="text-sm text-white/70">Hoy vence el {fechaCorta(pend.vence_el)}. La anterior queda en el historial como reprogramada.</p> : null}
        <ElegirFecha etiqueta={retomar ? "Retomar el" : "Vence el"} valor={vence} onCambio={setVence} hoy={hoy} rapidas={retomar ? RAPIDAS_PAUSA : RAPIDAS} min={retomar ? sumarDias(hoy, 1) : hoy} />
        {!retomar ? <label className="block space-y-1.5 text-sm font-semibold text-white/80">¿Qué hay que hacer? (opcional)
          <input className={INPUT} maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label> : null}
        {modo === "reprogramar" ? <label className="block space-y-1.5 text-sm font-semibold text-white/80">Motivo (opcional)
          <input className={INPUT} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label> : null}
        <div className="flex flex-wrap gap-2">
          <Boton variante="primario" cargando={enviando} disabled={bloqueado || !vence} onClick={() => onEnviar({
            accion: modo, datos: { vence_el: vence, ...(!retomar ? { descripcion: desc.trim() || null } : {}), ...(motivo.trim() ? { motivo: motivo.trim() } : {}) },
          }, modo === "programar" ? "Próxima acción programada" : "Reprogramada")}>Guardar</Boton>
          <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        </div>
      </div>
    );
  }

  if (modo === "pausar") {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-black">Retomar más adelante</h3>
        <p className="text-sm text-white/70">Queda en pausa con su estado actual ({textoEstado(o.estado)}).{pend ? " La próxima acción pendiente se cancela y la reemplaza «retomar»." : ""} El día elegido aparece en «Retomar: llegó la fecha».</p>
        <ElegirFecha etiqueta="Retomar el" valor={vence} onCambio={setVence} hoy={hoy} rapidas={RAPIDAS_PAUSA} min={sumarDias(hoy, 1)} />
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Motivo (opcional)
          <input className={INPUT} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Temporada alta, vuelve de vacaciones…" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Boton variante="primario" cargando={enviando} disabled={bloqueado || !vence || vence <= hoy} onClick={() => onEnviar({ accion: "pausar", datos: { retomar_el: vence, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) } }, "En pausa")}>Pausar</Boton>
          <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        </div>
      </div>
    );
  }

  if (modo === "retomar") {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-black">Retomar ahora</h3>
        <p className="text-sm text-white/70">Vuelve a {textoEstado(o.estado_previo)}. La acción «retomar» queda resuelta.</p>
        <ElegirFecha etiqueta="Próxima acción" valor={vence} onCambio={setVence} hoy={hoy} rapidas={RAPIDAS} min={hoy} permitirSin />
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Observación (opcional)
          <input className={INPUT} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Boton variante="primario" cargando={enviando} disabled={bloqueado} onClick={() => onEnviar({ accion: "retomar", datos: {
            ...(obs.trim() ? { observacion: obs.trim() } : {}), ...(vence ? { proxima: { vence_el: vence } } : {}),
          } }, "Retomada")}>Retomar</Boton>
          <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        </div>
      </div>
    );
  }

  if (modo === "perder") {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-black">Marcar perdida</h3>
        <p className="text-sm text-white/70">Se cierra con fecha y motivo. Se cancelan sus próximas acciones; las visitas, las gestiones y las revisitas de Tobías quedan.</p>
        <Chips etiqueta="Motivo" opciones={MOTIVOS_PERDIDA} valor={motivoPerdida as never} onCambio={(v) => setMotivoPerdida(v)} deshabilitado={bloqueado} />
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Detalle{motivoPerdida === "otro" ? " (obligatorio)" : " (opcional)"}
          <input className={INPUT} maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Boton variante="peligro" cargando={enviando} disabled={bloqueado || !motivoPerdida || (motivoPerdida === "otro" && !detalle.trim())}
            onClick={() => onEnviar({ accion: "perder", datos: { motivo: motivoPerdida, ...(detalle.trim() ? { detalle: detalle.trim() } : {}) } }, "Marcada como perdida")}>Marcar perdida</Boton>
          <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        </div>
      </div>
    );
  }

  if (modo === "reabrir") {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-black">Reabrir</h3>
        <p className="text-sm text-white/70">Empieza el ciclo {o.ciclo + 1}: la pérdida queda en el historial y los hitos del ciclo nuevo arrancan vacíos. El origen del lead no cambia.</p>
        <Chips etiqueta="Vuelve a" opciones={ESTADOS_OPORTUNIDAD.filter((e) => (ETAPAS as readonly string[]).includes(e.valor))} valor={destino as never} onCambio={(v) => setDestino(v)} deshabilitado={bloqueado} />
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Motivo (obligatorio)
          <input className={INPUT} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Volvió a escribir, cambió el encargado…" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Boton variante="primario" cargando={enviando} disabled={bloqueado || !motivo.trim() || !destino}
            onClick={() => onEnviar({ accion: "reabrir", datos: { motivo: motivo.trim(), estado: destino } }, "Reabierta")}>Reabrir</Boton>
          <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-black">Contacto principal</h3>
      <label className="block space-y-1.5 text-sm font-semibold text-white/80">Contacto
        <select className={INPUT} value={contacto} onChange={(e) => setContacto(e.target.value)}>
          <option value="">Elegí un contacto</option>
          {contactosActivos.map((c) => <option key={c.id} value={c.id}>{c.nombre ?? c.telefono ?? "Contacto"}{c.cargo ? ` · ${c.cargo}` : ""}{c.telefono ? ` · ${c.telefono}` : " · sin teléfono"}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={enviando} disabled={bloqueado || !contacto || contacto === o.contacto?.id}
          onClick={() => onEnviar({ accion: "contacto_principal", datos: { contacto_id: contacto } }, "Contacto principal actualizado")}>Guardar</Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
      </div>
    </div>
  );
}

// ── Historial (visitas de B1 + gestiones + próximas acciones + ciclos) ──────
function Historial({ d }: { d: DetalleOportunidadDto }) {
  type Item = { en: string; clave: string; titulo: string; detalle?: string; extra?: string; tono: "admin" | "calle" | "sistema" };
  const items: Item[] = [];
  for (const a of d.actividades) {
    const cambio = a.estado_despues ? `${textoEstado(a.estado_antes)} → ${textoEstado(a.estado_despues)}` : "";
    const titulo = a.tipo === "cambio_estado"
      ? a.estado_despues === "ganada" ? "Venta registrada" : a.estado_antes === "ganada" ? "Venta anulada" : a.estado_despues === "pausada" ? "Pausa: retomar más adelante" : a.estado_despues === "perdida" ? "Marcada como perdida" : a.estado_antes === "perdida" ? "Reapertura" : a.estado_antes === "pausada" ? "Retomada" : "Cambio de estado"
      : textoActividad(a.tipo);
    const desfase = Math.abs(new Date(a.registrada_en).getTime() - new Date(a.ocurrida_en).getTime()) > 5 * 60_000;
    items.push({
      en: a.ocurrida_en, clave: `a${a.id}`, tono: "admin",
      titulo: `${titulo}${cambio ? ` · ${cambio}` : ""}`,
      detalle: [a.estado_despues === "perdida" ? textoMotivoPerdida(a.motivo) : a.motivo ? `Motivo: ${a.motivo}` : "", a.observacion ?? "", a.contacto ? `Con ${a.contacto.nombre ?? "contacto"}` : ""].filter(Boolean).join(" · "),
      extra: `Administración${desfase ? ` · registrado el ${fechaHora(a.registrada_en)}` : ""}${a.ciclo > 1 ? ` · ciclo ${a.ciclo}` : ""}`,
    });
  }
  for (const s of d.seguimientos) {
    const que = s.tipo === "retomar" ? "Retomar" : s.descripcion ?? "Próxima acción";
    items.push({ en: s.creada_en, clave: `s${s.id}`, tono: "sistema", titulo: `${s.anterior_id ? "Reprogramada" : "Programada"}: ${que}`, detalle: `Para el ${fechaCorta(s.vence_el)}` });
    if (s.estado === "cancelada" && s.cerrada_en) items.push({ en: s.cerrada_en, clave: `c${s.id}`, tono: "sistema", titulo: `Cancelada: ${que}`, detalle: s.cancelada_motivo === "pausa" ? "Por la pausa" : s.cancelada_motivo === "ganada" ? "Por la venta (Ganado)" : "Por la pérdida" });
    if (s.estado === "hecha" && s.cerrada_en) {
      const a = d.actividades.find((x) => x.id === s.resuelta_por_actividad_id);
      items.push({ en: s.cerrada_en, clave: `h${s.id}`, tono: "sistema", titulo: `Resuelta: ${que}`, detalle: a ? `Con «${a.tipo === "cambio_estado" ? "Retomar ahora" : textoActividad(a.tipo)}»` : undefined });
    }
  }
  for (const v of d.visitas) {
    items.push({
      en: v.ocurrida_en, clave: `v${v.id}`, tono: "calle",
      titulo: `Visita de ${v.realizada_por.nombre}${v.anulada ? " (anulada)" : ""}${v.es_origen_oportunidad ? " · originó el lead" : ""}`,
      detalle: [hechosVisita(v).join(" · "), v.interes ? `Interés: ${texto(INTERESES, v.interes)}` : "", v.observacion ?? ""].filter(Boolean).join(" · "),
      extra: v.notas.length ? `Notas: ${v.notas.map((n) => `«${n.texto}» (${fechaHora(n.creada_en)})`).join(" ")}` : undefined,
    });
  }
  for (const c of d.ciclos) {
    items.push({ en: c.reabierta_en, clave: `ci${c.ciclo}`, tono: "sistema", titulo: `Fin del ciclo ${c.ciclo}`,
      detalle: `Perdida el ${fechaHora(c.perdida_en)} (${textoMotivoPerdida(c.perdida_motivo)}) · reabierta: ${c.reapertura_motivo}` });
  }
  items.sort((a, b) => b.en.localeCompare(a.en));
  return (
    <section aria-labelledby="historial" className="space-y-2">
      <h3 id="historial" className="text-xs font-bold uppercase tracking-wide text-white/60">Historial</h3>
      <ol className="space-y-2">
        {items.map((i) => (
          <li key={i.clave} className={cx("rounded-xl border p-3 text-sm", i.tono === "admin" ? "border-white/15 bg-white/[0.04]" : i.tono === "calle" ? "border-sky-500/20 bg-sky-950/10" : "border-white/5")}>
            <p className="flex flex-wrap justify-between gap-2"><span className="font-bold">{i.titulo}</span><span className="text-xs text-white/50">{fechaHora(i.en)}</span></p>
            {i.detalle ? <p className="mt-0.5 text-white/75">{i.detalle}</p> : null}
            {i.extra ? <p className="mt-0.5 text-xs text-white/50">{i.extra}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
