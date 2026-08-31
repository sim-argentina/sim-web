import { strict as assert } from "node:assert";
import { ejecutarChat } from "@/lib/ia/orchestrator";
import { FakeProviderGuionado, type GuionTurno } from "@/lib/ia/providerFake";
import { HERRAMIENTAS } from "@/lib/ia/tools";
import { getLimites } from "@/lib/ia/config";
import { consultarMetricasEquipo } from "@/lib/metricasEquipoServer";

// Integración (read-only) del orquestador + herramientas reales, con proveedor
// GUIONADO determinístico. NO escribe datos. NO usa la API de Claude.
//   npx tsx --env-file=.env.local lib/ia/orchestrator.integration.ts
const MODELOS = { economico: "m-eco", potente: "m-pot" } as const;
const base = (guion: GuionTurno[]) => ({
  provider: new FakeProviderGuionado(guion), modelos: MODELOS, limites: getLimites(), historialPrevio: [], pregunta: "test",
});

async function main() {
  // 1) Sin herramientas → texto directo.
  let r = await ejecutarChat(base([{ tipo: "texto", texto: "Respuesta directa." }]));
  assert.equal(r.estado, "completa"); assert.equal(r.texto, "Respuesta directa."); assert.equal(r.herramientas.length, 0);

  // 2) Una herramienta real (empleados) → ejecutada, con fuente.
  r = await ejecutarChat(base([{ tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }] }, { tipo: "texto", texto: "Listo." }]));
  assert.equal(r.estado, "completa");
  assert.equal(r.herramientas.length, 1);
  assert.ok(r.herramientas[0].ok, "empleados ok");
  assert.ok(r.fuentes.some((f) => f.modulo === "Empleados"), "fuente Empleados presente");

  // 3) Herramienta inexistente → rechazada de forma segura.
  r = await ejecutarChat(base([{ tipo: "herramientas", llamadas: [{ nombre: "consultar_secretos", input: {} }] }, { tipo: "texto", texto: "ok" }]));
  assert.ok(r.herramientas.some((h) => !h.ok && h.error === "herramienta_inexistente"), "herramienta inexistente rechazada");

  // 4) Parámetros inválidos → error controlado (no rompe).
  r = await ejecutarChat(base([{ tipo: "herramientas", llamadas: [{ nombre: "consultar_finanzas", input: { anio: 1999, mes: 99 } }] }, { tipo: "texto", texto: "ok" }]));
  assert.ok(r.herramientas.some((h) => !h.ok && /inválid|Año|Mes/i.test(h.error || "")), "params inválidos rechazados");

  // 5) Máximo de rondas → termina (no loop infinito).
  const lim = { ...getLimites(), rondasHerramientasMax: 2 };
  const guionLargo = [
    { tipo: "herramientas" as const, llamadas: [{ nombre: "consultar_empleados", input: {} }] },
    { tipo: "herramientas" as const, llamadas: [{ nombre: "consultar_empleados", input: {} }] },
    { tipo: "herramientas" as const, llamadas: [{ nombre: "consultar_empleados", input: {} }] },
  ];
  r = await ejecutarChat({ provider: new FakeProviderGuionado(guionLargo), modelos: MODELOS, limites: lim, historialPrevio: [], pregunta: "test" });
  assert.equal(r.estado, "completa", "termina al tope de rondas con texto");
  assert.ok(r.rondas <= lim.rondasHerramientasMax, `rondas ${r.rondas} <= ${lim.rondasHerramientasMax}`);

  // 6) Escalamiento a modelo potente por rondas.
  r = await ejecutarChat(base([
    { tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }] },
    { tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }] },
    { tipo: "herramientas", llamadas: [{ nombre: "consultar_empleados", input: {} }] },
    { tipo: "texto", texto: "fin" },
  ]));
  assert.equal(r.escalado, true, "escaló");
  assert.equal(r.modelo, MODELOS.potente, "modelo potente tras escalar");

  // 7) Error del proveedor → estado error (mensaje seguro).
  r = await ejecutarChat(base([{ tipo: "error", mensaje: "boom" }]));
  assert.equal(r.estado, "error", "estado error");

  // 8) EXACTITUD: consultar_metricas_equipo agosto coincide con el motor 3B.
  const tool = await HERRAMIENTAS.consultar_metricas_equipo.ejecutar({ anio: 2026, mes: 8 });
  const payload = JSON.parse(tool.contenido) as { integrantes: Array<{ nombre: string; turnos_cantidad: number; facturacion_bruta_pesos: number }>; reconciliacion: { ok: boolean } };
  const ref = await consultarMetricasEquipo({ desde: "2026-08-01", hasta: "2026-08-31" });
  const fedeTool = payload.integrantes.find((i) => i.nombre === "Federico")!;
  const fedeRef = ref.integrantes.find((i) => i.nombre === "Federico")!;
  assert.equal(fedeTool.turnos_cantidad, fedeRef.total.turnos, "turnos Federico coinciden con 3B");
  assert.equal(fedeTool.facturacion_bruta_pesos, fedeRef.total.bruto, "bruto Federico coincide con 3B");
  assert.ok(payload.reconciliacion.ok, "reconciliación ok vía herramienta");

  // 9) Finanzas: ganancia SIM presente y coherente (sin PII).
  const fin = JSON.parse((await HERRAMIENTAS.consultar_finanzas.ejecutar({ anio: 2026, mes: 8 })).contenido) as Record<string, number> & { nota: string };
  assert.ok(typeof fin.ganancia_sim === "number", "ganancia_sim numérica");
  assert.ok(!JSON.stringify(fin).match(/telefono|"nombre"/), "finanzas sin PII");

  // 10) Colectivo: herramienta separada, responde sin mezclarse con SIM.
  const col = JSON.parse((await HERRAMIENTAS.consultar_colectivo.ejecutar({ anio: 2026, mes: 8 })).contenido) as { eventos: unknown[]; nota: string };
  assert.ok(Array.isArray(col.eventos) && /separado/i.test(col.nota), "colectivo separado");

  console.log("✔ orchestrator.integration OK (guiones + herramientas reales + exactitud vs 3B)");
}

main().catch((e) => { console.error(e); process.exit(1); });
