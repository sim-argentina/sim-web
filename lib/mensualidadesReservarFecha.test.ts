import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fechasPublicasPara, diaHabilitadoPara, sumarDias, REGLAS_POR_PRODUCTO,
} from "@/lib/agenda";

// Guarda de la FECHA de /mensualidades/reservar.
// Sin DB, sin red, con el calendario congelado en fechas concretas.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesReservarFecha.test.ts
//
// EL DEFECTO (M8B.2.1)
// El componente arrancaba calculando "mañana" en el navegador y mandándolo a
// /api/mensualidades/disponibilidad, dando por sentado que mañana siempre era
// un día operativo. Dejó de ser cierto en M5C.1, cuando Mensualidades pasó a
// lunes–viernes:
//   · abierta un VIERNES pedía sábado;
//   · abierta un SÁBADO pedía domingo.
// La API rechazaba esos días con 400 —correctamente— y el componente se
// quedaba sin fechas y sin forma de recuperarse. Reservar quedaba roto dos días
// de cada siete.
//
// LA CORRECCIÓN
// El navegador ya no calcula ninguna fecha: la primera carga va SIN fecha y el
// servidor contesta con la primera fecha operativa y con la ventana completa.
//
// M8C cambió la PRESENTACIÓN, no la fuente: las diez fechas dejaron de ser diez
// botones apilados y pasaron a un calendario que se abre. Lo que se puede
// elegir sigue siendo exactamente lo que mandó el servidor.

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "app/mensualidades/reservar/ReservarConMensualidad.tsx"), "utf8");
const sel = readFileSync(join(ROOT, "app/mensualidades/reservar/SelectorFecha.tsx"), "utf8");
const api = readFileSync(join(ROOT, "app/api/mensualidades/disponibilidad/route.ts"), "utf8");

// Fechas ancla, elegidas porque son las que rompían.
const SABADO = "2026-09-19";
const VIERNES = "2026-09-25";

// ── 1) El caso que rompía, con el reloj congelado ───────────────────────────
{
  for (const [hoy, dia] of [[SABADO, "sábado"], [VIERNES, "viernes"]] as const) {
    const manana = sumarDias(hoy, 1);
    const publicas = fechasPublicasPara("mensualidad", hoy);

    assert.ok(!publicas.includes(manana),
      `${dia} ${hoy}: "mañana" (${manana}) NO es una fecha pública — por eso pedirla rompía`);
    assert.ok(!diaHabilitadoPara("mensualidad", manana),
      `${dia}: ${manana} no es día operativo`);

    assert.ok(publicas.length > 0, `${dia}: hay fechas operativas disponibles`);
    assert.ok(diaHabilitadoPara("mensualidad", publicas[0]),
      `${dia}: la primera fecha pública (${publicas[0]}) SÍ es operativa`);
  }
}

// ── 2) Los siete días de la semana ──────────────────────────────────────────
{
  const rotosAntes: string[] = [];
  for (let i = 0; i < 7; i++) {
    const hoy = sumarDias(SABADO, i);
    const publicas = fechasPublicasPara("mensualidad", hoy);
    const manana = sumarDias(hoy, 1);

    assert.ok(publicas.length > 0, `${hoy}: la ventana nunca queda vacía`);
    assert.ok(diaHabilitadoPara("mensualidad", publicas[0]),
      `${hoy}: la primera fecha pública es operativa`);

    if (!publicas.includes(manana)) rotosAntes.push(hoy);
  }
  assert.equal(rotosAntes.length, 2,
    `el defecto afectaba 2 días de cada 7, encontrados: ${rotosAntes.join(", ")}`);
  assert.deepEqual(rotosAntes.sort(), [SABADO, VIERNES].sort());
}

// ── 3) La política sigue siendo lunes a viernes ─────────────────────────────
{
  const dias = REGLAS_POR_PRODUCTO.mensualidad.diasHabilitados;
  assert.deepEqual([...dias].sort(), [1, 2, 3, 4, 5], "lunes(1) a viernes(5), sin 0 ni 6");

  for (let i = 0; i < 21; i++) {
    const f = sumarDias(SABADO, i);
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    assert.equal(diaHabilitadoPara("mensualidad", f), dow >= 1 && dow <= 5,
      `${f}: operativo solo de lunes a viernes`);
  }
  for (const hoy of [SABADO, VIERNES, "2026-09-20", "2026-09-23"]) {
    for (const f of fechasPublicasPara("mensualidad", hoy)) {
      const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
      assert.ok(dow >= 1 && dow <= 5, `${f} no puede ofrecerse: cae fin de semana`);
    }
  }
}

// ── 4) Las fechas no se corren por UTC ──────────────────────────────────────
{
  const previo = process.env.TZ;
  for (const tz of ["UTC", "America/Argentina/Cordoba", "Pacific/Kiritimati", "Etc/GMT+12"]) {
    process.env.TZ = tz;
    assert.equal(sumarDias(SABADO, 1), "2026-09-20", `sumarDias estable en ${tz}`);
    assert.equal(sumarDias("2026-12-31", 1), "2027-01-01", `cambio de año estable en ${tz}`);
    assert.deepEqual(fechasPublicasPara("mensualidad", SABADO).slice(0, 3),
      ["2026-09-21", "2026-09-22", "2026-09-23"], `ventana estable en ${tz}`);
  }
  if (previo === undefined) delete process.env.TZ; else process.env.TZ = previo;
}

// ── 5) El cliente ya no calcula fechas ──────────────────────────────────────
{
  // Nada de aritmética de días ni de "hoy" en el navegador, en NINGUNO de los
  // dos archivos. getDay() es local y se corre con el huso; el calendario usa
  // getUTCDay(), que no.
  for (const [archivo, texto] of [["pantalla", src], ["selector", sel]] as const) {
    for (const patron of [/86_?400_?000/, /Date\.now\(\)\s*\+/, /setDate\(/, /\.getDay\(\)/]) {
      assert.ok(!patron.test(texto),
        `el ${archivo} no puede calcular fechas por su cuenta (${patron})`);
    }
  }
  // La primera carga va SIN fecha.
  assert.match(src, /void cargar\(""\s*,\s*15\)/,
    "la primera carga no manda fecha: la elige el servidor");
  // Y la fecha vigente es la que confirma el servidor.
  assert.match(src, /setFecha\(data\.fecha\)/,
    "la fecha mostrada es la que devolvió el servidor");
}

// ── 6) La lista de fechas sobrevive al error de una fecha ───────────────────
{
  assert.match(src, /const \[fechas, setFechas\] = useState<string\[\]>\(\[\]\)/,
    "la lista de fechas es un estado propio");
  assert.match(src, /setFechas\(data\.fechas\)/, "se llena con lo que manda el servidor");
  assert.ok(!/\(disp\?\.fechas \?\? \[\]\)\.map/.test(src),
    "el selector no depende de la disponibilidad del día elegido");

  // (M8C) La pantalla le pasa la lista al calendario; no la dibuja ella.
  assert.match(src, /<SelectorFecha[\s\S]{0,260}?fechas=\{fechas\}/,
    "el calendario recibe la lista del servidor");
  assert.match(src, /valor=\{fecha\}/, "y la fecha vigente");

  // En la rama de error se pierde la disponibilidad, pero NO la lista.
  const ramaError = src.slice(src.indexOf("if (!res.ok) {"), src.indexOf("const data = (await res.json())"));
  assert.match(ramaError, /setDisp\(null\)/, "se descarta la disponibilidad de esa fecha");
  assert.ok(!/setFechas\(\[\]\)/.test(ramaError), "pero NO se vacía la lista de fechas");
  assert.ok(!/setFechas\(\[\]\)/.test(src), "la lista nunca se vacía a mano en ningún punto");
}

// ── 7) Sin bucles ni cargas duplicadas ──────────────────────────────────────
{
  const efectos = [...src.matchAll(/useEffect\(/g)].length;
  assert.equal(efectos, 1, "la pantalla tiene un solo useEffect: no puede haber cargas encadenadas");
  assert.match(src, /useEffect\(\(\) => \{\s*void cargar\(""\s*,\s*15\);\s*\}, \[cargar\]\)/,
    "el efecto depende solo de cargar(), que es useCallback con deps vacías");
  assert.match(src, /const cargar = useCallback\(async \(f: string, d: number\) => \{[\s\S]*?\}, \[\]\)/,
    "cargar() es estable: no se recrea en cada render");
  assert.ok(!/\}, \[fecha\]\)/.test(src) && !/\}, \[fecha, /.test(src),
    "ningún efecto se dispara por cambiar la fecha: eso sería un bucle");

  // El calendario no pide disponibilidad por su cuenta: avisa y listo.
  assert.ok(!/fetch\(/.test(sel), "el calendario no hace peticiones");
  assert.match(sel, /onElegir\(f\)/, "solo avisa qué fecha se eligió");
}

// ── 8) El servidor es la fuente del calendario ──────────────────────────────
{
  assert.match(api, /const publicas = fechasPublicasPara\("mensualidad"\)/,
    "la API usa la fuente canónica");
  assert.match(api, /url\.searchParams\.get\("fecha"\) \|\| publicas\[0\] \|\| ""/,
    "sin fecha, la API contesta la primera operativa");
  assert.match(api, /fechas: publicas/, "y devuelve la ventana completa");

  // Ni la pantalla ni el calendario replican ninguna regla del negocio.
  for (const [archivo, texto] of [["pantalla", src], ["selector", sel]] as const) {
    for (const regla of [
      "diaHabilitadoPara", "fechasPublicasPara", "LUNES_A_VIERNES", "diasHabilitados",
      "REGLAS_POR_PRODUCTO", "vence_el",
    ]) {
      assert.ok(!texto.includes(regla), `el ${archivo} no duplica la regla ${regla}`);
    }
  }
}

// ── 9) Una ventana realmente vacía se muestra vacía, sin inventar nada ──────
{
  assert.match(src, /const \[fechas, setFechas\] = useState<string\[\]>\(\[\]\)/,
    "arranca vacía: no se inventa ninguna fecha antes de la respuesta");
  assert.match(src, /No quedan horarios para esa fecha y duración/,
    "hay un estado vacío explícito");
  assert.ok(!/useState\("2\d{3}-/.test(src), "no hay fecha hardcodeada");
  assert.ok(!/useState\("2\d{3}-/.test(sel), "tampoco en el calendario");
  assert.match(src, /const \[fecha, setFecha\] = useState\(""\)/, "la fecha arranca vacía");
  // Sin fechas, el control no se puede abrir: no hay nada que elegir.
  assert.match(sel, /disabled=\{deshabilitado \|\| fechas\.length === 0\}/,
    "con la ventana vacía el control queda inerte en vez de abrir un calendario sin días");
}

// ── 10) (M8C) Una sola fecha visible; el resto, en el calendario ────────────
{
  // El control cerrado muestra la fecha elegida, no la lista.
  assert.match(sel, /\{valor \? etiquetaLarga\(valor\) : "Elegí una fecha"\}/,
    "cerrado se ve UNA fecha, la elegida, escrita completa");
  // La grilla solo existe mientras está abierto.
  assert.match(sel, /\{abierto && \(/, "el calendario se dibuja solo si está abierto");
  assert.match(sel, /const \[abierto, setAbierto\] = useState\(false\)/,
    "arranca cerrado: no se ven las diez fechas de entrada");

  // Seleccionable = está en `fechas`. Nada más decide.
  assert.match(sel, /const disponibles = useMemo\(\(\) => new Set\(fechas\)/,
    "el conjunto de fechas elegibles es exactamente el que mandó el servidor");
  assert.match(sel, /const libre = disponibles\.has\(f\)/, "cada día pregunta a ese conjunto");
  assert.match(sel, /disabled=\{!libre\}/, "y si no está, queda deshabilitado de verdad");
  assert.match(sel, /if \(!disponibles\.has\(f\)\) return;/,
    "elegir una fecha ajena a la lista no hace nada, ni siquiera por código");

  // Al elegir, se cierra y avisa.
  assert.match(sel, /onElegir\(f\);\s*cerrar\(true\);/,
    "elegir una fecha cierra el calendario y devuelve el foco");
}

// ── 11) (M8C) Accesibilidad del desplegable ────────────────────────────────
{
  assert.match(sel, /aria-expanded=\{abierto\}/, "el botón declara si está abierto");
  assert.match(sel, /aria-controls=\{idPanel\}/, "y con qué panel se relaciona");
  assert.match(sel, /aria-haspopup="dialog"/, "y que abre un diálogo");
  assert.match(sel, /role="dialog"/, "el panel es un diálogo");
  assert.match(sel, /aria-label="Elegí la fecha de tu turno"/, "con nombre accesible");
  assert.match(sel, /Fecha\s*<\/p>/, "la etiqueta 'Fecha' es visible, no solo para lectores");

  // Escape cierra y devuelve el foco.
  assert.match(sel, /e\.key === "Escape"/, "Escape cierra");
  assert.match(sel, /botonRef\.current\?\.focus\(\)/, "y el foco vuelve al botón");

  // Teclado dentro de la grilla.
  for (const tecla of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]) {
    assert.ok(sel.includes(tecla), `la grilla responde a ${tecla}`);
  }
  // Foco itinerante: un solo día tabulable por vez.
  assert.match(sel, /tabIndex=\{f === \(foco \|\| valor\) \? 0 : -1\}/,
    "un solo día entra en el orden de tabulación");
  // Cada día se anuncia con su fecha completa, no con el número suelto.
  assert.match(sel, /aria-label=\{etiquetaLarga\(f\)\}/, "cada día dice su fecha completa");

  // El panel entra en pantallas angostas.
  assert.match(sel, /max-w-\[min\(360px,100%\)\]/,
    "el calendario no puede desbordar el viewport a 320 px");
}

// ── 12) (M8C) Los dos defectos que encontró la validación visual ───────────
{
  // A · El foco se mueve DESPUÉS del render, en un efecto que depende de `foco`.
  //     Hacerlo dentro del manejador de teclas rompía cualquier salto que
  //     cambiara de mes —End, o pasar del 30 de septiembre al 1 de octubre—:
  //     se buscaba un botón que ese render todavía no había dibujado.
  assert.match(sel, /useEffect\(\(\) => \{[\s\S]*?data-fecha="\$\{foco\}"[\s\S]*?\}, \[abierto, foco\]\)/,
    "el foco se mueve en un efecto que depende de `foco`, no dentro del manejador");
  assert.ok(!/setFoco\(f\);\s*panelRef/.test(sel),
    "no se vuelve a enfocar imperativamente justo después de setFoco");

  // B · `mover` calcula sobre el foco ANTERIOR: dos teclas seguidas antes de
  //     que React repinte tienen que avanzar dos, no una.
  assert.match(sel, /setFoco\(\(prev\) => \{/,
    "mover() usa la forma funcional de setFoco");
  assert.match(sel, /fechas\.indexOf\(prev \|\| valor\)/,
    "y parte del foco previo, no del de este render");

  // C · El control cerrado muestra la fecha COMPLETA: nada de recortarla.
  const control = sel.slice(sel.indexOf("id={`${idPanel}-valor`}"), sel.indexOf("</span>", sel.indexOf("id={`${idPanel}-valor`}")));
  assert.ok(!/truncate/.test(control),
    "la fecha del control no se trunca: a 320 px envuelve en dos líneas");

  // D · La tarjeta puede achicarse. Un ítem de grilla tiene `min-width: auto` y
  //     no baja de su contenido mínimo; el control de fecha lo fijaba en 300 px
  //     y a 320 px empujaba la tarjeta fuera de la pantalla, recortada en
  //     silencio porque overflow-x está en hidden.
  assert.match(src, /\$\{CAJA\} min-w-0/,
    "la tarjeta de selección lleva min-w-0 para poder achicarse");
}

console.log("mensualidadesReservarFecha.test.ts OK (la fecha la decide el servidor; el calendario solo la muestra)");
