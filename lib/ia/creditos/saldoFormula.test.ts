import { strict as assert } from "node:assert";
import { saldoConciliado } from "@/lib/ia/creditos/saldoFormula";
import { usdANanoUsd, nanoUsdAString, NANO } from "@/lib/ia/creditos/dinero";

// Ejecutar: npx tsx lib/ia/creditos/saldoFormula.test.ts
// Fórmula conciliada: saldo = S + M − (C − B). Todo en nano-USD (BigInt, exacto).

const n = (s: string) => usdANanoUsd(s);

// 1) Carga US$5 sin consumo (modo sin conciliación: monetario − C) → US$5.
//    Equivalente conciliado con S=5,B=0,C=0,M=0.
assert.equal(saldoConciliado(n("5"), 0n, 0n, 0n), 5n * NANO, "5 sin consumo → 5");

// 3) Conciliación US$4,92 con consumo posterior → saldo < 4,92.
{
  const s = saldoConciliado(n("4.92"), 0n, n("0.437781"), n("0")); // C=0.437781 desde B=0
  assert.ok(s < n("4.92"), "con consumo posterior el saldo baja de 4,92");
  assert.equal(nanoUsdAString(s, 6), "4.482219", "4.92 − 0.437781 = 4.482219");
}

// 4) El consumo PREVIO (absorbido en S=B) no se descuenta dos veces.
{
  // B=0.0982 ya está en S; solo se descuenta lo posterior (C−B).
  const s = saldoConciliado(n("4.92"), 0n, n("0.536020"), n("0.098239"));
  assert.equal(nanoUsdAString(s, 6), "4.482219", "solo descuenta C−B = 0.437781, no B otra vez");
}

// 5) Carga posterior aumenta el saldo (M > 0).
{
  const sinCarga = saldoConciliado(n("4.92"), 0n, n("0.5"), n("0.1"));
  const conCarga = saldoConciliado(n("4.92"), n("20"), n("0.5"), n("0.1"));
  assert.equal(conCarga - sinCarga, 20n * NANO, "una carga de 20 suma 20 al saldo");
}

// 6) Ajuste positivo y negativo posterior (van dentro de M con signo).
{
  const s = saldoConciliado(n("4.92"), n("1") - n("2"), n("0.2"), n("0.1")); // +1 −2 → M = −1
  assert.equal(nanoUsdAString(s, 6), nanoUsdAString(n("4.92") - n("1") - (n("0.2") - n("0.1")), 6), "M = +1 −2 = −1; menos (C−B)=0.1");
}

// 7) Crédito vencido posterior (negativo en M).
{
  const s = saldoConciliado(n("4.92"), -n("0.5"), n("0.1"), n("0.1")); // vencimiento −0.5, sin consumo posterior
  assert.equal(nanoUsdAString(s, 6), "4.420000", "4.92 − 0.5 = 4.42");
}

// 12) Saldo negativo permitido (no se trunca a cero).
{
  const s = saldoConciliado(n("0.10"), 0n, n("5"), n("0")); // consumió más de lo que había
  assert.ok(s < 0n, "el saldo puede ser negativo");
  assert.equal(nanoUsdAString(s, 6), "-4.900000", "0.10 − 5 = −4.90");
}

// 15) Aritmética exacta (sin floating point): 0.1 + 0.2 − 0 = 0.3 exacto.
{
  const s = saldoConciliado(n("0.1"), n("0.2"), 0n, 0n);
  assert.equal(nanoUsdAString(s, 9), "0.300000000", "0.1+0.2 = 0.3 exacto (no 0.30000000004)");
}

// 9/10) Cruce de mes/año: la fórmula no depende del período (C y B son acumulados globales).
{
  const dic = saldoConciliado(n("10"), 0n, n("2"), n("1"));
  const ene = saldoConciliado(n("10"), 0n, n("2"), n("1"));
  assert.equal(dic, ene, "el acumulado atraviesa dic→ene sin reiniciarse");
}

console.log("OK — saldoFormula: S+M−(C−B), consumo previo no se duplica, cargas/ajustes/vencimientos posteriores, saldo negativo permitido, exactitud, cruce de período.");
