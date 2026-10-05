// Auditoría de SOLO LECTURA de residuos de pruebas en las tablas de IA.
//
//   npm run pruebas:auditar-ia                # audita Producción (lee .env.local)
//   npm run pruebas:auditar-ia -- --local     # audita la base local de pruebas
//
// Informa conteos y firmas. NO expone contenido: ni preguntas, ni respuestas, ni títulos,
// ni documentos, ni teléfonos, ni correos. Solo owners, proveedores, fechas y cantidades.
//
// Devuelve código 1 si encuentra residuos INEQUÍVOCOS, 0 si está limpio. Pensado para
// correrlo después de cualquier bloque que toque IA, y para notar una regresión temprano.
//
// Nunca escribe. No hay un solo insert, update ni delete en este archivo.

import { readFileSync, existsSync } from "node:fs";

const LOCAL = process.argv.includes("--local");
const ARCHIVO = LOCAL ? ".env.test.local" : ".env.local";

if (!existsSync(ARCHIVO)) {
  console.error(`Falta ${ARCHIVO}.`);
  process.exit(78);
}
const env = {};
for (const linea of readFileSync(ARCHIVO, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const base = (env.NEXT_PUBLIC_SUPABASE_URL || env.SIM_TEST_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SIM_TEST_SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.error(`${ARCHIVO} no trae URL y service role.`);
  process.exit(78);
}

// La firma del proyecto, sin exponer la clave.
const ref = (base.match(/^https?:\/\/([a-z0-9]{20})\.supabase\./i) || [])[1];
const destino = ref ? `proyecto ${ref}` : base;

async function contar(tabla, filtro = "") {
  // `select=*`, no `select=id`: hay tablas de IA cuya clave no se llama id
  // (ia_creditos_sync_estado va por owner). El conteo sale del Content-Range.
  const r = await fetch(`${base}/rest/v1/${tabla}?select=*${filtro ? "&" + filtro : ""}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`);
  const rango = r.headers.get("content-range") || "";
  const n = Number((rango.split("/")[1] ?? "0"));
  return Number.isFinite(n) ? n : 0;
}
async function distintos(tabla, columna) {
  const r = await fetch(`${base}/rest/v1/${tabla}?select=${columna}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`${tabla}.${columna}: ${r.status}`);
  const filas = await r.json();
  return [...new Set(filas.map((f) => f[columna]).filter((v) => v != null))];
}

// Firmas de las familias históricas de fixtures. Una coincidencia textual sola no prueba
// nada: se informa como señal y se exige el contexto (owner sin ejecuciones reales, etc.).
const FIRMA = /(zztest|zzdebug|zzrst|zzm7|fixture|probe|\bdbg\b|@test\.local|@example\.test|TEST_IA_HIST)/i;

const TABLAS_IA = [
  "ia_adjuntos_conversacion", "ia_archivos_generados", "ia_busquedas_web",
  "ia_conocimiento_categorias", "ia_consumo", "ia_conversaciones",
  "ia_costos_oficiales_snapshots", "ia_creditos_movimientos", "ia_creditos_sync_estado",
  "ia_documento_fragmentos", "ia_documento_versiones", "ia_documentos", "ia_ejecuciones",
  "ia_feedback", "ia_fuentes_externas", "ia_herramientas_ejecuciones", "ia_informe_fuentes",
  "ia_informe_historial", "ia_informe_versiones", "ia_informes", "ia_ipc_indice",
  "ia_mensajes", "ia_ocr_resultados", "ia_procesamientos_archivos",
  "ia_saldo_conciliaciones", "ia_web_cache",
];

const inequivocos = [];
const senales = [];

console.log(`Auditoría de residuos de IA — ${destino}  (SOLO LECTURA)\n`);

// ── 1) Ejecuciones por proveedor ───────────────────────────────────────────
const provs = await distintos("ia_ejecuciones", "proveedor");
console.log("Ejecuciones por proveedor:");
for (const p of [...provs].sort()) {
  const n = await contar("ia_ejecuciones", `proveedor=eq.${encodeURIComponent(p)}`);
  console.log(`   ${String(p).padEnd(12)} ${n}`);
  if (String(p).toLowerCase() === "fake" && n > 0) {
    inequivocos.push(`${n} ejecuciones con proveedor 'fake'`);
  }
}
const sinProv = await contar("ia_ejecuciones", "proveedor=is.null");
if (sinProv > 0) senales.push(`${sinProv} ejecuciones sin proveedor declarado`);

// ── 2) Owners con firma de fixture ─────────────────────────────────────────
for (const [tabla, col] of [["ia_consumo", "owner"], ["ia_conversaciones", "owner"], ["ia_creditos_movimientos", "actor"], ["ia_saldo_conciliaciones", "actor"], ["ia_ocr_resultados", "actor"]]) {
  const valores = await distintos(tabla, col);
  const sospechosos = valores.filter((v) => FIRMA.test(String(v)));
  console.log(`\n${tabla}.${col}: ${valores.length} distintos${sospechosos.length ? ` — con firma: ${sospechosos.join(", ")}` : " — sin firmas"}`);
  for (const v of sospechosos) {
    const n = await contar(tabla, `${col}=eq.${encodeURIComponent(v)}`);
    inequivocos.push(`${tabla}: ${n} fila(s) de ${col}='${v}'`);
  }
}

// ── 3) Huérfanos: hijas sin su padre ───────────────────────────────────────
// Señal, no veredicto: una bitácora de auditoría sobrevive legítimamente a su sujeto.
const herrTotal = await contar("ia_herramientas_ejecuciones");
const ejecTotal = await contar("ia_ejecuciones");
console.log(`\nia_herramientas_ejecuciones ${herrTotal}  ·  ia_ejecuciones ${ejecTotal}`);

// ── 4) Conteos por tabla ───────────────────────────────────────────────────
console.log("\nConteos por tabla:");
let total = 0;
for (const t of TABLAS_IA) {
  const n = await contar(t);
  total += n;
  console.log(`   ${t.padEnd(30)} ${n}`);
}
console.log(`   ${"TOTAL".padEnd(30)} ${total}`);

// ── 5) Veredicto ───────────────────────────────────────────────────────────
console.log("");
if (senales.length) {
  console.log("Señales para revisar (no concluyentes):");
  for (const s of senales) console.log(`   · ${s}`);
  console.log("");
}
if (inequivocos.length) {
  console.error("RESIDUOS INEQUÍVOCOS DE PRUEBAS:");
  for (const r of inequivocos) console.error(`   · ${r}`);
  console.error(`\nSon ${inequivocos.length} hallazgo(s). En Producción esto no debería existir.`);
  process.exit(1);
}
console.log("Sin residuos inequívocos de pruebas.");
process.exit(0);
