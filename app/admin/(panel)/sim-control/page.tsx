"use client";

import { useCallback, useEffect, useState } from "react";

// Panel de SIM Control: terminales, credenciales, paquetes recibidos y conciliación.
//
// Todo el acceso a datos pasa por /api/admin/sim-control, que exige sesión de admin. Este archivo es
// "use client": NO puede importar supabaseAdmin ni nada que arrastre la service_role al bundle.

type Terminal = {
  id: string;
  terminalKey: string;
  displayName: string;
  simulatorLabel: string | null;
  active: boolean;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  credencial: { prefijo: string; creada: string; ultimoUso: string | null } | null;
};

type Paquete = {
  id: string;
  terminalKey: string;
  businessDate: string;
  sequence: number;
  status: string;
  hashCorto: string;
  sessionCount: number;
  reconcilableMinutes: number;
  receivedAt: string;
  verifiedAt: string | null;
};

type Conciliacion = {
  businessDate: string;
  cutoffUtc: string;
  status: string;
  centralMinutes: number;
  localMinutes: number;
  differenceMinutes: number;
  summary: string | null;
};

type Vista = "terminales" | "paquetes" | "conciliaciones";

const FECHA_CORTA = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function Estado({ valor }: { valor: string }) {
  const color =
    valor === "verified"
      ? "bg-green-500/20 text-green-400"
      : valor === "mismatch"
        ? "bg-red-500/20 text-red-300"
        : valor === "pending" || valor === "reconciliation_pending"
          ? "bg-amber-500/20 text-amber-300"
          : "bg-zinc-700/40 text-zinc-300";

  const texto =
    valor === "verified"
      ? "Verificado"
      : valor === "mismatch"
        ? "Diferencias"
        : valor === "reconciliation_pending" || valor === "pending"
          ? "Pendiente"
          : valor === "data_verified"
            ? "Datos guardados"
            : valor;

  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{texto}</span>;
}

export default function SimControlPage() {
  const [vista, setVista] = useState<Vista>("terminales");
  const [terminales, setTerminales] = useState<Terminal[]>([]);
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [conciliaciones, setConciliaciones] = useState<Conciliacion[]>([]);
  const [syncHabilitado, setSyncHabilitado] = useState(true);
  const [pepperConfigurado, setPepperConfigurado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // El token recién generado vive SOLO en este estado, hasta que se cierre el cartel.
  const [tokenNuevo, setTokenNuevo] = useState<{ terminal: string; token: string } | null>(null);

  const [nuevaKey, setNuevaKey] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");

  const cargar = useCallback(async (v: Vista) => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sim-control?vista=${v}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error");

      if (v === "terminales") {
        setTerminales(data.terminales ?? []);
        setSyncHabilitado(Boolean(data.syncHabilitado));
        setPepperConfigurado(Boolean(data.pepperConfigurado));
      } else if (v === "paquetes") {
        setPaquetes(data.paquetes ?? []);
      } else {
        setConciliaciones(data.conciliaciones ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(vista);
  }, [vista, cargar]);

  async function accion(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/sim-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error ?? "No se pudo completar la operación");
      return null;
    }
    await cargar("terminales");
    return data;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <h1 className="mb-2 text-3xl font-black text-white">SIM Control</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Terminales, credenciales y verificación de las jornadas que envían los simuladores.
      </p>

      {!syncHabilitado && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          La recepción está <b>apagada</b> en el servidor (<code>SIM_CONTROL_SYNC_ENABLED</code>). Las terminales
          reciben 503 y sus datos quedan guardados localmente.
        </div>
      )}

      {!pepperConfigurado && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          Falta <code>SIM_CONTROL_CREDENTIAL_PEPPER</code> en el servidor. Sin eso no se pueden validar ni generar
          credenciales de terminal.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}

      {/* El token se muestra UNA sola vez. Al cerrar este cartel no se puede recuperar: solo rotar. */}
      {tokenNuevo && (
        <div className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4">
          <p className="text-sm font-bold text-green-300">
            Credencial nueva para {tokenNuevo.terminal}
          </p>
          <code className="mt-2 block break-all rounded-lg bg-zinc-950 p-3 font-mono text-xs text-green-200">
            {tokenNuevo.token}
          </code>
          <p className="mt-2 text-xs text-amber-200">
            Guardala en SIM Control ahora: al cerrar este aviso no se puede volver a ver. Si se pierde, hay que rotarla.
          </p>
          <button
            onClick={() => setTokenNuevo(null)}
            className="mt-3 rounded-lg bg-zinc-800 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-700"
          >
            YA LA GUARDÉ
          </button>
        </div>
      )}

      <div className="mb-6 flex gap-2">
        {(["terminales", "paquetes", "conciliaciones"] as Vista[]).map((v) => (
          <button
            key={v}
            onClick={() => setVista(v)}
            className={`rounded-xl px-4 py-2 text-sm font-bold capitalize transition ${
              vista === v ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {cargando && <p className="text-sm text-zinc-500">Cargando…</p>}

      {!cargando && vista === "terminales" && (
        <>
          <div className="mb-6 rounded-xl bg-zinc-900 p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-wider text-zinc-400">Nueva terminal</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={nuevaKey}
                onChange={(e) => setNuevaKey(e.target.value)}
                placeholder="TerminalId (ej. sim-01)"
                className="min-w-48 flex-1 rounded-lg bg-zinc-950 px-3 py-2 text-sm text-white"
              />
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="Nombre visible"
                className="min-w-48 flex-1 rounded-lg bg-zinc-950 px-3 py-2 text-sm text-white"
              />
              <button
                onClick={async () => {
                  const r = await accion({ accion: "crear_terminal", terminalKey: nuevaKey, displayName: nuevoNombre });
                  if (r) {
                    setNuevaKey("");
                    setNuevoNombre("");
                  }
                }}
                disabled={!nuevaKey.trim() || !nuevoNombre.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                CREAR
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              El TerminalId tiene que ser exactamente el que tiene configurado esa PC.
            </p>
          </div>

          <div className="space-y-3">
            {terminales.map((t) => (
              <div key={t.id} className="rounded-xl bg-zinc-900 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-white">
                      {t.displayName}{" "}
                      <span className="ml-2 font-mono text-xs text-zinc-500">{t.terminalKey}</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Última conexión {FECHA_CORTA(t.lastSeenAt)} · Última sincronización {FECHA_CORTA(t.lastSyncAt)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Credencial:{" "}
                      {t.credencial ? (
                        <span className="font-mono">
                          {t.credencial.prefijo}… · creada {FECHA_CORTA(t.credencial.creada)}
                        </span>
                      ) : (
                        <span className="text-amber-300">sin credencial activa</span>
                      )}
                    </p>
                  </div>
                  <Estado valor={t.active ? "verified" : "mismatch"} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      const r = await accion({ accion: "rotar_credencial", terminalId: t.id });
                      if (r?.token) setTokenNuevo({ terminal: t.displayName, token: r.token });
                    }}
                    className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-bold text-white hover:bg-zinc-700"
                  >
                    {t.credencial ? "ROTAR CREDENCIAL" : "GENERAR CREDENCIAL"}
                  </button>
                  {t.credencial && (
                    <button
                      onClick={() => accion({ accion: "revocar_credencial", terminalId: t.id })}
                      className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-zinc-700"
                    >
                      REVOCAR
                    </button>
                  )}
                  <button
                    onClick={() =>
                      accion({
                        accion: t.active ? "desactivar_terminal" : "reactivar_terminal",
                        terminalId: t.id,
                      })
                    }
                    className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    {t.active ? "DESACTIVAR" : "REACTIVAR"}
                  </button>
                </div>
              </div>
            ))}
            {terminales.length === 0 && <p className="text-sm text-zinc-500">No hay terminales dadas de alta.</p>}
          </div>
        </>
      )}

      {!cargando && vista === "paquetes" && (
        <div className="overflow-x-auto rounded-xl bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Terminal</th>
                <th className="p-3">Sec.</th>
                <th className="p-3">Hash</th>
                <th className="p-3">Turnos</th>
                <th className="p-3">Minutos</th>
                <th className="p-3">Recibido</th>
                <th className="p-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {paquetes.map((p) => (
                <tr key={p.id} className="border-t border-zinc-800">
                  <td className="p-3 text-white">{p.businessDate}</td>
                  <td className="p-3 font-mono text-xs text-zinc-300">{p.terminalKey}</td>
                  <td className="p-3 text-zinc-400">{p.sequence}</td>
                  <td className="p-3 font-mono text-xs text-zinc-500">{p.hashCorto}…</td>
                  <td className="p-3 text-zinc-300">{p.sessionCount}</td>
                  <td className="p-3 text-zinc-300">{p.reconcilableMinutes}</td>
                  <td className="p-3 text-xs text-zinc-400">{FECHA_CORTA(p.receivedAt)}</td>
                  <td className="p-3">
                    <Estado valor={p.status} />
                  </td>
                </tr>
              ))}
              {paquetes.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-sm text-zinc-500">
                    Todavía no llegó ningún paquete.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!cargando && vista === "conciliaciones" && (
        <div className="space-y-3">
          {conciliaciones.map((c) => (
            <div key={`${c.businessDate}-${c.cutoffUtc}`} className="rounded-xl bg-zinc-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-white">{c.businessDate}</p>
                  <p className="text-xs text-zinc-500">Corte {FECHA_CORTA(c.cutoffUtc)}</p>
                </div>
                <Estado valor={c.status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-6 text-sm">
                <span className="text-zinc-400">
                  Central <b className="text-white">{c.centralMinutes}</b> sim-min
                </span>
                <span className="text-zinc-400">
                  SIM Control <b className="text-white">{c.localMinutes}</b> sim-min
                </span>
                <span className={c.differenceMinutes === 0 ? "text-green-400" : "text-amber-300"}>
                  Diferencia <b>{c.differenceMinutes}</b>
                </span>
              </div>
              {c.summary && <p className="mt-2 text-xs text-zinc-400">{c.summary}</p>}
            </div>
          ))}
          {conciliaciones.length === 0 && <p className="text-sm text-zinc-500">Todavía no hay conciliaciones.</p>}
        </div>
      )}
    </div>
  );
}
