"use client";

// CRM B3 · Detalle de una venta (solo Administración): el acuerdo (foto de las
// condiciones), los cobros, la comisión y sus pagos, la entrega de tarjetas y la
// campaña de Empresas vinculada (solo lectura). Toda escritura va a
// /api/admin/crm/ventas/[id] con una clave por envío (ventasCampos: useEnvio).
// Nada se borra: los cobros y pagos se anulan con motivo; la venta se corrige o se
// anula con motivo y queda en el historial. Una devolución real de dinero no se
// registra acá (queda fuera de alcance).

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CreditCard, HandCoins, Link2, Pencil, Search, Truck } from "lucide-react";
import { Aviso, Boton, Cargando, Chips, Dialogo, Etiqueta, Panel, cx } from "@/app/admin/(panel)/interacciones/ui";
import { pedir } from "./api";
import { INPUT, fechaCorta, fechaHora } from "./campos";
import { CampoImporte, EtiquetaCobro, EtiquetaComision, MENSAJE_INCIERTO, deCentavos, useEnvio } from "./ventasCampos";
import { textoEstado } from "@/lib/crmB2";
import {
  CONCEPTOS, FUNDAMENTOS, MEDIOS, TEXTO_REVISION, cobroSugerido, formatoPesos, leerImporte, requiereConfirmarComision, requiereConfirmarImporte,
  textoConcepto, textoFundamento, textoMedio, type Concepto, type Fundamento, type Medio, type TipoComision,
} from "@/lib/crmB3";
import type { CampaniaCandidata, DetalleVentaDto, FormularioVentaDto, ResultadoGestionVenta } from "@/lib/crmB3Server";

const API = "/api/admin/crm";
type Modo = null | { tipo: "cobro"; concepto: Concepto } | { tipo: "pago" } | { tipo: "entrega" } | { tipo: "campania" } | { tipo: "corregir" } | { tipo: "anular" }
  | { tipo: "anular_cobro"; id: string; texto: string } | { tipo: "anular_pago"; id: string; texto: string };

export default function DetalleVenta({ id }: { id: string }) {
  const [d, setD] = useState<DetalleVentaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    pedir<DetalleVentaDto>(`${API}/ventas/${id}`).then((r) => {
      if (!vivo) return;
      if (r.ok) { setD(r.data); setError(null); } else setError(r.error);
    });
    return () => { vivo = false; };
  }, [id, recarga]);

  if (!d) return error ? <Aviso tipo="error">{error}</Aviso> : <Cargando />;
  const v = d.venta;
  const anulada = !!v.anulada;
  const listo = (texto: string) => { setModo(null); setAviso(texto); setRecarga((n) => n + 1); };
  const abrir = (m: Modo) => { setAviso(null); setModo(m); };
  const puedePagar = v.comision.estado === "generada" || v.comision.estado === "pagada_parcial";
  const cobrosVig = d.cobros.filter((c) => !c.anulado);
  const pagosVig = d.pagos.filter((p) => !p.anulado);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="titulo-pagina" tabIndex={-1} className="text-2xl font-black outline-none md:text-3xl">{v.empresa.nombre}</h1>
          <Etiqueta>{v.producto.nombre}</Etiqueta>
          {v.es_recompra ? <Etiqueta tono="gris">Recompra</Etiqueta> : <Etiqueta tono="gris">Venta nueva</Etiqueta>}
          {anulada ? <Etiqueta tono="gris">Anulada</Etiqueta> : null}
        </div>
        <p className="text-sm text-white/70">Acuerdo del {fechaCorta(v.fecha_acuerdo)} · registrada el {fechaHora(v.registrada_en)} · {v.experiencias} experiencias de {v.duracion_minutos} min</p>
        <div className="flex flex-wrap gap-x-4 text-sm">
          <Link href={`/admin/crm/negocios/${v.empresa.id}`} className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline">Ficha del negocio</Link>
          <Link href={`/admin/crm/seguimiento?op=${d.oportunidad.id}`} className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline">
            Oportunidad ({textoEstado(d.oportunidad.estado)})</Link>
        </div>
      </header>

      <div aria-live="polite">{aviso ? <Aviso tipo="exito">{aviso}</Aviso> : null}</div>

      {anulada ? (
        <Aviso tipo="info" titulo={`Venta anulada el ${fechaHora(v.anulada!.en)}`}>Motivo: {v.anulada!.motivo}. Queda en el historial; no suma en totales ni en la ficha.</Aviso>
      ) : v.pendientes.length ? (
        <Aviso tipo="alerta" titulo="Pendiente">
          <ul className="list-disc space-y-0.5 pl-5">
            {v.pendientes.includes("cobro") ? <li>Falta cobrar {formatoPesos(v.saldo)} (saldo).</li> : null}
            {v.pendientes.includes("entrega") ? <li>Tarjetas sin entregar.</li> : null}
            {v.pendientes.includes("comision") ? <li>Comisión generada: falta pagar {formatoPesos(v.comision.pendiente)} a {v.comision.beneficiario?.nombre}.</li> : null}
          </ul>
        </Aviso>
      ) : <Aviso tipo="exito">Cobrada, entregada y sin comisión pendiente.</Aviso>}

      {/* ── Acuerdo ─────────────────────────────────────────────────────── */}
      <Seccion titulo="Acuerdo" acciones={!anulada ? (
        <>
          <Boton onClick={() => abrir({ tipo: "corregir" })}><Pencil className="h-4 w-4" aria-hidden />Corregir</Boton>
          <Boton variante="peligro" onClick={() => abrir({ tipo: "anular" })}><Ban className="h-4 w-4" aria-hidden />Anular venta</Boton>
        </>
      ) : null}>
        <Dato etiqueta="Importe acordado" valor={formatoPesos(v.importe)} detalle={v.precio_catalogo !== null && v.precio_catalogo !== v.importe ? `De lista al registrar: ${formatoPesos(v.precio_catalogo)}` : v.precio_catalogo !== null ? "El de lista al registrar" : "Personalizado"} />
        <Dato etiqueta="Producto" valor={`${v.producto.nombre} · ${v.experiencias} × ${v.duracion_minutos} min`} />
        <Dato etiqueta="Fecha del acuerdo" valor={fechaCorta(v.fecha_acuerdo)} />
        <Dato etiqueta="Origen" valor={d.oportunidad.origen_tipo === "recompra_admin" ? "Recompra creada por Administración" : `Lead de ${d.oportunidad.origen?.nombre ?? "—"}`} detalle={`Lead del ${fechaHora(d.oportunidad.lead_en)}`} />
        {v.observacion ? <p className="col-span-full whitespace-pre-wrap text-sm text-white/80">«{v.observacion}»</p> : null}
        <p className="col-span-full text-xs text-white/50">Acuerdo comercial: sin IVA ni comprobante fiscal. No es facturación ni un movimiento de Finanzas.</p>
      </Seccion>

      {/* ── Cobros ──────────────────────────────────────────────────────── */}
      <Seccion titulo="Cobros" etiqueta={!anulada ? <EtiquetaCobro estado={v.estado_cobro} /> : null} acciones={!anulada && v.saldo > 0 ? (
        <>
          {v.cobrado < v.anticipo_esperado ? <Boton variante="primario" onClick={() => abrir({ tipo: "cobro", concepto: "anticipo" })}><HandCoins className="h-4 w-4" aria-hidden />Registrar anticipo</Boton> : null}
          <Boton variante={v.cobrado >= v.anticipo_esperado ? "primario" : "secundario"} onClick={() => abrir({ tipo: "cobro", concepto: "saldo" })}><HandCoins className="h-4 w-4" aria-hidden />{v.cobrado > 0 ? "Completar saldo" : "Cobro total"}</Boton>
          <Boton variante="fantasma" onClick={() => abrir({ tipo: "cobro", concepto: "otro" })}>Otro cobro</Boton>
        </>
      ) : null}>
        <Dato etiqueta="Acordado" valor={formatoPesos(v.importe)} />
        <Dato etiqueta="Anticipo esperado (50%)" valor={formatoPesos(v.anticipo_esperado)} />
        <Dato etiqueta="Cobrado según CRM" valor={formatoPesos(v.cobrado)} />
        <Dato etiqueta="Saldo" valor={formatoPesos(v.saldo)} alerta={v.saldo > 0 && !anulada} />
        <ul className="col-span-full space-y-2">
          {d.cobros.length === 0 ? <li className="text-sm text-white/60">Sin cobros registrados.</li> : d.cobros.map((c) => (
            <li key={c.id} className={cx("rounded-xl border p-3 text-sm", c.anulado ? "border-white/5 opacity-60" : "border-white/10")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{formatoPesos(c.importe)} · {textoConcepto(c.concepto)} · {textoMedio(c.medio)}</p>
                  <p className="text-white/70">Cobrado el {fechaCorta(c.fecha_efectiva)}{c.referencia ? ` · ref. ${c.referencia}` : ""} · cargado el {fechaHora(c.registrado_en)}</p>
                  {c.anulado ? <p className="text-amber-200">Anulado el {fechaHora(c.anulado.en)}: {c.anulado.motivo}</p> : null}
                </div>
                {!c.anulado && !anulada ? <Boton variante="fantasma" onClick={() => abrir({ tipo: "anular_cobro", id: c.id, texto: `${formatoPesos(c.importe)} del ${fechaCorta(c.fecha_efectiva)}` })}>Anular</Boton> : null}
              </div>
            </li>
          ))}
        </ul>
      </Seccion>

      {/* ── Comisión ────────────────────────────────────────────────────── */}
      <Seccion titulo="Comisión comercial" etiqueta={!anulada ? <EtiquetaComision estado={v.comision.estado} /> : null} acciones={!anulada && puedePagar ? (
        <Boton variante="primario" onClick={() => abrir({ tipo: "pago" })}><CreditCard className="h-4 w-4" aria-hidden />Registrar pago de comisión</Boton>
      ) : null}>
        <Dato etiqueta="Fundamento" valor={textoFundamento(v.comision.fundamento)} detalle={v.comision.detalle ?? undefined} />
        {v.comision.tipo === "pactada" ? (
          <>
            <Dato etiqueta="Pactada" valor={formatoPesos(v.comision.pactada)} detalle={v.comision_catalogo !== null ? `De lista al registrar: ${formatoPesos(v.comision_catalogo)}` : undefined} />
            <Dato etiqueta="Cobra" valor={v.comision.beneficiario?.nombre ?? "—"} />
            <Dato etiqueta="Pagado" valor={formatoPesos(v.comision.pagado)} detalle={v.comision.pendiente > 0 ? `Falta pagar ${formatoPesos(v.comision.pendiente)}` : undefined} />
          </>
        ) : <Dato etiqueta="Comisión" valor="No corresponde" />}
        {d.intervencion ? <p className="col-span-full text-sm text-white/70">Intervención confirmada: {d.intervencion.descripcion} · {fechaHora(d.intervencion.en)}</p> : null}
        {v.comision.estado === "prevista" ? <p className="col-span-full text-sm text-white/60">Se genera cuando la venta esté cobrada por completo (falta {formatoPesos(v.saldo)}).</p> : null}
        {v.comision.motivos.length ? (
          <div className="col-span-full"><Aviso tipo="error" titulo="A revisar">{v.comision.motivos.map((m) => TEXTO_REVISION[m]).join(" ")} Corregí la venta o anulá los pagos que no correspondan.</Aviso></div>
        ) : null}
        {d.pagos.length ? (
          <ul className="col-span-full space-y-2">
            {d.pagos.map((p) => (
              <li key={p.id} className={cx("rounded-xl border p-3 text-sm", p.anulado ? "border-white/5 opacity-60" : "border-white/10")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{formatoPesos(p.importe)} a {p.beneficiario.nombre}</p>
                    <p className="text-white/70">Pagado el {fechaCorta(p.fecha)}{p.referencia ? ` · ref. ${p.referencia}` : ""} · cargado el {fechaHora(p.registrado_en)}</p>
                    {p.anulado ? <p className="text-amber-200">Anulado el {fechaHora(p.anulado.en)}: {p.anulado.motivo}</p> : null}
                  </div>
                  {!p.anulado && !anulada ? <Boton variante="fantasma" onClick={() => abrir({ tipo: "anular_pago", id: p.id, texto: `${formatoPesos(p.importe)} del ${fechaCorta(p.fecha)}` })}>Anular</Boton> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Seccion>

      {/* ── Tarjetas y campaña ──────────────────────────────────────────── */}
      <Seccion titulo="Tarjetas y códigos" acciones={!anulada ? (
        <>
          <Boton onClick={() => abrir({ tipo: "entrega" })}><Truck className="h-4 w-4" aria-hidden />{v.entrega.estado === "entregada" ? "Cambiar entrega" : "Marcar entregadas"}</Boton>
          <Boton onClick={() => abrir({ tipo: "campania" })}><Link2 className="h-4 w-4" aria-hidden />{v.campania_id ? "Cambiar campaña" : "Vincular campaña"}</Boton>
        </>
      ) : null}>
        <Dato etiqueta="Tarjetas" valor={v.entrega.estado === "entregada" ? `Entregadas el ${fechaCorta(v.entrega.fecha)}` : "Sin entregar"} detalle={v.entrega_detalle ?? undefined} alerta={v.entrega.estado === "pendiente" && !anulada} />
        <Dato etiqueta="Vencimiento" valor={d.campania?.fecha_vencimiento ? fechaCorta(d.campania.fecha_vencimiento) : "Sin definir"}
          detalle={d.campania ? (d.campania.fecha_vencimiento ? "El de la campaña de Empresas" : "La campaña todavía no tiene fecha de vencimiento") : "Sin campaña vinculada"} />
        {d.campania ? (
          <div className="col-span-full space-y-2 rounded-xl border border-white/10 p-3 text-sm">
            <p className="font-bold">{d.campania.empresa}{d.campania.nombre ? ` · ${d.campania.nombre}` : ""} <span className="font-normal text-white/60">(Empresas, solo lectura)</span></p>
            <p className="text-white/80">Estado: {d.campania.estado.replace(/_/g, " ")} · pago en Empresas: {d.campania.estado_pago} · {d.campania.cantidad_contratada} turnos de {d.campania.duracion_minutos} min · {d.campania.usos_por_codigo} uso(s) por código</p>
            <p className="text-white/80">Códigos: {d.campania.codigos.generados} generados · {d.campania.codigos.disponibles} disponibles · {d.campania.codigos.utilizados} utilizados{d.campania.codigos.vencidos ? ` · ${d.campania.codigos.vencidos} vencidos` : ""}{d.campania.codigos.cancelados ? ` · ${d.campania.codigos.cancelados} cancelados` : ""} · {d.campania.usos} canje(s)</p>
            {d.campania.avisos.length ? <Aviso tipo="alerta" titulo="No coincide con la venta">{d.campania.avisos.join(" ")} No se modifica nada: revisalo en Empresas o corregí la venta.</Aviso> : null}
            <Link href="/admin/codigos" className="inline-flex min-h-11 items-center font-semibold underline">Abrir Códigos → Empresas</Link>
          </div>
        ) : null}
        <p className="col-span-full text-xs text-white/50">La entrega y la activación no se automatizan: se marcan a mano. El vencimiento no se calcula en el CRM.</p>
      </Seccion>

      {/* ── Historial ───────────────────────────────────────────────────── */}
      <Historial d={d} />

      {modo?.tipo === "cobro" ? <FormularioCobro d={d} concepto={modo.concepto} onCerrar={() => setModo(null)} onListo={listo} /> : null}
      {modo?.tipo === "pago" ? <FormularioPago d={d} onCerrar={() => setModo(null)} onListo={listo} /> : null}
      {modo?.tipo === "entrega" ? <FormularioEntrega d={d} onCerrar={() => setModo(null)} onListo={listo} /> : null}
      {modo?.tipo === "campania" ? <FormularioCampania d={d} onCerrar={() => setModo(null)} onListo={listo} /> : null}
      {modo?.tipo === "corregir" ? <FormularioCorreccion d={d} onCerrar={() => setModo(null)} onListo={listo} /> : null}
      {modo?.tipo === "anular" ? <DialogoAnular d={d} cobros={cobrosVig.length} pagos={pagosVig.length} onCerrar={() => setModo(null)} onListo={listo} /> : null}
      {modo?.tipo === "anular_cobro" || modo?.tipo === "anular_pago" ? (
        <DialogoMotivo d={d} titulo={modo.tipo === "anular_cobro" ? "Anular cobro" : "Anular pago de comisión"}
          exito={modo.tipo === "anular_cobro" ? "Cobro anulado (queda en el historial)." : "Pago de comisión anulado (queda en el historial)."}
          texto={<>Se anula el {modo.tipo === "anular_cobro" ? "cobro" : "pago"} de {modo.texto}. No se borra ni es una devolución: queda en el historial con el motivo.</>}
          accion={modo.tipo} datos={modo.tipo === "anular_cobro" ? { cobro_id: modo.id } : { pago_id: modo.id }}
          onCerrar={() => setModo(null)} onListo={listo} />
      ) : null}
    </div>
  );
}

function Seccion({ titulo, etiqueta, acciones, children }: { titulo: string; etiqueta?: ReactNode; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-black">{titulo}{etiqueta}</h2>
        {acciones ? <div className="flex flex-wrap gap-2">{acciones}</div> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Dato({ etiqueta, valor, detalle, alerta }: { etiqueta: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{etiqueta}</p>
      <p className={cx("text-base font-bold", alerta && "text-amber-200")}>{valor}</p>
      {detalle ? <p className="text-xs text-white/50">{detalle}</p> : null}
    </div>
  );
}

// ── Envío común de los formularios ─────────────────────────────────────────
function useAccion(d: DetalleVentaDto, onListo: (t: string) => void) {
  const envio = useEnvio();
  const [error, setError] = useState<{ texto: string; codigo?: string } | null>(null);
  const [duplicado, setDuplicado] = useState(false);
  async function tratar(r: Awaited<ReturnType<typeof envio.reintentar<ResultadoGestionVenta>>>, exito: string) {
    if (!r) return;
    if (r.ok) {
      if (r.data.resultado === "posible_duplicado") { setDuplicado(true); setError(null); return; }
      onListo(r.data.repetida ? `${exito} (ya se había guardado: no se duplicó).` : exito);
      return;
    }
    setError({ texto: r.incierto ? MENSAJE_INCIERTO : r.error, codigo: r.codigo });
  }
  return {
    ...envio, error, duplicado, setDuplicado,
    bloqueado: envio.enviando || envio.incierto,
    enviarAccion: async (accion: string, datos: Record<string, unknown>, exito: string) =>
      tratar(await envio.mandar<ResultadoGestionVenta>(`${API}/ventas/${d.venta.id}`, "POST", { version: d.venta.version, accion, datos }), exito),
    reintentarAccion: async (exito: string) => tratar(await envio.reintentar<ResultadoGestionVenta>(), exito),
  };
}

function ErrorEnvio({ a, exito }: { a: ReturnType<typeof useAccion>; exito: string }) {
  if (!a.error) return null;
  return (
    <Aviso tipo={a.incierto ? "alerta" : "error"} acciones={a.incierto ? (
      <>
        <Boton variante="primario" cargando={a.enviando} onClick={() => void a.reintentarAccion(exito)}>Reintentar</Boton>
        <Boton variante="fantasma" onClick={() => { a.descartar(); window.location.reload(); }}>Descartar y recargar</Boton>
      </>
    ) : a.error.codigo === "version_desactualizada" ? <Boton onClick={() => window.location.reload()}>Recargar</Boton> : undefined}>{a.error.texto}</Aviso>
  );
}

// ── Cobro ───────────────────────────────────────────────────────────────────
function FormularioCobro({ d, concepto: inicial, onCerrar, onListo }: { d: DetalleVentaDto; concepto: Concepto; onCerrar: () => void; onListo: (t: string) => void }) {
  const v = d.venta;
  const a = useAccion(d, onListo);
  const [concepto, setConcepto] = useState<Concepto>(inicial);
  const [importe, setImporte] = useState(deCentavos(cobroSugerido(v.importe, v.cobrado, inicial) || null));
  const [fecha, setFecha] = useState(d.hoy);
  const [medio, setMedio] = useState<Medio | "">("transferencia");
  const [referencia, setReferencia] = useState("");
  const imp = leerImporte(importe);
  const excede = imp !== null && imp > v.saldo;
  const datos = { fecha_efectiva: fecha, importe: imp === null ? null : (imp / 100).toFixed(2), medio, concepto, ...(referencia.trim() ? { referencia: referencia.trim() } : {}) };
  const falta = imp === null || imp <= 0 ? "Cargá el importe." : excede ? `Supera el saldo (${formatoPesos(v.saldo)}).` : !fecha ? "Elegí la fecha." : !medio ? "Elegí el medio." : null;
  const exito = `Cobro de ${formatoPesos(imp)} registrado.`;
  return (
    <Panel titulo="Registrar cobro" onCerrar={onCerrar} pie={
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={a.enviando} disabled={a.bloqueado || !!falta || a.duplicado} onClick={() => void a.enviarAccion("cobro", datos, exito)}>Registrar cobro</Boton>
        <Boton variante="fantasma" onClick={onCerrar} disabled={a.enviando}>Cancelar</Boton>
      </div>}>
      <div className="space-y-4">
        <p className="text-sm text-white/70">Acordado {formatoPesos(v.importe)} · cobrado {formatoPesos(v.cobrado)} · saldo <strong>{formatoPesos(v.saldo)}</strong>. Solo se registra: no se cobra nada desde acá.</p>
        <Chips etiqueta="Concepto" opciones={CONCEPTOS} valor={concepto} deshabilitado={a.bloqueado}
          onCambio={(c) => { const x = c ?? "otro"; setConcepto(x); setImporte(deCentavos(cobroSugerido(v.importe, v.cobrado, x) || null)); a.setDuplicado(false); }} />
        <CampoImporte etiqueta="Importe cobrado" valor={importe} onCambio={(x) => { setImporte(x); a.setDuplicado(false); }} deshabilitado={a.bloqueado}
          ayuda={concepto === "anticipo" ? `Anticipo esperado: ${formatoPesos(v.anticipo_esperado)}.` : concepto === "saldo" ? `Saldo: ${formatoPesos(v.saldo)}.` : "Un cobro parcial también vale."} />
        {excede ? <p className="text-sm text-red-300">Supera el saldo: lo cobrado no puede pasar el importe acordado.</p> : null}
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha efectiva del cobro
          <input type="date" className={INPUT} value={fecha} min={v.fecha_acuerdo} max={d.hoy} disabled={a.bloqueado} onChange={(e) => { setFecha(e.target.value); a.setDuplicado(false); }} />
          <span className="block text-xs font-normal text-white/50">Cuándo se cobró. La fecha de carga se guarda aparte.</span>
        </label>
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Medio
          <select className={INPUT} value={medio} disabled={a.bloqueado} onChange={(e) => setMedio(e.target.value as Medio)}>
            {MEDIOS.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Referencia (opcional)
          <input className={INPUT} maxLength={120} value={referencia} disabled={a.bloqueado} onChange={(e) => setReferencia(e.target.value)} placeholder="N.º de transferencia, recibo…" />
        </label>
        {a.duplicado ? (
          <Aviso tipo="alerta" titulo="¿Es otro cobro?" acciones={
            <>
              <Boton variante="primario" cargando={a.enviando} onClick={() => void a.enviarAccion("cobro", { ...datos, confirmar_duplicado: true }, exito)}>Sí, es otro cobro</Boton>
              <Boton variante="fantasma" onClick={onCerrar}>No, no registrar</Boton>
            </>}>Ya hay un cobro vigente de {formatoPesos(imp)} con fecha {fechaCorta(fecha)}. Si son dos pagos distintos, confirmalo.</Aviso>
        ) : null}
        <ErrorEnvio a={a} exito={exito} />
        {falta ? <p className="text-xs text-white/50">{falta}</p> : null}
      </div>
    </Panel>
  );
}

// ── Pago de comisión ────────────────────────────────────────────────────────
function FormularioPago({ d, onCerrar, onListo }: { d: DetalleVentaDto; onCerrar: () => void; onListo: (t: string) => void }) {
  const v = d.venta;
  const a = useAccion(d, onListo);
  const [importe, setImporte] = useState(deCentavos(v.comision.pendiente || null));
  const [fecha, setFecha] = useState(d.hoy);
  const [referencia, setReferencia] = useState("");
  const imp = leerImporte(importe);
  const falta = imp === null || imp <= 0 ? "Cargá el importe." : imp > v.comision.pendiente ? `Supera lo que falta pagar (${formatoPesos(v.comision.pendiente)}).` : !fecha ? "Elegí la fecha." : null;
  const exito = `Pago de comisión de ${formatoPesos(imp)} registrado.`;
  return (
    <Panel titulo="Registrar pago de comisión" onCerrar={onCerrar} pie={
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={a.enviando} disabled={a.bloqueado || !!falta}
          onClick={() => void a.enviarAccion("pago_comision", { fecha, importe: ((imp ?? 0) / 100).toFixed(2), ...(referencia.trim() ? { referencia: referencia.trim() } : {}) }, exito)}>Registrar pago</Boton>
        <Boton variante="fantasma" onClick={onCerrar} disabled={a.enviando}>Cancelar</Boton>
      </div>}>
      <div className="space-y-4">
        <p className="text-sm text-white/70">Para <strong>{v.comision.beneficiario?.nombre}</strong> · pactada {formatoPesos(v.comision.pactada)} · pagado {formatoPesos(v.comision.pagado)} · falta <strong>{formatoPesos(v.comision.pendiente)}</strong>.</p>
        <CampoImporte etiqueta="Importe pagado" valor={importe} onCambio={setImporte} deshabilitado={a.bloqueado} ayuda="Puede ser un pago parcial." />
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha del pago
          <input type="date" className={INPUT} value={fecha} min={v.fecha_acuerdo} max={d.hoy} disabled={a.bloqueado} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Referencia (opcional)
          <input className={INPUT} maxLength={120} value={referencia} disabled={a.bloqueado} onChange={(e) => setReferencia(e.target.value)} />
        </label>
        <ErrorEnvio a={a} exito={exito} />
        {falta ? <p className="text-xs text-white/50">{falta}</p> : null}
      </div>
    </Panel>
  );
}

// ── Entrega ─────────────────────────────────────────────────────────────────
function FormularioEntrega({ d, onCerrar, onListo }: { d: DetalleVentaDto; onCerrar: () => void; onListo: (t: string) => void }) {
  const v = d.venta;
  const a = useAccion(d, onListo);
  const [estado, setEstado] = useState<"pendiente" | "entregada">("entregada");
  const [fecha, setFecha] = useState(v.entrega.fecha ?? d.hoy);
  const [detalle, setDetalle] = useState(v.entrega_detalle ?? "");
  return (
    <Panel titulo="Entrega de tarjetas" onCerrar={onCerrar} pie={
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={a.enviando} disabled={a.bloqueado || (estado === "entregada" && !fecha)}
          onClick={() => void a.enviarAccion("entrega", { estado, ...(estado === "entregada" ? { fecha } : {}), ...(detalle.trim() ? { detalle: detalle.trim() } : {}) },
            estado === "entregada" ? "Tarjetas marcadas como entregadas." : "Entrega vuelta a pendiente.")}>Guardar</Boton>
        <Boton variante="fantasma" onClick={onCerrar} disabled={a.enviando}>Cancelar</Boton>
      </div>}>
      <div className="space-y-4">
        <Chips etiqueta="Estado" opciones={[{ valor: "entregada", texto: "Entregadas" }, { valor: "pendiente", texto: "Sin entregar" }] as const} valor={estado}
          onCambio={(x) => setEstado(x ?? "entregada")} deshabilitado={a.bloqueado} />
        {estado === "entregada" ? (
          <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha de entrega
            <input type="date" className={INPUT} value={fecha} min={v.fecha_acuerdo} max={d.hoy} disabled={a.bloqueado} onChange={(e) => setFecha(e.target.value)} />
          </label>
        ) : null}
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Detalle (opcional)
          <input className={INPUT} maxLength={300} value={detalle} disabled={a.bloqueado} onChange={(e) => setDetalle(e.target.value)} placeholder="A quién, cuántas…" />
        </label>
        <p className="text-xs text-white/50">Solo se registra: no activa códigos ni envía nada.</p>
        <ErrorEnvio a={a} exito="Entrega guardada." />
      </div>
    </Panel>
  );
}

// ── Campaña de Empresas ─────────────────────────────────────────────────────
function FormularioCampania({ d, onCerrar, onListo }: { d: DetalleVentaDto; onCerrar: () => void; onListo: (t: string) => void }) {
  const a = useAccion(d, onListo);
  const [q, setQ] = useState(d.venta.empresa.nombre);
  const [lista, setLista] = useState<CampaniaCandidata[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      pedir<{ campanias: CampaniaCandidata[] }>(`${API}/campanias?q=${encodeURIComponent(q)}`).then((r) => { if (vivo && r.ok) setLista(r.data.campanias); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [q]);
  return (
    <Panel titulo="Campaña de Empresas" onCerrar={onCerrar} pie={
      <div className="flex flex-wrap gap-2">
        {d.venta.campania_id ? <Boton variante="peligro" cargando={a.enviando} disabled={a.bloqueado} onClick={() => void a.enviarAccion("vincular_campania", { campania_id: null }, "Campaña desvinculada.")}>Desvincular</Boton> : null}
        <Boton variante="fantasma" onClick={onCerrar} disabled={a.enviando}>Cerrar</Boton>
      </div>}>
      <div className="space-y-4">
        <p className="text-sm text-white/70">El vínculo es de solo lectura: el CRM muestra códigos, usos, duración, estado y vencimiento de la campaña, pero no la crea ni la modifica.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-white/40" aria-hidden />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Empresa o campaña" aria-label="Buscar campaña" />
        </div>
        {!lista ? <Cargando /> : lista.length === 0 ? <p className="text-sm text-white/60">No hay campañas con ese nombre en Empresas.</p> : (
          <ul className="space-y-2">
            {lista.map((k) => {
              const actual = k.id === d.venta.campania_id;
              const otra = k.vinculada_a && k.vinculada_a.venta_id !== d.venta.id;
              return (
                <li key={k.id} className={cx("rounded-xl border p-3 text-sm", actual ? "border-green-500/40" : "border-white/10")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{k.empresa}{k.nombre ? ` · ${k.nombre}` : ""}</p>
                      <p className="text-white/70">{k.cantidad_contratada} turnos de {k.duracion_minutos} min · {k.estado.replace(/_/g, " ")} · vence {k.fecha_vencimiento ? fechaCorta(k.fecha_vencimiento) : "sin definir"}</p>
                      {otra ? <p className="text-amber-200">Ya vinculada a una venta vigente de {k.vinculada_a!.empresa}.</p> : null}
                      {k.cantidad_contratada !== d.venta.experiencias || k.duracion_minutos !== d.venta.duracion_minutos ? (
                        <p className="text-amber-200">No coincide con la venta ({d.venta.experiencias} × {d.venta.duracion_minutos} min).</p>
                      ) : null}
                    </div>
                    {actual ? <Etiqueta tono="verde">Vinculada</Etiqueta> : (
                      <Boton disabled={a.bloqueado || !!otra} cargando={a.enviando} onClick={() => void a.enviarAccion("vincular_campania", { campania_id: k.id }, "Campaña vinculada.")}>Vincular</Boton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <ErrorEnvio a={a} exito="Campaña vinculada." />
      </div>
    </Panel>
  );
}

// ── Corrección ──────────────────────────────────────────────────────────────
function FormularioCorreccion({ d, onCerrar, onListo }: { d: DetalleVentaDto; onCerrar: () => void; onListo: (t: string) => void }) {
  const v = d.venta;
  const a = useAccion(d, onListo);
  const [form, setForm] = useState<FormularioVentaDto | null>(null);
  useEffect(() => {
    let vivo = true;
    pedir<FormularioVentaDto>(`${API}/oportunidades/${v.oportunidad_id}/venta`).then((r) => { if (vivo && r.ok) setForm(r.data); });
    return () => { vivo = false; };
  }, [v.oportunidad_id]);
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(v.fecha_acuerdo);
  const [importe, setImporte] = useState(deCentavos(v.importe));
  const [importeOk, setImporteOk] = useState(false);
  const [experiencias, setExperiencias] = useState(String(v.experiencias));
  const [duracion, setDuracion] = useState(String(v.duracion_minutos));
  const [obs, setObs] = useState(v.observacion ?? "");
  const [conComision, setConComision] = useState(false);
  const [fundamento, setFundamento] = useState<Fundamento>(v.comision.fundamento);
  const [tipo, setTipo] = useState<TipoComision>(v.comision.tipo);
  const [beneficiario, setBeneficiario] = useState(v.comision.beneficiario?.id ?? "");
  const [comision, setComision] = useState(deCentavos(v.comision.pactada));
  const [detalle, setDetalle] = useState(v.comision.detalle ?? "");
  const [intervencion, setIntervencion] = useState(d.intervencion?.id ?? "");
  const [comisionOk, setComisionOk] = useState(false);

  const imp = leerImporte(importe);
  const com = tipo === "pactada" ? leerImporte(comision) : null;
  const personalizado = v.producto.codigo === "personalizado";
  const cambiaImporte = imp !== null && imp !== v.importe;
  const comisionVisible = conComision || cambiaImporte;
  const producto = { codigo: v.producto.codigo, precio: v.precio_catalogo, comision_estandar: v.comision_catalogo };
  const pideImporteOk = requiereConfirmarImporte(producto, imp) && imp !== v.importe;
  const origen = d.oportunidad.origen;
  const benEfectivo = fundamento === "origen_comercial" ? origen?.id ?? "" : beneficiario;

  const cambios: Record<string, unknown> = {};
  if (fecha !== v.fecha_acuerdo) cambios.fecha_acuerdo = fecha;
  if (personalizado && Number(experiencias) !== v.experiencias) cambios.experiencias = Number(experiencias);
  if (personalizado && Number(duracion) !== v.duracion_minutos) cambios.duracion_minutos = Number(duracion);
  if (cambiaImporte) cambios.importe = (imp / 100).toFixed(2);
  if (pideImporteOk && importeOk) cambios.importe_confirmado = true;
  if ((obs.trim() || null) !== v.observacion) cambios.observacion = obs.trim() || null;
  if (comisionVisible) {
    const i = form?.intervenciones.find((x) => x.id === intervencion);
    cambios.comision = {
      tipo, fundamento, confirmada: comisionOk,
      ...(tipo === "pactada" ? { importe: com === null ? null : (com / 100).toFixed(2), beneficiario_id: benEfectivo } : {}),
      ...(fundamento === "acuerdo_especial" ? { detalle: detalle.trim() } : {}),
      ...(fundamento === "recompra_trabajada" && i ? { intervencion_visita_id: i.id } : {}),
    };
  }
  const falta = !motivo.trim() ? "El motivo es obligatorio." : !Object.keys(cambios).length ? "No hay cambios." : imp === null ? "Revisá el importe."
    : imp < v.cobrado ? `El importe no puede quedar por debajo de lo cobrado (${formatoPesos(v.cobrado)}).` : pideImporteOk && !importeOk ? "Confirmá el importe."
      : comisionVisible && tipo === "pactada" && (com === null || com <= 0 || !benEfectivo) ? "Completá la comisión."
        : comisionVisible && fundamento === "recompra_trabajada" && !intervencion ? "Vinculá la intervención."
          : comisionVisible && fundamento === "acuerdo_especial" && !detalle.trim() ? "Describí el acuerdo especial."
            : comisionVisible && !comisionOk ? "Confirmá la comisión." : null;
  const fundamentos = FUNDAMENTOS.filter((f) => (v.es_recompra ? f.valor !== "origen_comercial" : f.valor === "origen_comercial" || f.valor === "acuerdo_especial"));
  return (
    <Panel titulo="Corregir la venta" ancho="max-w-3xl" onCerrar={onCerrar} pie={
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={a.enviando} disabled={a.bloqueado || !!falta} onClick={() => void a.enviarAccion("corregir", { motivo: motivo.trim(), cambios }, "Venta corregida (queda en el historial).")}>Guardar corrección</Boton>
        <Boton variante="fantasma" onClick={onCerrar} disabled={a.enviando}>Cancelar</Boton>
      </div>}>
      <div className="space-y-4">
        <Aviso tipo="info">Una corrección arregla un error de carga: lo anterior queda en el historial con el motivo. No es una devolución de dinero (eso no se registra en el CRM).</Aviso>
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Motivo (obligatorio)
          <input className={INPUT} maxLength={300} value={motivo} disabled={a.bloqueado} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm font-semibold text-white/80">Fecha del acuerdo
            <input type="date" className={INPUT} value={fecha} max={d.hoy} disabled={a.bloqueado} onChange={(e) => setFecha(e.target.value)} />
          </label>
          {personalizado ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5 text-sm font-semibold text-white/80">Experiencias
                <input inputMode="numeric" className={INPUT} value={experiencias} disabled={a.bloqueado} onChange={(e) => setExperiencias(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              </label>
              <label className="block space-y-1.5 text-sm font-semibold text-white/80">Minutos c/u
                <input inputMode="numeric" className={INPUT} value={duracion} disabled={a.bloqueado} onChange={(e) => setDuracion(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              </label>
            </div>
          ) : <p className="self-end text-sm text-white/60">Un pack conserva su cantidad y duración.</p>}
        </div>
        <CampoImporte etiqueta="Importe acordado" valor={importe} onCambio={(x) => { setImporte(x); setImporteOk(false); setComisionOk(false); }} deshabilitado={a.bloqueado}
          ayuda={`Cobrado hasta ahora: ${formatoPesos(v.cobrado)} (no puede quedar por debajo).`} />
        {pideImporteOk ? (
          <label className="flex items-start gap-3 rounded-xl border border-amber-500/40 p-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-red-600" checked={importeOk} onChange={(e) => setImporteOk(e.target.checked)} />
            <span>Confirmo el importe de {formatoPesos(imp)} (el de lista al registrar era {formatoPesos(v.precio_catalogo)}).</span>
          </label>
        ) : null}
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-white/80">
          <input type="checkbox" className="h-5 w-5 accent-red-600" checked={comisionVisible} disabled={cambiaImporte || a.bloqueado} onChange={(e) => setConComision(e.target.checked)} />
          Corregir la comisión{cambiaImporte ? " (obligatorio: cambia el importe)" : ""}
        </label>
        {comisionVisible ? (
          <fieldset className="space-y-3 rounded-2xl border border-white/10 p-4">
            <legend className="px-1 text-sm font-bold">Comisión comercial</legend>
            <Chips etiqueta="Fundamento" opciones={fundamentos} valor={fundamento} deshabilitado={a.bloqueado}
              onCambio={(f) => { const x = f ?? v.comision.fundamento; setFundamento(x); setComisionOk(false); if (x === "recompra_espontanea") setTipo("no_corresponde"); else if (x !== "acuerdo_especial") setTipo("pactada"); }} />
            {fundamento === "acuerdo_especial" ? (
              <>
                <Chips etiqueta="¿Lleva comisión?" opciones={[{ valor: "pactada", texto: "Sí" }, { valor: "no_corresponde", texto: "No" }] as const} valor={tipo} onCambio={(x) => { setTipo(x ?? "pactada"); setComisionOk(false); }} />
                <label className="block space-y-1.5 text-sm font-semibold text-white/80">Detalle del acuerdo
                  <input className={INPUT} maxLength={300} value={detalle} onChange={(e) => { setDetalle(e.target.value); setComisionOk(false); }} />
                </label>
              </>
            ) : null}
            {tipo === "pactada" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {fundamento === "origen_comercial" ? <p className="text-sm">Cobra: <strong>{origen?.nombre ?? "—"}</strong> (originó el lead)</p> : (
                  <label className="block space-y-1.5 text-sm font-semibold text-white/80">Cobra la comisión
                    <select className={INPUT} value={beneficiario} onChange={(e) => { setBeneficiario(e.target.value); setIntervencion(""); setComisionOk(false); }}>
                      <option value="">Elegí</option>
                      {(form?.comerciales ?? []).filter((u) => u.activo || u.id === beneficiario).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </label>
                )}
                <CampoImporte etiqueta="Importe de la comisión" valor={comision} onCambio={(x) => { setComision(x); setComisionOk(false); }} />
              </div>
            ) : <p className="text-sm text-white/70">Sin comisión.</p>}
            {fundamento === "recompra_trabajada" ? (
              <label className="block space-y-1.5 text-sm font-semibold text-white/80">Intervención del comercial
                <select className={INPUT} value={intervencion} onChange={(e) => { setIntervencion(e.target.value); setComisionOk(false); }}>
                  <option value="">Elegí su visita</option>
                  {(form?.intervenciones ?? []).filter((i) => i.usuario_id === benEfectivo).map((i) => <option key={i.id} value={i.id}>{fechaHora(i.en)} · {i.descripcion}</option>)}
                </select>
              </label>
            ) : null}
            <label className="flex items-start gap-3 rounded-xl border border-amber-500/40 p-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-red-600" checked={comisionOk} onChange={(e) => setComisionOk(e.target.checked)} />
              <span>Confirmo la comisión corregida: {tipo === "pactada" ? <strong>{formatoPesos(com)}</strong> : <strong>no corresponde</strong>}
                {requiereConfirmarComision(producto, imp, { tipo, fundamento, importe: com }) ? " (se aparta de la regla estándar)" : ""}.
                {v.comision.pagado > 0 ? ` Ya se pagaron ${formatoPesos(v.comision.pagado)}: si no coincide, la comisión queda «a revisar».` : ""}</span>
            </label>
          </fieldset>
        ) : null}
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Observación
          <textarea className={`${INPUT} min-h-20`} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
        <ErrorEnvio a={a} exito="Venta corregida." />
        {falta ? <p className="text-xs text-white/50">{falta}</p> : null}
      </div>
    </Panel>
  );
}

// ── Anulación ───────────────────────────────────────────────────────────────
function DialogoAnular({ d, cobros, pagos, onCerrar, onListo }: { d: DetalleVentaDto; cobros: number; pagos: number; onCerrar: () => void; onListo: (t: string) => void }) {
  const a = useAccion(d, onListo);
  const [motivo, setMotivo] = useState("");
  const bloqueos = [
    cobros ? `Tiene ${cobros} cobro(s) vigente(s): anulalos primero (con motivo).` : null,
    pagos ? `Tiene ${pagos} pago(s) de comisión vigente(s): anulalos primero.` : null,
    d.otra_abierta ? "El negocio tiene otra oportunidad abierta: al anular quedarían dos. Cerrala o marcala perdida antes." : null,
  ].filter((x): x is string => !!x);
  return (
    <Dialogo titulo="Anular venta" onCerrar={onCerrar} acciones={
      <>
        <Boton variante="fantasma" onClick={onCerrar}>Volver</Boton>
        <Boton variante="peligro" cargando={a.enviando} disabled={a.bloqueado || !motivo.trim() || bloqueos.length > 0}
          onClick={() => void a.enviarAccion("anular", { motivo: motivo.trim() }, "Venta anulada: la oportunidad volvió a estar abierta.")}>Anular</Boton>
      </>}>
      <div className="space-y-3">
        <p>Para una venta cargada por error. No se borra: queda anulada con el motivo. La oportunidad vuelve a {d.oportunidad.estado === "ganada" ? "su etapa anterior" : "abierta"} y se puede registrar la venta de nuevo.
          Si la campaña de Empresas estaba vinculada, se libera para otra venta.</p>
        {bloqueos.length ? <Aviso tipo="alerta" titulo="Antes de anular"><ul className="list-disc pl-5">{bloqueos.map((b) => <li key={b}>{b}</li>)}</ul></Aviso> : null}
        <input className={INPUT} maxLength={300} placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo" />
        <ErrorEnvio a={a} exito="Venta anulada." />
      </div>
    </Dialogo>
  );
}

function DialogoMotivo({ d, titulo, exito, texto, accion, datos, onCerrar, onListo }: {
  d: DetalleVentaDto; titulo: string; exito: string; texto: ReactNode; accion: string; datos: Record<string, unknown>; onCerrar: () => void; onListo: (t: string) => void;
}) {
  const a = useAccion(d, onListo);
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo={titulo} onCerrar={onCerrar} acciones={
      <>
        <Boton variante="fantasma" onClick={onCerrar}>Volver</Boton>
        <Boton variante="peligro" cargando={a.enviando} disabled={a.bloqueado || !motivo.trim()} onClick={() => void a.enviarAccion(accion, { ...datos, motivo: motivo.trim() }, exito)}>Anular</Boton>
      </>}>
      <div className="space-y-3">
        <p>{texto}</p>
        <input className={INPUT} maxLength={300} placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo" />
        <ErrorEnvio a={a} exito={exito} />
      </div>
    </Dialogo>
  );
}

// ── Historial ───────────────────────────────────────────────────────────────
const ACCION_TEXTO: Record<string, string> = {
  creacion: "Venta registrada", correccion: "Corrección", anulacion: "Venta anulada", entrega: "Entrega de tarjetas", vinculo_campania: "Campaña de Empresas",
};
const CAMPO_TEXTO: Record<string, string> = {
  fecha_acuerdo: "fecha", experiencias: "experiencias", duracion_minutos: "minutos", importe: "importe", comision_tipo: "tipo de comisión",
  comision_importe: "comisión", comision_beneficiario_id: "beneficiario", comision_fundamento: "fundamento",
};

function Historial({ d }: { d: DetalleVentaDto }) {
  const cambios = (x: Record<string, unknown>) => {
    const antes = (x.antes ?? {}) as Record<string, unknown>;
    const despues = (x.despues ?? {}) as Record<string, unknown>;
    return Object.keys(CAMPO_TEXTO).filter((k) => String(antes[k] ?? "") !== String(despues[k] ?? ""))
      .map((k) => `${CAMPO_TEXTO[k]}: ${String(antes[k] ?? "—")} → ${String(despues[k] ?? "—")}`).join(" · ");
  };
  return (
    <section aria-labelledby="historial-venta" className="space-y-2">
      <h2 id="historial-venta" className="text-xs font-bold uppercase tracking-wide text-white/60">Historial de la venta</h2>
      <ol className="space-y-2">
        {d.historial.map((h, i) => (
          <li key={`${h.en}-${i}`} className="rounded-xl border border-white/10 p-3 text-sm">
            <p className="flex flex-wrap justify-between gap-2"><span className="font-bold">{ACCION_TEXTO[h.accion] ?? h.accion}</span><span className="text-xs text-white/50">{fechaHora(h.en)}</span></p>
            {h.accion === "correccion" ? <p className="text-white/75">Motivo: {String(h.datos.motivo ?? "")}{cambios(h.datos) ? ` · ${cambios(h.datos)}` : ""}</p> : null}
            {h.accion === "anulacion" ? <p className="text-white/75">Motivo: {String(h.datos.motivo ?? "")}</p> : null}
            {h.accion === "entrega" ? <p className="text-white/75">{String(h.datos.despues) === "entregada" ? `Entregadas el ${fechaCorta(String(h.datos.fecha ?? ""))}` : "Vuelta a pendiente"}</p> : null}
            {h.accion === "vinculo_campania" ? <p className="text-white/75">{h.datos.despues ? "Campaña vinculada" : "Campaña desvinculada"}</p> : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-white/50">Los cobros y pagos anulados siguen arriba, marcados, con su motivo.</p>
    </section>
  );
}
