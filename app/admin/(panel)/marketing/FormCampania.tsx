"use client";

import { useMemo, useRef, useState } from "react";
import { hoyEnSim } from "@/lib/agenda";
import {
  LIMITES_CAMPANIA,
  MOTIVOS_AUDIENCIA,
  PRODUCTOS_CAMPANIA,
  PROPUESTA_SIN_APROBAR,
  SIMULACION_POR_DEFECTO,
  TIPOS_BENEFICIO,
  VARIABLES_MENSAJE,
  capacidadesCodigos,
  renderizarMensaje,
  valoresMensaje,
  variablesDelMensaje,
  type Capacidad,
  type DatosCampania,
  type ProductoCampania,
  type SimulacionProveedor,
  type TipoBeneficio,
} from "@/lib/marketing/campanias";
import { Campo, Seccion, Simulado, Tarjeta, btnBorde, btnRojo, fecha, inp } from "./ui";

// Marketing · formulario de una campaña (borrador) y su vista previa de audiencia.
// La vista previa no escribe nada; guardar solo funciona en la base local de
// pruebas (lo decide el servidor). Los valores comerciales arrancan VACÍOS: el
// 15 % y los 7 días son una propuesta sin aprobar y solo se cargan a mano.

export type Form = {
  nombre: string; objetivo: string; ventana_dias: 14 | 21; solo_pagos: boolean; excluir_retornados: boolean;
  excluir_mensualidades: boolean; indicativos: string; mensaje: string; productos: ProductoCampania[];
  beneficio_tipo: TipoBeneficio | ""; beneficio_valor: string; beneficio_vigencia_dias: string;
  limite_destinatarios: string; tarifa: string; moneda: string; presupuesto_maximo: string; simulacion: SimulacionProveedor;
};

export const MENSAJE_SUGERIDO =
  "Hola {nombre}! Te extrañamos en SIM. Tenés {beneficio} con el código {codigo}, válido hasta el {vence} para {productos}. Si no querés recibir más promociones: {baja}";

export function formVacio(): Form {
  return {
    nombre: "", objetivo: "", ventana_dias: 14, solo_pagos: true, excluir_retornados: false, excluir_mensualidades: false,
    indicativos: "", mensaje: MENSAJE_SUGERIDO, productos: ["gift_card", "reserva"],
    beneficio_tipo: "", beneficio_valor: "", beneficio_vigencia_dias: "",
    limite_destinatarios: "", tarifa: "", moneda: "USD", presupuesto_maximo: "", simulacion: { ...SIMULACION_POR_DEFECTO },
  };
}

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
export function formDesde(c: DatosCampania): Form {
  return {
    nombre: c.nombre, objetivo: c.objetivo, ventana_dias: c.ventana_dias, solo_pagos: c.solo_pagos, excluir_retornados: c.excluir_retornados,
    excluir_mensualidades: c.excluir_mensualidades, indicativos: c.indicativos.join(", "), mensaje: c.mensaje, productos: [...c.productos],
    beneficio_tipo: c.beneficio_tipo ?? "", beneficio_valor: txt(c.beneficio_valor), beneficio_vigencia_dias: txt(c.beneficio_vigencia_dias),
    limite_destinatarios: txt(c.limite_destinatarios), tarifa: txt(c.tarifa), moneda: c.moneda ?? "", presupuesto_maximo: txt(c.presupuesto_maximo),
    simulacion: { ...SIMULACION_POR_DEFECTO, ...c.simulacion },
  };
}

function aDatos(f: Form) {
  return {
    ...f,
    indicativos: f.indicativos,
    beneficio_tipo: f.beneficio_tipo || null,
    beneficio_valor: f.beneficio_valor, beneficio_vigencia_dias: f.beneficio_vigencia_dias,
    limite_destinatarios: f.limite_destinatarios, tarifa: f.tarifa, presupuesto_maximo: f.presupuesto_maximo,
  };
}

type ResumenVP = {
  calculado_en: string; hoy: string; ventana: { dias: number; desde: string; hasta: string };
  filtros: { solo_pagos: boolean; excluir_retornados: boolean; excluir_mensualidades: boolean; indicativos: string[] };
  lectura: { filas: number; esperado: number; consistente: boolean };
  filas: { en_ventana: number; validas: number; excluidas: Record<string, number> };
  candidatos: number; elegibles: number; pendientes_consentimiento: number; excluidos: Record<string, number>; sin_indicativo: number;
  seleccionados: number; recortado_por: string[]; costo: { tarifa: number; moneda: string; maximo: number } | null;
  consentimiento: { registro_instalado: boolean; registrados: number; bajas: number; elegibles_por_fuente: Record<string, number>; control_telefono_verificado: number };
  advertencias: string[];
};
export type VistaPreviaDto = ResumenVP & {
  muestra: { telefono: string; indicativo: string | null; ultima_visita: string; visitas: number }[];
  mensaje: { plantilla: string; ejemplo: string; variables: string[]; advertencias: string[] };
  condiciones: string[]; capacidades: Capacidad[]; faltan_para_preparar: string[]; beneficio: string;
};

export default function FormCampania({ inicial, campania, escritura, alGuardar, alCancelar }: {
  inicial: Form;
  campania: { id: string; version: number } | null;
  escritura: boolean;
  alGuardar: (id: string, mensaje: string) => void;
  alCancelar: () => void;
}) {
  const [f, setF] = useState<Form>(inicial);
  const [errores, setErrores] = useState<{ campo: string; error: string }[]>([]);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState<"" | "vista" | "guardar">("");
  const [vp, setVp] = useState<VistaPreviaDto | null>(null);
  const clave = useRef<string>(crypto.randomUUID());
  const mensajeRef = useRef<HTMLTextAreaElement>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setVp(null); };
  const errorDe = (campo: string) => errores.filter((e) => e.campo === campo).map((e) => e.error).join(" ");
  const esPropuesta = f.beneficio_tipo === PROPUESTA_SIN_APROBAR.beneficio_tipo
    && Number(f.beneficio_valor) === PROPUESTA_SIN_APROBAR.beneficio_valor
    && Number(f.beneficio_vigencia_dias) === PROPUESTA_SIN_APROBAR.beneficio_vigencia_dias;
  const vars = variablesDelMensaje(f.mensaje);
  const ejemplo = useMemo(() => renderizarMensaje(f.mensaje, valoresMensaje({
    beneficio_tipo: f.beneficio_tipo || null, beneficio_valor: f.beneficio_valor === "" ? null : Number(f.beneficio_valor),
    beneficio_vigencia_dias: f.beneficio_vigencia_dias === "" ? null : Number(f.beneficio_vigencia_dias), productos: f.productos,
  }, { nombre: "Nombre de ejemplo", codigo: "SIMU-XXXXXXXX" }, hoyEnSim())), [f.mensaje, f.beneficio_tipo, f.beneficio_valor, f.beneficio_vigencia_dias, f.productos]);
  const capacidades = capacidadesCodigos(f.productos);

  function insertarVariable(clave: string) {
    const el = mensajeRef.current;
    const token = `{${clave}}`;
    if (!el) { set("mensaje", f.mensaje + token); return; }
    const a = el.selectionStart ?? f.mensaje.length;
    const b = el.selectionEnd ?? a;
    set("mensaje", f.mensaje.slice(0, a) + token + f.mensaje.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  }

  async function enviar(accion: "vista_previa" | "guardar") {
    setOcupado(accion === "guardar" ? "guardar" : "vista");
    setErrores([]);
    setAviso("");
    try {
      const res = await fetch("/api/admin/marketing/campanias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, datos: aDatos(f), id: campania?.id ?? null, version: campania?.version ?? null, clave: campania ? null : clave.current }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        if (d?.errores) setErrores(d.errores);
        setAviso(d?.error || "No se pudo completar.");
        return;
      }
      if (accion === "vista_previa") { setVp(d.vista_previa as VistaPreviaDto); return; }
      alGuardar(d.campania.id, d.repetida ? "Ya estaba guardada (mismo pedido)." : "Borrador guardado.");
    } catch {
      setAviso("Error de conexión. Es seguro volver a intentar.");
    } finally {
      setOcupado("");
    }
  }

  const num = (k: keyof Form, etiqueta: string, ayuda?: React.ReactNode, placeholder = "") => (
    <Campo etiqueta={etiqueta} ayuda={errorDe(k) ? <span className="font-bold text-red-300">{errorDe(k)}</span> : ayuda}>
      <input className={inp} inputMode="decimal" value={f[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </Campo>
  );

  return (
    <>
      <Seccion titulo={campania ? "Editar borrador" : "Nueva campaña"} accion={<Simulado />}>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Nombre" ayuda={errorDe("nombre") && <span className="font-bold text-red-300">{errorDe("nombre")}</span>}>
            <input className={inp} value={f.nombre} maxLength={LIMITES_CAMPANIA.nombre[1]} onChange={(e) => set("nombre", e.target.value)} placeholder="Recuperación stand octubre" />
          </Campo>
          <Campo etiqueta="Objetivo" ayuda={errorDe("objetivo") && <span className="font-bold text-red-300">{errorDe("objetivo")}</span>}>
            <input className={inp} value={f.objetivo} maxLength={LIMITES_CAMPANIA.objetivo[1]} onChange={(e) => set("objetivo", e.target.value)} placeholder="Que vuelvan quienes vinieron hace 2 o 3 semanas" />
          </Campo>
        </div>

        <h3 className="mt-6 mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/50">Audiencia</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Campo etiqueta="Ventana de visitas">
            <div className="flex gap-2">
              {([14, 21] as const).map((v) => (
                <button key={v} type="button" onClick={() => set("ventana_dias", v)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-black ${f.ventana_dias === v ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/70"}`}>
                  {v} días
                </button>
              ))}
            </div>
          </Campo>
          <Campo etiqueta="Indicativos (opcional)" ayuda={errorDe("indicativos") ? <span className="font-bold text-red-300">{errorDe("indicativos")}</span> : "Oficiales y completos, separados por coma. Vacío = todo el país."}>
            <input className={inp} value={f.indicativos} onChange={(e) => set("indicativos", e.target.value)} placeholder="351, 3543" inputMode="numeric" />
          </Campo>
          <div className="space-y-2 pt-5 text-sm">
            <Check v={f.solo_pagos} on={(v) => set("solo_pagos", v)} t="Solo turnos pagos" />
            <Check v={f.excluir_retornados} on={(v) => set("excluir_retornados", v)} t="Excluir a quien ya volvió (2+ días)" />
            <Check v={f.excluir_mensualidades} on={(v) => set("excluir_mensualidades", v)} t="Excluir titulares de mensualidad" />
          </div>
        </div>
        <p className="mt-2 text-xs text-white/40">
          Siempre: un destinatario por teléfono normalizado, fecha de Argentina (hoy fuera de la ventana), y solo con consentimiento registrado y sin baja.
        </p>

        <h3 className="mt-6 mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/50">Mensaje</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <textarea ref={mensajeRef} className={`${inp} min-h-[150px] font-medium leading-6`} value={f.mensaje} maxLength={LIMITES_CAMPANIA.mensaje[1]}
              onChange={(e) => set("mensaje", e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VARIABLES_MENSAJE.map((v) => (
                <button key={v.clave} type="button" title={v.descripcion} onClick={() => insertarVariable(v.clave)}
                  className={`rounded-lg border px-2 py-1 font-mono text-xs ${vars.usadas.includes(v.clave) ? "border-green-500/50 text-green-300" : "border-white/15 text-white/60"}`}>
                  {`{${v.clave}}`}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-white/40">{f.mensaje.length}/{LIMITES_CAMPANIA.mensaje[1]} caracteres · tocá una variable para insertarla.</p>
            {(errorDe("mensaje") || vars.desconocidas.length > 0) && <p className="mt-1 text-xs font-bold text-red-300">{errorDe("mensaje") || `Variables no admitidas: ${vars.desconocidas.join(", ")}`}</p>}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black p-4">
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Así lo leería un destinatario <Simulado /></p>
            <p className="whitespace-pre-wrap rounded-xl bg-[#0b3d2e] p-3 text-sm leading-6 text-white">{ejemplo}</p>
            <p className="mt-2 text-xs text-white/40">Con datos de ejemplo: nunca el nombre ni el teléfono de una persona.</p>
          </div>
        </div>

        <h3 className="mt-6 mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/50">Beneficio</h3>
        <div className="mb-3 rounded-2xl border border-yellow-500/30 bg-yellow-950/10 p-3 text-xs text-yellow-200">
          Condiciones comerciales <strong>sin aprobar</strong>. Hay una propuesta en estudio ({PROPUESTA_SIN_APROBAR.beneficio_valor} % durante {PROPUESTA_SIN_APROBAR.beneficio_vigencia_dias} días) que no es una condición vigente.
          <button type="button" className="ml-2 underline" onClick={() => setF((x) => ({ ...x, beneficio_tipo: PROPUESTA_SIN_APROBAR.beneficio_tipo, beneficio_valor: String(PROPUESTA_SIN_APROBAR.beneficio_valor), beneficio_vigencia_dias: String(PROPUESTA_SIN_APROBAR.beneficio_vigencia_dias) }))}>
            Cargar la propuesta para simular
          </button>
          {esPropuesta && <span className="ml-2 rounded-md bg-yellow-500/20 px-1.5 py-0.5 font-black uppercase">propuesta sin aprobar</span>}
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Campo etiqueta="Tipo" ayuda={errorDe("beneficio_tipo") && <span className="font-bold text-red-300">{errorDe("beneficio_tipo")}</span>}>
            <select className={inp} value={f.beneficio_tipo} onChange={(e) => set("beneficio_tipo", e.target.value as TipoBeneficio | "")}>
              <option value="">Sin definir</option>
              {TIPOS_BENEFICIO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
            </select>
          </Campo>
          {num("beneficio_valor", f.beneficio_tipo === "monto_fijo" ? "Monto ($)" : "Porcentaje (%)")}
          {num("beneficio_vigencia_dias", "Vence a los (días)", "Desde el día del envío.")}
          <Campo etiqueta="Productos alcanzados" ayuda={errorDe("productos") && <span className="font-bold text-red-300">{errorDe("productos")}</span>}>
            <div className="space-y-1 pt-1 text-sm">
              {PRODUCTOS_CAMPANIA.map((p) => (
                <Check key={p.valor} v={f.productos.includes(p.valor)} t={p.etiqueta}
                  on={(v) => set("productos", v ? [...new Set([...f.productos, p.valor])] : f.productos.filter((x) => x !== p.valor))} />
              ))}
            </div>
          </Campo>
        </div>
        <Capacidades lista={capacidades} />

        <h3 className="mt-6 mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/50">Topes y costo</h3>
        <div className="grid gap-4 md:grid-cols-4">
          {num("limite_destinatarios", "Límite de destinatarios", "Vacío = sin límite.")}
          {num("tarifa", "Tarifa de referencia", "Por mensaje entregado, del tarifario oficial vigente.", "0.0000")}
          <Campo etiqueta="Moneda" ayuda={errorDe("moneda") && <span className="font-bold text-red-300">{errorDe("moneda")}</span>}>
            <input className={inp} value={f.moneda} maxLength={3} onChange={(e) => set("moneda", e.target.value.toUpperCase())} placeholder="USD" />
          </Campo>
          {num("presupuesto_maximo", "Presupuesto máximo", "En la moneda de la tarifa. Vacío = sin tope.")}
        </div>

        <details className="mt-6 rounded-2xl border border-white/10 bg-black p-4">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-white/50">Proveedor simulado (qué le pasa a cada envío)</summary>
          <p className="mt-2 text-xs text-white/40">Determinístico por teléfono: la misma campaña da siempre el mismo resultado. No hay WhatsApp real.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-4">
            {([
              ["fallo_definitivo_pct", "Error definitivo (%)"], ["fallo_transitorio_pct", "Transitorio, 1.er intento (%)"],
              ["incierto_pct", "Sin respuesta, 1.er intento (%)"], ["no_entregado_pct", "No entregado (%)"],
            ] as const).map(([k, t]) => (
              <Campo key={k} etiqueta={t}>
                <input className={inp} inputMode="numeric" value={String(f.simulacion[k])}
                  onChange={(e) => set("simulacion", { ...f.simulacion, [k]: Number(e.target.value.replace(/\D/g, "") || 0) })} />
              </Campo>
            ))}
          </div>
          {errorDe("simulacion") && <p className="mt-2 text-xs font-bold text-red-300">{errorDe("simulacion")}</p>}
        </details>

        {aviso && <p role="alert" className="mt-4 rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">{aviso}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className={btnBorde} disabled={!!ocupado} onClick={() => void enviar("vista_previa")}>
            {ocupado === "vista" ? "Calculando…" : "Calcular audiencia"}
          </button>
          <button type="button" className={btnRojo} disabled={!!ocupado || !escritura} title={escritura ? undefined : "Solo en la base local de pruebas"}
            onClick={() => void enviar("guardar")}>
            {ocupado === "guardar" ? "Guardando…" : "Guardar borrador"}
          </button>
          <button type="button" className={btnBorde} disabled={!!ocupado} onClick={alCancelar}>Volver</button>
        </div>
        {!escritura && <p className="mt-2 text-xs text-white/40">En esta base se puede calcular la audiencia, pero no guardar: las campañas se guardan y ejecutan solo en la base local de pruebas.</p>}
      </Seccion>

      {vp && <VistaPrevia vp={vp} />}
    </>
  );
}

function Check({ v, on, t }: { v: boolean; on: (v: boolean) => void; t: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-white/80">
      <input type="checkbox" className="h-4 w-4 accent-red-600" checked={v} onChange={(e) => on(e.target.checked)} />
      {t}
    </label>
  );
}

export function Capacidades({ lista }: { lista: Capacidad[] }) {
  const color = { aplicada: "text-green-400", parcial: "text-yellow-300", no_aplicada: "text-red-400" } as const;
  const texto = { aplicada: "Se hace cumplir", parcial: "Parcial", no_aplicada: "No se hace cumplir" } as const;
  return (
    <details className="mt-4 rounded-2xl border border-white/10 bg-black p-4" open>
      <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.18em] text-white/50">Qué hace cumplir hoy el módulo de Códigos</summary>
      <div className="mt-3 divide-y divide-white/10">
        {lista.map((c) => (
          <div key={c.restriccion} className="grid gap-1 py-2 text-sm md:grid-cols-[220px_150px_1fr]">
            <span className="font-bold text-white/85">{c.restriccion}</span>
            <span className={`text-xs font-black uppercase ${color[c.estado]}`}>{texto[c.estado]}</span>
            <span className="text-xs text-white/55">{c.detalle}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

const dinero = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function ResumenAudiencia({ r }: { r: ResumenVP }) {
  const exclusiones = Object.entries(r.excluidos).filter(([, n]) => n > 0);
  const filas = Object.entries(r.filas.excluidas).filter(([, n]) => n > 0);
  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Tarjeta titulo="Candidatos" valor={String(r.candidatos)} nota={`Teléfonos únicos con visita en ${r.ventana.desde.slice(8)}/${r.ventana.desde.slice(5, 7)}–${r.ventana.hasta.slice(8)}/${r.ventana.hasta.slice(5, 7)}`} />
        <Tarjeta titulo="Elegibles" valor={String(r.elegibles)} nota="Con consentimiento registrado y sin baja" alerta={r.elegibles === 0} />
        <Tarjeta titulo="Seleccionados" valor={String(r.seleccionados)}
          nota={r.recortado_por.length ? `Recortado por ${r.recortado_por.map((x) => (x === "limite" ? "límite" : "presupuesto")).join(" y ")}` : "Después de los topes"} />
        <Tarjeta titulo="Costo estimado" valor={r.costo ? `${r.costo.moneda} ${dinero(r.costo.maximo)}` : "Sin tarifa"}
          nota={r.costo ? `Si se entregan todos · tarifa ${dinero(r.costo.tarifa)} por entregado` : "Cargá la tarifa de referencia"} />
      </div>
      {r.elegibles === 0 && (
        <p className="mt-3 rounded-2xl border border-yellow-500/30 bg-yellow-950/10 p-3 text-sm text-yellow-200">
          No hay destinatarios elegibles: {r.consentimiento.registrados === 0 ? "no hay consentimientos registrados" : "nadie de la ventana tiene consentimiento vigente"}.
          {r.pendientes_consentimiento > 0 && ` ${r.pendientes_consentimiento} pasarían los demás filtros si se registrara su consentimiento; no se les escribe.`}
        </p>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Exclusiones por motivo</p>
          {exclusiones.length + filas.length === 0 ? <p className="text-white/50">Ninguna.</p> : (
            <ul className="space-y-1">
              {exclusiones.map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span className="text-white/70">{MOTIVOS_AUDIENCIA[k] ?? k}</span><span className="font-black">{n}</span></li>)}
              {filas.map(([k, n]) => <li key={`f-${k}`} className="flex justify-between gap-3"><span className="text-white/50">{MOTIVOS_AUDIENCIA[k] ?? k} (turnos)</span><span className="font-bold text-white/70">{n}</span></li>)}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Filtros y cálculo</p>
          <ul className="space-y-1 text-white/70">
            <li>Calculado: {fecha(r.calculado_en)} · hoy (Argentina) {r.hoy.slice(8)}/{r.hoy.slice(5, 7)}</li>
            <li>Ventana: {r.ventana.dias} días · {r.lectura.filas} turnos leídos (conteo {r.lectura.esperado})</li>
            <li>Solo pagos: {r.filtros.solo_pagos ? "sí" : "no"} · ya volvió: {r.filtros.excluir_retornados ? "excluido" : "incluido"} · mensualidades: {r.filtros.excluir_mensualidades ? "excluidas" : "incluidas"}</li>
            <li>Indicativos: {r.filtros.indicativos.length ? r.filtros.indicativos.join(", ") : "todos"} · sin indicativo determinable: {r.sin_indicativo}</li>
          </ul>
          <p className="mt-3 mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Consentimiento y teléfono</p>
          <ul className="space-y-1 text-white/70">
            <li>Consentimiento registrado: {r.consentimiento.registrados} en el registro{Object.keys(r.consentimiento.elegibles_por_fuente).length ? ` · elegibles por fuente: ${Object.entries(r.consentimiento.elegibles_por_fuente).map(([k, n]) => `${k} ${n}`).join(" · ")}` : ""}</li>
            <li className="text-yellow-200">Control del teléfono verificado: {r.consentimiento.control_telefono_verificado} — no existe la verificación; es una decisión pendiente antes de una campaña real.</li>
          </ul>
        </div>
      </div>
      {r.advertencias.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-yellow-200">{r.advertencias.map((a) => <li key={a}>{a}</li>)}</ul>}
    </>
  );
}

function VistaPrevia({ vp }: { vp: VistaPreviaDto }) {
  return (
    <Seccion titulo="Vista previa de la audiencia" accion={<span className="text-xs text-white/40">Solo lectura: no se guardó nada</span>}>
      <ResumenAudiencia r={vp} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Mensaje que recibiría <Simulado /></p>
          <p className="whitespace-pre-wrap rounded-xl bg-[#0b3d2e] p-3 text-sm leading-6">{vp.mensaje.ejemplo}</p>
          {vp.mensaje.advertencias.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-yellow-200">{vp.mensaje.advertencias.map((a) => <li key={a}>{a}</li>)}</ul>}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4 text-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Condiciones que recibiría</p>
          <ul className="list-disc space-y-1 pl-5 text-white/75">{vp.condiciones.map((c) => <li key={c}>{c}</li>)}</ul>
          {vp.faltan_para_preparar.length > 0 && <p className="mt-3 text-xs font-bold text-yellow-200">Para preparar falta: {vp.faltan_para_preparar.join(", ")}.</p>}
        </div>
      </div>
      {vp.muestra.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Muestra de seleccionados (enmascarados)</p>
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs uppercase text-white/35"><tr><th className="px-2 py-1">Teléfono</th><th className="px-2 py-1">Indicativo</th><th className="px-2 py-1">Última visita</th><th className="px-2 py-1">Turnos</th></tr></thead>
            <tbody>{vp.muestra.map((m) => (
              <tr key={m.telefono + m.ultima_visita} className="border-t border-white/10">
                <td className="px-2 py-1 font-mono">{m.telefono}</td><td className="px-2 py-1">{m.indicativo ?? "—"}</td>
                <td className="px-2 py-1">{m.ultima_visita.slice(8)}/{m.ultima_visita.slice(5, 7)}</td><td className="px-2 py-1">{m.visitas}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}
