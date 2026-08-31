import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/metricasEquipoAuth.test.ts
// El endpoint de métricas por integrante es EXCLUSIVAMENTE admin.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

{
  const src = read("app/api/admin/metricas/equipo/route.ts");
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers, ["GET"], "equipo: solo expone GET");
  assert.ok(/requireAdmin\(\)/.test(src), "equipo: usa requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(src), "equipo: NO usa requireStaffOrAdmin");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), "equipo: corta si el guard falla");
  // Validación estricta y anti mass-assignment: solo se leen params whitelisted.
  assert.ok(/UUID_RE/.test(src) && /FECHA_RE/.test(src), "equipo: valida UUID y fechas");
  assert.ok(/MAX_DIAS/.test(src), "equipo: limita el rango (anti-consulta amplia)");
  assert.ok(!/select \*/i.test(src), "equipo: no arma SQL arbitrario en el route");
  // No filtra PII de clientes: el reporte no incluye nombre/telefono (se arma en el server).
  assert.ok(!/telefono|nombre_cliente/.test(src), "equipo: el route no maneja PII de clientes");
}

// El server de dominio no debe seleccionar PII de clientes en su salida.
{
  const src = read("lib/metricasEquipoServer.ts");
  assert.ok(/consultarMetricasEquipo/.test(src), "server: expone consultarMetricasEquipo");
  // No se seleccionan nombre/telefono de reservas ni de turnos para el reporte.
  assert.ok(!/\.select\([^)]*telefono/.test(src), "server: no selecciona telefono de clientes");
  assert.ok(/idsReembolsadas/.test(src), "server: reutiliza el contrato de reembolsos (Bloque 3A)");
  assert.ok(/resolverAtribucion|resolverPresencia/.test(src) === true, "server: reutiliza la presencia canónica");
  assert.ok(/calcularHorasMensuales/.test(src), "server: reutiliza el cálculo de horas canónico");
}

console.log("OK — metricasEquipo (auth wiring): GET admin-only, validación estricta, sin PII, reutiliza contratos canónicos (presencia, horas, reembolsos).");
