// Pruebas del GUARDIÁN DE BASE DE PRUEBAS. Puras: no tocan ninguna base.
//
// Ejecutar: npx tsx lib/guardiaPruebas.test.ts

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import {
  refDeUrl, evaluarDestino, REFS_PROHIBIDOS, VAR_URL_TEST, VAR_KEY_TEST,
  mensajeBloqueo, CODIGO_SALIDA_BLOQUEADA,
} from "@/lib/guardiaPruebas";

const PROD = "bcmoewwhsyxsiyvroarj";
const TURNOS = "unwoaqagnbrcaohxackc";
const TEST_REF = "aaaabbbbccccddddeeee"; // 20 caracteres, un proyecto de pruebas hipotético
const urlDe = (ref: string) => `https://${ref}.supabase.co`;
const KEY = "service-role-de-pruebas";

function main() {
  // ── 1) Production por project ref → escritura bloqueada ANTES de consultar ──────────────
  {
    const d = evaluarDestino({ principal: urlDe(PROD), urlTest: null, keyTest: null });
    assert.equal(d.ok, false);
    assert.ok(!d.ok && d.codigo === "destino_prohibido", !d.ok ? d.codigo : "");
    assert.ok(!d.ok && d.motivo.includes(PROD), "el motivo nombra el ref prohibido");
    // Y la lista declara por qué está prohibido, para que la decisión sea auditable.
    assert.ok(REFS_PROHIBIDOS[PROD].includes("Production"));
    assert.ok(REFS_PROHIBIDOS[TURNOS], "SIM TURNOS también está prohibido");
  }
  console.log("OK — guardia (1): el ref de Production bloquea la escritura, con el motivo nombrado.");

  // ── 2) La URL de Production escrita en la variable de PRUEBAS tampoco pasa ──────────────
  {
    for (const u of [urlDe(PROD), `${urlDe(PROD)}/`, urlDe(PROD).toUpperCase().replace("HTTPS", "https"), urlDe(TURNOS)]) {
      const d = evaluarDestino({ principal: urlDe(PROD), urlTest: u, keyTest: KEY });
      assert.equal(d.ok, false, `"${u}" no puede habilitarse`);
      assert.ok(!d.ok && d.codigo === "ref_de_pruebas_prohibido", !d.ok ? d.codigo : "");
    }
  }
  console.log("OK — guardia (2): poner Production (o SIM TURNOS) en la variable de pruebas no la habilita.");

  // ── 3) NODE_ENV no habilita nada: la decisión es por destino ────────────────────────────
  {
    const previo = process.env.NODE_ENV;
    try {
      // @ts-expect-error NODE_ENV es readonly en los tipos, acá se fuerza a propósito
      process.env.NODE_ENV = "test";
      const d = evaluarDestino({ principal: urlDe(PROD), urlTest: null, keyTest: null });
      assert.equal(d.ok, false, "NODE_ENV=test contra Production sigue bloqueado");
      // Y tampoco al revés: un destino válido no necesita NODE_ENV.
      // @ts-expect-error idem
      process.env.NODE_ENV = "production";
      const d2 = evaluarDestino({ principal: urlDe(PROD), urlTest: urlDe(TEST_REF), keyTest: KEY });
      assert.equal(d2.ok, true, "el destino manda, no NODE_ENV");
    } finally {
      // @ts-expect-error idem
      process.env.NODE_ENV = previo;
    }
    // Ningún flag genérico participa: el guardián solo lee las variables del destino.
    const fuente = readFileSync("lib/guardiaPruebas.ts", "utf8");
    for (const flag of ["RUN_INTEGRATION", "CI", "ALLOW_WRITES", "FORCE", "NODE_ENV", "VERCEL_ENV", "SKIP_GUARD"]) {
      assert.ok(!fuente.includes(`process.env.${flag}`), `el guardián no puede mirar process.env.${flag}`);
      assert.ok(!fuente.includes(`process.env["${flag}"]`), `el guardián no puede mirar ${flag}`);
    }
    // Las únicas variables de entorno que lee son las del destino.
    // Sin regex: se parte por "process.env" y se lee el identificador que sigue.
    const leidas = fuente.split("process.env").slice(1).map((resto) => {
      const m = /^\s*(?:\.|\[\s*["']?)([A-Za-z_][A-Za-z0-9_]*)/.exec(resto);
      return m ? m[1] : "(dinámico)";
    });
    assert.deepEqual([...new Set(leidas)].sort(), ["NEXT_PUBLIC_SUPABASE_URL", "VAR_KEY_TEST", "VAR_URL_TEST"],
      `el guardián lee variables inesperadas: ${leidas.join(", ")}`);
  }
  console.log("OK — guardia (3): NODE_ENV y los flags genéricos no participan de la decisión.");

  // ── 4) Falta de configuración aislada → bloqueado (fail-closed, sin default permisivo) ───
  {
    assert.equal(evaluarDestino({ principal: null, urlTest: null, keyTest: null }).ok, false);
    assert.equal(evaluarDestino({ principal: urlDe(TEST_REF), urlTest: null, keyTest: null }).ok, false);
    const sinClave = evaluarDestino({ principal: urlDe(PROD), urlTest: urlDe(TEST_REF), keyTest: "" });
    assert.equal(sinClave.ok, false);
    assert.ok(!sinClave.ok && sinClave.codigo === "falta_clave_de_pruebas");
    const urlRara = evaluarDestino({ principal: urlDe(PROD), urlTest: "base-de-pruebas", keyTest: KEY });
    assert.equal(urlRara.ok, false);
    assert.ok(!urlRara.ok && urlRara.codigo === "url_de_pruebas_invalida", "un destino que no se puede identificar no es seguro");
  }
  console.log("OK — guardia (4): sin base aislada, sin clave o con una URL irreconocible, bloqueado.");

  // ── 5) Base local de desarrollo permitida ───────────────────────────────────────────────
  {
    for (const u of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
      const d = evaluarDestino({ principal: urlDe(PROD), urlTest: u, keyTest: KEY });
      assert.equal(d.ok, true, `${u} tiene que poder escribirse`);
      assert.ok(d.ok && d.ref === "local");
    }
  }
  console.log("OK — guardia (5): una base local de desarrollo sí se puede escribir.");

  // ── 6) Base de pruebas explícita y distinta de Production → permitida ───────────────────
  {
    const d = evaluarDestino({ principal: urlDe(PROD), urlTest: urlDe(TEST_REF), keyTest: KEY });
    assert.equal(d.ok, true, d.ok ? "" : d.motivo);
    assert.ok(d.ok && d.ref === TEST_REF);
    assert.ok(d.ok && d.motivo.includes(TEST_REF));
  }
  console.log("OK — guardia (6): con una base de pruebas propia y su clave, la escritura se habilita.");

  // ── 7) El ref se saca de la URL con precisión (no por 'contiene') ───────────────────────
  {
    assert.equal(refDeUrl(urlDe(PROD)), PROD);
    assert.equal(refDeUrl(`${urlDe(PROD)}/rest/v1`), PROD);
    assert.equal(refDeUrl(`HTTPS://${PROD}.SUPABASE.CO`.toLowerCase()), PROD);
    assert.equal(refDeUrl("https://x.supabase.co"), null, "un ref corto no es válido");
    assert.equal(refDeUrl("https://ejemplo.com"), null);
    assert.equal(refDeUrl(""), null);
    assert.equal(refDeUrl(undefined), null);
    // Un host que solo CONTIENE el ref no cuenta como ese proyecto.
    assert.equal(refDeUrl(`https://proxy.example.com/${PROD}`), null);
  }
  console.log("OK — guardia (7): el project ref se extrae de la URL, no por coincidencia de texto.");

  // ── 8) El guardián no se puede omitir desde una suite mutante ───────────────────────────
  // El contrato no es una lista a mano: se recorren los archivos de prueba, se detecta cuáles
  // escriben y se exige que importen el activador. Una suite mutante nueva falla acá hasta que
  // lo agregue, y una suite de solo lectura que empiece a escribir también.
  {
    const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
    const ACTIVADOR = 'import "@/lib/guardiaPruebas.activar";';
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(test|integration)\.ts$/.test(e.name)) out.push(p.split(sep).join("/"));
      }
      return out;
    };
    // Una suite también escribe INDIRECTAMENTE: por una RPC que muta, o invocando un handler de
    // ruta que escribe por dentro. Las RPC se tratan como mutantes salvo que estén en esta lista
    // de lectura comprobada: una RPC nueva se asume mutante hasta que alguien la revise y la
    // agregue acá. Fail-closed por defecto.
    const RPC_DE_LECTURA = new Set(["fin_ingresos_por_mes", "fin_comisiones_web_por_mes", "fin_eventos_facturacion", "mensualidad_hoy", "mensualidad_normalizar_telefono", "mensualidad_horario_valido", "ia_costo_interno_acumulado", "mensualidad_resumen_altas_mes"]);
    const RE_RPC = /\.rpc\s*\(\s*["'`]([a-z0-9_]+)/g;
    const archivos = walk("lib").sort();
    const mutantes: string[] = [];
    const sinGuardia: string[] = [];
    const tardio: string[] = [];
    for (const f of archivos) {
      const s = readFileSync(f, "utf8");
      if (!/supabaseAdmin|createClient/.test(s)) continue;
      const rpcsMutantes = [...s.matchAll(RE_RPC)].map((m) => m[1]).filter((n) => !RPC_DE_LECTURA.has(n));
      const invocaHandler = /from "@\/app\/api/.test(s);
      if (!ESCRITURA.test(s) && rpcsMutantes.length === 0 && !invocaHandler) continue;
      mutantes.push(f);
      if (!s.includes(ACTIVADOR)) { sinGuardia.push(f); continue; }
      // Y tiene que ser el PRIMER import: después de otro, el cliente ya se inicializó.
      const posActivador = s.indexOf(ACTIVADOR);
      const posPrimerImport = s.search(/^import\s/m);
      if (posActivador > posPrimerImport) tardio.push(f);
    }
    assert.deepEqual(sinGuardia, [], `estas suites escriben en la base y no activan el guardián: ${sinGuardia.join(", ")}`);
    assert.deepEqual(tardio, [], `el guardián tiene que ser el primer import en: ${tardio.join(", ")}`);
    assert.ok(mutantes.length >= 50, `se esperaban al menos 50 suites mutantes detectadas, hubo ${mutantes.length}`);
    console.log(`   (${mutantes.length} suites mutantes detectadas, todas con el guardián como primer import)`);
  }
  console.log("OK — guardia (8): ninguna suite que escriba puede omitir el guardián, y tiene que activarlo primero.");

  // ── 9) Una prueba interrumpida no deja filas porque nunca pudo escribir ─────────────────
  // El guardián corre en el import, antes de cualquier inserción: no hay ventana entre "empezó
  // la suite" y "puede escribir". Un kill en cualquier momento posterior es irrelevante porque
  // contra un destino prohibido el proceso ya terminó con código de configuración.
  {
    const d = evaluarDestino({ principal: urlDe(PROD), urlTest: null, keyTest: null });
    assert.equal(d.ok, false);
    assert.equal(CODIGO_SALIDA_BLOQUEADA, 78, "código de configuración, distinguible de un test que falló");
    const msg = mensajeBloqueo(d as Extract<typeof d, { ok: false }>);
    assert.ok(msg.includes("BLOQUEADA") && msg.includes(VAR_URL_TEST) && msg.includes(VAR_KEY_TEST));
    assert.ok(msg.includes("No es un test que falló"), "el mensaje aclara que no es una falla de código");
    // El activador no hace nada más que exigir: no abre conexiones ni crea clientes.
    const act = readFileSync("lib/guardiaPruebas.activar.ts", "utf8");
    assert.ok(act.includes("exigirBaseDePruebas()"));
    // Sin comentarios: el activador nombra supabaseAdmin al explicar por qué va primero, pero su
    // código no puede tocar ningún cliente (si lo hiciera, ya estaría inicializado al bloquear).
    const codigo = act.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\r?\n/g, "\n").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.ok(!/supabaseAdmin|createClient/.test(codigo), "el activador no puede inicializar ningún cliente");
    assert.equal(codigo.split("\n").filter((l) => l.trim()).length, 2, "el activador es un import y una llamada, nada más");
  }
  console.log("OK — guardia (9): el bloqueo ocurre en el import, antes de abrir cualquier cliente, con código 78.");

  // ── 10) Las suites de SOLO LECTURA contra Production siguen permitidas ──────────────────
  {
    const ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
    const soloLectura = [
      "lib/facturacionEventos.contrato.integration.ts",
      "lib/ia/plan/capacidades.contrato.integration.ts",
      "lib/ia/plan/ejecutorPlan.integration.ts",
      "lib/ia/analisis/ejecutorAnalitico.integration.ts",
    ];
    for (const f of soloLectura) {
      const s = readFileSync(f, "utf8");
      assert.ok(!ESCRITURA.test(s), `${f} tiene que seguir siendo de solo lectura`);
      assert.ok(!s.includes("guardiaPruebas.activar"), `${f} no necesita el guardián: no escribe`);
    }
  }
  console.log("OK — guardia (10): las integraciones de solo lectura contra Production siguen corriendo sin guardián.");

  console.log("\nOK — guardián de base de pruebas: fail-closed por project ref, sin default permisivo, sin flags, y no se puede omitir.");
}

main();
