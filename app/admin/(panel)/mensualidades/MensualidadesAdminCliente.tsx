"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";

// Listado administrativo de Mensualidades (Bloque M7).
//
// La pantalla NO filtra nada: busca, filtra, ordena y pagina el servidor. Acá
// solo se dibuja lo que vuelve. Por eso no existe ningún array con "todas las
// mensualidades": lo que hay en memoria es siempre una página.

type Fila = {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  saldo_minutos: number;
  vence_el: string;
  estado: string;
  plan_nombre: string | null;
  plan_comprado_at: string | null;
  proxima_fecha: string | null;
  proxima_hora: string | null;
  ultima_actividad: string | null;
};

type Listado = {
  filas: Fila[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
};

const FILTROS = [
  { valor: "todas", label: "Todas" },
  { valor: "vigente", label: "Activa" },
  { valor: "agotada", label: "Sin minutos" },
  { valor: "vencida", label: "Vencida" },
  { valor: "bloqueada", label: "Bloqueada" },
] as const;

const COLOR_ESTADO: Record<string, string> = {
  vigente: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  agotada: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  vencida: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  bloqueada: "bg-red-500/10 text-red-300 border-red-500/30",
};

const ETIQUETA_ESTADO: Record<string, string> = {
  vigente: "Activa",
  agotada: "Sin minutos",
  vencida: "Vencida",
  bloqueada: "Bloqueada",
};

export function minutosATexto(min: number): string {
  if (!min) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const solo = iso.slice(0, 10);
  const [y, m, d] = solo.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d));
}

/** Teléfono argentino de 10 dígitos, legible: 351 512-3456. */
export function telefonoLegible(t: string): string {
  if (!/^\d{10}$/.test(t)) return t;
  return `${t.slice(0, 3)} ${t.slice(3, 6)}-${t.slice(6)}`;
}

export default function MensualidadesAdminCliente({ rol }: { rol: string }) {
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<string>("todas");
  const [pagina, setPagina] = useState(1);

  const [datos, setDatos] = useState<Listado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Se descarta la respuesta de una búsqueda vieja que llegó tarde: si no, al
  // escribir rápido la lista puede terminar mostrando el resultado anterior.
  const pedidoRef = useRef(0);

  const cargar = useCallback(async (q: string, estado: string, p: number) => {
    const mio = ++pedidoRef.current;
    setCargando(true);
    setError(null);
    try {
      const url = `/api/admin/mensualidades?q=${encodeURIComponent(q)}&estado=${estado}&pagina=${p}`;
      const res = await fetch(url, { cache: "no-store" });
      if (mio !== pedidoRef.current) return;
      if (!res.ok) {
        setError(res.status === 403 ? "No tenés acceso a esta sección." : "No pudimos cargar el listado.");
        setDatos(null);
        return;
      }
      const json = (await res.json()) as Listado;
      if (mio !== pedidoRef.current) return;
      setDatos(json);
    } catch {
      if (mio === pedidoRef.current) {
        setError("No pudimos cargar el listado. Revisá la conexión.");
        setDatos(null);
      }
    } finally {
      if (mio === pedidoRef.current) setCargando(false);
    }
  }, []);

  // La búsqueda espera a que se deje de escribir: una consulta por tecla sería
  // una consulta a la base por tecla.
  useEffect(() => {
    const t = setTimeout(() => void cargar(texto, filtro, pagina), texto ? 350 : 0);
    return () => clearTimeout(t);
  }, [texto, filtro, pagina, cargar]);

  function cambiarFiltro(v: string) {
    setFiltro(v);
    setPagina(1);
  }
  function cambiarTexto(v: string) {
    setTexto(v);
    setPagina(1);
  }

  const filas = datos?.filas ?? [];
  const hayResultados = filas.length > 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-black text-white sm:text-3xl">Mensualidades</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {rol === "admin"
            ? "Consulta y gestión de las mensualidades de los clientes."
            : "Consulta de mensualidades. Las modificaciones las hace un administrador."}
        </p>
      </header>

      {/* ── Búsqueda y filtros ── */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            type="search"
            value={texto}
            onChange={(e) => cambiarTexto(e.target.value)}
            placeholder="Código, teléfono, nombre, apellido, correo o referencia de reserva"
            className="w-full rounded-2xl border border-white/10 bg-zinc-900 py-3 pl-10 pr-4 text-sm text-white placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => cambiarFiltro(f.valor)}
              className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                filtro === f.valor
                  ? "border-red-500 bg-red-600 text-white"
                  : "border-white/10 bg-zinc-900 text-zinc-400 hover:border-white/30"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Estados de la carga ── */}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">{error}</p>
            <button
              type="button"
              onClick={() => void cargar(texto, filtro, pagina)}
              className="mt-2 rounded-lg border border-red-500/40 px-3 py-1 text-xs font-bold hover:bg-red-500/10"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {cargando && !error && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-zinc-900/50 py-16 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando…
        </div>
      )}

      {!cargando && !error && !hayResultados && (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 py-16 text-center">
          <p className="text-sm font-bold text-zinc-300">
            {texto || filtro !== "todas"
              ? "No hay mensualidades que coincidan."
              : "Todavía no hay mensualidades."}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {texto || filtro !== "todas"
              ? "Probá con otro dato o sacá los filtros."
              : "Van a aparecer acá cuando alguien compre la primera."}
          </p>
        </div>
      )}

      {/* ── Resultados ── */}
      {!cargando && !error && hayResultados && (
        <>
          {/* Escritorio */}
          <div className="hidden overflow-x-auto rounded-2xl border border-white/10 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-bold">Titular</th>
                  <th className="px-4 py-3 font-bold">Teléfono</th>
                  <th className="px-4 py-3 font-bold">Último plan</th>
                  <th className="px-4 py-3 text-right font-bold">Saldo</th>
                  <th className="px-4 py-3 font-bold">Vence</th>
                  <th className="px-4 py-3 font-bold">Estado</th>
                  <th className="px-4 py-3 font-bold">Próxima reserva</th>
                  <th className="px-4 py-3 font-bold">Última actividad</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filas.map((f) => (
                  <tr key={f.id} className="transition hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <p className="font-bold text-white">{f.nombre} {f.apellido}</p>
                      <p className="text-xs text-zinc-600">{f.email}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{telefonoLegible(f.telefono)}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {f.plan_nombre ?? "—"}
                      {f.plan_comprado_at && (
                        <span className="block text-xs text-zinc-600">{fechaCorta(f.plan_comprado_at)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-white">
                      {minutosATexto(f.saldo_minutos)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-400">{fechaCorta(f.vence_el)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-bold ${COLOR_ESTADO[f.estado] ?? ""}`}>
                        {ETIQUETA_ESTADO[f.estado] ?? f.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-400">
                      {f.proxima_fecha ? `${fechaCorta(f.proxima_fecha)} · ${f.proxima_hora}` : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs text-zinc-600">
                      {fechaCorta(f.ultima_actividad)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/mensualidades/${f.id}`}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-white/30 hover:text-white"
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil y tablet */}
          <div className="space-y-3 lg:hidden">
            {filas.map((f) => (
              <Link
                key={f.id}
                href={`/admin/mensualidades/${f.id}`}
                className="block rounded-2xl border border-white/10 bg-zinc-900/50 p-4 transition hover:border-white/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white">{f.nombre} {f.apellido}</p>
                    <p className="truncate text-xs text-zinc-500">{telefonoLegible(f.telefono)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${COLOR_ESTADO[f.estado] ?? ""}`}>
                    {ETIQUETA_ESTADO[f.estado] ?? f.estado}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-zinc-600">Saldo</dt>
                    <dd className="font-bold text-white">{minutosATexto(f.saldo_minutos)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600">Vence</dt>
                    <dd className="text-zinc-300">{fechaCorta(f.vence_el)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600">Último plan</dt>
                    <dd className="truncate text-zinc-300">{f.plan_nombre ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600">Próxima reserva</dt>
                    <dd className="text-zinc-300">
                      {f.proxima_fecha ? `${fechaCorta(f.proxima_fecha)} · ${f.proxima_hora}` : "—"}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>

          {/* ── Paginación ── */}
          {datos && datos.paginas > 1 && (
            <nav className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={datos.pagina <= 1}
                onClick={() => setPagina((p) => Math.max(p - 1, 1))}
                className="flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <p className="text-xs text-zinc-500">
                Página <span className="font-bold text-zinc-300">{datos.pagina}</span> de{" "}
                <span className="font-bold text-zinc-300">{datos.paginas}</span>
                <span className="hidden sm:inline"> · {datos.total} en total</span>
              </p>
              <button
                type="button"
                disabled={datos.pagina >= datos.paginas}
                onClick={() => setPagina((p) => p + 1)}
                className="flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Siguiente <ChevronRight className="h-4 w-4" />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
