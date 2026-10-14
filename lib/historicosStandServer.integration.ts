// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { analizarArchivo, construirTurnos, validarLoteHistorico, type HojaExcel } from "@/lib/historicosStand";
import { borrarImportacionHistorica, guardarTurnosHistoricos } from "@/lib/historicosStandServer";

// Importación de Excel históricos del stand contra la base de pruebas:
//   · el año confirmado es el que se guarda;
//   · reimportar el mismo archivo con el MISMO año no duplica (hash_unico);
//   · con OTRO año son ventas distintas (por eso el diálogo lo advierte);
//   · borrar una importación con año no toca la del otro año.
// Todas las filas llevan la marca de abajo en el nombre del archivo y se borran al final.

const MARCA = "ZZTEST-HIST";
const HOY = "2026-10-14";
const NOMBRE = `${MARCA} Turnos Octubre.xlsx`;

const venta = (monto: number, hora: string) => ({
  "Cant. de Sim.": 1,
  "Tiempo (Min)": 15,
  "Cant. Turnos": 1,
  "Hora que se tomo el turno": hora,
  "Hora de subida": hora,
  "Hora de bajada": hora,
  Monto: monto,
  "Metodo de Pago": "QR",
  Escuderia: "Alpine",
});
const hojas: HojaExcel[] = [
  { nombre: "02", filas: [venta(10000, "17:00"), venta(20000, "18:00")], fechas: [] },
  { nombre: "03", filas: [venta(15000, "19:00")], fechas: [] },
];
const archivo = analizarArchivo(NOMBRE, hojas, HOY);

async function filas() {
  const { data, error } = await supabaseAdmin
    .from("turnos_historicos")
    .select("fecha, total, hash_unico")
    .eq("archivo_key", archivo.archivoKey)
    .order("fecha");
  if (error) throw error;
  return data ?? [];
}

async function limpiar() {
  await supabaseAdmin.from("turnos_historicos").delete().like("archivo_nombre", `${MARCA}%`);
}

async function main() {
  await limpiar();
  try {
    assert.equal(archivo.anioDetectado, null, "sin año en el archivo no se preselecciona");

    const de2025 = construirTurnos(archivo, 2025, "10", HOY);
    assert.deepEqual(de2025.errores, []);
    assert.equal(validarLoteHistorico(de2025.turnos, HOY), null);

    // 1) Importación con el año confirmado.
    let r = await guardarTurnosHistoricos(de2025.turnos);
    assert.ok(r.ok);
    assert.equal(r.recibidos, 3);
    assert.equal(r.insertados, 3);
    let guardadas = await filas();
    assert.deepEqual(guardadas.map((f) => f.fecha), ["2025-10-02", "2025-10-02", "2025-10-03"]);
    assert.equal(guardadas.reduce((s, f) => s + Number(f.total), 0), 45000);
    console.log("OK 1 — se guarda el año confirmado (2025), no el actual");

    // 2) Reimportar igual: nada nuevo.
    r = await guardarTurnosHistoricos(de2025.turnos);
    assert.ok(r.ok);
    assert.equal(r.insertados, 0);
    assert.equal((await filas()).length, 3);
    console.log("OK 2 — reimportar con el mismo año no duplica");

    // 3) El mismo archivo como 2026: son otras ventas.
    const de2026 = construirTurnos(archivo, 2026, "10", HOY);
    assert.deepEqual(de2026.errores, []);
    r = await guardarTurnosHistoricos(de2026.turnos);
    assert.ok(r.ok);
    assert.equal(r.insertados, 3);
    guardadas = await filas();
    assert.equal(guardadas.length, 6);
    console.log("OK 3 — con otro año se guardan aparte (el diálogo lo advierte)");

    // 4) Borrar la importación de 2026 no toca la de 2025.
    const b = await borrarImportacionHistorica(archivo.archivoKey, 2026);
    assert.ok(b.ok);
    guardadas = await filas();
    assert.deepEqual(guardadas.map((f) => f.fecha), ["2025-10-02", "2025-10-02", "2025-10-03"]);
    assert.ok(guardadas.every((f) => f.hash_unico.startsWith(`${archivo.archivoKey}|2025-`)));
    console.log("OK 4 — borrar por año solo borra ese año");

    // 5) Sin año borra todo el archivo (comportamiento anterior).
    const b2 = await borrarImportacionHistorica(archivo.archivoKey, null);
    assert.ok(b2.ok);
    assert.equal((await filas()).length, 0);
    console.log("OK 5 — sin año se borra la importación completa");
  } finally {
    await limpiar();
    const { count } = await supabaseAdmin
      .from("turnos_historicos")
      .select("id", { count: "exact", head: true })
      .like("archivo_nombre", `${MARCA}%`);
    assert.equal(count, 0, "no quedan filas de prueba");
  }
  console.log("\nOK — importación de históricos: año confirmado, reimportación sin duplicados y borrado por año.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
