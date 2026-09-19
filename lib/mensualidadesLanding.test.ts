import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONDICIONES_MENSUALIDAD } from "@/lib/mensualidadesCondiciones";
import { ALTURA_MINIMA_M, PESO_MAXIMO_KG } from "@/lib/requisitos";

// Guarda de la LANDING pública (hotfix M8B.1.1). Sin DB, sin red.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesLanding.test.ts
//
// M8B.1 encontró dos defectos en producción:
//
//   1. Las condiciones vivían DENTRO del formulario de compra, así que al pausar
//      las ventas —que oculta el formulario— desaparecían. Justo cuando alguien
//      decide si esperar a que reabran, se quedaba sin las reglas.
//   2. A 768 px las tarjetas pasaban a tres columnas y el precio no entraba:
//      "$100.000" necesitaba 231 px en una tarjeta de 164 y se cortaba.
//
// Esto vigila que ninguno vuelva. La medición real de anchos es visual; acá se
// comprueba lo que se puede afirmar leyendo el componente.

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "app/mensualidades/CompraMensualidad.tsx"), "utf8");

// ── 1) La lista de condiciones se dibuja UNA vez y fuera del formulario ─────
{
  const usos = src.split("CONDICIONES_MENSUALIDAD.map").length - 1;
  assert.equal(usos, 1,
    "la lista de condiciones se dibuja UNA sola vez: ni duplicada al habilitar ventas, ni con una copia por estado");

  // Está fuera de la rama que depende de `vendiendo`. Se comprueba por posición:
  // la lista aparece ANTES del bloque condicional del formulario.
  const iLista = src.indexOf("CONDICIONES_MENSUALIDAD.map");
  const iCondicional = src.indexOf("{!vendiendo ? (");
  assert.ok(iCondicional > 0, "sigue existiendo la rama pausado/vendiendo");
  assert.ok(iLista < iCondicional,
    "las condiciones se dibujan ANTES de la rama del formulario, así que no dependen de ella");

  // Y la casilla de aceptación sigue DENTRO del formulario: solo tiene sentido
  // cuando hay algo que aceptar.
  const iCasilla = src.indexOf('checked={acepto}');
  assert.ok(iCasilla > iCondicional,
    "la casilla de aceptación se queda dentro del formulario");
}

// ── 2) El texto sale de la fuente autoritativa, no copiado a mano ───────────
{
  assert.match(src, /import \{ CONDICIONES_MENSUALIDAD \} from "@\/lib\/mensualidadesCondiciones"/);
  // Ninguna condición puede estar escrita literalmente en el componente.
  for (const c of CONDICIONES_MENSUALIDAD) {
    const fragmento = c.slice(0, 40);
    assert.ok(!src.includes(fragmento),
      `la condición "${fragmento}…" no puede estar copiada en el componente`);
  }
  // Y la lista autoritativa sigue diciendo lo que tiene que decir.
  const texto = CONDICIONES_MENSUALIDAD.join(" ");
  assert.ok(texto.includes(`${ALTURA_MINIMA_M} m`), "las condiciones declaran la altura vigente");
  assert.ok(texto.includes(`${PESO_MAXIMO_KG} kg`), "y el peso máximo");
  assert.ok(texto.includes("30 días"), "y la vigencia");
  assert.ok(texto.includes("60 minutos"), "y el tope por reserva");
  assert.ok(texto.includes("24 horas"), "y la regla de cancelación");
}

// ── 3) Con las ventas pausadas no se piden datos personales ────────────────
{
  const rama = src.slice(src.indexOf("{!vendiendo ? ("), src.indexOf("{/* ── Condiciones ──") + 1 || undefined);
  const pausado = src.slice(src.indexOf("{!vendiendo ? ("), src.indexOf(") : ("));
  for (const campo of ["mens-nombre", "mens-apellido", "mens-tel", "mens-email"]) {
    assert.ok(!pausado.includes(campo),
      `con las ventas pausadas no se renderiza el campo ${campo}`);
  }
  void rama;
  // El aviso de pausa sigue existiendo y con rol de estado.
  assert.match(src, /role="status"/);
  assert.match(src, /Compras pausadas/);
}

// ── 4) Las tarjetas no usan tres columnas en un ancho insuficiente ──────────
// El defecto era `md:grid-cols-3`: a 768 px cada tarjeta quedaba en 164 px y el
// precio necesitaba hasta 231.
{
  const grid = src.match(/className="grid items-stretch[^"]*"/)?.[0] ?? "";
  assert.ok(grid, "la grilla de planes existe");
  assert.ok(!/\bmd:grid-cols-3\b/.test(grid),
    "tres columnas NO pueden empezar en md (768 px): ahí el precio no entra");
  assert.match(grid, /\bsm:grid-cols-2\b/, "dos columnas en tablet");
  assert.match(grid, /\blg:grid-cols-3\b/, "tres columnas recién desde lg (1024 px)");

  // El precio tampoco puede saltar a 5xl antes de que haya lugar.
  const precio = src.match(/className="mt-2 text-4xl font-black[^"]*"/)?.[0] ?? "";
  assert.ok(precio, "el precio tiene su clase");
  assert.ok(!/\bmd:text-5xl\b/.test(precio), "el precio no salta a 5xl en md");
  assert.ok(!/\blg:text-5xl\b/.test(precio), "ni en lg: ahí quedaba al límite");
  assert.match(precio, /\btext-4xl\b/, "sigue siendo el elemento más grande de la tarjeta");
}

console.log("mensualidadesLanding.test.ts OK (condiciones permanentes y precios que entran)");
