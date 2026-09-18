import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Guarda estructural de los permisos de M7.
// Ejecutar: npx tsx lib/mensualidadesM7Auth.test.ts
//
// La regla del bloque es corta y no admite matices: consultar lo pueden hacer
// admin y staff; ESCRIBIR, solo admin, y el control vive en el servidor.
//
// Este test lee las rutas y comprueba que la frontera esté donde tiene que
// estar. No reemplaza a la prueba de comportamiento —esa corre contra el
// servidor con una sesión de staff real— pero sí evita la regresión más
// probable: que alguien agregue un endpoint de escritura nuevo y se olvide el
// guard, o que cambie requireAdmin por requireStaffOrAdmin "para que funcione".

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const LECTURAS = [
  "app/api/admin/mensualidades/route.ts",
  "app/api/admin/mensualidades/[id]/route.ts",
];
// (M7.4) Toda ruta que ESCRIBE. El alta administrativa entra acá: crea una
// mensualidad, una compra, un movimiento y un ingreso.
const ESCRITURAS = [
  "app/api/admin/mensualidades/[id]/acciones/route.ts",
  "app/api/admin/mensualidades/nueva/route.ts",
];
// (M8A) El estado comercial se LEE con staff y se ESCRIBE solo con admin, así
// que la ruta expone los dos verbos y se comprueba aparte.
const VENTAS = "app/api/admin/mensualidades/ventas/route.ts";
const ESCRITURA = ESCRITURAS[0];
// (M7.4) Solo lee, pero es material de administración y lleva el teléfono del
// titular, así que exige admin igual.
const PREVIA = "app/api/admin/mensualidades/nueva/previa/route.ts";

// ── 1) Las lecturas: admin y staff, y SOLO lecturas ──
for (const ruta of LECTURAS) {
  const src = read(ruta);
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers, ["GET"], `${ruta}: solo expone GET`);
  assert.ok(/requireStaffOrAdmin\(\)/.test(src), `${ruta}: usa requireStaffOrAdmin`);
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), `${ruta}: corta si el guard falla`);
}

// ── 2) La escritura: admin y nada más ──
{
  const src = read(ESCRITURA);
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers, ["POST"], "acciones: solo expone POST");
  assert.ok(/requireAdmin\(\)/.test(src), "acciones: usa requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(src), "acciones: NO acepta staff");
  assert.ok(/if \(!auth\.ok\) return auth\.response/.test(src), "acciones: corta si el guard falla");
  // Segunda cerradura contra CSRF, además del SameSite=strict de la cookie.
  assert.ok(/isAllowedOrigin\(req\)/.test(src), "acciones: comprueba el origen");

  // El actor sale de la sesión, NUNCA del cuerpo: si se aceptara del body,
  // cualquiera podría firmar una acción con el nombre de otro.
  assert.ok(/actor: auth\.role/.test(src), "acciones: el actor sale de la sesión firmada");
  for (const prohibido of ["body.actor", "body.actor_rol", "body.rol", "body.mensualidad_id", "body.saldo"]) {
    assert.ok(!src.includes(prohibido), `acciones: NO acepta ${prohibido} del cuerpo`);
  }
}

// ── 3) NO hay ninguna otra ruta admin de Mensualidades sin guard ──
// Si mañana aparece un endpoint nuevo bajo esa carpeta, este test lo encuentra:
// no alcanza con que las tres rutas conocidas estén bien.
{
  const base = join(ROOT, "app/api/admin/mensualidades");
  const rutas: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name === "route.ts") rutas.push(p);
    }
  };
  recorrer(base);
  assert.equal(rutas.length, 6, `se esperaban 6 rutas admin de Mensualidades, hay ${rutas.length}`);
  for (const p of rutas) {
    const src = readFileSync(p, "utf8");
    assert.ok(
      /requireAdmin\(\)|requireStaffOrAdmin\(\)/.test(src),
      `${p}: toda ruta admin de Mensualidades tiene que pasar por un guard`,
    );
  }
}

// ── 4) El panel NO depende de la feature flag pública ──
// MENSUALIDADES_ENABLED oculta la experiencia del cliente. La administración
// tiene que poder trabajar ANTES del lanzamiento: si alguien la ata a la flag,
// el panel se apaga justo cuando más se lo necesita.
for (const ruta of [...LECTURAS, ...ESCRITURAS, PREVIA, VENTAS]) {
  const src = read(ruta);
  assert.ok(
    // Se busca el USO, no la mención: los comentarios explican justamente que
    // la flag no aplica acá, y eso no tiene que hacer fallar la guarda.
    !/mensualidadesHabilitadas\s*\(|process\.env\.MENSUALIDADES_ENABLED/.test(src),
    `${ruta}: la administración no se apaga con la flag pública`,
  );
}

// ── 2 bis) (M7.4) El alta administrativa: admin, origen y nada del cuerpo ──
{
  const src = read("app/api/admin/mensualidades/nueva/route.ts");
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers, ["POST"], "alta: solo expone POST");
  assert.ok(/requireAdmin\(\)/.test(src), "alta: usa requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(src), "alta: NO acepta staff");
  assert.ok(/isAllowedOrigin\(req\)/.test(src), "alta: comprueba el origen");
  assert.ok(/actor: auth\.role/.test(src), "alta: el actor sale de la sesión firmada");

  // Nada monetario ni identitario puede leerse del cuerpo. La ruta solo pasa
  // body al validador y la clave idempotente; el resto lo decide la base.
  for (const prohibido of [
    "body.actor", "body.actor_rol", "body.rol", "body.canal",
    "body.precio", "body.plan_precio", "body.importe_bruto", "body.comision",
    "body.minutos", "body.plan_minutos", "body.saldo_minutos",
    "body.vence_el", "body.vencimiento", "body.codigo",
    "body.mp_payment_id", "body.payment_id", "body.estado_pago", "body.procesamiento",
  ]) {
    assert.ok(!src.includes(prohibido), `alta: NO acepta ${prohibido} del cuerpo`);
  }

  // La previa es admin y POST: el teléfono es PII y no puede ir en la URL.
  const prev = read(PREVIA);
  const hPrev = [...prev.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(hPrev, ["POST"], "previa: es POST, no GET, porque lleva el teléfono");
  assert.ok(/requireAdmin\(\)/.test(prev), "previa: usa requireAdmin");
  assert.ok(!/requireStaffOrAdmin/.test(prev), "previa: NO acepta staff");

  // El módulo de servidor tiene su propia puerta, además de la de la ruta.
  const modulo = read("lib/mensualidadesAdminAlta.ts");
  assert.ok(/ctx\.rol !== "admin"/.test(modulo), "alta: el módulo también exige admin");
  assert.match(modulo, /MEDIOS_PAGO = \["efectivo", "qr", "debito", "credito"\]/,
    "alta: los medios de pago son una lista cerrada");
  assert.match(modulo, /MODALIDADES = \["venta", "cortesia"\]/,
    "alta: la modalidad es una lista cerrada");

  // La pantalla esconde el botón para staff, pero eso es cortesía visual.
  const cliente = read("app/admin/(panel)/mensualidades/MensualidadesAdminCliente.tsx");
  assert.match(cliente, /rol === "admin" && planes\.length > 0/,
    "alta: staff no ve la acción");
}

// ── 5) Las pantallas resuelven el rol en el servidor ──
for (const pagina of [
  "app/admin/(panel)/mensualidades/page.tsx",
  "app/admin/(panel)/mensualidades/[id]/page.tsx",
]) {
  const src = read(pagina);
  assert.ok(/getCurrentAdminRole\(\)/.test(src), `${pagina}: el rol lo resuelve el servidor`);
  assert.ok(/redirect\("\/admin\/login"\)/.test(src), `${pagina}: sin sesión, al login`);
  assert.ok(!/"use client"/.test(src), `${pagina}: es un server component`);
}

// ── 6) El código de acceso se gatea por rol en el SERVIDOR ──
// Está guardado en claro, así que el único control posible es no enviarlo.
{
  const src = read("lib/mensualidadesAdmin.ts");
  assert.ok(/rol === "admin" \? String\(m\.codigo\) : null/.test(src),
    "detalle: el código solo viaja para admin");
  assert.ok(/codigo_visible: rol === "admin"/.test(src));
  const detalleRuta = read("app/api/admin/mensualidades/[id]/route.ts");
  assert.ok(/auth\.role === "admin" \? await getAuditoria/.test(detalleRuta),
    "detalle: la auditoría solo viaja para admin");
}

console.log("mensualidadesM7Auth.test.ts OK (permisos en servidor, no en la interfaz)");

// ── 7) (M8A) El estado comercial: leer con staff, escribir solo con admin ──
{
  const src = read(VENTAS);
  const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(handlers.sort(), ["GET", "POST"], "ventas: expone leer y escribir, nada más");
  // La lectura es información operativa: quien atiende necesita saber si se está
  // vendiendo. La escritura es una decisión comercial y es solo de admin.
  assert.ok(/requireStaffOrAdmin\(\)/.test(src), "ventas: la lectura acepta staff");
  assert.ok(/requireAdmin\(\)/.test(src), "ventas: la escritura exige admin");
  assert.ok(/isAllowedOrigin\(req\)/.test(src), "ventas: la escritura comprueba el origen");
  assert.ok(/actor: auth\.role/.test(src), "ventas: el actor sale de la sesión firmada");
  for (const prohibido of ["body.actor", "body.actor_rol", "body.rol", "body.estado_anterior"]) {
    assert.ok(!src.includes(prohibido), `ventas: NO acepta ${prohibido} del cuerpo`);
  }
  // La pantalla esconde el botón para staff, pero eso es cortesía visual.
  const panel = read("app/admin/(panel)/mensualidades/EstadoComercial.tsx");
  assert.ok(/estado\.puedeEditar && rol === "admin"/.test(panel),
    "ventas: staff no ve el control modificable");
}

console.log("mensualidadesM7Auth.test.ts OK (M8A: estado comercial con permisos separados)");
