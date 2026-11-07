import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/webStandContacto.test.ts
// Web pública (06/11/2026): duraciones vigentes del stand en el Hero, teléfono
// laboral nuevo en SIM Store y retiro de Viaja con SIM. Contrato estático sobre
// las fuentes: que nada de lo retirado vuelva a aparecer.

const raiz = process.cwd();
const leer = (f: string) => readFileSync(join(raiz, f), "utf8");
const sinComentarios = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function archivos(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(join(raiz, dir))) {
    const rel = `${dir}/${nombre}`;
    if (statSync(join(raiz, rel)).isDirectory()) archivos(rel, out);
    else if (/\.(tsx?|mjs|cjs|js|json|txt|xml|webmanifest|html|md)$/.test(nombre) && !/\.(test|integration)\.ts$/.test(nombre)) out.push(rel);
  }
  return out;
}

// ── 1 · Teléfono laboral: el anterior no queda en ninguna fuente activa ──────
{
  const anterior = /(?:\+?54\s?9?\s?)?351[\s.-]?736[\s.-]?1030|5493517361030|3517361030|736[\s.-]?1030/;
  const fuentes = ["app", "components", "lib", "data", "public"].flatMap((d) => archivos(d));
  const conAnterior = fuentes.filter((f) => anterior.test(leer(f)));
  assert.deepEqual(conAnterior, [], "el contacto anterior no aparece en código, datos ni archivos públicos de texto");
  const tienda = leer("app/tienda/page.tsx");
  assert.ok(tienda.includes('const WA = "https://wa.me/5493518117091";'), "SIM Store consulta al número nuevo");
  // El número principal de SIM (reservas, alquiler, campeonatos) NO cambia.
  assert.ok(leer("components/navbar.tsx").includes("5493512520927"));
  assert.ok(leer("components/seo/StructuredData.tsx").includes("+5493512520927"));
}

// ── 2 · Duraciones del stand en el Hero: del catálogo vigente, sin 15 fijo ───
{
  const hero = sinComentarios(leer("components/HeroHome.tsx"));
  assert.ok(hero.includes("useDuracionesVigentes()"), "la barra del Hero lee el catálogo vigente");
  assert.ok(/const DURACIONES_INICIALES = \[10, 20, 30\];/.test(hero), "mientras carga: la oferta vigente");
  assert.ok(!/value:\s*"(15|30)"/.test(hero), "sin duraciones escritas a mano en la barra");
  const sesiones = leer("components/SesionesVigentes.tsx");
  assert.ok(/export function useDuracionesVigentes\(/.test(sesiones), "una sola consulta compartida");
  assert.equal((sesiones.match(/fetch\(/g) ?? []).length, 1);
}

// ── 3 · Viaja con SIM: sin ruta, sin enlaces, fuera del sitemap ──────────────
{
  assert.ok(!existsSync(join(raiz, "app/viaja-con-sim")), "/viaja-con-sim ya no existe (404 del sitio)");
  const fuentes = ["app", "components", "lib", "data"].flatMap((d) => archivos(d));
  const conViaja = fuentes.filter((f) => /viaja-con-sim|Viaja con SIM/i.test(leer(f)));
  assert.deepEqual(conViaja, [], "ningún enlace, menú, sitemap ni metadato la nombra");
  const navbar = leer("components/navbar.tsx");
  const links = [...navbar.matchAll(/\{ href: "(\/[^"]*)",\s*label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["/", "/vivi-sim", "/campeonatos", "/alquiler", "/tienda", "/sobre-nosotros"],
    "el menú queda con 6 entradas (la numeración sale del índice)");
}

console.log("OK — Web del stand: teléfono laboral nuevo (el anterior en ninguna fuente), Hero con las duraciones del catálogo vigente y Viaja con SIM retirada (ruta, menú y sitemap).");
