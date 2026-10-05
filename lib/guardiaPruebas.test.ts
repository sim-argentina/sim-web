// Pruebas del GUARDIÁN DE BASE DE PRUEBAS. Puras: no tocan ninguna base.
//
// Ejecutar: npx tsx lib/guardiaPruebas.test.ts

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import {
  refDeUrl, esLoopback, entornoContaminado, evaluarDestino, REFS_PROHIBIDOS,
  mensajeBloqueo, CODIGO_SALIDA_BLOQUEADA,
} from "@/lib/guardiaPruebas";

const PROD = "bcmoewwhsyxsiyvroarj";
const TURNOS = "unwoaqagnbrcaohxackc";
const OTRO = "aaaabbbbccccddddeeee"; // 20 caracteres: un proyecto alojado cualquiera
const urlDe = (ref: string) => `https://${ref}.supabase.co`;
const LOCAL = "http://127.0.0.1:55321";
const KEY = "service-role-de-pruebas";
const limpio = { SIM_TEST_SUPABASE_URL: LOCAL, PATH: "/usr/bin" };

function main() {
  // ── 1) Production por project ref → escritura bloqueada ANTES de consultar ──────────────
  {
    const d = evaluarDestino({ principal: urlDe(PROD), urlTest: null, keyTest: null });
    assert.equal(d.ok, false);
    assert.ok(!d.ok && d.codigo === "destino_prohibido", !d.ok ? d.codigo : "");
    assert.ok(!d.ok && d.motivo.includes(PROD), "el motivo nombra el ref prohibido");
    assert.ok(REFS_PROHIBIDOS[PROD].includes("Production"));
    assert.ok(REFS_PROHIBIDOS[TURNOS], "SIM TURNOS también está prohibido");
  }
  console.log("OK — guardia (1): el ref de Production bloquea la escritura, con el motivo nombrado.");

  // ── 2) Production o SIM TURNOS en la variable de PRUEBAS tampoco pasan ──────────────────
  {
    for (const u of [urlDe(PROD), `${urlDe(PROD)}/`, urlDe(TURNOS)]) {
      const d = evaluarDestino({ principal: urlDe(PROD), urlTest: u, keyTest: KEY, entorno: limpio });
      assert.equal(d.ok, false, `"${u}" no puede habilitarse`);
      assert.ok(!d.ok && d.codigo === "ref_de_pruebas_prohibido", !d.ok ? d.codigo : "");
    }
  }
  console.log("OK — guardia (2): poner Production (o SIM TURNOS) en la variable de pruebas no la habilita.");

  // ── 3) Cualquier host ALOJADO no autorizado también queda afuera ────────────────────────
  // No se trata de una lista negra: lo único que se acepta es el loopback. Un proyecto de
  // Supabase que no está en la lista de prohibidos tampoco sirve como destino de pruebas.
  {
    for (const u of [urlDe(OTRO), "https://db.ejemplo.com", "https://pruebas.supabase.co"]) {
      const d = evaluarDestino({ principal: urlDe(PROD), urlTest: u, keyTest: KEY, entorno: limpio });
      assert.equal(d.ok, false, `"${u}" no es un destino aceptado`);
      assert.ok(!d.ok && d.codigo === "host_no_loopback", !d.ok ? `${d.codigo} para ${u}` : "");
    }
  }
  console.log("OK — guardia (3): solo el loopback se acepta; cualquier host alojado queda afuera, esté o no en la lista.");

  // ── 4) Hosts que FINGEN ser locales ─────────────────────────────────────────────────────
  {
    const falsos = [
      "http://localhost.evil.com",
      "http://127.0.0.1.evil.com",
      "https://evil.com/?h=localhost",
      "https://evil.com/127.0.0.1",
      "http://user:pass@localhost@evil.com",
      "http://localhost@evil.com",
      "http://evil.com#localhost",
      "http://127.0.0.1.nip.io",
      "postgresql://postgres:postgres@127.0.0.1:55322/postgres", // no es http(s)
    ];
    for (const u of falsos) {
      assert.equal(esLoopback(u), false, `"${u}" NO es loopback`);
      const d = evaluarDestino({ principal: urlDe(PROD), urlTest: u, keyTest: KEY, entorno: limpio });
      assert.equal(d.ok, false, `"${u}" no puede habilitar la escritura`);
    }
    // Y los que sí lo son.
    for (const u of ["http://127.0.0.1:55321", "http://localhost:55321", "http://[::1]:55321", "http://127.0.0.1", "http://localhost/"]) {
      assert.equal(esLoopback(u), true, `"${u}" sí es loopback`);
    }
  }
  console.log("OK — guardia (4): una URL que solo CONTIENE 'localhost' o '127.0.0.1' no pasa; el host tiene que ser loopback de verdad.");

  // ── 5) NODE_ENV no habilita nada: la decisión es por destino ────────────────────────────
  {
    const previo = process.env.NODE_ENV;
    try {
      // @ts-expect-error NODE_ENV es readonly en los tipos; acá se fuerza a propósito
      process.env.NODE_ENV = "test";
      assert.equal(evaluarDestino({ principal: urlDe(PROD), urlTest: null, keyTest: null }).ok, false,
        "NODE_ENV=test contra Production sigue bloqueado");
      // @ts-expect-error idem
      process.env.NODE_ENV = "production";
      assert.equal(evaluarDestino({ principal: urlDe(PROD), urlTest: LOCAL, keyTest: KEY, entorno: limpio }).ok, true,
        "el destino manda, no NODE_ENV");
    } finally {
      // @ts-expect-error idem
      process.env.NODE_ENV = previo;
    }
    // Ningún flag genérico participa: el guardián solo lee las variables del destino.
    const fuente = readFileSync("lib/guardiaPruebas.ts", "utf8");
    for (const flag of ["RUN_INTEGRATION", "CI", "ALLOW_WRITES", "FORCE", "NODE_ENV", "VERCEL_ENV", "SKIP_GUARD"]) {
      assert.ok(!fuente.includes(`process.env.${flag}`), `el guardián no puede mirar process.env.${flag}`);
    }
    const leidas = fuente.split("process.env").slice(1).map((resto) => {
      const m = /^\s*(?:\.|\[\s*["']?)([A-Za-z_][A-Za-z0-9_]*)/.exec(resto);
      return m ? m[1] : "(dinámico)";
    });
    // "(dinámico)" es el `process.env` entero que se le pasa a entornoContaminado: es
    // justamente la revisión de contaminación, y tiene que haber exactamente una.
    assert.deepEqual([...new Set(leidas)].sort(), ["(dinámico)", "NEXT_PUBLIC_SUPABASE_URL", "VAR_KEY_TEST", "VAR_URL_TEST"],
      `el guardián lee variables inesperadas: ${leidas.join(", ")}`);
    assert.equal(leidas.filter((x) => x === "(dinámico)").length, 1, "un solo barrido del entorno completo");
    assert.ok(/entorno: process\.env as/.test(fuente), "ese barrido es el de entornoContaminado");
  }
  console.log("OK — guardia (5): NODE_ENV y los flags genéricos no participan de la decisión.");

  // ── 6) Configuración faltante, parcial o contradictoria → bloqueado ─────────────────────
  {
    assert.equal(evaluarDestino({ principal: null, urlTest: null, keyTest: null }).ok, false);
    assert.equal(evaluarDestino({ principal: LOCAL, urlTest: null, keyTest: null }).ok, false);
    const sinClave = evaluarDestino({ principal: urlDe(PROD), urlTest: LOCAL, keyTest: "", entorno: limpio });
    assert.equal(sinClave.ok, false);
    assert.ok(!sinClave.ok && sinClave.codigo === "falta_clave_de_pruebas");
    const urlRara = evaluarDestino({ principal: urlDe(PROD), urlTest: "base-de-pruebas", keyTest: KEY, entorno: limpio });
    assert.equal(urlRara.ok, false);
    assert.ok(!urlRara.ok && urlRara.codigo === "url_de_pruebas_invalida", "un destino que no se puede identificar no es seguro");
  }
  console.log("OK — guardia (6): sin base aislada, sin clave o con una URL irreconocible, bloqueado.");

  // ── 7) El entorno del proceso no puede exponer la base real ────────────────────────────
  // Aunque el destino sea el loopback: si una variable trae el ref de Producción, algo cargó
  // .env.local y el aislamiento ya no se sostiene.
  {
    assert.equal(entornoContaminado(limpio), null);
    for (const sucio of [
      { NEXT_PUBLIC_SUPABASE_URL: urlDe(PROD) },
      { DATABASE_URL: `postgresql://x@db.${PROD}.supabase.co:5432/postgres` },
      { CUALQUIERA: `algo ${PROD} algo` },
      { OTRA: urlDe(TURNOS) },
    ]) {
      const motivo = entornoContaminado({ ...limpio, ...sucio });
      assert.ok(motivo, `${JSON.stringify(sucio)} tiene que detectarse`);
      const d = evaluarDestino({ principal: LOCAL, urlTest: LOCAL, keyTest: KEY, entorno: { ...limpio, ...sucio } });
      assert.equal(d.ok, false, "con el entorno contaminado no se habilita la escritura");
      assert.ok(!d.ok && d.codigo === "entorno_contaminado", !d.ok ? d.codigo : "");
    }
  }
  console.log("OK — guardia (7): si cualquier variable del proceso menciona Production, se bloquea igual.");

  // ── 8) El Supabase local válido SÍ habilita la escritura ───────────────────────────────
  {
    const d = evaluarDestino({ principal: LOCAL, urlTest: LOCAL, keyTest: KEY, entorno: limpio });
    assert.equal(d.ok, true, d.ok ? "" : d.motivo);
    assert.ok(d.ok && d.ref === "local");
    // Y funciona también si el entorno principal todavía apuntaba a otra parte, siempre que
    // no sea un ref prohibido: lo que decide es la variable de pruebas.
    assert.equal(evaluarDestino({ principal: null, urlTest: "http://localhost:55321", keyTest: KEY, entorno: limpio }).ok, true);
  }
  console.log("OK — guardia (8): con el Supabase local y su service role, la escritura se habilita.");

  // ── 9) El ref se saca de la URL con precisión (no por 'contiene') ───────────────────────
  {
    assert.equal(refDeUrl(urlDe(PROD)), PROD);
    assert.equal(refDeUrl(`${urlDe(PROD)}/rest/v1`), PROD);
    assert.equal(refDeUrl("https://x.supabase.co"), null, "un ref corto no es válido");
    assert.equal(refDeUrl("https://ejemplo.com"), null);
    assert.equal(refDeUrl(""), null);
    assert.equal(refDeUrl(undefined), null);
    assert.equal(refDeUrl(`https://proxy.example.com/${PROD}`), null, "un host que solo contiene el ref no cuenta");
  }
  console.log("OK — guardia (9): el project ref se extrae de la URL, no por coincidencia de texto.");

  // ── 10) El guardián no se puede omitir desde una suite mutante ─────────────────────────
  {
    const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
    const ACTIVADOR = 'import "@/lib/guardiaPruebas.activar";';
    const RPC_DE_LECTURA = new Set(["fin_ingresos_por_mes", "fin_comisiones_web_por_mes", "fin_eventos_facturacion", "mensualidad_hoy", "mensualidad_normalizar_telefono", "mensualidad_horario_valido", "ia_costo_interno_acumulado", "mensualidad_resumen_altas_mes"]);
    const RE_RPC = /\.rpc\s*\(\s*["'`]([a-z0-9_]+)/g;
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(test|integration)\.ts$/.test(e.name)) out.push(p.split(sep).join("/"));
      }
      return out;
    };
    const mutantes: string[] = [], sinGuardia: string[] = [], tardio: string[] = [];
    for (const f of walk("lib").sort()) {
      const s = readFileSync(f, "utf8");
      if (!/supabaseAdmin|createClient/.test(s)) continue;
      const rpcsMutantes = [...s.matchAll(RE_RPC)].map((m) => m[1]).filter((n) => !RPC_DE_LECTURA.has(n));
      const invocaHandler = /from "@\/app\/api/.test(s);
      if (!ESCRITURA.test(s) && rpcsMutantes.length === 0 && !invocaHandler) continue;
      mutantes.push(f);
      if (!s.includes(ACTIVADOR)) { sinGuardia.push(f); continue; }
      if (s.indexOf(ACTIVADOR) > s.search(/^import\s/m)) tardio.push(f);
    }
    assert.deepEqual(sinGuardia, [], `estas suites escriben en la base y no activan el guardián: ${sinGuardia.join(", ")}`);
    assert.deepEqual(tardio, [], `el guardián tiene que ser el primer import en: ${tardio.join(", ")}`);
    assert.ok(mutantes.length >= 50, `se esperaban al menos 50 suites mutantes detectadas, hubo ${mutantes.length}`);
    console.log(`   (${mutantes.length} suites mutantes detectadas, todas con el guardián como primer import)`);
  }
  console.log("OK — guardia (10): ninguna suite que escriba puede omitir el guardián, y tiene que activarlo primero.");

  // ── 11) El bloqueo ocurre en el import, antes de abrir cualquier cliente ───────────────
  {
    const d = evaluarDestino({ principal: urlDe(PROD), urlTest: null, keyTest: null });
    assert.equal(d.ok, false);
    assert.equal(CODIGO_SALIDA_BLOQUEADA, 78, "código de configuración, distinguible de un test que falló");
    const msg = mensajeBloqueo(d as Extract<typeof d, { ok: false }>);
    assert.ok(msg.includes("BLOQUEADA") && msg.includes("pruebas:iniciar") && msg.includes("pruebas:mutantes"));
    assert.ok(msg.includes("No es un test que falló"), "el mensaje aclara que no es una falla de código");
    const act = readFileSync("lib/guardiaPruebas.activar.ts", "utf8");
    assert.ok(act.includes("exigirBaseDePruebas()"));
    const codigo = act.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\r?\n/g, "\n").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.ok(!/supabaseAdmin|createClient/.test(codigo), "el activador no puede inicializar ningún cliente");
    assert.equal(codigo.split("\n").filter((l) => l.trim()).length, 2, "el activador es un import y una llamada, nada más");
  }
  console.log("OK — guardia (11): el bloqueo ocurre en el import, antes de abrir cualquier cliente, con código 78.");

  // ── 12) Las suites de SOLO LECTURA contra Production siguen permitidas ─────────────────
  {
    const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
    for (const f of [
      "lib/facturacionEventos.contrato.integration.ts",
      "lib/ia/plan/capacidades.contrato.integration.ts",
      "lib/ia/plan/ejecutorPlan.integration.ts",
      "lib/ia/analisis/ejecutorAnalitico.integration.ts",
    ]) {
      const s = readFileSync(f, "utf8");
      assert.ok(!ESCRITURA.test(s), `${f} tiene que seguir siendo de solo lectura`);
      assert.ok(!s.includes("guardiaPruebas.activar"), `${f} no necesita el guardián: no escribe`);
    }
  }
  console.log("OK — guardia (12): las integraciones de solo lectura contra Production siguen corriendo sin guardián.");

  // ── 13) El runner y el entorno de pruebas existen y son coherentes ─────────────────────
  {
    for (const f of [
      "scripts/pruebas/entorno.mjs", "scripts/pruebas/iniciar.mjs",
      "scripts/pruebas/aplicar-esquema.mjs", "scripts/pruebas/correr-mutantes.mjs",
      "scripts/pruebas/correr-seguras.mjs", "scripts/pruebas/detener.mjs",
      "supabase/config.toml", "db/orden.txt", "db/esquema-base.sql", ".env.test.example",
    ]) {
      assert.ok(existsSync(f), `falta ${f}`);
    }
    // El template versionado no puede traer una clave de verdad.
    const tpl = readFileSync(".env.test.example", "utf8");
    assert.ok(/<[^>]+>/.test(tpl), "el template usa placeholders");
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(tpl), "el template no puede traer un JWT");
    for (const ref of Object.keys(REFS_PROHIBIDOS)) {
      assert.ok(!tpl.includes(ref), "el template no menciona proyectos prohibidos");
    }
    // El entorno del runner borra las credenciales en vez de heredarlas.
    const ent = readFileSync("scripts/pruebas/entorno.mjs", "utf8");
    for (const v of ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "TAVILY_API_KEY", "MP_ACCESS_TOKEN", "DATABASE_URL"]) {
      assert.ok(ent.includes(v), `el runner tiene que limpiar ${v} del entorno hijo`);
    }
    assert.ok(ent.includes("delete env[k]"), "las variables sensibles se BORRAN del entorno hijo");
    // Y el stack local no usa los puertos por defecto, para no pisar otro proyecto.
    const cfg = readFileSync("supabase/config.toml", "utf8");
    assert.ok(/project_id = "sim-web-pruebas"/.test(cfg), "el project_id del stack de pruebas es propio");
    assert.ok(!/^port = 54321$/m.test(cfg), "la API no puede quedar en el puerto por defecto");
  }
  console.log("OK — guardia (13): el runner, el stack local y el template versionado están completos y sin credenciales.");

  console.log("\nOK — guardián de base de pruebas: solo loopback validado, sin default permisivo, sin flags, con el entorno revisado y sin forma de omitirlo.");
}

main();
