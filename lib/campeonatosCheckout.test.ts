import { strict as assert } from "node:assert";
import {
  validarInscripcionPublica, montoDelCampeonato, estadoPublicoCheckout,
  nuevaExternalReference, nuevoTokenPublico, isoConOffset,
  PREFIJO_EXT_REF, TTL_CHECKOUT_MIN, GRACIA_CUPO_MS,
} from "@/lib/campeonatosCheckout";
import {
  mensajeConfirmacion, fechaLargaEs, horaCorta, horaPresentacion,
  MENSAJE_LIGA, MENSAJE_ELIMINACION_SIN_FECHA,
} from "@/lib/campeonatosMensajes";
import { getInscripcionCampos, campoVisible, faltantesRequeridos } from "@/lib/campeonatosInscripcionConfig";

// Tests PUROS del checkout de campeonatos: validación configurable, precio
// server-side, estado público del intento y mensajes derivados de la config.
// No tocan la base ni Mercado Pago.
//   npx tsx --env-file=.env.local lib/campeonatosCheckout.test.ts

// ── Fixtures: la MISMA config que tiene el campeonato real de eliminación ────
const DUELO = {
  id: "c1",
  nombre: "Duelo de Pilotos SIM",
  modalidad: "eliminacion",
  permite_pago_stand: false,
  precio_inscripcion: "20000.00",
  cupos_maximos: 32,
  fecha_inicio: "2026-09-19",
  config: {
    hora: "10:20",
    presentacion: { hora_inicio: "10:20", hora_limite: "10:40", tolerancia_min: 20 },
    requiere_escuderia: false,
    inscripcion: {
      campos: {
        nombre: "required", apellido: "required", telefono: "required",
        dni: "hidden", instagram: "hidden", escuderia: "hidden",
        categoria: "hidden", mejor_tiempo: "hidden", monto: "hidden",
      },
    },
  },
};

const LIGA = {
  id: "c2",
  nombre: "Campeonato SIM",
  modalidad: "liga",
  permite_pago_stand: true,
  precio_inscripcion: 40000,
  cupos_maximos: 0,
  fecha_inicio: "2026-07-01",
  config: {},
};

const base = {
  nombre: "Ana", apellido: "Pérez", telefono: "3515123456",
  acepto_condiciones: true,
};

// ── Mensaje final: sale de la CONFIG, nunca del nombre del campeonato ────────

// El caso de Duelo hoy: 19/09/2026 + 10:20 hs.
assert.equal(
  mensajeConfirmacion(DUELO, 2026),
  "¡Listo! Te esperamos el 19 de septiembre a las 10:20 hs en SIM Argentina para correr el campeonato.",
);
// No aparece nada del sistema viejo de liga.
for (const viejo of ["tanda clasificatoria", "categoría competitiva", "acercarte al stand"]) {
  assert.ok(!mensajeConfirmacion(DUELO, 2026).includes(viejo), `Duelo no debe decir "${viejo}"`);
}

// Mismo campeonato con OTRA fecha y OTRA hora → otro mensaje, sin tocar código.
assert.equal(
  mensajeConfirmacion({ ...DUELO, fecha_inicio: "2027-03-07", config: { ...DUELO.config, presentacion: { hora_inicio: "18:00" } } }, 2026),
  "¡Listo! Te esperamos el 7 de marzo de 2027 a las 18:00 hs en SIM Argentina para correr el campeonato.",
);
// Sin hora configurada: se informa solo el día.
assert.equal(
  mensajeConfirmacion({ ...DUELO, config: { requiere_escuderia: false } }, 2026),
  "¡Listo! Te esperamos el 19 de septiembre en SIM Argentina para correr el campeonato.",
);
// Sin fecha: no se inventa un día.
assert.equal(mensajeConfirmacion({ ...DUELO, fecha_inicio: null }, 2026), MENSAJE_ELIMINACION_SIN_FECHA);

// Liga: conserva EXACTAMENTE la instrucción histórica.
assert.equal(mensajeConfirmacion(LIGA, 2026), MENSAJE_LIGA);
assert.ok(MENSAJE_LIGA.includes("tanda clasificatoria"));

// Override explícito del admin: gana sobre todo lo demás, en cualquier modalidad.
assert.equal(
  mensajeConfirmacion({ ...DUELO, config: { ...DUELO.config, inscripcion: { mensaje_confirmacion: "  Nos vemos en el box.  " } } }, 2026),
  "Nos vemos en el box.",
);
assert.equal(
  mensajeConfirmacion({ ...LIGA, config: { inscripcion: { mensaje_confirmacion: "Texto de liga propio" } } }, 2026),
  "Texto de liga propio",
);

// Formateo de fecha y hora.
assert.equal(fechaLargaEs("2026-09-19", 2026), "19 de septiembre");
assert.equal(fechaLargaEs("2026-01-05", 2026), "5 de enero");
assert.equal(fechaLargaEs("2027-12-31", 2026), "31 de diciembre de 2027");
assert.equal(fechaLargaEs("19/09/2026", 2026), null);
assert.equal(fechaLargaEs(null, 2026), null);
assert.equal(horaCorta("10:20"), "10:20");
assert.equal(horaCorta("10:20:00"), "10:20");
assert.equal(horaCorta("9:05"), "09:05");
assert.equal(horaCorta("25:00"), null);
assert.equal(horaCorta(""), null);
// presentacion.hora_inicio manda sobre config.hora.
assert.equal(horaPresentacion({ config: { hora: "11:00", presentacion: { hora_inicio: "10:20" } } }), "10:20");
assert.equal(horaPresentacion({ config: { hora: "11:00" } }), "11:00");
assert.equal(horaPresentacion({ config: {} }), null);

// ── Precio: SIEMPRE del servidor ────────────────────────────────────────────
assert.equal(montoDelCampeonato(DUELO), 20000);
assert.equal(montoDelCampeonato(LIGA), 40000);
assert.equal(montoDelCampeonato({ ...DUELO, precio_inscripcion: 0 }), null);
assert.equal(montoDelCampeonato({ ...DUELO, precio_inscripcion: null }), null);
// Lo que mande el navegador en `monto` no se lee en ningún momento.
assert.equal(montoDelCampeonato({ ...DUELO, precio_inscripcion: "20000.00" }), 20000);

// ── Validación configurable ─────────────────────────────────────────────────

// Duelo: DNI y escudería OCULTOS → no se exigen y no se persisten aunque lleguen.
const okDuelo = validarInscripcionPublica(base, DUELO);
assert.ok(okDuelo.ok);
assert.equal(okDuelo.data.datos.dni, "");
assert.equal(okDuelo.data.datos.escuderia_favorita, null);
assert.equal(okDuelo.data.datos.instagram, null);
assert.equal(okDuelo.data.datos.metodoStand, false);

const conBasura = validarInscripcionPublica(
  { ...base, dni: "12345678", escuderia_favorita: "Ferrari", instagram: "@x" }, DUELO,
);
assert.ok(conBasura.ok);
assert.equal(conBasura.data.datos.dni, "", "un campo oculto nunca se persiste");
assert.equal(conBasura.data.datos.escuderia_favorita, null);

// Duelo: teléfono requerido.
assert.equal(validarInscripcionPublica({ ...base, telefono: "" }, DUELO).ok, false);
assert.equal(validarInscripcionPublica({ ...base, telefono: "abc" }, DUELO).ok, false);

// Condiciones sin aceptar y datos mínimos.
assert.equal(validarInscripcionPublica({ ...base, acepto_condiciones: false }, DUELO).ok, false);
assert.equal(validarInscripcionPublica({ ...base, acepto_condiciones: "true" }, DUELO).ok, false);
assert.equal(validarInscripcionPublica({ ...base, nombre: "" }, DUELO).ok, false);
assert.equal(validarInscripcionPublica({ ...base, apellido: "  " }, DUELO).ok, false);
assert.equal(validarInscripcionPublica({ ...base, nombre: "x".repeat(61) }, DUELO).ok, false);
assert.equal(validarInscripcionPublica({ ...base, nombre: "Ana" }, DUELO).ok, false);

// permite_pago_stand = false → el stand se rechaza SERVER-SIDE aunque el
// navegador lo mande a mano.
const standProhibido = validarInscripcionPublica({ ...base, metodo_pago_inscripcion: "stand" }, DUELO);
assert.equal(standProhibido.ok, false);
assert.equal((standProhibido as { status: number }).status, 400);

// Liga: DNI requerido (preset liga) y stand permitido.
assert.equal(validarInscripcionPublica(base, LIGA).ok, false, "liga exige DNI");

// Escudería en LIGA: VISIBLE pero OPCIONAL. La obligatoriedad sale solo de
// config.inscripcion.campos — la misma fuente que usa el alta del admin—, no de
// la modalidad. Una inscripción de liga sin escudería tiene que ser válida.
const camposLiga = getInscripcionCampos(LIGA);
assert.equal(camposLiga.escuderia, "optional");
assert.equal(campoVisible(camposLiga, "escuderia"), true, "en liga la escudería se muestra");
const ligaSinEscuderia = validarInscripcionPublica({ ...base, dni: "30111222" }, LIGA);
assert.ok(ligaSinEscuderia.ok, "liga SIN escudería tiene que ser válida");
assert.equal(ligaSinEscuderia.data.datos.escuderia_favorita, null);
// Público y admin coinciden: ninguno la reclama.
assert.deepEqual(faltantesRequeridos(camposLiga, { ...base, dni: "30111222" }), []);
// Pero si un campeonato la marca required, se sigue exigiendo en los dos lados.
const LIGA_ESC_REQ = { ...LIGA, config: { inscripcion: { campos: { escuderia: "required" } } } };
assert.equal(
  validarInscripcionPublica({ ...base, dni: "30111222" }, LIGA_ESC_REQ).ok, false,
  "escuderia required sí se exige",
);
assert.deepEqual(
  faltantesRequeridos(getInscripcionCampos(LIGA_ESC_REQ), { ...base, dni: "30111222" }), ["Escudería"],
);

const ligaOk = validarInscripcionPublica(
  { ...base, dni: "30111222", escuderia_favorita: "Ferrari", metodo_pago_inscripcion: "stand" }, LIGA,
);
assert.ok(ligaOk.ok);
assert.equal(ligaOk.data.datos.metodoStand, true);
assert.equal(ligaOk.data.datos.dni, "30111222");
assert.equal(ligaOk.data.datos.escuderia_favorita, "Ferrari");

// Idempotency key: se acepta la del cliente si es sana; si no, se genera una.
const conKey = validarInscripcionPublica({ ...base, idempotency_key: "abc-123_XYZ" }, DUELO);
assert.ok(conKey.ok);
assert.equal(conKey.data.datos.idempotencyKey, "abc-123_XYZ");
const keySucia = validarInscripcionPublica({ ...base, idempotency_key: "drop table;" }, DUELO);
assert.ok(keySucia.ok);
assert.notEqual(keySucia.data.datos.idempotencyKey, "drop table;");
assert.ok(keySucia.data.datos.idempotencyKey.length >= 16);

// ── Estado público del intento ──────────────────────────────────────────────
const FUTURO = new Date(Date.now() + 10 * 60_000).toISOString();
const PASADO = new Date(Date.now() - 10 * 60_000).toISOString();

// Solo la base aprobada confirma. Un 'approved' de Mercado Pago sin inscripción
// creada NO alcanza para decir "confirmado".
assert.equal(estadoPublicoCheckout({ estado: "aprobado", mp_status: "approved", expira_el: PASADO }), "confirmado");
assert.equal(estadoPublicoCheckout({ estado: "pendiente", mp_status: null, expira_el: FUTURO }), "pendiente");
assert.equal(estadoPublicoCheckout({ estado: "pendiente", mp_status: "pending", expira_el: PASADO }), "pendiente");
assert.equal(estadoPublicoCheckout({ estado: "pendiente", mp_status: "in_process", expira_el: PASADO }), "pendiente");
assert.equal(estadoPublicoCheckout({ estado: "pendiente", mp_status: "rejected", expira_el: FUTURO }), "rechazado");
assert.equal(estadoPublicoCheckout({ estado: "pendiente", mp_status: "cancelled", expira_el: FUTURO }), "rechazado");
assert.equal(estadoPublicoCheckout({ estado: "sin_cupo", mp_status: "approved", expira_el: PASADO }), "sin_cupo");

// Recién vencido y sin noticias: NO se le dice que falló, porque el aviso de un
// pago hecho sobre el final de la ventana puede estar en camino.
const RECIEN_VENCIDO = new Date(Date.now() - 60_000).toISOString();
assert.equal(
  estadoPublicoCheckout({ estado: "pendiente", mp_status: null, expira_el: RECIEN_VENCIDO }), "pendiente",
  "dentro de la gracia se sigue confirmando",
);
const MUY_VIEJO = new Date(Date.now() - (GRACIA_CUPO_MS + 60_000)).toISOString();
assert.equal(estadoPublicoCheckout({ estado: "pendiente", mp_status: null, expira_el: MUY_VIEJO }), "expirado");

// ── Credenciales opacas ─────────────────────────────────────────────────────
const extRef = nuevaExternalReference();
assert.ok(extRef.startsWith(PREFIJO_EXT_REF));
assert.notEqual(extRef, nuevaExternalReference(), "no puede ser predecible");
// Sin PII: nada del formulario viaja en el external_reference.
assert.ok(!/ana|perez|3515/i.test(extRef));
const token = nuevoTokenPublico();
assert.match(token, /^[A-Za-z0-9_-]{24,64}$/);
assert.notEqual(token, nuevoTokenPublico());

// Vencimiento con offset explícito, como lo espera Mercado Pago.
assert.match(isoConOffset(new Date("2026-09-15T13:40:00.000Z")), /\+00:00$/);
assert.ok(TTL_CHECKOUT_MIN >= 15 && TTL_CHECKOUT_MIN <= 20);

console.log("campeonatosCheckout.test.ts OK");
