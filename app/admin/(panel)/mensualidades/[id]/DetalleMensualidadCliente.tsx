"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Check, Copy, Eye, EyeOff, Loader2, RefreshCw,
} from "lucide-react";
import { fechasPublicasPara, horariosPosiblesPara } from "@/lib/agenda";
import { fechaCorta, minutosATexto, telefonoLegible } from "../MensualidadesAdminCliente";

// Detalle y gestión de UNA mensualidad (Bloque M7).
//
// Cada acción de escritura pasa por el MISMO camino: se abre un panel, se
// escribe el motivo (obligatorio), se ve el antes y el después, se confirma.
// La clave de idempotencia se genera al abrir el panel y se renueva después de
// cada éxito: un doble clic no aplica dos veces y un reintento tampoco.
//
// La pantalla no impone ninguna regla: todas las valida el servidor y las
// vuelve a validar la base. Lo que hay acá es la forma de pedirlas bien.

type Reserva = {
  referencia: string;
  fecha: string;
  hora: string;
  duracion: number;
  simuladores: number;
  minutos_consumidos: number;
  estado: string;
  cancelacion_resultado: string | null;
  reprogramaciones: number | null;
  no_show: boolean;
};

type Movimiento = {
  tipo: string;
  fecha: string;
  minutos: number | null;
  saldo_posterior: number | null;
  motivo: string | null;
  actor: string;
  detalle: Record<string, unknown> | null;
};

type Auditoria = {
  accion: string; actor: string; actor_rol: string; motivo: string;
  referencia: string | null; fecha: string;
};

type Detalle = {
  id: string;
  titular: {
    nombre: string; apellido: string; telefono: string; email: string;
    estado: string; bloqueo_motivo: string | null;
  };
  codigo: string | null;
  codigo_visible: boolean;
  plan: {
    nombre: string | null; comprado_at: string | null; minutos_originales: number | null;
    vigencia_dias: number | null; minutos_trasladados: number | null;
  };
  saldo_minutos: number;
  vence_el: string;
  creada_at: string;
  historial: Movimiento[];
  reservas: { proximas: Reserva[]; pasadas: Reserva[]; canceladas: Reserva[] };
  auditoria: Auditoria[];
};

type Accion =
  | "extender_vencimiento" | "ajustar_saldo" | "bloquear" | "reactivar"
  | "cambiar_telefono" | "regenerar_codigo" | "cancelar_reserva" | "reprogramar_reserva";

const ETIQUETA_ESTADO: Record<string, string> = {
  vigente: "Activa", agotada: "Sin minutos", vencida: "Vencida", bloqueada: "Bloqueada",
};
const COLOR_ESTADO: Record<string, string> = {
  vigente: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  agotada: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  vencida: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  bloqueada: "bg-red-500/10 text-red-300 border-red-500/30",
};
const ETIQUETA_MOV: Record<string, string> = {
  compra: "Compra", renovacion: "Renovación", descarte: "Minutos descartados",
  consumo: "Consumo por reserva", devolucion: "Devolución por cancelación",
  ajuste_admin: "Ajuste administrativo", extender_vencimiento: "Vencimiento extendido",
  bloquear: "Bloqueada", reactivar: "Reactivada", cambiar_telefono: "Teléfono cambiado",
  regenerar_codigo: "Código regenerado", cancelar_reserva: "Reserva cancelada",
  reprogramar_reserva: "Reserva reprogramada",
};

/** Clave opaca por intento lógico: sin datos del titular adentro. */
function nuevaClave(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const CAJA = "rounded-2xl border border-white/10 bg-zinc-900/50 p-5";
const ROTULO = "text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none";

export default function DetalleMensualidadCliente({ id, rol }: { id: string; rol: string }) {
  const esAdmin = rol === "admin";

  const [d, setD] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [panel, setPanel] = useState<Accion | null>(null);
  const [clave, setClave] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Campos propios de cada acción.
  const [fecha, setFecha] = useState("");
  const [operacion, setOperacion] = useState<"agregar" | "descontar">("agregar");
  const [minutos, setMinutos] = useState(60);
  const [telefono, setTelefono] = useState("");
  const [reserva, setReserva] = useState<Reserva | null>(null);
  const [hora, setHora] = useState("");
  const [verCodigo, setVerCodigo] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mensualidades/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 404 ? "No encontramos esa mensualidad." : "No pudimos cargarla.");
        setD(null);
        return;
      }
      setD((await res.json()) as Detalle);
    } catch {
      setError("No pudimos cargarla. Revisá la conexión.");
      setD(null);
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  function abrir(a: Accion, r?: Reserva) {
    setPanel(a);
    setClave(nuevaClave());
    setMotivo("");
    setErrorAccion(null);
    setAviso(null);
    setReserva(r ?? null);
    setFecha("");
    setHora("");
    setTelefono("");
    setMinutos(60);
    setOperacion("agregar");
  }

  function cerrar() {
    setPanel(null);
    setErrorAccion(null);
  }

  async function enviar(cuerpo: Record<string, unknown>) {
    setEnviando(true);
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/admin/mensualidades/${id}/acciones`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...cuerpo, motivo, idempotency_key: clave }),
      });
      const json = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        setErrorAccion(String(json.error ?? "No pudimos completar la operación."));
        return;
      }
      setPanel(null);
      // El código nuevo se muestra UNA vez: no vuelve a viajar en el detalle.
      setAviso(
        typeof json.codigo_nuevo === "string"
          ? `Código nuevo: ${json.codigo_nuevo}. Anotalo ahora: el anterior ya no sirve.`
          : "Listo.",
      );
      await cargar();
    } catch {
      setErrorAccion("No pudimos completar la operación. Revisá la conexión.");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  if (error || !d) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-3 font-bold text-white">{error}</p>
        <Link href="/admin/mensualidades" className="mt-4 inline-block text-sm text-zinc-400 underline">
          Volver al listado
        </Link>
      </div>
    );
  }

  const motivoOk = motivo.trim().length > 0;
  const nombreCompleto = `${d.titular.nombre} ${d.titular.apellido}`;
  // Las fechas ofrecidas son las mismas que puede usar el titular: la agenda no
  // cambia por venir de la administración.
  const fechasPosibles = fechasPublicasPara("mensualidad");
  const horasPosibles = fecha && reserva ? horariosPosiblesPara("mensualidad", fecha, reserva.duracion) : [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <Link
        href="/admin/mensualidades"
        className="mb-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="h-4 w-4" /> Mensualidades
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl">{nombreCompleto}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {telefonoLegible(d.titular.telefono)} · {d.titular.email}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${COLOR_ESTADO[d.titular.estado] ?? ""}`}>
          {ETIQUETA_ESTADO[d.titular.estado] ?? d.titular.estado}
        </span>
      </header>

      {d.titular.bloqueo_motivo && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><span className="font-bold">Bloqueada:</span> {d.titular.bloqueo_motivo}</p>
        </div>
      )}

      {aviso && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-bold">{aviso}</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── Plan y saldo ── */}
        <section className={`${CAJA} lg:col-span-2`}>
          <h2 className="mb-4 text-lg font-black text-white">Plan y saldo</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className={ROTULO}>Saldo disponible</dt>
              <dd className="mt-1 text-2xl font-black text-white">{minutosATexto(d.saldo_minutos)}</dd>
            </div>
            <div>
              <dt className={ROTULO}>Vence</dt>
              <dd className="mt-1 font-bold text-white">{fechaCorta(d.vence_el)}</dd>
              <dd className="text-xs text-zinc-600">a las 23:59</dd>
            </div>
            <div>
              <dt className={ROTULO}>Último plan</dt>
              <dd className="mt-1 font-bold text-white">{d.plan.nombre ?? "—"}</dd>
              <dd className="text-xs text-zinc-600">{fechaCorta(d.plan.comprado_at)}</dd>
            </div>
            <div>
              <dt className={ROTULO}>Minutos del plan</dt>
              <dd className="mt-1 text-zinc-300">
                {d.plan.minutos_originales != null ? minutosATexto(d.plan.minutos_originales) : "—"}
              </dd>
            </div>
            <div>
              <dt className={ROTULO}>Vigencia</dt>
              <dd className="mt-1 text-zinc-300">
                {d.plan.vigencia_dias != null ? `${d.plan.vigencia_dias} días` : "—"}
              </dd>
            </div>
            <div>
              <dt className={ROTULO}>Trasladado</dt>
              <dd className="mt-1 text-zinc-300">
                {d.plan.minutos_trasladados ? minutosATexto(d.plan.minutos_trasladados) : "—"}
              </dd>
            </div>
          </dl>
        </section>

        {/* ── Código de acceso ── */}
        <section className={CAJA}>
          <h2 className="mb-4 text-lg font-black text-white">Código de acceso</h2>
          {d.codigo_visible && d.codigo ? (
            <>
              <div className="flex items-center gap-2">
                <p className="flex-1 font-mono text-lg font-black tracking-wider text-white">
                  {verCodigo ? d.codigo : "MEN-••••-••••"}
                </p>
                <button
                  type="button"
                  onClick={() => setVerCodigo((v) => !v)}
                  aria-label={verCodigo ? "Ocultar código" : "Mostrar código"}
                  className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-white"
                >
                  {verCodigo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(d.codigo ?? "");
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 1500);
                  }}
                  aria-label="Copiar código"
                  className="rounded-lg border border-white/10 p-2 text-zinc-400 hover:text-white"
                >
                  {copiado ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-3 text-xs text-zinc-600">
                Con este código y el teléfono, el titular entra a Mi Plan. No lo compartas por un canal
                que no controles.
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              El código solo lo puede ver un administrador.
            </p>
          )}
        </section>
      </div>

      {/* ── Acciones ── */}
      {esAdmin && (
        <section className={`${CAJA} mt-5`}>
          <h2 className="mb-1 text-lg font-black text-white">Gestión</h2>
          <p className="mb-4 text-xs text-zinc-600">
            Toda acción pide un motivo y queda registrada con el rol que la ejecutó.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              ["extender_vencimiento", "Extender vencimiento"],
              ["ajustar_saldo", "Ajustar saldo"],
              d.titular.estado === "bloqueada"
                ? ["reactivar", "Reactivar"]
                : ["bloquear", "Bloquear"],
              ["cambiar_telefono", "Cambiar teléfono"],
              ["regenerar_codigo", "Regenerar código"],
            ].map(([a, label]) => (
              <button
                key={a}
                type="button"
                onClick={() => abrir(a as Accion)}
                className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-2 text-xs font-bold text-zinc-200 transition hover:border-white/30 hover:text-white"
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Panel de la acción elegida ── */}
      {panel && (
        <section className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-5">
          <h3 className="text-lg font-black text-white">
            {panel === "extender_vencimiento" && "Extender vencimiento"}
            {panel === "ajustar_saldo" && "Ajustar saldo"}
            {panel === "bloquear" && "Bloquear mensualidad"}
            {panel === "reactivar" && "Reactivar mensualidad"}
            {panel === "cambiar_telefono" && "Cambiar teléfono"}
            {panel === "regenerar_codigo" && "Regenerar código"}
            {panel === "cancelar_reserva" && "Cancelar reserva"}
            {panel === "reprogramar_reserva" && "Reprogramar reserva"}
          </h3>

          <div className="mt-4 space-y-4">
            {panel === "extender_vencimiento" && (
              <div>
                <label className={ROTULO} htmlFor="nueva-fecha">Nueva fecha de vencimiento</label>
                <input
                  id="nueva-fecha" type="date" value={fecha} min={d.vence_el}
                  onChange={(e) => setFecha(e.target.value)} className={`${INPUT} mt-1`}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Actual: <span className="font-bold text-zinc-300">{fechaCorta(d.vence_el)}</span>
                  {fecha && <> → nuevo: <span className="font-bold text-white">{fechaCorta(fecha)}</span></>}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Vence a las 23:59 del día elegido. Desde acá el vencimiento solo se extiende, y no
                  se crea ninguna compra ni se toca el saldo.
                </p>
              </div>
            )}

            {panel === "ajustar_saldo" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {(["agregar", "descontar"] as const).map((o) => (
                    <button
                      key={o} type="button" onClick={() => setOperacion(o)}
                      className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
                        operacion === o
                          ? "border-red-500 bg-red-600 text-white"
                          : "border-white/10 bg-zinc-950 text-zinc-300 hover:border-white/30"
                      }`}
                    >
                      {o === "agregar" ? "Agregar" : "Descontar"}
                    </button>
                  ))}
                </div>
                <div>
                  <label className={ROTULO} htmlFor="minutos">Minutos (múltiplos de 15)</label>
                  <input
                    id="minutos" type="number" min={15} step={15} value={minutos}
                    onChange={(e) => setMinutos(Number(e.target.value))} className={`${INPUT} mt-1`}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Saldo actual: <span className="font-bold text-zinc-300">{minutosATexto(d.saldo_minutos)}</span>
                  {minutos > 0 && minutos % 15 === 0 && (
                    <> → resultante:{" "}
                      <span className="font-bold text-white">
                        {minutosATexto(Math.max(
                          d.saldo_minutos + (operacion === "agregar" ? minutos : -minutos), 0,
                        ))}
                      </span>
                    </>
                  )}
                </p>
                <p className="text-xs text-zinc-600">
                  Es un ajuste administrativo: no crea una compra, no mueve el vencimiento y no genera
                  ingresos ni egresos.
                </p>
              </div>
            )}

            {panel === "bloquear" && (
              <p className="text-sm text-zinc-300">
                Deja de poder reservar, reprogramar y comprar, y se le cierran las sesiones abiertas.
                El saldo, el vencimiento y las reservas ya hechas <span className="font-bold">no se tocan</span>.
              </p>
            )}

            {panel === "reactivar" && (
              <p className="text-sm text-zinc-300">
                Vuelve a operar con lo que tenía. No suma saldo, no extiende el vencimiento y no
                recupera minutos vencidos.
              </p>
            )}

            {panel === "cambiar_telefono" && (
              <div>
                <label className={ROTULO} htmlFor="tel">Teléfono nuevo</label>
                <input
                  id="tel" type="tel" value={telefono} placeholder="351 512 3456"
                  onChange={(e) => setTelefono(e.target.value)} className={`${INPUT} mt-1`}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Actual: <span className="font-bold text-zinc-300">{telefonoLegible(d.titular.telefono)}</span>
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Con código de área y sin el 0 ni el 15. Se cierran todas las sesiones y el número
                  anterior deja de servir para entrar. Si ya pertenece a otra mensualidad, se rechaza.
                </p>
              </div>
            )}

            {panel === "regenerar_codigo" && (
              <p className="text-sm text-zinc-300">
                El código actual deja de servir en el acto y se cierran las sesiones abiertas.
                El nuevo se muestra <span className="font-bold">una sola vez</span>.
              </p>
            )}

            {panel === "cancelar_reserva" && reserva && (
              <p className="text-sm text-zinc-300">
                {fechaCorta(reserva.fecha)} · {reserva.hora} · {reserva.duracion} min ·{" "}
                {reserva.simuladores} simuladores. Se aplica la política de siempre: los minutos
                vuelven solo si faltan 24 horas o más. Si querés hacer una excepción, cancelá y después
                ajustá el saldo con su propio motivo.
              </p>
            )}

            {panel === "reprogramar_reserva" && reserva && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-300">
                  Turno actual: {fechaCorta(reserva.fecha)} · {reserva.hora} · {reserva.duracion} min ·{" "}
                  {reserva.simuladores} simuladores. La duración y los simuladores no cambian.
                </p>
                <div>
                  <label className={ROTULO} htmlFor="re-fecha">Fecha nueva</label>
                  <select
                    id="re-fecha" value={fecha} onChange={(e) => { setFecha(e.target.value); setHora(""); }}
                    className={`${INPUT} mt-1`}
                  >
                    <option value="">Elegí una fecha</option>
                    {fechasPosibles.map((f) => (
                      <option key={f} value={f}>{fechaCorta(f)}</option>
                    ))}
                  </select>
                </div>
                {fecha && (
                  <div>
                    <label className={ROTULO} htmlFor="re-hora">Horario nuevo</label>
                    <select
                      id="re-hora" value={hora} onChange={(e) => setHora(e.target.value)}
                      className={`${INPUT} mt-1`}
                    >
                      <option value="">Elegí un horario</option>
                      {horasPosibles.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-zinc-600">
                      Si el turno está ocupado, el servidor lo rechaza y la reserva original queda intacta.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className={ROTULO} htmlFor="motivo">Motivo (obligatorio)</label>
              <textarea
                id="motivo" value={motivo} rows={2} maxLength={500}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por qué se hace esta operación"
                className={`${INPUT} mt-1 resize-none`}
              />
            </div>

            {errorAccion && (
              <p className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-bold text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {errorAccion}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  !motivoOk || enviando
                  || (panel === "extender_vencimiento" && !fecha)
                  || (panel === "cambiar_telefono" && !telefono.trim())
                  || (panel === "ajustar_saldo" && (!minutos || minutos <= 0 || minutos % 15 !== 0))
                  || (panel === "reprogramar_reserva" && (!fecha || !hora))
                }
                onClick={() => {
                  const base: Record<string, unknown> = { accion: panel };
                  if (panel === "extender_vencimiento") base.fecha = fecha;
                  if (panel === "ajustar_saldo") { base.operacion = operacion; base.minutos = minutos; }
                  if (panel === "cambiar_telefono") base.telefono = telefono.trim();
                  if (panel === "cancelar_reserva") base.referencia = reserva?.referencia;
                  if (panel === "reprogramar_reserva") {
                    base.referencia = reserva?.referencia; base.fecha = fecha; base.hora = hora;
                  }
                  void enviar(base);
                }}
                className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-black uppercase tracking-wider text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar
              </button>
              <button
                type="button" onClick={cerrar} disabled={enviando}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-bold text-zinc-300 hover:border-white/30"
              >
                Cancelar
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Reservas ── */}
      <section className={`${CAJA} mt-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">Reservas</h2>
          <button
            type="button" onClick={() => void cargar()}
            className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-300"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </button>
        </div>

        {(["proximas", "pasadas", "canceladas"] as const).map((tramo) => {
          const lista = d.reservas[tramo];
          const titulo = tramo === "proximas" ? "Próximas" : tramo === "pasadas" ? "Pasadas" : "Canceladas";
          return (
            <div key={tramo} className="mb-5 last:mb-0">
              <p className={`${ROTULO} mb-2`}>{titulo} ({lista.length})</p>
              {lista.length === 0 ? (
                <p className="text-xs text-zinc-600">No hay.</p>
              ) : (
                <ul className="space-y-2">
                  {lista.map((r) => (
                    <li
                      key={r.referencia}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-zinc-950/60 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white">
                          {fechaCorta(r.fecha)} · {r.hora}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {r.duracion} min · {r.simuladores} simuladores · {minutosATexto(r.minutos_consumidos)} consumidos
                          {r.reprogramaciones ? ` · ${r.reprogramaciones} reprogramación${r.reprogramaciones === 1 ? "" : "es"}` : ""}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-600">
                          {r.referencia} · {r.estado}
                          {r.cancelacion_resultado ? ` · ${r.cancelacion_resultado === "restituida" ? "minutos devueltos" : "sin devolución"}` : ""}
                          {r.no_show ? " · no se presentó" : ""}
                        </p>
                      </div>
                      {esAdmin && tramo === "proximas" && r.estado === "activa" && !r.no_show && (
                        <div className="flex gap-2">
                          <button
                            type="button" onClick={() => abrir("reprogramar_reserva", r)}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-white/30 hover:text-white"
                          >
                            Reprogramar
                          </button>
                          <button
                            type="button" onClick={() => abrir("cancelar_reserva", r)}
                            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/10"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Historial ── */}
      <section className={`${CAJA} mt-5`}>
        <h2 className="mb-4 text-lg font-black text-white">Historial</h2>
        {d.historial.length === 0 ? (
          <p className="text-xs text-zinc-600">Todavía no hay movimientos.</p>
        ) : (
          <ul className="space-y-2">
            {d.historial.map((h, i) => (
              <li key={`${h.fecha}-${i}`} className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{ETIQUETA_MOV[h.tipo] ?? h.tipo}</p>
                  {h.motivo && <p className="text-xs text-zinc-500">{h.motivo}</p>}
                  <p className="text-[11px] text-zinc-600">
                    {new Date(h.fecha).toLocaleString("es-AR")} · {h.actor}
                  </p>
                </div>
                {h.minutos != null && (
                  <p className={`shrink-0 text-sm font-black tabular-nums ${h.minutos > 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {h.minutos > 0 ? "+" : ""}{h.minutos} min
                    {h.saldo_posterior != null && (
                      <span className="block text-right text-[11px] font-normal text-zinc-600">
                        queda {minutosATexto(h.saldo_posterior)}
                      </span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Auditoría (solo admin) ── */}
      {esAdmin && (
        <section className={`${CAJA} mt-5`}>
          <h2 className="mb-4 text-lg font-black text-white">Auditoría</h2>
          {d.auditoria.length === 0 ? (
            <p className="text-xs text-zinc-600">Todavía no se hizo ninguna acción administrativa.</p>
          ) : (
            <ul className="space-y-2">
              {d.auditoria.map((a, i) => (
                <li key={`${a.fecha}-${i}`} className="border-b border-white/5 pb-2 text-sm last:border-0">
                  <p className="font-bold text-white">{ETIQUETA_MOV[a.accion] ?? a.accion}</p>
                  <p className="text-xs text-zinc-400">{a.motivo}</p>
                  <p className="text-[11px] text-zinc-600">
                    {new Date(a.fecha).toLocaleString("es-AR")} · {a.actor} ({a.actor_rol})
                    {a.referencia ? ` · ${a.referencia}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
