"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock3, XCircle, Copy, Check, RefreshCw, ArrowRight } from "lucide-react";

// Resultado de una compra de Mensualidad (Bloque M3).
//
// La única credencial es el token de la URL. Los query params que agrega Mercado
// Pago al volver (collection_status, payment_id…) se IGNORAN: el estado sale del
// servidor, que a su vez lo verifica contra Mercado Pago. El código se muestra
// solo cuando la base confirma que la compra fue aplicada.
//
// Esta ruta NO está detrás de la feature flag: si la venta se apaga, quien ya
// pagó tiene que poder seguir viendo su código.

type Resultado = {
  estado: "pendiente" | "aprobado" | "rechazado";
  plan: string;
  precio: number;
  minutos_plan: number;
  tipo?: "alta" | "renovacion";
  codigo?: string | null;
  saldo_minutos?: number | null;
  minutos_trasladados?: number | null;
  minutos_descartados?: number | null;
  vence_el?: string | null;
};

const MAX_INTENTOS = 12;
const INTERVALO_MS = 5000;

function fechaLarga(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(y, m - 1, d));
}

function ResultadoContenido() {
  const token = useSearchParams().get("t") ?? "";
  const [datos, setDatos] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noExiste, setNoExiste] = useState(false);
  const [intentos, setIntentos] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const [yendo, setYendo] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // "Ver mi mensualidad": si ya hay sesión abierta, entra directo; si no, manda
  // al formulario de identificación. El token del pago nunca crea sesión.
  async function irAMiMensualidad() {
    setYendo(true);
    try {
      const res = await fetch("/api/mensualidades/mi-plan", { cache: "no-store" });
      router.push(res.ok ? "/mensualidades/mi-plan" : "/mensualidades#mi-mensualidad");
    } catch {
      router.push("/mensualidades#mi-mensualidad");
    }
  }

  const consultar = useCallback(async () => {
    if (!token) { setNoExiste(true); setCargando(false); return; }
    setCargando(true);
    try {
      const res = await fetch(`/api/mensualidades/resultado?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) { setNoExiste(true); setDatos(null); return; }
      const d = await res.json().catch(() => null);
      if (res.ok && d) setDatos(d as Resultado);
    } catch {
      /* se reintenta en el próximo ciclo */
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => { void consultar(); }, [consultar]);

  // Reintento automático moderado mientras el pago no esté confirmado.
  useEffect(() => {
    if (!datos || datos.estado !== "pendiente" || intentos >= MAX_INTENTOS) return;
    timer.current = setTimeout(() => { setIntentos((n) => n + 1); void consultar(); }, INTERVALO_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [datos, intentos, consultar]);

  async function copiar(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* si el navegador lo bloquea, el código igual está a la vista */
    }
  }

  const caja = "rounded-[26px] border border-white/10 bg-[#0b0b0d] p-6 md:p-8";

  if (noExiste) {
    return (
      <div className={caja}>
        <h1 className="text-2xl font-black uppercase md:text-3xl">No encontramos esa compra</h1>
        <p className="mt-3 text-zinc-400">
          El enlace puede haber expirado o no ser válido. Si pagaste y no ves tu código,
          escribinos y lo resolvemos.
        </p>
        <Link href="/vivi-sim" className="mt-6 inline-block rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] transition hover:border-white/40">
          Volver
        </Link>
      </div>
    );
  }

  if (!datos) {
    return (
      <div className={caja}>
        <p className="text-zinc-400">Consultando el estado de tu pago...</p>
      </div>
    );
  }

  // ── Aprobado ──
  if (datos.estado === "aprobado") {
    const descartados = Number(datos.minutos_descartados ?? 0);
    const trasladados = Number(datos.minutos_trasladados ?? 0);
    return (
      <div className={caja}>
        <div className="mb-5 inline-flex rounded-full border border-green-500/30 bg-green-500/10 p-4 text-green-400">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h1 className="text-3xl font-black uppercase leading-tight md:text-4xl">
          Tu mensualidad SIM ya está activa
        </h1>

        <div className="mt-7 rounded-2xl border border-red-600/40 bg-red-950/20 p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-400">Tu código</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="font-mono text-3xl font-black tracking-wider md:text-4xl">{datos.codigo}</p>
            {datos.codigo && (
              <button
                type="button"
                onClick={() => copiar(datos.codigo!)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] transition hover:border-white/50"
              >
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiado ? "Copiado" : "Copiar"}
              </button>
            )}
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            Guardalo: junto con tu teléfono es lo que vas a usar para reservar.
          </p>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Plan comprado</dt>
            <dd className="mt-1 text-lg font-black">{datos.plan}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Minutos incorporados</dt>
            <dd className="mt-1 text-lg font-black">{datos.minutos_plan} min</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Saldo disponible</dt>
            <dd className="mt-1 text-lg font-black text-red-400">{datos.saldo_minutos} min</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs font-black uppercase tracking-[0.14em] text-zinc-500">Vence</dt>
            <dd className="mt-1 text-lg font-black">
              {datos.vence_el ? fechaLarga(datos.vence_el) : "-"}
            </dd>
          </div>
        </dl>

        {datos.tipo === "renovacion" && (
          <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-300">
            Renovaste tu mensualidad, así que conservás el mismo código
            {trasladados > 0 ? ` y se trasladaron ${trasladados} minutos del saldo anterior` : ""}.
            {descartados > 0 && (
              <>
                {" "}Del saldo anterior quedaron afuera {descartados} minutos: al renovar se
                trasladan hasta 60.
              </>
            )}
          </p>
        )}

        {/* El token del pago NO autentica: si no hay sesión, se pide el código y
            el teléfono en el formulario de identificación. */}
        <button
          type="button"
          onClick={irAMiMensualidad}
          disabled={yendo}
          className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-red-500 disabled:opacity-40"
        >
          <ArrowRight className="h-4 w-4" />
          {yendo ? "Abriendo..." : "Ver mi mensualidad"}
        </button>

        <p className="mt-6 text-sm text-zinc-500">
          La mensualidad se puede usar hasta las 23:59 del día de vencimiento.
        </p>
      </div>
    );
  }

  // ── Rechazado ──
  if (datos.estado === "rechazado") {
    return (
      <div className={caja}>
        <div className="mb-5 inline-flex rounded-full border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          <XCircle className="h-10 w-10" />
        </div>
        <h1 className="text-3xl font-black uppercase leading-tight md:text-4xl">
          El pago no se completó
        </h1>
        <p className="mt-4 text-zinc-400">
          Tu mensualidad no fue activada y no se te cobró. Podés volver a elegir un plan
          e intentarlo de nuevo.
        </p>
        <Link href="/mensualidades" className="mt-6 inline-block rounded-2xl bg-red-600 px-6 py-3.5 text-sm font-black uppercase tracking-[0.18em] transition hover:bg-red-500">
          Elegir un plan
        </Link>
      </div>
    );
  }

  // ── Pendiente ──
  return (
    <div className={caja}>
      <div className="mb-5 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 p-4 text-amber-400">
        <Clock3 className="h-10 w-10" />
      </div>
      <h1 className="text-3xl font-black uppercase leading-tight md:text-4xl">
        Estamos confirmando tu pago
      </h1>
      <p className="mt-4 text-zinc-400">
        Puede tardar unos minutos. Esta página se actualiza sola; podés dejarla abierta.
        Cuando se acredite vas a ver acá tu código.
      </p>
      <button
        type="button"
        onClick={() => { setIntentos(0); void consultar(); }}
        disabled={cargando}
        className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] transition hover:border-white/40 disabled:opacity-40"
      >
        <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
        {cargando ? "Consultando..." : "Volver a consultar"}
      </button>
      {intentos >= MAX_INTENTOS && (
        <p className="mt-5 text-sm text-zinc-500">
          Si sigue sin confirmarse, escribinos con tu nombre y te lo resolvemos.
        </p>
      )}
    </div>
  );
}

export default function ResultadoPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-16 text-white md:py-24">
      <section className="mx-auto max-w-3xl">
        <p className="mb-4 text-xs font-black uppercase tracking-[0.45em] text-red-500">
          Mensualidad SIM
        </p>
        <Suspense fallback={<p className="text-zinc-400">Cargando...</p>}>
          <ResultadoContenido />
        </Suspense>
      </section>
    </main>
  );
}
