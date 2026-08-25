"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getSlotsForDate, construirOcupacion, getOccupiedSlots, getNextSlot } from "@/lib/reservasSlots";

// Flujo público de reserva con CÓDIGO EMPRESARIAL. Reutiliza la MISMA disponibilidad
// que Reservas (GET /api/reservas?fecha) y crea la reserva con el endpoint atómico
// (/api/empresas/canje). El beneficiario NO paga y NO pasa por Mercado Pago. Separado
// del cupón de descuento para no generar ambigüedad.

const SIMULADORES = ["Ferrari", "McLaren", "Red Bull", "Alpine"] as const;

type ReservaApi = { hora: string; simuladores: unknown; duracion_minutos?: number | null; estado?: string };

export default function ReservaEmpresaPage() {
  const [paso, setPaso] = useState<"codigo" | "turno" | "datos" | "ok">("codigo");
  const [codigo, setCodigo] = useState("");
  const [duracion, setDuracion] = useState(15);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [fecha, setFecha] = useState("");
  const [reservas, setReservas] = useState<ReservaApi[]>([]);
  const [hora, setHora] = useState("");
  const [sim, setSim] = useState("");

  const [form, setForm] = useState({ nombre: "", apellido: "", telefono: "", email: "", acepto: false });
  const [idemKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? String(Date.now())));
  const [confirmacion, setConfirmacion] = useState<{ fecha: string; hora: string; sim: string; duracion: number } | null>(null);

  const inp = "w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500";

  // Disponibilidad derivada de las reservas reales (misma fuente que Reservas).
  const ocupacion = useMemo(
    () => construirOcupacion(fecha, reservas.filter((r) => r.estado !== "cancelada").map((r) => ({ hora: r.hora, duracion_minutos: r.duracion_minutos, simuladores: r.simuladores }))),
    [fecha, reservas],
  );
  const disponible = (h: string, s: string) => {
    if (duracion >= 30 && !getNextSlot(fecha, h)) return false;
    return getOccupiedSlots(fecha, h, duracion).every((slot) => !ocupacion[slot]?.has(s));
  };
  const horasDisponibles = useMemo(
    () => getSlotsForDate(fecha).filter((h) => SIMULADORES.some((s) => disponible(h, s))),
    [fecha, ocupacion, duracion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function validar() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/empresas/validar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Código inválido o no disponible."); return; }
      setDuracion(Number(d.beneficio?.duracion_minutos) || 15);
      setPaso("turno");
    } catch { setMsg("Error de conexión."); }
    finally { setBusy(false); }
  }

  async function cargarFecha(f: string) {
    setFecha(f); setHora(""); setSim(""); setReservas([]);
    if (!f) return;
    const res = await fetch(`/api/reservas?fecha=${f}`, { cache: "no-store" });
    const d = await res.json();
    setReservas(Array.isArray(d) ? d : []);
  }

  async function confirmar() {
    if (!form.nombre.trim() || !form.apellido.trim() || !form.telefono.trim() || !form.acepto) {
      setMsg("Completá tus datos y aceptá las condiciones."); return;
    }
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/empresas/canje", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, nombre: form.nombre, apellido: form.apellido, telefono: form.telefono, email: form.email, fecha, hora, simuladores: [sim], idempotency_key: idemKey }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "No se pudo confirmar la reserva."); return; }
      setConfirmacion({ fecha, hora, sim, duracion });
      setPaso("ok");
    } catch { setMsg("Error de conexión."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-black px-5 py-24 text-white md:py-32">
      <div className="mx-auto max-w-lg">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.4em] text-red-500">SIM Argentina</p>
        <h1 className="mb-6 text-3xl font-black">Reservá con tu código empresarial</h1>

        {msg && <p className="mb-4 rounded-xl border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-300">{msg}</p>}

        {paso === "codigo" && (
          <div className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <label className="block text-sm text-zinc-300">¿Tenés un código empresarial?
              <input className={`${inp} mt-1 font-mono uppercase`} placeholder="EMP-XXXX-XXXXXX" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} />
            </label>
            <button onClick={validar} disabled={busy || !codigo.trim()} className="w-full rounded-2xl bg-red-600 py-3.5 font-black text-white hover:bg-red-500 disabled:opacity-50">
              {busy ? "Validando…" : "Continuar"}
            </button>
            <p className="text-center text-xs text-zinc-600">¿Reserva normal? <Link href="/reservas" className="text-red-400 underline">Reservá acá</Link></p>
          </div>
        )}

        {paso === "turno" && (
          <div className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
              Código válido — experiencia de <b>{duracion} minutos</b>.
            </div>
            <label className="block text-sm text-zinc-300">Fecha
              <input type="date" min={new Date().toISOString().slice(0, 10)} className={`${inp} mt-1`} value={fecha} onChange={(e) => cargarFecha(e.target.value)} />
            </label>
            {fecha && (
              <>
                <label className="block text-sm text-zinc-300">Horario
                  <select className={`${inp} mt-1`} value={hora} onChange={(e) => { setHora(e.target.value); setSim(""); }}>
                    <option value="">Elegí un horario</option>
                    {horasDisponibles.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
                {horasDisponibles.length === 0 && <p className="text-sm text-zinc-500">No hay turnos disponibles ese día.</p>}
                {hora && (
                  <label className="block text-sm text-zinc-300">Simulador
                    <select className={`${inp} mt-1`} value={sim} onChange={(e) => setSim(e.target.value)}>
                      <option value="">Elegí un simulador</option>
                      {SIMULADORES.filter((s) => disponible(hora, s)).map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
              </>
            )}
            <button onClick={() => setPaso("datos")} disabled={!fecha || !hora || !sim} className="w-full rounded-2xl bg-red-600 py-3.5 font-black text-white hover:bg-red-500 disabled:opacity-40">Continuar</button>
          </div>
        )}

        {paso === "datos" && (
          <div className="space-y-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <p className="text-sm text-zinc-400">{fecha} · {hora} · {sim} · {duracion} min</p>
            <div className="grid grid-cols-2 gap-3">
              <input className={inp} placeholder="Nombre *" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              <input className={inp} placeholder="Apellido *" value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} />
            </div>
            <input className={inp} placeholder="Teléfono *" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            <input className={inp} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label className="flex items-start gap-2 text-sm text-zinc-400">
              <input type="checkbox" checked={form.acepto} onChange={(e) => setForm({ ...form, acepto: e.target.checked })} className="mt-1 accent-red-500" />
              Acepto los <a href="/legales/terminos" target="_blank" rel="noopener noreferrer" className="text-red-400 underline">términos y condiciones</a>. Altura mínima 1,40 m · peso máximo 110 kg.
            </label>
            <button onClick={confirmar} disabled={busy} className="w-full rounded-2xl bg-red-600 py-3.5 font-black text-white hover:bg-red-500 disabled:opacity-50">{busy ? "Confirmando…" : "Confirmar reserva"}</button>
            <button onClick={() => setPaso("turno")} className="w-full text-xs text-zinc-500 hover:text-white">← Cambiar turno</button>
          </div>
        )}

        {paso === "ok" && confirmacion && (
          <div className="space-y-3 rounded-3xl border border-green-500/30 bg-green-500/5 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20 text-2xl">✓</div>
            <h2 className="text-xl font-black text-white">¡Reserva confirmada!</h2>
            <p className="text-sm text-zinc-300">{confirmacion.fecha} · {confirmacion.hora} · {confirmacion.sim} · {confirmacion.duracion} min</p>
            <p className="text-sm text-zinc-400">Experiencia cubierta por beneficio empresarial. Te esperamos en SIM Argentina.</p>
            <Link href="/" className="mt-2 inline-block text-sm text-red-400 underline">Volver al inicio</Link>
          </div>
        )}
      </div>
    </main>
  );
}
