"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CalendarCheck, CalendarPlus, CheckCircle2, Clock3, Download, Loader2, RefreshCcw, XCircle,
} from "lucide-react";
import type { ComprobantePublico, DetalleReserva, Vuelta } from "@/lib/reservaPostpay";
import { fechaLarga, UBICACION_EVENTO } from "@/lib/reservaPostpayCalendario";
import { trackAgregarCalendario, trackDescargaIcs, trackReservaPagoConfirmadoVista } from "@/lib/analytics";

// Comprobante post-pago de una Reserva (EXPERIMENTAL). Todo lo que se muestra
// lo devuelve el servidor desde la base: el navegador no decide si está pagada.
// Si el webhook todavía no confirmó, se vuelve a consultar de forma acotada.

const API = "/api/reservas/comprobante";
/** Verificación corta y controlada: una consulta cada 3 s, hasta 10 (~30 s). */
export const INTERVALO_MS = 3000;
export const MAX_INTENTOS = 10;

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

const BOTON_ROJO = "inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-4 font-black text-white transition hover:bg-red-500";
const BOTON_SECUNDARIO = "inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 font-black text-white transition hover:bg-white/10";

export default function ConfirmacionReserva({
  token, vuelta, inicial,
}: {
  token: string;
  vuelta: Vuelta | null;
  inicial: ComprobantePublico;
}) {
  const [comprobante, setComprobante] = useState<ComprobantePublico>(inicial);
  const [intentos, setIntentos] = useState(0);
  const [consultando, setConsultando] = useState(false);
  const medido = useRef(false);

  const url = `${API}?t=${encodeURIComponent(token)}${vuelta ? `&vuelta=${vuelta}` : ""}`;
  const estado = comprobante.estado;

  // "Estamos confirmando tu pago…": consultas acotadas a NUESTRO backend.
  useEffect(() => {
    if (estado !== "procesando" || intentos >= MAX_INTENTOS) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) setComprobante((await r.json()) as ComprobantePublico);
      } catch {
        /* se reintenta en la próxima vuelta */
      }
      setIntentos((n) => n + 1);
    }, INTERVALO_MS);
    return () => clearTimeout(timer);
  }, [estado, intentos, url]);

  // Medición: una sola vez, recién con el pago confirmado por la base.
  useEffect(() => {
    if (comprobante.estado === "confirmada" && comprobante.analitica && !medido.current) {
      medido.current = true;
      trackReservaPagoConfirmadoVista(comprobante.analitica.transaccion);
    }
  }, [comprobante]);

  async function consultarDeNuevo() {
    setConsultando(true);
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) setComprobante((await r.json()) as ComprobantePublico);
    } catch {
      /* queda el estado anterior */
    } finally {
      setConsultando(false);
      setIntentos(0);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white">
      <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
        {estado === "confirmada" && comprobante.reserva ? (
          <Confirmada reserva={comprobante.reserva} calendario={comprobante.calendario} />
        ) : estado === "procesando" ? (
          <Encabezado
            icono={intentos >= MAX_INTENTOS ? <Clock3 className="h-14 w-14" /> : <Loader2 className="h-14 w-14 animate-spin" />}
            tono="amarillo"
            titulo={intentos >= MAX_INTENTOS ? "Tu pago está siendo procesado" : "Estamos confirmando tu pago…"}
            texto={intentos >= MAX_INTENTOS
              ? "Todavía no recibimos la confirmación de Mercado Pago. Podés volver a consultar esta página en unos instantes."
              : "Esto suele tardar unos segundos. No hace falta que pagues de nuevo."}
          >
            {intentos >= MAX_INTENTOS && (
              <Acciones>
                <button type="button" onClick={consultarDeNuevo} disabled={consultando} className={BOTON_ROJO}>
                  <RefreshCcw className={`h-4 w-4 ${consultando ? "animate-spin" : ""}`} />
                  Volver a consultar
                </button>
                <VolverASim />
              </Acciones>
            )}
          </Encabezado>
        ) : estado === "pendiente" ? (
          <Encabezado
            icono={<Clock3 className="h-14 w-14" />}
            tono="amarillo"
            titulo="Tu pago está pendiente"
            texto="Mercado Pago todavía no acreditó el pago, así que la reserva aún no está confirmada. Puede pasar con algunos medios de pago; cuando se acredite, la reserva se confirma sola."
          >
            <Acciones>
              <button type="button" onClick={consultarDeNuevo} disabled={consultando} className={BOTON_ROJO}>
                <RefreshCcw className={`h-4 w-4 ${consultando ? "animate-spin" : ""}`} />
                Volver a consultar
              </button>
              <Link href="/reservas" className={BOTON_SECUNDARIO}>Volver a Reservas</Link>
            </Acciones>
          </Encabezado>
        ) : estado === "rechazada" ? (
          <Encabezado
            icono={<XCircle className="h-14 w-14" />}
            tono="rojo"
            titulo="No pudimos completar el pago"
            texto="El pago fue rechazado o se canceló antes de terminar, así que la reserva no quedó confirmada. Podés intentarlo de nuevo cuando quieras."
          >
            <Acciones>
              <Link href="/reservas" className={BOTON_ROJO}>
                <RefreshCcw className="h-4 w-4" />
                Volver a intentar
              </Link>
              <Link href="/reservas" className={BOTON_SECUNDARIO}>Volver a Reservas</Link>
            </Acciones>
          </Encabezado>
        ) : estado === "cancelada" ? (
          <Encabezado
            icono={<XCircle className="h-14 w-14" />}
            tono="rojo"
            titulo="Esta reserva fue cancelada"
            texto="La reserva ya no está vigente. Si querés venir, podés hacer una nueva reserva."
          >
            <Acciones>
              <Link href="/reservas" className={BOTON_ROJO}>Hacer una reserva</Link>
              <VolverASim />
            </Acciones>
          </Encabezado>
        ) : (
          <Encabezado
            icono={<AlertTriangle className="h-14 w-14" />}
            tono="amarillo"
            titulo="Recibimos tu pago"
            texto="Tuvimos un problema al asignar tu horario y lo estamos revisando. Nuestro equipo se va a comunicar con vos para confirmarlo."
          >
            <Acciones>
              <VolverASim />
            </Acciones>
          </Encabezado>
        )}
      </section>
    </main>
  );
}

function Confirmada({
  reserva, calendario,
}: {
  reserva: DetalleReserva;
  calendario: ComprobantePublico["calendario"];
}) {
  const personas = Math.max(1, reserva.simuladores.length);
  return (
    <>
      <div className="mb-6 rounded-full border border-green-500/30 bg-green-500/10 p-5 text-green-400">
        <CheckCircle2 className="h-14 w-14" />
      </div>
      <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">Reserva SIM</p>
      <h1 className="text-4xl font-black md:text-6xl">¡Todo listo!</h1>
      <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">Tu reserva en SIM está confirmada.</p>

      <div className="mt-8 w-full rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 text-left">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Reserva</p>
            <p className="mt-1 text-xl font-black tracking-wide">#{reserva.codigo}</p>
          </div>
          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-green-400">
            {reserva.pagada ? "Pagado" : "Confirmada"}
          </span>
        </div>
        <dl>
          <Dato etiqueta="Fecha" valor={mayuscula(fechaLarga(reserva.fecha))} />
          <Dato etiqueta="Horario" valor={`${reserva.hora} a ${reserva.horaFin} hs`} />
          <Dato etiqueta="Duración" valor={`${reserva.duracionMin} minutos`} />
          <Dato etiqueta="Personas" valor={personas === 1 ? "1 persona" : `${personas} personas`} />
          {reserva.simuladores.length > 0 && (
            <Dato
              etiqueta="Simuladores"
              valor={`${reserva.simuladores.length} · ${lista(reserva.simuladores)}`}
            />
          )}
          <Dato etiqueta={reserva.pagada ? "Total abonado" : "Total"} valor={pesos(reserva.total)} />
          <Dato etiqueta="Estado" valor={<span className="text-green-400">{reserva.pagada ? "PAGADO" : "CONFIRMADA"}</span>} />
          <Dato etiqueta="Lugar" valor={UBICACION_EVENTO} />
        </dl>
      </div>

      {calendario && (
        <div className="mt-8 w-full">
          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href={calendario.google}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackAgregarCalendario()}
              className={BOTON_ROJO}
            >
              <CalendarPlus className="h-5 w-5" />
              Agregar a Google Calendar
            </a>
            <a href={calendario.ics} download onClick={() => trackDescargaIcs()} className={BOTON_SECUNDARIO}>
              <Download className="h-5 w-5" />
              Agregar a otro calendario
            </a>
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            &quot;Otro calendario&quot; descarga un archivo para Apple Calendar, Outlook y similares, con un aviso 24 horas antes.
          </p>
        </div>
      )}

      <div className="mt-8 w-full rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 text-left">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-red-950/70 p-3 text-red-400">
            <CalendarCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-black">Importante</h2>
            <p className="mt-2 text-zinc-400">
              Llegá unos minutos antes de tu turno para poder prepararte y aprovechar la experiencia completa.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <VolverASim />
      </div>
    </>
  );
}

function Encabezado({
  icono, tono, titulo, texto, children,
}: {
  icono: React.ReactNode;
  tono: "amarillo" | "rojo";
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  const color = tono === "amarillo"
    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
    : "border-red-500/30 bg-red-500/10 text-red-400";
  return (
    <>
      <div className={`mb-6 rounded-full border p-5 ${color}`}>{icono}</div>
      <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">Reserva SIM</p>
      <h1 className="text-4xl font-black md:text-6xl">{titulo}</h1>
      <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">{texto}</p>
      {children}
    </>
  );
}

function Acciones({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 flex flex-wrap justify-center gap-4">{children}</div>;
}

function VolverASim() {
  return (
    <Link href="/" className={BOTON_SECUNDARIO}>
      Volver a SIM
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-3 last:border-0">
      <dt className="text-sm text-zinc-400">{etiqueta}</dt>
      <dd className="text-right font-bold">{valor}</dd>
    </div>
  );
}
