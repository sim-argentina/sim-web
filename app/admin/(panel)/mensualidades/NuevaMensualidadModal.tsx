"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Check, CircleAlert, Loader2, Lock, X,
} from "lucide-react";

// Alta y renovación administrativa de una mensualidad (Bloque M7.4).
//
// Esta pantalla NO calcula nada de lo que importa. El precio, los minutos, el
// vencimiento, el código y la decisión alta/renovación los resuelve el servidor:
// acá se piden los datos, se muestra la VISTA PREVIA que devuelve el servidor y
// se confirma. Si esta pantalla mintiera, el resultado sería el mismo igual.
//
// Dos pasos a propósito: formulario → resumen → confirmar. Un alta mueve dinero
// y acredita minutos; que aparezca antes qué va a pasar evita la mitad de los
// errores de mostrador.

export type PlanOpcion = {
  slug: string;
  nombre: string;
  minutos: number;
  precio: number;
};

type Situacion =
  | { tipo: "sin_mensualidad" }
  | {
      tipo: "existente";
      mensualidadId: string;
      estado: string;
      saldoMinutos: number;
      venceEl: string;
      bloqueada: boolean;
      titular: string;
    };

type Previa = {
  situacion: Situacion;
  operacion: "alta" | "renovacion";
  bloqueada: boolean;
  plan: { slug: string; nombre: string; minutos: number; precio: number; vigenciaDias: number };
  minutosTrasladados: number;
  minutosDescartados: number;
  saldoResultante: number;
  venceEstimado: string;
  codigoConservado: boolean;
  importe: number | null;
};

type Registrada = {
  mensualidad_id: string;
  codigo: string;
  tipo: "alta" | "renovacion";
  saldo_posterior: number;
  vence_el: string;
  idempotente: boolean;
};

const CORTESIAS = [
  { valor: "cortesia_comercial", label: "Cortesía comercial" },
  { valor: "compensacion", label: "Compensación" },
  { valor: "correccion_autorizada", label: "Corrección autorizada" },
] as const;

const MEDIOS = [
  { valor: "efectivo", label: "Efectivo" },
  { valor: "qr", label: "QR" },
  { valor: "debito", label: "Débito" },
  { valor: "credito", label: "Crédito" },
] as const;

function minutosATexto(min: number): string {
  if (!min) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function pesos(n: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(y, m - 1, d));
}

/** Clave de idempotencia del INTENTO. Se genera una vez y se reusa al reintentar. */
function nuevaClave(): string {
  const c = globalThis.crypto;
  const base = c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `adm${base.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 64);
}

const ETIQUETA_ESTADO: Record<string, string> = {
  vigente: "Activa",
  agotada: "Sin minutos",
  vencida: "Vencida",
  bloqueada: "Bloqueada",
};

const campoBase =
  "w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm text-white " +
  "placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-red-500/40";

export default function NuevaMensualidadModal({
  planes,
  onCerrar,
  onCreada,
}: {
  planes: PlanOpcion[];
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [paso, setPaso] = useState<"form" | "resumen" | "listo">("form");

  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [planSlug, setPlanSlug] = useState(planes[0]?.slug ?? "");
  const [modalidad, setModalidad] = useState<"venta" | "cortesia">("venta");
  const [medioPago, setMedioPago] = useState<string>("efectivo");
  const [cortesiaTipo, setCortesiaTipo] = useState<string>("cortesia_comercial");
  const [motivo, setMotivo] = useState("");
  const [declaracion, setDeclaracion] = useState(false);

  const [previa, setPrevia] = useState<Previa | null>(null);
  const [creada, setCreada] = useState<Registrada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campoMal, setCampoMal] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Una clave por intento lógico. Sobrevive a un reintento tras un error de red,
  // así que si la primera llegó igual, el servidor devuelve lo mismo en vez de
  // crear una segunda mensualidad.
  const claveRef = useRef<string>(nuevaClave());
  const dialogoRef = useRef<HTMLDivElement>(null);

  // Escape cierra, y el foco arranca dentro del diálogo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onCerrar(); };
    document.addEventListener("keydown", onKey);
    dialogoRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCerrar, enviando]);

  const cuerpo = useCallback(() => ({
    nombre: nombre.trim(),
    apellido: apellido.trim(),
    telefono: telefono.trim(),
    email: email.trim(),
    plan_slug: planSlug,
    modalidad,
    ...(modalidad === "venta" ? { medio_pago: medioPago } : { cortesia_tipo: cortesiaTipo }),
    motivo: motivo.trim(),
    declaracion,
    idempotency_key: claveRef.current,
  }), [nombre, apellido, telefono, email, planSlug, modalidad, medioPago, cortesiaTipo, motivo, declaracion]);

  // ── Paso 1 → 2: el SERVIDOR dice qué va a pasar ──
  async function verResumen() {
    setError(null);
    setCampoMal(null);

    // Comprobaciones mínimas de forma, para no ir al servidor por un campo vacío.
    // La validación que vale es la del servidor, que se repite igual.
    if (!nombre.trim()) return faltante("nombre", "Escribí el nombre.");
    if (!apellido.trim()) return faltante("apellido", "Escribí el apellido.");
    if (!telefono.trim()) return faltante("telefono", "Escribí el teléfono.");
    if (!email.trim()) return faltante("email", "Escribí el correo electrónico.");
    if (!motivo.trim()) return faltante("motivo", "Escribí el motivo de la operación.");
    if (!declaracion) {
      return faltante("declaracion", "Confirmá que le informaste al titular las condiciones.");
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/admin/mensualidades/nueva/previa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ telefono: telefono.trim(), plan_slug: planSlug, modalidad }),
      });
      const json = (await res.json()) as Previa & { error?: string; campo?: string };
      if (!res.ok) {
        setError(json.error ?? "No pudimos calcular la vista previa.");
        setCampoMal(json.campo ?? null);
        return;
      }
      setPrevia(json);
      setPaso("resumen");
    } catch {
      setError("No pudimos conectar con el servidor. Revisá la conexión.");
    } finally {
      setEnviando(false);
    }
  }

  function faltante(campo: string, mensaje: string) {
    setCampoMal(campo);
    setError(mensaje);
  }

  // ── Paso 2 → 3: confirmar ──
  async function confirmar() {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mensualidades/nueva", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo()),
      });
      const json = (await res.json()) as Registrada & { error?: string; campo?: string };
      if (!res.ok) {
        setError(json.error ?? "No pudimos registrar la mensualidad.");
        setCampoMal(json.campo ?? null);
        // Un error de datos vuelve al formulario; uno de estado se queda acá.
        if (json.campo) setPaso("form");
        return;
      }
      setCreada(json);
      setPaso("listo");
      onCreada();
    } catch {
      setError("No pudimos conectar con el servidor. Podés reintentar sin duplicar.");
    } finally {
      setEnviando(false);
    }
  }

  const bloqueada = previa?.bloqueada === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-nueva-mensualidad"
    >
      <div
        ref={dialogoRef}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl sm:rounded-3xl"
      >
        {/* ── Encabezado ── */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {paso === "resumen" && (
              <button
                type="button"
                onClick={() => setPaso("form")}
                disabled={enviando}
                aria-label="Volver al formulario"
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <h2 id="titulo-nueva-mensualidad" className="truncate text-base font-black text-white">
              {paso === "listo" ? "Mensualidad registrada" : "Nueva mensualidad"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* ════ PASO 1 · FORMULARIO ════ */}
          {paso === "form" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="nm-nombre" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Nombre
                  </label>
                  <input
                    id="nm-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                    autoComplete="off" maxLength={60}
                    aria-invalid={campoMal === "nombre"}
                    className={`${campoBase} ${campoMal === "nombre" ? "border-red-500/60" : ""}`}
                  />
                </div>
                <div>
                  <label htmlFor="nm-apellido" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Apellido
                  </label>
                  <input
                    id="nm-apellido" value={apellido} onChange={(e) => setApellido(e.target.value)}
                    autoComplete="off" maxLength={60}
                    aria-invalid={campoMal === "apellido"}
                    className={`${campoBase} ${campoMal === "apellido" ? "border-red-500/60" : ""}`}
                  />
                </div>
                <div>
                  <label htmlFor="nm-telefono" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Teléfono
                  </label>
                  <input
                    id="nm-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)}
                    inputMode="tel" autoComplete="off" placeholder="351 512 3456"
                    aria-describedby="nm-telefono-ayuda"
                    aria-invalid={campoMal === "telefono"}
                    className={`${campoBase} ${campoMal === "telefono" ? "border-red-500/60" : ""}`}
                  />
                  <p id="nm-telefono-ayuda" className="mt-1 text-[11px] leading-snug text-zinc-600">
                    Con código de área, sin 0 ni 15. Es lo que identifica al titular.
                  </p>
                </div>
                <div>
                  <label htmlFor="nm-email" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Correo electrónico
                  </label>
                  <input
                    id="nm-email" value={email} onChange={(e) => setEmail(e.target.value)}
                    type="email" inputMode="email" autoComplete="off" maxLength={120}
                    aria-invalid={campoMal === "email"}
                    className={`${campoBase} ${campoMal === "email" ? "border-red-500/60" : ""}`}
                  />
                </div>
              </div>

              {/* ── Plan ── */}
              <fieldset>
                <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Plan</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {planes.map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => setPlanSlug(p.slug)}
                      aria-pressed={planSlug === p.slug}
                      className={`rounded-xl border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-red-500/40 ${
                        planSlug === p.slug
                          ? "border-red-500 bg-red-600/10"
                          : "border-white/10 bg-zinc-900 hover:border-white/30"
                      }`}
                    >
                      <span className="block text-sm font-bold text-white">{p.nombre}</span>
                      <span className="block text-xs text-zinc-500">{minutosATexto(p.minutos)}</span>
                      <span className="mt-0.5 block text-xs font-bold text-zinc-300">{pesos(p.precio)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* ── Modalidad ── */}
              <fieldset>
                <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Modalidad</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setModalidad("venta")}
                    aria-pressed={modalidad === "venta"}
                    className={`rounded-xl border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-red-500/40 ${
                      modalidad === "venta"
                        ? "border-red-500 bg-red-600/10"
                        : "border-white/10 bg-zinc-900 hover:border-white/30"
                    }`}
                  >
                    <span className="block text-sm font-bold text-white">Venta</span>
                    <span className="block text-xs text-zinc-500">Se cobró fuera de la web</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalidad("cortesia")}
                    aria-pressed={modalidad === "cortesia"}
                    className={`rounded-xl border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-red-500/40 ${
                      modalidad === "cortesia"
                        ? "border-red-500 bg-red-600/10"
                        : "border-white/10 bg-zinc-900 hover:border-white/30"
                    }`}
                  >
                    <span className="block text-sm font-bold text-white">Cortesía</span>
                    <span className="block text-xs text-zinc-500">Sin cobro</span>
                  </button>
                </div>
              </fieldset>

              {/* ── Campos según la modalidad ── */}
              {modalidad === "venta" ? (
                <div>
                  <label htmlFor="nm-medio" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Medio de pago
                  </label>
                  <select
                    id="nm-medio" value={medioPago} onChange={(e) => setMedioPago(e.target.value)}
                    aria-invalid={campoMal === "medio_pago"}
                    className={`${campoBase} ${campoMal === "medio_pago" ? "border-red-500/60" : ""}`}
                  >
                    {MEDIOS.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-600">
                    {medioPago === "efectivo"
                      ? "Entra a la cuenta Efectivo. Sin comisión de cobro."
                      : "Se procesa por Mercado Pago. La comisión sale de la configuración de Finanzas."}
                  </p>
                </div>
              ) : (
                <div>
                  <label htmlFor="nm-cortesia" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Tipo de otorgamiento
                  </label>
                  <select
                    id="nm-cortesia" value={cortesiaTipo} onChange={(e) => setCortesiaTipo(e.target.value)}
                    aria-invalid={campoMal === "cortesia_tipo"}
                    className={`${campoBase} ${campoMal === "cortesia_tipo" ? "border-red-500/60" : ""}`}
                  >
                    {CORTESIAS.map((c) => <option key={c.valor} value={c.valor}>{c.label}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-600">
                    No genera ingreso, comisión ni registro de pago.
                  </p>
                </div>
              )}

              {/* ── Motivo ── */}
              <div>
                <label htmlFor="nm-motivo" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Motivo
                </label>
                <textarea
                  id="nm-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  rows={2} maxLength={500}
                  placeholder="Queda en la auditoría"
                  aria-invalid={campoMal === "motivo"}
                  className={`${campoBase} resize-none ${campoMal === "motivo" ? "border-red-500/60" : ""}`}
                />
              </div>

              {/* ── Declaración administrativa ── */}
              {/* No es la aceptación del cliente: es el admin diciendo que informó. */}
              <label
                htmlFor="nm-declaracion"
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  campoMal === "declaracion" ? "border-red-500/60 bg-red-500/5" : "border-white/10 bg-zinc-900"
                }`}
              >
                <input
                  id="nm-declaracion" type="checkbox" checked={declaracion}
                  onChange={(e) => setDeclaracion(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
                />
                <span className="text-xs leading-relaxed text-zinc-300">
                  Confirmo que le informé al titular las condiciones de uso y vigencia.
                </span>
              </label>
            </div>
          )}

          {/* ════ PASO 2 · RESUMEN ════ */}
          {paso === "resumen" && previa && (
            <div className="space-y-4">
              {previa.situacion.tipo === "existente" && (
                <div
                  className={`flex items-start gap-3 rounded-xl border p-3 text-xs ${
                    bloqueada
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {bloqueada ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-bold">
                      {bloqueada
                        ? "Esta mensualidad está bloqueada"
                        : `Ya existe una mensualidad de ${previa.situacion.titular || "este titular"}`}
                    </p>
                    <p className="mt-0.5 leading-relaxed">
                      {bloqueada
                        ? "No se puede renovar hasta reactivarla. Entrá al detalle y reactivala explícitamente."
                        : `Estado ${ETIQUETA_ESTADO[previa.situacion.estado] ?? previa.situacion.estado} · ` +
                          `saldo ${minutosATexto(previa.situacion.saldoMinutos)} · ` +
                          `vence el ${fechaLarga(previa.situacion.venceEl)}.`}
                    </p>
                    {bloqueada && (
                      <Link
                        href={`/admin/mensualidades/${previa.situacion.mensualidadId}`}
                        className="mt-2 inline-block rounded-lg border border-red-500/40 px-3 py-1 font-bold hover:bg-red-500/10"
                      >
                        Ir al detalle
                      </Link>
                    )}
                  </div>
                </div>
              )}

              <dl className="divide-y divide-white/5 rounded-xl border border-white/10 bg-zinc-900/60">
                <Dato etiqueta="Titular" valor={`${nombre.trim()} ${apellido.trim()}`} />
                <Dato etiqueta="Teléfono" valor={telefono.trim()} />
                <Dato etiqueta="Operación" valor={previa.operacion === "alta" ? "Alta nueva" : "Renovación"} />
                <Dato etiqueta="Plan" valor={previa.plan.nombre} />
                <Dato etiqueta="Minutos del plan" valor={minutosATexto(previa.plan.minutos)} />
                {previa.operacion === "renovacion" && (
                  <>
                    <Dato etiqueta="Minutos que se trasladan" valor={minutosATexto(previa.minutosTrasladados)} />
                    {previa.minutosDescartados > 0 && (
                      <Dato
                        etiqueta="Minutos que se pierden"
                        valor={minutosATexto(previa.minutosDescartados)}
                        resaltado
                      />
                    )}
                  </>
                )}
                <Dato etiqueta="Saldo resultante" valor={minutosATexto(previa.saldoResultante)} fuerte />
                <Dato etiqueta="Vencimiento" valor={fechaLarga(previa.venceEstimado)} />
                <Dato
                  etiqueta="Código"
                  valor={previa.codigoConservado ? "Conserva el actual" : "Se genera uno nuevo"}
                />
                <Dato
                  etiqueta={modalidad === "venta" ? "Importe" : "Cobro"}
                  valor={previa.importe === null ? "Sin cobro" : pesos(previa.importe)}
                  fuerte
                />
                {modalidad === "venta" && (
                  <Dato etiqueta="Medio de pago" valor={MEDIOS.find((m) => m.valor === medioPago)?.label ?? medioPago} />
                )}
                {modalidad === "cortesia" && (
                  <Dato etiqueta="Tipo" valor={CORTESIAS.find((c) => c.valor === cortesiaTipo)?.label ?? cortesiaTipo} />
                )}
                <Dato etiqueta="Motivo" valor={motivo.trim()} />
              </dl>

              <p className="text-[11px] leading-relaxed text-zinc-600">
                Los valores los calculó el servidor con los planes vigentes. Al confirmar se
                registran la mensualidad, el movimiento de saldo y la auditoría.
              </p>
            </div>
          )}

          {/* ════ PASO 3 · LISTO ════ */}
          {paso === "listo" && creada && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
                <Check className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">
                  {creada.tipo === "alta" ? "Mensualidad creada" : "Mensualidad renovada"}
                  {creada.idempotente && " (ya estaba registrada)"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Saldo {minutosATexto(creada.saldo_posterior)} · vence el {fechaLarga(creada.vence_el)}.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-zinc-900 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Código</p>
                <p className="mt-1 break-all font-mono text-base font-black tracking-wide text-white">
                  {creada.codigo}
                </p>
              </div>
              <Link
                href={`/admin/mensualidades/${creada.mensualidad_id}`}
                className="inline-block w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                Ver el detalle
              </Link>
            </div>
          )}

          {/* ── Error ── */}
          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        {/* ── Pie ── */}
        {paso !== "listo" && (
          <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={paso === "resumen" ? () => setPaso("form") : onCerrar}
              disabled={enviando}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:border-white/30 focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40"
            >
              {paso === "resumen" ? "Volver" : "Cancelar"}
            </button>
            <button
              type="button"
              onClick={paso === "resumen" ? confirmar : verResumen}
              // Deshabilitado durante el envío Y mientras la billetera esté
              // bloqueada: el servidor lo rechazaría igual, pero no tiene sentido
              // ofrecer un botón que no puede funcionar.
              disabled={enviando || (paso === "resumen" && bloqueada)}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando
                ? paso === "resumen" ? "Registrando…" : "Calculando…"
                : paso === "resumen" ? "Confirmar" : "Continuar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({
  etiqueta, valor, fuerte, resaltado,
}: { etiqueta: string; valor: string; fuerte?: boolean; resaltado?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-xs text-zinc-500">{etiqueta}</dt>
      <dd
        className={`min-w-0 break-words text-right text-xs ${
          resaltado ? "text-amber-300" : fuerte ? "font-bold text-white" : "text-zinc-200"
        }`}
      >
        {valor || "—"}
      </dd>
    </div>
  );
}
