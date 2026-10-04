import { strict as assert } from "node:assert";
import { clasificarConsulta } from "@/lib/ia/ruteo";

// Ejecutar: npx tsx lib/ia/ruteo.test.ts — puro.
//
// Bloque 5A — el ruteo decide ANTES que la web. La regresión central es la consulta productiva
// que terminó buscando en internet: "la facturación del mes de agosto de 2026…".

function main() {
  // ── La consulta productiva EXACTA: interna, sin web ──────────────────────────────────────
  {
    const d = clasificarConsulta("Me podrías decir la facturación del mes de agosto de 2026, entre los días lunes a viernes de cada semana?");
    assert.equal(d.ruta, "interna", "la facturación de un mes es una pregunta de datos internos");
    assert.equal(d.webPermitida, false, "una consulta interna NUNCA habilita Tavily");
    assert.ok(d.senales.includes("interno:facturacion"), "detecta el tema interno 'facturación' (el prefijo que antes no matcheaba)");
    assert.ok(!d.senales.some((s) => s.startsWith("externo:")), "no hay ninguna señal externa");
  }
  console.log("OK — consulta productiva exacta → ruta interna, web bloqueada.");

  // ── La causa raíz: mencionar un año/mes no vuelve externa una pregunta interna ────────────
  {
    for (const q of [
      "facturación de agosto de 2026",
      "¿cuánto facturamos en 2027?",
      "turnos de este mes",
      "ingresos actuales del stand",
      "¿cuál es la ocupación reciente?",
    ]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "interna", `"${q}" debe ser interna`);
      assert.equal(d.webPermitida, false, `"${q}" no puede habilitar web`);
    }
  }
  console.log("OK — un año, 'actual' o 'reciente' ya no convierten una consulta interna en externa.");

  // ── Prefijos reales: facturación/facturar/facturado, no solo "factur" exacto ──────────────
  {
    for (const q of ["¿cuánto facturamos?", "la facturación de agosto", "lo facturado en julio", "¿vamos a facturar más?"]) {
      assert.equal(clasificarConsulta(q).ruta, "interna", `"${q}" debe detectarse como tema interno`);
    }
  }
  console.log("OK — el detector de tema interno usa PREFIJOS de verdad (facturación/facturado/facturar).");

  // ── Variantes lingüísticas de la misma pregunta ──────────────────────────────────────────
  {
    for (const q of [
      "¿Cuánto facturamos cada semana hábil de agosto?",
      "Separame los ingresos de agosto por semana, solo de lunes a viernes.",
      "Mostrame la facturación semanal de agosto excluyendo sábados y domingos.",
      "¿Qué semana de agosto facturó más de lunes a viernes?",
    ]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "interna", `"${q}" debe ser interna`);
      assert.equal(d.webPermitida, false);
    }
  }
  console.log("OK — variantes lingüísticas (sin coincidencia literal) también rutean interno.");

  // ── Otras consultas internas del catálogo ────────────────────────────────────────────────
  {
    for (const q of [
      "turnos por semana",
      "personas por día de la semana",
      "facturación por método de pago",
      "reservas del mes pasado",
      "minutos de actividad por semana",
      "horas de cronograma de Federico",
      "¿cuántas mensualidades se vendieron?",
      "inscripciones de campeonatos de agosto",
    ]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "interna", `"${q}" debe ser interna`);
      assert.equal(d.webPermitida, false);
    }
  }
  console.log("OK — el catálogo de temas internos (turnos, personas, pagos, reservas, mensualidades, campeonatos, cronograma) rutea interno.");

  // ── Consultas EXTERNAS: siguen yendo a web ───────────────────────────────────────────────
  {
    for (const q of ["Buscá las últimas noticias de la Fórmula 1.", "Investigá competidores de simuladores en Córdoba."]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "externa", `"${q}" debe ser externa`);
      assert.equal(d.webPermitida, true, "una consulta externa sí puede buscar");
    }
  }
  console.log("OK — consultas externas (noticias, competencia) mantienen la ruta externa con web habilitada.");

  // ── Consulta MIXTA: parte interna + parte externa ────────────────────────────────────────
  {
    const d = clasificarConsulta("Compará la facturación de SIM con la inflación del período.");
    assert.equal(d.ruta, "mixta", "interna + externa → mixta");
    assert.equal(d.webPermitida, true, "la parte externa puede buscar");
    assert.ok(d.senales.includes("interno:facturacion"));
    assert.ok(d.senales.some((s) => s.startsWith("externo:")), "la inflación externa queda registrada como señal externa");
  }
  console.log("OK — consulta mixta separa señal interna y externa, con web permitida para la parte externa.");

  // ── "Ajustar por inflación" es INTERNO (índice IPC ya cargado por el admin, 4E) ───────────
  {
    const d = clasificarConsulta("Compará la ganancia de julio con agosto ajustada por inflación.");
    assert.equal(d.ruta, "interna", "el ajuste por IPC cargado no necesita internet");
    assert.equal(d.webPermitida, false);
  }
  console.log("OK — 'ajustada por inflación' usa el índice interno y no habilita web.");

  // ── Conocimiento documental ──────────────────────────────────────────────────────────────
  {
    const d = clasificarConsulta("¿Qué dice el manual de atención sobre las cancelaciones?");
    assert.equal(d.ruta, "conocimiento");
    assert.equal(d.webPermitida, false);
  }
  console.log("OK — documentos/manual → ruta conocimiento, sin web.");

  // ── "Sin internet" y PII: nunca sale de SIM ──────────────────────────────────────────────
  {
    const sinNet = clasificarConsulta("Dame la facturación de agosto sin internet.");
    assert.equal(sinNet.webPermitida, false);
    assert.equal(sinNet.ruta, "interna");
    const pii = clasificarConsulta("¿Qué reservas tiene el cliente 3512345678?");
    assert.equal(pii.webPermitida, false, "con PII nunca se busca afuera");
    assert.ok(pii.senales.some((s) => s.startsWith("pii:")), "la señal de PII queda auditada");
  }
  console.log("OK — 'sin internet' y PII bloquean la web siempre.");

  // ── Bloque 5B: el vocabulario con que se piden los análisis también es interno ───────────
  {
    for (const q of [
      "¿Cuánto vendimos entre semana en agosto?",
      "¿Cuáles fueron los cinco mejores días?",
      "Compará lunes contra viernes.",
      "¿Qué promedio diario tuvimos durante este mes?",
      "Desglosame las ventas automáticas y manuales.",
      "¿Qué pasó durante los fines de semana?",
      "¿Qué porcentaje de la facturación provino de cada fuente?",
      "¿Cómo cambió la actividad entre agosto y septiembre?",
      "¿Qué días tuvieron actividad, pero una facturación relativamente baja?",
      "Separame agosto entre semana y fin de semana.",
    ]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "interna", `"${q}" debe ser interna`);
      assert.equal(d.webPermitida, false, `"${q}": Tavily bloqueado`);
    }
    // Y las señales nuevas NO roban consultas externas legítimas: si además hay algo de afuera,
    // la consulta sigue siendo mixta y la parte externa puede buscar.
    for (const q of ["Compará nuestras ventas con las de la competencia.", "¿Cuál es el mejor competidor de Córdoba?"]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "mixta", `"${q}" mezcla interno y externo`);
      assert.equal(d.webPermitida, true, `"${q}": la parte externa sí puede buscar`);
    }
  }
  console.log("OK — 5B: ventas, promedios, mejores/peores, desglose, porcentaje, fin de semana y 'cómo cambió' son temas internos, sin robarle las consultas externas.");

  // ── 5C — "rendir" es una señal CONDICIONADA: sola no vuelve interna una consulta ─────────
  {
    // NEGATIVAS: el verbo no dice de quién se habla. Sin otra señal interna, la consulta NO se
    // vuelve interna y la web se sigue decidiendo como siempre.
    for (const q of [
      "¿Cómo rindió YPF?",
      "¿Cómo rinde una inversión en plazo fijo?",
      "¿Cómo rindieron los bonos argentinos?",
      "¿Cómo va a rendir el sector del entretenimiento?",
    ]) {
      const d = clasificarConsulta(q);
      assert.notEqual(d.ruta, "interna", `"${q}" no puede volverse interna por el verbo`);
      assert.equal(d.webPermitida, true, `"${q}": la web no se bloquea sin señal interna`);
      assert.ok(d.senales.includes("condicionado_sin_respaldo:rendir"), `"${q}": queda auditado que el verbo apareció sin respaldo`);
      assert.ok(!d.senales.includes("interno:rendir"), `"${q}": el verbo no cuenta como señal interna`);
    }
    // Y si además hay algo externo, la ruta externa se respeta entera.
    for (const q of ["¿Cómo rindió el mercado argentino?", "¿Cómo rindió la competencia?", "¿Cómo rindió el dólar este año?"]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "externa", `"${q}" es externa`);
      assert.equal(d.webPermitida, true);
    }

    // POSITIVAS: con una señal interna que lo respalde, el verbo sí habla de SIM.
    for (const [q, respaldo] of [
      ["¿Por qué septiembre rindió distinto de agosto según nuestros datos?", "interno:datos_propios"],
      ["¿Cómo rindió el Turnero en septiembre?", "interno:stand"],
      ["¿Cómo rindió la facturación de agosto?", "interno:facturacion"],
      ["¿Cómo rindieron los fines de semana?", "interno:calendario"],
    ] as const) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "interna", `"${q}" debe ser interna`);
      assert.equal(d.webPermitida, false, `"${q}": Tavily bloqueado`);
      assert.ok(d.senales.includes(respaldo), `"${q}": la respalda ${respaldo}`);
      assert.ok(d.senales.includes("interno:rendir"), `"${q}": con respaldo, el verbo cuenta`);
    }

    // "rendimos" habla de SIM por la persona gramatical: no necesita respaldo.
    const propio = clasificarConsulta("¿Cuánto rendimos este mes?");
    assert.equal(propio.ruta, "interna");
    assert.equal(propio.webPermitida, false);
    assert.ok(propio.senales.includes("interno:metricas"));

    // Y la consulta de aceptación de 5C no depende del verbo para ser interna.
    const aceptacion = clasificarConsulta(
      "Compará agosto y septiembre de 2026. Decime cómo cambiaron la facturación bruta total, los turnos comerciales y las horas programadas. Después identificá qué fuentes explican la variación de facturación y decime si la diferencia parece relacionarse más con menor demanda o con menor disponibilidad.",
    );
    assert.equal(aceptacion.ruta, "interna");
    assert.equal(aceptacion.webPermitida, false);
    assert.ok(!aceptacion.senales.includes("interno:rendir"), "no hace falta el verbo: ya hay métricas internas");
  }
  console.log("OK — 5C: 'rindió' solo no vuelve interna una consulta (YPF, el mercado, la competencia siguen externas) y con respaldo interno sí.");

  // ── "mercado" es externo; "mercado pago" es un método de pago interno ────────────────────
  {
    const foda = clasificarConsulta("Hacé un FODA de SIM comparándolo con el mercado actual de Córdoba.");
    assert.equal(foda.webPermitida, true, "comparar con el mercado sí necesita datos externos");
    assert.ok(foda.senales.includes("externo:mercado"));
    const pago = clasificarConsulta("¿Cuánto cobramos por mercado pago en agosto?");
    assert.equal(pago.ruta, "interna", "'mercado pago' es un método de pago, no el mercado");
    assert.equal(pago.webPermitida, false);
  }
  console.log("OK — 'el mercado' habilita web; 'mercado pago' sigue siendo un dato interno.");

  // ── El router NO bloquea lo que no reconoce: ahí decide decidirWeb (4D) ──────────────────
  {
    for (const q of ["buscá simuladores en córdoba", "hola"]) {
      const d = clasificarConsulta(q);
      assert.equal(d.ruta, "ambigua", `"${q}" no tiene tema identificable`);
      assert.equal(d.webPermitida, true, `"${q}": el router se abstiene en vez de bloquear a ciegas`);
    }
  }
  console.log("OK — sin señales, el router se abstiene y la decisión de web queda en las reglas de 4D.");

  // ── Las señales son códigos auditables, no razonamiento ──────────────────────────────────
  {
    const d = clasificarConsulta("Me podrías decir la facturación del mes de agosto de 2026, entre los días lunes a viernes de cada semana?");
    for (const s of d.senales) {
      assert.ok(/^[a-z_]+:[a-z_,0-9]+$/.test(s) || /^[a-z_]+$/.test(s), `la señal "${s}" es un código corto, no texto libre`);
      assert.ok(s.length <= 40, "las señales no arrastran razonamiento ni datos");
    }
  }
  console.log("OK — las señales registradas son códigos cortos auditables (sin razonamiento ni datos sensibles).");

  console.log("\nOK — ruteo (puro): internal-first, con la consulta productiva y sus variantes en ruta interna y Tavily bloqueado.");
}
main();
