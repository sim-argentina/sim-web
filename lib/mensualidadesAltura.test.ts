import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { ALTURA_MINIMA_M, PESO_MAXIMO_KG, REQUISITOS_TEXTO } from "@/lib/requisitos";
import {
  CONDICIONES_MENSUALIDAD, CONDICIONES_RESERVA,
  CONDICIONES_VERSION, CONDICIONES_RESERVA_VERSION,
} from "@/lib/mensualidadesCondiciones";

// Guarda de la ALTURA MÍNIMA (hotfix M8A.1). Sin DB, sin red.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesAltura.test.ts
//
// Mensualidades decía 1,35 m mientras las otras siete pantallas del sitio decían
// 1,40 m, que es el valor vigente de SIM. Un cliente podía leer dos cifras
// distintas según por dónde entrara, y una de las dos estaba mal.
//
// Este test existe para que no vuelva a pasar, y para que no se "arregle" al
// revés: también comprueba que el sitio general siga diciendo 1,40 m.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── 1) La fuente única ──────────────────────────────────────────────────────
{
  assert.equal(ALTURA_MINIMA_M, "1,40", "la altura mínima vigente es 1,40 m");
  assert.equal(PESO_MAXIMO_KG, 110, "el peso máximo sigue siendo 110 kg");
  assert.equal(REQUISITOS_TEXTO, "altura mínima 1,40 m y peso máximo 110 kg");
  // Con coma: es texto para leer, no un número para calcular. Si alguien lo
  // pasara a 1.40 el texto saldría en inglés en medio de una frase en español.
  assert.ok(ALTURA_MINIMA_M.includes(","), "la altura se escribe con coma decimal");
}

// ── 2) Las condiciones de Mensualidades dicen 1,40 m ────────────────────────
{
  const compra = CONDICIONES_MENSUALIDAD.join(" ");
  const reserva = CONDICIONES_RESERVA.join(" ");

  assert.ok(compra.includes("1,40 m"), "la compra declara 1,40 m");
  assert.ok(compra.includes("110 kg"), "la compra declara 110 kg");
  assert.ok(reserva.includes("1,40 m"), "la reserva declara 1,40 m");
  assert.ok(reserva.includes("110 kg"), "la reserva declara 110 kg");

  // Y NINGUNA de las dos puede volver a decir 1,35.
  for (const [texto, cual] of [[compra, "compra"], [reserva, "reserva"]] as const) {
    for (const viejo of ["1,35", "1.35", "135 cm", "135cm"]) {
      assert.ok(!texto.includes(viejo), `las condiciones de ${cual} no dicen "${viejo}"`);
    }
  }

  // El texto cambió de fondo, así que la versión tiene que haber subido: no
  // puede quedarse en la que aceptó alguien con el texto anterior.
  assert.match(CONDICIONES_VERSION, /^\d{4}-\d{2}-[a-z0-9]+$/);
  assert.match(CONDICIONES_RESERVA_VERSION, /^\d{4}-\d{2}-[a-z0-9]+$/);
  assert.ok(!CONDICIONES_VERSION.endsWith("m5c1"), "la versión de compra subió");
  assert.ok(!CONDICIONES_RESERVA_VERSION.endsWith("m5a"), "la versión de reserva subió");
}

// ── 3) Ningún archivo VIGENTE de Mensualidades dice 1,35 ────────────────────
// Se recorre lo que un cliente puede terminar leyendo. Se excluyen a propósito:
//   · este mismo test, que cita la cifra vieja para prohibirla;
//   · los comentarios, que explican el arreglo y la nombran;
//   · las migraciones históricas de db/, que son evidencia de lo que hubo.
{
  const sospechosas: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { recorrer(p); continue; }
      if (![".ts", ".tsx"].includes(extname(e.name))) continue;
      if (e.name === "mensualidadesAltura.test.ts") continue;
      // Solo lo que pertenece a Mensualidades.
      const src = readFileSync(p, "utf8");
      if (!/mensualidad/i.test(p) && !/mensualidad/i.test(src.slice(0, 400))) continue;

      for (const linea of src.split("\n")) {
        const limpia = linea.replace(/\r$/, "").replace(/^\s*(\/\/|\*|\/\*).*$/, "");
        // La cifra tiene que ser una MEDIDA, no cualquier 135: "1,35" suelto en
        // un importe o "135" minutos no son la altura.
        if (/1[,.]35\s*m\b|135\s*cm/i.test(limpia)) sospechosas.push(`${p}: ${linea.trim()}`);
      }
    }
  };
  recorrer(join(ROOT, "lib"));
  recorrer(join(ROOT, "app"));
  assert.deepEqual(sospechosas, [],
    "ningún texto vigente de Mensualidades puede decir 1,35 m");
}

// ── 4) El sitio general sigue diciendo 1,40 m ───────────────────────────────
// El arreglo va en una sola dirección: Mensualidades se alinea con el resto, no
// al revés. Si alguien "unificara" bajando el resto a 1,35, esto lo detecta.
{
  const generales: Array<[string, RegExp]> = [
    ["app/legales/terminos/page.tsx", /1,40 metros/],
    ["app/campeonatos/page.tsx", /1,40 m/],
    ["app/gift-cards/page.tsx", /1,40 m/],
    ["app/reservas/page.tsx", /1\.40 metros/],
    ["app/reservas-empresa/page.tsx", /1,40 m/],
    ["app/sobre-nosotros/page.tsx", /1,40 m/],
    ["lib/giftCards.ts", /1,40 m/],
  ];
  for (const [ruta, esperado] of generales) {
    const src = read(ruta);
    assert.match(src, esperado, `${ruta} sigue diciendo 1,40 m`);
    assert.ok(!/1[,.]35\s*m|135\s*cm/i.test(src), `${ruta} no puede bajar a 1,35 m`);
    assert.match(src, /110 kg|110 kilos/, `${ruta} conserva el peso máximo`);
  }
}

console.log("mensualidadesAltura.test.ts OK (1,40 m en Mensualidades y en todo el sitio)");
