"use client";

// Carga y edición de una interacción en UNA pantalla (Bloque 3).
//
// Alta: una clave de idempotencia por carga. Si el envío queda INCIERTO (sin
// respuesta o error del servidor), el contenido se bloquea y se reintenta con la
// misma clave: nunca se convierte en una segunda interacción. Recién cuando el
// servidor confirma se borra el borrador y se prepara otra clave. El borrador
// solo se recuerda si la carga tiene algo propio o quedó incierta (cliente.ts).
// Con las altas pausadas no se guarda una carga nueva, pero un envío incierto
// se puede reintentar: si ya había llegado, el servidor devuelve la original.
// Edición: solo viajan los campos cambiados (cambiosDeEdicion). Si el servidor
// pide confirmar_liberacion, se explica y se pide confirmación explícita. Si la
// versión cambió en otro dispositivo, se conservan los cambios y se recarga para
// revisar: nunca se reenvía solo con la versión nueva.
// "Solo miró" muestra únicamente personas, hombres/mujeres, rangos etarios,
// motivo y observaciones (la hora es la del guardado). Lo demás sigue en el
// formulario de "Miró y preguntó" y "Se subió", con el tipo de grupo primero.
// En una edición, lo que "Solo miró" no muestra conserva su valor histórico.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  ETIQUETAS, INICIADORES, LIMITES, MOTIVOS, RANGOS_ETARIOS, RESPUESTAS, RESULTADOS, TIPOS_GRUPO, cambiosDeEdicion, fechaSim,
  minimoDeclarableStaff, paredSim, validarDatos,
  type InteraccionDto, type Resultado, type Rol,
} from "@/lib/interacciones";
import { sumarDias } from "@/lib/agenda";
import {
  api, borradores, datosDesdeDto, datosDesdeFormulario, desgloseCompleto, esIncierto, formularioDesdeDto, instanteDeOcurrida, rebaseEdicion,
  interaccionYaNoExiste, moduloNoDisponible, type BorradorAlta, type Empleados, type EnvioAlta, type EstadoFormulario, type FalloApi,
  type TurnoElegido,
} from "./cliente";
import SelectorTurnos from "./SelectorTurnos";
import { Aviso, Boton, Campo, Chips, ChipsMultiples, Contador, Dialogo, Panel, Plegable, cx } from "./ui";

type Props =
  | {
    modo: "alta"; rol: Rol; borrador: BorradorAlta; pausado?: boolean; onPausado?: () => void;
    onGuardado: (i: InteraccionDto, info: { repetida: boolean }) => void; onCerrar: () => void; onDescartar: () => void;
  }
  | { modo: "edicion"; rol: Rol; base: InteraccionDto; onGuardado: (i: InteraccionDto, info: { repetida: boolean }) => void; onCerrar: () => void };

const tieneSecundarios = (f: EstadoFormulario) =>
  f.hombres !== null || f.mujeres !== null || f.rangos_etarios.length > 0 || f.tipo_grupo !== null || f.conocia_sim !== null
  || f.se_subio_antes !== null || f.iniciador !== null || f.atendio_empleado_id !== null || f.motivo !== null || f.observaciones.trim() !== "";

const opciones = <T extends string>(lista: readonly T[], textos: Record<T, string>) => lista.map((v) => ({ valor: v, texto: textos[v] }));
const NOMBRE_CAMPO: Record<string, string> = {
  ocurrida_en: "fecha y hora", resultado: "resultado", personas_grupo: "personas", hombres: "hombres", mujeres: "mujeres",
  rangos_etarios: "edades", tipo_grupo: "tipo de grupo", conocia_sim: "si conocían SIM", se_subio_antes: "si se habían subido", iniciador: "quién inició",
  atendio_empleado_id: "quién atendió", motivo: "motivo", observaciones: "observaciones",
};

export default function Formulario(props: Props) {
  const esAlta = props.modo === "alta";
  const [base, setBase] = useState<InteraccionDto | null>(props.modo === "edicion" ? props.base : null);
  const [form, setForm] = useState<EstadoFormulario>(() => {
    if (props.modo === "alta") return props.borrador.form;
    const previo = borradores.edicion(props.base.id);
    return previo && previo.version === props.base.version ? previo.form : formularioDesdeDto(props.base);
  });
  const [turnos, setTurnos] = useState<TurnoElegido[]>(props.modo === "alta" ? props.borrador.turnos : []);
  const [incierto, setIncierto] = useState<{ conTurnos: boolean } | null>(
    props.modo === "alta" && props.borrador.estado === "incierto" ? { conTurnos: props.borrador.turnos.length > 0 } : null,
  );
  // Lo que se mandó en un envío incierto: el reintento manda EXACTAMENTE eso (también
  // si lo había mandado la pantalla anterior), así la base reconoce la carga original.
  const [envio, setEnvio] = useState<EnvioAlta | null>(props.modo === "alta" ? props.borrador.envio ?? null : null);
  const [enviando, setEnviando] = useState(false);
  const [enviandoCon, setEnviandoCon] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualizarTurnos, setActualizarTurnos] = useState(0);
  const [conflicto, setConflicto] = useState<"version" | "incierto" | null>(null);
  const [cambiosRemotos, setCambiosRemotos] = useState<string[] | null>(null);
  const [cambiosEnAmbos, setCambiosEnAmbos] = useState<string[]>([]);
  const [confirmar, setConfirmar] = useState<{ turnos: string[]; cierre: boolean } | null>(null);
  const [empleados, setEmpleados] = useState<Empleados | null>(null);
  // Un borrador restaurado con datos secundarios los muestra abiertos: nada cargado queda oculto.
  const [abiertoPerfil, setAbiertoPerfil] = useState(() => !esAlta || tieneSecundarios(form));
  const [restaurado] = useState(() => props.modo === "edicion" && borradores.edicion(props.base.id)?.version === props.base.version);
  // La interacción ya no existe (borrada por un admin) o la carga ya se resolvió: no se guarda más desde acá.
  const [terminado, setTerminado] = useState(false);
  const enVuelo = useRef(false);
  const bloqueado = enviando || incierto !== null || terminado;
  const pausado = props.modo === "alta" && props.pausado === true && incierto === null;

  // ── Borrador: cada cambio queda en sessionStorage (ir al Turnero no pierde nada) ──
  useEffect(() => {
    if (props.modo === "alta") {
      if (!terminado) {
        borradores.sincronizarAlta({
          clave: props.borrador.clave, form, turnos, estado: incierto ? "incierto" : "editando", ...(incierto && envio ? { envio } : {}),
        });
      }
    } else if (base && !terminado) {
      const hay = Object.keys(cambiosDeEdicion(datosDesdeDto(base), datosDesdeFormulario(form))).length > 0;
      if (hay) borradores.guardarEdicion({ id: base.id, version: base.version, form });
      else borradores.borrarEdicion(base.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, turnos, incierto, base, terminado, envio]);

  // ── Opciones de "Atendió" (activos + sugerencia del cronograma a esa hora) ──
  const instante = instanteDeOcurrida(form.ocurrida);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const r = await api.empleados(instante, ctrl.signal);
      if (r.ok) setEmpleados(r.data);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [instante]);

  const cambiar = <K extends keyof EstadoFormulario>(k: K, v: EstadoFormulario[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  // ── Validación local (la base vuelve a validar) ──
  const ahora = new Date();
  const desglose = desgloseCompleto(form) ? (form.hombres === null ? "vacio" : form.hombres + (form.mujeres ?? 0) === form.personas ? "ok" : "no_suma") : "incompleto";
  const minimoFecha = props.rol === "staff"
    ? (esAlta ? minimoDeclarableStaff(ahora) : `${sumarDias(fechaSim(new Date(base!.registrada_en)), -LIMITES.staff_dias_retro)}T00:00`)
    : undefined;
  const maximoFecha = paredSim(new Date(ahora.getTime() + LIMITES.margen_futuro_minutos * 60_000)).valor;
  // "Solo miró" no muestra la fecha: en el alta es la del guardado; en una edición queda la que tenía.
  const soloMiro = form.resultado === "miro";
  const fechaInvalida = !soloMiro && form.ocurrida.modo === "manual"
    && (instante === null || (minimoFecha !== undefined && form.ocurrida.valor < minimoFecha) || form.ocurrida.valor > maximoFecha);
  // Más rangos que personas: se avisa y no se guarda, pero no se desmarca nada en silencio.
  const rangosExcedidos = form.rangos_etarios.length > form.personas;
  const datos = datosDesdeFormulario(form, { alta: esAlta });
  const valida = validarDatos(datos, "alta");
  const cambios = base ? cambiosDeEdicion(datosDesdeDto(base), datos) : {};
  const sinCambios = !esAlta && Object.keys(cambios).length === 0;
  const puedeGuardar = !bloqueado && !pausado && valida.ok && !rangosExcedidos && desglose !== "incompleto" && desglose !== "no_suma" && !fechaInvalida;
  const motivoQuitado = form.resultado === "subio" && form.motivo !== null;

  function falloComun(r: FalloApi) {
    if (moduloNoDisponible(r)) return "La carga de Interacciones todavía no está habilitada.";
    if (r.codigo === "altas_pausadas") return r.error;
    if (r.codigo === "turno_ya_vinculado" && r.turno_stand_id) {
      const t = turnos.find((x) => x.id === r.turno_stand_id);
      // Nada se guardó: se quita ese turno de la selección y se actualiza la lista.
      setTurnos((s) => s.filter((x) => x.id !== r.turno_stand_id));
      setActualizarTurnos((n) => n + 1);
      return `El turno de las ${t?.hora ?? "?"} ya quedó vinculado a otra interacción. Lo quitamos de tu selección: no se guardó nada, revisá y volvé a guardar.`;
    }
    return r.error;
  }

  // ── Alta ──
  async function guardarAlta(conTurnos: boolean) {
    if (props.modo !== "alta" || enVuelo.current) return;
    enVuelo.current = true;
    setEnviando(true);
    setError(null);
    // Antes de enviar, el borrador queda INCIERTO con lo que se manda: si se corta
    // acá, al volver se reintenta con la misma clave y EXACTAMENTE el mismo contenido.
    const pedido: EnvioAlta = incierto !== null && envio !== null
      ? envio
      : { datos: datosDesdeFormulario(form, { alta: true }), ...(conTurnos && turnos.length > 0 ? { turnos: turnos.map((t) => t.id) } : {}) };
    const enviado = { conTurnos: (pedido.turnos?.length ?? 0) > 0 };
    setEnviandoCon(enviado.conTurnos);
    setEnvio(pedido);
    borradores.guardarAlta({ clave: props.borrador.clave, form, turnos: enviado.conTurnos ? turnos : [], estado: "incierto", envio: pedido });
    if (!enviado.conTurnos && turnos.length > 0) setTurnos([]);
    const r = await api.registrar({ idempotency_key: props.borrador.clave, ...pedido });
    enVuelo.current = false;
    setEnviando(false);
    if (r.ok) {
      borradores.borrarAlta();
      props.onGuardado(r.data.interaccion, { repetida: r.data.repetida === true });
      return;
    }
    if (esIncierto(r)) {
      setIncierto(enviado);
      return;
    }
    if (r.codigo === "interaccion_eliminada") {
      // Ya se había guardado y un admin la borró después: no se vuelve a crear.
      borradores.borrarAlta();
      setIncierto(null);
      setEnvio(null);
      setTerminado(true);
      setError("Esta carga ya se había guardado y después un administrador la borró: no se volvió a crear. Podés cerrar este formulario.");
      return;
    }
    // Respuesta definitiva: nada se guardó con esta clave (el servidor lo comprobó).
    setIncierto(null);
    setEnvio(null);
    borradores.sincronizarAlta({ clave: props.borrador.clave, form, turnos, estado: "editando" });
    if (r.codigo === "altas_pausadas") props.onPausado?.();
    if (r.codigo === "idempotency_key_con_otro_payload") {
      setError("Esta carga ya se había guardado con otros datos. Revisá la lista de recientes antes de cargarla de nuevo.");
      return;
    }
    setError(falloComun(r));
  }

  // ── Edición ──
  async function guardarEdicion(confirmarLiberacion = false) {
    if (!base || enVuelo.current) return;
    enVuelo.current = true;
    setEnviando(true);
    setError(null);
    const r = await api.editar(base.id, { version: base.version, cambios, ...(confirmarLiberacion ? { confirmar_liberacion: true } : {}) });
    enVuelo.current = false;
    setEnviando(false);
    if (r.ok) {
      borradores.borrarEdicion(base.id);
      props.onGuardado(r.data.interaccion, { repetida: false });
      return;
    }
    if (r.codigo === "confirmar_liberacion") {
      setConfirmar({ turnos: r.turnos ?? [], cierre: base.cierre !== null });
      return;
    }
    if (r.codigo === "version_desactualizada") {
      setConflicto("version");
      return;
    }
    if (esIncierto(r)) {
      setConflicto("incierto");
      return;
    }
    if (interaccionYaNoExiste(r)) {
      borradores.borrarEdicion(base.id);
      setTerminado(true);
      setError(`${r.error} Tus cambios no se guardaron.`);
      return;
    }
    setError(falloComun(r));
  }

  async function recargarYRevisar() {
    if (!base) return;
    const r = await api.obtener(base.id);
    if (!r.ok) {
      if (interaccionYaNoExiste(r)) {
        borradores.borrarEdicion(base.id);
        setTerminado(true);
        setConflicto(null);
        setError("Esta interacción ya no existe: un administrador la borró. Tus cambios no se guardaron.");
        return;
      }
      setError(r.error);
      return;
    }
    const nueva = r.data.interaccion;
    const antes = datosDesdeDto(base);
    const delUsuario = cambiosDeEdicion(antes, datosDesdeFormulario(form));
    const remotosK = Object.keys(cambiosDeEdicion(antes, datosDesdeDto(nueva)));
    const remotos = remotosK.map((k) => NOMBRE_CAMPO[k] ?? k);
    const ambos = remotosK.filter((k) => k in delUsuario).map((k) => NOMBRE_CAMPO[k] ?? k);
    if (nueva.anulacion) remotos.push("se anuló");
    if (nueva.vinculo.turnos_vinculados !== base.vinculo.turnos_vinculados) remotos.push("turnos vinculados");
    // La versión nueva manda; sobre ella se vuelven a aplicar SOLO los cambios del usuario.
    setBase(nueva);
    setForm(rebaseEdicion(nueva, delUsuario));
    setCambiosRemotos(remotos);
    setCambiosEnAmbos(ambos);
    setConflicto(null);
  }

  // ── Opciones de "Atendió" ──
  const opcionesAtendio = useMemo(() => {
    const lista = (empleados?.empleados ?? []).map((e) => ({
      valor: e.id, texto: e.nombre, detalle: empleados?.sugeridos.includes(e.id) ? "· según cronograma" : undefined,
    }));
    const actual = base?.atendio;
    if (actual && !lista.some((o) => o.valor === actual.empleado_id)) {
      lista.push({ valor: actual.empleado_id, texto: actual.nombre ?? "Integrante", detalle: actual.activo ? undefined : "· inactivo" });
    }
    return lista;
  }, [empleados, base]);

  const titulo = esAlta ? `Nueva · ${ETIQUETAS.resultado[form.resultado]}` : `Editar · ${ETIQUETAS.resultado[form.resultado]}`;

  // ── Bloques del formulario ──
  const bloqueDesglose = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Contador etiqueta="Hombres" valor={form.hombres} min={0} max={LIMITES.personas_grupo_max} permitirVacio deshabilitado={bloqueado}
          onCambio={(v) => cambiar("hombres", v)} />
        <Contador etiqueta="Mujeres" valor={form.mujeres} min={0} max={LIMITES.personas_grupo_max} permitirVacio deshabilitado={bloqueado}
          onCambio={(v) => cambiar("mujeres", v)} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite">
        {desglose === "vacio" ? <span className="text-white/55">Sin desglose (opcional).</span> : null}
        {desglose === "incompleto" ? <span className="text-amber-200">Completá hombres y mujeres, o limpiá el desglose.</span> : null}
        {desglose === "no_suma" ? (
          <span className="text-amber-200">Hombres + mujeres = {(form.hombres ?? 0) + (form.mujeres ?? 0)}; el grupo tiene {form.personas}.</span>
        ) : null}
        {desglose === "ok" ? <span className="text-white/55">Desglose completo.</span> : null}
        {form.hombres !== null || form.mujeres !== null ? (
          <Boton variante="fantasma" disabled={bloqueado} onClick={() => setForm((f) => ({ ...f, hombres: null, mujeres: null }))}>Limpiar desglose</Boton>
        ) : null}
      </div>
    </>
  );

  const bloqueRangos = (
    <div className="space-y-2">
      <ChipsMultiples etiqueta="Rangos etarios presentes" opciones={opciones(RANGOS_ETARIOS, ETIQUETAS.rango_etario)} valor={form.rangos_etarios}
        onCambio={(v) => cambiar("rangos_etarios", v)} deshabilitado={bloqueado}
        ayuda="Podés marcar más de uno. Indica qué edades hay en el grupo, no cuántas personas de cada una." />
      {rangosExcedidos ? (
        <p className="text-sm text-amber-200" aria-live="polite">
          Marcaste {form.rangos_etarios.length} rangos y el grupo tiene {form.personas} {form.personas === 1 ? "persona" : "personas"}: quitá rangos o sumá personas.
        </p>
      ) : null}
    </div>
  );

  const bloquePerfil = (
    <>
      <Chips etiqueta="Tipo de grupo" opciones={opciones(TIPOS_GRUPO, ETIQUETAS.tipo_grupo)} valor={form.tipo_grupo}
        onCambio={(v) => cambiar("tipo_grupo", v)} deshabilitado={bloqueado}
        ayuda="Opcional. “Compañeros” es de trabajo o estudio. Sin marcar queda “Sin dato”." />
      {bloqueDesglose}
      {bloqueRangos}
      <Chips etiqueta="¿Ya conocían SIM?" opciones={opciones(RESPUESTAS, ETIQUETAS.respuesta)} valor={form.conocia_sim}
        onCambio={(v) => cambiar("conocia_sim", v)} deshabilitado={bloqueado} />
      <Chips etiqueta="¿Ya se habían subido antes?" opciones={opciones(RESPUESTAS, ETIQUETAS.respuesta)} valor={form.se_subio_antes}
        onCambio={(v) => cambiar("se_subio_antes", v)} deshabilitado={bloqueado} />
      <Chips etiqueta="¿Quién inició la interacción?" opciones={opciones(INICIADORES, ETIQUETAS.iniciador)} valor={form.iniciador}
        onCambio={(v) => cambiar("iniciador", v)} deshabilitado={bloqueado} />
      <Chips etiqueta="Atendió (opcional, declarado)" opciones={opcionesAtendio} valor={form.atendio_empleado_id}
        onCambio={(v) => cambiar("atendio_empleado_id", v)} deshabilitado={bloqueado}
        ayuda={empleados?.sugeridos.length ? "El cronograma sugiere quién estaba; elegilo solo si fue quien atendió." : "Sin asignar si no lo cargás."} />
    </>
  );

  const bloqueMotivo = form.resultado === "subio" ? null : (
    <Chips etiqueta="Motivo de no compra (opcional)" opciones={opciones(MOTIVOS, ETIQUETAS.motivo)} valor={form.motivo}
      onCambio={(v) => cambiar("motivo", v)} deshabilitado={bloqueado} />
  );

  const bloqueObservaciones = (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-white/80">Observaciones (opcional)</span>
      <textarea value={form.observaciones} maxLength={LIMITES.observaciones_max} rows={3} disabled={bloqueado}
        onChange={(e) => cambiar("observaciones", e.target.value)}
        className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-red-500 disabled:opacity-60"
        placeholder="Algo útil para entender la visita. No anotes nombres ni teléfonos." />
      <span className="block text-right text-xs text-white/40">{form.observaciones.length}/{LIMITES.observaciones_max}</span>
    </label>
  );

  const pie = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Link href="/admin/turnero" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
        Ir al Turnero <ArrowRight className="h-4 w-4" aria-hidden />
        <span className="sr-only">(lo cargado queda guardado como borrador)</span>
      </Link>
      <div className="flex flex-col gap-2 sm:flex-row">
        {esAlta && form.resultado === "subio" ? (
          <>
            <Boton variante="secundario" disabled={!puedeGuardar} cargando={enviando && enviandoCon === false} onClick={() => guardarAlta(false)}>
              No encuentro el turno · guardar pendiente
            </Boton>
            <Boton variante="primario" disabled={!puedeGuardar || turnos.length === 0} cargando={enviando && enviandoCon === true} onClick={() => guardarAlta(true)}>
              Guardar con turno{turnos.length > 1 ? `s (${turnos.length})` : ""}
            </Boton>
          </>
        ) : esAlta ? (
          <Boton variante="primario" disabled={!puedeGuardar} cargando={enviando} onClick={() => guardarAlta(false)}>Guardar</Boton>
        ) : (
          <Boton variante="primario" disabled={!puedeGuardar || sinCambios || conflicto !== null} cargando={enviando} onClick={() => guardarEdicion(false)}>
            {sinCambios ? "Sin cambios" : "Guardar cambios"}
          </Boton>
        )}
      </div>
    </div>
  );

  return (
    <Panel titulo={titulo} onCerrar={props.onCerrar} pie={pie} etiquetaCerrar="Cerrar (el borrador queda guardado)">
      <div className="space-y-5">
        {incierto ? (
          <Aviso tipo="alerta" titulo="No pudimos confirmar si se guardó"
            acciones={<Boton variante="primario" cargando={enviando} onClick={() => guardarAlta(incierto.conTurnos)}>Reintentar</Boton>}>
            Reintentá: se envía la misma carga y, si ya había llegado, no se duplica. Mientras tanto los datos quedan bloqueados.
          </Aviso>
        ) : null}
        {pausado ? (
          <Aviso tipo="alerta" titulo="La carga de nuevas interacciones está pausada">
            Por ahora no se pueden guardar cargas nuevas. Lo que completaste queda como borrador en este dispositivo.
          </Aviso>
        ) : null}
        {restaurado ? <Aviso>Recuperamos cambios sin guardar de esta interacción.</Aviso> : null}
        {conflicto === "version" ? (
          <Aviso tipo="alerta" titulo="Esta interacción cambió en otro dispositivo"
            acciones={<Boton variante="primario" onClick={recargarYRevisar}>Recargar y revisar</Boton>}>
            Tus cambios siguen acá. Recargá para ver la versión nueva y decidir si los guardás.
          </Aviso>
        ) : null}
        {conflicto === "incierto" ? (
          <Aviso tipo="alerta" titulo="No pudimos confirmar el guardado"
            acciones={<Boton variante="primario" onClick={recargarYRevisar}>Recargar y revisar</Boton>}>
            Recargá para ver si el cambio se aplicó antes de volver a guardar.
          </Aviso>
        ) : null}
        {cambiosRemotos ? (
          <Aviso tipo="info" titulo="Versión actualizada">
            {cambiosRemotos.length ? `En el otro dispositivo cambió: ${cambiosRemotos.join(", ")}. ` : "No hubo cambios en los datos del formulario. "}
            Lo demás muestra la versión nueva y tus cambios siguen cargados encima: revisalos y guardá de nuevo si corresponde.
            {cambiosEnAmbos.length ? ` Ojo: ${cambiosEnAmbos.join(", ")} lo cambiaron los dos; quedó tu valor.` : ""}
          </Aviso>
        ) : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}

        <div role="group" aria-label="Resultado" className="grid grid-cols-3 gap-2">
          {RESULTADOS.map((r: Resultado) => (
            <button key={r} type="button" aria-pressed={form.resultado === r} disabled={bloqueado}
              onClick={() => cambiar("resultado", r)}
              className={cx("min-h-12 rounded-xl border px-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 disabled:opacity-60",
                form.resultado === r ? "border-red-500 bg-red-600 text-white" : "border-white/15 bg-black/40 text-white/75 hover:border-white/40")}>
              {ETIQUETAS.resultado[r]}
            </button>
          ))}
        </div>
        {motivoQuitado ? (
          <Aviso tipo="alerta">“Se subió” no lleva motivo de no compra: al guardar se quita “{ETIQUETAS.motivo[form.motivo!]}”.</Aviso>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Contador etiqueta="Personas del grupo" valor={form.personas} min={1} max={LIMITES.personas_grupo_max} deshabilitado={bloqueado}
            onCambio={(v) => cambiar("personas", v ?? 1)} />
          {soloMiro ? null : (
          <Campo etiqueta="Cuándo pasó" ayuda={props.rol === "staff" ? "Staff puede cargar desde ayer a las 00:00." : undefined}>
            {form.ocurrida.modo === "ahora" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">Ahora</span>
                <Boton variante="fantasma" disabled={bloqueado} onClick={() => cambiar("ocurrida", { modo: "manual", valor: paredSim(new Date()).valor })}>
                  Cambiar fecha y hora
                </Boton>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input type="datetime-local" step={60} value={form.ocurrida.valor} min={minimoFecha} max={maximoFecha} disabled={bloqueado}
                  aria-label="Fecha y hora de la interacción (hora de Córdoba)" aria-invalid={fechaInvalida}
                  onChange={(e) => form.ocurrida.modo === "manual" && cambiar("ocurrida", { ...form.ocurrida, valor: e.target.value })}
                  className="min-h-11 rounded-xl border border-white/15 bg-black/40 px-3 text-white outline-none [color-scheme:dark] focus:border-red-500" />
                {esAlta ? <Boton variante="fantasma" disabled={bloqueado} onClick={() => cambiar("ocurrida", { modo: "ahora" })}>Usar ahora</Boton> : null}
              </div>
            )}
          </Campo>
          )}
        </div>
        {rangosExcedidos ? (
          <Aviso tipo="alerta">Hay {form.rangos_etarios.length} rangos de edad marcados y {form.personas} {form.personas === 1 ? "persona" : "personas"} en el grupo. No se desmarcó nada: quitá rangos o sumá personas para guardar.</Aviso>
        ) : null}
        {fechaInvalida ? <Aviso tipo="alerta">Esa fecha y hora no se puede usar: tiene que ser pasada{props.rol === "staff" ? " y desde ayer a las 00:00" : ""}.</Aviso> : null}

        {esAlta && form.resultado === "subio" ? (
          <section aria-labelledby="titulo-turnos" className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 id="titulo-turnos" className="text-sm font-black uppercase tracking-wide text-red-400">Turno del Turnero</h3>
            <p className="text-sm text-white/60">Elegí el turno que ya cargaste. Si no lo encontrás, guardala como pendiente y vinculala después.</p>
            <SelectorTurnos ancla={{ ocurrida_en: instante }} seleccion={turnos} maximo={LIMITES.max_turnos_por_interaccion} actualizar={actualizarTurnos}
              deshabilitado={bloqueado} onCambio={(s) => { setTurnos(s); setError(null); }} />
          </section>
        ) : null}

        {form.resultado === "pregunto" ? (
          <div className="space-y-5">
            {bloqueMotivo}
            {bloqueObservaciones}
            <Plegable titulo="Perfil del grupo" resumen="(opcional)" abierto={abiertoPerfil} onAlternar={() => setAbiertoPerfil((a) => !a)}>
              {bloquePerfil}
            </Plegable>
          </div>
        ) : form.resultado === "subio" ? (
          <Plegable titulo="Perfil del grupo y observación" resumen="(opcional)" abierto={abiertoPerfil} onAlternar={() => setAbiertoPerfil((a) => !a)}>
            {bloquePerfil}
            {bloqueObservaciones}
          </Plegable>
        ) : (
          <div className="space-y-5">
            {bloqueDesglose}
            {bloqueRangos}
            {bloqueMotivo}
            {bloqueObservaciones}
          </div>
        )}

        {props.modo === "alta" && !incierto && !terminado ? (
          <div className="pt-2">
            <Boton variante="fantasma" onClick={props.onDescartar} disabled={enviando}>Descartar esta carga</Boton>
          </div>
        ) : null}
      </div>

      {confirmar ? (
        <Dialogo titulo="Confirmá el cambio" onCerrar={() => setConfirmar(null)}
          acciones={(
            <>
              <Boton onClick={() => setConfirmar(null)}>Cancelar</Boton>
              <Boton variante="peligro" cargando={enviando} onClick={() => { setConfirmar(null); void guardarEdicion(true); }}>Confirmar y guardar</Boton>
            </>
          )}>
          <p>Al dejar de ser “Se subió”:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {confirmar.turnos.length > 0 ? (
              <li>se liberan {confirmar.turnos.length === 1 ? "el turno" : `${confirmar.turnos.length} turnos`} {base?.turnos.filter((t) => confirmar.turnos.includes(t.turno_stand_id)).map((t) => t.hora ?? "?").join(", ")} (siguen en el Turnero y vuelven a quedar disponibles para vincular);</li>
            ) : null}
            {confirmar.cierre ? <li>se retira el cierre sin turno que había hecho un admin;</li> : null}
          </ul>
          <p className="mt-2">Queda registrado en el historial.</p>
        </Dialogo>
      ) : null}
    </Panel>
  );
}
