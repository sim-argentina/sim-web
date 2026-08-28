import { strict as assert } from "node:assert";
import { estadoBloqueoEfectivo, bloqueoAplicable } from "@/lib/bloqueosEstado";

// Ejecutar: npx tsx lib/bloqueosEstado.test.ts
// "Ahora" fijo = jueves 28/08/2026 16:00 hora Argentina.
const NOW = Date.parse("2026-08-28T16:00:00-03:00");
const b = (o: Partial<Parameters<typeof estadoBloqueoEfectivo>[0]>) =>
  ({ activo: true, fecha: "2026-08-28", todo_el_dia: true, hora_inicio: null, hora_fin: null, ...o });

// CASO K — todo el día de AYER → inactivo (vencido).
assert.equal(estadoBloqueoEfectivo(b({ fecha: "2026-08-27" }), NOW), "inactivo");
// todo el día de HOY → activo.
assert.equal(estadoBloqueoEfectivo(b({ fecha: "2026-08-28" }), NOW), "activo");
// CASO H — futuro (mañana), todo el día → programado.
assert.equal(estadoBloqueoEfectivo(b({ fecha: "2026-08-29" }), NOW), "programado");
// CASO I — rango horario hoy 15:20–22:00, ahora 16:00 → activo/vigente.
assert.equal(estadoBloqueoEfectivo(b({ fecha: "2026-08-28", todo_el_dia: false, hora_inicio: "15:20", hora_fin: "22:00" }), NOW), "activo");
// CASO J — rango hoy 08:00–15:00, ya terminó → inactivo.
assert.equal(estadoBloqueoEfectivo(b({ fecha: "2026-08-28", todo_el_dia: false, hora_inicio: "08:00", hora_fin: "15:00" }), NOW), "inactivo");
// rango hoy 18:00–20:00, aún no empezó → programado.
assert.equal(estadoBloqueoEfectivo(b({ fecha: "2026-08-28", todo_el_dia: false, hora_inicio: "18:00", hora_fin: "20:00" }), NOW), "programado");
// CASO L — desactivado MANUALMENTE aunque la fecha esté vigente → inactivo (prevalece).
assert.equal(estadoBloqueoEfectivo(b({ activo: false, fecha: "2026-08-29" }), NOW), "inactivo");

// bloqueoAplicable: aplica salvo inactivo. Programado SÍ aplica (a su ventana futura).
assert.equal(bloqueoAplicable(b({ fecha: "2026-08-29" }), NOW), true, "programado aplica");
assert.equal(bloqueoAplicable(b({ fecha: "2026-08-28" }), NOW), true, "vigente aplica");
assert.equal(bloqueoAplicable(b({ fecha: "2026-08-27" }), NOW), false, "vencido NO aplica");
assert.equal(bloqueoAplicable(b({ activo: false, fecha: "2026-08-29" }), NOW), false, "manual off NO aplica");

console.log("OK — bloqueosEstado: programado/activo/inactivo por fecha+hora (AR), todo-el-día, rango, vencido, manual off; aplicabilidad.");
