import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGLAS_POR_PRODUCTO, cantidadSimuladoresValidaPara, duracionValidaPara,
} from "@/lib/agenda";
import { validarSeleccion } from "@/lib/mensualidadesReserva";
import { fechasPublicasPara } from "@/lib/agenda";

// Guardas PURAS del bloque M8C. Sin DB, sin red.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM8C.test.ts
//
// M8C corrige cuatro cosas. Tres se comprueban acá:
//   · reservas con 1, 2, 3 o 4 simuladores (M5C.1 exigía 2 como mínimo);
//   · la card de Viví SIM con la credencial nueva y "Simuladores 1–4";
//   · que no quede ningún texto pidiendo dos simuladores.
// La cuarta —las ocho condiciones— vive en mensualidadesLanding.test.ts, y el
// calendario compacto en mensualidadesReservarFecha.test.ts.

const ROOT = process.cwd();
const leer = (p: string) => readFileSync(join(ROOT, p), "utf8");

const HOY = "2026-09-19";
const [LUNES] = fechasPublicasPara("mensualidad", HOY);
const SIMS = ["Ferrari", "McLaren", "Red Bull", "Alpine"] as const;
const clave = () => "m8c" + "x".repeat(20);

function seleccion(extra: Record<string, unknown>) {
  return validarSeleccion({
    fecha: LUNES, hora: "11:00", duracion_minutos: 15,
    acepto_condiciones: true, idempotency_key: clave(),
    ...extra,
  }, HOY);
}

// ── 1) La regla de dominio: de 1 a 4, en un solo lugar ─────────────────────
{
  const r = REGLAS_POR_PRODUCTO.mensualidad;
  assert.equal(r.simuladoresMin, 1, "el mínimo es 1");
  assert.equal(r.simuladoresMax, 4, "y el máximo 4");

  // Reservas normales no se tocó.
  const rn = REGLAS_POR_PRODUCTO.reserva;
  assert.equal(rn.simuladoresMin, 1, "Reservas normales sigue en 1");
  assert.equal(rn.simuladoresMax, 4);
  assert.deepEqual([...rn.diasHabilitados], [0, 1, 2, 3, 4, 5, 6],
    "Reservas normales conserva los siete días");
  assert.deepEqual([...rn.duraciones], [15, 30],
    "y sus dos duraciones: 45 y 60 siguen siendo de Mensualidades");

  // (M8C.1) El calendario pasó a los siete días, con cierre por tipo de día.
  assert.deepEqual([...r.diasHabilitados], [0, 1, 2, 3, 4, 5, 6], "los siete días");
  assert.deepEqual([...r.duraciones], [15, 30, 45, 60]);
  assert.deepEqual(r.limiteTurno, {
    semana: { tipo: "cierre", minuto: 22 * 60 },
    finDeSemana: { tipo: "ultimoInicio" },
  });
}

// ── 2) Cantidades aceptadas y rechazadas ───────────────────────────────────
{
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 1), true, "uno aceptado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 2), true, "dos aceptados");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 3), true, "tres aceptados");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 4), true, "cuatro aceptados");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 0), false, "cero rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 5), false, "cinco rechazados");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", -1), false, "negativo rechazado");
  assert.equal(cantidadSimuladoresValidaPara("mensualidad", 1.5), false, "fraccionario rechazado");
}

// ── 3) La validación completa, capa por capa ───────────────────────────────
{
  // Uno solo: válido. Esto es lo que fallaba antes de M8C.
  const uno = seleccion({ simuladores: ["Ferrari"] });
  assert.equal(uno.ok, true, "un simulador pasa la validación");
  if (uno.ok) assert.deepEqual(uno.value.simuladores, ["Ferrari"]);

  // Cuatro: válido.
  assert.equal(seleccion({ simuladores: [...SIMS] }).ok, true, "cuatro pasan");

  // Cero: inválido.
  const cero = seleccion({ simuladores: [] });
  assert.equal(cero.ok, false, "cero no pasa");
  if (!cero.ok) assert.equal(cero.codigo, "simuladores_invalidos");

  // Cinco: inválido.
  const cinco = seleccion({ simuladores: [...SIMS, "Ferrari"] });
  assert.equal(cinco.ok, false, "cinco no pasan");
  if (!cinco.ok) assert.equal(cinco.codigo, "simuladores_invalidos");

  // Duplicados: inválido, aunque la cantidad esté en rango.
  const dup = seleccion({ simuladores: ["Ferrari", "Ferrari"] });
  assert.equal(dup.ok, false, "repetir un simulador no pasa");
  if (!dup.ok) assert.equal(dup.codigo, "simuladores_duplicados");

  // Un simulador que no existe: inválido.
  const raro = seleccion({ simuladores: ["Williams"] });
  assert.equal(raro.ok, false, "un simulador inexistente no pasa");
  if (!raro.ok) assert.equal(raro.codigo, "simulador_desconocido");

  // No es un array.
  for (const basura of [null, undefined, "Ferrari", 1, {}]) {
    assert.equal(seleccion({ simuladores: basura }).ok, false,
      `simuladores=${JSON.stringify(basura)} no pasa`);
  }

  // Las condiciones siguen siendo obligatorias, también con un simulador.
  const sinAceptar = seleccion({ simuladores: ["Ferrari"], acepto_condiciones: false });
  assert.equal(sinAceptar.ok, false, "sin aceptar no se reserva");
  if (!sinAceptar.ok) assert.equal(sinAceptar.codigo, "condiciones");
}

// ── 4) El consumo: duración × cantidad, en los cinco casos del pedido ──────
{
  const casos: Array<[number, number, number]> = [
    [1, 15, 15], [1, 60, 60], [2, 30, 60], [4, 15, 60], [4, 60, 240],
  ];
  for (const [n, dur, esperado] of casos) {
    assert.equal(dur * n, esperado, `${n} x ${dur} = ${esperado}`);
    assert.equal(duracionValidaPara("mensualidad", dur), true, `${dur} min es una duración válida`);
    assert.equal(cantidadSimuladoresValidaPara("mensualidad", n), true, `${n} simuladores válidos`);
  }

  // El total NUNCA llega del navegador: la validación lo ignora si se manda.
  const conTotal = seleccion({
    simuladores: ["Ferrari"], minutos_consumidos: 0, total: 0, minutos: 1,
  });
  assert.equal(conTotal.ok, true);
  if (conTotal.ok) {
    assert.deepEqual(
      Object.keys(conTotal.value).sort(),
      ["aceptoCondiciones", "bloques", "duracion", "fecha", "hora", "idempotencyKey", "simuladores"],
      "la validación solo devuelve la selección, nunca un total del cliente",
    );
  }
}

// ── 5) No queda ningún texto que exija dos simuladores ─────────────────────
{
  const archivos = [
    "lib/agenda.ts",
    "lib/mensualidadesReserva.ts",
    "lib/mensualidadesCondiciones.ts",
    "app/mensualidades/CompraMensualidad.tsx",
    "app/mensualidades/reservar/ReservarConMensualidad.tsx",
    "app/mensualidades/reservar/SelectorFecha.tsx",
    "app/vivi-sim/page.tsx",
  ];
  const prohibidas = [
    "Elegí entre 2 y 4 simuladores",
    "Elegí al menos 2 simuladores",
    "con 2, 3 o 4 simuladores",
  ];
  for (const a of archivos) {
    const texto = leer(a);
    for (const p of prohibidas) {
      assert.ok(!texto.includes(p), `${a} todavía dice "${p}"`);
    }
  }

  // Y el mensaje de error de la RPC se arma con los límites de dominio, no a mano.
  const reserva = leer("lib/mensualidadesReserva.ts");
  assert.match(reserva, /REGLAS_POR_PRODUCTO\.mensualidad\.simuladoresMin/,
    "el mensaje de cantidad inválida sale de la fuente de dominio");
  assert.ok(!/Elegí entre 2 y 4/.test(reserva), "no quedó el rango escrito a mano");
}

// ── 6) La pantalla de reserva habla en singular cuando corresponde ─────────
{
  const pantalla = leer("app/mensualidades/reservar/ReservarConMensualidad.tsx");
  assert.match(pantalla, /const minSims = disp\?\.simuladores_min \?\? 1/,
    "el fallback previo a la primera respuesta también es 1");
  assert.match(pantalla, /sims\.length === 1 \? "simulador" : "simuladores"/,
    "con uno dice 'simulador', no '1 simuladores'");
  assert.match(pantalla, /Elegí al menos un simulador/,
    "y el aviso tampoco queda en '1 simuladores'");
  // El botón se habilita con el mínimo real, no con un 2 escrito a mano.
  assert.match(pantalla, /sims\.length >= minSims/,
    "confirmar depende del mínimo del servidor");
  assert.ok(!/sims\.length >= 2/.test(pantalla), "y no de un 2 fijo");
}

// ── 7) La API publica los límites ──────────────────────────────────────────
{
  const api = leer("app/api/mensualidades/disponibilidad/route.ts");
  assert.match(api, /simuladores_min: REGLAS_POR_PRODUCTO\.mensualidad\.simuladoresMin/,
    "la API informa el mínimo desde la fuente");
  assert.match(api, /simuladores_max: REGLAS_POR_PRODUCTO\.mensualidad\.simuladoresMax/);
}

// ── 8) La card de Viví SIM ─────────────────────────────────────────────────
{
  const vivi = leer("app/vivi-sim/page.tsx");

  // Imagen nueva, y solo para Mensualidades.
  assert.match(vivi, /image="\/sim-mensualidades\.webp"/, "usa el asset nuevo");
  assert.ok(!vivi.includes('image="/sim-driver.jpg"'), "ya no usa la foto anterior");
  assert.match(vivi, /image="\/sim-hero\.jpg"/, "Reservas conserva su imagen");
  assert.match(vivi, /image="\/sim-giftcard\.jpg"/, "Gift Cards conserva la suya");

  // Decorativa: la card ya dice en texto lo que muestra la credencial.
  assert.match(vivi, /imageAlt=""/, "la imagen nueva es decorativa");

  // Recorte propio para que la credencial no quede cortada.
  assert.match(vivi, /imagePos="object-\[50%_42%\]"/, "fija su punto de recorte");
  assert.match(vivi, /\$\{imagePos \?\? ""\}/, "y las otras dos siguen centradas");

  // Contenido de la card de MENSUALIDADES. Se acota al bloque de esa card:
  // la de Reservas también tiene un stat "Pilotos 1-4" y no se toca.
  const iMens = vivi.indexOf('href="/mensualidades"');
  assert.ok(iMens > 0, "existe la card de Mensualidades");
  const card = vivi.slice(iMens, vivi.indexOf("/>", vivi.indexOf('cta="Ver mensualidades"')));

  assert.match(card, /badge="Plan prepago"/);
  assert.match(card, /title="Mensualidades"/);
  assert.match(card, /Comprá horas, reservá cuando quieras y disfrutá SIM durante 30 días\./);
  assert.match(card, /value: "\$30\.000"/);
  assert.match(card, /label: "Validez", value: "30 días"/);
  assert.match(card, /label: "Simuladores", value: "1–4"/, "el stat dice Simuladores 1–4");
  assert.ok(!/label: "Pilotos"/.test(card), "esta card ya no dice Pilotos");
  assert.match(card, /cta="Ver mensualidades"/);

  // Y la card de Reservas conserva EXACTAMENTE sus stats.
  const iRes = vivi.indexOf('href="/reservas"');
  const cardRes = vivi.slice(iRes, vivi.indexOf("/>", vivi.indexOf('cta="Reservar ahora"')));
  assert.match(cardRes, /label: "Duración", value: "15 \/ 30"/);
  assert.match(cardRes, /label: "Pilotos", value: "1-4"/, "Reservas no cambió");
  assert.match(cardRes, /label: "Ranking", value: "En vivo"/);
  assert.ok(!/imagePos=/.test(cardRes), "Reservas sigue con el recorte por defecto");

  // next/image con sizes y fill: sin salto de layout.
  assert.match(vivi, /sizes="\(max-width: 768px\) 100vw, \(max-width: 1024px\) 50vw, 33vw"/);
  assert.match(vivi, /\bfill\b/, "usa fill dentro de un contenedor de alto fijo");
  assert.match(vivi, /h-\[300px\] overflow-hidden md:h-\[360px\]/,
    "el alto de la imagen es fijo: la card no se mueve al cargar");
  assert.match(vivi, /object-cover/, "no se deforma");
  // El degradado que hace legible el cuerpo sigue ahí.
  assert.match(vivi, /bg-gradient-to-t from-\[#0b0b0d\]/);
}

// ── 9) El asset existe y es el aprobado ────────────────────────────────────
{
  const bin = readFileSync(join(ROOT, "public/sim-mensualidades.webp"));
  assert.equal(bin.subarray(0, 4).toString("ascii"), "RIFF", "es un contenedor RIFF");
  assert.equal(bin.subarray(8, 12).toString("ascii"), "WEBP", "en formato WebP");
  assert.ok(bin.length < 300_000, `pesa ${(bin.length / 1024) | 0} KB: razonable para web`);
  assert.ok(bin.length > 20_000, "y no es un archivo trunco");
}

console.log("mensualidadesM8C.test.ts OK (1 a 4 simuladores, card nueva, sin textos viejos)");
