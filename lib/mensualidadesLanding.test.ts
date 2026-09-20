import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONDICIONES_MENSUALIDAD, CONDICIONES_MENSUALIDAD_TEXTO,
  ACEPTACION_MENSUALIDAD, CONDICIONES_VERSION, CONDICIONES_RESERVA_VERSION,
} from "@/lib/mensualidadesCondiciones";
import { ALTURA_MINIMA_M, PESO_MAXIMO_KG } from "@/lib/requisitos";
import { REGLAS_POR_PRODUCTO } from "@/lib/agenda";

// Guarda de la LANDING pública. Sin DB, sin red.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesLanding.test.ts
//
// Cubre dos hotfix:
//
// M8B.1.1 encontró dos defectos en producción:
//   1. Las condiciones vivían DENTRO del formulario de compra, así que al pausar
//      las ventas —que oculta el formulario— desaparecían.
//   2. A 768 px las tarjetas pasaban a tres columnas y el precio no entraba.
//
// M8C reemplazó las 22 viñetas por OCHO condiciones agrupadas por tema. No es
// un resumen: son las condiciones completas. Nada plegado, nada detrás de un
// "ver más", ninguna segunda lista en paralelo.

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "app/mensualidades/CompraMensualidad.tsx"), "utf8");

/**
 * El componente SIN comentarios. Los comentarios explican por qué NO hay un
 * desplegable, así que citan las mismas palabras que la guarda prohíbe: sin
 * esto, la guarda se dispararía contra su propia explicación.
 * El \r se quita primero porque en JS el `.` no lo incluye y los archivos del
 * repo tienen finales de línea mezclados.
 */
const codigo = src
  .split("\n")
  .map((l) => l.replace(/\r$/, ""))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

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
  const iCasilla = src.indexOf("checked={acepto}");
  assert.ok(iCasilla > iCondicional,
    "la casilla de aceptación se queda dentro del formulario");
}

// ── 2) Son OCHO, con título, y salen de la fuente canónica ─────────────────
{
  assert.equal(CONDICIONES_MENSUALIDAD.length, 8, "ocho condiciones");

  const titulos = CONDICIONES_MENSUALIDAD.map((c) => c.titulo);
  assert.deepEqual(titulos, [
    "Vigencia", "Reservas", "Duración y simuladores", "Consumo del saldo",
    "Cancelaciones y cambios", "Renovación", "Titular y participantes",
    "Disponibilidad y promociones",
  ], "los ocho títulos, en orden");
  assert.equal(new Set(titulos).size, 8, "ningún título repetido");

  for (const c of CONDICIONES_MENSUALIDAD) {
    assert.ok(c.titulo.length > 0 && c.texto.length > 0, `"${c.titulo}" tiene título y texto`);
    assert.ok(!c.titulo.endsWith(":"), `"${c.titulo}" no lleva los dos puntos: los pone la pantalla`);
  }

  // El componente dibuja el título y el texto, no un objeto entero.
  assert.match(src, /\{c\.titulo\}/, "se dibuja el título");
  assert.match(src, /\{c\.texto\}/, "se dibuja el texto");

  // Ninguna condición puede estar escrita literalmente en el componente.
  assert.match(src, /import \{ CONDICIONES_MENSUALIDAD, ACEPTACION_MENSUALIDAD \} from "@\/lib\/mensualidadesCondiciones"/);
  for (const c of CONDICIONES_MENSUALIDAD) {
    assert.ok(!src.includes(c.texto.slice(0, 40)),
      `la condición "${c.titulo}" no puede estar copiada en el componente`);
  }
  // La casilla también sale de la fuente, no escrita a mano.
  assert.match(src, /\{ACEPTACION_MENSUALIDAD\}/, "la casilla usa el texto canónico");
  assert.equal(ACEPTACION_MENSUALIDAD, "Leí y acepto las condiciones de la mensualidad.");
}

// ── 3) El contenido no perdió ninguna regla al reagrupar ───────────────────
{
  const texto = CONDICIONES_MENSUALIDAD_TEXTO.join(" ");

  assert.ok(texto.includes(`${ALTURA_MINIMA_M} m`), "declara la altura vigente");
  assert.ok(texto.includes(`${PESO_MAXIMO_KG} kg`), "y el peso máximo");
  assert.ok(texto.includes("30 días"), "y la vigencia");
  assert.ok(texto.includes("23:59"), "y hasta cuándo se puede usar");
  assert.ok(texto.includes("60 minutos"), "y el tope por reserva");
  assert.ok(texto.includes("24 horas"), "y la regla de cancelación");
  assert.ok(texto.includes("lunes a viernes"), "y los días operativos");
  assert.ok(texto.includes("22:00"), "y el cierre");
  assert.ok(texto.includes("15 días de anticipación"), "y la ventana");
  assert.ok(/no reserva ni garantiza horarios/.test(texto),
    "y que comprar no garantiza horarios");
  assert.ok(/cupones de descuento/.test(texto), "y que no hay cupones");

  // (M8C) La regla nueva: de 1 a 4 simuladores, escrita igual que la valida el
  // dominio. Si mañana cambiara REGLAS_POR_PRODUCTO, el texto cambia con ella.
  const { simuladoresMin, simuladoresMax } = REGLAS_POR_PRODUCTO.mensualidad;
  assert.equal(simuladoresMin, 1, "el mínimo de dominio es 1");
  assert.equal(simuladoresMax, 4, "y el máximo 4");
  assert.ok(texto.includes("1, 2, 3 o 4 simuladores"),
    "las condiciones enumeran 1, 2, 3 o 4 simuladores");
  assert.ok(texto.includes("15, 30, 45 o 60 minutos"), "y las cuatro duraciones");
  assert.ok(texto.includes("4 simuladores durante 15 minutos consumen 60 minutos"),
    "y el ejemplo de consumo");
}

// ── 4) No quedó nada de la lista vieja ni de un desplegable ────────────────
{
  const texto = CONDICIONES_MENSUALIDAD_TEXTO.join(" ");

  // Textos que exigían dos simuladores.
  for (const viejo of [
    "con 2, 3 o 4 simuladores", "Elegí entre 2 y 4", "Elegí al menos 2",
    "mínimo 2 simuladores",
  ]) {
    assert.ok(!texto.includes(viejo), `las condiciones ya no dicen "${viejo}"`);
    assert.ok(!codigo.includes(viejo), `el componente ya no dice "${viejo}"`);
  }

  // Nada plegado: las ocho condiciones SON las condiciones completas.
  for (const patron of [
    /Ver condiciones completas/i, /Lo esencial/i, /<details/i, /<summary/i,
    /aria-expanded/i, /acorde[oó]n/i, /Ver m[áa]s/i, /Leer m[áa]s/i,
  ]) {
    assert.ok(!patron.test(codigo),
      `la landing no puede esconder las condiciones detrás de ${patron}`);
  }
  // "Resumen" como encabezado de una versión corta tampoco.
  assert.ok(!/Resumen de las condiciones/i.test(codigo), "no hay resumen paralelo");
}

// ── 5) Versionado: subió, y con el esquema de siempre ──────────────────────
{
  for (const [v, cual] of [[CONDICIONES_VERSION, "compra"], [CONDICIONES_RESERVA_VERSION, "reserva"]] as const) {
    assert.match(v, /^\d{4}-\d{2}-[a-z0-9]+$/, `la versión de ${cual} respeta el esquema`);
    assert.ok(!v.endsWith("m8a1"),
      `(M8C) la versión de ${cual} tiene que subir: cambió una regla material`);
  }
}

// ── 6) Con las ventas pausadas no se piden datos personales ────────────────
{
  const pausado = src.slice(src.indexOf("{!vendiendo ? ("), src.indexOf(") : ("));
  for (const campo of ["mens-nombre", "mens-apellido", "mens-tel", "mens-email"]) {
    assert.ok(!pausado.includes(campo),
      `con las ventas pausadas no se renderiza el campo ${campo}`);
  }
  assert.match(src, /role="status"/);
  assert.match(src, /Compras pausadas/);
}

// ── 7) Las tarjetas no usan tres columnas en un ancho insuficiente ─────────
// El defecto era `md:grid-cols-3`: a 768 px cada tarjeta quedaba en 164 px y el
// precio necesitaba hasta 231.
{
  const grid = src.match(/className="grid items-stretch[^"]*"/)?.[0] ?? "";
  assert.ok(grid, "la grilla de planes existe");
  assert.ok(!/\bmd:grid-cols-3\b/.test(grid),
    "tres columnas NO pueden empezar en md (768 px): ahí el precio no entra");
  assert.match(grid, /\bsm:grid-cols-2\b/, "dos columnas en tablet");
  assert.match(grid, /\blg:grid-cols-3\b/, "tres columnas recién desde lg (1024 px)");

  const precio = src.match(/className="mt-2 text-4xl font-black[^"]*"/)?.[0] ?? "";
  assert.ok(precio, "el precio tiene su clase");
  assert.ok(!/\bmd:text-5xl\b/.test(precio), "el precio no salta a 5xl en md");
  assert.ok(!/\blg:text-5xl\b/.test(precio), "ni en lg: ahí quedaba al límite");
  assert.match(precio, /\btext-4xl\b/, "sigue siendo el elemento más grande de la tarjeta");
}

console.log("mensualidadesLanding.test.ts OK (ocho condiciones completas y precios que entran)");
