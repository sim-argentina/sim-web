"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hoyEnSim } from "@/lib/agenda";
import {
  CANALES_BAJA,
  ETIQUETA_FUENTE,
  LIMITES,
  RUTA_ALTA,
  RUTA_BAJA,
  TIPOS_EVIDENCIA,
  type EventoDto,
  type Fuente,
  type TextoDto,
} from "@/lib/marketing/consentimiento";

// Marketing · consentimiento y bajas (Etapa 3). No envía mensajes ni crea códigos.
//   · Staff: consulta un número y carga BAJAS pedidas por otro canal.
//   · Admin: además carga ALTAS con evidencia escrita y publica o retira el texto.
// La autoridad la decide la API con la sesión firmada; esta pantalla solo oculta
// lo que el rol no puede hacer.

type Modulo = { instalado: boolean; formulario_publico: boolean; texto_vigente: { version: string; titulo: string; publicado_en: string } | null };
type Resumen = {
  telefonos: number; altas_vigentes: number; bajas_vigentes: number; altas_por_fuente: Partial<Record<Fuente, number>>;
  altas_desde: number; bajas_desde: number; dias: number;
};
type EstadoTel = {
  estado: "alta" | "baja"; alta_en: string | null; alta_fuente: Fuente | null; alta_texto_version: string | null;
  nombre: string | null; localidad: string | null; baja_en: string | null; bajas: number; eventos: number;
};
type Consulta = { telefono: string; estado: EstadoTel | null; historial: EventoDto[] };
type Datos = { rol: "admin" | "staff"; modulo: Modulo; resumen?: Resumen; recientes?: EventoDto[]; consulta: Consulta | null };

const FMT = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", dateStyle: "short", timeStyle: "short" });
const fecha = (iso: string | null | undefined) => (iso ? FMT.format(new Date(iso)) : "—");
const etiquetaCanal = (v: string) => CANALES_BAJA.find((c) => c.valor === v)?.etiqueta ?? v;
const etiquetaEvidencia = (v: string) => TIPOS_EVIDENCIA.find((t) => t.valor === v)?.etiqueta ?? v;

function evidenciaTexto(e: EventoDto): string {
  const ev = e.evidencia ?? {};
  const partes: string[] = [];
  if (ev.canal) partes.push(etiquetaCanal(ev.canal));
  if (ev.tipo) partes.push(etiquetaEvidencia(ev.tipo));
  if (ev.referencia) partes.push(`«${ev.referencia}»`);
  if (ev.pagina) partes.push(`desde ${ev.pagina}`);
  if (ev.nota) partes.push(ev.nota);
  return partes.join(" · ") || "—";
}

const inp = "w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-white/30 focus:border-red-500";
const btnRojo = "rounded-xl bg-red-600 px-4 py-2 text-sm font-black uppercase text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40";
const btnBorde = "rounded-xl border border-white/20 px-4 py-2 text-sm font-black uppercase text-white/80 transition hover:border-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

export default function AdminMarketingPage() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [textos, setTextos] = useState<TextoDto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [consultado, setConsultado] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async (telefono: string | null) => {
    setCargando(true);
    setError("");
    try {
      const qs = telefono ? `?telefono=${encodeURIComponent(telefono)}` : "";
      const res = await fetch(`/api/admin/marketing/consentimientos${qs}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error || "No se pudo cargar el registro.");
        return;
      }
      setDatos(d as Datos);
      if ((d as Datos).rol === "admin" && (d as Datos).modulo.instalado) {
        const t = await fetch("/api/admin/marketing/textos", { cache: "no-store" });
        const dt = await t.json().catch(() => null);
        if (t.ok) setTextos((dt?.textos ?? []) as TextoDto[]);
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(null); }, [cargar]);

  const esAdmin = datos?.rol === "admin";
  const publicados = useMemo(() => textos.filter((t) => t.estado !== "borrador"), [textos]);

  async function accionTexto(accion: "publicar" | "retirar", t: TextoDto) {
    const pregunta = accion === "publicar"
      ? `¿Publicar "${t.version}"?\n\nDesde ahora es el texto que acepta quien se anota${datos?.modulo.texto_vigente ? ` y "${datos.modulo.texto_vigente.version}" queda retirado` : ""}. Publicalo solo si ya lo revisó un abogado: una vez publicado no se puede editar.`
      : `¿Retirar "${t.version}"?\n\nSe cierran las altas del formulario público hasta publicar otro texto. Las bajas siguen funcionando.`;
    if (!window.confirm(pregunta)) return;
    setAviso("");
    const res = await fetch("/api/admin/marketing/textos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, version: t.version }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) { setAviso(d?.error || "No se pudo completar."); return; }
    setAviso(accion === "publicar" ? `"${t.version}" publicado.` : `"${t.version}" retirado: altas públicas cerradas.`);
    await cargar(consultado);
  }

  function buscar() {
    const t = busqueda.trim();
    setConsultado(t || null);
    setAviso("");
    void cargar(t || null);
  }

  if (cargando && !datos) return <Marco><p className="text-white/60">Cargando…</p></Marco>;
  if (error && !datos) return <Marco><p className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 font-bold text-red-300">{error}</p></Marco>;
  if (!datos) return null;
  if (!datos.modulo.instalado) {
    return (
      <Marco>
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/70">
          El registro de consentimiento todavía no está instalado en esta base (falta la migración
          <code className="mx-1 text-white">db/marketing-consentimiento.sql</code>).
        </p>
      </Marco>
    );
  }

  const r = datos.resumen;
  return (
    <Marco>
      {/* ── Estado: las dos llaves ───────────────────────────────────────── */}
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <Tarjeta titulo="Formulario público" valor={datos.modulo.formulario_publico ? "Encendido" : "Apagado"}
          nota={datos.modulo.formulario_publico ? `${RUTA_ALTA} y ${RUTA_BAJA} responden` : "MARKETING_CONSENTIMIENTO_ENABLED no está en \"true\""}
          alerta={!datos.modulo.formulario_publico} />
        <Tarjeta titulo="Texto vigente" valor={datos.modulo.texto_vigente?.version ?? "Ninguno"}
          nota={datos.modulo.texto_vigente ? `Publicado ${fecha(datos.modulo.texto_vigente.publicado_en)}` : "Sin texto publicado no hay altas"}
          alerta={!datos.modulo.texto_vigente} />
        <Tarjeta titulo="Con consentimiento" valor={String(r?.altas_vigentes ?? 0)}
          nota={`Web ${r?.altas_por_fuente.formulario_web ?? 0} · Panel ${r?.altas_por_fuente.admin_evidencia ?? 0}`} />
        <Tarjeta titulo="Con baja" valor={String(r?.bajas_vigentes ?? 0)}
          nota={`Últimos ${r?.dias ?? 14} días: ${r?.altas_desde ?? 0} altas · ${r?.bajas_desde ?? 0} bajas`} />
      </div>

      {aviso && <p role="status" className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/90">{aviso}</p>}
      {error && <p role="alert" className="mb-4 rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">{error}</p>}

      {/* ── Consulta por teléfono ────────────────────────────────────────── */}
      <Seccion titulo="Consultar un número">
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
          <input className={inp} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="351 512 3456" inputMode="tel" maxLength={30} />
          <button type="submit" className={btnRojo} disabled={cargando}>Consultar</button>
        </form>
        {datos.consulta && (
          <FichaTelefono
            key={datos.consulta.telefono}
            consulta={datos.consulta}
            esAdmin={esAdmin}
            publicados={publicados}
            vigente={datos.modulo.texto_vigente?.version ?? null}
            alGuardar={(msg) => { setAviso(msg); void cargar(datos.consulta!.telefono); }}
          />
        )}
      </Seccion>

      {/* ── Textos (solo admin) ──────────────────────────────────────────── */}
      {esAdmin && (
        <Seccion titulo="Texto de la aceptación">
          <p className="mb-3 text-sm text-white/50">
            Los borradores se redactan y corrigen por SQL, con la revisión legal. Publicar uno retira el anterior;
            retirar el vigente cierra las altas públicas al instante.
          </p>
          <div className="space-y-3">
            {textos.map((t) => (
              <div key={t.version} className="rounded-2xl border border-white/10 bg-black p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black">{t.version} <span className="ml-2 text-sm font-bold text-white/50">{t.titulo}</span></p>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${t.estado === "vigente" ? "bg-green-600 text-white" : t.estado === "borrador" ? "bg-yellow-500/20 text-yellow-300" : "bg-white/10 text-white/50"}`}>
                    {t.estado}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/75">{t.texto}</p>
                <p className="mt-2 text-xs text-white/40">
                  Creado {fecha(t.creado_en)} · Publicado {fecha(t.publicado_en)} · Retirado {fecha(t.retirado_en)} · huella {t.huella.slice(0, 12)}…
                </p>
                <div className="mt-3 flex gap-2">
                  {t.estado === "borrador" && <button type="button" className={btnRojo} onClick={() => void accionTexto("publicar", t)}>Publicar</button>}
                  {t.estado === "vigente" && <button type="button" className={btnBorde} onClick={() => void accionTexto("retirar", t)}>Retirar</button>}
                </div>
              </div>
            ))}
          </div>
        </Seccion>
      )}

      {/* ── Últimos movimientos ──────────────────────────────────────────── */}
      <Seccion titulo="Últimos movimientos">
        {(datos.recientes ?? []).length === 0 ? (
          <p className="text-sm text-white/50">Todavía no hay altas ni bajas registradas.</p>
        ) : (
          <Tabla eventos={datos.recientes ?? []} conDetalle={false} />
        )}
        <p className="mt-3 text-xs text-white/40">Teléfonos enmascarados. Para ver el detalle, consultá el número.</p>
      </Seccion>

      <Seccion titulo="Enlaces para el stand">
        <p className="text-sm text-white/70">
          Alta: <code className="text-white">simexperience.com.ar{RUTA_ALTA}</code> · Baja: <code className="text-white">simexperience.com.ar{RUTA_BAJA}</code>
        </p>
        <p className="mt-2 text-xs text-white/40">
          Para el QR del stand. Funcionan solo con el formulario público encendido y un texto publicado (la baja, solo con el formulario encendido).
          Este panel no envía mensajes ni crea códigos.
        </p>
      </Seccion>
    </Marco>
  );
}

// ── Ficha de un número: estado, historial y cargas ─────────────────────────
function FichaTelefono({ consulta, esAdmin, publicados, vigente, alGuardar }: {
  consulta: Consulta; esAdmin: boolean; publicados: TextoDto[]; vigente: string | null; alGuardar: (msg: string) => void;
}) {
  const e = consulta.estado;
  const [modo, setModo] = useState<"baja" | "alta" | null>(null);
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-black">{consulta.telefono}</p>
          <p className="text-sm text-white/60">
            {!e ? "Sin registro: no tiene consentimiento ni baja."
              : e.estado === "alta"
                ? `Con consentimiento desde ${fecha(e.alta_en)} (${e.alta_fuente ? ETIQUETA_FUENTE[e.alta_fuente] : "—"}, texto ${e.alta_texto_version ?? "—"})`
                : `Con baja desde ${fecha(e.baja_en)} · solo la persona puede volver a anotarse, desde el formulario.`}
          </p>
          {e?.estado === "alta" && (e.nombre || e.localidad) && (
            <p className="text-sm text-white/40">{[e.nombre, e.localidad].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${!e ? "bg-white/10 text-white/60" : e.estado === "alta" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {!e ? "sin registro" : e.estado}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnBorde} onClick={() => setModo(modo === "baja" ? null : "baja")}>Registrar baja</button>
        {esAdmin && (
          <button type="button" className={btnBorde} disabled={e?.estado === "baja" || publicados.length === 0}
            title={e?.estado === "baja" ? "Una carga del panel no revierte una baja" : publicados.length === 0 ? "No hay ningún texto publicado" : undefined}
            onClick={() => setModo(modo === "alta" ? null : "alta")}>
            Registrar alta con evidencia
          </button>
        )}
      </div>
      {modo === "baja" && <FormBaja telefono={consulta.telefono} alGuardar={(m) => { setModo(null); alGuardar(m); }} />}
      {modo === "alta" && esAdmin && (
        <FormAlta telefono={consulta.telefono} publicados={publicados} vigente={vigente} alGuardar={(m) => { setModo(null); alGuardar(m); }} />
      )}

      <p className="mt-5 mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/40">Historial ({consulta.historial.length})</p>
      {consulta.historial.length === 0 ? <p className="text-sm text-white/50">Sin movimientos.</p> : <Tabla eventos={consulta.historial} conDetalle />}
    </div>
  );
}

function useEnvio() {
  const intento = useRef<{ clave: string; cuerpo: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  async function enviar(cuerpo: Record<string, unknown>): Promise<boolean> {
    setEnviando(true);
    setError("");
    const s = JSON.stringify(cuerpo);
    if (!intento.current || intento.current.cuerpo !== s) intento.current = { clave: crypto.randomUUID(), cuerpo: s };
    try {
      const res = await fetch("/api/admin/marketing/consentimientos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cuerpo, idempotency_key: intento.current.clave }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setError(d?.error || "No se pudo registrar."); return false; }
      intento.current = null;
      return true;
    } catch {
      setError("Error de conexión.");
      return false;
    } finally {
      setEnviando(false);
    }
  }
  return { enviar, enviando, error };
}

function FormBaja({ telefono, alGuardar }: { telefono: string; alGuardar: (msg: string) => void }) {
  const [canal, setCanal] = useState<string>(CANALES_BAJA[0].valor);
  const [nota, setNota] = useState("");
  const [fechaOrigen, setFechaOrigen] = useState(hoyEnSim());
  const { enviar, enviando, error } = useEnvio();
  return (
    <form className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-3"
      onSubmit={async (ev) => {
        ev.preventDefault();
        if (await enviar({ accion: "baja", telefono, canal, nota, fecha_origen: fechaOrigen })) alGuardar("Baja registrada.");
      }}>
      <Campo etiqueta="Cómo lo pidió">
        <select className={inp} value={canal} onChange={(e) => setCanal(e.target.value)}>
          {CANALES_BAJA.map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Cuándo lo pidió">
        <input type="date" className={inp} value={fechaOrigen} max={hoyEnSim()} onChange={(e) => setFechaOrigen(e.target.value)} />
      </Campo>
      <Campo etiqueta="Nota (opcional)">
        <input className={inp} value={nota} maxLength={LIMITES.nota} onChange={(e) => setNota(e.target.value)} />
      </Campo>
      {error && <p role="alert" className="md:col-span-3 text-sm font-bold text-red-300">{error}</p>}
      <div className="md:col-span-3"><button type="submit" className={btnRojo} disabled={enviando}>{enviando ? "Guardando…" : "Guardar baja"}</button></div>
    </form>
  );
}

function FormAlta({ telefono, publicados, vigente, alGuardar }: { telefono: string; publicados: TextoDto[]; vigente: string | null; alGuardar: (msg: string) => void }) {
  const [version, setVersion] = useState(vigente ?? publicados[0]?.version ?? "");
  const [tipo, setTipo] = useState<string>(TIPOS_EVIDENCIA[0].valor);
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [fechaOrigen, setFechaOrigen] = useState(hoyEnSim());
  const [nombre, setNombre] = useState("");
  const [localidad, setLocalidad] = useState("");
  const { enviar, enviando, error } = useEnvio();
  return (
    <form className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-3"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const ok = await enviar({ accion: "alta", telefono, texto_version: version, tipo_evidencia: tipo, referencia, nota, fecha_origen: fechaOrigen, nombre, localidad });
        if (ok) alGuardar("Alta con evidencia registrada.");
      }}>
      <p className="md:col-span-3 text-sm text-white/60">
        Solo con consentimiento ESCRITO de la persona (planilla firmada, mensaje o email suyo). Dar el teléfono para un turno no es consentimiento.
      </p>
      <Campo etiqueta="Texto que aceptó">
        <select className={inp} value={version} onChange={(e) => setVersion(e.target.value)}>
          {publicados.map((t) => <option key={t.version} value={t.version}>{t.version} ({t.estado})</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Evidencia">
        <select className={inp} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_EVIDENCIA.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Dónde está (referencia)">
        <input className={inp} value={referencia} maxLength={LIMITES.referencia} required placeholder="Planilla stand 18/10, fila 12" onChange={(e) => setReferencia(e.target.value)} />
      </Campo>
      <Campo etiqueta="Cuándo la dio">
        <input type="date" className={inp} value={fechaOrigen} max={hoyEnSim()} onChange={(e) => setFechaOrigen(e.target.value)} />
      </Campo>
      <Campo etiqueta="Nombre (opcional)">
        <input className={inp} value={nombre} maxLength={LIMITES.nombre} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo etiqueta="Localidad declarada (opcional)">
        <input className={inp} value={localidad} maxLength={LIMITES.localidad} onChange={(e) => setLocalidad(e.target.value)} />
      </Campo>
      <div className="md:col-span-3">
        <Campo etiqueta="Nota (opcional)">
          <input className={inp} value={nota} maxLength={LIMITES.nota} onChange={(e) => setNota(e.target.value)} />
        </Campo>
      </div>
      {error && <p role="alert" className="md:col-span-3 text-sm font-bold text-red-300">{error}</p>}
      <div className="md:col-span-3"><button type="submit" className={btnRojo} disabled={enviando || !referencia.trim() || !version}>{enviando ? "Guardando…" : "Guardar alta"}</button></div>
    </form>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────────
function Tabla({ eventos, conDetalle }: { eventos: EventoDto[]; conDetalle: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs font-black uppercase tracking-[0.12em] text-white/35">
          <tr>
            <th className="px-2 py-2">Origen</th><th className="px-2 py-2">Registrado</th><th className="px-2 py-2">Teléfono</th>
            <th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Fuente</th><th className="px-2 py-2">Quién</th>
            {conDetalle && <th className="px-2 py-2">Evidencia</th>}
          </tr>
        </thead>
        <tbody>
          {eventos.map((e) => (
            <tr key={e.id} className="border-t border-white/10">
              <td className="px-2 py-2 text-white/70">{fecha(e.ocurrido_en)}</td>
              <td className="px-2 py-2 text-white/50">{fecha(e.registrado_en)}</td>
              <td className="px-2 py-2 font-mono text-white/80">{e.telefono}</td>
              <td className={`px-2 py-2 font-black uppercase ${e.tipo === "alta" ? "text-green-400" : "text-red-400"}`}>{e.tipo}</td>
              <td className="px-2 py-2 text-white/70">{ETIQUETA_FUENTE[e.fuente] ?? e.fuente}</td>
              <td className="px-2 py-2 text-white/50">{e.actor_rol}</td>
              {conDetalle && <td className="px-2 py-2 text-white/60">{evidenciaTexto(e)}{e.texto_version ? ` · texto ${e.texto_version}` : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white md:px-6">
      <section className="mx-auto max-w-6xl">
        <div className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-red-500">Admin SIM</p>
          <h1 className="text-3xl font-black uppercase md:text-5xl">Marketing</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Consentimiento para promociones por WhatsApp: quién aceptó, quién pidió la baja y con qué evidencia.
            No envía mensajes ni crea códigos.
          </p>
        </div>
        {children}
      </section>
    </main>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <h2 className="mb-4 text-xl font-black uppercase text-red-500">{titulo}</h2>
      {children}
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, alerta = false }: { titulo: string; valor: string; nota: string; alerta?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${alerta ? "border-yellow-500/30 bg-yellow-950/10" : "border-white/10 bg-white/[0.03]"}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">{titulo}</p>
      <p className="mt-2 text-2xl font-black text-white">{valor}</p>
      <p className="mt-1 text-xs text-white/50">{nota}</p>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{etiqueta}</span>
      {children}
    </label>
  );
}
