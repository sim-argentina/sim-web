import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Guarda de las páginas PÚBLICAS de Mensualidades (hotfix M7.1).
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesGuardsPublicos.test.ts
//
// Con MENSUALIDADES_ENABLED apagada, el módulo público no existe: las cuatro
// páginas responden 404. /mensualidades/resultado era la única que no lo hacía
// —quedó exceptuada a propósito en M3— y M7.1 la alinea con el resto.
//
// Se prueban dos cosas distintas y las dos hacen falta:
//   · el COMPORTAMIENTO: se invoca el componente de la página y se comprueba que
//     con la flag apagada lanza el 404 de Next, antes de renderizar nada;
//   · la ESTRUCTURA: que el guard esté donde tiene que estar y no se pueda
//     evaporar en un refactor (server component, force-dynamic, y ninguna página
//     nueva sin guard).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Las cuatro páginas públicas del módulo. */
const PAGINAS = [
  "app/mensualidades/page.tsx",
  "app/mensualidades/mi-plan/page.tsx",
  "app/mensualidades/reservar/page.tsx",
  "app/mensualidades/resultado/page.tsx",
];

/** `notFound()` de Next lanza un error con este digest. */
function es404(e: unknown): boolean {
  const d = (e as { digest?: unknown })?.digest;
  return typeof d === "string" && d.includes("NEXT_HTTP_ERROR_FALLBACK;404");
}

async function main() {
  const flagPrevia = process.env.MENSUALIDADES_ENABLED;

  // ── 1) COMPORTAMIENTO · flag apagada → 404 ──
  // Es el caso real de producción hoy: la variable no existe.
  {
    delete process.env.MENSUALIDADES_ENABLED;
    const { default: ResultadoPage } = await import("@/app/mensualidades/resultado/page");

    let lanzo = false;
    try {
      ResultadoPage();
    } catch (e) {
      lanzo = true;
      assert.ok(es404(e), "M7.1 con la flag apagada la página lanza el 404 de Next");
    }
    assert.ok(lanzo, "M7.1 con la flag apagada NO puede devolver contenido");

    // Los parámetros inventados no cambian nada: el guard corta antes de mirar
    // la URL, así que no hay combinación que lo evada.
    for (const _ of ["?t=loquesea", "?collection_status=approved", "?t=&payment_id=1", "?T=MAYUS"]) {
      let otra = false;
      try { ResultadoPage(); } catch (e) { otra = es404(e); }
      assert.ok(otra, `M7.1 el guard no depende de los query params (${_})`);
    }

    // Y valores falsos de la flag tampoco la encienden: solo el "true" exacto.
    for (const falso of ["", "1", "TRUE", "yes", "false", " true "]) {
      process.env.MENSUALIDADES_ENABLED = falso;
      let sigue = false;
      try { ResultadoPage(); } catch (e) { sigue = es404(e); }
      assert.ok(sigue, `M7.1 ${JSON.stringify(falso)} no enciende la flag`);
    }
  }

  // ── 2) COMPORTAMIENTO · flag encendida → la página se sirve ──
  {
    process.env.MENSUALIDADES_ENABLED = "true";
    const { default: ResultadoPage } = await import("@/app/mensualidades/resultado/page");
    const salida = ResultadoPage();
    assert.ok(salida, "M7.1 con la flag encendida la página devuelve su contenido");
    // No se comprueba el markup: el contenido no lo cambia este hotfix.
  }

  if (flagPrevia !== undefined) process.env.MENSUALIDADES_ENABLED = flagPrevia;
  else delete process.env.MENSUALIDADES_ENABLED;

  // ── 3) ESTRUCTURA · el guard vive en el servidor, en las cuatro páginas ──
  for (const p of PAGINAS) {
    const src = read(p);
    assert.ok(!/^"use client"/m.test(src), `${p}: la page es un Server Component`);
    assert.ok(/notFound\(\)/.test(src), `${p}: usa notFound()`);
    assert.ok(/export const dynamic = "force-dynamic"/.test(src),
      `${p}: force-dynamic, si no la flag se evaluaría una sola vez en el build`);
  }
  // Tres de las cuatro comprueban la flag directamente; mi-plan la hereda porque
  // exige una sesión de M4, que solo se puede abrir con la flag encendida.
  for (const p of PAGINAS.filter((x) => !x.includes("mi-plan"))) {
    assert.ok(/mensualidadesHabilitadas\(\)/.test(read(p)),
      `${p}: comprueba la feature flag`);
  }

  // ── 4) ESTRUCTURA · ninguna página pública nueva sin guard ──
  // Si mañana aparece otra bajo app/mensualidades, este test la encuentra.
  {
    const base = join(ROOT, "app/mensualidades");
    const encontradas: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) recorrer(full);
        else if (e.name === "page.tsx") encontradas.push(full);
      }
    };
    recorrer(base);
    assert.equal(encontradas.length, PAGINAS.length,
      `se esperaban ${PAGINAS.length} páginas públicas, hay ${encontradas.length}`);
    for (const f of encontradas) {
      assert.ok(/notFound\(\)/.test(readFileSync(f, "utf8")),
        `${f}: toda página pública de Mensualidades tiene que poder responder 404`);
    }
  }

  // ── 4b) (M7.2) La página y la API de resultado se protegen POR SEPARADO ──
  // Son dos superficies distintas: una sirve HTML y la otra sirve los datos.
  // Cada una tiene que traer su propio guard, porque cerrar una no cierra la
  // otra — que es exactamente lo que pasaba antes de M7.2.
  {
    const pagina = read("app/mensualidades/resultado/page.tsx");
    const api = read("app/api/mensualidades/resultado/route.ts");
    for (const [nombre, src] of [["la página", pagina], ["la API", api]] as const) {
      assert.ok(/mensualidadesHabilitadas\(\)/.test(src),
        `M7.2 ${nombre} de resultado comprueba la flag por su cuenta`);
    }
    // En la API el guard es lo PRIMERO del handler: antes del rate limit, antes
    // de leer un parámetro y antes de cualquier consulta.
    const cuerpo = api.slice(api.indexOf("export async function GET"));
    const posGuard = cuerpo.indexOf("mensualidadesHabilitadas()");
    for (const [nota, marca] of [
      ["el rate limit", "rateLimit("],
      ["la lectura de parámetros", "searchParams"],
      ["la primera consulta", "leerCompra("],
    ] as const) {
      const pos = cuerpo.indexOf(marca);
      assert.ok(pos > posGuard, `M7.2 el guard va antes que ${nota}`);
    }
  }

  // ── 4c) (M7.2) El webhook NO depende de la flag ──
  // Un pago ya iniciado tiene que poder acreditarse aunque la superficie
  // pública esté apagada: si no, se pierden confirmaciones de Mercado Pago.
  {
    const src = read("app/api/mensualidades/webhook/route.ts");
    assert.ok(
      !/mensualidadesHabilitadas\s*\(|process\.env\.MENSUALIDADES_ENABLED/.test(src),
      "M7.2 el webhook de Mercado Pago sigue sin depender de la feature flag",
    );
  }

  // ── 5) El sitemap no publica Mensualidades con el módulo oculto ──
  // (M8A) Antes se comprobaba que el archivo no NOMBRARA Mensualidades. Desde
  // que el sitemap depende de la flag eso ya no alcanza ni es lo que importa:
  // se ejecuta la función con la flag en cada estado y se mira lo que DEVUELVE.
  {
    const flagPrevia = process.env.MENSUALIDADES_ENABLED;
    const { default: sitemap } = await import("@/app/sitemap");

    delete process.env.MENSUALIDADES_ENABLED;
    const apagado = sitemap().map((e) => e.url);
    assert.ok(!apagado.some((u) => /mensualidad/i.test(u)),
      "con el módulo oculto el sitemap no lista ninguna URL de Mensualidades");

    process.env.MENSUALIDADES_ENABLED = "true";
    const encendido = sitemap().map((e) => e.url);
    assert.ok(encendido.some((u) => u.endsWith("/mensualidades")),
      "con el módulo publicado se lista la landing");
    // Las páginas con datos del titular NUNCA se listan, en ningún estado.
    for (const privada of ["/mensualidades/mi-plan", "/mensualidades/reservar", "/mensualidades/resultado"]) {
      assert.ok(!encendido.some((u) => u.endsWith(privada)),
        `${privada} no va al sitemap ni con el módulo publicado`);
    }
    assert.equal(encendido.length, apagado.length + 1,
      "publicar Mensualidades agrega exactamente una URL");

    if (flagPrevia === undefined) delete process.env.MENSUALIDADES_ENABLED;
    else process.env.MENSUALIDADES_ENABLED = flagPrevia;
  }

  // ── 6) El panel administrativo NO queda afectado ──
  // M7 existe aunque la venta esté apagada: es para trabajar ANTES del
  // lanzamiento. Si alguien lo ata a la flag pública, se apaga justo cuando más
  // se lo necesita.
  for (const p of [
    "app/admin/(panel)/mensualidades/page.tsx",
    "app/admin/(panel)/mensualidades/[id]/page.tsx",
    "app/api/admin/mensualidades/route.ts",
    "app/api/admin/mensualidades/[id]/route.ts",
    "app/api/admin/mensualidades/[id]/acciones/route.ts",
  ]) {
    const src = read(p);
    assert.ok(
      !/mensualidadesHabilitadas\s*\(|process\.env\.MENSUALIDADES_ENABLED/.test(src),
      `${p}: la administración no depende de la flag pública`,
    );
  }

  console.log("mensualidadesGuardsPublicos.test.ts OK (las cuatro páginas públicas tras la flag)");
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
