"use client";

// CRM B3 · Compras de un negocio en su ficha (solo Administración) y alta de una
// oportunidad de recompra. Una recompra es una oportunidad NUEVA y una venta nueva:
// nunca se reabre ni se pisa la ganada. Las cifras salen de lib/crmB3.ts
// (resumenCompras): «compras» son acuerdos vigentes; «cobradas» son las que el CRM
// tiene cobradas por completo. Lo anterior al CRM no está cargado.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Repeat } from "lucide-react";
import { Aviso, Boton, Cargando, Etiqueta, Panel } from "@/app/admin/(panel)/interacciones/ui";
import { pedir } from "./api";
import { INPUT, fechaCorta } from "./campos";
import { EtiquetaCobro, EtiquetaComision, MENSAJE_INCIERTO, useEnvio } from "./ventasCampos";
import { formatoPesos } from "@/lib/crmB3";
import type { ContactoDto } from "@/lib/crmB1";
import type { ComprasNegocioDto, ResultadoRecompra } from "@/lib/crmB3Server";

export default function ComprasNegocio({ apiBase, empresaId, contactos, recarga, onCambio }: {
  apiBase: string; empresaId: string; contactos: ContactoDto[]; recarga: number; onCambio: (texto: string) => void;
}) {
  const [d, setD] = useState<ComprasNegocioDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  useEffect(() => {
    let vivo = true;
    pedir<ComprasNegocioDto>(`${apiBase}/negocios/${empresaId}/compras`).then((r) => {
      if (!vivo) return;
      if (r.ok) { setD(r.data); setError(null); } else setError(r.error);
    });
    return () => { vivo = false; };
  }, [apiBase, empresaId, recarga]);

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!d) return <Cargando />;
  const r = d.resumen;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">Compras</h2>
        {d.recompra.posible ? <Boton onClick={() => setNueva(true)}><Repeat className="h-4 w-4" aria-hidden />Nueva oportunidad de recompra</Boton> : null}
      </div>
      {d.cliente_previo ? <Aviso tipo="alerta">Cliente previo: compró antes del CRM y esas compras no están cargadas. El historial de abajo está incompleto.</Aviso> : null}
      {r.compras === 0 ? <p className="text-sm text-white/60">Sin compras registradas en el CRM.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Cifra etiqueta="Compras" valor={String(r.compras)} detalle={`${r.cobradas} cobrada${r.cobradas === 1 ? "" : "s"} por completo`} />
            <Cifra etiqueta="Última compra" valor={fechaCorta(r.ultima)} detalle="Fecha del acuerdo" />
            <Cifra etiqueta="Importe acordado" valor={formatoPesos(r.acordado)} detalle={`Cobrado según CRM ${formatoPesos(r.cobrado)}`} />
            <Cifra etiqueta="Saldo" valor={formatoPesos(r.saldo)} detalle={r.packs.map((p) => `${p.compras} × ${p.nombre}`).join(" · ")} />
          </dl>
          <p className="text-xs text-white/50">Compras = acuerdos vigentes registrados (con o sin cobro); las anuladas no cuentan. Sin IVA ni comprobantes.</p>
        </>
      )}
      {d.ventas.length ? (
        <ul className="space-y-2">
          {d.ventas.map((v) => (
            <li key={v.id}>
              <Link href={`/admin/crm/ventas/${v.id}`} className={`block rounded-2xl border p-3 text-sm hover:border-white/30 ${v.anulada ? "border-white/5 opacity-60" : "border-white/10"}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{v.producto.nombre}</strong> · {fechaCorta(v.fecha_acuerdo)} · {formatoPesos(v.importe)}
                  {v.es_recompra ? <Etiqueta tono="gris">Recompra</Etiqueta> : null}
                  {v.anulada ? <Etiqueta tono="gris">Anulada</Etiqueta> : <><EtiquetaCobro estado={v.estado_cobro} /><EtiquetaComision estado={v.comision.estado} /></>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!d.recompra.posible && d.recompra.motivo && (r.compras > 0 || d.cliente_previo) ? <p className="text-xs text-white/50">Recompra: {d.recompra.motivo}</p> : null}
      {nueva ? (
        <NuevaRecompra apiBase={apiBase} empresaId={empresaId} contactos={contactos.filter((c) => !c.archivado)} onCerrar={() => setNueva(false)}
          onListo={(texto) => { setNueva(false); onCambio(texto); }} />
      ) : null}
    </section>
  );
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-xs font-semibold text-white/60">{etiqueta}</dt>
      <dd className="text-base font-black">{valor}</dd>
      {detalle ? <dd className="text-xs text-white/50">{detalle}</dd> : null}
    </div>
  );
}

function NuevaRecompra({ apiBase, empresaId, contactos, onCerrar, onListo }: {
  apiBase: string; empresaId: string; contactos: ContactoDto[]; onCerrar: () => void; onListo: (texto: string) => void;
}) {
  const envio = useEnvio();
  const [contacto, setContacto] = useState(contactos.length === 1 ? contactos[0].id : "");
  const [obs, setObs] = useState("");
  const [vence, setVence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bloqueado = envio.enviando || envio.incierto;
  async function tratar(r: Awaited<ReturnType<typeof envio.reintentar<ResultadoRecompra>>>) {
    if (!r) return;
    if (r.ok) { onListo(r.data.repetida ? "La oportunidad ya estaba creada (no se duplicó)." : "Oportunidad de recompra creada: ya figura en «Seguimiento»."); return; }
    setError(r.incierto ? MENSAJE_INCIERTO : r.error);
  }
  const datos = { contacto_id: contacto, ...(obs.trim() ? { observacion: obs.trim() } : {}), ...(vence ? { proxima: { vence_el: vence } } : {}) };
  return (
    <Panel titulo="Nueva oportunidad de recompra" onCerrar={onCerrar} pie={
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" cargando={envio.enviando} disabled={bloqueado || !contacto}
          onClick={async () => tratar(await envio.mandar<ResultadoRecompra>(`${apiBase}/negocios/${empresaId}/recompra`, "POST", { datos }))}>Crear oportunidad</Boton>
        <Boton variante="fantasma" onClick={onCerrar} disabled={envio.enviando}>Cancelar</Boton>
      </div>}>
      <div className="space-y-4">
        <p className="text-sm text-white/70">Es una oportunidad nueva para una venta nueva (la ganada no se reabre). Entra al seguimiento como creada por Administración; la comisión se decide al registrar la venta.</p>
        {contactos.length === 0 ? <Aviso tipo="alerta">El negocio no tiene contactos activos: cargá uno en la ficha primero.</Aviso> : (
          <label className="block space-y-1.5 text-sm font-semibold text-white/80">Contacto
            <select className={INPUT} value={contacto} disabled={bloqueado} onChange={(e) => setContacto(e.target.value)}>
              <option value="">Elegí un contacto existente</option>
              {contactos.map((c) => <option key={c.id} value={c.id}>{c.nombre ?? c.telefono ?? "Contacto"}{c.cargo ? ` · ${c.cargo}` : ""}</option>)}
            </select>
          </label>
        )}
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Nota (opcional)
          <textarea className={`${INPUT} min-h-20`} maxLength={1000} value={obs} disabled={bloqueado} onChange={(e) => setObs(e.target.value)} placeholder="Llamó para repetir, se acerca su aniversario…" />
        </label>
        <label className="block space-y-1.5 text-sm font-semibold text-white/80">Próxima acción (opcional)
          <input type="date" className={INPUT} value={vence} disabled={bloqueado} onChange={(e) => setVence(e.target.value)} />
        </label>
        {error ? (
          <Aviso tipo={envio.incierto ? "alerta" : "error"} acciones={envio.incierto ? (
            <>
              <Boton variante="primario" cargando={envio.enviando} onClick={async () => tratar(await envio.reintentar<ResultadoRecompra>())}>Reintentar</Boton>
              <Boton variante="fantasma" onClick={() => { envio.descartar(); setError(null); }}>Descartar</Boton>
            </>
          ) : undefined}>{error}</Aviso>
        ) : null}
      </div>
    </Panel>
  );
}
