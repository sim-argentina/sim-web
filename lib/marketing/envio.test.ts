import { strict as assert } from "node:assert";
import { estimarCosto } from "@/lib/marketing/costo";
import {
  CODIGO_FALSO_DESTINO_NO_LOOPBACK,
  CODIGO_FALSO_EN_PRODUCCION,
  CODIGO_FALSO_VERCEL_INDETERMINADO,
  CODIGO_REAL_NO_DISPONIBLE,
  CODIGO_SIN_PROVEEDOR,
  crearProveedorFalso,
  evaluarProveedorWhatsapp,
  type MensajePlantilla,
} from "@/lib/marketing/proveedorWhatsapp";

// Marketing · costo estimado y proveedor de WhatsApp falso (Etapa 1). Puro.
// Ejecutar: npx tsx lib/marketing/envio.test.ts
// La red está bloqueada: si el proveedor falso intentara salir, la prueba falla.

let llamadasRed = 0;
globalThis.fetch = (() => {
  llamadasRed++;
  throw new Error("red prohibida en las pruebas de envío");
}) as typeof fetch;

async function main() {
  // ── 1. Costo: la tarifa es un parámetro y se cobra por entregado ──────────
  {
    const e = estimarCosto({ destinatarios: 50, tarifaPorEntregado: 0.0618, moneda: "USD" });
    assert.deepEqual(e, { destinatarios: 50, enviables: 50, recortadoPor: [], tarifaPorEntregado: 0.0618, moneda: "USD", costoMaximo: 3.09 });
    assert.equal(estimarCosto({ destinatarios: 0, tarifaPorEntregado: 70, moneda: "ARS" }).costoMaximo, 0);

    const conLimite = estimarCosto({ destinatarios: 300, tarifaPorEntregado: 0.0618, moneda: "USD", limiteDestinatarios: 30 });
    assert.equal(conLimite.enviables, 30);
    assert.deepEqual(conLimite.recortadoPor, ["limite"]);
    assert.equal(conLimite.costoMaximo, 1.85, "30 × 0,0618 = 1,854");

    // Sin errores de coma flotante: 0,3 / 0,1 son 3 mensajes, no 2.
    assert.equal(estimarCosto({ destinatarios: 10, tarifaPorEntregado: 0.1, moneda: "USD", presupuestoMaximo: 0.3 }).enviables, 3);
    const ambos = estimarCosto({ destinatarios: 300, tarifaPorEntregado: 0.0618, moneda: "USD", limiteDestinatarios: 30, presupuestoMaximo: 1 });
    assert.equal(ambos.enviables, 16, "1 / 0,0618 = 16,18");
    assert.deepEqual(ambos.recortadoPor, ["limite", "presupuesto"]);
    assert.equal(estimarCosto({ destinatarios: 5, tarifaPorEntregado: 0.0618, moneda: "USD", presupuestoMaximo: 0 }).enviables, 0);

    for (const malo of [
      { destinatarios: -1, tarifaPorEntregado: 1, moneda: "USD" },
      { destinatarios: 1.5, tarifaPorEntregado: 1, moneda: "USD" },
      { destinatarios: 1, tarifaPorEntregado: 0, moneda: "USD" },
      { destinatarios: 1, tarifaPorEntregado: Number.NaN, moneda: "USD" },
      { destinatarios: 1, tarifaPorEntregado: 1, moneda: " " },
      { destinatarios: 1, tarifaPorEntregado: 1, moneda: "USD", limiteDestinatarios: -2 },
      { destinatarios: 1, tarifaPorEntregado: 1, moneda: "USD", presupuestoMaximo: -1 },
    ]) {
      assert.throws(() => estimarCosto(malo), `${JSON.stringify(malo)} se rechaza`);
    }
  }

  // ── 2. Proveedor falso: registra, es idempotente y no sale a la red ───────
  {
    const p = crearProveedorFalso();
    const m: MensajePlantilla = {
      destino: "5493515550101",
      plantilla: "recuperacion_stand",
      idioma: "es_AR",
      variables: ["Ana"],
      codigoCupon: "SIMULADO",
      claveIdempotencia: "campania-prueba:3515550101",
    };
    const r1 = await p.enviarPlantilla(m);
    assert.deepEqual(r1, { ok: true, wamid: "wamid.FALSO.1", repetido: false });
    const r2 = await p.enviarPlantilla({ ...m, variables: ["Otro"] });
    assert.deepEqual(r2, { ok: true, wamid: "wamid.FALSO.1", repetido: true }, "un envío por clave");
    assert.equal(p.enviados.length, 1);
    assert.deepEqual(p.enviados[0].variables, ["Ana"]);

    assert.equal((await p.enviarPlantilla({ ...m, destino: "3515550101", claveIdempotencia: "x" })).ok, false, "sin 549 no sale");
    assert.equal((await p.enviarPlantilla({ ...m, destino: "54935155501011", claveIdempotencia: "y" })).ok, false);
    const incompleto = await p.enviarPlantilla({ ...m, plantilla: " ", claveIdempotencia: "z" });
    assert.ok(!incompleto.ok && incompleto.codigo === "mensaje_incompleto");
    assert.equal(p.enviados.length, 1, "los rechazados no se registran");

    // Respuestas de Meta simuladas: una baja de marketing no es transitoria.
    const conFallas = crearProveedorFalso({
      fallar: (x) => (x.destino.endsWith("02") ? { ok: false, codigo: "131050", transitorio: false, detalle: "frenó el marketing" } : null),
    });
    const baja = await conFallas.enviarPlantilla({ ...m, destino: "5493515550102", claveIdempotencia: "k2" });
    assert.ok(!baja.ok && baja.codigo === "131050" && !baja.transitorio);
    assert.equal(conFallas.enviados.length, 0);
    assert.equal((await conFallas.enviarPlantilla({ ...m, claveIdempotencia: "k1" })).ok, true);
    assert.equal(llamadasRed, 0, "el proveedor falso nunca tocó la red");
  }

  // ── 3. Qué proveedor puede persistir envíos: falla cerrada por destino ────
  {
    const LOCAL = "http://127.0.0.1:54321";
    const PROD = "https://bcmoewwhsyxsiyvroarj.supabase.co";
    const codigo = (e: Record<string, string | undefined>) => {
      const v = evaluarProveedorWhatsapp(e);
      return v.ok ? `ok:${v.motivo}` : v.codigo;
    };
    assert.equal(codigo({}), CODIGO_SIN_PROVEEDOR, "sin configurar no se envía nada");
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "cloud_api" }), CODIGO_REAL_NO_DISPONIBLE);
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: LOCAL }), "ok:destino_loopback");
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "FAKE", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }), "ok:destino_loopback");
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: PROD }), CODIGO_FALSO_DESTINO_NO_LOOPBACK, "un portátil con .env.local de Producción");
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "fake", NEXT_PUBLIC_SUPABASE_URL: "https://localhost.evil.com" }), CODIGO_FALSO_DESTINO_NO_LOOPBACK);
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: LOCAL }), CODIGO_FALSO_EN_PRODUCCION);
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "fake", VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: PROD }), CODIGO_FALSO_VERCEL_INDETERMINADO);
    assert.equal(codigo({ MARKETING_WHATSAPP_PROVIDER: "fake", VERCEL: "1", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD }), "ok:vercel_preview");
  }

  console.log("envio: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
