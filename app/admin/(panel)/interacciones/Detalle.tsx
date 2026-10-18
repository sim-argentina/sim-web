"use client";

// Detalle de una interacción y sus correcciones (Bloque 3). Las acciones se
// habilitan con `permisos` de la API, que igual vuelve a exigirlos al escribir.
// No hay "restaurar anulación" ni "reabrir cierre": no son parte del módulo.

import { useCallback, useEffect, useState } from "react";
import { Link2, Pencil, TriangleAlert, Unlink } from "lucide-react";
import {
  ETIQUETAS, LIMITES, MOTIVOS_CIERRE, type Advertencia, type InteraccionDto, type MotivoCierre, type Rol,
} from "@/lib/interacciones";
import { api, etiquetaFecha, formatoMonto, moduloNoDisponible, type FalloApi, type TurnoElegido } from "./cliente";
import SelectorTurnos from "./SelectorTurnos";
import { Aviso, Boton, Cargando, Dialogo, Etiqueta, Panel } from "./ui";
import { hoyEnSim, sumarDias } from "@/lib/agenda";

export function tonoEstado(estado: InteraccionDto["vinculo"]["estado"]): "verde" | "ambar" | "gris" | "neutro" | "rojo" {
  if (estado === "con_turno") return "verde";
  if (estado === "pendiente" || estado === "turno_no_activo") return "ambar";
  if (estado === "anulada") return "rojo";
  if (estado === "cerrada_sin_turno") return "neutro";
  return "gris";
}

export function textoAdvertencia(a: Advertencia, i: InteraccionDto): string {
  const hora = (id?: string) => i.turnos.find((t) => t.turno_stand_id === id)?.hora ?? "?";
  switch (a.codigo) {
    case "pendiente_de_vinculo": return "Se subió, pero todavía no tiene un turno del Turnero vinculado.";
    case "subida_declarada_sin_turno": return "Cerrada sin turno: la subida queda declarada, no verificada por el Turnero.";
    case "turno_no_activo": return "El turno vinculado ya no está activo en el Turnero.";
    case "turno_fuera_de_tolerancia": return `El turno de las ${hora(a.turno_stand_id)} quedó en otro día respecto de la interacción (se corrigió en el Turnero).`;
    case "turno_modificado": return `El turno de las ${hora(a.turno_stand_id)} se corrigió en el Turnero después de vincularlo.`;
    case "pago_contradictorio": return `En el turno de las ${hora(a.turno_stand_id)} el total y la forma de pago no coinciden. Revisalo en el Turnero.`;
    case "turnos_liberados": return `Se liberaron ${a.turnos?.length ?? 0} turno(s): vuelven a quedar disponibles.`;
    case "cierre_retirado": return "Se retiró el cierre sin turno: ahora tiene un turno vinculado.";
    default: return "Hay algo para revisar en esta interacción.";
  }
}

const etiquetaRol = (r: string | null) => (r === "admin" ? "Admin" : r === "staff" ? "Staff" : r === "sistema" ? "Sistema" : "—");

export default function Detalle({ id, rol, onCerrar, onEditar, onCambio, accionInicial }: {
  id: string;
  rol: Rol;
  onCerrar: () => void;
  onEditar: (i: InteraccionDto) => void;
  onCambio: (i: InteraccionDto) => void;
  accionInicial?: "vincular";
}) {
  const [i, setI] = useState<InteraccionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "exito" | "error" | "alerta"; texto: string } | null>(null);
  const [vinculando, setVinculando] = useState(accionInicial === "vincular");
  const [seleccion, setSeleccion] = useState<TurnoElegido[]>([]);
  const [dialogo, setDialogo] = useState<null | { tipo: "anular" } | { tipo: "cerrar" } | { tipo: "desvincular"; turno: string; hora: string }>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");
  const [motivoCierre, setMotivoCierre] = useState<MotivoCierre | "">("");
  const [notaCierre, setNotaCierre] = useState("");
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await api.obtener(id);
    if (r.ok) {
      setI(r.data.interaccion);
      setError(null);
    } else {
      setError(r.error);
    }
  }, [id]);

  useEffect(() => {
    // cargar() actualiza el estado DESPUÉS de await, no en forma síncrona
    // (falso positivo de react-hooks/set-state-in-effect, igual que en Colectivo).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function aplicar(nueva: InteraccionDto, texto: string) {
    setI(nueva);
    onCambio(nueva);
    setAviso({ tipo: "exito", texto });
  }

  async function manejarFallo(r: FalloApi) {
    if (r.codigo === "version_desactualizada") {
      await cargar();
      setAviso({ tipo: "alerta", texto: "La interacción cambió en otro dispositivo. Ya se ve la versión actual: revisala y repetí la acción si sigue haciendo falta." });
      return;
    }
    if (r.tipo === "red" || r.status >= 500) {
      await cargar();
      setAviso({ tipo: "alerta", texto: "No pudimos confirmar la operación. Recargamos la interacción: revisá si se aplicó antes de repetirla." });
      return;
    }
    if (moduloNoDisponible(r)) {
      setAviso({ tipo: "error", texto: "La carga de Interacciones todavía no está habilitada." });
      return;
    }
    if (r.codigo === "turno_ya_vinculado") {
      setSeleccion((s) => s.filter((t) => t.id !== r.turno_stand_id));
      setAviso({ tipo: "error", texto: "Uno de los turnos ya quedó vinculado a otra interacción. Lo quitamos de la selección: no se vinculó nada." });
      return;
    }
    setAviso({ tipo: "error", texto: r.error });
  }

  async function vincular() {
    if (!i || seleccion.length === 0) return;
    setEnviando(true);
    const r = await api.vincular(i.id, { version: i.version, turnos: seleccion.map((t) => t.id) });
    setEnviando(false);
    if (r.ok) {
      setSeleccion([]);
      setVinculando(false);
      aplicar(r.data.interaccion, r.data.interaccion.advertencias.some((a) => a.codigo === "cierre_retirado")
        ? "Turno vinculado. Se retiró el cierre sin turno."
        : "Turno vinculado.");
    } else {
      await manejarFallo(r);
    }
  }

  async function confirmarDialogo() {
    if (!i || !dialogo) return;
    setEnviando(true);
    const r = dialogo.tipo === "anular"
      ? await api.anular(i.id, { version: i.version, motivo: motivoAnulacion.trim() || null })
      : dialogo.tipo === "cerrar"
        ? await api.cerrar(i.id, { version: i.version, motivo: motivoCierre, nota: notaCierre.trim() || null })
        : await api.desvincular(i.id, dialogo.turno, i.version);
    setEnviando(false);
    const tipo = dialogo.tipo;
    setDialogo(null);
    if (r.ok) {
      aplicar(r.data.interaccion, tipo === "anular" ? "Interacción anulada. Sus turnos quedaron libres."
        : tipo === "cerrar" ? "Cerrada sin turno. Queda como subida declarada."
          : r.data.interaccion.vinculo.estado === "pendiente" ? "Turno desvinculado. Quedó pendiente de vínculo." : "Turno desvinculado.");
    } else {
      await manejarFallo(r);
    }
  }

  const hoy = hoyEnSim();
  const ayer = sumarDias(hoy, -1);
  const libres = i ? LIMITES.max_turnos_por_interaccion - i.turnos.length : 0;

  return (
    <Panel titulo="Interacción" onCerrar={onCerrar}>
      {error && !i ? (
        <Aviso tipo="error" acciones={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>{error}</Aviso>
      ) : !i ? (
        <Cargando />
      ) : (
        <div className="space-y-5">
          {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta tono="rojo">{ETIQUETAS.resultado[i.resultado]}</Etiqueta>
            <Etiqueta tono={tonoEstado(i.vinculo.estado)}>{ETIQUETAS.vinculo[i.vinculo.estado]}</Etiqueta>
            {i.vinculo.venta_verificada ? <Etiqueta tono="verde">Con turno pago</Etiqueta> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <Dato t="Cuándo">{etiquetaFecha(i.fecha_negocio, hoy, ayer)} · {i.hora_negocio}</Dato>
            <Dato t="Personas del grupo">{i.personas_grupo}</Dato>
            <Dato t="Hombres / mujeres">{i.hombres === null ? "Sin dato" : `${i.hombres} / ${i.mujeres}`}</Dato>
            <Dato t="Rango aproximado">{i.rango_etario ? ETIQUETAS.rango_etario[i.rango_etario] : "Sin dato"}</Dato>
            <Dato t="¿Conocían SIM?">{i.conocia_sim ? ETIQUETAS.respuesta[i.conocia_sim] : "Sin dato"}</Dato>
            <Dato t="¿Se habían subido?">{i.se_subio_antes ? ETIQUETAS.respuesta[i.se_subio_antes] : "Sin dato"}</Dato>
            <Dato t="Inició">{i.iniciador ? ETIQUETAS.iniciador[i.iniciador] : "Sin dato"}</Dato>
            <Dato t="Atendió (declarado)">{i.atendio ? `${i.atendio.nombre ?? "Integrante"}${i.atendio.activo ? "" : " (inactivo)"}` : "Sin asignar"}</Dato>
            {i.resultado !== "subio" ? <Dato t="Motivo">{i.motivo ? ETIQUETAS.motivo[i.motivo] : "Sin motivo"}</Dato> : null}
            <Dato t="Registró">{etiquetaRol(i.registrada_por_rol)} · {new Date(i.registrada_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Cordoba" })}</Dato>
          </dl>
          {i.observaciones ? <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-white/80">{i.observaciones}</p> : null}
          {i.cierre ? (
            <Aviso>Cerrada sin turno por admin: {ETIQUETAS.motivo_cierre[i.cierre.motivo]}{i.cierre.nota ? ` — ${i.cierre.nota}` : ""}.</Aviso>
          ) : null}
          {i.anulacion ? <Aviso tipo="alerta">Anulada por {etiquetaRol(i.anulacion.por_rol)}{i.anulacion.motivo ? `: ${i.anulacion.motivo}` : ""}. No cuenta en ninguna métrica.</Aviso> : null}
          {i.advertencias.filter((a) => a.codigo !== "turnos_liberados" && a.codigo !== "cierre_retirado").map((a, n) => (
            <Aviso key={`${a.codigo}-${n}`} tipo="alerta">{textoAdvertencia(a, i)}</Aviso>
          ))}

          {i.resultado === "subio" ? (
            <section aria-labelledby="t-vinc" className="space-y-2">
              <h3 id="t-vinc" className="text-sm font-black uppercase tracking-wide text-red-400">Turnos vinculados</h3>
              {i.turnos.length === 0 ? <p className="text-sm text-white/60">Ninguno todavía.</p> : (
                <ul className="space-y-2">
                  {i.turnos.map((t) => (
                    <li key={t.turno_stand_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm">
                      <span className="text-base font-black tabular-nums">{t.hora ?? "?"}</span>
                      {t.fecha !== i.fecha_negocio ? <span className="text-white/60">{etiquetaFecha(t.fecha, hoy, ayer)}</span> : null}
                      <span className="text-white/80">{t.personas ?? "?"} pers.</span>
                      <span className="text-white/80">{t.minutos ?? "?"} min</span>
                      <span className="font-semibold">{t.es_pago ? formatoMonto(t.total) : "Gratis"}</span>
                      {t.pago_contradictorio || t.turno_modificado || t.fuera_de_tolerancia ? (
                        <TriangleAlert className="h-4 w-4 text-amber-300" aria-label="Revisar este turno" />
                      ) : null}
                      {i.permisos.desvincular ? (
                        <Boton variante="fantasma" className="ml-auto" onClick={() => setDialogo({ tipo: "desvincular", turno: t.turno_stand_id, hora: t.hora ?? "?" })}>
                          <Unlink className="h-4 w-4" aria-hidden /> Desvincular
                        </Boton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {i.vinculo.turnos_vinculados > 0 ? (
                <p className="text-xs text-white/50">
                  Participaciones en esos turnos: {i.vinculo.participaciones} (no son personas distintas: alguien puede haber jugado más de una vez).
                </p>
              ) : null}
            </section>
          ) : null}

          {vinculando && i.permisos.vincular ? (
            <section aria-labelledby="t-elegir" className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 id="t-elegir" className="text-sm font-black uppercase tracking-wide text-red-400">Elegir turno del Turnero</h3>
              <p className="text-sm text-white/60">Buscamos alrededor de la hora de esta interacción ({etiquetaFecha(i.fecha_negocio, hoy, ayer)} {i.hora_negocio}).</p>
              <SelectorTurnos ancla={{ interaccion: i.id }} seleccion={seleccion} maximo={libres} onCambio={setSeleccion} deshabilitado={enviando} />
              <div className="flex flex-wrap justify-end gap-2">
                <Boton onClick={() => { setVinculando(false); setSeleccion([]); }}>Cancelar</Boton>
                <Boton variante="primario" disabled={seleccion.length === 0} cargando={enviando} onClick={() => void vincular()}>
                  Vincular{seleccion.length > 1 ? ` (${seleccion.length})` : ""}
                </Boton>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
            {i.permisos.editar ? <Boton onClick={() => onEditar(i)}><Pencil className="h-4 w-4" aria-hidden /> Editar</Boton> : null}
            {i.permisos.vincular && !vinculando && libres > 0 ? (
              <Boton variante={i.vinculo.estado === "pendiente" ? "primario" : "secundario"} onClick={() => setVinculando(true)}>
                <Link2 className="h-4 w-4" aria-hidden /> Vincular turno
              </Boton>
            ) : null}
            {i.permisos.cerrar_sin_vinculo ? <Boton onClick={() => setDialogo({ tipo: "cerrar" })}>Cerrar sin turno</Boton> : null}
            {i.permisos.anular ? <Boton variante="peligro" onClick={() => setDialogo({ tipo: "anular" })}>Anular</Boton> : null}
          </div>
          {!i.anulacion && !i.permisos.editar && rol === "staff" ? (
            <p className="text-xs text-white/50">Pasaron más de 48 h desde la carga: para corregirla o anularla, pedíselo a un admin. Vincular un turno sigue disponible.</p>
          ) : null}
        </div>
      )}

      {dialogo && i ? (
        <Dialogo
          titulo={dialogo.tipo === "anular" ? "Anular interacción" : dialogo.tipo === "cerrar" ? "Cerrar sin turno" : `Desvincular el turno de las ${dialogo.hora}`}
          onCerrar={() => setDialogo(null)}
          acciones={(
            <>
              <Boton onClick={() => setDialogo(null)}>Cancelar</Boton>
              <Boton variante={dialogo.tipo === "cerrar" ? "primario" : "peligro"} cargando={enviando}
                disabled={dialogo.tipo === "cerrar" && (!motivoCierre || (motivoCierre === "otro" && !notaCierre.trim()))}
                onClick={() => void confirmarDialogo()}>
                {dialogo.tipo === "anular" ? "Anular" : dialogo.tipo === "cerrar" ? "Cerrar sin turno" : "Desvincular"}
              </Boton>
            </>
          )}>
          {dialogo.tipo === "anular" ? (
            <>
              <p>Deja de contar en todo y sus turnos vuelven a quedar libres. No se puede deshacer desde acá.</p>
              <label className="mt-3 block space-y-1">
                <span className="text-xs text-white/60">Motivo (opcional)</span>
                <input value={motivoAnulacion} maxLength={LIMITES.motivo_anulacion_max} onChange={(e) => setMotivoAnulacion(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-white outline-none focus:border-red-500" placeholder="Ej.: cargada dos veces" />
              </label>
            </>
          ) : dialogo.tipo === "cerrar" ? (
            <>
              <p>Sigue siendo una subida declarada: no la verifica ni la cuenta como venta. Si después aparece el turno, vincularlo retira el cierre.</p>
              <fieldset className="mt-3 space-y-2">
                <legend className="text-xs text-white/60">Motivo</legend>
                {MOTIVOS_CIERRE.map((m) => (
                  <label key={m} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 px-3">
                    <input type="radio" name="motivo-cierre" value={m} checked={motivoCierre === m} onChange={() => setMotivoCierre(m)} className="h-4 w-4 accent-red-600" />
                    <span>{ETIQUETAS.motivo_cierre[m]}</span>
                  </label>
                ))}
              </fieldset>
              <label className="mt-3 block space-y-1">
                <span className="text-xs text-white/60">Nota {motivoCierre === "otro" ? "(obligatoria)" : "(opcional)"}</span>
                <input value={notaCierre} maxLength={LIMITES.nota_cierre_max} onChange={(e) => setNotaCierre(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-white outline-none focus:border-red-500" />
              </label>
            </>
          ) : (
            <p>{i.turnos.length === 1 ? "Es el único turno: la interacción vuelve a quedar pendiente de vínculo." : "El turno vuelve a quedar disponible para vincular."}</p>
          )}
        </Dialogo>
      ) : null}
    </Panel>
  );
}

function Dato({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-white/45">{t}</dt>
      <dd className="mt-0.5 break-words font-semibold text-white">{children}</dd>
    </div>
  );
}
