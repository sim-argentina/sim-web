import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Guard de la API de resultado de compra (hotfix M7.2).
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesResultadoApiGuard.test.ts
//
// Se invoca el route handler DE VERDAD —no se leen sus fuentes— y se comprueban
// las dos mitades del contrato:
//
//   · con MENSUALIDADES_ENABLED apagada responde 404 {"error":"No encontrado"}
//     y NO toca la base: se espía supabaseAdmin y se cuenta cada acceso, así que
//     si alguien mueve el guard debajo de la primera consulta, esto falla;
//   · con la flag encendida vuelve al comportamiento de siempre.
//
// Nada de esto hace pagos ni escribe: el único camino que llega a la base es una
// lectura por token inexistente, y solo ocurre con la flag encendida.

type Contador = { from: number; rpc: number };

/** Envuelve supabaseAdmin para contar accesos sin cambiar lo que hace. */
function espiar(): { contador: Contador; restaurar: () => void } {
  const contador: Contador = { from: 0, rpc: 0 };
  const cliente = supabaseAdmin as unknown as Record<string, unknown>;
  const fromOrig = cliente.from as (...a: unknown[]) => unknown;
  const rpcOrig = cliente.rpc as (...a: unknown[]) => unknown;

  cliente.from = (...a: unknown[]) => { contador.from++; return fromOrig.apply(supabaseAdmin, a); };
  cliente.rpc = (...a: unknown[]) => { contador.rpc++; return rpcOrig.apply(supabaseAdmin, a); };

  return {
    contador,
    restaurar: () => { cliente.from = fromOrig; cliente.rpc = rpcOrig; },
  };
}

const URL_BASE = "https://simexperience.com.ar/api/mensualidades/resultado";
const pedido = (qs: string) => new Request(`${URL_BASE}${qs}`);

/** Los parámetros que llegan en el mundo real, más basura inventada. */
const VARIANTES = [
  ["sin parámetros", ""],
  ["payment_id", "?payment_id=1234567890"],
  ["collection_status", "?collection_status=approved"],
  ["vuelta completa de MP", "?collection_id=1&collection_status=approved&payment_id=1&status=approved&preference_id=x"],
  ["token con forma válida", "?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ["token malformado", "?t=corto"],
  ["token vacío", "?t="],
  ["parámetros inventados", "?foo=bar&admin=1&flag=true&t[]=1"],
  ["mayúsculas", "?T=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
] as const;

async function main() {
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;
  const { GET } = await import("@/app/api/mensualidades/resultado/route");

  // ── 1) Flag apagada: 404 neutral en todas las variantes, sin tocar la base ──
  {
    delete process.env.MENSUALIDADES_ENABLED;
    const espia = espiar();
    try {
      for (const [nota, qs] of VARIANTES) {
        const res = await GET(pedido(qs));
        assert.equal(res.status, 404, `M7.2 ${nota} → 404`);
        const cuerpo = await res.json();
        assert.deepEqual(cuerpo, { error: "No encontrado" },
          `M7.2 ${nota}: cuerpo neutral exacto`);
        // No se filtra nada de la compra ni del titular.
        const crudo = JSON.stringify(cuerpo);
        for (const prohibido of ["codigo", "saldo", "vence", "plan", "telefono", "email", "compra"]) {
          assert.ok(!crudo.includes(prohibido), `M7.2 ${nota}: no expone "${prohibido}"`);
        }
        assert.match(res.headers.get("cache-control") ?? "", /no-store/,
          `M7.2 ${nota}: el 404 de la flag no se cachea`);
      }

      assert.equal(espia.contador.from, 0,
        "M7.2 con la flag apagada NO se consulta ni una tabla");
      assert.equal(espia.contador.rpc, 0,
        "M7.2 con la flag apagada NO se ejecuta ni una función de la base");
    } finally {
      espia.restaurar();
    }
  }

  // ── 2) Solo el "true" exacto enciende ──
  {
    const espia = espiar();
    try {
      for (const falso of ["", " ", "1", "TRUE", "True", "yes", "false", " true", "true ", "0"]) {
        process.env.MENSUALIDADES_ENABLED = falso;
        const res = await GET(pedido("?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        assert.equal(res.status, 404, `M7.2 ${JSON.stringify(falso)} no enciende la flag`);
        assert.deepEqual(await res.json(), { error: "No encontrado" });
      }
      assert.equal(espia.contador.from + espia.contador.rpc, 0,
        "M7.2 ningún valor falso llega a la base");
    } finally {
      espia.restaurar();
    }
  }

  // ── 3) Flag encendida: vuelve el comportamiento de M3 ──
  // Un token con forma válida pero inexistente tiene que dar el 404 PROPIO de la
  // API —"No encontramos esa compra."—, distinto del de la flag. Que sean
  // distintos es lo que prueba que el guard quedó atrás y no se come el resto.
  {
    process.env.MENSUALIDADES_ENABLED = "true";
    const espia = espiar();
    try {
      const res = await GET(pedido("?t=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "No encontramos esa compra." },
        "M7.2 con la flag encendida contesta la API, no el guard");
      assert.ok(espia.contador.from >= 1,
        "M7.2 con la flag encendida SÍ consulta la base: el comportamiento anterior sigue vivo");

      // Y un token malformado sigue cortando antes de la base, como siempre.
      const antes = espia.contador.from;
      const malo = await GET(pedido("?t=corto"));
      assert.equal(malo.status, 404);
      assert.deepEqual(await malo.json(), { error: "No encontramos esa compra." });
      assert.equal(espia.contador.from, antes,
        "M7.2 un token malformado no llega a la base, igual que antes");
    } finally {
      espia.restaurar();
    }
  }

  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  else delete process.env.MENSUALIDADES_ENABLED;

  // ── 4) El webhook NO lleva este guard, y no debe llevarlo ──
  // Un pago ya iniciado tiene que poder acreditarse aunque se apague la
  // superficie pública. Si alguien "completa" el hotfix poniéndole la flag,
  // se pierden confirmaciones de Mercado Pago.
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/mensualidades/webhook/route.ts", "utf8");
    assert.ok(
      !/mensualidadesHabilitadas\s*\(|process\.env\.MENSUALIDADES_ENABLED/.test(src),
      "M7.2 el webhook de Mercado Pago NO puede depender de la feature flag",
    );
  }

  console.log("mensualidadesResultadoApiGuard.test.ts OK (API cerrada por flag, sin tocar la base)");
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
