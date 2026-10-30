import { ListaJornadas } from "@/components/crm/Jornadas";

// CRM · Jornadas (B1): de todos los comerciales, con filtros y carga de una jornada realizada.
export default function CrmJornadasPage() {
  return (
    <>
      <h1 id="titulo-pagina" tabIndex={-1} className="mb-4 text-3xl font-black outline-none">Jornadas</h1>
      <ListaJornadas modo="admin" apiBase="/api/admin/crm" baseJornada="/admin/crm/jornadas/" />
    </>
  );
}
