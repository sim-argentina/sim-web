import { strict as assert } from "node:assert";
import { resumirMes, type ComisionesResumen, type ComisionesWebResumen, type FinCuenta } from "@/lib/finanzas";

// Cómo entran las comisiones web (Checkout Pro) en el resumen del mes.
//
// Reglas que se verifican:
//   · El revenue BRUTO y los ingresos por fuente no cambian: son la métrica
//     comercial y siguen siendo lo que pagó el cliente.
//   · El saldo de Mercado Pago y el revenue NETO sí descuentan los cargos.
//   · Se descuenta UNA sola vez: nunca "bruto − cargos" y además "+ neto".
//   · Las comisiones del stand y las web se suman pero quedan separadas.
//
// resumirMes es una función pura, pero vive en un módulo que abre el cliente de
// Supabase al importarse; de ahí el --env-file.
//
// Ejecutar: npx tsx --env-file=.env.local lib/finanzasComisionesWeb.test.ts

const CUENTAS: FinCuenta[] = [
  { id: "ef", nombre: "Efectivo", ambito: "sim", tipo: "efectivo", activa: true, orden: 1 },
  { id: "mp", nombre: "Mercado Pago", ambito: "sim", tipo: "mercado_pago", activa: true, orden: 2 },
];

const comisionesStand = (comision: number): ComisionesResumen => ({
  brutoStand: 100000, comisionStand: comision, netoStand: 100000 - comision,
  tasaEfectiva: comision / 100000, porMetodo: {}, porProcesador: {},
  detalle: [], advertencias: [], sinConfig: false,
});

const comisionesWeb = (cargos: number, extra: Partial<ComisionesWebResumen> = {}): ComisionesWebResumen => ({
  bruto: 120000, cargos, neto: 120000 - cargos, brutoSinDatos: 0,
  cantidad: 6, cantidadSinDatos: 0, cantidadNoConciliados: 0,
  tasaEfectiva: cargos / 120000, porProducto: {}, detalle: [], sinDatos: [],
  ...extra,
});

function armar(opts: { comStand?: number; comWeb?: ComisionesWebResumen | null } = {}) {
  return resumirMes({
    mes: "2026-09",
    movimientos: [],
    // 120.000 de cobros web + 50.000 de efectivo en el stand.
    ingresosAuto: [
      { fuente: "campeonatos", fuenteLabel: "Campeonatos", categoria: "x", metodo: "mercadopago", cuentaTipo: "mercado_pago", total: 120000, cantidad: 6 },
      { fuente: "turnero", fuenteLabel: "Turnero", categoria: "x", metodo: "efectivo", cuentaTipo: "efectivo", total: 50000, cantidad: 10 },
    ],
    ingresosAutoTotal: 170000,
    turnosDelMes: 10,
    saldoInicialGeneral: 0,
    saldoInicialEfectivo: 0,
    saldoInicialMp: 0,
    sueldoAsignado: 0,
    cuentas: CUENTAS,
    categorias: [],
    comisionesData: comisionesStand(opts.comStand ?? 0),
    comisionesWebData: opts.comWeb === undefined ? comisionesWeb(9584.04) : opts.comWeb,
  });
}

const mpDe = (r: ReturnType<typeof armar>) => r.porFuente.find((f) => f.tipo === "mercado_pago")!;
const efDe = (r: ReturnType<typeof armar>) => r.porFuente.find((f) => f.tipo === "efectivo")!;

// ── 1) Métricas comerciales: siguen en BRUTO ────────────────────────────────
{
  const r = armar({ comStand: 1000 });
  assert.equal(r.ingresosBruto, 170000, "el revenue bruto no descuenta comisiones");
  assert.equal(r.ingresosAutomaticos, 170000, "los ingresos automáticos son brutos");
  assert.equal(mpDe(r).ingresos, 120000, "los ingresos por fuente quedan en bruto");
}

// ── 2) Revenue neto y saldo MP: descuentan las dos comisiones ───────────────
{
  const r = armar({ comStand: 1000 });
  assert.equal(r.comisionesCobro, 1000, "comisiones del stand");
  assert.equal(r.comisionesWebTotal, 9584.04, "comisiones web reales");
  assert.equal(r.comisionesTotales, 10584.04, "total = stand + web");
  assert.equal(r.ingresos, 170000 - 10584.04, "revenue neto descuenta ambas");

  const mp = mpDe(r);
  assert.equal(mp.comisionesStand, 1000);
  assert.equal(mp.comisionesWeb, 9584.04);
  assert.equal(mp.comisiones, 10584.04, "la fuente imputa el total");
  assert.equal(mp.saldoTeorico, 120000 - 10584.04, "el saldo MP usa el neto acreditado");
}

// ── 3) Efectivo no carga ninguna comisión ──────────────────────────────────
{
  const ef = efDe(armar({ comStand: 1000 }));
  assert.equal(ef.comisionesStand, 0);
  assert.equal(ef.comisionesWeb, 0, "los cobros web no entran por efectivo");
  assert.equal(ef.saldoTeorico, 50000, "el efectivo no se toca");
}

// ── 4) Sin doble descuento ─────────────────────────────────────────────────
// La identidad del desglose visual tiene que cerrar exactamente: si en algún
// lado se sumara el neto ADEMÁS de restar el cargo, esto no daría.
{
  const r = armar({ comStand: 1000 });
  const mp = mpDe(r);
  const suma =
    mp.saldoInicial + mp.ingresos + mp.financiamiento + mp.transferenciasEntrantes -
    mp.egresos - mp.comisiones - mp.reembolsos - mp.transferenciasSalientes;
  assert.equal(suma, mp.saldoTeorico, "saldo inicial + ingresos − egresos − comisiones ± transferencias");
  assert.ok(
    Math.abs(mp.comisionesStand + mp.comisionesWeb - mp.comisiones) < 0.005,
    "el total es la suma (redondeada a centavos), no un tercer descuento"
  );
  // El cargo se resta una sola vez respecto del bruto.
  assert.equal(mp.saldoTeorico, 120000 - 1000 - 9584.04);
}

// ── 5) Sin comisiones web el resultado es el de antes ──────────────────────
{
  const r = armar({ comStand: 1000, comWeb: null });
  assert.equal(r.comisionesWebTotal, 0);
  assert.equal(r.comisionesTotales, 1000);
  assert.equal(mpDe(r).saldoTeorico, 120000 - 1000, "sin datos web, el saldo es el anterior");
  assert.equal(r.ingresosBruto, 170000, "el bruto nunca cambia");
}

// ── 6) Pagos sin comisión disponible: NO bajan el saldo a ciegas ───────────
// El bruto sigue contado (la operación existe) y el faltante queda expuesto en
// brutoSinDatos para que la UI lo muestre como advertencia.
{
  const conFaltante = comisionesWeb(9584.04, {
    bruto: 120000, cantidad: 6,
    brutoSinDatos: 20000, cantidadSinDatos: 1,
  });
  const r = armar({ comStand: 0, comWeb: conFaltante });
  assert.equal(r.comisionesWebTotal, 9584.04, "solo se descuenta lo que MP informó");
  assert.equal(r.comisionesWeb!.brutoSinDatos, 20000, "el bruto sin comisión queda visible");
  assert.equal(r.comisionesWeb!.cantidadSinDatos, 1);
  assert.equal(mpDe(r).saldoTeorico, 120000 - 9584.04, "no se inventa un cargo para el pago sin datos");
}

// ── 7) Las dos comisiones no se mezclan ────────────────────────────────────
{
  const r = armar({ comStand: 53091.66, comWeb: comisionesWeb(9584.04) });
  assert.notEqual(r.comisionesCobro, r.comisionesWebTotal, "son conceptos distintos");
  assert.equal(r.comisiones!.comisionStand, 53091.66, "el detalle del stand no incluye lo web");
  assert.equal(r.comisionesWeb!.cargos, 9584.04, "el detalle web no incluye lo del stand");
  assert.equal(r.comisionesTotales, 62675.70);
}

console.log("OK — finanzasComisionesWeb: métricas comerciales en bruto, saldo y revenue neto con cargos reales, sin doble descuento y comisiones stand/web separadas.");
