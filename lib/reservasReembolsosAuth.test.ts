import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/reservasReembolsosAuth.test.ts
// El registro/lectura de reembolsos es EXCLUSIVAMENTE admin (la API es la autoridad).
// El GET de disponibilidad NO debe filtrar el detalle del reembolso a staff.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 1) Endpoint de reembolso: admin-only + anti mass-assignment.
{
  const src = read("app/api/admin/reservas/[id]/reembolso/route.ts");
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.ok(handlers.includes("POST"), "reembolso: tiene POST");
  assert.ok(/requireAdmin\(\)/.test(src), "reembolso: usa requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(src), "reembolso: NO usa requireStaffOrAdmin");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), "reembolso: corta si el guard falla");
  // Confirmación obligatoria.
  assert.ok(/confirmacion\s*!==\s*true/.test(src), "reembolso: exige confirmacion === true");
  // Solo se leen los 3 campos permitidos del body; NUNCA monto/estado/actor/timestamps/IDs internos.
  assert.ok(/body\??\.fecha_reembolso/.test(src), "reembolso: lee fecha_reembolso");
  assert.ok(/body\??\.motivo/.test(src), "reembolso: lee motivo");
  for (const prohibido of ["body.monto", "body.monto_reembolsado", "body.estado", "body.actor", "body.reserva_id", "body.created_at", "body.payment"]) {
    assert.ok(!src.includes(prohibido), `reembolso: NO acepta ${prohibido} (anti mass-assignment)`);
  }
}

// 2) GET /api/reservas: el detalle del reembolso se adjunta SOLO para admin.
{
  const src = read("app/api/reservas/route.ts");
  assert.ok(/role === "admin"/.test(src), "reservas GET: detalle de reembolso gateado a role === 'admin'");
  assert.ok(/reservas_reembolsos/.test(src), "reservas GET: consulta reservas_reembolsos");
}

// 3) PATCH /api/reservas/[id]: una reserva reembolsada no puede reactivarse.
{
  const src = read("app/api/reservas/[id]/route.ts");
  assert.ok(/requireAdmin\(\)/.test(src), "reservas PATCH: admin-only");
  assert.ok(/reembolsada/.test(src), "reservas PATCH: bloquea estado reembolsada");
}

console.log("OK — reservasReembolsos (auth wiring): POST reembolso admin-only + anti mass-assignment; detalle solo admin; PATCH no reactiva reembolsada.");
