import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import type { FilaBandeja, Pendiente } from "@/lib/crmB2";

// Ejecutar: npx tsx lib/crmB2.test.ts
// CRM B2, puro (sin base):
//   1) grupos de la bandeja: partición (cada oportunidad en uno solo) con la
//      precedencia documentada, y vencimientos alrededor de la medianoche de SIM;
//   2) contadores = filas: misma lista filtrada, grupos sin repeticiones;
//   3) filtros;
//   4) estados: qué deja cada actividad (respondió, propuesta, negociación, nota),
//      retrocesos;
//   5) WhatsApp manual sin inventar prefijos; advertencias;
//   6) huella de la gestión estable ante el orden de las claves;
//   7) aislamiento estático: nada del seguimiento llega a la interfaz comercial.

async function main() {
  // crmB2Server crea el cliente de Supabase al importarse: destino inalcanzable, esta prueba no consulta nada.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sin-uso";
  const B = await import("@/lib/crmB2");
  const { hoyEnSim } = await import("@/lib/agenda");
  const { huellaGestion } = await import("@/lib/crmB2Server");
  const HOY = "2026-10-30";
  const p = (tipo: "seguimiento" | "retomar", vence_el: string) => ({ id: "x", tipo, vence_el, descripcion: null });

  // ── 1) Grupos ─────────────────────────────────────────────────────────
  {
    const casos: Array<[Parameters<typeof B.grupoDe>[0], string]> = [
      [{ pendiente: p("retomar", "2026-10-29"), gestionada: true }, "retomar"],
      [{ pendiente: p("retomar", HOY), gestionada: true }, "retomar"],
      [{ pendiente: p("retomar", "2026-11-05"), gestionada: true }, "proximas"],
      [{ pendiente: p("seguimiento", "2026-10-29"), gestionada: true }, "vencidos"],
      [{ pendiente: p("seguimiento", HOY), gestionada: true }, "hoy"],
      [{ pendiente: p("seguimiento", "2026-10-31"), gestionada: true }, "proximas"],
      [{ pendiente: p("seguimiento", "2026-10-29"), gestionada: false }, "vencidos"],
      [{ pendiente: null, gestionada: false }, "nuevos"],
      [{ pendiente: null, gestionada: true }, "sin_proxima"],
    ];
    for (const [o, g] of casos) assert.equal(B.grupoDe(o, HOY), g, `grupo de ${JSON.stringify(o)}`);
    assert.deepEqual(B.GRUPOS.map((g) => g.id), ["vencidos", "hoy", "nuevos", "sin_proxima", "retomar", "proximas"], "orden de los grupos");
    // Medianoche de Córdoba (UTC−3): 02:59 UTC del 31 sigue siendo el 30.
    const antes = hoyEnSim(new Date("2026-10-31T02:59:00Z"));
    const despues = hoyEnSim(new Date("2026-10-31T03:00:00Z"));
    assert.equal(antes, "2026-10-30");
    assert.equal(despues, "2026-10-31");
    assert.equal(B.grupoDe({ pendiente: p("seguimiento", "2026-10-30"), gestionada: true }, antes), "hoy", "23:59 → sigue siendo de hoy");
    assert.equal(B.grupoDe({ pendiente: p("seguimiento", "2026-10-30"), gestionada: true }, despues), "vencidos", "00:00 → vencida");
    assert.equal(B.grupoDe({ pendiente: p("retomar", "2026-10-31"), gestionada: true }, antes), "proximas", "la pausa todavía no llegó");
    assert.equal(B.grupoDe({ pendiente: p("retomar", "2026-10-31"), gestionada: true }, despues), "retomar", "a medianoche llega la fecha de retomar");
  }

  // ── 2) y 3) Contadores, filas y filtros ──────────────────────────────
  {
    let n = 0;
    const fila = (o: Partial<FilaBandeja> & { pendiente: Pendiente | null; gestionada: boolean }): FilaBandeja => {
      n++;
      const base: FilaBandeja = {
        id: `o${n}`, version: 1, ciclo: 1, estado: "contacto", estado_previo: null,
        empresa: { id: `e${n}`, nombre: `Negocio ${n}`, rubro_id: n % 2 ? "r1" : null, rubro: null, zona_id: n % 3 ? "z1" : "z2", zona: null, archivada: false },
        contacto: { id: `c${n}`, nombre: n === 4 ? "Marta Gómez" : `Contacto ${n}`, cargo: null, es_decisor: "si", telefono: null, telefono_normalizado: "5493515550000", archivado: false },
        necesidades: [], necesidad_otra: [], interes: n % 2 ? "caliente" : null, pack: null, nota_comercial: null,
        origen: { usuario_id: n % 2 ? "u1" : "u2", nombre: "X", lead_en: `2026-10-${String(10 + n).padStart(2, "0")}T12:00:00Z` },
        ultima_gestion: null, grupo: "nuevos", advertencias: [], perdida: null,
        ...o,
      };
      return { ...base, grupo: B.grupoDe(base, HOY) };
    };
    const filas = [
      fila({ pendiente: p("seguimiento", "2026-10-28"), gestionada: true, estado: "interesado" }),
      fila({ pendiente: p("seguimiento", HOY), gestionada: true }),
      fila({ pendiente: null, gestionada: false }),
      fila({ pendiente: null, gestionada: true, estado: "negociacion" }),
      fila({ pendiente: p("retomar", "2026-10-20"), gestionada: true, estado: "pausada", estado_previo: "interesado" }),
      fila({ pendiente: p("retomar", "2026-12-01"), gestionada: true, estado: "pausada", estado_previo: "conversacion" }),
      fila({ pendiente: p("seguimiento", "2026-11-02"), gestionada: true, estado: "conversacion" }),
    ];
    const c = B.contar(filas);
    assert.deepEqual(c, { vencidos: 1, hoy: 1, nuevos: 1, sin_proxima: 1, retomar: 1, proximas: 2 });
    assert.equal(Object.values(c).reduce((a, b) => a + b, 0), filas.length, "la suma de los grupos = las filas (sin repeticiones)");
    for (const g of B.GRUPOS) assert.equal(filas.filter((o) => o.grupo === g.id).length, c[g.id], `grupo ${g.id}: contador = filas`);
    const f1 = B.filtrar(filas, { estado: "pausada" }, HOY);
    assert.equal(f1.length, 2);
    assert.deepEqual(B.contar(f1), { vencidos: 0, hoy: 0, nuevos: 0, sin_proxima: 0, retomar: 1, proximas: 1 }, "contadores sobre la lista filtrada");
    assert.equal(B.filtrar(filas, { q: "marta gomez" }, HOY).length, 1, "busca por contacto, sin acentos");
    assert.equal(B.filtrar(filas, { q: "negocio 3" }, HOY)[0].id, "o3");
    assert.equal(B.filtrar(filas, { interes: "no_evaluado" }, HOY).every((o) => o.interes === null), true);
    assert.equal(B.filtrar(filas, { origen: "u2" }, HOY).length, 3);
    assert.equal(B.filtrar(filas, { rubro: "sin_clasificar" }, HOY).every((o) => o.empresa.rubro_id === null), true);
    assert.equal(B.filtrar(filas, { zona: "z2" }, HOY).length, 2);
    assert.deepEqual(B.filtrar(filas, { proxima: "sin" }, HOY).map((o) => o.id), ["o3", "o4"]);
    assert.deepEqual(B.filtrar(filas, { proxima: "vencida" }, HOY).map((o) => o.id), ["o1", "o5"], "la pausa con fecha llegada también figura como vencida al filtrar");
    assert.deepEqual(B.ordenar(filas).slice(0, 2).map((o) => o.id), ["o5", "o1"], "lo que vence antes, primero");
  }

  // ── 4) Estados ────────────────────────────────────────────────────────
  {
    assert.equal(B.estadoTrasActividad("contacto", "respondio"), "conversacion", "respondió: contacto → conversación");
    assert.equal(B.estadoTrasActividad("interesado", "respondio"), "interesado", "respondió no prueba interés ni retrocede");
    assert.equal(B.estadoTrasActividad("conversacion", "propuesta_enviada"), "conversacion", "propuesta ≠ negociación");
    assert.equal(B.estadoTrasActividad("contacto", "inicio_negociacion"), "negociacion");
    assert.equal(B.estadoTrasActividad("negociacion", "inicio_negociacion"), "negociacion");
    assert.equal(B.estadoTrasActividad("negociacion", "nota"), "negociacion", "una nota no cambia nada");
    assert.equal(B.estadoTrasActividad("negociacion", "whatsapp_enviado"), "negociacion");
    assert.equal(B.estadoTrasActividad("negociacion", "cambio_estado", "interesado"), "interesado");
    assert.ok(B.esRetroceso("negociacion", "interesado") && !B.esRetroceso("contacto", "interesado") && !B.esRetroceso("pausada", "contacto"));
    assert.deepEqual([B.rangoEtapa("contacto"), B.rangoEtapa("negociacion"), B.rangoEtapa("pausada"), B.rangoEtapa("ganada")], [1, 4, null, null]);
    assert.ok(B.ESTADOS_OPORTUNIDAD.some((e) => e.valor === "ganada"), "B3 agrega «Ganado»");
    assert.ok(!(B.ETAPAS as readonly string[]).includes("ganada"), "«Ganado» no es una etapa: se llega registrando la venta");
    assert.equal(B.MOTIVOS_PERDIDA.length, 10);
  }

  // ── 5) WhatsApp manual y advertencias ────────────────────────────────
  {
    const wa = (t: string | null) => B.enlaceWhatsappManual(t);
    assert.deepEqual(wa("+54 9 351 555-0101"), { url: "https://wa.me/5493515550101" });
    assert.deepEqual(wa("5493515550101"), { url: "https://wa.me/5493515550101" });
    assert.deepEqual(wa("0054 9 351 5550101"), { url: "https://wa.me/5493515550101" });
    assert.deepEqual(wa("+1 415 555 0101"), { url: "https://wa.me/14155550101" });
    for (const t of ["351 555-0101", "0351 15 555 0101", "+54 351 555 0101", "+54 12", null, ""]) {
      assert.ok("motivo" in wa(t), `sin enlace para ${String(t)} (no se inventan prefijos)`);
    }
    const ok = { archivado: false, telefono_normalizado: "5493515550101" };
    assert.deepEqual(B.advertenciasDe({ contacto: ok, empresa: { archivada: false } }), []);
    assert.deepEqual(B.advertenciasDe({ contacto: null, empresa: { archivada: true } }), ["sin_contacto", "negocio_archivado"]);
    assert.deepEqual(B.advertenciasDe({ contacto: { archivado: true, telefono_normalizado: null }, empresa: { archivada: false } }), ["contacto_archivado", "contacto_sin_telefono"]);
  }

  // ── 6) Huella ─────────────────────────────────────────────────────────
  {
    const a = huellaGestion("o", 3, "gestion", { tipo: "llamada", proxima: { vence_el: HOY, descripcion: "x" } });
    const b = huellaGestion("o", 3, "gestion", { proxima: { descripcion: "x", vence_el: HOY }, tipo: "llamada" });
    assert.equal(a, b, "mismo contenido en otro orden → misma huella");
    assert.notEqual(a, huellaGestion("o", 4, "gestion", { tipo: "llamada", proxima: { vence_el: HOY, descripcion: "x" } }), "otra versión → otra huella");
    assert.match(a, /^[0-9a-f]{64}$/);
  }

  // ── 7) Aislamiento estático ──────────────────────────────────────────
  {
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const q = join(d, e.name);
        if (e.isDirectory()) walk(q, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(q.split(sep).join("/"));
      }
      return out;
    };
    const leer = (f: string) => readFileSync(f, "utf8");
    const comercial = walk("app/comercial");
    assert.ok(comercial.every((f) => !/crmB2Server|crmB2Rutas|crm_actividades|crm_seguimientos|crm\/Seguimiento/.test(leer(f))), "el área comercial no toca el seguimiento");
    const usanB2 = walk("app").filter((f) => /crmB2Rutas|crmB2Server/.test(leer(f)));
    assert.ok(usanB2.length >= 2 && usanB2.every((f) => f.startsWith("app/api/admin/crm/")), `solo rutas de administración usan B2: ${usanB2.join(", ")}`);
    for (const f of usanB2) assert.match(leer(f), /const a = await actorAdmin\(\);\s*if \(!a\.ok\) return a\.response;/, `${f} exige admin`);
    const b1 = leer("lib/crmB1Server.ts");
    assert.ok(!/crm_actividades|crm_seguimientos|crm_operaciones|gestionada_en|perdida_motivo|retomar_el/.test(b1), "las lecturas de B1 (también las comerciales) no leen datos del seguimiento");
    assert.match(b1, /interesado_en: esComercial\(actor\) \? null : x\.interesado_en/, "el comercial no recibe hitos de Administración");
  }

  console.log("OK — crmB2 puro: grupos sin repeticiones y medianoche, contadores = filas, filtros, estados, WhatsApp sin prefijos inventados, huella y aislamiento.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
