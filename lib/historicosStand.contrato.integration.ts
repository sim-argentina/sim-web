import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hoyEnSim } from "@/lib/agenda";
import { filaHistoricaCanonica, normalizarMetodoPago, validarFechaHistorica } from "@/lib/historicosStand";

// Contrato de SOLO LECTURA sobre turnos_historicos (los Excel importados en Métricas).
// Vigila la firma del defecto que corrigió db/turnos-historicos-correccion-anio.sql:
// ventas de octubre a diciembre de 2025 guardadas como 2026 porque el importador
// usaba el año actual.
//   · ninguna fecha futura ni inexistente;
//   · ninguna venta registrada ANTES de que empezara su propio mes (imposible);
//   · el hash empieza por `archivo_key|fecha|`, así reimportar con el año correcto
//     no duplica;
//   · las tres plantillas de octubre a diciembre están en 2025;
//   · el pago está normalizado y el hash guardado es el canónico (el que recalcula
//     el servidor al importar): si no, reimportar esa venta la duplicaría
//     (db/turnos-historicos-transferencias.sql unificó TRASF/TRANF).
//
//   npx tsx --env-file=.env.local lib/historicosStand.contrato.integration.ts

const ZONA = "America/Argentina/Cordoba";
const PLANTILLAS_2025: Record<string, string> = {
  "plantilla-turnos-nuevo-centro-octubre-xlsx": "2025-10",
  "plantilla-turnos-nuevo-centro-noviembre-xlsx": "2025-11",
  "plantilla-turnos-nuevo-centro-diciembre-xlsx": "2025-12",
};

/** Fecha calendario de Argentina de un instante (YYYY-MM-DD). */
function fechaAr(instante: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));
}

async function main() {
  const filas: (Record<string, unknown> & { id: number; archivo_key: string; fecha: string; hash_unico: string; created_at: string; metodo_pago: string })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("turnos_historicos")
      .select("*")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    filas.push(...((data ?? []) as typeof filas));
    if (!data || data.length < 1000) break;
  }

  const hoy = hoyEnSim();
  const fallas: string[] = [];
  for (const f of filas) {
    const invalida = validarFechaHistorica(f.fecha, hoy);
    if (invalida) fallas.push(`id ${f.id}: ${invalida}`);
    if (!f.hash_unico.startsWith(`${f.archivo_key}|${f.fecha}|`)) fallas.push(`id ${f.id}: el hash no corresponde a la fecha ${f.fecha}`);
    if (f.created_at && fechaAr(f.created_at).slice(0, 7) < f.fecha.slice(0, 7)) {
      fallas.push(`id ${f.id}: registrada el ${fechaAr(f.created_at)}, antes de su mes ${f.fecha.slice(0, 7)}`);
    }
    const esperado = PLANTILLAS_2025[f.archivo_key];
    if (esperado && f.fecha.slice(0, 7) !== esperado) fallas.push(`id ${f.id}: ${f.archivo_key} en ${f.fecha}, se esperaba ${esperado}`);
    if (normalizarMetodoPago(f.metodo_pago) !== f.metodo_pago) fallas.push(`id ${f.id}: pago sin normalizar (${f.metodo_pago})`);
    if (filaHistoricaCanonica(f).hash_unico !== f.hash_unico) fallas.push(`id ${f.id}: el hash guardado no es el canónico; reimportarla la duplicaría`);
  }

  assert.equal(fallas.length, 0, `turnos_historicos inconsistentes (${fallas.length}):\n${fallas.slice(0, 10).join("\n")}`);
  console.log(`OK — ${filas.length} históricos: sin fechas futuras ni anteriores a su carga, hash alineado con la fecha, plantillas de oct–dic en 2025, pagos normalizados y hash canónico.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
