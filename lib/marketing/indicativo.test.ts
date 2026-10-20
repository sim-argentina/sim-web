import { strict as assert } from "node:assert";
import { FUENTE_INDICATIVOS, INDICATIVOS_ARGENTINA } from "@/lib/indicativosArgentina";
import { AREAS_3_DIGITOS, normalizarTelefono } from "@/lib/mensualidades";
import { AREA_OFICIAL_2, AREAS_OFICIALES_3, AREAS_OFICIALES_4_MUESTRA } from "@/lib/mensualidadesTelefono.fixtures";
import { areaDeIndicativo, esIndicativoOficial, indicativoDe, indicativoEscrito } from "@/lib/marketing/indicativo";

// Marketing · indicativo interurbano (tabla oficial de ENACOM). Puro.
// Ejecutar: npx tsx lib/marketing/indicativo.test.ts

globalThis.fetch = (() => {
  throw new Error("red prohibida en las pruebas de indicativo");
}) as typeof fetch;

const codigos = INDICATIVOS_ARGENTINA.map(([i]) => i);
const de = (n: number) => codigos.filter((c) => c.length === n);

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
  assert.equal(de(4).filter((c) => de(3).includes(c.slice(0, 3))).length, 49, "49 de 4 dígitos empiezan con uno de 3");
  assert.ok(!de(4).some((c) => c.startsWith("1")), "ninguno de 4 empieza con 1: el 11 nunca es ambiguo");
  assert.deepEqual(areaDeIndicativo("351"), { area: "CORDOBA", provincia: "CORDOBA" });
  assert.equal(areaDeIndicativo("354"), null, "354 no existe: es solo el comienzo de 3541, 3543…");
}

// ── 2. Gana el indicativo oficial más largo, en TODOS los pares de la tabla ─
{
  let pares = 0;
  for (const c4 of de(4)) {
    const c3 = c4.slice(0, 3);
    if (!de(3).includes(c3)) continue;
    pares++;
    const r = indicativoDe(`${c4}${"0".repeat(6)}`);
    assert.ok(r.ok && r.indicativo === c4, `${c4}000000 es de ${c4}, no de ${c3}`);
    // Un abonado de c3 cuyo primer dígito no arma ningún indicativo de 4.
    const libre = "0123456789".split("").find((d) => !esIndicativoOficial(`${c3}${d}`))!;
    const r3 = indicativoDe(`${c3}${libre}${"0".repeat(6)}`);
    assert.ok(r3.ok && r3.indicativo === c3, `${c3}${libre}… es de ${c3}`);
  }
  assert.equal(pares, 49);
  for (const c of de(4).filter((x) => !de(3).includes(x.slice(0, 3)))) {
    const r = indicativoDe(`${c}000000`);
    assert.ok(r.ok && r.indicativo === c, `${c} sin colisión`);
  }
  const amba = indicativoDe("1155550101");
  assert.ok(amba.ok && amba.indicativo === "11" && amba.area === "AMBA");
  assert.deepEqual(indicativoDe("2000000001"), { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] });
  assert.deepEqual(indicativoDe("123"), { ok: false, motivo: "sin_indicativo_oficial", candidatos: [] });
}

// ── 3. Contraprueba con lo escrito: la posición del "15" ────────────────────
{
  assert.equal(indicativoEscrito("0294 15-5123456"), "294");
  assert.equal(indicativoEscrito("02945 15-123456"), "2945");
  assert.equal(indicativoEscrito("011 15-5555-0101"), "11");
  assert.equal(indicativoEscrito("0351 15 555-0101"), "351");
  assert.equal(indicativoEscrito("+54 9 351 555-0101"), null, "sin 15 no se sabe dónde termina");
  assert.equal(indicativoEscrito("3515550101"), null);
  assert.equal(indicativoEscrito("abc"), null);
  assert.equal(indicativoEscrito(null), null);

  // Los dos escritos dan el MISMO canónico; solo uno coincide con la tabla.
  assert.equal(normalizarTelefono("0294 15-5123456"), "2945123456");
  assert.equal(normalizarTelefono("02945 15-123456"), "2945123456");
  assert.deepEqual(indicativoDe("2945123456", ["0294 15-5123456"]), { ok: false, motivo: "contradice_lo_escrito", candidatos: ["294", "2945"] });
  const esquel = indicativoDe("2945123456", ["02945 15-123456", "+54 9 2945 123456"]);
  assert.ok(esquel.ok && esquel.indicativo === "2945" && esquel.area === "ESQUEL");
  // Basta con UNA forma contradictoria para no decidir.
  assert.equal(indicativoDe("2945123456", ["02945 15-123456", "0294 15-5123456"]).ok, false);
  // 353 / 3532: escrito con el 15 donde corresponde a 353 sobre un número que la tabla da a 3532.
  assert.equal(normalizarTelefono("0353 15-2000001"), "3532000001");
  assert.equal(indicativoDe("3532000001", ["0353 15-2000001"]).ok, false);
}

console.log("indicativo: ok");
