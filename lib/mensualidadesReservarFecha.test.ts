import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fechasPublicasPara, diaHabilitadoPara, sumarDias, REGLAS_POR_PRODUCTO,
} from "@/lib/agenda";

// Guarda de la FECHA INICIAL de /mensualidades/reservar (hotfix M8B.2.1).
// Sin DB, sin red, con el calendario congelado en fechas concretas.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesReservarFecha.test.ts
//
// EL DEFECTO
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
// Esto también elimina de raíz cualquier problema de zona horaria en el cliente.

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "app/mensualidades/reservar/ReservarConMensualidad.tsx"), "utf8");
const api = readFileSync(join(ROOT, "app/api/mensualidades/disponibilidad/route.ts"), "utf8");

// Fechas ancla, elegidas porque son las que rompían.
const SABADO = "2026-09-19";
const VIERNES = "2026-09-25";

// ── 1) El caso que rompía, con el reloj congelado ───────────────────────────
// Se comprueba contra las funciones REALES del proyecto, no contra aritmética
// propia: lo que importa es lo que el producto considera día operativo.
{
  for (const [hoy, dia] of [[SABADO, "sábado"], [VIERNES, "viernes"]] as const) {
    const manana = sumarDias(hoy, 1);
    const publicas = fechasPublicasPara("mensualidad", hoy);

    // Esto es exactamente lo que hacía el cliente viejo, y por qué fallaba.
    assert.ok(!publicas.includes(manana),
      `${dia} ${hoy}: "mañana" (${manana}) NO es una fecha pública — por eso pedirla rompía`);
    assert.ok(!diaHabilitadoPara("mensualidad", manana),
      `${dia}: ${manana} no es día operativo`);

    // Y esto es lo que hace el servidor ahora: siempre una fecha válida.
    assert.ok(publicas.length > 0, `${dia}: hay fechas operativas disponibles`);
    assert.ok(diaHabilitadoPara("mensualidad", publicas[0]),
      `${dia}: la primera fecha pública (${publicas[0]}) SÍ es operativa`);
  }
}

// ── 2) Los siete días de la semana ──────────────────────────────────────────
// Domingo y los hábiles ya funcionaban; tienen que seguir funcionando.
{
  const rotosAntes: string[] = [];
  for (let i = 0; i < 7; i++) {
    const hoy = sumarDias(SABADO, i);
    const publicas = fechasPublicasPara("mensualidad", hoy);
    const manana = sumarDias(hoy, 1);

    // Con la corrección: SIEMPRE arranca en una fecha operativa.
    assert.ok(publicas.length > 0, `${hoy}: la ventana nunca queda vacía`);
    assert.ok(diaHabilitadoPara("mensualidad", publicas[0]),
      `${hoy}: la primera fecha pública es operativa`);

    if (!publicas.includes(manana)) rotosAntes.push(hoy);
  }
  // Exactamente dos días de cada siete rompían: viernes y sábado.
  assert.equal(rotosAntes.length, 2,
    `el defecto afectaba 2 días de cada 7, encontrados: ${rotosAntes.join(", ")}`);
  assert.deepEqual(rotosAntes.sort(), [SABADO, VIERNES].sort());
}

// ── 3) La política sigue siendo lunes a viernes ─────────────────────────────
// El arreglo NO relaja ninguna regla: no habilita sábados ni domingos.
{
  const dias = REGLAS_POR_PRODUCTO.mensualidad.diasHabilitados;
  assert.deepEqual([...dias].sort(), [1, 2, 3, 4, 5], "lunes(1) a viernes(5), sin 0 ni 6");

  for (let i = 0; i < 21; i++) {
    const f = sumarDias(SABADO, i);
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    assert.equal(diaHabilitadoPara("mensualidad", f), dow >= 1 && dow <= 5,
      `${f}: operativo solo de lunes a viernes`);
  }
  // Ninguna fecha pública puede caer en fin de semana.
  for (const hoy of [SABADO, VIERNES, "2026-09-20", "2026-09-23"]) {
    for (const f of fechasPublicasPara("mensualidad", hoy)) {
      const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
      assert.ok(dow >= 1 && dow <= 5, `${f} no puede ofrecerse: cae fin de semana`);
    }
  }
}

// ── 4) Las fechas no se corren por UTC ──────────────────────────────────────
// sumarDias trabaja en UTC sobre la fecha calendaria, así que el resultado no
// depende de la hora ni del huso del proceso.
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
  // Nada de aritmética de días ni de "hoy" en el navegador.
  for (const patron of [/86_?400_?000/, /Date\.now\(\)\s*\+/, /setDate\(/, /getDay\(\)/]) {
    assert.ok(!patron.test(src),
      `el cliente no puede calcular fechas por su cuenta (${patron})`);
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
  assert.match(src, /\{fechas\.map\(\(f\) =>/,
    "el selector se dibuja desde la lista propia, no desde la disponibilidad");
  assert.ok(!/\(disp\?\.fechas \?\? \[\]\)\.map/.test(src),
    "el selector ya NO depende de la disponibilidad del día elegido");

  // En la rama de error se pierde la disponibilidad, pero NO la lista.
  const ramaError = src.slice(src.indexOf("if (!res.ok) {"), src.indexOf("const data = (await res.json())"));
  assert.match(ramaError, /setDisp\(null\)/, "se descarta la disponibilidad de esa fecha");
  assert.ok(!/setFechas\(\[\]\)/.test(ramaError), "pero NO se vacía la lista de fechas");
  assert.ok(!/setFechas\(\[\]\)/.test(src), "la lista nunca se vacía a mano en ningún punto");
}

// ── 7) Sin bucles ni cargas duplicadas ──────────────────────────────────────
{
  // Un solo efecto de arranque, con cargar como única dependencia estable.
  const efectos = [...src.matchAll(/useEffect\(/g)].length;
  assert.equal(efectos, 1, "hay un solo useEffect: no puede haber cargas encadenadas");
  assert.match(src, /useEffect\(\(\) => \{\s*void cargar\(""\s*,\s*15\);\s*\}, \[cargar\]\)/,
    "el efecto depende solo de cargar(), que es useCallback con deps vacías");
  assert.match(src, /const cargar = useCallback\(async \(f: string, d: number\) => \{[\s\S]*?\}, \[\]\)/,
    "cargar() es estable: no se recrea en cada render");
  // `fecha` no puede ser dependencia de un efecto que a su vez la cambie.
  assert.ok(!/\}, \[fecha\]\)/.test(src) && !/\}, \[fecha, /.test(src),
    "ningún efecto se dispara por cambiar la fecha: eso sería un bucle");
}

// ── 8) El servidor es la fuente del calendario ──────────────────────────────
{
  assert.match(api, /const publicas = fechasPublicasPara\("mensualidad"\)/,
    "la API usa la fuente canónica");
  assert.match(api, /url\.searchParams\.get\("fecha"\) \|\| publicas\[0\] \|\| ""/,
    "sin fecha, la API contesta la primera operativa");
  assert.match(api, /fechas: publicas/, "y devuelve la ventana completa");
  // El cliente no replica ninguna regla del calendario.
  for (const regla of ["diaHabilitadoPara", "fechasPublicasPara", "LUNES_A_VIERNES", "diasHabilitados"]) {
    assert.ok(!src.includes(regla), `el cliente no duplica la regla ${regla}`);
  }
}

// ── 9) Una ventana realmente vacía se muestra vacía, sin inventar nada ──────
// No puede pasar con el calendario actual, pero si algún día no hubiera fechas
// —feriados encadenados, una regla nueva— la pantalla tiene que decirlo.
{
  assert.match(src, /const \[fechas, setFechas\] = useState<string\[\]>\(\[\]\)/,
    "arranca vacía: no se inventa ninguna fecha antes de la respuesta");
  assert.match(src, /No quedan horarios para esa fecha y duración/,
    "hay un estado vacío explícito");
  // Y no hay ningún valor por defecto de fecha escrito a mano.
  assert.ok(!/useState\("2\d{3}-/.test(src), "no hay fecha hardcodeada");
  assert.match(src, /const \[fecha, setFecha\] = useState\(""\)/, "la fecha arranca vacía");
}

console.log("mensualidadesReservarFecha.test.ts OK (la fecha inicial la decide el servidor)");
