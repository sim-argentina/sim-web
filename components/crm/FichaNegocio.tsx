"use client";

// Ficha de un negocio (CRM B1). La misma pantalla para el comercial (sus negocios)
// y para la administración; lo que cambia lo decide el servidor, la pantalla solo
// muestra lo que corresponde:
//   · comercial: datos comerciales editables, contactos, visitas (las suyas puede
//     completarlas con una observación, sin reemplazar el registro), lead y revisita;
//   · admin: además responsable, cliente previo, archivo, corrección y anulación de
//     visitas con motivo, y registrar una visita realizada por un comercial.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, MessageSquarePlus, Pencil, Plus, RotateCcw, Undo2 } from "lucide-react";
import { Aviso, Boton, Cargando, Chips, ChipsMultiples, Dialogo, Etiqueta, Panel } from "@/app/admin/(panel)/interacciones/ui";
import { hoyEnSim } from "@/lib/agenda";
import { DECISOR, INTERESES, NECESIDADES, PACKS, texto, type Catalogo, type FichaEmpresaDto, type Interes, type Necesidad, type Pack, type VisitaDto } from "@/lib/crmB1";
import { enviar, pedir } from "./api";
import {
  CamposContacto, CamposEmpresa, INPUT, OTRO_RUBRO, ResumenVisita, Selector, TelefonoContacto, contactoVacio, datosContacto, datosEmpresa,
  EstadoNegocioEtiqueta, fechaCorta, fechaHora, type ValoresContacto, type ValoresEmpresa,
} from "./campos";
import FormularioVisita from "./FormularioVisita";

type Comercial = { id: string; nombre: string; activo: boolean };
type CatalogoAdmin = Catalogo & { usuarios?: Comercial[] };

export default function FichaNegocio({ modo, apiBase, id, rutaNuevaVisita, baseJornada }: {
  modo: "comercial" | "admin";
  apiBase: string;
  id: string;
  rutaNuevaVisita?: string;
  /** Prefijo del detalle de jornada: se le agrega el id. */
  baseJornada: string;
}) {
  const [ficha, setFicha] = useState<FichaEmpresaDto | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [editando, setEditando] = useState<ValoresEmpresa | null>(null);
  const [responsable, setResponsable] = useState("");
  const [clientePrevio, setClientePrevio] = useState(false);
  const [contactoNuevo, setContactoNuevo] = useState<ValoresContacto | null>(null);
  const [contactoEdit, setContactoEdit] = useState<{ id: string; version: number; valores: ValoresContacto } | null>(null);
  const [nota, setNota] = useState<{ visita: VisitaDto; texto: string } | null>(null);
  const [correccion, setCorreccion] = useState<{ visita: VisitaDto; interes: Interes | null; necesidades: Necesidad[]; otra: string; pack: Pack | null; observacion: string; motivo: string } | null>(null);
  const [anulacion, setAnulacion] = useState<{ visita: VisitaDto; motivo: string; resolucion: string; nuevo: string } | null>(null);
  const [archivo, setArchivo] = useState<{ motivo: string } | null>(null);
  const [registrar, setRegistrar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([pedir<FichaEmpresaDto>(`${apiBase}/negocios/${id}`), pedir<CatalogoAdmin>(`${apiBase}/catalogo`)]).then(([f, c]) => {
      if (!vivo) return;
      if (f.ok) { setFicha(f.data); setError(null); } else setError(f.error);
      if (c.ok) setCatalogo(c.data);
    });
    return () => { vivo = false; };
  }, [apiBase, id, recarga]);

  const recargar = useCallback(() => setRecarga((n) => n + 1), []);
  async function hacer(promesa: ReturnType<typeof enviar>, exito: string): Promise<boolean> {
    setTrabajando(true);
    const r = await promesa;
    setTrabajando(false);
    if (!r.ok) { setAviso({ tipo: "error", texto: r.error }); return false; }
    setAviso({ tipo: "exito", texto: exito });
    recargar();
    return true;
  }

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!ficha || !catalogo) return <Cargando />;
  const e = ficha.empresa;
  const oportunidad = ficha.oportunidades.find((o) => o.abierta) ?? null;

  const abrirEdicion = () => {
    setEditando({
      nombre_comercial: e.nombre_comercial, rubro: e.rubro_id ?? (e.rubro_detalle ? OTRO_RUBRO : ""), rubro_detalle: e.rubro_detalle ?? "",
      direccion: e.direccion ?? "", zona_id: e.zona_id ?? "", instagram: e.instagram ?? "", web: e.web ?? "", prioridad: e.prioridad,
    });
    setResponsable(e.responsable?.id ?? "");
    setClientePrevio(e.cliente_previo);
  };
  const guardarEdicion = async () => {
    if (!editando) return;
    const cambios: Record<string, unknown> = datosEmpresa(editando);
    if (modo === "admin") Object.assign(cambios, { responsable_id: responsable || null, cliente_previo: clientePrevio });
    if (await hacer(enviar(`${apiBase}/negocios/${id}`, "PATCH", { accion: "actualizar", version: e.version, cambios }), "Datos guardados.")) setEditando(null);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="titulo-pagina" tabIndex={-1} className="text-2xl font-black outline-none md:text-3xl">{e.nombre_comercial}</h1>
          <EstadoNegocioEtiqueta estado={e.estado} />
          {e.prioridad ? <Etiqueta>Prioridad {e.prioridad}</Etiqueta> : null}
          {e.cliente_previo ? <Etiqueta>Cliente previo</Etiqueta> : null}
        </div>
        <p className="text-sm text-white/70">{[e.rubro ?? (e.rubro_detalle ? `${e.rubro_detalle} (rubro sin clasificar)` : "Sin rubro"), e.zona, e.direccion].filter(Boolean).join(" · ")}</p>
        {e.instagram || e.web ? <p className="text-sm text-white/60">{[e.instagram, e.web].filter(Boolean).join(" · ")}</p> : null}
        {modo === "admin" ? (
          <p className="text-sm text-white/60">Responsable: <b>{e.responsable?.nombre ?? "sin asignar"}</b> · origen: {e.origen === "visita" ? "creado al registrar una visita" : e.origen === "importacion" ? "importación" : "alta manual"}
            {e.archivada_motivo ? ` · archivado: ${e.archivada_motivo}` : ""}</p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {modo === "comercial" && rutaNuevaVisita ? (
            <Link href={rutaNuevaVisita} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700"><Plus className="h-4 w-4" aria-hidden />Registrar visita</Link>
          ) : null}
          {modo === "admin" && e.estado !== "archivado" ? <Boton variante="primario" onClick={() => setRegistrar(true)}><Plus className="h-4 w-4" aria-hidden />Registrar visita realizada por un comercial</Boton> : null}
          <Boton onClick={abrirEdicion}><Pencil className="h-4 w-4" aria-hidden />Editar datos</Boton>
          {modo === "admin" ? (
            e.estado === "archivado"
              ? <Boton disabled={trabajando} onClick={() => void hacer(enviar(`${apiBase}/negocios/${id}`, "PATCH", { accion: "desarchivar", version: e.version }), "Negocio desarchivado.")}><RotateCcw className="h-4 w-4" aria-hidden />Desarchivar</Boton>
              : <Boton variante="peligro" onClick={() => setArchivo({ motivo: "" })}><Archive className="h-4 w-4" aria-hidden />Archivar</Boton>
          ) : null}
        </div>
      </header>

      <div aria-live="polite">{aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}</div>

      {ficha.similares?.length ? (
        <Aviso tipo="alerta" titulo="Se creó con negocios parecidos (se confirmó que es otro)">
          <ul className="mt-1 list-disc pl-5">{ficha.similares.map((s) => <li key={s.id}><a className="underline" href={`/admin/crm/negocios/${s.id}`}>{s.nombre_comercial}</a></li>)}</ul>
        </Aviso>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-black">Seguimiento</h2>
        {oportunidad ? (
          <div className="rounded-2xl border border-green-500/30 bg-green-950/20 p-4 text-sm">
            <p className="font-bold">Lead para Administración · {oportunidad.estado === "interesado" ? "Interesado" : "Contacto conseguido"}</p>
            <p className="text-white/70">Originado por {oportunidad.origen.nombre} el {fechaHora(oportunidad.lead_en)}.</p>
          </div>
        ) : <p className="text-sm text-white/60">Sin lead abierto: se crea cuando una visita registra un contacto útil.</p>}
        {modo === "admin" ? ficha.oportunidades.filter((o) => !o.abierta).map((o) => (
          <p key={o.id} className="text-xs text-white/50">Lead cerrado ({o.cierre_motivo === "origen_anulado" ? "se anuló la visita que lo originó" : o.cierre_motivo}) · {fechaHora(o.lead_en)}</p>
        )) : null}
        {ficha.revisita ? (
          <Revisita key={`${ficha.revisita.id}-${ficha.revisita.version}`} apiBase={apiBase} revisita={ficha.revisita} onHecho={(t) => { setAviso({ tipo: "exito", texto: t }); recargar(); }} onError={(t) => setAviso({ tipo: "error", texto: t })} />
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black">Contactos</h2>
          {e.estado !== "archivado" ? <Boton onClick={() => setContactoNuevo(contactoVacio())}><Plus className="h-4 w-4" aria-hidden />Agregar</Boton> : null}
        </div>
        {ficha.contactos.length === 0 ? <p className="text-sm text-white/60">Todavía no hay contactos.</p> : (
          <ul className="space-y-2">
            {ficha.contactos.map((c) => (
              <li key={c.id} className={`rounded-2xl border border-white/10 p-3 ${c.archivado ? "opacity-50" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{c.nombre ?? "Sin nombre"}{c.cargo ? <span className="font-normal text-white/60"> · {c.cargo}</span> : null}</p>
                    <p className="text-sm"><TelefonoContacto c={c} /></p>
                    <p className="text-xs text-white/50">¿Decide? {texto(DECISOR, c.es_decisor)}{c.archivado ? " · archivado" : ""}</p>
                  </div>
                  <div className="flex gap-2">
                    <Boton variante="fantasma" onClick={() => setContactoEdit({ id: c.id, version: c.version, valores: { nombre: c.nombre ?? "", cargo: c.cargo ?? "", telefono: c.telefono ?? "", tiene_whatsapp: c.tiene_whatsapp === null ? null : c.tiene_whatsapp ? "si" : "no", es_decisor: c.es_decisor } })}>Editar</Boton>
                    {modo === "admin" ? (
                      <Boton variante="fantasma" disabled={trabajando} onClick={() => void hacer(enviar(`${apiBase}/contactos/${c.id}`, "PATCH", { version: c.version, cambios: { archivado: !c.archivado } }), c.archivado ? "Contacto reactivado." : "Contacto archivado.")}>
                        {c.archivado ? "Reactivar" : "Archivar"}
                      </Boton>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-black">Visitas</h2>
        {ficha.visitas.length === 0 ? <p className="text-sm text-white/60">Todavía no hay visitas.</p> : (
          <ul className="space-y-3">
            {ficha.visitas.map((v) => (
              <ResumenVisita key={v.id} v={v} acciones={
                <>
                  <Link href={`${baseJornada}${v.jornada_id}`} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-white/70 hover:text-white">Ver jornada</Link>
                  {!v.anulada && (modo === "admin" || v.realizada_por.tipo === "vos") ? (
                    <Boton variante="fantasma" onClick={() => setNota({ visita: v, texto: "" })}><MessageSquarePlus className="h-4 w-4" aria-hidden />Agregar observación</Boton>
                  ) : null}
                  {modo === "admin" && !v.anulada ? (
                    <>
                      <Boton variante="fantasma" onClick={() => setCorreccion({ visita: v, interes: v.interes, necesidades: v.necesidades, otra: v.necesidad_otra ?? "", pack: v.pack_potencial, observacion: v.observacion ?? "", motivo: "" })}><Pencil className="h-4 w-4" aria-hidden />Corregir</Boton>
                      <Boton variante="peligro" onClick={() => setAnulacion({ visita: v, motivo: "", resolucion: "", nuevo: "" })}><Undo2 className="h-4 w-4" aria-hidden />Anular</Boton>
                    </>
                  ) : null}
                </>
              } />
            ))}
          </ul>
        )}
      </section>

      {editando ? (
        <Panel titulo="Editar negocio" onCerrar={() => setEditando(null)} pie={<Boton variante="primario" className="w-full" cargando={trabajando} onClick={() => void guardarEdicion()}>Guardar</Boton>}>
          <div className="space-y-4">
            <CamposEmpresa valores={editando} onCambio={setEditando} catalogo={catalogo} />
            {modo === "admin" ? (
              <>
                <Selector etiqueta="Responsable comercial" valor={responsable} onCambio={setResponsable} vacio="Sin asignar"
                  opciones={(catalogo.usuarios ?? []).filter((u) => u.activo || u.id === responsable).map((u) => ({ valor: u.id, texto: u.nombre }))} />
                <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-white/80">
                  <input type="checkbox" checked={clientePrevio} onChange={(ev) => setClientePrevio(ev.target.checked)} className="h-5 w-5 accent-red-600" />Cliente previo (ya compró antes)
                </label>
              </>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {contactoNuevo ? (
        <Panel titulo="Nuevo contacto" onCerrar={() => setContactoNuevo(null)} pie={
          <Boton variante="primario" className="w-full" cargando={trabajando}
            onClick={async () => { if (await hacer(enviar(`${apiBase}/negocios/${id}/contactos`, "POST", { datos: datosContacto(contactoNuevo) }), "Contacto agregado. Cargarlo en la ficha no crea un lead: eso lo registra una visita.")) setContactoNuevo(null); }}>Guardar contacto</Boton>}>
          <CamposContacto valores={contactoNuevo} onCambio={setContactoNuevo} autoFoco />
        </Panel>
      ) : null}

      {contactoEdit ? (
        <Panel titulo="Editar contacto" onCerrar={() => setContactoEdit(null)} pie={
          <Boton variante="primario" className="w-full" cargando={trabajando}
            onClick={async () => { if (await hacer(enviar(`${apiBase}/contactos/${contactoEdit.id}`, "PATCH", { version: contactoEdit.version, cambios: datosContacto(contactoEdit.valores) }), "Contacto guardado.")) setContactoEdit(null); }}>Guardar</Boton>}>
          <CamposContacto valores={contactoEdit.valores} onCambio={(v) => setContactoEdit({ ...contactoEdit, valores: v })} />
        </Panel>
      ) : null}

      {nota ? (
        <Dialogo titulo="Agregar observación" onCerrar={() => setNota(null)} acciones={
          <>
            <Boton variante="fantasma" onClick={() => setNota(null)}>Volver</Boton>
            <Boton variante="primario" cargando={trabajando} disabled={!nota.texto.trim()}
              onClick={async () => { if (await hacer(enviar(`${apiBase}/visitas/${nota.visita.id}/notas`, "POST", { texto: nota.texto }), "Observación agregada.")) setNota(null); }}>Agregar</Boton>
          </>}>
          <p className="mb-2">Se suma a la visita del {fechaCorta(nota.visita.fecha)}; el registro original no cambia.</p>
          <textarea className={`${INPUT} min-h-24`} maxLength={1000} value={nota.texto} onChange={(ev) => setNota({ ...nota, texto: ev.target.value })} aria-label="Observación" />
        </Dialogo>
      ) : null}

      {correccion ? (
        <Panel titulo="Corregir visita" onCerrar={() => setCorreccion(null)} pie={
          <Boton variante="primario" className="w-full" cargando={trabajando} disabled={!correccion.motivo.trim()}
            onClick={async () => {
              const cambios = { interes: correccion.interes, necesidades: correccion.necesidades, necesidad_otra: correccion.necesidades.includes("otra") ? correccion.otra.trim() || null : null, pack_potencial: correccion.pack, observacion: correccion.observacion.trim() || null };
              if (await hacer(enviar(`${apiBase}/visitas/${correccion.visita.id}`, "PATCH", { accion: "corregir", version: correccion.visita.version, cambios, motivo: correccion.motivo }), "Visita corregida (queda en la auditoría).")) setCorreccion(null);
            }}>Guardar corrección</Boton>}>
          <div className="space-y-4">
            <Aviso tipo="info">Se corrigen interés, necesidades, pack y observación. Lo que cambia quién obtuvo el contacto o qué pasó se resuelve anulando y volviendo a registrar.</Aviso>
            {!correccion.visita.cerrado ? (
              <>
                <Chips etiqueta="Interés" opciones={INTERESES} valor={correccion.interes} onCambio={(v) => setCorreccion({ ...correccion, interes: v })} ayuda="Sin elegir = no evaluado." />
                <ChipsMultiples etiqueta="Necesidades" opciones={NECESIDADES} valor={correccion.necesidades} onCambio={(v) => setCorreccion({ ...correccion, necesidades: v as Necesidad[] })} />
                {correccion.necesidades.includes("otra") ? <input className={INPUT} value={correccion.otra} onChange={(ev) => setCorreccion({ ...correccion, otra: ev.target.value })} placeholder="¿Cuál?" aria-label="Otra necesidad" /> : null}
                <Chips etiqueta="Pack potencial" opciones={PACKS} valor={correccion.pack} onCambio={(v) => setCorreccion({ ...correccion, pack: v })} />
              </>
            ) : null}
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Observación
              <textarea className={`${INPUT} min-h-20`} maxLength={1000} value={correccion.observacion} onChange={(ev) => setCorreccion({ ...correccion, observacion: ev.target.value })} />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Motivo de la corrección (obligatorio)
              <input className={INPUT} maxLength={300} value={correccion.motivo} onChange={(ev) => setCorreccion({ ...correccion, motivo: ev.target.value })} />
            </label>
          </div>
        </Panel>
      ) : null}

      {anulacion ? (
        <Dialogo titulo="Anular visita" onCerrar={() => setAnulacion(null)} acciones={
          <>
            <Boton variante="fantasma" onClick={() => setAnulacion(null)}>Volver</Boton>
            <Boton variante="peligro" cargando={trabajando}
              disabled={!anulacion.motivo.trim() || (anulacion.visita.es_origen_oportunidad && !!oportunidad && (!anulacion.resolucion || (anulacion.resolucion === "reasignar_origen" && !anulacion.nuevo)))}
              onClick={async () => {
                const esOrigen = anulacion.visita.es_origen_oportunidad && !!oportunidad;
                if (await hacer(enviar(`${apiBase}/visitas/${anulacion.visita.id}`, "PATCH", {
                  accion: "anular", version: anulacion.visita.version, motivo: anulacion.motivo,
                  resolucion: esOrigen ? anulacion.resolucion : null, nuevo_origen: esOrigen && anulacion.resolucion === "reasignar_origen" ? anulacion.nuevo : null,
                }), "Visita anulada (queda en la historia y en la auditoría).")) setAnulacion(null);
              }}>Anular</Boton>
          </>}>
          <div className="space-y-3">
            <p>La visita no se borra: queda marcada como anulada, con el motivo, y sale de los conteos.</p>
            <input className={INPUT} maxLength={300} placeholder="Motivo (obligatorio)" value={anulacion.motivo} onChange={(ev) => setAnulacion({ ...anulacion, motivo: ev.target.value })} aria-label="Motivo" />
            {anulacion.visita.es_origen_oportunidad && oportunidad ? (
              <div className="space-y-2">
                <p className="font-semibold">Esta visita originó el lead abierto. ¿Qué hacemos con él?</p>
                <label className="flex items-center gap-2"><input type="radio" name="res" checked={anulacion.resolucion === "cerrar_oportunidad"} onChange={() => setAnulacion({ ...anulacion, resolucion: "cerrar_oportunidad", nuevo: "" })} />Cerrar el lead (no se borra)</label>
                {(() => {
                  const otras = ficha.visitas.filter((x) => x.id !== anulacion.visita.id && !x.anulada && x.contacto_util);
                  return otras.length ? (
                    <>
                      <label className="flex items-center gap-2"><input type="radio" name="res" checked={anulacion.resolucion === "reasignar_origen"} onChange={() => setAnulacion({ ...anulacion, resolucion: "reasignar_origen" })} />Pasar el origen a otra visita con contacto útil</label>
                      {anulacion.resolucion === "reasignar_origen" ? (
                        <select className={INPUT} value={anulacion.nuevo} onChange={(ev) => setAnulacion({ ...anulacion, nuevo: ev.target.value })} aria-label="Nueva visita de origen">
                          <option value="">Elegí la visita</option>
                          {otras.map((x) => <option key={x.id} value={x.id}>{fechaHora(x.ocurrida_en)} · {x.realizada_por.nombre}</option>)}
                        </select>
                      ) : null}
                    </>
                  ) : <p className="text-xs text-white/60">No hay otra visita con contacto útil a la que pasar el origen.</p>;
                })()}
              </div>
            ) : null}
          </div>
        </Dialogo>
      ) : null}

      {archivo ? (
        <Dialogo titulo="Archivar negocio" onCerrar={() => setArchivo(null)} acciones={
          <>
            <Boton variante="fantasma" onClick={() => setArchivo(null)}>Volver</Boton>
            <Boton variante="peligro" cargando={trabajando} disabled={!archivo.motivo.trim()}
              onClick={async () => { if (await hacer(enviar(`${apiBase}/negocios/${id}`, "PATCH", { accion: "archivar", version: e.version, motivo: archivo.motivo }), "Negocio archivado.")) setArchivo(null); }}>Archivar</Boton>
          </>}>
          <p className="mb-2">Sale de las listas operativas (y de las del comercial). Sus visitas y su historia se conservan.</p>
          <input className={INPUT} maxLength={300} placeholder="Motivo (obligatorio)" value={archivo.motivo} onChange={(ev) => setArchivo({ motivo: ev.target.value })} aria-label="Motivo" />
        </Dialogo>
      ) : null}

      {registrar ? (
        <Panel titulo="Registrar visita realizada por un comercial" onCerrar={() => setRegistrar(false)}>
          <FormularioVisita modo="admin" apiBase={apiBase} catalogo={catalogo} empresaInicial={{ id: e.id, nombre: e.nombre_comercial }} empresaFija
            comerciales={catalogo.usuarios} onGuardada={() => { setRegistrar(false); setAviso({ tipo: "exito", texto: "Visita registrada. Figura como realizada por el comercial y cargada por Administración." }); recargar(); }} />
        </Panel>
      ) : null}
    </div>
  );
}

function Revisita({ apiBase, revisita, onHecho, onError }: {
  apiBase: string; revisita: NonNullable<FichaEmpresaDto["revisita"]>; onHecho: (t: string) => void; onError: (t: string) => void;
}) {
  const [fecha, setFecha] = useState(revisita.vence_el ?? "");
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const accion = async (cuerpo: Record<string, unknown>, exito: string) => {
    setTrabajando(true);
    const r = await enviar(`${apiBase}/tareas/${revisita.id}`, "PATCH", { version: revisita.version, ...cuerpo });
    setTrabajando(false);
    if (r.ok) onHecho(exito); else onError(r.error);
  };
  return (
    <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-950/10 p-4 text-sm">
      <p className="font-bold">Revisita pendiente · {revisita.vence_el ? fechaCorta(revisita.vence_el) : "sin fecha"}{revisita.responsable && revisita.responsable.tipo !== "vos" ? ` · ${revisita.responsable.nombre}` : ""}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" min={hoyEnSim()} value={fecha} onChange={(ev) => setFecha(ev.target.value)} className={`${INPUT} w-auto`} aria-label="Nueva fecha" />
        <Boton disabled={trabajando} onClick={() => void accion({ accion: "reprogramar", vence_el: fecha || null }, "Revisita reprogramada.")}>Reprogramar</Boton>
        {cancelando === null ? <Boton variante="fantasma" onClick={() => setCancelando("")}>Cancelar revisita</Boton> : (
          <>
            <input className={`${INPUT} w-auto flex-1`} maxLength={200} placeholder="Motivo" value={cancelando} onChange={(ev) => setCancelando(ev.target.value)} aria-label="Motivo de cancelación" />
            <Boton variante="peligro" disabled={trabajando || !cancelando.trim()} onClick={() => void accion({ accion: "cancelar", motivo: cancelando }, "Revisita cancelada.")}>Confirmar</Boton>
          </>
        )}
      </div>
    </div>
  );
}
