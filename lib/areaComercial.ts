// Área comercial del CRM: "/comercial" y todo lo que cuelga de ahí. Puro y sin
// dependencias: lo usan el middleware (edge), componentes de cliente y pruebas.
// "/comerciales" (u otra ruta que solo empiece igual) NO es el área comercial.

export const PREFIJO_COMERCIAL = "/comercial";

export function esAreaComercial(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.split("?")[0].split("#")[0];
  return p === PREFIJO_COMERCIAL || p.startsWith(`${PREFIJO_COMERCIAL}/`);
}
