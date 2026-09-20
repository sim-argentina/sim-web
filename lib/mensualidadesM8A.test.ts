import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  VENTAS_PAUSADAS, VENTAS_PAUSADAS_MENSAJE, VENTAS_PAUSADAS_STATUS,
} from "@/lib/mensualidadesVentas";

// Guardas PURAS de las DOS llaves (Bloque M8A). No consultan la base ni la red.
// Ejecutar: npx tsx --env-file=.env.local lib/mensualidadesM8A.test.ts
//
// El comportamiento contra la base lo prueba mensualidadesM8A.integration.ts.
// Acá vive lo que se puede afirmar leyendo el código, y que es justamente lo más
// fácil de romper sin darse cuenta: que aparezca un camino nuevo capaz de
// iniciar una venta sin consultar la pausa, o que la pausa se cuele en algo que
// no debería apagar.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── 1) El contrato de la respuesta ──────────────────────────────────────────
{
  assert.equal(VENTAS_PAUSADAS, "ventas_publicas_pausadas", "código interno estable");
  // 503 y no 403: la pausa es temporal y no es culpa de quien pregunta.
  assert.equal(VENTAS_PAUSADAS_STATUS, 503);
  assert.match(VENTAS_PAUSADAS_MENSAJE, /pausadas/i);
  assert.match(VENTAS_PAUSADAS_MENSAJE, /Mi Plan/,
    "el mensaje le dice al titular qué SÍ puede hacer");
  // Nada de jerga ni de nombres internos en un texto que lee un cliente.
  for (const feo of ["503", "flag", "MENSUALIDADES_ENABLED", "config", "error"]) {
    assert.ok(!VENTAS_PAUSADAS_MENSAJE.includes(feo), `el mensaje público no dice "${feo}"`);
  }
}

// ── 2) Un solo camino puede iniciar una venta, y consulta la pausa ──────────
// Si mañana aparece otro endpoint público que cree preferencias, este test lo
// encuentra: no alcanza con que el de hoy esté bien.
{
  const publicas = join(ROOT, "app/api/mensualidades");
  const rutas: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name === "route.ts") rutas.push(p);
    }
  };
  recorrer(publicas);

  const creanPreferencia = rutas.filter((p) => {
    const src = readFileSync(p, "utf8");
    return /crearCompraYPreferencia|new Preference\(/.test(src);
  });
  assert.equal(creanPreferencia.length, 1,
    `solo UNA ruta pública puede crear preferencias, hay ${creanPreferencia.length}`);

  const src = readFileSync(creanPreferencia[0], "utf8");
  assert.match(src, /ventasPublicasHabilitadas\(\)/,
    "la ruta que crea preferencias consulta la pausa");
  assert.match(src, /mensualidadesHabilitadas\(\)/,
    "y también la llave general");
  // La llave general va PRIMERO: con el módulo oculto la ruta no existe, y no
  // tiene que revelar nada sobre el estado comercial.
  assert.ok(
    src.indexOf("mensualidadesHabilitadas()") < src.indexOf("ventasPublicasHabilitadas()"),
    "la llave general se comprueba antes que la comercial",
  );
  assert.match(src, /VENTAS_PAUSADAS_STATUS/, "responde con el status acordado");
}

// ── 3) La pausa NO apaga lo que no debe ─────────────────────────────────────
// Un titular que ya compró no puede quedar rehén de una decisión comercial.
{
  const intocables = [
    ["app/api/mensualidades/webhook/route.ts", "el webhook"],
    ["app/api/mensualidades/resultado/route.ts", "el resultado y la reconciliación"],
    ["app/api/mensualidades/sesion/route.ts", "la sesión de Mi Plan"],
    ["app/api/mensualidades/mi-plan/route.ts", "los datos de Mi Plan"],
    ["app/api/mensualidades/disponibilidad/route.ts", "la disponibilidad"],
    ["app/api/mensualidades/reservar/route.ts", "reservar con saldo"],
    ["app/api/mensualidades/reservas/cancelar/route.ts", "cancelar"],
    ["app/api/mensualidades/reservas/reprogramar/route.ts", "reprogramar"],
    ["app/api/admin/mensualidades/nueva/route.ts", "el alta administrativa"],
    ["app/api/admin/mensualidades/[id]/acciones/route.ts", "las acciones de M7"],
  ] as const;
  for (const [ruta, que] of intocables) {
    const src = read(ruta);
    assert.ok(!/ventasPublicasHabilitadas\s*\(/.test(src),
      `${que} NO se apaga con la pausa comercial (${ruta})`);
  }
}

// ── 4) El webhook no depende de NINGUNA de las dos llaves ───────────────────
// Un pago ya hecho tiene que poder acreditarse siempre: si no, quedaría plata
// cobrada sin mensualidad entregada.
{
  const src = read("app/api/mensualidades/webhook/route.ts");
  assert.ok(!/mensualidadesHabilitadas\s*\(/.test(src), "el webhook ignora la llave general");
  assert.ok(!/ventasPublicasHabilitadas\s*\(/.test(src), "y también la comercial");
}

// ── 5) La llave general prevalece ───────────────────────────────────────────
{
  const src = read("lib/mensualidadesVentas.ts");
  assert.match(src, /sePuedeComprar: moduloPublico && ventasPublicas/,
    "comprar exige las DOS llaves");
  // Ante un error de lectura no se vende.
  assert.match(src, /if \(error\) return false/,
    "si no se puede leer el estado, no se vende");
  assert.match(src, /coalesce\(|return data === true/,
    "el valor se compara de forma estricta");
}

// ── 6) Permisos del control administrativo ──────────────────────────────────
{
  const src = read("app/api/admin/mensualidades/ventas/route.ts");
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers.sort(), ["GET", "POST"], "expone leer y escribir, nada más");
  assert.match(src, /requireStaffOrAdmin\(\)/, "leer: admin y staff");
  assert.match(src, /requireAdmin\(\)/, "escribir: solo admin");
  assert.match(src, /isAllowedOrigin\(req\)/, "la escritura comprueba el origen");
  assert.match(src, /actor: auth\.role/, "el actor sale de la sesión firmada");
  assert.match(src, /typeof habilitadas !== "boolean"/,
    "el estado tiene que ser un booleano estricto: 'true' no habilita nada");
  for (const prohibido of ["body.actor", "body.actor_rol", "body.rol", "body.estado_anterior"]) {
    assert.ok(!src.includes(prohibido), `no acepta ${prohibido} del cuerpo`);
  }

  const modulo = read("lib/mensualidadesVentas.ts");
  assert.match(modulo, /ctx\.rol !== "admin"/, "el módulo también exige admin");
  assert.match(modulo, /if \(!m\) return fail\(422, "motivo_requerido"/,
    "el motivo es obligatorio y se recorta antes de mirarlo");
}

// ── 7) La base manda, no la pantalla ────────────────────────────────────────
{
  const sql = read("db/mensualidades-m8a-ventas-publicas.sql");
  assert.match(sql, /ventas_publicas_habilitadas boolean\s+not null default false/,
    "el valor inicial seguro es false");
  assert.match(sql, /constraint mensualidad_config_singleton_chk check \(id = 1\)/,
    "una sola fila, garantizada por la base");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.mensualidad_config from public, anon, authenticated/);
  assert.match(sql, /p_actor_rol, ''\) <> 'admin'/, "la RPC exige rol admin");
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /for update/, "los cambios concurrentes se serializan");
  assert.match(sql, /where idempotency_key = p_idempotency_key/,
    "un reintento con la misma clave no vuelve a escribir");
}

// ── 8) SEO: la indexación sigue a la llave general, no a la comercial ───────
{
  const landing = read("app/mensualidades/page.tsx");
  assert.match(landing, /generateMetadata/, "la metadata se decide por request");
  assert.match(landing, /mensualidadesHabilitadas\(\)\s*\n?\s*\?\s*base/,
    "con el módulo publicado la landing es indexable");
  assert.ok(!/ventasPublicasHabilitadas[^)]*\)\s*\?\s*base/.test(landing),
    "una pausa comercial NO desindexa la landing");

  const sitemap = read("app/sitemap.ts");
  assert.match(sitemap, /mensualidadesHabilitadas\(\)\s*\?\s*\[\.\.\.RUTAS, "\/mensualidades"\]/,
    "Mensualidades entra al sitemap solo con el módulo publicado");
  for (const privada of ["/mensualidades/mi-plan", "/mensualidades/reservar", "/mensualidades/resultado"]) {
    assert.ok(!sitemap.includes(privada), `${privada} nunca va al sitemap`);
  }

  // Las páginas con datos del titular siguen con noindex.
  for (const p of [
    "app/mensualidades/mi-plan/page.tsx",
    "app/mensualidades/reservar/page.tsx",
    "app/mensualidades/resultado/page.tsx",
  ]) {
    assert.match(read(p), /robots:\s*\{\s*index:\s*false/, `${p} lleva noindex`);
  }
}

// ── 9) Analítica sin PII ────────────────────────────────────────────────────
{
  const src = read("lib/analytics.ts");
  const crudo = src.slice(src.indexOf("Embudo de Mensualidades"));
  assert.ok(crudo.length > 0, "el embudo de Mensualidades existe");

  // Se miran las LÍNEAS DE CÓDIGO, no los comentarios: el encabezado del bloque
  // nombra los campos prohibidos justamente para decir que no se envían, y eso
  // no tiene por qué hacer fallar la guarda.
  const bloque = crudo
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  // Ningún helper del embudo recibe ni envía datos de una persona.
  for (const prohibido of [
    "nombre", "apellido", "telefono", "email", "codigo", "token", "dni",
  ]) {
    assert.ok(!new RegExp(`\\b${prohibido}\\b`, "i").test(bloque),
      `el embudo de Mensualidades no toca "${prohibido}"`);
  }
  // La pausa se mide aparte del error técnico: mezclarlos arruina la tasa de error.
  assert.match(bloque, /checkout_blocked/);
  assert.ok(!/checkout_error/.test(bloque),
    "una venta pausada no se cuenta como error de checkout");
}

// ── 10) Los textos públicos no prometen lo que no hay ───────────────────────
{
  const cond = read("lib/mensualidadesCondiciones.ts");
  // (M8A.1) La altura sale de la fuente única, no de un literal escrito a mano:
  // así es imposible que Mensualidades vuelva a decir una cifra distinta de la
  // del resto del sitio.
  // (M8C) La redacción cambió al reagrupar en ocho condiciones, así que ya no
  // se arma con REQUISITOS_TEXTO. Lo que importa no es qué helper se use sino
  // que las cifras NO estén escritas a mano: se comprueba las dos cosas.
  assert.match(cond, /ALTURA_MINIMA_M/, "la altura sale de la fuente única");
  assert.match(cond, /PESO_MAXIMO_KG/, "y el peso también");
  for (const literal of ["1,40", "1.40", "110 kg"]) {
    assert.ok(!cond.includes(literal),
      `la cifra "${literal}" no puede estar escrita a mano en las condiciones`);
  }
  // Lo que no puede aparecer es una PROMESA de disponibilidad. Decir que NO se
  // garantiza es exactamente lo contrario y tiene que poder decirse.
  for (const promesa of [
    /disponibilidad garantizada/i,
    /garantizamos/i,
    /te garantiza/i,
    /horarios? garantizados?/i,
    /turnos? asegurados?/i,
  ]) {
    assert.ok(!promesa.test(cond), `las condiciones no prometen disponibilidad (${promesa})`);
  }
  // (M8C) La redacción cambió a "Los turnos están sujetos a...". Se acepta
  // cualquiera de las dos concordancias: lo que se vigila es que la frase esté.
  assert.match(cond, /sujet[oa]s a disponibilidad real/i,
    "y dicen explícitamente que la reserva depende de la disponibilidad");
  // Las reglas de M5C tienen que estar a la vista de quien acepta.
  assert.match(cond, /24 horas de anticipación/);
  assert.match(cond, /no se devuelven/);
  assert.match(cond, /se consumen/, "el no-show consume los minutos");
  assert.match(cond, /código nuevo/);
  assert.match(cond, /30 días/);
  assert.match(cond, /23:59/);
  assert.match(cond, /60 minutos/);
}

console.log("mensualidadesM8A.test.ts OK (dos llaves, un solo camino de venta, SEO, analítica y textos)");
