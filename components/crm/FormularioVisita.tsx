"use client";

// Registro de una visita en UNA pantalla (CRM B1). Lo usan el comercial (desde el
// celular, con su jornada activa) y la administración (para cargar una visita que
// realizó un comercial: elige comercial, jornada y hora).
//
// Guardado (mismo patrón que Interacciones):
//   · una clave de idempotencia por visita; un doble toque o un reintento con la
//     misma clave y el mismo contenido devuelve la visita ya guardada;
//   · si la respuesta es INCIERTA (sin conexión o 5xx) el contenido se bloquea y
//     solo se puede reintentar con la misma clave: nunca se crea otra visita;
//   · un error conocido (dato inválido, duplicado) conserva todo lo completado;
//   · al confirmarse se limpia el formulario y el borrador.
// Borrador: solo en la interfaz comercial, en este dispositivo y con la clave del
// usuario autenticado (otro usuario del mismo dispositivo no lo ve). No hay cola
// sin conexión.
// Hechos separados: "¿Qué pasó?" (cerrado / empleado / responsable / responsable
// ausente), contacto útil obtenido y "hablé con esta persona" son independientes.
// Interés sin elegir = no evaluado.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, LoaderCircle, Plus, Search } from "lucide-react";
import { Aviso, Boton, Chips, ChipsMultiples, Plegable, cx } from "@/app/admin/(panel)/interacciones/ui";
import { hoyEnSim, sumarDias } from "@/lib/agenda";
import {
  INTERESES, NECESIDADES, PACKS, claveBorrador,
  type Catalogo, type CandidatoDuplicado, type ContactoDto, type EmpresaDto, type FichaEmpresaDto, type Interes, type JornadaDto,
  type Necesidad, type Pack, type ResultadoVisita,
} from "@/lib/crmB1";
import { enviar, pedir } from "./api";
import {
  CamposContacto, CamposEmpresa, INPUT, contactoVacio, datosContacto, datosEmpresa, empresaVacia, fechaCorta,
  type ValoresContacto, type ValoresEmpresa,
} from "./campos";

type Empresa = { tipo: "existente"; id: string; nombre: string } | { tipo: "nueva"; valores: ValoresEmpresa } | null;
type Contacto = { tipo: "existente"; id: string; nombre: string } | { tipo: "nuevo"; valores: ValoresContacto } | null;
// Alta de contacto abierta sin ningún dato = sin contacto (no bloquea el guardado).
const contactoSinDatos = (c: Contacto) => c?.tipo === "nuevo" && !c.valores.nombre.trim() && !c.valores.telefono.trim() && !c.valores.cargo.trim();
type Form = {
  empresa: Empresa; confirmar_duplicado: boolean;
  cerrado: boolean; empleado: boolean; responsable: boolean; ausente: boolean;
  contacto: Contacto; obtenido: boolean; hablo: boolean;
  interes: Interes | null; necesidades: Necesidad[]; necesidad_otra: string; pack: Pack | null;
  volver: boolean; revisita: string | null; observacion: string;
  realizada_por: string; jornada_id: string; ocurrida_en: string;
};
type Borrador = { form: Form; clave: string; incierto: boolean };
export type VisitaGuardada = Extract<ResultadoVisita, { resultado: "ok" }>;

const formVacio = (empresa: Empresa): Form => ({
  empresa, confirmar_duplicado: false, cerrado: false, empleado: false, responsable: false, ausente: false,
  contacto: null, obtenido: false, hablo: false, interes: null, necesidades: [], necesidad_otra: "", pack: null,
  volver: false, revisita: null, observacion: "", realizada_por: "", jornada_id: "", ocurrida_en: "",
});

function leerBorrador(usuarioId: string | undefined): Borrador | null {
  if (!usuarioId) return null;
  try {
    const b = JSON.parse(localStorage.getItem(claveBorrador(usuarioId)) ?? "null") as Borrador | null;
    return b && typeof b.clave === "string" && b.form && typeof b.form === "object" ? b : null;
  } catch {
    return null;
  }
}
function guardarBorrador(usuarioId: string | undefined, b: Borrador | null) {
  if (!usuarioId) return;
  try {
    if (b) localStorage.setItem(claveBorrador(usuarioId), JSON.stringify(b));
    else localStorage.removeItem(claveBorrador(usuarioId));
  } catch { /* sin almacenamiento: se sigue sin borrador */ }
}
const tieneContenido = (f: Form) =>
  !!f.empresa || f.cerrado || f.empleado || f.responsable || !!f.contacto || f.interes !== null || f.necesidades.length > 0 || f.pack !== null || f.volver || !!f.observacion.trim();

const sinSuscripcion = () => () => {};

type Props = {
  modo: "comercial" | "admin";
  apiBase: string;
  catalogo: Catalogo;
  usuarioId?: string;
  jornada?: Pick<JornadaDto, "id" | "nombre" | "fecha" | "zona_id"> | null;
  empresaInicial?: { id: string; nombre: string } | null;
  empresaFija?: boolean;
  comerciales?: Array<{ id: string; nombre: string; activo: boolean }>;
  onGuardada: (r: VisitaGuardada, empresa: string) => void;
};

export default function FormularioVisita(props: Props) {
  const listo = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  if (!listo) return <p className="py-6 text-sm text-white/60">Cargando…</p>;
  const b = props.modo === "comercial" ? leerBorrador(props.usuarioId) : null;
  const inicial: Empresa = props.empresaInicial ? { tipo: "existente", ...props.empresaInicial } : null;
  return <FormularioInterno {...props} inicial={b ?? { form: formVacio(inicial), clave: crypto.randomUUID(), incierto: false }} recuperado={!!b && tieneContenido(b.form)} />;
}

function FormularioInterno({ modo, apiBase, catalogo, usuarioId, jornada, empresaFija, comerciales, onGuardada, inicial, recuperado }: Props & { inicial: Borrador; recuperado: boolean }) {
  const [form, setForm] = useState<Form>(inicial.form);
  const [clave, setClave] = useState(inicial.clave);
  const [incierto, setIncierto] = useState(inicial.incierto);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatoDuplicado[] | null>(null);
  const [avisoBorrador, setAvisoBorrador] = useState(recuperado);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<EmpresaDto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [contactos, setContactos] = useState<ContactoDto[]>([]);
  const [jornadas, setJornadas] = useState<JornadaDto[]>([]);
  const [abierto, setAbierto] = useState({ contacto: !!inicial.form.contacto, detalle: inicial.form.necesidades.length > 0 || inicial.form.pack !== null });

  const actualizar = (cambios: Partial<Form>) => {
    setForm((f) => {
      const nuevo = { ...f, ...cambios };
      if (modo === "comercial") guardarBorrador(usuarioId, tieneContenido(nuevo) ? { form: nuevo, clave, incierto: false } : null);
      return nuevo;
    });
    setError(null);
  };

  // Búsqueda de negocios (los propios, o todos para admin).
  useEffect(() => {
    if (empresaFija || form.empresa) return;
    const q = busqueda.trim();
    let vivo = true;
    const t = setTimeout(() => {
      setBuscando(true);
      pedir<{ negocios: EmpresaDto[] }>(`${apiBase}/negocios?q=${encodeURIComponent(q)}`).then((r) => {
        if (!vivo) return;
        setBuscando(false);
        setResultados(r.ok ? r.data.negocios.slice(0, 8) : []);
      });
    }, q ? 250 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [busqueda, apiBase, empresaFija, form.empresa]);

  // Contactos del negocio elegido.
  const empresaId = form.empresa?.tipo === "existente" ? form.empresa.id : null;
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    pedir<FichaEmpresaDto>(`${apiBase}/negocios/${empresaId}`).then((r) => { if (vivo) setContactos(r.ok ? r.data.contactos.filter((c) => !c.archivado) : []); });
    return () => { vivo = false; };
  }, [empresaId, apiBase]);

  // Admin: jornadas del comercial elegido.
  useEffect(() => {
    if (modo !== "admin" || !form.realizada_por) return;
    let vivo = true;
    pedir<{ jornadas: JornadaDto[] }>(`${apiBase}/jornadas?usuario=${form.realizada_por}`).then((r) => { if (vivo) setJornadas(r.ok ? r.data.jornadas : []); });
    return () => { vivo = false; };
  }, [modo, form.realizada_por, apiBase]);

  const hoy = hoyEnSim();
  const datos = (): Record<string, unknown> => {
    const f = form;
    const d: Record<string, unknown> = {
      jornada_id: modo === "comercial" ? jornada?.id : f.jornada_id,
      cerrado: f.cerrado, hablo_con_empleado: !f.cerrado && f.empleado, hablo_con_responsable: !f.cerrado && f.responsable,
      responsable_ausente: !f.cerrado && f.ausente, volver_otro_dia: f.volver, revisita_para: f.volver ? f.revisita : null,
      observacion: f.observacion.trim() || null, confirmar_duplicado: f.confirmar_duplicado,
    };
    if (f.empresa?.tipo === "existente") d.empresa_id = f.empresa.id;
    else if (f.empresa?.tipo === "nueva") d.empresa_nueva = datosEmpresa(f.empresa.valores, false);
    if (!f.cerrado) {
      const contacto = contactoSinDatos(f.contacto) ? null : f.contacto;
      if (contacto?.tipo === "existente") d.contacto_id = contacto.id;
      else if (contacto?.tipo === "nuevo") d.contacto_nuevo = datosContacto(contacto.valores);
      Object.assign(d, {
        contacto_obtenido: !!contacto && f.obtenido, hablo_con_contacto: !!contacto && f.hablo, interes: f.interes,
        necesidades: f.necesidades, necesidad_otra: f.necesidades.includes("otra") ? f.necesidad_otra.trim() || null : null, pack_potencial: f.pack,
      });
    }
    if (modo === "admin") {
      d.realizada_por = f.realizada_por;
      if (f.ocurrida_en) d.ocurrida_en = `${f.ocurrida_en}:00-03:00`;
    }
    return d;
  };

  const problema = (): string | null => {
    if (modo === "comercial" && !jornada) return "Abrí una jornada para registrar visitas.";
    if (modo === "admin" && (!form.realizada_por || !form.jornada_id)) return "Elegí el comercial y la jornada.";
    if (!form.empresa) return "Elegí o creá el negocio.";
    if (form.empresa.tipo === "nueva" && !form.empresa.valores.nombre_comercial.trim()) return "Falta el nombre del negocio.";
    if (!form.cerrado && !form.empleado && !form.responsable) return "Marcá qué pasó: cerrado o con quién hablaste.";
    if (form.obtenido && form.contacto?.tipo === "nuevo" && !form.contacto.valores.telefono.trim()) return "Para un contacto útil hace falta el teléfono.";
    if (contactoSinDatos(form.contacto) && form.hablo) return "Cargá el nombre o el teléfono de la persona con la que hablaste.";
    if (form.contacto?.tipo === "nuevo" && !contactoSinDatos(form.contacto) && !form.contacto.valores.nombre.trim() && !form.contacto.valores.telefono.trim()) {
      return "Cargá al menos el nombre o el teléfono del contacto, o quitalo.";
    }
    if (form.necesidades.includes("otra") && !form.necesidad_otra.trim()) return "Contá cuál es la otra necesidad.";
    return null;
  };

  async function guardar(confirmarDuplicado = form.confirmar_duplicado) {
    if (enviando) return;
    const p = problema();
    if (p) { setError(p); return; }
    setEnviando(true);
    setError(null);
    const cuerpo = { clave, datos: { ...datos(), confirmar_duplicado: confirmarDuplicado } };
    const r = await enviar<VisitaGuardada>(`${apiBase}/visitas`, "POST", cuerpo);
    setEnviando(false);
    if (r.ok) {
      const nombre = form.empresa?.tipo === "existente" ? form.empresa.nombre : form.empresa?.tipo === "nueva" ? form.empresa.valores.nombre_comercial : "";
      guardarBorrador(usuarioId, null);
      setIncierto(false);
      setCandidatos(null);
      setClave(crypto.randomUUID());
      setForm(formVacio(empresaFija ? form.empresa : null));
      setBusqueda("");
      onGuardada(r.data, nombre);
      return;
    }
    if (r.incierto) {
      setIncierto(true);
      if (modo === "comercial") guardarBorrador(usuarioId, { form: { ...form, confirmar_duplicado: confirmarDuplicado }, clave, incierto: true });
      setError("No sabemos si se guardó (sin respuesta del servidor). Reintentá: si ya había llegado, no se duplica.");
      return;
    }
    if (r.codigo === "posible_duplicado") {
      setCandidatos(r.candidatos ?? []);
      return;
    }
    if (r.codigo === "clave_reutilizada") setClave(crypto.randomUUID());
    setError(r.error);
  }

  const bloquear = incierto || enviando;
  const empresaNombre = form.empresa?.tipo === "existente" ? form.empresa.nombre : form.empresa?.tipo === "nueva" ? form.empresa.valores.nombre_comercial : "";
  const contactoNombre = form.contacto?.tipo === "existente" ? form.contacto.nombre : form.contacto?.tipo === "nuevo" ? form.contacto.valores.nombre || form.contacto.valores.telefono : "";
  const chipHecho = (activo: boolean, textoChip: string, alTocar: () => void) => (
    <button type="button" aria-pressed={activo} onClick={alTocar}
      className={cx("inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400",
        activo ? "border-red-500 bg-red-600 text-white" : "border-white/15 bg-black/40 text-white/80 hover:border-white/40")}>
      {activo ? <Check className="h-4 w-4" aria-hidden /> : null}{textoChip}
    </button>
  );

  return (
    // scroll-mb: al enfocar un control (o al abrirse el teclado) el navegador lo deja por
    // encima de la barra fija de "Guardar visita", no detrás.
    <div className="space-y-5 pb-28 [&_button]:scroll-mb-28 [&_input]:scroll-mb-28 [&_select]:scroll-mb-28 [&_textarea]:scroll-mb-28">
      {avisoBorrador ? (
        <Aviso tipo="info" titulo="Recuperamos lo que estabas cargando"
          acciones={<Boton variante="fantasma" onClick={() => { guardarBorrador(usuarioId, null); setForm(formVacio(null)); setClave(crypto.randomUUID()); setIncierto(false); setAvisoBorrador(false); }}>Descartar y empezar de nuevo</Boton>}>
          Es el borrador de este dispositivo.
        </Aviso>
      ) : null}

      <fieldset disabled={bloquear} className="space-y-5">
        {modo === "admin" ? (
          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/70">Quién y cuándo</h3>
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Realizada por
              <select className={INPUT} value={form.realizada_por} onChange={(e) => actualizar({ realizada_por: e.target.value, jornada_id: "" })}>
                <option value="">Elegí el comercial</option>
                {(comerciales ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? "" : " (desactivado)"}</option>)}
              </select>
            </label>
            {form.realizada_por ? (
              <label className="block space-y-1.5 text-sm font-semibold text-white/80">Jornada
                <select className={INPUT} value={form.jornada_id} onChange={(e) => actualizar({ jornada_id: e.target.value })}>
                  <option value="">{jornadas.length ? "Elegí la jornada" : "Ese comercial no tiene jornadas: cargá una en Jornadas"}</option>
                  {jornadas.map((j) => <option key={j.id} value={j.id}>{fechaCorta(j.fecha)} · {j.nombre ?? "sin nombre"}{j.cerrada_en ? "" : " (abierta)"}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha y hora de la visita (Córdoba)
              <input type="datetime-local" className={INPUT} value={form.ocurrida_en} onChange={(e) => actualizar({ ocurrida_en: e.target.value })} />
              <span className="block text-xs font-normal text-white/50">Vacío = ahora. Tiene que ser del día de la jornada o del siguiente.</span>
            </label>
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white/70">Negocio</h3>
          {form.empresa ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-500/40 bg-red-950/20 p-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{empresaNombre || "Negocio nuevo"}</p>
                <p className="text-xs text-white/60">{form.empresa.tipo === "nueva" ? "Se crea al guardar la visita" : "Negocio existente"}</p>
              </div>
              {!empresaFija ? <Boton variante="fantasma" onClick={() => { actualizar({ empresa: null, contacto: null, obtenido: false, hablo: false, confirmar_duplicado: false }); setContactos([]); setCandidatos(null); }}>Cambiar</Boton> : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-white/40" aria-hidden />
                <input className={`${INPUT} pl-9`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar o escribir el nombre" aria-label="Buscar negocio" autoComplete="off" />
              </div>
              <ul className="space-y-1.5">
                {resultados.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => actualizar({ empresa: { tipo: "existente", id: e.id, nombre: e.nombre_comercial } })}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left hover:border-white/40">
                      <span className="truncate font-semibold">{e.nombre_comercial}</span>
                      <span className="shrink-0 text-xs text-white/50">{e.zona ?? e.rubro ?? ""}</span>
                    </button>
                  </li>
                ))}
                {buscando ? <li className="flex items-center gap-2 text-sm text-white/50"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />Buscando…</li> : null}
              </ul>
              {busqueda.trim() ? (
                <Boton variante="secundario" className="w-full" onClick={() => actualizar({ empresa: { tipo: "nueva", valores: empresaVacia(busqueda.trim(), jornada?.zona_id ?? "") } })}>
                  <Plus className="h-4 w-4" aria-hidden />Nuevo negocio: «{busqueda.trim()}»
                </Boton>
              ) : null}
            </div>
          )}
          {form.empresa?.tipo === "nueva" ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <CamposEmpresa valores={form.empresa.valores} completos={false} catalogo={catalogo}
                onCambio={(v) => actualizar({ empresa: { tipo: "nueva", valores: v }, confirmar_duplicado: false })} />
            </div>
          ) : null}
          {candidatos ? (
            <Aviso tipo="alerta" titulo="Hay negocios parecidos">
              <ul className="mt-2 space-y-2">
                {candidatos.map((c, i) => (
                  <li key={c.id ?? i} className="rounded-xl border border-white/10 p-2">
                    <p className="font-semibold">{c.nombre_comercial}</p>
                    <p className="text-xs text-white/60">{[c.zona, c.rubro, c.direccion].filter(Boolean).join(" · ") || "Sin más datos"} · {c.asignacion === "vos" ? "asignado a vos" : c.asignacion === "sin_asignar" ? "sin asignar" : "asignado a otra persona"}</p>
                    {c.id ? <Boton variante="secundario" className="mt-2" onClick={() => { actualizar({ empresa: { tipo: "existente", id: c.id!, nombre: c.nombre_comercial }, confirmar_duplicado: false }); setCandidatos(null); }}>Es este</Boton> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">Si es el mismo negocio y no es tuyo, avisale a la administración. Si es otro (por ejemplo, una sucursal), podés crearlo igual.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Boton variante="primario" onClick={() => { actualizar({ confirmar_duplicado: true }); setCandidatos(null); void guardar(true); }}>Es otro negocio: guardar</Boton>
                <Boton variante="fantasma" onClick={() => setCandidatos(null)}>Volver</Boton>
              </div>
            </Aviso>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white/70">¿Qué pasó?</h3>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Qué pasó en la visita">
            {chipHecho(form.cerrado, "Cerrado / no atendieron", () => actualizar(form.cerrado ? { cerrado: false } : { cerrado: true, empleado: false, responsable: false, ausente: false }))}
            {chipHecho(form.empleado, "Habló con empleado", () => actualizar({ empleado: !form.empleado, cerrado: false }))}
            {chipHecho(form.responsable, "Habló con responsable", () => actualizar({ responsable: !form.responsable, ausente: false, cerrado: false }))}
            {chipHecho(form.ausente, "El responsable no estaba", () => actualizar({ ausente: !form.ausente, responsable: false, cerrado: false }))}
          </div>
          {form.cerrado ? <p className="text-xs text-white/50">Con el negocio cerrado solo se registra la visita (y si volvés otro día). No se borra nada de la ficha.</p> : null}
        </section>

        {!form.cerrado ? (
          <>
            <Plegable titulo="Contacto" abierto={abierto.contacto}
              onAlternar={() => {
                // Un negocio nuevo no tiene contactos para elegir: se abre directo el alta.
                if (!abierto.contacto && !form.contacto && form.empresa?.tipo === "nueva") actualizar({ contacto: { tipo: "nuevo", valores: contactoVacio() } });
                setAbierto((a) => ({ ...a, contacto: !a.contacto }));
              }}
              resumen={contactoNombre ? `${contactoNombre}${form.obtenido ? " · útil" : ""}` : "opcional"}>
              {form.contacto?.tipo === "nuevo" ? (
                <div className="space-y-3">
                  <CamposContacto valores={form.contacto.valores} onCambio={(v) => actualizar({ contacto: { tipo: "nuevo", valores: v } })} autoFoco />
                  <Boton variante="fantasma" onClick={() => actualizar({ contacto: null, obtenido: false, hablo: false })}>Quitar contacto</Boton>
                </div>
              ) : (
                <div className="space-y-2">
                  {contactos.length ? <p className="text-sm text-white/70">Contactos del negocio:</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {contactos.map((c) => {
                      const activo = form.contacto?.tipo === "existente" && form.contacto.id === c.id;
                      return (
                        <span key={c.id}>
                          {chipHecho(activo, `${c.nombre ?? c.telefono ?? "Contacto"}${c.cargo ? ` · ${c.cargo}` : ""}`,
                            () => actualizar(activo ? { contacto: null, obtenido: false, hablo: false } : { contacto: { tipo: "existente", id: c.id, nombre: c.nombre ?? c.telefono ?? "Contacto" } }))}
                        </span>
                      );
                    })}
                  </div>
                  <Boton variante="secundario" onClick={() => actualizar({ contacto: { tipo: "nuevo", valores: contactoVacio() } })}><Plus className="h-4 w-4" aria-hidden />Nuevo contacto</Boton>
                </div>
              )}
              {form.contacto ? (
                <div className="space-y-2 border-t border-white/10 pt-3">
                  <div className="flex flex-wrap gap-2">
                    {chipHecho(form.obtenido, "Contacto útil para seguimiento", () => actualizar({ obtenido: !form.obtenido }))}
                    {chipHecho(form.hablo, "Hablé con esta persona", () => actualizar({ hablo: !form.hablo }))}
                  </div>
                  <p className="text-xs text-white/50">«Contacto útil» = conseguiste cómo contactarlo para el seguimiento (hace falta teléfono). No hace falta que sea quien decide.</p>
                </div>
              ) : null}
            </Plegable>

            <Chips etiqueta="Interés" opciones={INTERESES} valor={form.interes} onCambio={(v) => actualizar({ interes: v })}
              ayuda={form.interes ? "Tocá de nuevo para dejarlo sin evaluar." : "Sin elegir = no evaluado."} />

            <Plegable titulo="Necesidades y pack" abierto={abierto.detalle} onAlternar={() => setAbierto((a) => ({ ...a, detalle: !a.detalle }))}
              resumen={[form.necesidades.length ? `${form.necesidades.length} necesidad${form.necesidades.length > 1 ? "es" : ""}` : "", form.pack ? PACKS.find((p) => p.valor === form.pack)?.texto : ""].filter(Boolean).join(" · ") || "opcional"}>
              <ChipsMultiples etiqueta="Necesidades detectadas" opciones={NECESIDADES} valor={form.necesidades} onCambio={(v) => actualizar({ necesidades: v as Necesidad[] })} />
              {form.necesidades.includes("otra") ? (
                <input className={INPUT} value={form.necesidad_otra} maxLength={120} onChange={(e) => actualizar({ necesidad_otra: e.target.value })} placeholder="¿Cuál?" aria-label="Otra necesidad" />
              ) : null}
              <Chips etiqueta="Pack potencial" opciones={PACKS} valor={form.pack} onCambio={(v) => actualizar({ pack: v })} />
            </Plegable>
          </>
        ) : null}

        <section className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {chipHecho(form.volver, "Volver otro día", () => actualizar({ volver: !form.volver, revisita: null }))}
          </div>
          {form.volver ? (
            <div className="flex flex-wrap items-center gap-2">
              {[["Mañana", 1], ["En 3 días", 3], ["En una semana", 7]].map(([t, d]) => {
                const f = sumarDias(hoy, d as number);
                return <button key={t} type="button" aria-pressed={form.revisita === f} onClick={() => actualizar({ revisita: form.revisita === f ? null : f })}
                  className={cx("min-h-11 rounded-xl border px-3 text-sm font-semibold", form.revisita === f ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/80")}>{t}</button>;
              })}
              <input type="date" min={hoy} value={form.revisita ?? ""} onChange={(e) => actualizar({ revisita: e.target.value || null })} className={`${INPUT} w-auto`} aria-label="Fecha de revisita" />
              <span className="text-xs text-white/50">{form.revisita ? fechaCorta(form.revisita) : "Sin fecha elegida"}</span>
            </div>
          ) : null}
        </section>

        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Observación (opcional)
          <textarea className={`${INPUT} min-h-20`} maxLength={1000} value={form.observacion} onChange={(e) => actualizar({ observacion: e.target.value })} />
        </label>
      </fieldset>

      <div aria-live="polite">{error ? <Aviso tipo={incierto ? "alerta" : "error"}>{error}</Aviso> : null}</div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-md flex-col gap-2">
          <Boton variante="primario" className="min-h-12 w-full text-base" cargando={enviando} onClick={() => void guardar()}>
            {incierto ? "Reintentar guardado" : "Guardar visita"}
          </Boton>
          {incierto ? (
            <Boton variante="fantasma" onClick={() => { guardarBorrador(usuarioId, null); setForm(formVacio(null)); setClave(crypto.randomUUID()); setIncierto(false); setError(null); }}>
              Descartar (si había llegado, la visita ya está guardada)
            </Boton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
