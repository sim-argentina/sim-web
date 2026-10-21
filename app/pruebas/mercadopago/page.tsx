import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { modoSimulado, simulador } from "@/lib/mercadoPagoSimulado";
import PagoSimulado from "./PagoSimulado";

// Página de pago de Mercado Pago SIMULADA (solo entorno local de pruebas; en
// cualquier otro lado, 404). Reemplaza al checkout real para probar el flujo
// completo en el navegador sin dinero ni red.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mercado Pago (simulado)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ pref?: string | string[] }> }) {
  if (!modoSimulado()) notFound();
  const { pref } = await searchParams;
  let p;
  try {
    p = simulador.obtenerPreferencia(String(Array.isArray(pref) ? pref[0] : pref));
  } catch {
    notFound();
  }
  const total = p.items.reduce((acc, i) => acc + Number(i.unit_price ?? 0) * Number(i.quantity ?? 1), 0);
  return (
    <PagoSimulado
      pref={p.id}
      titulo={p.items[0]?.title ?? "Compra"}
      total={total}
      vence={p.expires ? p.expiration_date_to : null}
      referencia={p.external_reference}
    />
  );
}
