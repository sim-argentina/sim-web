import Link from "next/link";
import FichaNegocio from "@/components/crm/FichaNegocio";

// CRM · Ficha de negocio (B1): datos, asignación, contactos, lead, revisita y visitas
// (corrección y anulación con motivo; registro de una visita realizada por un comercial).
export default async function CrmNegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Link href="/admin/crm/negocios" className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-white/70 hover:text-white">← Negocios</Link>
      <FichaNegocio modo="admin" apiBase="/api/admin/crm" id={id} baseJornada="/admin/crm/jornadas/" baseSeguimiento="/admin/crm/seguimiento?op=" />
    </>
  );
}
