import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// Ejecutar: npx tsx lib/crmB1.test.ts
// CRM B1, puro (sin base):
//   1) armarDatosVisita: solo claves conocidas, vacíos y "false" fuera, autor y hora
//      solo de la administración, "tiene_whatsapp: false" conservado, necesidades
//      ordenadas y sin repetir;
//   2) canonico: misma visita con otro orden de claves → misma huella; otro contenido
//      → otra huella;
//   3) normalizarTexto: la misma regla que crm_normalizar_texto (la integración la
//      compara contra la base);
//   4) errores de las RPCs: códigos conocidos con status, campo acotado, nada de
//      Postgres hacia afuera;
//   5) pendientes de una jornada: NULL = sin cargar, 0 = cero confirmado;
//   6) borradores por usuario: clave propia por usuario y el cierre de sesión borra
//      todos los del prefijo; el formulario lee y escribe solo la clave del usuario.

async function main() {
  // crmB1Server crea el cliente de Supabase al importarse: destino inalcanzable, esta prueba no consulta nada.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sin-uso";
  const B = await import("@/lib/crmB1");
  const { huellaVisita } = await import("@/lib/crmB1Server");
  const U = "11111111-1111-4111-8111-111111111111";
  const J = "22222222-2222-4222-8222-222222222222";

  // ── 1) armarDatosVisita ────────────────────────────────────────────────
  {
    const cuerpo = {
      jornada_id: J, empresa_id: U, cerrado: false, hablo_con_empleado: true, hablo_con_responsable: false, interes: "",
      necesidades: ["sorteos", "fidelizacion", "sorteos", 3], observacion: "  algo  ", realizada_por: U, ocurrida_en: "2026-10-30T10:00:00-03:00",
      inventado: "x", huella: "y", contacto_nuevo: { nombre: " Ana ", telefono: "", tiene_whatsapp: false, es_decisor: "no_sabe", extra: 1 },
      empresa_nueva: { nombre_comercial: "  ", otra: 1 },
    };
    const c = B.armarDatosVisita(cuerpo, "comercial");
    assert.deepEqual(c, {
      jornada_id: J, empresa_id: U, hablo_con_empleado: true, necesidades: ["fidelizacion", "sorteos"], observacion: "algo",
      contacto_nuevo: { nombre: "Ana", tiene_whatsapp: false, es_decisor: "no_sabe" },
    }, "comercial: sin autor ni hora, sin vacíos ni false, sin claves ajenas; whatsapp=false se conserva");
    const a = B.armarDatosVisita(cuerpo, "admin");
    assert.equal(a.realizada_por, U, "admin fija quién la hizo");
    assert.equal(a.ocurrida_en, "2026-10-30T10:00:00-03:00", "admin fija la hora");
    assert.deepEqual(B.armarDatosVisita({ necesidades: [] }, "comercial"), {}, "necesidades vacías → sin clave");
    assert.deepEqual(B.armarDatosVisita(null, "comercial"), {}, "cuerpo inválido → vacío");
    assert.deepEqual(B.armarDatosVisita([1, 2], "admin"), {}, "arreglo → vacío");
    assert.deepEqual(B.armarDatosVisita({ contacto_nuevo: { tiene_whatsapp: true } }, "comercial"), { contacto_nuevo: { tiene_whatsapp: true } });
  }

  // ── 2) canónico y huella ───────────────────────────────────────────────
  {
    const x = B.armarDatosVisita({ jornada_id: J, empresa_id: U, hablo_con_responsable: true, interes: "tibio", necesidades: ["regalos", "redes"] }, "comercial");
    const y = B.armarDatosVisita({ necesidades: ["redes", "regalos"], interes: "tibio", hablo_con_responsable: true, empresa_id: U, jornada_id: J }, "comercial");
    assert.equal(B.canonico(x), B.canonico(y), "orden de claves y de necesidades no cambia el canónico");
    assert.equal(huellaVisita(x), huellaVisita(y), "misma visita, misma huella");
    assert.match(huellaVisita(x), /^[0-9a-f]{64}$/, "huella SHA-256 en hex");
    const z = B.armarDatosVisita({ ...y, interes: "caliente" }, "comercial");
    assert.notEqual(huellaVisita(x), huellaVisita(z), "otro contenido, otra huella");
    assert.equal(B.canonico({ b: [1, { d: null, c: "x" }], a: true }), '{"a":true,"b":[1,{"c":"x","d":null}]}');
  }

  // ── 3) normalización ──────────────────────────────────────────────────
  {
    for (const [entrada, salida] of [
      ["Peluquería  Ñandú", "peluqueria nandu"], ["  LUBRICENTRO El Güero!! ", "lubricentro el guero"], ["Av. Colón 1.234", "av colon 1 234"],
      ["", ""], [null, ""], ["---", ""], ["Façade", "facade"],
    ] as const) assert.equal(B.normalizarTexto(entrada), salida, `normalizar ${String(entrada)}`);
    assert.equal(B.enlaceWhatsapp("5493511234567"), "https://wa.me/5493511234567");
    assert.equal(B.enlaceWhatsapp("1234"), null, "número demasiado corto: sin enlace");
    assert.equal(B.enlaceWhatsapp(null), null);
  }

  // ── 4) errores ────────────────────────────────────────────────────────
  {
    assert.deepEqual(B.errorDeRpcCrm({ message: "clave_reutilizada" })?.status, 409);
    assert.equal(B.errorDeRpcCrm({ message: "empresa_no_encontrada" })?.status, 404, "negocio ajeno = no existe");
    assert.equal(B.errorDeRpcCrm({ message: "no_autorizado" })?.status, 403);
    assert.equal(B.errorDeRpcCrm({ message: "actor_invalido" })?.status, 401);
    const d = B.errorDeRpcCrm({ message: "datos_invalidos:km_final" })!;
    assert.equal(d.status, 400);
    assert.equal(d.campo, "km_final");
    assert.match(d.error, /km finales/);
    const raro = B.errorDeRpcCrm({ message: "datos_invalidos:<script>alert(1)</script>" })!;
    assert.equal(raro.campo, undefined, "un campo fuera de formato no se devuelve");
    assert.equal(B.errorDeRpcCrm({ code: "23505", message: 'duplicate key value violates unique constraint "crm_x"' }), null, "error de Postgres → null (500 genérico)");
    assert.equal(B.errorDeRpcCrm(null), null);
    assert.ok(B.esUuid(U) && !B.esUuid("x") && !B.esUuid(`${U} `));
  }

  // ── 5) pendientes de jornada ──────────────────────────────────────────
  {
    const base = { km_inicial: null, km_final: null, combustible_importe: null, estacionamiento_importe: null, peajes_importe: null, otros_importe: null };
    assert.deepEqual(B.pendientesJornada(base), ["km iniciales", "km finales", "combustible", "estacionamiento", "peajes", "otros gastos"]);
    assert.deepEqual(B.pendientesJornada({ km_inicial: 0, km_final: 12, combustible_importe: 0, estacionamiento_importe: 0, peajes_importe: 0, otros_importe: 0 }), [],
      "ceros confirmados no quedan pendientes");
    assert.deepEqual(B.pendientesJornada({ ...base, km_inicial: 100, combustible_importe: 0 }), ["km finales", "estacionamiento", "peajes", "otros gastos"]);
  }

  // ── 6) borradores por usuario ─────────────────────────────────────────
  {
    const V = "33333333-3333-4333-8333-333333333333";
    assert.notEqual(B.claveBorrador(U), B.claveBorrador(V), "cada usuario tiene su borrador");
    assert.ok(B.claveBorrador(U).startsWith(B.PREFIJO_BORRADOR) && B.claveBorrador(V).startsWith(B.PREFIJO_BORRADOR));
    const form = readFileSync("components/crm/FormularioVisita.tsx", "utf8");
    const accesos = [...form.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([A-Za-z]+\([^)]*\)|[^,)]+)/g)].map((m) => m[1].trim());
    assert.ok(accesos.length >= 3 && accesos.every((k) => k === "claveBorrador(usuarioId)"), `el formulario solo toca el borrador del usuario: ${accesos.join(", ")}`);
    assert.match(form, /modo === "comercial"\) guardarBorrador/, "solo la interfaz comercial guarda borradores");
    const salir = readFileSync("app/comercial/CerrarSesion.tsx", "utf8");
    assert.match(salir, /k\.startsWith\(PREFIJO_BORRADOR\)\) localStorage\.removeItem\(k\)/, "cerrar sesión borra los borradores");
    // Simulación del cambio de usuario en el mismo navegador.
    const almacen = new Map<string, string>([[B.claveBorrador(U), "{}"], [B.claveBorrador(V), "{}"], ["otra-cosa", "x"]]);
    for (const k of [...almacen.keys()]) if (k.startsWith(B.PREFIJO_BORRADOR)) almacen.delete(k);
    assert.deepEqual([...almacen.keys()], ["otra-cosa"], "al salir no queda ningún borrador y no se toca lo ajeno");
  }

  console.log("OK — crmB1 puro: armado de visitas, huella canónica, normalización, errores, pendientes de jornada y borradores por usuario.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
