import Link from "next/link";
import { DetalleJornada } from "@/components/crm/Jornadas";

// CRM · Detalle de jornada (B1): km, gastos, cierre y visitas.
export default async function CrmJornadaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Link href="/admin/crm/jornadas" className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-white/70 hover:text-white">← Jornadas</Link>
      <DetalleJornada modo="admin" apiBase="/api/admin/crm" id={id} baseNegocio="/admin/crm/negocios/" />
    </>
  );
}
