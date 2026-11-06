import { strict as assert } from "node:assert";
import { BLOQUES_AMBIGUOS, FUENTE_BLOQUES } from "@/lib/bloquesNumeracionAmbiguos";
import { FUENTE_INDICATIVOS, INDICATIVOS_ARGENTINA } from "@/lib/indicativosArgentina";
import { AREAS_3_DIGITOS, normalizarTelefono } from "@/lib/mensualidades";
import { AREA_OFICIAL_2, AREAS_OFICIALES_3, AREAS_OFICIALES_4_MUESTRA } from "@/lib/mensualidadesTelefono.fixtures";
import { areaDeIndicativo, esIndicativoOficial, indicativoDe, indicativoEscrito } from "@/lib/marketing/indicativo";

// Marketing · indicativo interurbano (fuentes oficiales de ENACOM). Puro.
// Ejecutar: npx tsx lib/marketing/indicativo.test.ts

globalThis.fetch = (() => {
  throw new Error("red prohibida en las pruebas de indicativo");
}) as typeof fetch;

const codigos = INDICATIVOS_ARGENTINA.map(([i]) => i);
const de = (n: number) => codigos.filter((c) => c.length === n);
const ambiguos = de(4).filter((c) => de(3).includes(c.slice(0, 3))).sort();
const bloques = (lista: string) => lista.split(" ").filter(Boolean);

// ── 1. La tabla es la de ENACOM y coincide con lo que ya usaba el repo ──────
{
  assert.equal(FUENTE_INDICATIVOS.total, 300);
  assert.match(FUENTE_INDICATIVOS.sha256, /^[0-9a-f]{64}$/);
  assert.equal(codigos.length, 300);
  assert.equal(new Set(codigos).size, 300, "sin repetidos");
  assert.deepEqual(de(2), [AREA_OFICIAL_2]);
  assert.deepEqual([...de(3)].sort(), [...AREAS_OFICIALES_3].sort(), "los 38 de 3 dígitos de las fixtures");
  assert.deepEqual([...de(3)].sort(), [...AREAS_3_DIGITOS].sort(), "y los del normalizador");
  assert.equal(de(4).length, 261);
  for (const c of AREAS_OFICIALES_4_MUESTRA) assert.ok(esIndicativoOficial(c), `${c} está en la tabla`);
  assert.equal(ambiguos.length, 49, "49 de 4 dígitos empiezan con uno de 3");
  assert.ok(!de(4).some((c) => c.startsWith("1")) && !de(3).some((c) => c.startsWith("1")), "el 11 nunca es ambiguo");
  assert.deepEqual(areaDeIndicativo("351"), { area: "CORDOBA", provincia: "CORDOBA" });
  assert.equal(areaDeIndicativo("354"), null, "354 no existe: es solo el comienzo de 3541, 3543…");
}

// ── 2. Los bloques generados cubren los 49 pares y no se pisan ──────────────
{
  assert.match(FUENTE_BLOQUES.sha256, /^[0-9a-f]{64}$/);
  assert.ok(FUENTE_BLOQUES.bloques > 40000, "la planilla completa, no un recorte");
  assert.deepEqual(Object.keys(BLOQUES_AMBIGUOS).sort(), ambiguos, "un registro por cada par ambiguo, ni más ni menos");
  let conCorto = 0;
  for (const largo of ambiguos) {
    const b = BLOQUES_AMBIGUOS[largo];
    assert.equal(b.corto, largo.slice(0, 3));
    const delLargo = bloques(b.delLargo).map((x) => largo + x);
    const delCorto = bloques(b.delCorto).map((x) => b.corto + x);
    if (delCorto.length > 0) conCorto++;
    for (const p of [...bloques(b.delLargo), ...bloques(b.delCorto)]) assert.match(p, /^[2-9][0-9]*$/, "Res. SC 46/97: ningún bloque empieza con 0 o 1");
    for (const p of delCorto) assert.ok(p.startsWith(largo), `${p}: los del corto guardados caen dentro de ${largo}`);
    for (const a of delLargo) for (const c of delCorto) {
      assert.ok(!a.startsWith(c) && !c.startsWith(a), `rangos superpuestos ${a} / ${c}`);
    }
    // Cada bloque asignado decide su propio indicativo.
    for (const p of delLargo) {
      const r = indicativoDe(p.padEnd(10, "0"));
      assert.ok(r.ok && r.indicativo === largo, `${p}… es de ${largo}`);
    }
    for (const p of delCorto) {
      const r = indicativoDe(p.padEnd(10, "0"));
      assert.ok(r.ok && r.indicativo === b.corto, `${p}… es de ${b.corto}, aunque empiece con ${largo}`);
    }
  }
  assert.equal(conCorto, 17, "en 17 pares el indicativo de 3 tiene bloques dentro del de 4");
}

// ── 3. Casos de la planilla de bloques asignados (fila citada) ──────────────
// Cada número está armado sobre un bloque real; la otra lectura no cae en ningún
// bloque. Donde dice "antes", la regla del más largo lo atribuía mal.
{
  const caso = (numero: string, indicativo: string, area: string, base: string, fila: string) => {
    const r = indicativoDe(numero);
    assert.ok(r.ok, `${numero} (${fila}) se determina`);
    assert.deepEqual([r.indicativo, r.area, r.base], [indicativo, area, base], `${numero} (${fila})`);
  };
  // 264 / 2646
  caso("2646610123", "264", "SAN JUAN", "bloque_asignado", "fila 2114: 264 | 661 · antes 2646");
  caso("2646010123", "264", "SAN JUAN", "plan_numeracion", "fila 39392: 264 | 6010 · antes 2646");
  caso("2646400123", "2646", "SAN AGUSTIN DEL VALLE FERTIL", "bloque_asignado", "fila 15086: 2646 | 400");
  // 358 / 3584
  caso("3584620123", "358", "RIO CUARTO", "bloque_asignado", "fila 4543: 358 | 462 · antes 3584");
  caso("3584730123", "358", "RIO CUARTO", "bloque_asignado", "fila 1080: 358 | 473 · antes 3584");
  caso("3584000123", "358", "RIO CUARTO", "plan_numeracion", "fila 8240: 358 | 400 · antes 3584");
  caso("3584400123", "3584", "LA CARLOTA", "bloque_asignado", "fila 11725: 3584 | 400");
  // 294 / 2945 y 294 / 2940
  caso("2945360123", "294", "SAN CARLOS DE BARILOCHE", "bloque_asignado", "fila 41880: 294 | 5360 · antes 2945");
  caso("2945000123", "294", "SAN CARLOS DE BARILOCHE", "plan_numeracion", "fila 41878: 294 | 500 · antes 2945");
  caso("2945201234", "2945", "ESQUEL", "bloque_asignado", "fila 42757: 2945 | 20");
  caso("2940400123", "2940", "INGENIERO JACOBACCI", "plan_numeracion", "fila 9329: 2940 | 400");
  // 343 / 3435
  caso("3435700123", "343", "PARANA", "bloque_asignado", "fila 43502: 343 | 570 · antes 3435");
  caso("3435400123", "3435", "NOGOYA", "bloque_asignado", "fila 17180: 3435 | 400");
  // 353 / 3532: 353 no tiene bloques que empiecen con 2.
  caso("3532400123", "3532", "OLIVA", "bloque_asignado", "fila 15800: 3532 | 400");
}

// ── 4. Plan Fundamental (Res. SC 46/97, III.2.1.2): el abonado no empieza con 0 ni 1 ─
{
  // 2940: leerlo como 294 dejaría un abonado que empieza con 0. Vale para todo 2940…
  const jacobacci = indicativoDe("2940999999");
  assert.ok(jacobacci.ok && jacobacci.indicativo === "2940" && jacobacci.base === "plan_numeracion");
  // …y al revés: 3532 + "000001" no es un abonado válido; queda 353 + "2000001".
  const vm = indicativoDe("3532000001");
  assert.ok(vm.ok && vm.indicativo === "353" && vm.base === "plan_numeracion");
  // Las dos lecturas inválidas: ningún bloque puede contenerlo.
  assert.deepEqual(indicativoDe("2940012345"), { ok: false, motivo: "sin_bloque_asignado", candidatos: ["294", "2940"] });
}

// ── 5. Sin fuente que decida: indeterminado ─────────────────────────────────
{
  // Las dos lecturas son válidas y ninguna cae en un bloque asignado.
  assert.deepEqual(indicativoDe("3532999999"), { ok: false, motivo: "sin_bloque_asignado", candidatos: ["353", "3532"] });
  assert.deepEqual(indicativoDe("2646500000"), { ok: false, motivo: "sin_bloque_asignado", candidatos: ["264", "2646"] });
  // Con una sola lectura posible, la tabla alcanza: no se exige bloque.
  for (const [n, i] of [["1155550101", "11"], ["3515550101", "351"], ["3543550101", "3543"], ["3534000001", "353"]] as const) {
    const r = indicativoDe(n);
    assert.ok(r.ok && r.indicativo === i && r.base === "tabla", `${n} → ${i}`);
  }
  assert.deepEqual(indicativoDe("2000000001"), { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] });
  assert.deepEqual(indicativoDe("123"), { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] });
}

// ── 6. Contraprueba con lo escrito: la posición del "15" ────────────────────
{
  assert.equal(indicativoEscrito("0294 15-5123456"), "294");
  assert.equal(indicativoEscrito("02945 15-123456"), "2945");
  assert.equal(indicativoEscrito("011 15-5555-0101"), "11");
  assert.equal(indicativoEscrito("0351 15 555-0101"), "351");
  assert.equal(indicativoEscrito("+54 9 351 555-0101"), null, "sin 15 no se sabe dónde termina");
  assert.equal(indicativoEscrito("3515550101"), null);
  assert.equal(indicativoEscrito("abc"), null);
  assert.equal(indicativoEscrito(null), null);

  // Dos formas escritas dan el MISMO canónico; solo una coincide con la fuente.
  assert.equal(normalizarTelefono("02945 15-201234"), "2945201234");
  assert.equal(normalizarTelefono("0294 15-5201234"), "2945201234");
  const esquel = indicativoDe("2945201234", ["02945 15-201234", "+54 9 2945 201234"]);
  assert.ok(esquel.ok && esquel.indicativo === "2945" && esquel.area === "ESQUEL");
  assert.deepEqual(indicativoDe("2945201234", ["0294 15-5201234"]), { ok: false, motivo: "contradice_lo_escrito", candidatos: ["294", "2945"] });
  // Basta con UNA forma contradictoria para no decidir.
  assert.equal(indicativoDe("2945201234", ["02945 15-201234", "0294 15-5201234"]).ok, false);
  // Bloque de 294 dentro de 2945…: escrito como 294, coincide; escrito como 2945, no.
  const bariloche = indicativoDe("2945360123", ["0294 15-5360123"]);
  assert.ok(bariloche.ok && bariloche.indicativo === "294");
  assert.equal(indicativoDe("2945360123", ["02945 15-360123"]).ok, false);
  // 353 por el plan, escrito como 353: coincide.
  assert.equal(normalizarTelefono("0353 15-2000001"), "3532000001");
  const villaMaria = indicativoDe("3532000001", ["0353 15-2000001"]);
  assert.ok(villaMaria.ok && villaMaria.indicativo === "353");
  // Lo escrito nunca decide por sí solo un indeterminado.
  assert.deepEqual(indicativoDe("3532999999", ["03532 15-999999"]), { ok: false, motivo: "sin_bloque_asignado", candidatos: ["353", "3532"] });
}

console.log("indicativo: ok");
