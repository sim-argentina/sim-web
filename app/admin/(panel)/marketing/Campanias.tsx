"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ESTADOS_CAMPANIA,
  ESTADOS_DESTINATARIO,
  MOTIVOS_DESTINATARIO,
  PROPUESTA_SIN_APROBAR,
  describirBeneficio,
  describirProductos,
  type Capacidad,
  type DatosCampania,
  type EstadoCampania,
  type EstadoDestinatario,
} from "@/lib/marketing/campanias";
import FormCampania, { Capacidades, ResumenAudiencia, formDesde, formVacio, type VistaPreviaDto } from "./FormCampania";
import { Seccion, Simulado, Tarjeta, btnBorde, btnRojo, fecha } from "./ui";

// Marketing · campañas de recuperación del stand, en SIMULACIÓN.
// Configurar → calcular audiencia → preparar (beneficios ficticios) → ejecutar
// por lotes con el proveedor simulado → resultados. Todo lo que dice enviado,
// entregado o costo es simulado. La autoridad la decide la API: admin crea,
// modifica y ejecuta; staff solo mira. La cola vive en la base: cerrar esta
// pestaña no pierde nada y "Ejecutar hasta terminar" sigue donde quedó.

type Conteos = {
  preparados: number; pendientes: number; enviando: number; aceptados: number; entregados: number; no_entregados: number;
  fallidos: number; inciertos: number; excluidos: number; cancelados: number; costo_simulado: number;
  excluidos_por_motivo: Record<string, number>; fallidos_por_motivo: Record<string, number>;
};
type Item = { id: string; nombre: string; objetivo: string; estado: EstadoCampania; ventana_dias: number; seleccionados: number | null; creada_en: string; moneda: string | null; conteos: Conteos };
type Lista = { rol: "admin" | "staff"; instaladas: boolean; entorno: { escritura: boolean; motivo: string }; campanias: Item[] };
type Campania = DatosCampania & {
  id: string; estado: EstadoCampania; version: number; seleccionados: number | null; costo_maximo: number | null;
  audiencia: (VistaPreviaDto & { al_preparar?: Record<string, number> }) | null;
  preparada_en: string | null; iniciada_en: string | null; pausada_en: string | null; cancelada_en: string | null; completada_en: string | null; creada_en: string;
};
type Dest = {
  id: string; orden: number; telefono: string; indicativo: string | null; ultima_visita: string; beneficio_codigo: string;
  estado: EstadoDestinatario; intentos: number; motivo: string | null; ultimo_codigo: string | null; proximo_intento_en: string | null;
  aceptado_en: string | null; entregado_en: string | null; terminado_en: string | null; costo: number | null;
};
type Detalle = {
  rol: "admin" | "staff"; campania: Campania; conteos: Conteos; destinatarios: Dest[];
  eventos: { id: number; tipo: string; actor: string; detalle: Record<string, unknown>; creado_en: string }[];
  atribucion: { con_cupon_real: number; ficticios: number; reservas_pagadas: number; gift_cards_pagadas: number; regresos_stand: number };
  capacidades: Capacidad[]; condiciones: string[]; mensaje_ejemplo: string;
};

/** Lotes breves desde el panel: cada uno es un pedido corto y se ve el avance. */
const LOTE_PANEL = 5;

const CHIP: Record<EstadoCampania, string> = {
  borrador: "bg-white/10 text-white/70", preparada: "bg-blue-500/20 text-blue-200", ejecutando: "bg-green-600 text-white",
  pausada: "bg-yellow-500/20 text-yellow-200", cancelada: "bg-red-600/30 text-red-200", completada: "bg-white text-black",
};
const COLOR_DEST: Partial<Record<EstadoDestinatario, string>> = {
  entregado: "text-green-400", aceptado: "text-green-300", fallido: "text-red-400", no_entregado: "text-red-300",
  incierto: "text-yellow-300", excluido: "text-white/50", cancelado: "text-white/40", enviando: "text-blue-300",
};

export default function Campanias() {
  const params = useSearchParams();
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [deshabilitado, setDeshabilitado] = useState(false);
  const [vista, setVista] = useState<{ tipo: "lista" } | { tipo: "nueva" } | { tipo: "detalle"; id: string } | { tipo: "editar"; id: string }>(() => {
    const id = params.get("campania");
    return id ? { tipo: "detalle", id } : { tipo: "lista" };
  });
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/marketing/campanias", { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setDeshabilitado(d?.codigo === "marketing_deshabilitado"); setError(d?.error || "No se pudieron cargar las campañas."); return; }
      setLista(d as Lista);
      setError("");
    } catch {
      setError("Error de conexión.");
    }
  }, []);
  // Carga asíncrona inicial: los setState ocurren tras el await, no de forma
  // síncrona (falso positivo de react-hooks/set-state-in-effect, igual que en Colectivo).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void cargar(); }, [cargar]);
  const abrir = (id: string) => {
    setVista({ tipo: "detalle", id });
    const u = new URL(window.location.href);
    u.searchParams.set("campania", id);
    window.history.replaceState(null, "", u);
  };
  const aLista = () => {
    setVista({ tipo: "lista" });
    const u = new URL(window.location.href);
    u.searchParams.delete("campania");
    window.history.replaceState(null, "", u);
    void cargar();
  };

  if (deshabilitado && !lista) {
    return (
      <p role="status" className="rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-white/70">
        <span className="block text-lg font-black uppercase text-white">Deshabilitado</span>
        Las campañas de Marketing están apagadas en este entorno (<code className="text-white">MARKETING_CAMPANIAS_ENABLED</code>):
        no se preparan, no se ejecutan, no se generan beneficios y no se envía nada.
      </p>
    );
  }
  if (error && !lista) return <p className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 font-bold text-red-300">{error}</p>;
  if (!lista) return <p className="text-white/60">Cargando…</p>;
  const esAdmin = lista.rol === "admin";

  return (
    <>
      <div className="mb-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100">
        <p className="font-black uppercase tracking-[0.12em] text-amber-300">Simulación</p>
        <p className="mt-1">
          No se envía WhatsApp, no se crean códigos de descuento y no se cobra nada. Envíos, entregas y costos son simulados y los
          beneficios son ficticios (<code>SIMU-…</code>): no se pueden canjear en ninguna base.
        </p>
        <p className="mt-1 text-amber-200/80">{lista.entorno.escritura ? lista.entorno.motivo : `${lista.entorno.motivo} Guardar, preparar y ejecutar solo funciona en la base local de pruebas.`}</p>
      </div>
      <div className="mb-5 rounded-2xl border border-yellow-500/30 bg-yellow-950/10 p-4 text-sm text-yellow-100">
        <p className="font-black uppercase tracking-[0.12em] text-yellow-300">Decisiones pendientes antes de una campaña real</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Condiciones comerciales: tipo, valor y vigencia del beneficio. La propuesta de {PROPUESTA_SIN_APROBAR.beneficio_valor} % por {PROPUESTA_SIN_APROBAR.beneficio_vigencia_dias} días no está aprobada.</li>
          <li>Confirmación del control del teléfono: hoy el consentimiento se registra, pero nadie verifica que la persona controle ese número.</li>
        </ul>
      </div>
      {aviso && vista.tipo !== "detalle" && <p role="status" className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/90">{aviso}</p>}
      {!lista.instaladas && (
        <p className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          Las campañas no están instaladas en esta base (falta <code className="text-white">db/marketing-campanias.sql</code>). Se puede calcular la audiencia igual.
        </p>
      )}

      {vista.tipo === "nueva" && esAdmin && (
        <FormCampania inicial={formVacio()} campania={null} escritura={lista.entorno.escritura && lista.instaladas}
          alGuardar={(id, m) => { setAviso(m); abrir(id); void cargar(); }} alCancelar={aLista} />
      )}
      {vista.tipo === "editar" && esAdmin && (
        <EditarCampania id={vista.id} escritura={lista.entorno.escritura} alGuardar={(id, m) => { setAviso(m); abrir(id); }} alCancelar={() => abrir(vista.id)} />
      )}
      {vista.tipo === "detalle" && (
        <DetalleCampania key={vista.id} id={vista.id} avisoInicial={aviso} escritura={lista.entorno.escritura} alVolver={aLista} alEditar={() => setVista({ tipo: "editar", id: vista.id })} />
      )}
      {vista.tipo === "lista" && (
        <Seccion titulo="Campañas" accion={esAdmin && <button type="button" className={btnRojo} onClick={() => { setAviso(""); setVista({ tipo: "nueva" }); }}>Nueva campaña</button>}>
          {lista.campanias.length === 0 ? (
            <p className="text-sm text-white/50">Todavía no hay campañas{esAdmin ? ". Creá una para calcular su audiencia y simularla." : "."}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {lista.campanias.map((c) => (
                <button key={c.id} type="button" onClick={() => abrir(c.id)} className="rounded-2xl border border-white/10 bg-black p-4 text-left transition hover:border-red-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black">{c.nombre}</p>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${CHIP[c.estado]}`}>{ESTADOS_CAMPANIA[c.estado]}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-white/50">{c.objetivo}</p>
                  <p className="mt-2 text-xs text-white/60">
                    {c.conteos.preparados} preparados · {c.conteos.pendientes} pendientes · {c.conteos.entregados} entregados (sim.) · {c.conteos.fallidos + c.conteos.no_entregados} fallidos · {c.conteos.excluidos} excluidos
                  </p>
                  <p className="mt-1 text-[11px] text-white/35">Ventana {c.ventana_dias} días · creada {fecha(c.creada_en)}</p>
                </button>
              ))}
            </div>
          )}
        </Seccion>
      )}
    </>
  );
}

function EditarCampania({ id, escritura, alGuardar, alCancelar }: { id: string; escritura: boolean; alGuardar: (id: string, m: string) => void; alCancelar: () => void }) {
  const [c, setC] = useState<Campania | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/admin/marketing/campanias/${id}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok) setC((d as Detalle).campania);
    })();
  }, [id]);
  if (!c) return <p className="text-white/60">Cargando…</p>;
  return <FormCampania inicial={formDesde(c)} campania={{ id: c.id, version: c.version }} escritura={escritura} alGuardar={alGuardar} alCancelar={alCancelar} />;
}

function DetalleCampania({ id, avisoInicial, escritura, alVolver, alEditar }: { id: string; avisoInicial: string; escritura: boolean; alVolver: () => void; alEditar: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState(avisoInicial);
  const [ocupado, setOcupado] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  const [filtro, setFiltro] = useState<EstadoDestinatario | "todos">("todos");
  const detener = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/marketing/campanias/${id}`, { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setError(j?.error || "No se pudo cargar la campaña."); return null; }
      setD(j as Detalle);
      setError("");
      return j as Detalle;
    } catch {
      setError("Error de conexión.");
      return null;
    }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function accion(cuerpo: Record<string, unknown>, etiqueta: string): Promise<Record<string, unknown> | null> {
    setOcupado(etiqueta);
    setAviso("");
    try {
      const res = await fetch(`/api/admin/marketing/campanias/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setAviso(j?.error || "No se pudo completar."); return null; }
      return j as Record<string, unknown>;
    } catch {
      setAviso("Error de conexión. Es seguro volver a intentar: la base reconoce lo repetido.");
      return null;
    } finally {
      setOcupado("");
      await cargar();
    }
  }

  async function lote() {
    const r = await accion({ accion: "ejecutar_lote", tamano: LOTE_PANEL }, "lote");
    const l = r?.lote as Record<string, number | boolean | string> | undefined;
    if (l) setAviso(textoLote(l));
    return l;
  }

  async function hastaTerminar() {
    detener.current = false;
    setCorriendo(true);
    let vacios = 0;
    try {
      for (let i = 0; i < 200 && !detener.current; i++) {
        const l = await lote();
        if (!l || l.estado !== "ejecutando") break;
        // Sin nada para tomar ahora (reintentos con espera): esperar y seguir.
        if (Number(l.tomados) === 0) {
          if (++vacios > 30) break;
          await new Promise((r) => setTimeout(r, 2000));
        } else vacios = 0;
      }
    } finally {
      setCorriendo(false);
    }
  }

  if (error && !d) return <p className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 font-bold text-red-300">{error}</p>;
  if (!d) return <p className="text-white/60">Cargando…</p>;
  const c = d.campania;
  const k = d.conteos;
  const esAdmin = d.rol === "admin";
  const puede = esAdmin && escritura && !ocupado && !corriendo;
  const destinos = filtro === "todos" ? d.destinatarios : d.destinatarios.filter((x) => x.estado === filtro);
  const moneda = c.moneda ?? "";

  return (
    <>
      <Seccion titulo={c.nombre} accion={<button type="button" className={btnBorde} onClick={alVolver}>Volver a campañas</button>}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${CHIP[c.estado]}`}>{ESTADOS_CAMPANIA[c.estado]}</span>
          <Simulado />
          <span className="text-xs text-white/40">Creada {fecha(c.creada_en)}{c.preparada_en ? ` · preparada ${fecha(c.preparada_en)}` : ""}{c.iniciada_en ? ` · iniciada ${fecha(c.iniciada_en)}` : ""}{c.completada_en ? ` · completada ${fecha(c.completada_en)}` : ""}{c.cancelada_en ? ` · cancelada ${fecha(c.cancelada_en)}` : ""}</span>
        </div>
        <p className="mt-3 text-sm text-white/70">{c.objetivo}</p>
        <p className="mt-2 text-sm text-white/60">
          {describirBeneficio(c.beneficio_tipo, c.beneficio_valor)} · vence a los {c.beneficio_vigencia_dias ?? "—"} días · {describirProductos(c.productos)} ·
          ventana {c.ventana_dias} días · límite {c.limite_destinatarios ?? "sin límite"} · tarifa {c.tarifa ?? "—"} {moneda} · presupuesto {c.presupuesto_maximo ?? "sin tope"} {c.presupuesto_maximo !== null ? moneda : ""}
        </p>

        {esAdmin && (
          <div className="mt-4 flex flex-wrap gap-2">
            {c.estado === "borrador" && <>
              <button type="button" className={btnBorde} disabled={!puede} onClick={alEditar}>Editar</button>
              <button type="button" className={btnRojo} disabled={!puede} onClick={() => void accion({ accion: "preparar", version: c.version }, "preparar").then((r) => r && setAviso(r.repetida ? "Ya estaba preparada." : "Preparada: audiencia fijada y beneficios ficticios generados."))}>
                {ocupado === "preparar" ? "Preparando…" : "Preparar"}
              </button>
            </>}
            {c.estado === "preparada" && <button type="button" className={btnRojo} disabled={!puede} onClick={() => void accion({ accion: "iniciar" }, "iniciar")}>Iniciar simulación</button>}
            {c.estado === "ejecutando" && <>
              <button type="button" className={btnRojo} disabled={!puede} onClick={() => void lote()}>{ocupado === "lote" && !corriendo ? "Ejecutando…" : "Ejecutar un lote"}</button>
              {!corriendo
                ? <button type="button" className={btnBorde} disabled={!puede} onClick={() => void hastaTerminar()}>Ejecutar hasta terminar</button>
                : <button type="button" className={btnBorde} onClick={() => { detener.current = true; }}>Detener (queda donde está)</button>}
              <button type="button" className={btnBorde} disabled={!puede} onClick={() => void accion({ accion: "pausar" }, "pausar")}>Pausar</button>
            </>}
            {c.estado === "pausada" && <button type="button" className={btnRojo} disabled={!puede} onClick={() => void accion({ accion: "reanudar" }, "reanudar")}>Reanudar</button>}
            {["preparada", "ejecutando", "pausada"].includes(c.estado) && (
              <button type="button" className={btnBorde} disabled={!puede}
                onClick={() => { if (window.confirm(`¿Cancelar los pendientes de "${c.nombre}"?\n\nLos ${k.pendientes} pendientes pasan a "cancelado". No se borra nada: el historial queda.`)) void accion({ accion: "cancelar" }, "cancelar"); }}>
                Cancelar pendientes
              </button>
            )}
          </div>
        )}
        {esAdmin && !escritura && <p className="mt-2 text-xs text-white/40">En esta base no se ejecutan campañas: solo en la local de pruebas.</p>}
        {corriendo && <p className="mt-3 text-sm font-bold text-green-300">Ejecutando lotes… cerrar la pestaña no pierde nada: el progreso está en la base.</p>}
        {aviso && <p role="status" className="mt-3 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/90">{aviso}</p>}
      </Seccion>

      {c.estado !== "borrador" && (
        <Seccion titulo="Resultados" accion={<Simulado />}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tarjeta titulo="Preparados" valor={String(k.preparados)} nota="Destinatarios con beneficio ficticio" />
            <Tarjeta titulo="Pendientes" valor={String(k.pendientes + k.enviando)} nota={k.enviando ? `${k.enviando} en envío` : "Por enviar"} />
            <Tarjeta titulo="Excluidos" valor={String(k.excluidos)} nota="Revisados antes de enviar" />
            <Tarjeta titulo="Aceptados (sim.)" valor={String(k.aceptados)} nota="El proveedor simulado los recibió" />
            <Tarjeta titulo="Entregados (sim.)" valor={String(k.entregados)} nota={`${k.no_entregados} no entregados`} />
            <Tarjeta titulo="Fallidos" valor={String(k.fallidos)} nota={Object.entries(k.fallidos_por_motivo).map(([m, n]) => `${MOTIVOS_DESTINATARIO[m] ?? m}: ${n}`).join(" · ") || "—"} />
            <Tarjeta titulo="Inciertos" valor={String(k.inciertos)} nota="No se reenvían solos" alerta={k.inciertos > 0} />
            <Tarjeta titulo="Cancelados" valor={String(k.cancelados)} nota="Pendientes al cancelar" />
            <Tarjeta titulo="Costo (sim.)" valor={`${moneda} ${dinero(k.costo_simulado)}`} nota={`Máximo previsto ${moneda} ${dinero(c.costo_maximo ?? 0)}`} />
            <Tarjeta titulo="Atribución" valor={`${d.atribucion.reservas_pagadas + d.atribucion.gift_cards_pagadas}`}
              nota={`Reservas ${d.atribucion.reservas_pagadas} · Gift Cards ${d.atribucion.gift_cards_pagadas} · regresos al stand ${d.atribucion.regresos_stand}`} />
          </div>
          {Object.keys(k.excluidos_por_motivo).length > 0 && (
            <p className="mt-3 text-xs text-white/60">Excluidos: {Object.entries(k.excluidos_por_motivo).map(([m, n]) => `${MOTIVOS_DESTINATARIO[m] ?? m} ${n}`).join(" · ")}</p>
          )}
          <p className="mt-3 text-xs text-white/40">
            Atribución: compra pagada con el cupón del destinatario (reserva web o Gift Card, por separado) y regreso al stand (turno con el mismo
            teléfono desde el día del envío). Con beneficios ficticios no puede haber compras: {d.atribucion.ficticios} ficticios, {d.atribucion.con_cupon_real} con cupón real.
          </p>
        </Seccion>
      )}

      {c.audiencia && (
        <Seccion titulo="Audiencia fijada al preparar">
          <ResumenAudiencia r={c.audiencia} />
          {c.audiencia.al_preparar && (
            <p className="mt-3 text-xs text-white/50">
              Al preparar se volvió a revisar: {c.audiencia.al_preparar.preparados} preparados de {c.audiencia.al_preparar.recibidos} · sin consentimiento en ese momento {c.audiencia.al_preparar.sin_consentimiento} · en otra campaña {c.audiencia.al_preparar.en_otra_campania}.
            </p>
          )}
        </Seccion>
      )}

      {c.estado !== "borrador" && (
        <Seccion titulo="Destinatarios" accion={
          <select className="rounded-xl border border-white/15 bg-black px-3 py-2 text-sm font-bold text-white" value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoDestinatario | "todos")}>
            <option value="todos">Todos ({d.destinatarios.length})</option>
            {(Object.keys(ESTADOS_DESTINATARIO) as EstadoDestinatario[]).map((s) => {
              const n = d.destinatarios.filter((x) => x.estado === s).length;
              return n ? <option key={s} value={s}>{ESTADOS_DESTINATARIO[s]} ({n})</option> : null;
            })}
          </select>
        }>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs font-black uppercase tracking-[0.12em] text-white/35">
                <tr><th className="px-2 py-2">#</th><th className="px-2 py-2">Teléfono</th><th className="px-2 py-2">Beneficio ficticio</th><th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Intentos</th><th className="px-2 py-2">Detalle</th><th className="px-2 py-2">Última novedad</th><th className="px-2 py-2" /></tr>
              </thead>
              <tbody>
                {destinos.slice(0, 300).map((x) => (
                  <tr key={x.id} className="border-t border-white/10">
                    <td className="px-2 py-2 text-white/40">{x.orden}</td>
                    <td className="px-2 py-2 font-mono text-white/80">{x.telefono}</td>
                    <td className="px-2 py-2 font-mono text-xs text-white/60">{x.beneficio_codigo}</td>
                    <td className={`px-2 py-2 font-black ${COLOR_DEST[x.estado] ?? "text-white/80"}`}>{ESTADOS_DESTINATARIO[x.estado]}</td>
                    <td className="px-2 py-2 text-white/60">{x.intentos}</td>
                    <td className="px-2 py-2 text-xs text-white/55">
                      {x.motivo ? MOTIVOS_DESTINATARIO[x.motivo] ?? x.motivo : "—"}{x.ultimo_codigo ? ` · ${x.ultimo_codigo}` : ""}
                      {x.proximo_intento_en ? ` · reintento ${fecha(x.proximo_intento_en)}` : ""}
                    </td>
                    <td className="px-2 py-2 text-xs text-white/45">{fecha(x.entregado_en ?? x.terminado_en ?? x.aceptado_en)}</td>
                    <td className="px-2 py-2">
                      {x.estado === "incierto" && esAdmin && escritura && (
                        <div className="flex gap-1">
                          <button type="button" className="rounded-lg border border-white/20 px-2 py-1 text-[11px] font-black uppercase text-white/80 disabled:opacity-40" disabled={!puede}
                            onClick={() => { if (window.confirm("¿Volver a enviar?\n\nSi el primer envío en realidad salió, la persona recibiría el mensaje dos veces.")) void accion({ accion: "resolver_incierto", destinatario_id: x.id, decision: "reintentar" }, "incierto"); }}>
                            Reintentar
                          </button>
                          <button type="button" className="rounded-lg border border-white/20 px-2 py-1 text-[11px] font-black uppercase text-white/60 disabled:opacity-40" disabled={!puede}
                            onClick={() => void accion({ accion: "resolver_incierto", destinatario_id: x.id, decision: "fallido" }, "incierto")}>
                            Dar por fallido
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-white/40">Teléfonos enmascarados y sin nombres. Los beneficios SIMU- son ficticios: no existen como códigos de descuento.</p>
        </Seccion>
      )}

      <Seccion titulo="Mensaje y condiciones">
        <div className="grid gap-4 md:grid-cols-2">
          <p className="whitespace-pre-wrap rounded-xl bg-[#0b3d2e] p-3 text-sm leading-6">{d.mensaje_ejemplo}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-white/75">{d.condiciones.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <Capacidades lista={d.capacidades} />
      </Seccion>

      <Seccion titulo="Historial">
        {d.eventos.length === 0 ? <p className="text-sm text-white/50">Sin movimientos.</p> : (
          <ul className="space-y-1 text-sm">
            {d.eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 border-t border-white/10 pt-1">
                <span className="text-white/45">{fecha(e.creado_en)}</span>
                <span className="font-black uppercase text-white/80">{e.tipo.replace(/_/g, " ")}</span>
                <span className="text-white/45">{e.actor}</span>
                <span className="text-xs text-white/50">{Object.entries(e.detalle).filter(([kk]) => kk !== "ejecutor").map(([kk, v]) => `${kk.replace(/_/g, " ")}: ${String(v)}`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </>
  );
}

/** Importes de la tarifa: al menos 2 decimales (las tarifas de Meta llegan a 4). */
const dinero = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function textoLote(l: Record<string, number | boolean | string>): string {
  if (l.estado !== "ejecutando" && Number(l.tomados) === 0 && !l.completada) return `La campaña está ${ESTADOS_CAMPANIA[l.estado as EstadoCampania]?.toLowerCase() ?? l.estado}: no se tomó nada.`;
  const e = l.entregas as unknown as { entregados: number; no_entregados: number };
  const x = l.excluidos as unknown as { baja_posterior: number; sin_consentimiento: number; sin_cupo: number };
  const partes = [
    `Lote: ${l.tomados} tomados`, `${l.aceptados} aceptados (sim.)`, `${l.transitorios} a reintentar`, `${l.fallidos} fallidos`, `${l.inciertos} inciertos`,
    `entregas simuladas ${e.entregados}/${e.entregados + e.no_entregados}`,
  ];
  if (x.baja_posterior + x.sin_consentimiento + x.sin_cupo) partes.push(`excluidos ${x.baja_posterior + x.sin_consentimiento + x.sin_cupo}`);
  if (Number(l.interrumpidos)) partes.push(`${l.interrumpidos} interrumpidos → inciertos`);
  if (l.completada) partes.push("campaña completada");
  return partes.join(" · ");
}
