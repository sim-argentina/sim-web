import { strict as assert } from "node:assert";
import {
  CANALES_BAJA,
  TIPOS_EVIDENCIA,
  errorDeRpc,
  eventoParaListado,
  instanteDeOrigen,
  telefonoDeConsulta,
  validarAccionPanel,
  validarAccionTexto,
  validarAltaPublica,
  validarBajaPublica,
  type EventoDto,
} from "@/lib/marketing/consentimiento";
import { huellaIp } from "@/lib/marketing/huellaIp";

// Marketing · consentimiento y bajas — contrato puro (Etapa 3). Sin base, sin red.
// Ejecutar: npx tsx lib/marketing/consentimiento.test.ts
// Argentina = UTC−3 todo el año. Teléfonos sintéticos 35155501xx.

globalThis.fetch = (() => {
  throw new Error("red prohibida en las pruebas de consentimiento");
}) as typeof fetch;

const K = "2f1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const H = "a".repeat(64);
const codigo = (r: { ok: boolean; e?: { codigo: string; campo?: string } }) =>
  r.ok ? "ok" : `${r.e!.codigo}${r.e!.campo ? `:${r.e!.campo}` : ""}`;
// 19/10/2026 23:30 en Argentina (en UTC ya es el 20/10).
const NOCHE_19 = new Date("2026-10-20T02:30:00Z");

// ── 1. Alta pública ─────────────────────────────────────────────────────────
{
  const base = { idempotency_key: K, telefono: "+54 9 351 555-0101", acepto: true, texto_version: "promos-v1", texto_huella: H };
  const r = validarAltaPublica({ ...base, nombre: "  Ana   López ", localidad: " Villa  Allende ", sitio: "" });
  assert.ok(r.ok);
  assert.deepEqual(r.valor, {
    clave: K,
    bot: false,
    datos: {
      tipo: "alta", fuente: "formulario_web", telefono: "3515550101", texto_version: "promos-v1", texto_huella: H,
      nombre: "Ana López", localidad: "Villa Allende",
    },
  });
  const vacios = validarAltaPublica({ ...base, nombre: "", localidad: "   " });
  assert.ok(vacios.ok && vacios.valor.datos.nombre === null && vacios.valor.datos.localidad === null, "vacío = sin dato");
  assert.equal(codigo(validarAltaPublica({ ...base, acepto: false })), "falta_aceptacion", "la casilla tiene que estar marcada");
  assert.equal(codigo(validarAltaPublica({ ...base, acepto: "true" })), "falta_aceptacion", "solo el booleano true");
  assert.equal(codigo(validarAltaPublica({ ...base, telefono: "12345" })), "telefono_invalido");
  assert.equal(codigo(validarAltaPublica({ ...base, telefono: "+1 305 555 0101" })), "telefono_invalido");
  assert.equal(codigo(validarAltaPublica({ ...base, telefono: 3515550101 })), "telefono_invalido");
  assert.equal(codigo(validarAltaPublica({ ...base, idempotency_key: "x" })), "campo_invalido:idempotency_key");
  assert.equal(codigo(validarAltaPublica({ ...base, texto_huella: "abc" })), "campo_invalido:texto_huella");
  assert.equal(codigo(validarAltaPublica({ ...base, texto_version: "Promos V1" })), "campo_invalido:texto_version");
  assert.equal(codigo(validarAltaPublica({ ...base, localidad: "X" })), "campo_invalido:localidad");
  assert.equal(codigo(validarAltaPublica({ ...base, nombre: "n".repeat(81) })), "campo_invalido:nombre");
  assert.equal(codigo(validarAltaPublica({ ...base, rol: "admin" })), "campo_desconocido:rol", "el cliente no decide autoridad");
  assert.equal(codigo(validarAltaPublica({ ...base, fuente: "admin_evidencia" })), "campo_desconocido:fuente");
  assert.equal(codigo(validarAltaPublica([])), "datos_invalidos");
  assert.equal(codigo(validarAltaPublica(null)), "datos_invalidos");
  // Trampa para bots: se valida igual, pero se marca.
  const bot = validarAltaPublica({ ...base, sitio: "https://spam.example" });
  assert.ok(bot.ok && bot.valor.bot);
  const bot2 = validarAltaPublica({ ...base, sitio: 1 });
  assert.ok(bot2.ok && bot2.valor.bot, "un valor que no es texto también delata al bot");
  const humano = validarAltaPublica(base);
  assert.ok(humano.ok && !humano.valor.bot);
}

// ── 2. Baja pública ─────────────────────────────────────────────────────────
{
  const r = validarBajaPublica({ idempotency_key: K, telefono: "0351 15 555-0101" });
  assert.ok(r.ok);
  assert.deepEqual(r.valor.datos, { tipo: "baja", fuente: "formulario_web", telefono: "3515550101" });
  assert.equal(codigo(validarBajaPublica({ idempotency_key: K, telefono: "3515550101", nombre: "Ana" })), "campo_desconocido:nombre");
  assert.equal(codigo(validarBajaPublica({ idempotency_key: K, telefono: "" })), "telefono_invalido");
}

// ── 3. Fecha de origen conservadora, en hora de Argentina ───────────────────
{
  assert.deepEqual(instanteDeOrigen(undefined, "alta", NOCHE_19), { ok: true, valor: undefined });
  assert.deepEqual(instanteDeOrigen("2026-10-19", "baja", NOCHE_19), { ok: true, valor: undefined }, "hoy en Argentina = ahora");
  assert.equal(codigo(instanteDeOrigen("2026-10-20", "baja", NOCHE_19)), "campo_invalido:ocurrido_en", "en UTC ya es el 20, pero es futuro");
  assert.deepEqual(instanteDeOrigen("2026-10-18", "alta", NOCHE_19), { ok: true, valor: "2026-10-18T00:00:00.000-03:00" });
  assert.deepEqual(instanteDeOrigen("2026-10-18", "baja", NOCHE_19), { ok: true, valor: "2026-10-18T23:59:59.999-03:00" });
  assert.ok(instanteDeOrigen("2025-10-19", "alta", NOCHE_19).ok, "365 días atrás vale");
  assert.equal(codigo(instanteDeOrigen("2025-10-18", "alta", NOCHE_19)), "campo_invalido:ocurrido_en");
  assert.equal(codigo(instanteDeOrigen("2026-02-30", "alta", NOCHE_19)), "campo_invalido:ocurrido_en");
  assert.equal(codigo(instanteDeOrigen("18/10/2026", "alta", NOCHE_19)), "campo_invalido:ocurrido_en");
}

// ── 4. Acciones del panel ───────────────────────────────────────────────────
{
  const baja = { accion: "baja", idempotency_key: K, telefono: "351 555 0101", canal: "presencial" };
  const rb = validarAccionPanel({ ...baja, nota: " pidió   no recibir ", fecha_origen: "2026-10-18" }, "staff", NOCHE_19);
  assert.ok(rb.ok);
  assert.deepEqual(rb.valor.datos, {
    tipo: "baja", fuente: "admin_pedido", telefono: "3515550101",
    evidencia: { canal: "presencial", nota: "pidió no recibir" }, ocurrido_en: "2026-10-18T23:59:59.999-03:00",
  });
  assert.equal(codigo(validarAccionPanel({ ...baja, canal: "sms" }, "staff", NOCHE_19)), "campo_invalido:canal");
  assert.equal(codigo(validarAccionPanel({ ...baja, nombre: "Ana" }, "admin", NOCHE_19)), "campo_desconocido:nombre");
  assert.equal(codigo(validarAccionPanel({ ...baja, nota: "x".repeat(301) }, "admin", NOCHE_19)), "campo_invalido:nota");
  assert.equal(codigo(validarAccionPanel({ ...baja, accion: "borrar" }, "admin", NOCHE_19)), "accion_invalida");
  for (const c of CANALES_BAJA) assert.ok(validarAccionPanel({ ...baja, canal: c.valor }, "staff", NOCHE_19).ok);

  const alta = {
    accion: "alta", idempotency_key: K, telefono: "3515550102", texto_version: "promos-v1",
    tipo_evidencia: "papel_firmado", referencia: " Planilla  del stand 18/10 ",
  };
  assert.equal(codigo(validarAccionPanel(alta, "staff", NOCHE_19)), "solo_admin", "staff no carga altas");
  const ra = validarAccionPanel({ ...alta, fecha_origen: "2026-10-18", nombre: "Beto" }, "admin", NOCHE_19);
  assert.ok(ra.ok);
  assert.deepEqual(ra.valor.datos, {
    tipo: "alta", fuente: "admin_evidencia", telefono: "3515550102", texto_version: "promos-v1",
    nombre: "Beto", localidad: null,
    evidencia: { tipo: "papel_firmado", referencia: "Planilla del stand 18/10" }, ocurrido_en: "2026-10-18T00:00:00.000-03:00",
  });
  assert.equal(codigo(validarAccionPanel({ ...alta, referencia: "  " }, "admin", NOCHE_19)), "campo_invalido:referencia", "la evidencia es obligatoria");
  assert.equal(codigo(validarAccionPanel({ ...alta, referencia: "ab" }, "admin", NOCHE_19)), "campo_invalido:referencia");
  assert.equal(codigo(validarAccionPanel({ ...alta, tipo_evidencia: "verbal" }, "admin", NOCHE_19)), "campo_invalido:tipo_evidencia", "un 'me dijo que sí' no es evidencia");
  assert.equal(codigo(validarAccionPanel({ ...alta, canal: "presencial" }, "admin", NOCHE_19)), "campo_desconocido:canal");
  for (const t of TIPOS_EVIDENCIA) assert.ok(validarAccionPanel({ ...alta, tipo_evidencia: t.valor }, "admin", NOCHE_19).ok);
}

// ── 5. Textos y consulta ────────────────────────────────────────────────────
{
  assert.deepEqual(validarAccionTexto({ accion: "publicar", version: "promos-v1" }), { ok: true, valor: { accion: "publicar", version: "promos-v1" } });
  assert.equal(codigo(validarAccionTexto({ accion: "editar", version: "promos-v1" })), "accion_invalida");
  assert.equal(codigo(validarAccionTexto({ accion: "retirar", version: "../x" })), "campo_invalido:version");
  assert.equal(codigo(validarAccionTexto({ accion: "retirar", version: "promos-v1", texto: "otro" })), "campo_desconocido:texto");
  assert.deepEqual(telefonoDeConsulta(null), { ok: true, valor: null });
  assert.deepEqual(telefonoDeConsulta("  "), { ok: true, valor: null });
  assert.deepEqual(telefonoDeConsulta("+54 9 11 5555-0101"), { ok: true, valor: "1155550101" });
  assert.equal(codigo(telefonoDeConsulta("123")), "telefono_invalido");
}

// ── 6. Errores de la base → respuesta, sin filtrar detalles internos ────────
{
  assert.equal(errorDeRpc({ code: "PGRST205", message: "Could not find the table" })?.codigo, "modulo_no_instalado");
  assert.equal(errorDeRpc({ code: "42883", message: "function does not exist" })?.status, 503);
  assert.deepEqual(errorDeRpc({ code: "22023", message: "campo_invalido:evidencia.referencia" }), {
    status: 400, codigo: "campo_invalido", error: "Revisá el dato marcado.", campo: "evidencia.referencia",
  });
  assert.equal(errorDeRpc({ code: "22023", message: "campo_invalido:<script>" })?.campo, undefined, "un detalle raro no viaja");
  assert.equal(errorDeRpc({ code: "55000", message: "baja_vigente" })?.status, 409);
  assert.equal(errorDeRpc({ code: "55000", message: "texto_desactualizado" })?.status, 409);
  assert.equal(errorDeRpc({ code: "55000", message: "consentimiento_no_habilitado" })?.status, 503);
  assert.equal(errorDeRpc({ code: "23505", message: "idempotency_key_con_otro_payload" })?.status, 409);
  assert.equal(errorDeRpc({ code: "42501", message: "fuente_no_permitida" })?.status, 403);
  assert.equal(errorDeRpc({ code: "XX000", message: "relation secret_table blew up" }), null, "lo inesperado es 500 genérico");
  assert.equal(errorDeRpc(null), null);
}

// ── 7. Listados: teléfono enmascarado y sin datos personales ────────────────
{
  const e: EventoDto = {
    id: "e1", telefono: "3515550101", tipo: "alta", fuente: "formulario_web", actor_rol: "publico", texto_version: "promos-v1",
    nombre: "Ana López", localidad: "Córdoba", evidencia: { pagina: "/promos", ip_hash: "0".repeat(32) },
    ocurrido_en: "2026-10-19T12:00:00Z", registrado_en: "2026-10-19T12:00:00Z",
  };
  const l = eventoParaListado(e);
  assert.equal(l.telefono, "351*****01");
  assert.equal(l.nombre, null);
  assert.equal(l.localidad, null);
  assert.deepEqual(l.evidencia, {});
  assert.equal(e.nombre, "Ana López", "no muta el original");
}

// ── 8. Huella de IP: estable, sin la IP y sin secreto no hay huella ─────────
{
  const env = { ADMIN_SESSION_SECRET: "secreto-de-prueba" };
  const a = huellaIp("200.1.2.3", env);
  assert.match(a ?? "", /^[0-9a-f]{32}$/);
  assert.equal(huellaIp("200.1.2.3", env), a);
  assert.notEqual(huellaIp("200.1.2.4", env), a);
  assert.notEqual(huellaIp("200.1.2.3", { ADMIN_SESSION_SECRET: "otro" }), a);
  assert.ok(!(a ?? "").includes("200"));
  assert.equal(huellaIp("200.1.2.3", {}), undefined);
  assert.equal(huellaIp("unknown", env), undefined);
}

console.log("consentimiento: ok");
