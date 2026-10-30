"use client";

// CRM B3 · «Registrar venta» desde una oportunidad abierta (solo Administración).
// Una sola operación registra la venta (con la foto de las condiciones) y pasa la
// oportunidad a «Ganado»; se cancelan sus próximas acciones y el historial queda.
// La comisión se propone según la regla (lib/crmB3.ts: comisionPropuesta) y todo lo
// que se aparte de ella se confirma explícitamente; la base valida de nuevo.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Aviso, Boton, Cargando, Chips, cx } from "@/app/admin/(panel)/interacciones/ui";
import { pedir } from "./api";
import { INPUT, fechaCorta, fechaHora } from "./campos";
import { CampoImporte, MENSAJE_INCIERTO, deCentavos, useEnvio } from "./ventasCampos";
import {
  FUNDAMENTOS, anticipoEsperado, formatoPesos, leerImporte, requiereConfirmarComision, requiereConfirmarImporte,
  type CodigoProducto, type Fundamento, type TipoComision,
} from "@/lib/crmB3";
import type { FormularioVentaDto, ResultadoVenta } from "@/lib/crmB3Server";

const API = "/api/admin/crm";

export default function RegistrarVenta({ oportunidadId, onCancelar, onRegistrada }: {
  oportunidadId: string; onCancelar: () => void; onRegistrada: (ventaId: string, repetida: boolean) => void;
}) {
  const [d, setD] = useState<FormularioVentaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vivo = true;
    pedir<FormularioVentaDto>(`${API}/oportunidades/${oportunidadId}/venta`).then((r) => {
      if (!vivo) return;
      if (r.ok) { setD(r.data); setError(null); } else setError(r.error);
    });
    return () => { vivo = false; };
  }, [oportunidadId, recarga]);
  if (!d) return error ? <Aviso tipo="error">{error}</Aviso> : <Cargando />;
  return <Formulario key={`${d.oportunidad.version}-${recarga}`} d={d} onCancelar={onCancelar} onRegistrada={onRegistrada} onRecargar={() => setRecarga((n) => n + 1)} />;
}

function Formulario({ d, onCancelar, onRegistrada, onRecargar }: {
  d: FormularioVentaDto; onCancelar: () => void; onRegistrada: (ventaId: string, repetida: boolean) => void; onRecargar: () => void;
}) {
  const envio = useEnvio();
  const [codigo, setCodigo] = useState<CodigoProducto | null>(null);
  const [fecha, setFecha] = useState(d.hoy);
  const [importe, setImporte] = useState("");
  const [importeOk, setImporteOk] = useState(false);
  const [experiencias, setExperiencias] = useState("");
  const [duracion, setDuracion] = useState("20");
  const [fundamento, setFundamento] = useState<Fundamento | null>(null);
  const [tipo, setTipo] = useState<TipoComision>("pactada");
  const [beneficiario, setBeneficiario] = useState("");
  const [comision, setComision] = useState("");
  const [detalle, setDetalle] = useState("");
  const [intervencion, setIntervencion] = useState("");
  const [comisionOk, setComisionOk] = useState(false);
  const [obs, setObs] = useState("");
  const [error, setError] = useState<{ texto: string; codigo?: string } | null>(null);

  const p = d.productos.find((x) => x.codigo === codigo) ?? null;
  const imp = leerImporte(importe);
  const com = tipo === "pactada" ? leerImporte(comision) : null;
  const bloqueado = envio.enviando || envio.incierto;

  // Elegir producto: importe de lista y comisión propuesta por la regla.
  const elegir = (c: CodigoProducto | null) => {
    setCodigo(c);
    setError(null);
    const prod = d.productos.find((x) => x.codigo === c);
    if (!prod) return;
    setImporte(deCentavos(prod.precio));
    setImporteOk(false);
    setExperiencias(prod.experiencias ? String(prod.experiencias) : "");
    setDuracion(String(prod.duracion_minutos));
    const prop = d.propuestas[prod.codigo];
    setFundamento(prop.fundamento);
    setTipo(prop.tipo);
    setBeneficiario(prop.beneficiario_id ?? "");
    setComision(deCentavos(prop.importe));
    setComisionOk(false);
    setIntervencion("");
    setDetalle("");
  };
  // Si cambia el importe de un pack, la comisión de lista deja de aplicar sola.
  const cambiarImporte = (v: string) => {
    setImporte(v);
    setImporteOk(false);
    setComisionOk(false);
    if (p && p.codigo !== "personalizado" && (fundamento === "origen_comercial" || fundamento === "recompra_trabajada")) {
      setComision(leerImporte(v) === p.precio ? deCentavos(p.comision_estandar) : "");
    }
  };
  const cambiarFundamento = (f: Fundamento | null) => {
    setFundamento(f);
    setComisionOk(false);
    setIntervencion("");
    if (f === "recompra_espontanea") { setTipo("no_corresponde"); setBeneficiario(""); setComision(""); }
    else if (f === "origen_comercial") {
      setTipo("pactada");
      setBeneficiario(d.oportunidad.origen?.id ?? "");
      setComision(p && imp === p.precio ? deCentavos(p.comision_estandar) : "");
    } else if (f === "recompra_trabajada") {
      setTipo("pactada");
      setBeneficiario("");
      setComision(p && imp === p.precio ? deCentavos(p.comision_estandar) : "");
    } else if (f === "acuerdo_especial") { setTipo("pactada"); }
  };

  const fundamentos = FUNDAMENTOS.filter((f) => (d.es_recompra ? f.valor !== "origen_comercial" : f.valor === "origen_comercial" || f.valor === "acuerdo_especial"));
  const intervenciones = d.intervenciones.filter((i) => i.tipo === "actividad" || i.usuario_id === beneficiario);
  const pideImporteOk = !!p && requiereConfirmarImporte(p, imp);
  const pideComisionOk = !!p && !!fundamento && requiereConfirmarComision(p, imp, { tipo, fundamento, importe: com });
  const nombreBen = d.comerciales.find((u) => u.id === beneficiario)?.nombre ?? "—";
  const exp = p?.codigo === "personalizado" ? Number(experiencias) : p?.experiencias ?? 0;

  const falta = useMemo(() => {
    if (!p) return "Elegí el producto.";
    if (!fecha) return "Elegí la fecha del acuerdo.";
    if (p.codigo === "personalizado" && (!/^\d+$/.test(experiencias) || Number(experiencias) < (p.minimo_experiencias ?? 26))) return `Un personalizado lleva ${p.minimo_experiencias ?? 26} experiencias o más.`;
    if (p.codigo === "personalizado" && (!/^\d+$/.test(duracion) || Number(duracion) < 1)) return "Cargá la duración de cada experiencia.";
    if (imp === null || imp <= 0) return "Cargá el importe acordado.";
    if (pideImporteOk && !importeOk) return "Confirmá el importe (no es el de lista).";
    if (!fundamento) return "Elegí el fundamento de la comisión.";
    if (tipo === "pactada" && !beneficiario) return "Elegí quién cobra la comisión.";
    if (tipo === "pactada" && (com === null || com <= 0)) return "Cargá el importe de la comisión (si no corresponde, elegí «sin comisión»).";
    if (tipo === "pactada" && com !== null && com > imp) return "La comisión no puede superar el importe de la venta.";
    if (fundamento === "recompra_trabajada" && !intervencion) return "Vinculá la visita o la gestión en la que intervino el comercial.";
    if (fundamento === "acuerdo_especial" && !detalle.trim()) return "Describí el acuerdo especial.";
    if (pideComisionOk && !comisionOk) return "Confirmá la comisión.";
    return null;
  }, [p, fecha, experiencias, duracion, imp, pideImporteOk, importeOk, fundamento, tipo, beneficiario, com, intervencion, detalle, pideComisionOk, comisionOk]);

  async function guardar() {
    if (!p || falta || imp === null) return;
    const i = d.intervenciones.find((x) => x.id === intervencion);
    const datos: Record<string, unknown> = {
      producto: p.codigo, fecha_acuerdo: fecha, importe: (imp / 100).toFixed(2),
      ...(pideImporteOk ? { importe_confirmado: true } : {}),
      ...(p.codigo === "personalizado" ? { experiencias: Number(experiencias), duracion_minutos: Number(duracion) } : {}),
      comision: {
        tipo, fundamento,
        ...(tipo === "pactada" ? { importe: ((com ?? 0) / 100).toFixed(2), beneficiario_id: beneficiario } : {}),
        ...(fundamento === "acuerdo_especial" ? { detalle: detalle.trim() } : {}),
        ...(fundamento === "recompra_trabajada" && i ? { [i.tipo === "visita" ? "intervencion_visita_id" : "intervencion_actividad_id"]: i.id } : {}),
        ...(pideComisionOk ? { confirmada: true } : {}),
      },
      ...(obs.trim() ? { observacion: obs.trim() } : {}),
    };
    await resultado(await envio.mandar<ResultadoVenta>(`${API}/oportunidades/${d.oportunidad.id}/venta`, "POST", { version: d.oportunidad.version, datos }));
  }
  async function resultado(r: Awaited<ReturnType<typeof envio.mandar<ResultadoVenta>>> | null) {
    if (!r) return;
    if (r.ok) { onRegistrada(r.data.venta.id, r.data.repetida); return; }
    setError({ texto: r.incierto ? MENSAJE_INCIERTO : r.error, codigo: r.codigo });
  }

  if (!d.oportunidad.abierta || d.oportunidad.estado === "pausada") {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-black">Registrar venta</h3>
        <Aviso tipo="alerta">{d.venta_vigente ? "Ya tiene una venta registrada." : d.oportunidad.estado === "pausada" ? "Está en pausa: retomala para registrar la venta."
          : d.oportunidad.estado === "perdida" ? "Está perdida: reabrila para registrar la venta." : "La oportunidad está cerrada."}</Aviso>
        {d.venta_vigente ? <Link href={`/admin/crm/ventas/${d.venta_vigente.id}`} className="inline-flex min-h-11 items-center font-bold underline">Ver la venta</Link> : null}
        <Boton variante="fantasma" onClick={onCancelar}>Volver</Boton>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-black">Registrar venta</h3>
        <p className="text-sm text-white/70">La oportunidad pasa a <strong>Ganado</strong> en la misma operación. Se cancelan sus próximas acciones; visitas, gestiones y fechas quedan.
          {d.es_recompra ? " Es una recompra: el negocio ya compró." : ""}</p>
      </div>

      <Chips etiqueta="Producto" deshabilitado={bloqueado} valor={codigo} onCambio={elegir}
        opciones={d.productos.map((x) => ({
          valor: x.codigo, texto: x.nombre,
          detalle: x.codigo === "personalizado" ? `Más de 25 · importe y comisión a mano` : `${x.experiencias} × ${x.duracion_minutos} min · ${formatoPesos(x.precio)} · comisión ${formatoPesos(x.comision_estandar)}`,
        }))} />

      {p ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha del acuerdo
              <input type="date" className={INPUT} value={fecha} min={d.oportunidad.inicio_ciclo} max={d.hoy} disabled={bloqueado} onChange={(e) => setFecha(e.target.value)} />
              <span className="block text-xs font-normal text-white/50">Cuándo se cerró el trato (puede ser anterior a hoy). Se guarda aparte del momento de carga.</span>
            </label>
            {p.codigo === "personalizado" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-sm font-semibold text-white/80">Experiencias
                  <input inputMode="numeric" className={INPUT} value={experiencias} disabled={bloqueado} onChange={(e) => setExperiencias(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </label>
                <label className="block space-y-1.5 text-sm font-semibold text-white/80">Minutos c/u
                  <input inputMode="numeric" className={INPUT} value={duracion} disabled={bloqueado} onChange={(e) => setDuracion(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                </label>
              </div>
            ) : <p className="self-end text-sm text-white/70">{p.experiencias} experiencias de {p.duracion_minutos} minutos (las del pack).</p>}
          </div>

          <CampoImporte etiqueta="Importe acordado" valor={importe} onCambio={cambiarImporte} deshabilitado={bloqueado}
            ayuda={<>Acuerdo comercial, sin IVA ni comprobante fiscal.{p.precio !== null ? ` De lista: ${formatoPesos(p.precio)}.` : ""}{imp ? ` Anticipo esperado (50%): ${formatoPesos(anticipoEsperado(imp))}.` : ""}</>} />
          {pideImporteOk ? (
            <label className="flex items-start gap-3 rounded-xl border border-amber-500/40 p-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-red-600" checked={importeOk} disabled={bloqueado} onChange={(e) => setImporteOk(e.target.checked)} />
              <span>Confirmo que el importe acordado es <strong>{formatoPesos(imp)}</strong> (el de lista es {formatoPesos(p.precio)}).</span>
            </label>
          ) : null}

          <fieldset className="space-y-3 rounded-2xl border border-white/10 p-4">
            <legend className="px-1 text-sm font-bold">Comisión comercial</legend>
            <p className="text-sm text-white/70">
              {d.es_recompra
                ? "Recompra: sin comisión si fue espontánea; comisión completa si un comercial la trabajó (con su visita o una gestión de esta oportunidad)."
                : d.oportunidad.origen
                  ? <>Venta nueva: la comisión es de <strong>{d.oportunidad.origen.nombre}</strong>, que originó el lead{d.empresa.responsable && d.empresa.responsable.id !== d.oportunidad.origen.id ? ` (aunque hoy el responsable sea ${d.empresa.responsable.nombre})` : ""}. Que cierre Administración no la cambia.</>
                  : "Esta oportunidad no tiene un comercial de origen."}
            </p>
            <Chips etiqueta="Fundamento" opciones={fundamentos} valor={fundamento} onCambio={cambiarFundamento} deshabilitado={bloqueado} />
            {fundamento === "acuerdo_especial" ? (
              <>
                <Chips etiqueta="¿Lleva comisión?" opciones={[{ valor: "pactada", texto: "Sí" }, { valor: "no_corresponde", texto: "No" }] as const} valor={tipo}
                  onCambio={(v) => { setTipo(v ?? "pactada"); setComisionOk(false); if (v === "no_corresponde") { setBeneficiario(""); setComision(""); } }} deshabilitado={bloqueado} />
                <label className="block space-y-1.5 text-sm font-semibold text-white/80">Detalle del acuerdo (obligatorio)
                  <input className={INPUT} maxLength={300} value={detalle} disabled={bloqueado} onChange={(e) => { setDetalle(e.target.value); setComisionOk(false); }} />
                </label>
              </>
            ) : null}
            {tipo === "pactada" && fundamento ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {fundamento === "origen_comercial" ? (
                  <p className="text-sm">Cobra: <strong>{d.oportunidad.origen?.nombre ?? "—"}</strong> (originó el lead)</p>
                ) : (
                  <label className="block space-y-1.5 text-sm font-semibold text-white/80">Cobra la comisión
                    <select className={INPUT} value={beneficiario} disabled={bloqueado} onChange={(e) => { setBeneficiario(e.target.value); setIntervencion(""); setComisionOk(false); }}>
                      <option value="">Elegí</option>
                      {d.comerciales.filter((u) => u.activo || u.id === beneficiario).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </label>
                )}
                <CampoImporte etiqueta="Importe de la comisión" valor={comision} onCambio={(v) => { setComision(v); setComisionOk(false); }} deshabilitado={bloqueado}
                  ayuda={p.comision_estandar !== null ? `De lista: ${formatoPesos(p.comision_estandar)} (con el importe de lista).` : "Personalizado: se carga a mano."} />
              </div>
            ) : null}
            {fundamento === "recompra_trabajada" ? (
              <label className="block space-y-1.5 text-sm font-semibold text-white/80">Intervención del comercial
                <select className={INPUT} value={intervencion} disabled={bloqueado || !beneficiario} onChange={(e) => { setIntervencion(e.target.value); setComisionOk(false); }}>
                  <option value="">{beneficiario ? "Elegí la visita o la gestión" : "Primero elegí quién cobra"}</option>
                  {intervenciones.map((i) => <option key={i.id} value={i.id}>{fechaHora(i.en)} · {i.descripcion}</option>)}
                </select>
                <span className="block text-xs font-normal text-white/50">Solo visitas de esa persona o gestiones de esta oportunidad. Administración confirma la intervención.</span>
              </label>
            ) : null}
            {tipo === "no_corresponde" && fundamento ? <p className="text-sm text-white/70">Sin comisión. No se carga 0: queda registrado que no corresponde.</p> : null}
            {pideComisionOk ? (
              <label className="flex items-start gap-3 rounded-xl border border-amber-500/40 p-3 text-sm">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-red-600" checked={comisionOk} disabled={bloqueado} onChange={(e) => setComisionOk(e.target.checked)} />
                <span>{tipo === "pactada"
                  ? <>Confirmo la comisión: <strong>{formatoPesos(com)}</strong> para <strong>{fundamento === "origen_comercial" ? d.oportunidad.origen?.nombre : nombreBen}</strong>{p.comision_estandar !== null ? ` (la de lista es ${formatoPesos(p.comision_estandar)})` : ""}.</>
                  : <>Confirmo que esta venta <strong>no lleva comisión</strong> por el acuerdo especial.</>}</span>
              </label>
            ) : null}
          </fieldset>

          <label className="block space-y-1.5 text-sm font-semibold text-white/80">Observación (opcional)
            <textarea className={`${INPUT} min-h-20`} maxLength={1000} value={obs} disabled={bloqueado} onChange={(e) => setObs(e.target.value)} />
          </label>

          <div className={cx("rounded-2xl border p-4 text-sm", falta ? "border-white/10" : "border-green-500/30 bg-green-950/10")}>
            <p className="font-bold">Resumen</p>
            <p>{p.nombre} · {exp || "—"} experiencias de {p.codigo === "personalizado" ? duracion || "—" : p.duracion_minutos} min · acuerdo del {fechaCorta(fecha)}</p>
            <p>Importe acordado: <strong>{formatoPesos(imp)}</strong>{imp ? ` · anticipo esperado ${formatoPesos(anticipoEsperado(imp))} · saldo ${formatoPesos(imp - anticipoEsperado(imp))}` : ""}</p>
            <p>Comisión: {tipo === "no_corresponde" ? "no corresponde" : `${formatoPesos(com)} para ${fundamento === "origen_comercial" ? d.oportunidad.origen?.nombre ?? "—" : nombreBen}`} · se genera cuando la venta esté cobrada por completo.</p>
          </div>
        </>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <Aviso tipo={envio.incierto ? "alerta" : "error"} acciones={envio.incierto ? (
            <>
              <Boton variante="primario" cargando={envio.enviando} onClick={async () => resultado(await envio.reintentar<ResultadoVenta>())}>Reintentar</Boton>
              <Boton variante="fantasma" onClick={() => { envio.descartar(); setError(null); onRecargar(); }}>Descartar y recargar</Boton>
            </>
          ) : error.codigo === "version_desactualizada" ? <Boton onClick={onRecargar}>Recargar</Boton> : undefined}>{error.texto}</Aviso>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={envio.enviando} disabled={bloqueado || !!falta} onClick={() => void guardar()}>Registrar venta y marcar Ganado</Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={envio.enviando}>Cancelar</Boton>
      </div>
      {falta && p ? <p className="text-xs text-white/50">{falta}</p> : null}
    </div>
  );
}
