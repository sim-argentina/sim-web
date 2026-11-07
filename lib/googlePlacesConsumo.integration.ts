import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { contadorGooglePlaces, TABLA_CONSUMO } from "@/lib/googlePlacesConsumo";
import { hoyEnSim } from "@/lib/agenda";

// Ejecutar SOLO contra la base LOCAL: node scripts/pruebas/correr-mutantes.mjs lib/googlePlacesConsumo.integration.ts
// Tope diario compartido de Google Places (db/google-places-consumo.sql) por la
// ruta REAL (supabase-js → PostgREST → RPC), con pedidos SIMULTÁNEOS: varias
// instancias reservando a la vez nunca superan el tope. No consulta a Google.
//
// La tabla no admite borrar ni escribir directo (service_role solo lee), así que
// la prueba trabaja RELATIVA a lo que ya haya contado hoy la base local.

async function llamadasHoy(): Promise<number> {
  const { data, error } = await supabaseAdmin.from(TABLA_CONSUMO).select("llamadas").eq("fecha", hoyEnSim(new Date())).maybeSingle();
  if (error) throw new Error(error.message);
  return Number((data as { llamadas?: number } | null)?.llamadas ?? 0);
}

async function main() {
  // 1) service_role no escribe la tabla directo: solo por la RPC.
  const directo = await supabaseAdmin.from(TABLA_CONSUMO).insert({ fecha: "2000-01-01", llamadas: 1 });
  assert.ok(directo.error, "insert directo rechazado");

  // 2) 20 reservas simultáneas con cupo para 5: pasan exactamente 5.
  const base = await llamadasHoy();
  const contador = contadorGooglePlaces(base + 5);
  const resultados = await Promise.all(Array.from({ length: 20 }, () => contador.reservar(false)));
  const ok = resultados.filter((r) => r.ok);
  const llamadasReservadas = ok.map((r) => (r.ok ? r.llamada : 0)).sort((a, b) => a - b);
  assert.equal(ok.length, 5, `pasaron ${ok.length} de 20 con cupo 5`);
  assert.deepEqual(llamadasReservadas, [1, 2, 3, 4, 5].map((n) => base + n), "números de llamada consecutivos, sin repetidos");
  assert.ok(resultados.filter((r) => !r.ok).every((r) => !r.ok && r.motivo === "tope"), "el resto: tope");
  assert.equal(await llamadasHoy(), base + 5, "el contador quedó exactamente en el tope");

  // 3) Forzado (diagnóstico admin): cuenta aunque el tope se haya alcanzado.
  const forzada = await contador.reservar(true);
  assert.deepEqual(forzada, { ok: true, llamada: base + 6 });
  const estado = await contador.leer();
  assert.deepEqual(estado, { operativo: true, fecha: hoyEnSim(new Date()), llamadas: base + 6, tope: base + 5 });

  // 4) Tope 0: nada se reserva.
  assert.deepEqual(await contadorGooglePlaces(0).reservar(false), { ok: false, motivo: "tope" });
  assert.equal(await llamadasHoy(), base + 6);

  console.log(`OK — googlePlacesConsumo (base local): 20 reservas simultáneas con cupo 5 → 5 exactas y consecutivas, forzada cuenta sobre el tope, tope 0 cerrado, sin escritura directa (contador del día: ${base + 6}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
