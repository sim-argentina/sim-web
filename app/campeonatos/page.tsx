"use client";

import { useState, useEffect } from "react";
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

type RankingItem = {
  piloto: string;
  tiempo: string | null;
  tiempo_segundos: number;
  circuito: string | null;
  fecha: string;
  simulador: string | null;
  posicion: number;
};

type PuntosItem = {
  nombre: string;
  semanas: Record<string, number>;
  total: number;
  posicion: number;
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
  rankings: Record<string, RankingItem[]>;
  puntos: Record<string, PuntosItem[]>;
  constructores: Constructor[];
  resultados_por_fecha: Resultado[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ESCUDERIAS = [
  "Red Bull", "Mercedes", "Ferrari", "McLaren", "Aston Martin",
  "Alpine", "Williams", "Racing Bulls", "Kick Sauber", "Haas",
];

const CATEGORIAS_TABS = ["oro", "plata", "bronce"] as const;

type SecTab = "campeonatos" | "rankings" | "puntos" | "constructores" | "resultados" | "sorteos";
const SEC_TABS: { id: SecTab; label: string }[] = [
  { id: "campeonatos", label: "Campeonatos" },
  { id: "rankings", label: "Rankings" },
  { id: "puntos", label: "Puntos" },
  { id: "constructores", label: "Constructores" },
  { id: "resultados", label: "Resultados" },
  { id: "sorteos", label: "Sorteos" },
];

// ─── Small UI ─────────────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    activo: "bg-green-500/20 text-green-400 border border-green-500/30",
    proximo: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
    finalizado: "bg-zinc-700/50 text-zinc-400 border border-zinc-700",
  };
  const labels: Record<string, string> = { activo: "ACTIVO", proximo: "PRÓXIMO", finalizado: "FINALIZADO" };
  return (
    <span className={`rounded-full px-3 py-0.5 text-xs font-black tracking-widest ${map[estado] ?? "bg-zinc-700/50 text-zinc-400"}`}>
      {labels[estado] ?? estado.toUpperCase()}
    </span>
  );
}

function CatTab({ active, cat, onClick }: { active: boolean; cat: string; onClick: () => void }) {
  const colors: Record<string, string> = {
    oro: active ? "bg-yellow-500 text-black" : "text-yellow-500 hover:bg-yellow-500/10",
    plata: active ? "bg-zinc-300 text-black" : "text-zinc-300 hover:bg-zinc-300/10",
    bronce: active ? "bg-orange-700 text-white" : "text-orange-500 hover:bg-orange-700/10",
  };
  return (
    <button onClick={onClick} className={`rounded-xl px-5 py-2 text-sm font-black uppercase tracking-widest transition-all ${colors[cat]}`}>
      {cat}
    </button>
  );
}

// ─── Inscription Modal ────────────────────────────────────────────────────────

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

      {/* Datos registrados */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
        <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">Datos registrados</p>
        {[
          ["Nombre", data.nombre],
          ["Apellido", data.apellido],
          ["Teléfono", data.telefono],
          ["DNI", data.dni],
          ["Escudería", data.escuderia_favorita],
          ["Campeonato", data.campeonato],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-zinc-500">{label}</span>
            <span className="font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      {/* Mensaje según método de pago */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300 leading-relaxed space-y-3">
        <p>Tu inscripción fue registrada correctamente.</p>
        {esMp ? (
          <p>
            Ahora debés acercarte al stand de SIM Argentina para realizar tu tanda clasificatoria
            y registrar tu mejor tiempo. Con ese tiempo serás ubicado en una categoría competitiva.
          </p>
        ) : (
          <p>
            Recordá que deberás abonar la inscripción al llegar al stand. Luego podrás realizar
            tu tanda clasificatoria y registrar tu mejor tiempo para ser ubicado en una categoría
            competitiva.
          </p>
        )}
      </div>

      {/* Ubicación */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm space-y-2">
        <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">Dónde encontrarnos</p>
        <p className="font-bold text-white">SIM Argentina</p>
        <p className="text-zinc-400">Nuevo Centro Shopping</p>
        <p className="text-zinc-400">Av. Duarte Quirós 1400, Córdoba</p>
        <a
          href="https://maps.google.com/?q=Av.+Duarte+Quiros+1400+Cordoba"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-bold text-zinc-300 hover:border-zinc-500 hover:text-white transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Cómo llegar
        </a>
      </div>

      {/* CTA */}
      {esMp && data.init_point ? (
        <button
          onClick={() => { window.location.href = data.init_point!; }}
          className="w-full rounded-2xl bg-red-600 py-4 font-black text-white text-base hover:bg-red-500 transition-all"
        >
          Ir a pagar con Mercado Pago →
        </button>
      ) : (
        <button
          onClick={onClose}
          className="w-full rounded-2xl bg-zinc-800 py-4 font-black text-white text-base hover:bg-zinc-700 transition-all"
        >
          Entendido
        </button>
      )}
    </div>
  );
}

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
          nombre: form.nombre,
          apellido: form.apellido,
          telefono: form.telefono,
          dni: form.dni,
          instagram: form.instagram,
          escuderia_favorita: form.escuderia_favorita,
          acepto_condiciones: form.acepto_condiciones,
          metodo_pago_inscripcion: form.metodo_pago_inscripcion,
          campeonato_id: campeonato.id,
          monto: campeonato.precio_inscripcion,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al procesar la inscripción."); return; }
      setConfirmacion({
        nombre: form.nombre,
        apellido: form.apellido,
        telefono: form.telefono,
        dni: form.dni,
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
  const sel = inp;

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
                <select className={sel} value={form.escuderia_favorita} onChange={(e) => set("escuderia_favorita", e.target.value)}>
                  <option value="">Seleccioná una escudería</option>
                  {ESCUDERIAS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-400">Instagram (opcional)</label>
                <input className={inp} placeholder="@usuario" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} />
              </div>

              {/* Método de pago */}
              <div>
                <label className="mb-2 block text-xs font-bold text-zinc-400 uppercase tracking-widest">Método de pago *</label>
                <div className="space-y-2">
                  {[
                    { value: "mercadopago", label: "Pagar ahora con Mercado Pago", desc: "Pago online seguro" },
                    { value: "stand", label: "Pagar en el stand", desc: "Abonás cuando venís a SIM Argentina" },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition-all ${
                        form.metodo_pago_inscripcion === opt.value
                          ? "border-red-500 bg-red-600/10"
                          : "border-zinc-700 hover:border-zinc-500"
                      }`}
                    >
                      <input
                        type="radio"
                        name="metodo_pago"
                        value={opt.value}
                        checked={form.metodo_pago_inscripcion === opt.value}
                        onChange={() => set("metodo_pago_inscripcion", opt.value)}
                        className="accent-red-500"
                      />
                      <div>
                        <p className="text-sm font-bold text-white">{opt.label}</p>
                        <p className="text-xs text-zinc-500">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* T&C */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.acepto_condiciones}
                  onChange={(e) => set("acepto_condiciones", e.target.checked)}
                  className="mt-1 accent-red-500"
                />
                <span className="text-sm text-zinc-400">
                  Antes de inscribirte, confirmá que leíste y aceptás las condiciones de uso.
                  Para utilizar los simuladores, la <strong className="text-zinc-300">altura mínima es de 1,40 m</strong> y
                  el <strong className="text-zinc-300">peso máximo permitido es de 110 kg</strong>.
                  Confirmo que los datos ingresados son correctos.
                </span>
              </label>

              {error && <p className="rounded-xl bg-red-900/30 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</p>}

              <button
                onClick={submit}
                disabled={loading}
                className="w-full rounded-2xl bg-red-600 py-4 font-black text-white text-lg hover:bg-red-500 transition-all disabled:opacity-50"
              >
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
          {c.imagen_url && (
            <img src={c.imagen_url} alt={c.nombre} className="w-full h-40 object-cover rounded-2xl mb-5" />
          )}
          <div className="flex items-start justify-between gap-3 mb-4">
            <h3 className="text-xl font-black text-white leading-tight">{c.nombre}</h3>
            <EstadoBadge estado={c.estado} />
          </div>
          {c.descripcion && <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{c.descripcion}</p>}
          <div className="space-y-2 text-sm text-zinc-400 mb-6 flex-1">
            {c.fecha_inicio && (
              <p>📅 {c.fecha_inicio} {c.fecha_fin && `→ ${c.fecha_fin}`}</p>
            )}
            <p>💰 ${c.precio_inscripcion.toLocaleString()} / inscripción</p>
          </div>
          <div className="flex gap-2 mt-auto">
            <a
              href={`https://wa.me/5493512520927?text=${encodeURIComponent(`Hola SIM, quiero más información sobre el campeonato: ${c.nombre}`)}`}
              target="_blank"
              rel="noopener noreferrer"
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

// ─── Section: Rankings ────────────────────────────────────────────────────────

function SecRankings({ rankings }: { rankings: Record<string, RankingItem[]> }) {
  const [cat, setCat] = useState<"oro" | "plata" | "bronce">("oro");
  const data = rankings[cat] || [];

  const medalColor = (pos: number) => {
    if (pos === 1) return "text-yellow-400";
    if (pos === 2) return "text-zinc-300";
    if (pos === 3) return "text-orange-500";
    return "text-zinc-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {CATEGORIAS_TABS.map((c) => <CatTab key={c} active={cat === c} cat={c} onClick={() => setCat(c)} />)}
      </div>

      {data.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">Sin tiempos registrados para esta categoría.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-zinc-400">
              <tr>
                {["Pos", "Piloto", "Mejor tiempo", "Circuito", "Fecha", "Simulador"].map((h) => (
                  <th key={h} className="px-5 py-4 text-left font-bold uppercase text-xs tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {data.map((r) => (
                <tr key={r.piloto} className="hover:bg-zinc-800/30 transition-colors">
                  <td className={`px-5 py-4 font-black text-lg ${medalColor(r.posicion)}`}>{r.posicion}</td>
                  <td className="px-5 py-4 font-bold text-white">{r.piloto}</td>
                  <td className="px-5 py-4 font-mono text-red-400 font-bold">{r.tiempo || "—"}</td>
                  <td className="px-5 py-4 text-zinc-400">{r.circuito || "—"}</td>
                  <td className="px-5 py-4 text-zinc-400">{r.fecha}</td>
                  <td className="px-5 py-4 text-zinc-400">{r.simulador || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Section: Puntos ─────────────────────────────────────────────────────────

function SecPuntos({ puntos }: { puntos: Record<string, PuntosItem[]> }) {
  const [cat, setCat] = useState<"oro" | "plata" | "bronce">("oro");
  const data = puntos[cat] || [];

  // Determinar semanas máximas dinámicamente
  const semanas = Array.from(
    new Set(data.flatMap((p) => Object.keys(p.semanas).map((k) => parseInt(k.replace("semana_", "")))))
  ).sort((a, b) => a - b);

  const medalColor = (pos: number) => {
    if (pos === 1) return "text-yellow-400 font-black";
    if (pos === 2) return "text-zinc-300 font-black";
    if (pos === 3) return "text-orange-500 font-black";
    return "text-zinc-400";
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {CATEGORIAS_TABS.map((c) => <CatTab key={c} active={cat === c} cat={c} onClick={() => setCat(c)} />)}
      </div>

      {data.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">Sin puntos registrados para esta categoría.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-zinc-400">
              <tr>
                <th className="px-5 py-4 text-left font-bold uppercase text-xs tracking-wider">Pos</th>
                <th className="px-5 py-4 text-left font-bold uppercase text-xs tracking-wider">Piloto</th>
                {semanas.map((s) => (
                  <th key={s} className="px-5 py-4 text-center font-bold uppercase text-xs tracking-wider">Sem {s}</th>
                ))}
                <th className="px-5 py-4 text-center font-bold uppercase text-xs tracking-wider text-red-400">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {data.map((p) => (
                <tr key={p.nombre} className="hover:bg-zinc-800/30 transition-colors">
                  <td className={`px-5 py-4 text-lg ${medalColor(p.posicion)}`}>{p.posicion}</td>
                  <td className="px-5 py-4 font-bold text-white">{p.nombre}</td>
                  {semanas.map((s) => (
                    <td key={s} className="px-5 py-4 text-center text-zinc-300">{p.semanas[`semana_${s}`] ?? "—"}</td>
                  ))}
                  <td className="px-5 py-4 text-center font-black text-red-400 text-base">{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

// ─── Section: Resultados ──────────────────────────────────────────────────────

function SecResultados({ resultados, campeonatos }: { resultados: Resultado[]; campeonatos: Campeonato[] }) {
  const [filters, setFilters] = useState({ campeonato_id: "", circuito: "" });
  const [cat, setCat] = useState<"oro" | "plata" | "bronce" | "">("oro");

  const circuitos = Array.from(new Set(resultados.map((r) => r.circuito).filter(Boolean)));

  const filtered = resultados.filter((r) => {
    if (filters.campeonato_id && r.campeonato_id !== filters.campeonato_id) return false;
    if (cat && r.categoria !== cat) return false;
    if (filters.circuito && r.circuito !== filters.circuito) return false;
    return true;
  });

  const sel = "rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <select className={sel} value={filters.campeonato_id} onChange={(e) => setFilters((f) => ({ ...f, campeonato_id: e.target.value }))}>
          <option value="">Todos los campeonatos</option>
          {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className={sel} value={cat} onChange={(e) => setCat(e.target.value as "oro" | "plata" | "bronce" | "")}>
          <option value="">Todas las categorías</option>
          <option value="oro">Oro</option>
          <option value="plata">Plata</option>
          <option value="bronce">Bronce</option>
        </select>
        <select className={sel} value={filters.circuito} onChange={(e) => setFilters((f) => ({ ...f, circuito: e.target.value }))}>
          <option value="">Todos los circuitos</option>
          {circuitos.map((c) => <option key={c!} value={c!}>{c}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">Sin resultados para los filtros seleccionados.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-zinc-400">
              <tr>
                {["Piloto", "Cat", "Circuito", "Tiempo", "Pts"].map((h) => (
                  <th key={h} className="px-5 py-4 text-left font-bold uppercase text-xs tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-5 py-4 font-bold text-white">{r.nombre_completo}</td>
                  <td className="px-5 py-4 text-xs font-black uppercase text-zinc-400">{r.categoria}</td>
                  <td className="px-5 py-4 text-zinc-400">{r.circuito || "—"}</td>
                  <td className="px-5 py-4 font-mono text-red-400 font-bold">{r.tiempo || "—"}</td>
                  <td className="px-5 py-4 font-black text-white">{r.puntos_ganados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
          {s.imagen_url && (
            <img src={s.imagen_url} alt={s.titulo} className="w-full h-36 object-cover rounded-2xl mb-5" />
          )}
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="text-lg font-black text-white">{s.titulo}</h3>
            <EstadoBadge estado={s.estado} />
          </div>
          {s.descripcion && <p className="text-sm text-zinc-400 mb-3">{s.descripcion}</p>}
          <p className="text-base font-black text-red-400 mb-4">🏆 {s.premio}</p>
          <div className="space-y-1 text-xs text-zinc-500">
            {s.fecha_inicio && <p>Inicio: {s.fecha_inicio} {s.fecha_fin && `→ Cierre: ${s.fecha_fin}`}</p>}
            {s.condiciones && <p>Condiciones: {s.condiciones}</p>}
          </div>
        </div>
      ))}
    </div>
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
          style={{ backgroundImage: "repeating-linear-gradient(90deg,#ef4444 0,#ef4444 1px,transparent 0,transparent 50%)", backgroundSize: "40px 40px" }}
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
                  tab === t.id ? "border-red-600 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        {loading && (
          <div className="flex items-center justify-center py-24 text-zinc-500">
            <div className="text-center">
              <div className="mb-4 text-4xl">⟳</div>
              <p>Cargando datos...</p>
            </div>
          </div>
        )}
        {error && <p className="text-center py-16 text-red-400">{error}</p>}
        {data && (
          <>
            {tab === "campeonatos" && (
              <SecCampeonatos campeonatos={data.campeonatos} onInscribir={setInscripcionCamp} />
            )}
            {tab === "rankings" && <SecRankings rankings={data.rankings} />}
            {tab === "puntos" && <SecPuntos puntos={data.puntos} />}
            {tab === "constructores" && <SecConstructores constructores={data.constructores} />}
            {tab === "resultados" && <SecResultados resultados={data.resultados_por_fecha} campeonatos={data.campeonatos} />}
            {tab === "sorteos" && <SecSorteos sorteos={data.sorteos} />}
          </>
        )}
      </section>

      {/* Inscription Modal */}
      {inscripcionCamp && (
        <InscripcionModal campeonato={inscripcionCamp} onClose={() => setInscripcionCamp(null)} />
      )}

      {/* Footer link */}
      <div className="border-t border-zinc-800 py-8 text-center">
        <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors">
          ← Volver al inicio
        </Link>
      </div>
    </main>
  );
}
