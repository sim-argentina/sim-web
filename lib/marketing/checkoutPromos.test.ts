import { strict as assert } from "node:assert";
import { leerPromosCheckout, type DatosRpc } from "@/lib/marketing/consentimiento";
import { claveDeCompra, registrarPromosCheckout, type ArgsPromosCheckout } from "@/lib/marketing/checkoutPromos";
import type { R, Registrado } from "@/lib/marketing/consentimientoServer";
import { emitirTokenFormulario } from "@/lib/marketing/tokenFormulario";

// Marketing · casilla voluntaria de promociones en el checkout. Sin base ni red:
// el registro se inyecta. Lo que importa: sin casilla no se registra nada, y
// pase lo que pase con el registro, el helper no lanza ni bloquea.
// Ejecutar: npx tsx lib/marketing/checkoutPromos.test.ts

globalThis.fetch = (() => {
  throw new Error("red prohibida en las pruebas del checkout");
}) as typeof fetch;

process.env.ADMIN_SESSION_SECRET = "secreto-de-prueba-del-checkout";
const AHORA = new Date("2026-10-19T15:10:00.000Z");
const MOSTRADO = new Date("2026-10-19T15:00:00.000Z");
const H = "c".repeat(64);
const TOKEN = emitirTokenFormulario("promos-v1", MOSTRADO)!;
const promosOk = { acepto: true, texto_version: "promos-v1", texto_huella: H, token: TOKEN };

type Llamada = { clave: string; datos: DatosRpc; rol: string };
function registrador(respuesta: () => Promise<R<Registrado>>) {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    registrar: async (clave: string, datos: DatosRpc, rol: "publico") => {
      llamadas.push({ clave, datos, rol });
      return respuesta();
    },
  };
}
const exito = async (): Promise<R<Registrado>> => ({
  ok: true,
  valor: { telefono: "3515550101", estado: "alta", repetida: false, evento: { id: "e", tipo: "alta", fuente: "checkout_reserva", ocurrido_en: "", registrado_en: "" } },
});

function args(body: unknown, deps: ArgsPromosCheckout["deps"], extra: Partial<ArgsPromosCheckout> = {}): ArgsPromosCheckout {
  return {
    body, fuente: "checkout_reserva", telefono: "351 555-0101", nombre: "  Ana   López ",
    compra: { reserva_id: "123" }, ip: "200.1.2.3", ahora: AHORA, deps: { habilitada: () => true, ...deps }, ...extra,
  };
}

async function main() {
  // ── 1. Qué cuenta como "marcó la casilla" ─────────────────────────────────
  {
    assert.deepEqual(leerPromosCheckout({}), { solicitada: false });
    assert.deepEqual(leerPromosCheckout(null), { solicitada: false });
    assert.deepEqual(leerPromosCheckout({ promos: null }), { solicitada: false });
    assert.deepEqual(leerPromosCheckout({ promos: { ...promosOk, acepto: false } }), { solicitada: false }, "desmarcada");
    assert.deepEqual(leerPromosCheckout({ promos: { ...promosOk, acepto: "true" } }), { solicitada: false }, "solo el booleano true");
    assert.deepEqual(leerPromosCheckout({ promos: { ...promosOk, acepto: 1 } }), { solicitada: false });
    assert.deepEqual(leerPromosCheckout({ promos: { acepto: true } }), { solicitada: true, valida: false });
    assert.deepEqual(leerPromosCheckout({ promos: { ...promosOk, token: "x" } }), { solicitada: true, valida: false });
    assert.deepEqual(leerPromosCheckout({ promos: promosOk }), { solicitada: true, valida: true, texto_version: "promos-v1", texto_huella: H, token: TOKEN });
  }

  // ── 2. Sin casilla marcada: no se llama al registro ───────────────────────
  {
    for (const body of [{}, { promos: { ...promosOk, acepto: false } }, { promos: "si" }, { acepto_condiciones: true }]) {
      const reg = registrador(exito);
      assert.deepEqual(await registrarPromosCheckout(args(body, { registrar: reg.registrar })), { estado: "no_solicitada" });
      assert.equal(reg.llamadas.length, 0, `${JSON.stringify(body)}: nada registrado`);
    }
  }

  // ── 3. Casilla marcada y todo en orden: se registra con su evidencia ──────
  {
    const reg = registrador(exito);
    const r = await registrarPromosCheckout(args({ promos: promosOk }, { registrar: reg.registrar }));
    assert.deepEqual(r, { estado: "registrada" });
    assert.equal(reg.llamadas.length, 1);
    const { clave, datos, rol } = reg.llamadas[0];
    assert.equal(rol, "publico");
    assert.equal(clave, claveDeCompra("reserva:123"), "la clave sale de la compra");
    assert.match(clave, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(datos.fuente, "checkout_reserva");
    assert.equal(datos.tipo, "alta");
    assert.equal(datos.solicitado_en, MOSTRADO.toISOString(), "la fecha es la de cuando se mostró el texto");
    assert.equal(datos.nombre, "Ana López");
    assert.equal(datos.texto_version, "promos-v1");
    assert.equal(datos.evidencia?.reserva_id, "123");
    assert.equal(datos.evidencia?.pagina, "/reservas");
    assert.match(datos.evidencia?.ip_hash ?? "", /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(datos).includes("200.1.2.3"), "la IP no viaja");
    // Gift Cards: otra fuente, otra evidencia, otra clave.
    const reg2 = registrador(exito);
    await registrarPromosCheckout(args({ promos: promosOk }, { registrar: reg2.registrar }, { fuente: "checkout_gift_card", compra: { grupo_compra_id: "6f1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d" } }));
    assert.equal(reg2.llamadas[0].datos.evidencia?.grupo_compra_id, "6f1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d");
    assert.equal(reg2.llamadas[0].datos.evidencia?.pagina, "/gift-cards");
    assert.notEqual(reg2.llamadas[0].clave, clave);
  }

  // ── 4. Ninguna falla bloquea la compra ni se disfraza de suscripción ──────
  {
    const casos: [string, ArgsPromosCheckout, string][] = [
      ["captación apagada", args({ promos: promosOk }, { habilitada: () => false, registrar: registrador(exito).registrar }), "captacion_apagada"],
      ["pedido incompleto", args({ promos: { acepto: true } }, { registrar: registrador(exito).registrar }), "pedido_incompleto"],
      ["token vencido", args({ promos: promosOk }, { registrar: registrador(exito).registrar }, { ahora: new Date(MOSTRADO.getTime() + 3 * 3_600_000) }), "formulario_vencido"],
      ["la base rechaza", args({ promos: promosOk }, {
        registrar: registrador(async () => ({ ok: false, e: { status: 409, codigo: "texto_desactualizado", error: "x" } })).registrar,
      }), "texto_desactualizado"],
      ["error inesperado de la base", args({ promos: promosOk }, { registrar: registrador(async () => ({ ok: false, e: null, causa: "boom" })).registrar }), "error_inesperado"],
      ["la base explota", args({ promos: promosOk }, { registrar: registrador(async () => { throw new Error("conexión caída"); }).registrar }), "error_inesperado"],
      ["la base no contesta", args({ promos: promosOk }, { registrar: registrador(() => new Promise(() => {})).registrar, timeoutMs: 30 }), "tiempo_agotado"],
    ];
    for (const [nombre, a, motivo] of casos) {
      const r = await registrarPromosCheckout(a);
      assert.deepEqual(r, { estado: "no_registrada", motivo }, nombre);
    }
  }

  console.log("checkoutPromos: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
