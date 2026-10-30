"use client";

// Productos y comisiones de lista del CRM (B3). Cambiar un precio o una comisión
// vale para las ventas que se registren después: cada venta guarda la foto de las
// condiciones con que se registró. Desactivar un producto lo saca del formulario
// de venta. La cantidad y la duración de los packs son fijas.

import { useEffect, useState } from "react";
import { Aviso, Boton, Cargando, Etiqueta } from "../../interacciones/ui";
import { enviar, pedir } from "@/components/crm/api";
import { CampoImporte, deCentavos } from "@/components/crm/ventasCampos";
import { formatoPesos, leerImporte, type Producto } from "@/lib/crmB3";

export default function ProductosCrm() {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vivo = true;
    pedir<{ productos: Producto[] }>("/api/admin/crm/productos").then((r) => {
      if (!vivo) return;
      if (r.ok) setProductos(r.data.productos); else setAviso({ ok: false, texto: r.error });
    });
    return () => { vivo = false; };
  }, [recarga]);
  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.02] p-4 md:p-6">
      <div>
        <h2 className="text-lg font-black">Productos y comisiones</h2>
        <p className="text-sm text-white/60">Precio y comisión de lista para las próximas ventas. Las ventas ya registradas conservan sus condiciones. Importes sin IVA.</p>
      </div>
      <div aria-live="polite">{aviso ? <Aviso tipo={aviso.ok ? "exito" : "error"}>{aviso.texto}</Aviso> : null}</div>
      {!productos ? <Cargando /> : (
        <ul className="space-y-3">
          {productos.map((p) => <Fila key={`${p.codigo}-${p.version}`} p={p} onCambio={(ok, texto) => { setAviso({ ok, texto }); if (ok) setRecarga((n) => n + 1); }} />)}
        </ul>
      )}
    </section>
  );
}

function Fila({ p, onCambio }: { p: Producto; onCambio: (ok: boolean, texto: string) => void }) {
  const [precio, setPrecio] = useState(deCentavos(p.precio));
  const [comision, setComision] = useState(deCentavos(p.comision_estandar));
  const [trabajando, setTrabajando] = useState(false);
  const personalizado = p.codigo === "personalizado";
  const pr = leerImporte(precio);
  const co = leerImporte(comision);
  const cambios: Record<string, unknown> = {};
  if (!personalizado && pr !== null && pr !== p.precio) cambios.precio = (pr / 100).toFixed(2);
  if (!personalizado && co !== null && co !== p.comision_estandar) cambios.comision_estandar = (co / 100).toFixed(2);
  const guardar = async (c: Record<string, unknown>, exito: string) => {
    setTrabajando(true);
    const r = await enviar("/api/admin/crm/productos", "PATCH", { codigo: p.codigo, version: p.version, cambios: c });
    setTrabajando(false);
    onCambio(r.ok, r.ok ? exito : r.error);
  };
  return (
    <li className="space-y-3 rounded-2xl border border-white/10 p-4">
      <p className="flex flex-wrap items-center gap-2 font-bold">{p.nombre}
        <span className="text-sm font-normal text-white/60">{personalizado ? `desde ${p.minimo_experiencias} experiencias · importe y comisión a mano` : `${p.experiencias} × ${p.duracion_minutos} min`}</span>
        {!p.activo ? <Etiqueta tono="gris">Inactivo</Etiqueta> : null}</p>
      {!personalizado ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoImporte etiqueta="Precio de lista" valor={precio} onCambio={setPrecio} ayuda={`Actual: ${formatoPesos(p.precio)}`} />
          <CampoImporte etiqueta="Comisión de lista" valor={comision} onCambio={setComision} ayuda={`Actual: ${formatoPesos(p.comision_estandar)}`} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!personalizado ? <Boton variante="primario" disabled={trabajando || !Object.keys(cambios).length || pr === null || co === null}
          onClick={() => void guardar(cambios, `${p.nombre}: guardado. Vale para las ventas que se registren desde ahora.`)}>Guardar</Boton> : null}
        <Boton disabled={trabajando} onClick={() => void guardar({ activo: !p.activo }, p.activo ? `${p.nombre} desactivado.` : `${p.nombre} activado.`)}>{p.activo ? "Desactivar" : "Activar"}</Boton>
      </div>
    </li>
  );
}
