"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Campeonato = {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  precio_inscripcion: number;
  cupos_maximos: number;
  inscriptos: number;
  inscripcion_habilitada: boolean;
  imagen_url: string | null;
  categorias: string[];
};

type Constructor = {
  escuderia: string;
  puntos: number;
  pilotos: string[];
  posicion: number;
};

type Resultado = {
  id: string;
  fecha: string;
  nombre_completo: string;
  categoria: string;
  campeonato_id: string | null;
  campeonato_nombre: string | null;
  circuito: string | null;
  tiempo: string | null;
  tiempo_segundos: number;
  escuderia_favorita: string | null;
  puntos: number;
  puntos_ganados: number;
  semana: number;
  simulador: string | null;
};

type Sorteo = {
  id: string;
  titulo: string;
  descripcion: string | null;
  premio: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  condiciones: string | null;
  imagen_url: string | null;
};

type PublicData = {
  campeonatos: Campeonato[];
  sorteos: Sorteo[];
  rankings: Record<string, unknown[]>;
  puntos: Record<string, unknown[]>;
  constructores: Constructor[];
  resultados_por_fecha: Resultado[];
};

// ─── Clasificación types ──────────────────────────────────────────────────────

type HistorialItem = {
  fecha: string;
  circuito: string | null;
  tiempo: string | null;
  posicion: string;
  puntos: number;
  semana: number;
};

type PilotoStat = {
  posicion: number;
  piloto: string;
  categoria: string;
  campeonato: string | null;
  escuderia: string;
  carreras: number;
  victorias: number;
  podios: number;
  mejor_tiempo: string | null;
  mejor_tiempo_seg: number;
  puntos: number;
  historial: HistorialItem[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ESCUDERIAS = [
  "Red Bull", "Mercedes", "Ferrari", "McLaren", "Aston Martin",
  "Alpine", "Williams", "Racing Bulls", "Kick Sauber", "Haas",
];

const F1_POS_MAP: Record<number, string> = {
  25: "P1", 18: "P2", 15: "P3", 12: "P4", 10: "P5",
  8: "P6", 6: "P7", 4: "P8", 2: "P9", 1: "P10",
};
const ptsToPos = (pts: number) => F1_POS_MAP[pts] ?? "—";

const CAT_BADGE: Record<string, { label: string; cls: string }> = {
  oro:    { label: "ORO",    cls: "bg-yellow-400/15 text-yellow-400 border-yellow-400/30" },
  plata:  { label: "PLATA",  cls: "bg-zinc-400/15   text-zinc-300   border-zinc-400/30"   },
  bronce: { label: "BRONCE", cls: "bg-orange-700/15 text-orange-500 border-orange-700/30" },
};

type SecTab = "campeonatos" | "clasificacion" | "constructores" | "sorteos";
const SEC_TABS: { id: SecTab; label: string }[] = [
  { id: "campeonatos",  label: "Campeonatos"  },
  { id: "clasificacion", label: "Clasificación" },
  { id: "constructores", label: "Constructores" },
  { id: "sorteos",      label: "Sorteos"      },
];

// ─── Micro components ─────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    activo:    "bg-green-500/20 text-green-400 border border-green-500/30",
    proximo:   "bg-blue-500/20  text-blue-400  border border-blue-500/30",
    finalizado:"bg-zinc-700/50  text-zinc-400  border border-zinc-700",
  };
  const labels: Record<string, string> = { activo: "ACTIVO", proximo: "PRÓXIMO", finalizado: "FINALIZADO" };
  return (
    <span className={`rounded-full px-3 py-0.5 text-xs font-black tracking-widest ${map[estado] ?? "bg-zinc-700/50 text-zinc-400"}`}>
      {labels[estado] ?? estado.toUpperCase()}
    </span>
  );
}

function StatCard({ color, label, children }: { color: string; label: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${color}`} />
      <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 mb-2">{label}</p>
      {children}
    </div>
  );
}

// ─── Confirmation screen ──────────────────────────────────────────────────────

type ConfirmacionData = {
  nombre: string;
  apellido: string;
  telefono: string;
  dni: string;
  escuderia_favorita: string;
  campeonato: string;
  metodo: "mercadopago" | "stand";
  init_point?: string;
};

function ConfirmacionScreen({ data, onClose }: { data: ConfirmacionData; onClose: () => void }) {
  const esMp = data.metodo === "mercadopago";
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20 border border-green-500/30">
          <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-black text-white mb-2">¡Inscripción registrada!</h3>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
        <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">Datos registrados</p>
        {([
          ["Nombre", data.nombre],
          ["Apellido", data.apellido],
          ["Teléfono", data.telefono],
          ["DNI", data.dni],
          ["Escudería", data.escuderia_favorita],
          ["Campeonato", data.campeonato],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-zinc-500">{label}</span>
            <span className="font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300 leading-relaxed space-y-3">
        <p>Tu inscripción fue registrada correctamente.</p>
        {esMp ? (
          <p>Ahora debés acercarte al stand de SIM Argentina para realizar tu tanda clasificatoria y registrar tu mejor tiempo. Con ese tiempo serás ubicado en una categoría competitiva.</p>
        ) : (
          <p>Recordá que deberás abonar la inscripción al llegar al stand. Luego podrás realizar tu tanda clasificatoria y registrar tu mejor tiempo para ser ubicado en una categoría competitiva.</p>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm space-y-2">
        <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">Dónde encontrarnos</p>
        <p className="font-bold text-white">SIM Argentina</p>
        <p className="text-zinc-400">Nuevo Centro Shopping</p>
        <p className="text-zinc-400">Av. Duarte Quirós 1400, Córdoba</p>
        <a
          href="https://maps.google.com/?q=Av.+Duarte+Quiros+1400+Cordoba"
          target="_blank" rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-bold text-zinc-300 hover:border-zinc-500 hover:text-white transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Cómo llegar
        </a>
      </div>

      {esMp && data.init_point ? (
        <button onClick={() => { window.location.href = data.init_point!; }}
          className="w-full rounded-2xl bg-red-600 py-4 font-black text-white text-base hover:bg-red-500 transition-all">
          Ir a pagar con Mercado Pago →
        </button>
      ) : (
        <button onClick={onClose}
          className="w-full rounded-2xl bg-zinc-800 py-4 font-black text-white text-base hover:bg-zinc-700 transition-all">
          Entendido
        </button>
      )}
    </div>
  );
}

// ─── Inscription modal ────────────────────────────────────────────────────────

function InscripcionModal({ campeonato, onClose }: { campeonato: Campeonato; onClose: () => void }) {
  const [form, setForm] = useState({
    nombre: "", apellido: "", telefono: "", dni: "",
    instagram: "", escuderia_favorita: "",
    acepto_condiciones: false,
    metodo_pago_inscripcion: "mercadopago" as "mercadopago" | "stand",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmacion, setConfirmacion] = useState<ConfirmacionData | null>(null);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.nombre.trim() || !form.apellido.trim() || !form.telefono.trim() || !form.dni.trim() || !form.escuderia_favorita) {
      setError("Completá todos los campos obligatorios."); return;
    }
    if (!form.acepto_condiciones) { setError("Debés aceptar los términos y condiciones."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/campeonatos/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre, apellido: form.apellido,
          telefono: form.telefono, dni: form.dni,
          instagram: form.instagram, escuderia_favorita: form.escuderia_favorita,
          acepto_condiciones: form.acepto_condiciones,
          metodo_pago_inscripcion: form.metodo_pago_inscripcion,
          campeonato_id: campeonato.id, monto: campeonato.precio_inscripcion,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al procesar la inscripción."); return; }
      setConfirmacion({
        nombre: form.nombre, apellido: form.apellido,
        telefono: form.telefono, dni: form.dni,
        escuderia_favorita: form.escuderia_favorita,
        campeonato: campeonato.nombre,
        metodo: data.metodo,
        init_point: data.init_point || data.sandbox_init_point,
      });
    } catch {
      setError("Error de conexión. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const inp = "w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <button onClick={onClose} className="absolute right-4 top-4 text-zinc-500 hover:text-white text-2xl leading-none">×</button>

        {confirmacion ? (
          <ConfirmacionScreen data={confirmacion} onClose={onClose} />
        ) : (
          <>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500 mb-2">Inscripción</p>
            <h2 className="text-xl font-black text-white mb-1">{campeonato.nombre}</h2>
            <p className="text-sm text-zinc-400 mb-6">
              Precio: <strong className="text-white">${campeonato.precio_inscripcion.toLocaleString()}</strong>
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-400">Nombre *</label>
                  <input className={inp} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-400">Apellido *</label>
                  <input className={inp} value={form.apellido} onChange={(e) => set("apellido", e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-400">Teléfono *</label>
                <input className={inp} type="tel" value={form.telefono} onChange={(e) => set("telefono", e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-400">DNI *</label>
                <input className={inp} value={form.dni} onChange={(e) => set("dni", e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-400">Escudería favorita de F1 *</label>
                <select className={inp} value={form.escuderia_favorita} onChange={(e) => set("escuderia_favorita", e.target.value)}>
                  <option value="">Seleccioná una escudería</option>
                  {ESCUDERIAS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-400">Instagram (opcional)</label>
                <input className={inp} placeholder="@usuario" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-zinc-400 uppercase tracking-widest">Método de pago *</label>
                <div className="space-y-2">
                  {[
                    { value: "mercadopago", label: "Pagar ahora con Mercado Pago", desc: "Pago online seguro" },
                    { value: "stand",       label: "Pagar en el stand",             desc: "Abonás cuando venís a SIM Argentina" },
                  ].map((opt) => (
                    <label key={opt.value}
                      className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition-all ${
                        form.metodo_pago_inscripcion === opt.value ? "border-red-500 bg-red-600/10" : "border-zinc-700 hover:border-zinc-500"
                      }`}
                    >
                      <input type="radio" name="metodo_pago" value={opt.value}
                        checked={form.metodo_pago_inscripcion === opt.value}
                        onChange={() => set("metodo_pago_inscripcion", opt.value)}
                        className="accent-red-500" />
                      <div>
                        <p className="text-sm font-bold text-white">{opt.label}</p>
                        <p className="text-xs text-zinc-500">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.acepto_condiciones}
                  onChange={(e) => set("acepto_condiciones", e.target.checked)}
                  className="mt-1 accent-red-500" />
                <span className="text-sm text-zinc-400">
                  Antes de inscribirte, confirmá que leíste y aceptás las condiciones de uso.
                  Para utilizar los simuladores, la <strong className="text-zinc-300">altura mínima es de 1,40 m</strong> y
                  el <strong className="text-zinc-300">peso máximo permitido es de 110 kg</strong>.
                  Confirmo que los datos ingresados son correctos.
                </span>
              </label>

              {error && <p className="rounded-xl bg-red-900/30 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</p>}

              <button onClick={submit} disabled={loading}
                className="w-full rounded-2xl bg-red-600 py-4 font-black text-white text-lg hover:bg-red-500 transition-all disabled:opacity-50">
                {loading
                  ? "Procesando..."
                  : form.metodo_pago_inscripcion === "stand"
                  ? "Inscribirme — pago en el stand"
                  : `Inscribirme — pagar $${campeonato.precio_inscripcion.toLocaleString()} online`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Section: Campeonatos ─────────────────────────────────────────────────────

function SecCampeonatos({ campeonatos, onInscribir }: { campeonatos: Campeonato[]; onInscribir: (c: Campeonato) => void }) {
  const orden = ["activo", "proximo", "finalizado"];
  const sorted = [...campeonatos].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado));
  if (sorted.length === 0) {
    return <p className="text-zinc-500 text-center py-16">No hay campeonatos disponibles por el momento.</p>;
  }
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {sorted.map((c) => (
        <div key={c.id} className="group rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 flex flex-col hover:border-red-500/40 transition-all">
          {c.imagen_url && <img src={c.imagen_url} alt={c.nombre} className="w-full h-40 object-cover rounded-2xl mb-5" />}
          <div className="flex items-start justify-between gap-3 mb-4">
            <h3 className="text-xl font-black text-white leading-tight">{c.nombre}</h3>
            <EstadoBadge estado={c.estado} />
          </div>
          {c.descripcion && <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{c.descripcion}</p>}
          <div className="space-y-2 text-sm text-zinc-400 mb-6 flex-1">
            {c.fecha_inicio && <p>📅 {c.fecha_inicio}{c.fecha_fin && ` → ${c.fecha_fin}`}</p>}
            <p>💰 ${c.precio_inscripcion.toLocaleString()} / inscripción</p>
          </div>
          <div className="flex gap-2 mt-auto">
            <a
              href={`https://wa.me/5493512520927?text=${encodeURIComponent(`Hola SIM, quiero más información sobre el campeonato: ${c.nombre}`)}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 rounded-2xl border border-zinc-700 py-3 font-black text-zinc-300 hover:border-zinc-500 hover:text-white transition-all text-center text-sm"
            >
              Más info
            </a>
            <button
              onClick={() => onInscribir(c)}
              disabled={!c.inscripcion_habilitada || c.estado === "finalizado"}
              className="flex-1 rounded-2xl bg-red-600 py-3 font-black text-white hover:bg-red-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >
              {c.estado === "finalizado" ? "Finalizado" : !c.inscripcion_habilitada ? "Inscripción cerrada" : "Inscribirme →"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section: Constructores ───────────────────────────────────────────────────

function SecConstructores({ constructores }: { constructores: Constructor[] }) {
  const medalColor = (pos: number) => {
    if (pos === 1) return "text-yellow-400";
    if (pos === 2) return "text-zinc-300";
    if (pos === 3) return "text-orange-500";
    return "text-zinc-500";
  };
  if (constructores.length === 0) {
    return <p className="text-zinc-500 text-center py-12">Sin puntos de constructores registrados aún.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/80 text-zinc-400">
          <tr>
            {["Pos", "Escudería", "Puntos", "Pilotos que puntuaron"].map((h) => (
              <th key={h} className="px-5 py-4 text-left font-bold uppercase text-xs tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {constructores.map((c) => (
            <tr key={c.escuderia} className="hover:bg-zinc-800/30 transition-colors">
              <td className={`px-5 py-4 font-black text-lg ${medalColor(c.posicion)}`}>{c.posicion}</td>
              <td className="px-5 py-4 font-black text-white text-base">{c.escuderia}</td>
              <td className="px-5 py-4 font-black text-red-400 text-lg">{c.puntos}</td>
              <td className="px-5 py-4 text-zinc-400 text-xs">{c.pilotos.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Section: Sorteos ─────────────────────────────────────────────────────────

function SecSorteos({ sorteos }: { sorteos: Sorteo[] }) {
  if (sorteos.length === 0) {
    return <p className="text-zinc-500 text-center py-12">No hay sorteos activos por el momento.</p>;
  }
  const orden = ["activo", "proximo", "finalizado"];
  const sorted = [...sorteos].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado));
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {sorted.map((s) => (
        <div key={s.id} className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 hover:border-red-500/30 transition-all">
          {s.imagen_url && <img src={s.imagen_url} alt={s.titulo} className="w-full h-36 object-cover rounded-2xl mb-5" />}
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="text-lg font-black text-white">{s.titulo}</h3>
            <EstadoBadge estado={s.estado} />
          </div>
          {s.descripcion && <p className="text-sm text-zinc-400 mb-3">{s.descripcion}</p>}
          <p className="text-base font-black text-red-400 mb-4">🏆 {s.premio}</p>
          <div className="space-y-1 text-xs text-zinc-500">
            {s.fecha_inicio && <p>Inicio: {s.fecha_inicio}{s.fecha_fin && ` → Cierre: ${s.fecha_fin}`}</p>}
            {s.condiciones && <p>Condiciones: {s.condiciones}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Pilot Modal ──────────────────────────────────────────────────────────────

function PilotoModal({ piloto, onClose }: { piloto: PilotoStat; onClose: () => void }) {
  const badge = CAT_BADGE[piloto.categoria] ?? { label: piloto.categoria, cls: "bg-zinc-700 text-zinc-300 border-zinc-600" };
  const sorted = [...piloto.historial].sort((a, b) => a.semana - b.semana);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 px-6 pt-6 pb-5">
          <button onClick={onClose}
            className="absolute right-4 top-4 text-zinc-500 hover:text-white text-2xl leading-none transition-colors">×</button>
          <p className="text-xs font-black uppercase tracking-[0.4em] text-red-500 mb-2">Piloto</p>
          <h2 className="text-2xl font-black text-white mb-3 pr-8 leading-tight">{piloto.piloto}</h2>
          <div className="flex flex-wrap gap-2 mb-5">
            <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-black tracking-widest ${badge.cls}`}>
              {badge.label}
            </span>
            {piloto.escuderia && (
              <span className="inline-flex items-center rounded-full border border-zinc-700 px-3 py-0.5 text-xs font-bold text-zinc-400">
                {piloto.escuderia}
              </span>
            )}
            {piloto.campeonato && (
              <span className="inline-flex items-center rounded-full border border-zinc-800 px-3 py-0.5 text-xs text-zinc-500">
                {piloto.campeonato}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { val: piloto.puntos, label: "Puntos", cls: "text-red-500" },
              { val: piloto.carreras, label: "Carreras", cls: "text-white" },
              { val: piloto.victorias, label: "Victorias", cls: "text-yellow-400" },
            ].map(({ val, label, cls }) => (
              <div key={label} className="text-center rounded-xl bg-zinc-900/60 border border-zinc-800/50 py-3">
                <div className={`text-2xl font-black ${cls}`}>{val}</div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          {piloto.mejor_tiempo && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-green-500/5 border border-green-500/15 px-4 py-3">
              <svg className="h-4 w-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <span className="font-mono text-lg font-black text-green-400">{piloto.mejor_tiempo}</span>
                <span className="text-xs text-zinc-500 ml-2">mejor tiempo</span>
              </div>
            </div>
          )}
        </div>

        {/* Historial */}
        <div className="p-6">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500 mb-4">Historial de carreras</p>
          {sorted.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-8">Sin registros</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/80 border-b border-zinc-800">
                  <tr>
                    {["Sem", "Circuito", "Tiempo", "Pos", "Pts"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-zinc-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {sorted.map((h, i) => (
                    <tr key={i} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{h.semana || "—"}</td>
                      <td className="px-4 py-3 text-zinc-300">{h.circuito || "—"}</td>
                      <td className="px-4 py-3 font-mono text-green-400 font-bold">{h.tiempo || "—"}</td>
                      <td className="px-4 py-3 font-black text-white">{h.posicion}</td>
                      <td className="px-4 py-3 font-black text-red-400">{h.puntos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section: Clasificación ───────────────────────────────────────────────────

function SecClasificacion({ resultados, campeonatos }: { resultados: Resultado[]; campeonatos: Campeonato[] }) {
  const [filtros, setFiltros] = useState({ campeonato_id: "", categoria: "", piloto: "", circuito: "", semana: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pilotoSeleccionado, setPilotoSeleccionado] = useState<PilotoStat | null>(null);

  const setFiltro = (k: keyof typeof filtros, v: string) => setFiltros((f) => ({ ...f, [k]: v }));
  const limpiarFiltros = () => setFiltros({ campeonato_id: "", categoria: "", piloto: "", circuito: "", semana: "" });
  const activeFilters = Object.values(filtros).filter(Boolean).length;

  const circuitos = useMemo(
    () => Array.from(new Set(resultados.map((r) => r.circuito).filter((c): c is string => Boolean(c)))).sort(),
    [resultados]
  );
  const semanas = useMemo(
    () => Array.from(new Set(resultados.map((r) => r.semana).filter((v) => v != null))).sort((a, b) => a - b),
    [resultados]
  );

  const filtrados = useMemo(
    () =>
      resultados.filter((r) => {
        if (filtros.campeonato_id && r.campeonato_id !== filtros.campeonato_id) return false;
        if (filtros.categoria && r.categoria !== filtros.categoria) return false;
        if (filtros.circuito && r.circuito !== filtros.circuito) return false;
        if (filtros.semana && String(r.semana) !== filtros.semana) return false;
        if (filtros.piloto && !r.nombre_completo.toLowerCase().includes(filtros.piloto.toLowerCase())) return false;
        return true;
      }),
    [resultados, filtros]
  );

  const pilotos = useMemo((): PilotoStat[] => {
    const map: Record<string, PilotoStat> = {};
    for (const r of filtrados) {
      const key = r.nombre_completo;
      if (!map[key]) {
        map[key] = {
          posicion: 0,
          piloto: key,
          categoria: r.categoria,
          campeonato: r.campeonato_nombre,
          escuderia: r.escuderia_favorita ?? "",
          carreras: 0,
          victorias: 0,
          podios: 0,
          mejor_tiempo: null,
          mejor_tiempo_seg: Infinity,
          puntos: 0,
          historial: [],
        };
      }
      const s = map[key];
      s.carreras++;
      s.puntos += r.puntos_ganados;
      if (r.puntos_ganados === 25) s.victorias++;
      if (r.puntos_ganados >= 15) s.podios++;
      if (r.tiempo_segundos && r.tiempo_segundos < s.mejor_tiempo_seg) {
        s.mejor_tiempo_seg = r.tiempo_segundos;
        s.mejor_tiempo = r.tiempo;
      }
      s.historial.push({
        fecha: r.fecha,
        circuito: r.circuito,
        tiempo: r.tiempo,
        posicion: ptsToPos(r.puntos_ganados),
        puntos: r.puntos_ganados,
        semana: r.semana,
      });
    }
    return Object.values(map)
      .sort((a, b) => b.puntos - a.puntos)
      .map((p, i) => ({ ...p, posicion: i + 1 }));
  }, [filtrados]);

  // ── Stats ──
  const lider = pilotos[0] ?? null;
  const masVictorias = useMemo(
    () => pilotos.reduce<PilotoStat | null>((best, p) => (!best || p.victorias > best.victorias ? p : best), null),
    [pilotos]
  );
  const mejorTiempoAbs = useMemo(
    () =>
      filtrados.reduce<{ piloto: string; tiempo: string; circuito: string | null; ts: number } | null>((best, r) => {
        if (!r.tiempo || !r.tiempo_segundos) return best;
        if (!best || r.tiempo_segundos < best.ts)
          return { piloto: r.nombre_completo, tiempo: r.tiempo, circuito: r.circuito, ts: r.tiempo_segundos };
        return best;
      }, null),
    [filtrados]
  );

  // ── UI helpers ──
  const sel =
    "rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500 transition-colors";

  const medalCls = (pos: number) => {
    if (pos === 1) return "text-yellow-400";
    if (pos === 2) return "text-zinc-300";
    if (pos === 3) return "text-orange-500";
    return "text-zinc-600";
  };

  const catBadge = (cat: string) => {
    const b = CAT_BADGE[cat] ?? { label: cat, cls: "bg-zinc-700/40 text-zinc-300 border-zinc-600" };
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-black tracking-widest ${b.cls}`}>
        {b.label}
      </span>
    );
  };

  const MEDALS = ["🥇", "🥈", "🥉"];

  return (
    <>
      <div className="space-y-5">

        {/* ── Stats cards ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard color="from-yellow-400 to-yellow-600" label="Líder">
            {lider ? (
              <>
                <p className="text-sm font-black text-white leading-tight truncate">{lider.piloto}</p>
                <p className="text-2xl font-black text-yellow-400 mt-1">
                  {lider.puntos} <span className="text-xs text-zinc-500">pts</span>
                </p>
              </>
            ) : (
              <p className="text-zinc-600 text-sm mt-2">Sin datos</p>
            )}
          </StatCard>

          <StatCard color="from-green-400 to-emerald-600" label="Mejor Tiempo">
            {mejorTiempoAbs ? (
              <>
                <p className="font-mono text-xl font-black text-green-400">{mejorTiempoAbs.tiempo}</p>
                <p className="text-xs text-zinc-500 truncate mt-1">{mejorTiempoAbs.piloto}</p>
                {mejorTiempoAbs.circuito && (
                  <p className="text-xs text-zinc-600 truncate">{mejorTiempoAbs.circuito}</p>
                )}
              </>
            ) : (
              <p className="text-zinc-600 text-sm mt-2">Sin datos</p>
            )}
          </StatCard>

          <StatCard color="from-red-500 to-red-700" label="+ Victorias">
            {masVictorias && masVictorias.victorias > 0 ? (
              <>
                <p className="text-sm font-black text-white leading-tight truncate">{masVictorias.piloto}</p>
                <p className="text-2xl font-black text-red-500 mt-1">
                  {masVictorias.victorias} <span className="text-xs text-zinc-500">vic.</span>
                </p>
              </>
            ) : (
              <p className="text-zinc-600 text-sm mt-2">Sin datos</p>
            )}
          </StatCard>

          <StatCard color="from-blue-400 to-blue-600" label="Participantes">
            <p className="text-4xl font-black text-blue-400 mt-1">{pilotos.length}</p>
            <p className="text-xs text-zinc-500 mt-1">pilotos</p>
          </StatCard>
        </div>

        {/* ── Filter bar: desktop ── */}
        <div className="hidden md:flex flex-wrap gap-2.5 items-center bg-zinc-900/40 rounded-2xl border border-zinc-800 p-4">
          <select className={sel} value={filtros.campeonato_id} onChange={(e) => setFiltro("campeonato_id", e.target.value)}>
            <option value="">Todos los campeonatos</option>
            {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select className={sel} value={filtros.categoria} onChange={(e) => setFiltro("categoria", e.target.value)}>
            <option value="">Todas las categorías</option>
            <option value="oro">Oro</option>
            <option value="plata">Plata</option>
            <option value="bronce">Bronce</option>
          </select>
          <input
            className={`${sel} placeholder-zinc-600 min-w-[180px] flex-1`}
            placeholder="🔍 Buscar piloto..."
            value={filtros.piloto}
            onChange={(e) => setFiltro("piloto", e.target.value)}
          />
          <select className={sel} value={filtros.circuito} onChange={(e) => setFiltro("circuito", e.target.value)}>
            <option value="">Todos los circuitos</option>
            {circuitos.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {semanas.length > 0 && (
            <select className={sel} value={filtros.semana} onChange={(e) => setFiltro("semana", e.target.value)}>
              <option value="">Todas las semanas</option>
              {semanas.map((s) => <option key={s} value={String(s)}>Semana {s}</option>)}
            </select>
          )}
          {activeFilters > 0 && (
            <button
              onClick={limpiarFiltros}
              className="text-xs font-black text-red-400 hover:text-red-300 uppercase tracking-wider px-2 transition-colors"
            >
              Limpiar ×
            </button>
          )}
        </div>

        {/* ── Filter bar: mobile accordion ── */}
        <div className="md:hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <button
            onClick={() => setFiltersOpen((f) => !f)}
            className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-black text-white"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              Filtros
              {activeFilters > 0 && (
                <span className="rounded-full bg-red-500 text-white text-xs px-1.5 py-0.5 font-black leading-none">
                  {activeFilters}
                </span>
              )}
            </span>
            <svg
              className={`w-4 h-4 text-zinc-500 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {filtersOpen && (
            <div className="px-4 pb-4 space-y-2.5 border-t border-zinc-800/60 pt-3">
              <select className={`${sel} w-full`} value={filtros.campeonato_id} onChange={(e) => setFiltro("campeonato_id", e.target.value)}>
                <option value="">Todos los campeonatos</option>
                {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <select className={`${sel} w-full`} value={filtros.categoria} onChange={(e) => setFiltro("categoria", e.target.value)}>
                <option value="">Todas las categorías</option>
                <option value="oro">Oro</option>
                <option value="plata">Plata</option>
                <option value="bronce">Bronce</option>
              </select>
              <input
                className={`${sel} w-full placeholder-zinc-600`}
                placeholder="🔍 Buscar piloto..."
                value={filtros.piloto}
                onChange={(e) => setFiltro("piloto", e.target.value)}
              />
              <select className={`${sel} w-full`} value={filtros.circuito} onChange={(e) => setFiltro("circuito", e.target.value)}>
                <option value="">Todos los circuitos</option>
                {circuitos.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {semanas.length > 0 && (
                <select className={`${sel} w-full`} value={filtros.semana} onChange={(e) => setFiltro("semana", e.target.value)}>
                  <option value="">Todas las semanas</option>
                  {semanas.map((s) => <option key={s} value={String(s)}>Semana {s}</option>)}
                </select>
              )}
              {activeFilters > 0 && (
                <button
                  onClick={limpiarFiltros}
                  className="w-full text-xs font-black text-red-400 uppercase tracking-wider py-2 border border-red-500/20 rounded-xl transition-colors"
                >
                  Limpiar filtros ×
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Main table ── */}
        {pilotos.length === 0 ? (
          <div className="text-center py-20 border border-zinc-800/50 rounded-2xl">
            <p className="text-4xl mb-4">🏁</p>
            <p className="text-lg font-black text-zinc-500">Sin resultados</p>
            <p className="text-sm text-zinc-600 mt-2">Aún no hay registros para los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/90 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-4 text-left text-xs font-black uppercase tracking-wider text-zinc-500 w-14">Pos</th>
                  <th className="px-4 py-4 text-left text-xs font-black uppercase tracking-wider text-zinc-500">Piloto</th>
                  <th className="px-4 py-4 text-left text-xs font-black uppercase tracking-wider text-zinc-500 hidden sm:table-cell">Cat</th>
                  <th className="px-4 py-4 text-left text-xs font-black uppercase tracking-wider text-zinc-500 hidden lg:table-cell">Campeonato</th>
                  <th className="px-4 py-4 text-center text-xs font-black uppercase tracking-wider text-zinc-500 hidden md:table-cell">Carr.</th>
                  <th className="px-4 py-4 text-center text-xs font-black uppercase tracking-wider text-zinc-500 hidden md:table-cell">Vict.</th>
                  <th className="px-4 py-4 text-center text-xs font-black uppercase tracking-wider text-zinc-500 hidden lg:table-cell">Podios</th>
                  <th className="px-4 py-4 text-left text-xs font-black uppercase tracking-wider text-zinc-500 hidden xl:table-cell">Mejor T.</th>
                  <th className="px-4 py-4 text-right text-xs font-black uppercase tracking-wider text-red-500">PTS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {pilotos.map((p) => (
                  <tr
                    key={p.piloto}
                    onClick={() => setPilotoSeleccionado(p)}
                    className={`group cursor-pointer transition-all hover:bg-zinc-800/50 ${
                      p.posicion === 1 ? "bg-yellow-400/[0.04]" :
                      p.posicion === 2 ? "bg-zinc-400/[0.03]"   :
                      p.posicion === 3 ? "bg-orange-500/[0.04]" : ""
                    }`}
                  >
                    <td className="px-4 py-4">
                      {p.posicion <= 3 ? (
                        <span className="text-xl leading-none">{MEDALS[p.posicion - 1]}</span>
                      ) : (
                        <span className={`text-base font-black tabular-nums ${medalCls(p.posicion)}`}>{p.posicion}</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-black text-white group-hover:text-red-400 transition-colors leading-tight block">
                        {p.piloto}
                      </span>
                      {p.escuderia && (
                        <span className="text-xs text-zinc-600 block mt-0.5">{p.escuderia}</span>
                      )}
                    </td>
                    <td className="px-4 py-4 hidden sm:table-cell">{catBadge(p.categoria)}</td>
                    <td className="px-4 py-4 text-zinc-500 hidden lg:table-cell text-xs max-w-[160px] truncate">
                      {p.campeonato || "—"}
                    </td>
                    <td className="px-4 py-4 text-center font-bold text-zinc-300 hidden md:table-cell tabular-nums">
                      {p.carreras}
                    </td>
                    <td className="px-4 py-4 text-center hidden md:table-cell">
                      <span className={`font-black text-base tabular-nums ${p.victorias > 0 ? "text-yellow-400" : "text-zinc-700"}`}>
                        {p.victorias}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center text-zinc-400 hidden lg:table-cell tabular-nums">{p.podios}</td>
                    <td className="px-4 py-4 hidden xl:table-cell">
                      <span className="font-mono text-green-400 font-bold text-xs">{p.mejor_tiempo || "—"}</span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-black text-lg text-red-500 tabular-nums">{p.puntos}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-zinc-700 text-center pt-1">
          Tocá un piloto para ver su historial completo →
        </p>
      </div>

      {pilotoSeleccionado && (
        <PilotoModal piloto={pilotoSeleccionado} onClose={() => setPilotoSeleccionado(null)} />
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CampeonatosPage() {
  const [data, setData] = useState<PublicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SecTab>("campeonatos");
  const [inscripcionCamp, setInscripcionCamp] = useState<Campeonato | null>(null);

  useEffect(() => {
    fetch("/api/campeonatos/public")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Error cargando datos."); setLoading(false); });
  }, []);

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-zinc-800 pb-16 pt-24 md:pt-32">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg,#ef4444 0,#ef4444 1px,transparent 0,transparent 50%)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 text-center">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.5em] text-red-500">SIM Argentina</p>
          <h1 className="text-5xl font-black leading-none md:text-7xl lg:text-8xl">
            <span className="text-white">CAMPEONATOS</span>
            <br />
            <span className="text-red-600">OFICIALES</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400 leading-relaxed">
            Competí al máximo nivel. Inscribite, marcá tus mejores tiempos y escalá en el ranking oficial de SIM Argentina.
          </p>
        </div>
      </section>

      {/* Tab nav */}
      <nav className="sticky top-0 z-40 border-b border-zinc-800 bg-black/95 backdrop-blur">
        <div className="mx-auto max-w-6xl overflow-x-auto">
          <div className="flex min-w-max">
            {SEC_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-6 py-4 text-sm font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                  tab === t.id
                    ? "border-red-600 text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        {loading && (
          <div className="flex items-center justify-center py-24 text-zinc-500">
            <div className="text-center">
              <div className="mb-4 h-8 w-8 mx-auto animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
              <p className="text-sm">Cargando datos...</p>
            </div>
          </div>
        )}
        {error && <p className="text-center py-16 text-red-400">{error}</p>}
        {data && (
          <>
            {tab === "campeonatos"   && <SecCampeonatos campeonatos={data.campeonatos} onInscribir={setInscripcionCamp} />}
            {tab === "clasificacion" && <SecClasificacion resultados={data.resultados_por_fecha} campeonatos={data.campeonatos} />}
            {tab === "constructores" && <SecConstructores constructores={data.constructores} />}
            {tab === "sorteos"       && <SecSorteos sorteos={data.sorteos} />}
          </>
        )}
      </section>

      {/* Inscription modal */}
      {inscripcionCamp && (
        <InscripcionModal campeonato={inscripcionCamp} onClose={() => setInscripcionCamp(null)} />
      )}

      {/* Footer */}
      <div className="border-t border-zinc-800 py-8 text-center">
        <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors">
          ← Volver al inicio
        </Link>
      </div>
    </main>
  );
}
