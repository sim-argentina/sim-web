"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Clock, Loader2 } from "lucide-react";

// Pantalla de resultado de una reserva mixta (Bloque M5B).
//
// NO confía en los query params que agrega Mercado Pago al volver
// (collection_status y compañía): lo único que se usa de la URL es el token
// opaco, y el estado lo dice el servidor. Mientras siga pendiente reintenta sola
// unas pocas veces, porque el webhook puede tardar unos segundos.

type Estado = "pendiente" | "aprobado" | "rechazado" | "vencido" | "en_revision";

type Resultado = {
  estado: Estado;
  referencia: string | null;
  fecha: string | null;
  hora: string | null;
  duracion: number | null;
  simuladores: string[];
  minutos_requeridos: number;
  minutos_saldo: number;
  minutos_faltantes: number;
  bloques_30: number;
  bloques_15: number;
  precio_15: number;
  precio_30: number;
  importe: number;
  retencion_vence_at?: string;
  saldo_restante?: number;
};

const CAJA = "rounded-[26px] border border-white/10 bg-[#0b0b0d] p-6 md:p-8";

function pesos(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(n);
}

function minutosATexto(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

function fechaLarga(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const txt = new Intl.DateTimeFormat("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date(y, m - 1, d));
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export default function ResultadoReservaMixta() {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const [r, setR] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const intentos = useRef(0);

  const consultar = useCallback(async () => {
    if (!token) { setNoEncontrada(true); setCargando(false); return; }
    try {
      const res = await fetch(`/api/mensualidades/reserva-resultado?t=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (res.status === 404) { setNoEncontrada(true); return; }
      if (!res.ok) return;
      setR((await res.json()) as Resultado);
    } catch {
      // Silencio: se reintenta abajo mientras siga pendiente.
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => { void consultar(); }, [consultar]);

  // Reintento acotado mientras el pago siga pendiente: el webhook puede tardar.
  // Como mucho 5 vueltas cada 4 s; después el titular refresca si quiere.
  useEffect(() => {
    if (!r || r.estado !== "pendiente" || intentos.current >= 5) return;
    const t = setTimeout(() => { intentos.current++; void consultar(); }, 4000);
    return () => clearTimeout(t);
  }, [r, consultar]);

  if (cargando) {
    return (
      <div className={`${CAJA} flex items-center gap-3 text-sm text-zinc-400`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Consultando tu reserva…
      </div>
    );
  }

  if (noEncontrada || !r) {
    return (
      <div className={CAJA}>
        <h1 className="text-xl font-black text-white">No encontramos esa reserva</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          El enlace puede haber vencido o no ser correcto. Entrá a tu mensualidad para
          ver el estado de tus turnos.
        </p>
        <Link
          href="/mensualidades/mi-plan"
          className="mt-6 inline-flex rounded-2xl bg-red-600 px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
        >
          Ir a mi mensualidad
        </Link>
      </div>
    );
  }

  const detalle = (
    <dl className="mt-5 space-y-2 text-sm text-zinc-300">
      {r.fecha && (
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Fecha</dt>
          <dd className="text-right">{fechaLarga(r.fecha)}</dd>
        </div>
      )}
      {r.hora && (
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Horario</dt>
          <dd className="tabular-nums">{r.hora}</dd>
        </div>
      )}
      {r.duracion && (
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Duración</dt>
          <dd>{r.duracion} min</dd>
        </div>
      )}
      {r.simuladores.length > 0 && (
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Escuderías</dt>
          <dd className="text-right">{r.simuladores.join(" · ")}</dd>
        </div>
      )}
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Usaste de tu mensualidad</dt>
        <dd className="tabular-nums text-green-400">{minutosATexto(r.minutos_saldo)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        {/* Mientras no esté aprobado, ese dinero todavía NO se cobró: decir
            "abonada" ahí sería afirmar algo que no pasó. */}
        <dt className="text-zinc-500">
          {r.estado === "aprobado" ? "Diferencia abonada" : "Diferencia a pagar"}
        </dt>
        <dd className="tabular-nums">{pesos(r.importe)}</dd>
      </div>
      {typeof r.saldo_restante === "number" && (
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Saldo restante</dt>
          <dd className="tabular-nums">{minutosATexto(r.saldo_restante)}</dd>
        </div>
      )}
    </dl>
  );

  const volver = (
    <Link
      href="/mensualidades/mi-plan"
      className="mt-6 inline-flex rounded-2xl bg-red-600 px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500"
    >
      Volver a mi mensualidad
    </Link>
  );

  if (r.estado === "aprobado") {
    return (
      <div className={CAJA}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-green-500/15 text-green-400">
            <Check className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-black text-white">Tu reserva está confirmada</h1>
        </div>
        {r.referencia && (
          <p className="mt-4 text-sm text-zinc-400">
            Referencia:{" "}
            <span className="font-black tracking-wider text-white">{r.referencia}</span>
          </p>
        )}
        {detalle}
        {volver}
      </div>
    );
  }

  if (r.estado === "pendiente") {
    return (
      <div className={CAJA}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-amber-500/15 text-amber-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </span>
          <h1 className="text-xl font-black text-white">Estamos confirmando tu pago</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Mercado Pago todavía no nos avisó el resultado. Tu turno está reservado mientras
          tanto. Esta pantalla se actualiza sola; también podés verlo en tu mensualidad.
        </p>
        {detalle}
        {volver}
      </div>
    );
  }

  if (r.estado === "rechazado") {
    return (
      <div className={CAJA}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-red-500/15 text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-black text-white">El pago no se completó</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Tu reserva todavía no está confirmada, pero el turno sigue guardado un rato más.
          Podés volver a intentar el pago desde tu mensualidad.
        </p>
        {detalle}
        {volver}
      </div>
    );
  }

  if (r.estado === "vencido") {
    return (
      <div className={CAJA}>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-zinc-500/15 text-zinc-400">
            <Clock className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-black text-white">Se venció el tiempo para pagar</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          El turno se liberó y los minutos volvieron a tu mensualidad. Podés elegir otro
          horario cuando quieras.
        </p>
        {volver}
      </div>
    );
  }

  // en_revision: hay plata cobrada que no se pudo aplicar. Nunca se esconde.
  return (
    <div className={CAJA}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-amber-500/15 text-amber-400">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-black text-white">Estamos revisando tu pago</h1>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        Registramos tu pago, pero el turno no quedó confirmado. Ya lo estamos revisando y
        nos vamos a comunicar para resolverlo o devolverte el importe. No hace falta que
        vuelvas a pagar.
      </p>
      {detalle}
      {volver}
    </div>
  );
}
