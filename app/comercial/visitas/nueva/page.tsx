import { Marco, SinVerificar, exigirComercial } from "../../_componentes/guardia";
import NuevaVisita from "../../_componentes/NuevaVisita";

// Registrar visita (CRM B1). ?negocio=<id> la abre con ese negocio elegido.
export const metadata = { title: "Registrar visita" };

export default async function NuevaVisitaPage({ searchParams }: { searchParams: Promise<{ negocio?: string }> }) {
  const s = await exigirComercial();
  if (!s) return <SinVerificar />;
  const { negocio } = await searchParams;
  return (
    <Marco titulo="Registrar visita" volver={{ href: "/comercial", texto: "Inicio" }}>
      <NuevaVisita usuarioId={s.usuarioId} negocioId={negocio && /^[0-9a-f-]{36}$/i.test(negocio) ? negocio : null} />
    </Marco>
  );
}
