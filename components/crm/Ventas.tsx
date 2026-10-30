"use client";

// CRM B3 · Lista de ventas (solo Administración). Filtros por fecha de acuerdo,
// negocio, pack, cobro y comisión; los totales y los pendientes salen de la MISMA
// lista filtrada que se muestra (las anuladas no suman). «Importe acordado» y
// «Cobrado según CRM» son el acuerdo comercial y lo registrado a mano: no es
// facturación ni Finanzas.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Aviso, Cargando, Etiqueta, Plegable, cx } from "@/app/admin/(panel)/interacciones/ui";
import { pedir } from "./api";
import { INPUT, fechaCorta } from "./campos";
import { EtiquetaCobro, EtiquetaComision } from "./ventasCampos";
import { ESTADOS_COBRO, ESTADOS_COMISION, PENDIENTES, formatoPesos, type Pendiente } from "@/lib/crmB3";
import type { VentasDto } from "@/lib/crmB3Server";

const API = "/api/admin/crm";
const VACIOS = { desde: "", hasta: "", producto: "", cobro: "", comision: "" };

export default function Ventas() {
  const [q, setQ] = useState("");
  const [f, setF] = useState(VACIOS);
  const [pendiente, setPendiente] = useState<Pendiente | "">("");
  const [anuladas, setAnuladas] = useState(false);
  const [verFiltros, setVerFiltros] = useState(false);
  const [datos, setDatos] = useState<VentasDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consulta = useMemo(() => {
    const u = new URLSearchParams();
    if (q.trim()) u.set("q", q.trim());
    for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
    if (pendiente) u.set("pendiente", pendiente);
    if (anuladas) u.set("anuladas", "1");
    return u.toString();
  }, [q, f, pendiente, anuladas]);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      pedir<VentasDto>(`${API}/ventas?${consulta}`).then((r) => {
        if (!vivo) return;
        if (r.ok) { setDatos(r.data); setError(null); } else setError(r.error);
      });
    }, q ? 250 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [consulta, q]);

  const activos = Object.values(f).filter(Boolean).length + (anuladas ? 1 : 0);
  const t = datos?.totales;
  return (
    <div className="space-y-5">
      <div>
        <h1 id="titulo-pagina" tabIndex={-1} className="text-3xl font-black outline-none">Ventas</h1>
        <p className="mt-1 text-sm text-white/60">Acuerdos comerciales cerrados, sus cobros y la comisión comercial. Se cargan a mano: no hay cobros reales ni facturación.</p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Pendientes">
        <BotonPendiente activo={pendiente === ""} onClick={() => setPendiente("")} texto="Todas" n={datos?.totales.ventas} />
        {PENDIENTES.map((p) => (
          <BotonPendiente key={p.valor} activo={pendiente === p.valor} onClick={() => setPendiente(pendiente === p.valor ? "" : p.valor)} texto={p.texto} n={datos?.pendientes[p.valor]} alerta />
        ))}
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-white/40" aria-hidden />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar negocio" aria-label="Buscar negocio" />
        </div>
        <Plegable titulo="Filtros" abierto={verFiltros} onAlternar={() => setVerFiltros((x) => !x)} resumen={activos ? `${activos} activo${activos > 1 ? "s" : ""}` : "ninguno"}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Acuerdo desde
              <input type="date" className={INPUT} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold text-white/80">Acuerdo hasta
              <input type="date" className={INPUT} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
            </label>
            <Filtro etiqueta="Pack" valor={f.producto} onCambio={(v) => setF({ ...f, producto: v })} opciones={(datos?.opciones.productos ?? []).map((p) => ({ valor: p.codigo, texto: p.nombre }))} />
            <Filtro etiqueta="Cobro" valor={f.cobro} onCambio={(v) => setF({ ...f, cobro: v })} opciones={ESTADOS_COBRO.map((e) => ({ valor: e.valor, texto: e.texto }))} />
            <Filtro etiqueta="Comisión" valor={f.comision} onCambio={(v) => setF({ ...f, comision: v })} opciones={ESTADOS_COMISION.map((e) => ({ valor: e.valor, texto: e.texto }))} />
            <label className="flex min-h-11 items-center gap-2 self-end text-sm font-semibold text-white/80">
              <input type="checkbox" className="h-5 w-5 accent-red-600" checked={anuladas} onChange={(e) => setAnuladas(e.target.checked)} />Mostrar también las anuladas
            </label>
          </div>
          {activos ? <button type="button" className="min-h-11 text-sm font-semibold text-white/70 underline" onClick={() => { setF(VACIOS); setAnuladas(false); }}>Quitar filtros</button> : null}
        </Plegable>
      </div>

      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!datos || !t ? <Cargando /> : (
        <>
          <section aria-label="Totales" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Total etiqueta="Importe acordado" valor={formatoPesos(t.acordado)} detalle={`${t.ventas} venta${t.ventas === 1 ? "" : "s"}`} />
            <Total etiqueta="Cobrado según CRM" valor={formatoPesos(t.cobrado)} />
            <Total etiqueta="Saldo por cobrar" valor={formatoPesos(t.saldo)} alerta={t.saldo > 0} />
            <Total etiqueta="Comisión comercial pactada" valor={formatoPesos(t.comision_pactada)} />
            <Total etiqueta="Comisión pagada" valor={formatoPesos(t.comision_pagada)} />
            <Total etiqueta="Comisión a pagar" valor={formatoPesos(t.comision_a_pagar)} detalle="Ya generada" alerta={t.comision_a_pagar > 0} />
          </section>
          <p className="text-xs text-white/50">Totales de la lista filtrada, sin las ventas anuladas. Sin IVA ni comprobantes: no se suman a Finanzas.</p>

          {datos.filas.length === 0 ? <p className="text-sm text-white/60">No hay ventas con estos filtros.</p> : (
            <ul className="space-y-2">
              {datos.filas.map((v) => (
                <li key={v.id}>
                  <Link href={`/admin/crm/ventas/${v.id}`}
                    className={cx("block space-y-1.5 rounded-2xl border p-4 hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400",
                      v.anulada ? "border-white/5 opacity-60" : "border-white/10 bg-white/[0.03]")}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-black">{v.empresa.nombre}</span>
                      <Etiqueta>{v.producto.nombre}</Etiqueta>
                      {v.es_recompra ? <Etiqueta tono="gris">Recompra</Etiqueta> : null}
                      {v.anulada ? <Etiqueta tono="gris">Anulada</Etiqueta> : null}
                    </span>
                    <span className="block text-sm text-white/80">
                      Acuerdo del {fechaCorta(v.fecha_acuerdo)} · {formatoPesos(v.importe)} · cobrado {formatoPesos(v.cobrado)}{v.saldo > 0 && !v.anulada ? ` · saldo ${formatoPesos(v.saldo)}` : ""}
                    </span>
                    {!v.anulada ? (
                      <span className="flex flex-wrap gap-1.5">
                        <EtiquetaCobro estado={v.estado_cobro} />
                        <EtiquetaComision estado={v.comision.estado} />
                        <Etiqueta tono={v.entrega.estado === "entregada" ? "verde" : "ambar"}>{v.entrega.estado === "entregada" ? "Tarjetas entregadas" : "Tarjetas sin entregar"}</Etiqueta>
                      </span>
                    ) : <span className="block text-sm text-white/60">Anulada: {v.anulada.motivo}</span>}
                    {v.comision.beneficiario && !v.anulada ? (
                      <span className="block text-xs text-white/50">Comisión {formatoPesos(v.comision.pactada)} para {v.comision.beneficiario.nombre}{v.comision.pendiente > 0 ? ` · falta pagar ${formatoPesos(v.comision.pendiente)}` : ""}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Filtro({ etiqueta, valor, onCambio, opciones }: { etiqueta: string; valor: string; onCambio: (v: string) => void; opciones: Array<{ valor: string; texto: string }> }) {
  return (
    <label className="block space-y-1.5 text-sm font-semibold text-white/80">{etiqueta}
      <select className={INPUT} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Todos</option>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  );
}

function BotonPendiente({ activo, onClick, texto, n, alerta }: { activo: boolean; onClick: () => void; texto: string; n?: number; alerta?: boolean }) {
  return (
    <button type="button" aria-pressed={activo} onClick={onClick}
      className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold",
        activo ? "border-red-500 bg-red-600 text-white" : "border-white/15 text-white/80 hover:border-white/40")}>
      {texto}
      {n !== undefined ? <span className={cx("rounded-full px-2 text-xs font-black", activo ? "bg-white/20" : alerta && n > 0 ? "bg-red-600 text-white" : "bg-white/10")}>{n}</span> : null}
    </button>
  );
}

function Total({ etiqueta, valor, detalle, alerta }: { etiqueta: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <div className={cx("rounded-2xl border p-3", alerta ? "border-amber-500/40 bg-amber-950/10" : "border-white/10 bg-white/[0.03]")}>
      <p className="text-xs font-semibold text-white/60">{etiqueta}</p>
      <p className="text-lg font-black">{valor}</p>
      {detalle ? <p className="text-xs text-white/50">{detalle}</p> : null}
    </div>
  );
}
