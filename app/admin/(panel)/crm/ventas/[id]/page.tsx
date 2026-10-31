import Link from "next/link";
import DetalleVenta from "@/components/crm/DetalleVenta";

// CRM · Detalle de una venta (B3): acuerdo, cobros, comisión, tarjetas y campaña.
export default async function CrmVentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Link href="/admin/crm/ventas" className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-white/70 hover:text-white">← Ventas</Link>
      <DetalleVenta id={id} />
    </>
  );
}
