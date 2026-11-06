import { strict as assert } from "node:assert";
import { PostgrestClient } from "@supabase/postgrest-js";
import { EscrituraBloqueada, blindarCliente, crearFetchSoloLectura, type Transporte } from "@/lib/marketing/soloLectura";

// Marketing · transporte de solo lectura de la simulación. Con un transporte
// SIMULADO: ningún pedido sale a la red y la base que se nombra es ficticia.
// No es una suite mutante: no hay credenciales, el host no existe y la red real
// está bloqueada (se cuenta cualquier intento). Usa PostgrestClient, el armador de
// pedidos que el cliente de Supabase usa por dentro (misma versión fijada), para
// probar que insert/update/upsert/delete/rpc se cortan ANTES de salir.
// Ejecutar: npx tsx lib/marketing/soloLectura.test.ts

let fugas = 0;
globalThis.fetch = (() => {
  fugas++;
  throw new Error("red prohibida en las pruebas de solo lectura");
}) as typeof fetch;

const HOST = "base-ficticia.example.test";

/** Responde como PostgREST, registra todo lo que le llega. */
function transporteSimulado() {
  const recibidos: { metodo: string; ruta: string }[] = [];
  const t: Transporte = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    recibidos.push({ metodo: String(init?.method ?? "GET").toUpperCase(), ruta: url.pathname });
    return new Response(init?.method === "HEAD" ? null : "[]", {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/0" },
    });
  };
  return { t, recibidos };
}

async function main() {
  // ── 1. El fetch: solo GET/HEAD al host permitido; lo demás no sale ─────────
  {
    const sim = transporteSimulado();
    const ro = crearFetchSoloLectura(sim.t, HOST);
    for (const metodo of ["POST", "PATCH", "PUT", "DELETE"]) {
      await assert.rejects(ro.fetch(`https://${HOST}/rest/v1/turnos_stand`, { method: metodo, body: "{}" }), EscrituraBloqueada, `${metodo} se corta`);
    }
    await assert.rejects(ro.fetch(new Request(`https://${HOST}/rest/v1/rpc/x`, { method: "POST", body: "{}" })), EscrituraBloqueada, "también con un Request");
    await assert.rejects(ro.fetch(`https://otro-host.example.test/rest/v1/turnos_stand`), EscrituraBloqueada, "otro host, ni siquiera GET");
    assert.equal(sim.recibidos.length, 0, "nada llegó al transporte");
    assert.equal(ro.bloqueados(), 6);
    await ro.fetch(`https://${HOST}/rest/v1/turnos_stand?select=id`);
    await ro.fetch(`https://${HOST}/rest/v1/turnos_stand`, { method: "HEAD" });
    assert.deepEqual(sim.recibidos, [{ metodo: "GET", ruta: "/rest/v1/turnos_stand" }, { metodo: "HEAD", ruta: "/rest/v1/turnos_stand" }]);
    assert.deepEqual(ro.pedidos(), sim.recibidos, "lo registrado es lo que salió, sin query");
  }

  // ── 2. El armador de pedidos real sobre ese fetch, blindado ────────────────
  {
    const sim = transporteSimulado();
    const ro = crearFetchSoloLectura(sim.t, HOST);
    const cliente = blindarCliente(new PostgrestClient(`https://${HOST}/rest/v1`, { fetch: ro.fetch as typeof fetch }));
    const lectura = await cliente.from("turnos_stand").select("id, fecha").gte("fecha", "2026-09-15");
    assert.equal(lectura.error, null);
    const conteo = await cliente.from("turnos_stand").select("id", { count: "exact", head: true });
    assert.equal(conteo.error, null);
    assert.deepEqual(sim.recibidos.map((r) => r.metodo), ["GET", "HEAD"]);

    const escrituras: [string, () => unknown][] = [
      ["insert", () => cliente.from("turnos_stand").insert({ id: 1 })],
      ["update", () => cliente.from("turnos_stand").update({ total: 0 }).eq("id", 1)],
      ["upsert", () => cliente.from("turnos_stand").upsert({ id: 1 })],
      ["delete", () => cliente.from("turnos_stand").delete().eq("id", 1)],
      ["rpc", () => cliente.rpc("consumir_codigo_descuento", { p_codigo: "X" })],
    ];
    for (const [nombre, fn] of escrituras) {
      assert.throws(fn, EscrituraBloqueada, `${nombre} se corta en el cliente`);
    }
    assert.equal(sim.recibidos.length, 2, "ninguna escritura llegó al transporte");
    assert.equal(ro.bloqueados(), 0, "ni siquiera llegó al fetch: se cortó antes, en el cliente");
  }

  // ── 3. Sin blindaje, el fetch igual corta lo que el cliente intente ────────
  {
    const sim = transporteSimulado();
    const ro = crearFetchSoloLectura(sim.t, HOST);
    const cliente = new PostgrestClient(`https://${HOST}/rest/v1`, { fetch: ro.fetch as typeof fetch });
    const ins = await cliente.from("turnos_stand").insert({ id: 1 }).then((r) => r, (e) => ({ error: e }));
    assert.ok(ins.error, "el insert falla");
    const rpc = await cliente.rpc("consumir_codigo_descuento", { p_codigo: "X" }).then((r) => r, (e) => ({ error: e }));
    assert.ok(rpc.error, "la rpc falla");
    assert.equal(sim.recibidos.length, 0, "y nada salió al transporte");
    assert.equal(ro.bloqueados(), 2);
  }

  assert.equal(fugas, 0, "ningún pedido intentó usar la red real");
  console.log("soloLectura: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
