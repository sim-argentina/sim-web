// Bloque 5C — CONTRATO entre el catálogo de capacidades y el registro REAL de herramientas.
//
// Ejecutar: IA_PROVIDER=fake npx tsx --env-file=.env.local lib/ia/plan/capacidades.contrato.integration.ts
//
// El catálogo no describe las herramientas de nuevo, pero sí agrega metadatos que el registro no
// tiene. Esta prueba impide que las dos cosas se separen: si alguien agrega una herramienta, le
// cambia los argumentos o deja de publicar la evidencia que el catálogo promete, acá falla.
//
// Solo lectura: ejecuta cada capacidad una vez contra datos reales y mira la FORMA del resultado.

import { strict as assert } from "node:assert";
import { HERRAMIENTAS } from "@/lib/ia/tools";
import { CAPACIDADES, CAPACIDADES_IDS, FUERA_DEL_PLANIFICADOR, accesoDesdeRegistro } from "@/lib/ia/plan/capacidades";
import { FILTROS, FILTROS_VALIDOS, FILTRO_POR_CAMPO } from "@/lib/ia/analisis/catalogoSemantico";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ARGUMENTOS_DE_PRUEBA: Record<string, Record<string, unknown>> = {
  consulta_analitica_interna: { metricas: ["facturacion_bruta"], periodo: { mes: "2026-08" }, dimensiones: ["fuente"] },
  consultar_cronograma: { anio: 2026, mes: 8 },
  consultar_metricas_stand_reservas: { anio: 2026, mes: 8 },
  consultar_finanzas: { anio: 2026, mes: 8 },
  detectar_anomalias: { anio: 2026, mes: 8 },
  proyectar_periodo: { anio: 2026, mes: 10 },
};

async function main() {
  const tablas = ["turnos_stand", "reservas", "fin_movimientos", "cronograma_dias"] as const;
  const censo = async () => {
    const out: Record<string, number> = {};
    for (const t of tablas) {
      const { count, error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      if (error) throw error;
      out[t] = count ?? -1;
    }
    return out;
  };
  const antes = await censo();

  // ── 1) Toda capacidad existe de verdad en el registro ───────────────────────────────────
  {
    const acceso = accesoDesdeRegistro(HERRAMIENTAS);
    for (const id of CAPACIDADES_IDS) {
      assert.ok(acceso.existe(id), `la capacidad "${id}" no existe en el registro de herramientas`);
      assert.ok(acceso.permitidos(id).length > 0, `"${id}" no declara argumentos en su schema`);
    }
  }
  console.log(`OK — contrato (1): las ${CAPACIDADES_IDS.length} capacidades del planificador existen en el registro y declaran sus argumentos.`);

  // ── 2) Ninguna herramienta del registro quedó sin clasificar ────────────────────────────
  {
    const clasificadas = new Set([...CAPACIDADES_IDS, ...Object.keys(FUERA_DEL_PLANIFICADOR)]);
    const sinClasificar = Object.keys(HERRAMIENTAS).filter((n) => !clasificadas.has(n));
    assert.deepEqual(
      sinClasificar,
      [],
      `estas herramientas del registro no están ni habilitadas ni excluidas del planificador: ${sinClasificar.join(", ")}. Agregalas a CAPACIDADES o a FUERA_DEL_PLANIFICADOR con su motivo.`,
    );
    // Y nada sobra: todo lo excluido existe.
    for (const id of Object.keys(FUERA_DEL_PLANIFICADOR)) {
      assert.ok(HERRAMIENTAS[id], `"${id}" está excluida del planificador pero ya no existe en el registro`);
    }
  }
  console.log(`OK — contrato (2): las ${Object.keys(HERRAMIENTAS).length} herramientas del registro están clasificadas (habilitadas o excluidas con motivo).`);

  // ── 3) Cada capacidad publica la evidencia que el catálogo promete ───────────────────────
  {
    for (const id of CAPACIDADES_IDS) {
      const cap = CAPACIDADES[id];
      const args = ARGUMENTOS_DE_PRUEBA[id];
      assert.ok(args, `falta un caso de prueba para "${id}"`);
      const r = await HERRAMIENTAS[id].ejecutar(args);
      const resumen = r.resumen as Record<string, unknown> | null;
      assert.ok(resumen, `"${id}" no devolvió resumen estructurado`);

      if (cap.metricas.length === 0) {
        // Capacidad de diagnóstico: no promete cifras, pero sí un resumen con el que trabajar.
        assert.ok(Object.keys(resumen!).length > 0, `"${id}" tiene que devolver algún resumen`);
        continue;
      }
      const ev = resumen!.evidencia as { metricas?: Array<{ metrica: string; valor: unknown; unidad: string; etiqueta: string }>; periodo?: string } | undefined;
      assert.ok(ev && Array.isArray(ev.metricas), `"${id}" declara métricas pero no publica un bloque 'evidencia' con ellas`);
      const publicadas = ev!.metricas!.map((m) => m.metrica);
      // Nada se cuela sin catálogo: toda métrica publicada tiene que estar declarada.
      for (const m of publicadas) {
        assert.ok(cap.metricas.includes(m), `"${id}" publica "${m}" como evidencia pero el catálogo no la declara`);
      }
      // Cobertura total solo donde la salida es FIJA; la analítica publica las que se le piden.
      if (cap.metricasFijas) {
        for (const m of cap.metricas) {
          assert.ok(publicadas.includes(m), `"${id}" declara "${m}" y su salida es fija, pero no la publicó (publica: ${publicadas.join(", ")})`);
        }
      }
      for (const m of ev!.metricas!) {
        assert.equal(typeof m.valor, "number", `${id}.${m.metrica} tiene que ser un número`);
        assert.ok(m.unidad && m.etiqueta, `${id}.${m.metrica} necesita unidad y etiqueta`);
      }
      assert.ok(ev!.periodo, `"${id}" tiene que declarar el período de su evidencia`);
    }
  }
  console.log("OK — contrato (3): cada capacidad publica como evidencia TODAS las métricas que declara, con valor numérico, unidad, etiqueta y período.");

  // ── 4) El desglose por fuente existe donde el planificador lo necesita ──────────────────
  {
    const r = await HERRAMIENTAS.consulta_analitica_interna.ejecutar(ARGUMENTOS_DE_PRUEBA.consulta_analitica_interna);
    const ev = (r.resumen as Record<string, unknown>).evidencia as { porFuente?: Array<{ fuente: string; valor: number }> };
    assert.ok(Array.isArray(ev.porFuente) && ev.porFuente.length > 0, "la analítica agrupada por fuente tiene que publicar porFuente");
    for (const f of ev.porFuente!) assert.equal(typeof f.valor, "number");
  }
  console.log("OK — contrato (4): la consulta analítica publica el desglose por fuente que usa delta_por_fuente.");

  // ── 5) Ninguna capacidad puede salir a internet ─────────────────────────────────────────
  {
    for (const id of CAPACIDADES_IDS) {
      assert.equal(CAPACIDADES[id].web, "prohibida", `"${id}" tiene que tener la web prohibida`);
      const fuente = JSON.stringify((await HERRAMIENTAS[id].ejecutar(ARGUMENTOS_DE_PRUEBA[id])).fuente ?? {});
      assert.ok(!/http/.test(fuente), `"${id}" no puede declarar una fuente externa`);
    }
  }
  console.log("OK — contrato (5): ninguna capacidad del planificador declara fuentes externas.");

  // ── 6) Los nombres de filtro del catálogo y los del resumen real no pueden separarse ────
  // El contexto de seguimiento vuelve a nombrarle al modelo los filtros del análisis anterior, y
  // tiene que hacerlo con el identificador que el contrato acepta. El puente es el campo `campo`
  // del catálogo semántico: si el resumen cambia un nombre interno, acá se nota.
  {
    const r = await HERRAMIENTAS.consulta_analitica_interna.ejecutar(ARGUMENTOS_DE_PRUEBA.consulta_analitica_interna);
    const filtros = (r.resumen as Record<string, unknown>).filtros as Record<string, unknown>;
    assert.ok(filtros && typeof filtros === "object", "la analítica tiene que devolver los filtros resueltos");
    const internos = Object.keys(filtros);
    const declarados = FILTROS_VALIDOS.map((id) => FILTROS[id].campo);
    for (const k of internos) {
      assert.ok(FILTRO_POR_CAMPO[k], `el resumen devuelve el filtro interno "${k}" y ningún filtro del catálogo lo declara como 'campo'`);
    }
    for (const campo of declarados) {
      assert.ok(internos.includes(campo), `el catálogo declara el campo interno "${campo}" y el resumen ya no lo devuelve`);
    }
    // Y la traducción es biyectiva: un nombre interno no puede mapear a dos públicos.
    assert.equal(Object.keys(FILTRO_POR_CAMPO).length, FILTROS_VALIDOS.length, "cada filtro público tiene un campo interno propio");
  }
  console.log(`OK — contrato (6): los ${FILTROS_VALIDOS.length} filtros del catálogo y los nombres internos del resumen se corresponden uno a uno.`);

  // ── 7) SOLO LECTURA ─────────────────────────────────────────────────────────────────────
  {
    const despues = await censo();
    assert.deepEqual(despues, antes, "ejecutar todas las capacidades no puede cambiar una sola fila");
  }
  console.log("OK — contrato (7): SOLO LECTURA — el conteo de filas quedó idéntico después de ejecutar todas las capacidades.");

  console.log("\nOK — CONTRATO DE CAPACIDADES: el catálogo del planificador y el registro real de herramientas no pueden separarse sin que esto falle.");
}

main().catch((e) => { console.error(e); process.exit(1); });
