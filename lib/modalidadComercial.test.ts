import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  CORTE_MODALIDAD_V2, CORTE_MODALIDAD_V2_MS, MOTIVO_OVERRIDE_MAX, ZONA_CORTE,
  leerInstante, modalidadEfectiva, modalidadProgramada, validarPedidoOverride,
} from "@/lib/modalidadComercial";

// Resolver de la modalidad comercial (Bloque B0). Puro: no toca la base.
// Ejecutar: npx tsx --env-file=.env.local lib/modalidadComercial.test.ts
//
// Tests 1–6 del bloque (calendario y override), la zona horaria, la fuente
// única del corte (test 9), la frontera server-only y las guardas de las rutas
// administrativas. El comportamiento contra la base lo prueban
// db/modalidad-comercial-b1.verificacion.sql y lib/modalidadComercialB1.integration.ts.

const ROOT = process.cwd();
const leer = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Instantes de borde escritos a mano, independientes de la constante.
const UN_MS_ANTES = new Date("2026-10-01T02:59:59.999Z");
const EN_EL_CORTE = new Date("2026-10-01T03:00:00.000Z");

// ── 1 y 2 · El calendario ───────────────────────────────────────────────────
{
  assert.equal(modalidadProgramada(UN_MS_ANTES), "legacy", "1 · 30/09 23:59:59.999 ART → legacy");
  assert.equal(modalidadProgramada(EN_EL_CORTE), "v2_10", "2 · 01/10 00:00:00.000 ART → v2_10");
  // Los mismos bordes, derivados de la constante.
  assert.equal(modalidadProgramada(new Date(CORTE_MODALIDAD_V2_MS - 1)), "legacy");
  assert.equal(modalidadProgramada(new Date(CORTE_MODALIDAD_V2_MS)), "v2_10");
  assert.equal(modalidadProgramada(new Date(CORTE_MODALIDAD_V2_MS + 1)), "v2_10");
  // Lejos del corte, a los dos lados.
  assert.equal(modalidadProgramada(new Date("2026-09-28T20:00:00Z")), "legacy");
  assert.equal(modalidadProgramada(new Date("2027-01-01T00:00:00Z")), "v2_10");
  // Un instante inválido es un error de programación, no una modalidad.
  assert.throws(() => modalidadProgramada(new Date(Number.NaN)), /instante/);
  assert.throws(() => modalidadProgramada("2026-10-02" as unknown as Date), /instante/);
}

// ── 3 a 6 · El override gana sobre el calendario ────────────────────────────
{
  assert.equal(modalidadEfectiva(modalidadProgramada(UN_MS_ANTES), null), "legacy", "3 · override NULL antes → legacy");
  assert.equal(modalidadEfectiva(modalidadProgramada(EN_EL_CORTE), null), "v2_10", "4 · override NULL después → v2_10");
  assert.equal(modalidadEfectiva(modalidadProgramada(EN_EL_CORTE), "legacy"), "legacy", "5 · override legacy después → legacy");
  assert.equal(modalidadEfectiva(modalidadProgramada(UN_MS_ANTES), "v2_10"), "v2_10", "6 · override v2 antes → v2_10");
  assert.equal(modalidadEfectiva("legacy", "legacy"), "legacy");
  assert.equal(modalidadEfectiva("v2_10", "v2_10"), "v2_10");
}

// ── Zona horaria: el corte es un INSTANTE, no una fecha local ───────────────
{
  assert.equal(CORTE_MODALIDAD_V2_MS, Date.UTC(2026, 9, 1, 3, 0, 0, 0), "01/10 00:00 ART = 01/10 03:00 UTC");
  assert.equal(new Date(CORTE_MODALIDAD_V2_MS).toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(ZONA_CORTE, "America/Argentina/Buenos_Aires");

  const enZona = (ms: number, zona: string) => new Intl.DateTimeFormat("sv-SE", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(ms));
  // Buenos Aires y Córdoba (la zona que usa lib/agenda.ts) son la misma hora.
  for (const zona of ["America/Argentina/Buenos_Aires", "America/Argentina/Cordoba"]) {
    assert.equal(enZona(CORTE_MODALIDAD_V2_MS, zona), "2026-10-01 00:00:00", `corte en ${zona}`);
    assert.equal(enZona(CORTE_MODALIDAD_V2_MS - 1000, zona), "2026-09-30 23:59:59", `1 s antes en ${zona}`);
  }

  // El resultado NO depende de la zona del proceso: se prueba con varias, como
  // si el servidor estuviera en cualquier lado (Vercel corre en UTC).
  const tzOriginal = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/Argentina/Buenos_Aires", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      process.env.TZ = tz;
      assert.equal(Date.parse(CORTE_MODALIDAD_V2), CORTE_MODALIDAD_V2_MS, `TZ=${tz}: el literal da el mismo instante`);
      assert.equal(modalidadProgramada(UN_MS_ANTES), "legacy", `TZ=${tz}: 1 ms antes → legacy`);
      assert.equal(modalidadProgramada(EN_EL_CORTE), "v2_10", `TZ=${tz}: en el corte → v2_10`);
    }
    // La trampa que el módulo evita: una fecha sola se lee como 00:00 UTC, que
    // en Argentina son las 21:00 del 30/09. Tres horas antes de tiempo.
    process.env.TZ = "UTC";
    assert.equal(CORTE_MODALIDAD_V2_MS - new Date("2026-10-01").getTime(), 3 * 3_600_000,
      "new Date('AAAA-MM-DD') adelanta el corte 3 horas: por eso está prohibido");
  } finally {
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
  }
}

// ── `at` del diagnóstico: solo instantes con zona ───────────────────────────
{
  assert.equal(leerInstante("2026-10-01T03:00:00.000Z")?.getTime(), CORTE_MODALIDAD_V2_MS);
  assert.equal(leerInstante(CORTE_MODALIDAD_V2)?.getTime(), CORTE_MODALIDAD_V2_MS, "con offset -03:00");
  assert.equal(leerInstante("2026-10-01T02:59:59.999Z")?.getTime(), CORTE_MODALIDAD_V2_MS - 1);
  assert.equal(leerInstante("2026-10-01T03:00Z")?.getTime(), CORTE_MODALIDAD_V2_MS, "sin segundos");
  for (const malo of [
    "2026-10-01", "2026-10-01T00:00:00", "2026-10-01 00:00:00-03:00", "2026-10-01T00:00:00-0300",
    "hoy", "", "  2026-10-01T03:00:00Z", `${"9".repeat(41)}`, 1790823600000, null, undefined,
  ]) {
    assert.equal(leerInstante(malo), null, `${JSON.stringify(malo)} no es un instante aceptable`);
  }
}

// ── Pedido de override: forma estricta ──────────────────────────────────────
{
  const ok = (b: unknown) => { const r = validarPedidoOverride(b); assert.ok(r.ok, JSON.stringify(b)); return r.ok ? r.data : null; };
  const falla = (b: unknown, status: number, codigo: string) => {
    const r = validarPedidoOverride(b);
    assert.ok(!r.ok, `${JSON.stringify(b)} tenía que fallar`);
    if (!r.ok) {
      assert.equal(r.status, status, JSON.stringify(b));
      assert.equal(r.codigo, codigo, JSON.stringify(b));
    }
  };
  assert.deepEqual(ok({ override: null, motivo: "  volver al calendario " }), { override: null, motivo: "volver al calendario" });
  assert.deepEqual(ok({ override: "legacy", motivo: "rollback" }), { override: "legacy", motivo: "rollback" });
  assert.deepEqual(ok({ override: "v2_10", motivo: "contingencia" }), { override: "v2_10", motivo: "contingencia" });
  // El actor NUNCA sale del cuerpo: se ignora aunque venga.
  assert.deepEqual(ok({ override: null, motivo: "x", actor: "otro", rol: "admin" }), { override: null, motivo: "x" });
  falla({ motivo: "sin override" }, 400, "override_invalido"); // ausente ≠ null
  falla({ override: undefined, motivo: "x" }, 400, "override_invalido");
  falla({ override: "V2_10", motivo: "x" }, 400, "override_invalido");
  falla({ override: "v2", motivo: "x" }, 400, "override_invalido");
  falla({ override: true, motivo: "x" }, 400, "override_invalido");
  falla({ override: null }, 422, "motivo_requerido");
  falla({ override: null, motivo: "   " }, 422, "motivo_requerido");
  falla({ override: null, motivo: 42 }, 422, "motivo_requerido");
  falla({ override: null, motivo: "x".repeat(MOTIVO_OVERRIDE_MAX + 1) }, 422, "motivo_demasiado_largo");
  assert.ok(validarPedidoOverride({ override: null, motivo: "x".repeat(MOTIVO_OVERRIDE_MAX) }).ok);
  falla(null, 400, "solicitud_invalida");
  falla([], 400, "solicitud_invalida");
  falla("legacy", 400, "solicitud_invalida");
}

// ── Repo: recorrido de archivos fuente ──────────────────────────────────────
const CARPETAS = ["app", "lib", "components", "data", "db", "tests"];
const RAIZ_SUELTOS = ["middleware.ts", "next.config.ts", "vercel.json"];
const EXT = /\.(ts|tsx|mts|js|mjs|jsx|sql|json)$/;
const archivos: string[] = [];
const recorrer = (dir: string) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (EXT.test(e)) archivos.push(relative(ROOT, p).split(sep).join("/"));
  }
};
for (const c of CARPETAS) if (existsSync(join(ROOT, c))) recorrer(join(ROOT, c));
for (const f of RAIZ_SUELTOS) if (existsSync(join(ROOT, f))) archivos.push(f);
assert.ok(archivos.length > 300, `se recorrieron ${archivos.length} archivos`);

// ── 9 · UNA sola fuente del corte ───────────────────────────────────────────
// Falla si la fecha aparece fuera de lib/modalidadComercial.ts, salvo en los
// archivos listados a mano con su motivo. La lista es EXPLÍCITA a propósito:
// un archivo nuevo con esa fecha tiene que justificarse acá.
{
  const FECHA = "2026-10-01";
  const PERMITIDOS: Record<string, string> = {
    "lib/modalidadComercial.ts": "FUENTE ÚNICA del corte",
    "lib/modalidadComercial.test.ts": "este test: bordes ±1 ms escritos a mano",
    "db/modalidad-comercial-b1.sql":
      "dato: vigente_desde de los precios nuevos de planes (mensualidad_plan_precios); lib/modalidadComercialB1.integration.ts lo cruza con la constante",
    "db/modalidad-comercial-b1.verificacion.sql": "verificación de ese mismo dato",
    "lib/reservasComercial.test.ts":
      "B3: ventana y fixtures alrededor del corte; el instante sale de CORTE_MODALIDAD_V2_MS",
    // Fixtures PREEXISTENTES en las que la fecha NO es el corte:
    "lib/empresas.test.ts": "fecha de ejemplo de una campaña",
    "lib/finanzasComisionesMes.integration.ts": "fin exclusivo del rango de septiembre",
    "lib/finanzasRangoMes.test.ts": "fin exclusivo del rango de septiembre",
    "lib/mensualidadesM7_4.test.ts": "vencimiento de ejemplo",
    "lib/ia/consumoMes.test.ts": "fin exclusivo del rango de septiembre",
    "lib/turneroCambio.test.ts": "Turnero, cambio de caja: 01/10 es el ejemplo de un cierre cualquiera, no el corte",
  };
  const conFecha = archivos.filter((f) => leer(f).includes(FECHA));
  const sinPermiso = conFecha.filter((f) => !(f in PERMITIDOS));
  assert.deepEqual(sinPermiso, [], `la fecha del corte aparece fuera de la fuente única: ${sinPermiso.join(", ")}`);
  // Ningún permiso queda colgado: todo archivo listado existe y usa la fecha.
  for (const f of Object.keys(PERMITIDOS)) {
    assert.ok(conFecha.includes(f), `permiso obsoleto: ${f} ya no contiene ${FECHA}`);
  }

  // El literal EXACTO del corte vive una sola vez, en una sola línea. Acá se
  // toma de la constante y se comprueba armado por partes, para que ni este
  // test lo repita.
  const literal = CORTE_MODALIDAD_V2;
  assert.equal(literal, [2026, "10", "01"].join("-") + "T00:00:00-03:00");
  const conLiteral = archivos.filter((f) => leer(f).includes(literal));
  assert.deepEqual(conLiteral, ["lib/modalidadComercial.ts"], "el literal del corte está solo en la fuente única");
  assert.equal(leer("lib/modalidadComercial.ts").split(literal).length - 1, 1, "y una sola vez");

  // Otras formas de escribir el mismo corte, fuera de la fuente y de este test.
  const FORMAS = [/Date\.UTC\(\s*2026\s*,\s*9\s*,\s*1\b/, /new Date\(\s*2026\s*,\s*9\s*,\s*1\b/, /2026-10-01T0[03]:00/];
  for (const f of archivos) {
    if (f === "lib/modalidadComercial.ts" || f === "lib/modalidadComercial.test.ts") continue;
    const src = leer(f);
    for (const forma of FORMAS) assert.ok(!forma.test(src), `${f}: otra forma del corte (${forma})`);
  }

  // Y la fuente no construye fechas locales.
  const fuente = leer("lib/modalidadComercial.ts");
  assert.ok(!/new Date\(\s*"\d{4}-\d{2}-\d{2}"\s*\)/.test(fuente), "sin new Date('AAAA-MM-DD')");
  assert.ok(!/new Date\(\s*\d{4}\s*,/.test(fuente), "sin new Date(año, mes, día)");
}

// ── Server-only: el navegador nunca resuelve la modalidad ───────────────────
{
  const SERVER_ONLY = ["@/lib/modalidadComercial", "@/lib/modalidadComercialDiagnostico"];
  for (const f of archivos.filter((x) => /\.(ts|tsx)$/.test(x))) {
    const src = leer(f);
    if (!/^\s*["']use client["']/m.test(src)) continue;
    for (const m of SERVER_ONLY) {
      assert.ok(!src.includes(`"${m}"`) && !src.includes(`'${m}'`), `${f} es "use client" e importa ${m}`);
    }
  }
  assert.ok(!leer("lib/catalogoComercial.ts").includes("@/lib/modalidadComercial"),
    "el catálogo (client-safe) no depende del resolver server-only");
}

// ── B0 NO conecta consumidores ──────────────────────────────────────────────
// Solo el núcleo, el diagnóstico, sus dos rutas y los tests importan estos
// módulos. Cuando un bloque posterior conecte un flujo, lo agrega acá a
// conciencia: este test es la prueba de que B0/B1 no cambió ninguna venta.
{
  const PERMITIDOS = new Set([
    "lib/catalogoComercial.ts", "lib/modalidadComercial.ts", "lib/modalidadComercialDiagnostico.ts",
    "app/api/admin/modalidad-comercial/diagnostico/route.ts", "app/api/admin/modalidad-comercial/override/route.ts",
    "lib/catalogoComercial.test.ts", "lib/modalidadComercial.test.ts", "lib/modalidadComercialB1.integration.ts",
    // (B2) Motor de agenda por intervalos: paralelo, no es un flujo comercial.
    // lib/disponibilidadIntervalos.test.ts vigila que nada que venda lo importe.
    "lib/agendaIntervalos.ts", "lib/disponibilidadIntervalos.ts", "lib/disponibilidadIntervalosServer.ts",
    "lib/disponibilidadIntervalosTrigger.ts",
    "app/api/admin/modalidad-comercial/disponibilidad-diagnostico/route.ts",
    "lib/agendaIntervalos.test.ts", "lib/disponibilidadIntervalos.test.ts", "lib/disponibilidadIntervalos.integration.ts",
    // (B3) Reservas web: SOLO este flujo se conecta. reservasComercial es la
    // única puerta que resuelve la modalidad vigente; precio, validación y
    // slots reciben la modalidad como parámetro (la del pedido o la guardada).
    // La página /reservas importa únicamente el código/mensaje del 409.
    "lib/reservasComercial.ts", "lib/reservasPricing.ts", "lib/reservasValidation.ts", "lib/reservasSlots.ts",
    "lib/reservasPresentacion.ts", "app/reservas/page.tsx",
    "lib/reservasComercial.test.ts", "lib/reservasComercial.integration.ts",
    // (B4) Precios especiales del panel: qué duraciones se editan sale del
    // catálogo de la modalidad efectiva, resuelta en el servidor.
    "lib/preciosEspeciales.ts", "lib/preciosEspeciales.test.ts",
    // (B5) Gift Cards: productos del catálogo (lib/giftCards.ts, client-safe);
    // giftCardsComercial es la única que resuelve la modalidad para CREAR una;
    // el alta del panel la recibe como parámetro. Mensualidades y Empresas
    // siguen sin importar el núcleo.
    "lib/giftCards.ts", "lib/giftCardsComercial.ts", "lib/giftCardsAdminAlta.ts",
    "lib/giftCardsComercial.test.ts", "lib/giftCardsComercial.integration.ts",
    // (B6) Mensualidades: mensualidadesComercial es la única que resuelve la
    // modalidad vigente para VENDER (web y panel) y lee los precios versionados;
    // un plan existente usa la suya persistida. La agenda (motor B2), la
    // validación de la reserva y las condiciones reciben la modalidad como
    // parámetro. Empresas sigue sin importar el núcleo.
    "lib/mensualidadesComercial.ts", "lib/mensualidadesAgenda.ts", "lib/mensualidadesReserva.ts",
    "lib/mensualidadesCondiciones.ts",
    "lib/mensualidadesB6.test.ts",
    // (B7) Empresas: empresasComercial es la única que resuelve la modalidad
    // vigente, y SOLO para CREAR una campaña (se guarda en modalidad_comercial).
    // Canje, disponibilidad y reprogramación usan la guardada (campaña o
    // reserva); lib/empresasServer.ts y las rutas no importan el núcleo.
    "lib/empresasComercial.ts",
    "lib/empresasB7.test.ts",
    // (B7.1) Bordes de "hoy" en Argentina alrededor de esa medianoche: los
    // instantes se derivan de CORTE_MODALIDAD_V2_MS en vez de escribirse.
    "lib/empresasFechaArgentina.test.ts",
    // (B8) Turnero: turneroComercial es la única que resuelve la modalidad
    // vigente, y SOLO para un ALTA (se guarda en turnos_stand.modalidad); la
    // edición usa la de la fila. Las rutas y la página no importan el núcleo.
    // minutosComerciales solo LEE: cuenta turnos por la modalidad guardada en
    // cada fila (Stand, Reservas, Equipo, IA, Finanzas) y nunca mira el reloj.
    "lib/turneroComercial.ts", "lib/minutosComerciales.ts",
    // (B9) Códigos de descuento: codigosComercial es la única que resuelve la
    // modalidad vigente, y SOLO para las duraciones de un código NUEVO (y para
    // validar una edición contra oferta vigente ∪ lo que el código ya tenía). La
    // validación al usarlo compara la duración REAL contra la lista guardada.
    // El test deriva los bordes de fecha de CORTE_MODALIDAD_V2_MS.
    "lib/codigosComercial.ts", "lib/codigosPromocionesB9.test.ts",
    // (Bloque final) Viví SIM: ofertaPublica resuelve la modalidad UNA vez por
    // request para mostrar duración y "Desde" de los catálogos vigentes (solo
    // lectura, no vende). La Home lee /api/reservas/catalogo desde el navegador.
    // El test deriva las fechas de precio de CORTE_MODALIDAD_V2_MS.
    "lib/ofertaPublica.ts", "lib/ofertaPublicaFinal.test.ts",
  ]);
  const importadores = archivos.filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => {
    const src = leer(f);
    return /["']@\/lib\/(catalogoComercial|modalidadComercial|modalidadComercialDiagnostico)["']/.test(src);
  });
  const ajenos = importadores.filter((f) => !PERMITIDOS.has(f));
  assert.deepEqual(ajenos, [], `B0 no conecta flujos comerciales; importan el núcleo: ${ajenos.join(", ")}`);

  // mensualidad_plan_precios: preparada en B1 y conectada en B6. La lee el
  // diagnóstico y UNA sola puerta comercial (se buscan consultas reales, no
  // menciones en comentarios).
  const leenPrecios = archivos
    .filter((f) => /^(app|lib|components)\//.test(f) && !/\.(test|integration)\.m?ts$/.test(f))
    .filter((f) => /\.from\(\s*["']mensualidad_plan_precios["']\s*\)/.test(leer(f)));
  assert.deepEqual(leenPrecios.sort(), ["lib/mensualidadesComercial.ts", "lib/modalidadComercialDiagnostico.ts"],
    "solo el diagnóstico y lib/mensualidadesComercial.ts (B6) leen mensualidad_plan_precios");

  // La RPC del override tiene un solo llamador.
  const llamanRpc = archivos
    .filter((f) => /^(app|lib|components)\//.test(f) && !/\.(test|integration)\.m?ts$/.test(f))
    .filter((f) => leer(f).includes("modalidad_comercial_set_override"));
  assert.deepEqual(llamanRpc, ["lib/modalidadComercial.ts"]);
}

// ── Test 20 (estructural) · Rutas: solo admin y en la frontera correcta ────
{
  const handlers = (src: string) =>
    [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);

  const diag = leer("app/api/admin/modalidad-comercial/diagnostico/route.ts");
  assert.deepEqual(handlers(diag), ["GET"], "diagnóstico: solo GET");
  assert.ok(/requireAdmin\(\)/.test(diag), "diagnóstico: requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(diag), "diagnóstico: staff NO");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(diag), "diagnóstico: corta si el guard falla");
  assert.ok(/force-dynamic/.test(diag) && /no-store/.test(diag), "diagnóstico: sin caché");

  // Solo lectura: ni la ruta ni el módulo escriben nada.
  for (const f of ["app/api/admin/modalidad-comercial/diagnostico/route.ts", "lib/modalidadComercialDiagnostico.ts"]) {
    const src = leer(f);
    for (const escritura of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      assert.ok(!src.includes(escritura), `${f}: es de solo lectura, no usa ${escritura}`);
    }
  }

  const ovr = leer("app/api/admin/modalidad-comercial/override/route.ts");
  assert.deepEqual(handlers(ovr), ["POST"], "override: solo POST");
  assert.ok(/requireAdmin\(\)/.test(ovr), "override: requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(ovr), "override: staff NO");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(ovr), "override: corta si el guard falla");
  assert.ok(/isAllowedOrigin\(req\)/.test(ovr), "override: segunda cerradura contra CSRF");
  assert.ok(/actor: auth\.role, rol: auth\.role/.test(ovr), "override: actor y rol salen de la sesión firmada");
  for (const prohibido of ["body.actor", "body.rol", "body.actor_rol"]) {
    assert.ok(!ovr.includes(prohibido), `override: no lee ${prohibido}`);
  }
  // Defensa en profundidad: el wrapper también exige admin antes de la RPC.
  assert.ok(/if \(ctx\.rol !== "admin"\)/.test(leer("lib/modalidadComercial.ts")), "cambiarOverride exige admin");
}

console.log("OK — modalidadComercial: corte 01/10 00:00 ART = 03:00 UTC, override, fuente única y fronteras.");
