import { strict as assert } from "node:assert";
import {
  CAMPOS_PROHIBIDOS, ETIQUETAS, LIMITES, MOTIVOS, RANGOS_ETARIOS, TIPOS_GRUPO, cambiosDeEdicion, coincideBusqueda, codificarCursor, decodificarCursor, dtoInteraccion, errorDeRpc,
  instanteDeParedSim, minimoDeclarableStaff, paredSim,
  fechaSim, horaSim, instanteValido, minutoLocal, normalizarIdTurno, pagoContradictorio, permisosPara,
  staffPuedeCorregir, staffPuedeDeclarar, esFuturo, validarCuerpoAlta, validarCuerpoAnulacion, validarCuerpoCierre, validarCuerpoEliminacion,
  validarCuerpoEdicion, validarCuerpoVinculo, validarDatos, validarDesvinculo, validarFiltrosListado,
  validarParamsVinculables, ventanaVinculables, type DetalleBase,
} from "@/lib/interacciones";

// Interacciones del stand · contrato puro (Bloque 2). Sin base, sin red.
// Ejecutar: npx tsx lib/interacciones.test.ts
// Córdoba = UTC−3 todo el año: 03:00Z es la medianoche de SIM.

const K = "2f1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const err = <T>(r: { ok: true; valor: T } | { ok: false; e: { codigo: string; campo?: string; status: number } }) =>
  r.ok ? "ok" : `${r.e.status}:${r.e.codigo}${r.e.campo ? `:${r.e.campo}` : ""}`;

async function main() {
  // ── 1. IDs bigint: siempre cadena, sin perder precisión ───────────────────
  {
    assert.equal(normalizarIdTurno("2138"), "2138");
    assert.equal(normalizarIdTurno("-910001"), "-910001");
    assert.equal(normalizarIdTurno("9007199254740993"), "9007199254740993", "por encima de 2^53, intacto");
    assert.equal(normalizarIdTurno("9223372036854775807"), "9223372036854775807", "máximo int8");
    for (const malo of [2138, "9223372036854775808", "-9223372036854775809", "012", "+5", "1e3", "1.0", " 5", "", "-0", null, undefined, "abc"]) {
      assert.equal(normalizarIdTurno(malo), null, `${JSON.stringify(malo)} no es un id válido`);
    }
    assert.equal(err(validarCuerpoVinculo({ version: 1, turnos: [2138] })), "400:campo_invalido:turnos", "un número de JSON se rechaza");
    assert.equal(err(validarCuerpoVinculo({ version: 1, turnos: ["1", "1"] })), "400:turnos_repetidos");
    assert.equal(err(validarCuerpoVinculo({ version: 1, turnos: ["1", "2", "3", "4", "5"] })), "400:maximo_turnos_por_interaccion_pedido");
    assert.equal(err(validarCuerpoVinculo({ version: 1, turnos: [] })), "400:campo_invalido:turnos");
    const v = validarCuerpoVinculo({ version: 3, turnos: ["9007199254740993"] });
    assert.ok(v.ok && v.valor.turnos[0] === "9007199254740993");
  }

  // ── 2. Alta: obligatorios, anulables, desconocidos y autoridad ────────────
  {
    const base = { idempotency_key: K, datos: { resultado: "miro", personas_grupo: 1 } };
    const ok = validarCuerpoAlta(base);
    assert.ok(ok.ok && ok.valor.turnos.length === 0 && ok.valor.datos.resultado === "miro");
    assert.equal(err(validarCuerpoAlta({ ...base, idempotency_key: "x" })), "400:campo_invalido:idempotency_key");
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { personas_grupo: 1 } })), "400:campo_invalido:resultado");
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { resultado: "miro" } })), "400:campo_invalido:personas_grupo");
    for (const p of [0, 51, 2.5, "3"]) {
      assert.equal(err(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: p } })), "400:campo_invalido:personas_grupo", `personas ${p}`);
    }
    // Atributos de autoridad: arriba o dentro de datos → 400, nunca se ignoran.
    for (const k of ["rol", "registrada_por_rol", "actualizada_por_rol", "anulada_por_rol", "cerrada_por_rol"]) {
      assert.equal(err(validarCuerpoAlta({ ...base, [k]: "admin" })), `400:campo_no_permitido:${k}`);
      assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, [k]: "admin" } })), `400:campo_no_permitido:${k}`);
    }
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, nombre: "Juan" } })), "400:campo_no_permitido:nombre");
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, telefono: "351" } })), "400:campo_no_permitido:telefono");
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, edad: 30 } })), "400:campo_desconocido:edad");
    assert.equal(err(validarCuerpoAlta({ ...base, extra: 1 })), "400:campo_desconocido:extra");
    assert.ok(CAMPOS_PROHIBIDOS.includes("rol"));
    // Desglose: los dos o ninguno, y suma el total.
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: 3, hombres: 2 } })), "400:desglose_incompleto");
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: 3, hombres: 2, mujeres: 2 } })), "400:desglose_no_suma");
    assert.ok(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: 3, hombres: 2, mujeres: 1 } }).ok);
    assert.ok(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: 3, hombres: null, mujeres: null } }).ok);
    assert.ok(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: 3, hombres: null } }).ok, "hombres null solo = sin desglose");
    // Motivo: nunca con "subio"; sí (opcional) con miro/pregunto.
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { resultado: "subio", personas_grupo: 1, motivo: "precio" } })), "400:motivo_no_aplica");
    assert.ok(validarCuerpoAlta({ ...base, datos: { resultado: "miro", personas_grupo: 1, motivo: "tiempo" } }).ok);
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { resultado: "pregunto", personas_grupo: 1, motivo: "caro" } })), "400:campo_invalido:motivo");
    // Turnos solo con "subio".
    assert.equal(err(validarCuerpoAlta({ ...base, turnos: ["1"] })), "400:resultado_no_admite_vinculos");
    assert.ok(validarCuerpoAlta({ ...base, datos: { resultado: "subio", personas_grupo: 2 }, turnos: ["1", "2"] }).ok);
    // ocurrida_en: ISO con zona, o null (= ahora).
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, ocurrida_en: "2026-10-18 10:00" } })), "400:campo_invalido:ocurrida_en");
    assert.ok(validarCuerpoAlta({ ...base, datos: { ...base.datos, ocurrida_en: "2026-10-18T10:00:00-03:00" } }).ok);
    assert.ok(validarCuerpoAlta({ ...base, datos: { ...base.datos, ocurrida_en: null } }).ok);
    // Observaciones: se recortan; vacías = null; > 500 → 400.
    const o = validarCuerpoAlta({ ...base, datos: { ...base.datos, observaciones: "  caro \n" } });
    assert.ok(o.ok && o.valor.datos.observaciones === "caro");
    const vac = validarCuerpoAlta({ ...base, datos: { ...base.datos, observaciones: "   " } });
    assert.ok(vac.ok && vac.valor.datos.observaciones === null);
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, observaciones: "x".repeat(501) } })), "400:campo_invalido:observaciones");
    assert.equal(err(validarCuerpoAlta({ ...base, datos: { ...base.datos, atendio_empleado_id: "Juan" } })), "400:campo_invalido:atendio_empleado_id");
  }

  // ── 3. Edición parcial: lo omitido no cambia, null vacía, sin borrados silenciosos ──
  {
    const r = validarCuerpoEdicion({ version: 2, cambios: { rango_etario: "25_34" } });
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.valor.cambios, { rango_etario: "25_34" }, "solo la clave enviada");
    assert.equal(r.ok && r.valor.confirmar_liberacion, false);
    const n = validarCuerpoEdicion({ version: 2, cambios: { observaciones: null, motivo: null } });
    assert.deepEqual(n.ok && n.valor.cambios, { observaciones: null, motivo: null });
    assert.equal(err(validarCuerpoEdicion({ version: 2, cambios: {} })), "400:datos_invalidos");
    assert.equal(err(validarCuerpoEdicion({ cambios: { personas_grupo: 2 } })), "400:campo_invalido:version");
    assert.equal(err(validarCuerpoEdicion({ version: 0, cambios: { personas_grupo: 2 } })), "400:campo_invalido:version");
    assert.equal(err(validarCuerpoEdicion({ version: 1, cambios: { hombres: 1 } })), "400:desglose_incompleto", "el desglose cambia de a par");
    assert.equal(err(validarCuerpoEdicion({ version: 1, cambios: { ocurrida_en: null } })), "400:campo_invalido:ocurrida_en");
    assert.equal(err(validarCuerpoEdicion({ version: 1, cambios: { resultado: "subio", motivo: "precio" } })), "400:motivo_no_aplica");
    assert.ok(validarCuerpoEdicion({ version: 1, cambios: { resultado: "subio", motivo: null } }).ok);
    assert.equal(err(validarCuerpoEdicion({ version: 1, cambios: { registrada_por_rol: "admin" } })), "400:campo_no_permitido:registrada_por_rol");
    assert.equal(err(validarCuerpoEdicion({ version: 1, rol: "admin", cambios: { personas_grupo: 2 } })), "400:campo_no_permitido:rol");
    assert.equal(err(validarCuerpoEdicion({ version: 1, cambios: { personas_grupo: 2 }, confirmar_liberacion: "si" })), "400:campo_invalido:confirmar_liberacion");
  }

  // ── 4. Anulación, cierre y desvínculo ────────────────────────────────────
  {
    assert.ok(validarCuerpoAnulacion({ version: 1 }).ok);
    const a = validarCuerpoAnulacion({ version: 1, motivo: "  duplicada " });
    assert.ok(a.ok && a.valor.motivo === "duplicada");
    assert.equal(err(validarCuerpoAnulacion({ version: 1, motivo: "x".repeat(201) })), "400:campo_invalido:motivo");
    assert.ok(validarCuerpoCierre({ version: 1, motivo: "sin_turno_en_turnero" }).ok);
    assert.equal(err(validarCuerpoCierre({ version: 1, motivo: "reserva_web" })), "400:campo_invalido:cierre_motivo", "reserva web no es un cierre");
    assert.equal(err(validarCuerpoCierre({ version: 1, motivo: "otro" })), "400:campo_invalido:cierre_nota");
    assert.equal(err(validarCuerpoCierre({ version: 1, motivo: "otro", nota: "   " })), "400:campo_invalido:cierre_nota");
    assert.ok(validarCuerpoCierre({ version: 1, motivo: "otro", nota: "pagó en efectivo aparte" }).ok);
    assert.equal(err(validarCuerpoCierre({ version: 1, motivo: "otro", nota: "x", cerrada_por_rol: "admin" })), "400:campo_no_permitido:cerrada_por_rol");
    const d = validarDesvinculo(new URLSearchParams("turno=9007199254740993&version=4"));
    assert.ok(d.ok && d.valor.turno === "9007199254740993" && d.valor.version === 4);
    assert.equal(err(validarDesvinculo(new URLSearchParams("turno=12&version=x"))), "400:campo_invalido:version");
    assert.equal(err(validarDesvinculo(new URLSearchParams("turno=1.5&version=1"))), "400:campo_invalido:turno");
    assert.equal(err(validarDesvinculo(new URLSearchParams("turno=1&version=1&rol=admin"))), "400:campo_desconocido:rol");
  }

  // ── 5. Fechas: medianoche de Córdoba y "día anterior" calendario ─────────
  {
    const d = (s: string) => new Date(s);
    assert.equal(fechaSim(d("2026-10-18T02:59:59Z")), "2026-10-17", "02:59Z todavía es el 17 en Córdoba");
    assert.equal(fechaSim(d("2026-10-18T03:00:00Z")), "2026-10-18", "03:00Z ya es el 18");
    assert.equal(horaSim(d("2026-10-18T03:00:00Z")), "00:00");
    assert.equal(horaSim(d("2026-10-19T00:30:00Z")), "21:30");
    // Alta el 19/10 00:05 (Cba): vale desde el 18/10 00:00:00 (Cba); el 17/10 23:59:59 no.
    const alta = d("2026-10-19T03:05:00Z");
    assert.equal(staffPuedeDeclarar(d("2026-10-18T03:00:00Z"), alta), true);
    assert.equal(staffPuedeDeclarar(d("2026-10-18T02:59:59Z"), alta), false);
    // 17/10 23:30 Cba = 18/10 02:30Z: por fecha UTC pasaría; por fecha SIM, no.
    assert.equal(staffPuedeDeclarar(d("2026-10-18T02:30:00Z"), d("2026-10-19T12:00:00Z")), false);
    // No es una ventana móvil de 24 h: 47 h antes vale si cae en el día anterior.
    assert.equal(staffPuedeDeclarar(d("2026-10-18T03:00:00Z"), d("2026-10-20T02:59:00Z")), true);
    assert.equal(staffPuedeCorregir(d("2026-10-18T00:30:00Z"), d("2026-10-20T00:30:00Z")), true, "48 h exactas, inclusive");
    assert.equal(staffPuedeCorregir(d("2026-10-18T00:30:00Z"), d("2026-10-20T00:30:01Z")), false);
    assert.equal(esFuturo(d("2026-10-19T12:02:00Z"), d("2026-10-19T12:00:00Z")), false, "margen de 2 min");
    assert.equal(esFuturo(d("2026-10-19T12:02:01Z"), d("2026-10-19T12:00:00Z")), true);
    // El resultado no depende de la zona del proceso.
    const tz = process.env.TZ;
    try {
      for (const z of ["UTC", "Asia/Tokyo", "Etc/GMT+12"]) {
        process.env.TZ = z;
        assert.equal(fechaSim(d("2026-10-18T02:59:59Z")), "2026-10-17", `TZ=${z}`);
        assert.equal(staffPuedeDeclarar(d("2026-10-18T02:59:59Z"), alta), false, `TZ=${z}`);
      }
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
    assert.ok(instanteValido("2026-10-18T10:00:00.123456-03:00") && !instanteValido("2026-10-18T10:00:00") && !instanteValido(1));
  }

  // ── 6. Ventana de turnos vinculables ─────────────────────────────────────
  {
    const v = ventanaVinculables(new Date("2026-10-18T23:30:00Z"));
    assert.deepEqual([v.ancla.fecha, v.ancla.hora, v.fecha_desde, v.fecha_hasta], ["2026-10-18", "20:30", "2026-10-18", "2026-10-18"]);
    assert.equal(v.minuto_hasta - v.minuto_desde, 120, "las dos horas previas");
    assert.ok(minutoLocal("2026-10-18", "18:30")! === v.minuto_desde && minutoLocal("2026-10-18", "18:29")! < v.minuto_desde);
    // Cruce de medianoche: 00:40 del 19 → desde las 22:40 del 18.
    const m = ventanaVinculables(new Date("2026-10-19T03:40:00Z"));
    assert.deepEqual([m.fecha_desde, m.fecha_hasta], ["2026-10-18", "2026-10-19"]);
    assert.equal(minutoLocal("2026-10-18", "22:40"), m.minuto_desde);
    const dia = ventanaVinculables(new Date("2026-10-18T23:30:00Z"), "dia");
    assert.deepEqual([dia.fecha_desde, dia.fecha_hasta, dia.minuto_hasta - dia.minuto_desde], ["2026-10-18", "2026-10-18", 1439]);
    const tol = ventanaVinculables(new Date("2026-10-18T23:30:00Z"), "tolerancia");
    assert.deepEqual([tol.fecha_desde, tol.fecha_hasta], ["2026-10-17", "2026-10-19"], `±${LIMITES.tolerancia_dias_turno} día`);
    assert.ok(coincideBusqueda({ hora: "19:53", personas: 3, minutos: 20 }, { hora: "19:5", personas: 3, minutos: null }));
    assert.ok(!coincideBusqueda({ hora: "19:53", personas: 3, minutos: 20 }, { hora: "18", personas: null, minutos: null }));
    assert.ok(!coincideBusqueda({ hora: "19:53", personas: 3, minutos: 20 }, { hora: null, personas: null, minutos: 10 }));
    const p = validarParamsVinculables(new URLSearchParams("alcance=dia&hora=19:5&personas=3"));
    assert.ok(p.ok && p.valor.alcance === "dia" && p.valor.hora === "19:5" && p.valor.incluir_vinculados);
    assert.equal(err(validarParamsVinculables(new URLSearchParams("alcance=semana"))), "400:campo_invalido:alcance");
    assert.equal(err(validarParamsVinculables(new URLSearchParams("interaccion=" + K + "&ocurrida_en=2026-10-18T10:00:00Z"))), "400:campo_invalido:ocurrida_en");
    assert.equal(err(validarParamsVinculables(new URLSearchParams("nombre=juan"))), "400:campo_desconocido:nombre");
  }

  // ── 7. Pago: regla total > 0; los datos contradictorios solo se señalan ──
  {
    assert.equal(pagoContradictorio(5000, "gratis"), true);
    assert.equal(pagoContradictorio(0, "qr"), true);
    assert.equal(pagoContradictorio(0, "gratis"), false);
    assert.equal(pagoContradictorio(34000, "qr"), false);
    assert.equal(pagoContradictorio(null, null), true);
  }

  // ── 8. Listados: filtros, ventana de staff y cursor ──────────────────────
  {
    const ahora = new Date("2026-10-18T22:00:00Z"); // 18/10 19:00 Cba
    const def = validarFiltrosListado(new URLSearchParams(), "staff", ahora);
    assert.ok(def.ok && def.valor.desde === "2026-10-18" && def.valor.hasta === "2026-10-18" && def.valor.limite === 20);
    assert.ok(validarFiltrosListado(new URLSearchParams("desde=2026-10-16"), "staff", ahora).ok, "staff: hoy − 2");
    assert.equal(err(validarFiltrosListado(new URLSearchParams("desde=2026-10-15"), "staff", ahora)), "403:fuera_de_ventana");
    assert.ok(validarFiltrosListado(new URLSearchParams("desde=2026-01-01"), "admin", ahora).ok);
    const pend = validarFiltrosListado(new URLSearchParams("estado=pendiente"), "staff", ahora);
    assert.ok(pend.ok && pend.valor.desde === null, "pendientes de cualquier fecha");
    assert.equal(err(validarFiltrosListado(new URLSearchParams("limite=101"), "admin", ahora)), "400:campo_invalido:limite");
    assert.equal(err(validarFiltrosListado(new URLSearchParams("estado=vendida"), "admin", ahora)), "400:campo_invalido:estado");
    assert.equal(err(validarFiltrosListado(new URLSearchParams("cursor=%%%"), "admin", ahora)), "400:campo_invalido:cursor");
    const c = { ocurrida_en: "2026-10-18T22:53:00.123456+00:00", id: K };
    assert.deepEqual(decodificarCursor(codificarCursor(c)), c);
    assert.equal(decodificarCursor(codificarCursor({ ...c, id: "x" })), null);
    const anul = validarFiltrosListado(new URLSearchParams("estado=anulada"), "admin", ahora);
    assert.ok(anul.ok && anul.valor.incluir_anuladas);
  }

  // ── 9. Errores de la base → HTTP (sin texto SQL) ─────────────────────────
  {
    const m = (code: string, message: string) => {
      const e = errorDeRpc({ code, message });
      return e ? `${e.status}:${e.codigo}${e.campo ? `:${e.campo}` : ""}${e.turno_stand_id ? `#${e.turno_stand_id}` : ""}` : null;
    };
    assert.equal(m("22023", "campo_invalido:personas_grupo"), "400:campo_invalido:personas_grupo");
    assert.equal(m("22023", "desglose_no_suma"), "400:desglose_no_suma");
    assert.equal(m("22023", "turno_fuera_de_tolerancia:9007199254740993"), "400:turno_fuera_de_tolerancia#9007199254740993");
    assert.equal(m("42501", "fuera_de_ventana"), "403:fuera_de_ventana");
    assert.equal(m("42501", "solo_admin"), "403:solo_admin");
    assert.equal(m("P0002", "interaccion_inexistente"), "404:interaccion_inexistente");
    assert.equal(m("P0002", "turno_inexistente:-5"), "404:turno_inexistente#-5");
    assert.equal(m("55000", "version_desactualizada"), "409:version_desactualizada");
    assert.equal(m("23505", "turno_ya_vinculado:2138"), "409:turno_ya_vinculado#2138");
    assert.equal(m("23505", "idempotency_key_con_otro_payload"), "409:idempotency_key_con_otro_payload");
    assert.equal(m("23514", "maximo_turnos_por_interaccion"), "409:maximo_turnos_por_interaccion");
    assert.equal(m("55000", "registro_no_iniciado"), "503:modulo_no_habilitado");
    assert.equal(m("PGRST202", "Could not find the function public.interaccion_registrar"), "503:modulo_no_instalado");
    assert.equal(m("42P01", "relation \"public.interacciones_config\" does not exist"), "503:modulo_no_instalado");
    assert.equal(m("XX000", "algo interno con datos"), null, "desconocido → 500 genérico");
    assert.equal(m("22023", "campo_invalido:'; drop table"), "400:campo_invalido", "el campo no se refleja si no es un nombre");
    const e = errorDeRpc({ code: "23505", message: "turno_ya_vinculado:2138" })!;
    assert.ok(!/turno_ya_vinculado:|SQL|ERROR/.test(e.error), "el mensaje es para personas");
  }

  // ── 10. Respuesta: versión, estado, permisos y advertencias ──────────────
  {
    const det: DetalleBase = {
      interaccion: {
        id: K, version: 4, ocurrida_en: "2026-10-18T22:30:00+00:00", fecha_negocio: "2026-10-18", hora_negocio: "19:30:00",
        registrada_en: "2026-10-18T22:31:00+00:00", registrada_por_rol: "staff", actualizada_en: null, actualizada_por_rol: null,
        resultado: "subio", personas_grupo: 2, hombres: null, mujeres: null, rango_etario: null, rangos_etarios: ["50_mas", "18_24"], tipo_grupo: "familia", conocia_sim: "no",
        se_subio_antes: "no_sabe", iniciador: "cliente", atendio_empleado_id: "11111111-2222-4333-8444-555555555555",
        motivo: null, observaciones: null, cierre_motivo: null, cierre_nota: null, cerrada_en: null, cerrada_por_rol: null,
        anulada_en: null, anulada_por_rol: null, anulada_motivo: null, idempotency_key: K,
      },
      estado: {
        vinculo_estado: "con_turno", turnos_vinculados: 2, turnos_activos: 2, turnos_pagos: 1, turnos_gratis: 1,
        turnos_pago_contradictorio: 1, participaciones: 4, venta_verificada: true,
      },
      turnos: [
        { turno_stand_id: "9007199254740993", turno_fecha: "2026-10-18", turno_hora: "19:20", turno_hora_subida: "19:25", turno_personas: 2,
          turno_minutos: 20, turno_modalidad: "v2_10", turno_total: 34000, turno_pago: true, turno_activo: true, dias_diferencia: 0,
          fuera_de_tolerancia: false, turno_modificado: true, turno_metodo_pago: "qr", pago_contradictorio: false,
          vinculado_en: "2026-10-18T22:31:00+00:00", vinculado_por_rol: "staff" },
        { turno_stand_id: "-3", turno_fecha: "2026-10-18", turno_hora: "19:40", turno_hora_subida: null, turno_personas: 2,
          turno_minutos: 10, turno_modalidad: "v2_10", turno_total: 0, turno_pago: false, turno_activo: true, dias_diferencia: 0,
          fuera_de_tolerancia: false, turno_modificado: false, turno_metodo_pago: "qr", pago_contradictorio: true,
          vinculado_en: "2026-10-18T22:32:00+00:00", vinculado_por_rol: "staff" },
      ],
    };
    const dentro = new Date("2026-10-19T22:00:00Z");
    const dto = dtoInteraccion(det, { rol: "staff", ahora: dentro, atendio: { nombre: "Ramiro", activo: false } }, { cierre_retirado: true });
    assert.equal(dto.version, 4);
    assert.equal(dto.hora_negocio, "19:30");
    assert.deepEqual([dto.rangos_etarios, dto.tipo_grupo], [["18_24", "50_mas"], "familia"], "todos los rangos, en orden canónico");
    const sinColumna = dtoInteraccion({ ...det, interaccion: { ...det.interaccion, rangos_etarios: undefined, tipo_grupo: undefined } }, { rol: "staff", ahora: dentro });
    assert.deepEqual([sinColumna.rangos_etarios, sinColumna.tipo_grupo], [[], null], "sin dato = lista vacía y tipo null");
    assert.equal(dto.turnos[0].turno_stand_id, "9007199254740993");
    assert.deepEqual(dto.atendio, { empleado_id: "11111111-2222-4333-8444-555555555555", nombre: "Ramiro", activo: false, declarado: true });
    assert.equal(dto.vinculo.participaciones, 4, "participaciones, no personas: puede superar el grupo (2)");
    assert.equal(dto.vinculo.venta_verificada, true);
    assert.deepEqual(dto.advertencias.map((a) => `${a.codigo}${a.turno_stand_id ? `#${a.turno_stand_id}` : ""}`),
      ["turno_modificado#9007199254740993", "pago_contradictorio#-3", "cierre_retirado"]);
    assert.ok(!("idempotency_key" in dto) && !("alta_huella" in dto));
    assert.deepEqual(dto.permisos, { editar: true, anular: true, vincular: true, desvincular: true, cerrar_sin_vinculo: false, eliminar: false },
      "staff nunca borra");
    const tarde = dtoInteraccion(det, { rol: "staff", ahora: new Date("2026-10-21T00:00:00Z") });
    assert.deepEqual(tarde.permisos, { editar: false, anular: false, vincular: true, desvincular: false, cerrar_sin_vinculo: false, eliminar: false },
      "staff fuera de las 48 h: solo puede seguir vinculando");
    // Admin borra en cualquier estado y fecha: con turnos, anulada, años después.
    const lejos = new Date("2030-01-01T00:00:00Z");
    assert.equal(dtoInteraccion(det, { rol: "admin", ahora: lejos }).permisos.eliminar, true, "admin borra una con turnos, fuera de toda ventana");
    const anuladaDet = { ...det, interaccion: { ...det.interaccion, anulada_en: "2026-10-18T23:00:00+00:00", anulada_por_rol: "staff" },
      estado: { ...det.estado, vinculo_estado: "anulada" }, turnos: [] };
    const anuladaAdmin = dtoInteraccion(anuladaDet, { rol: "admin", ahora: lejos });
    assert.deepEqual([anuladaAdmin.permisos.eliminar, anuladaAdmin.permisos.editar, anuladaAdmin.permisos.anular], [true, false, false],
      "una anulada solo se puede borrar (admin)");
    assert.equal(dtoInteraccion(anuladaDet, { rol: "staff", ahora: dentro }).permisos.eliminar, false);
    const pend = dtoInteraccion({ ...det, estado: { ...det.estado, vinculo_estado: "pendiente", turnos_vinculados: 0 }, turnos: [] }, { rol: "admin", ahora: dentro });
    assert.equal(pend.advertencias[0].codigo, "pendiente_de_vinculo");
    assert.equal(pend.permisos.cerrar_sin_vinculo, true);
    assert.equal(permisosPara("staff", { registrada_en: det.interaccion.registrada_en as string, resultado: "subio", anulada: false, estado: "pendiente", turnos: 0 }, dentro).cerrar_sin_vinculo, false);
  }

  // ── 12. Pantalla del personal: instante de Córdoba, edición y rebase ─────
  {
    assert.equal(instanteDeParedSim("2026-10-18", "00:00"), "2026-10-18T03:00:00.000Z", "00:00 de Córdoba = 03:00Z");
    assert.equal(instanteDeParedSim("2026-10-17", "23:59"), "2026-10-18T02:59:00.000Z", "cruza el día en UTC");
    assert.equal(instanteDeParedSim("2026-02-30", "10:00"), null);
    assert.deepEqual(paredSim(new Date("2026-10-18T02:30:00Z")), { fecha: "2026-10-17", hora: "23:30", valor: "2026-10-17T23:30" });
    assert.equal(minimoDeclarableStaff(new Date("2026-10-19T03:05:00Z")), "2026-10-18T00:00");
    // Edición: solo lo que cambió; vaciar = null; lo no tocado no viaja.
    const base = { ocurrida_en: "2026-10-18T22:30:00.123456+00:00", resultado: "pregunto" as const, personas_grupo: 3, hombres: 2, mujeres: 1,
      rangos_etarios: ["18_24" as const], tipo_grupo: null, conocia_sim: "no_sabe" as const, se_subio_antes: null, iniciador: "cliente" as const,
      atendio_empleado_id: null, motivo: "espera" as const, observaciones: "volvería" };
    assert.deepEqual(cambiosDeEdicion(base, { ...base, rangos_etarios: ["25_34"] }), { rangos_etarios: ["25_34"] });
    assert.deepEqual(cambiosDeEdicion(base, { ...base, rangos_etarios: ["50_mas", "18_24"] }), { rangos_etarios: ["18_24", "50_mas"] }, "agregar un rango manda la lista completa, ordenada");
    assert.deepEqual(cambiosDeEdicion({ ...base, rangos_etarios: ["18_24", "50_mas"] }, { ...base, rangos_etarios: ["50_mas", "18_24"] }), {}, "el mismo conjunto en otro orden no es un cambio");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, rangos_etarios: [] }), { rangos_etarios: [] }, "limpiar viaja explícito");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, rangos_etarios: undefined }), {}, "omitido no viaja");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, tipo_grupo: "amigos" }), { tipo_grupo: "amigos" });
    assert.deepEqual(cambiosDeEdicion({ ...base, tipo_grupo: "amigos" }, { ...base, tipo_grupo: null }), { tipo_grupo: null }, "quitar el tipo viaja como null");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, observaciones: null }), { observaciones: null }, "vaciar viaja como null");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, ocurrida_en: "2026-10-18T19:30:00.123456-03:00" }), {}, "mismo instante en otro formato = sin cambio");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, mujeres: 2, personas_grupo: 4 }), { personas_grupo: 4, hombres: 2, mujeres: 2 }, "el desglose viaja de a par");
    assert.deepEqual(cambiosDeEdicion(base, { ...base, resultado: "subio", motivo: null }), { resultado: "subio", motivo: null });
    assert.deepEqual(cambiosDeEdicion(base, { ...base, resultado: "subio" }), { resultado: "subio", motivo: null }, "pasar a subio declara el motivo null");
    const C = await import("@/app/admin/(panel)/interacciones/cliente");
    const dto = {
      id: K, version: 4, ocurrida_en: "2026-10-18T22:30:00.123456+00:00", resultado: "pregunto", personas_grupo: 3, hombres: 2, mujeres: 1,
      rangos_etarios: ["18_24", "50_mas"], tipo_grupo: "amigos", rango_etario: null, conocia_sim: "si", se_subio_antes: null, iniciador: "empleado",
      atendio: null, motivo: "espera", observaciones: "volvería",
    } as unknown as Parameters<typeof C.formularioDesdeDto>[0];
    const f = C.formularioDesdeDto(dto);
    assert.equal(C.instanteDeOcurrida(f.ocurrida), dto.ocurrida_en, "sin tocar la hora se conserva el instante exacto (microsegundos)");
    assert.equal(C.datosDesdeFormulario({ ...f, resultado: "subio" }).motivo, null, "\"Se subió\" nunca manda motivo");
    assert.equal(C.datosDesdeFormulario({ ...f, observaciones: "   " }).observaciones, null);
    // Rebase tras un conflicto: lo que el usuario no tocó toma el valor nuevo.
    assert.deepEqual([f.rangos_etarios, f.tipo_grupo], [["18_24", "50_mas"], "amigos"], "la edición carga todos los rangos");
    const r = C.rebaseEdicion(dto, { rangos_etarios: ["35_49"] });
    assert.deepEqual([r.rangos_etarios, r.tipo_grupo, r.conocia_sim, r.iniciador], [["35_49"], "amigos", "si", "empleado"]);
    assert.deepEqual(C.rebaseEdicion(dto, { tipo_grupo: null }).tipo_grupo, null);
    assert.deepEqual(C.rebaseEdicion(dto, { observaciones: null }).observaciones, "");
  }

  // ── 13. Borrado administrativo y pausa de altas (contrato) ───────────────
  {
    assert.deepEqual(validarCuerpoEliminacion({ version: 3 }), { ok: true, valor: { version: 3, motivo: null } }, "el motivo es opcional");
    assert.deepEqual(validarCuerpoEliminacion({ version: 3, motivo: "  carga de prueba  " }), { ok: true, valor: { version: 3, motivo: "carga de prueba" } });
    assert.equal(err(validarCuerpoEliminacion({ version: 3, motivo: "x".repeat(LIMITES.motivo_eliminacion_max + 1) })), "400:campo_invalido:motivo");
    assert.equal(err(validarCuerpoEliminacion({ motivo: "sin versión" })), "400:campo_invalido:version");
    for (const autoridad of ["rol", "eliminada_por_rol", "eliminada_en"]) {
      assert.equal(err(validarCuerpoEliminacion({ version: 1, [autoridad]: "admin" })).startsWith("400:"), true, `${autoridad} nunca viene del cliente`);
    }
    for (const k of ["eliminada_en", "eliminada_por_rol", "eliminada_motivo"]) {
      assert.ok((CAMPOS_PROHIBIDOS as readonly string[]).includes(k), `${k} es auditoría: el cliente no la manda`);
      assert.equal(err(validarCuerpoAlta({ idempotency_key: K, datos: { resultado: "miro", personas_grupo: 1, [k]: "x" } })).startsWith("400:"), true);
    }
    assert.deepEqual(errorDeRpc({ code: "P0002", message: "interaccion_eliminada" }), { status: 404, codigo: "interaccion_eliminada", error: "Esta interacción fue borrada por un administrador." });
    assert.equal(errorDeRpc({ code: "55000", message: "interaccion_eliminada" })?.status, 404, "también por el trigger");
    const pausa = errorDeRpc({ code: "55000", message: "altas_pausadas" });
    assert.deepEqual([pausa?.status, pausa?.codigo], [503, "altas_pausadas"], "pausa ≠ módulo no habilitado");
    assert.ok(!/sql|infra|config/i.test(pausa?.error ?? ""), "el mensaje al personal no habla de SQL ni de infraestructura");
    assert.equal(errorDeRpc({ code: "55000", message: "registro_no_iniciado" })?.codigo, "modulo_no_habilitado");
  }

  // ── 14. Borrador de carga nueva: sin datos no se recuerda; incierto, siempre ──
  {
    const C = await import("@/app/admin/(panel)/interacciones/cliente");
    const vacio = C.formularioVacio("subio");
    assert.equal(C.altaSinDatos(vacio, []), true, "recién abierta");
    assert.equal(C.altaSinDatos({ ...vacio, resultado: "miro" }, []), true, "el resultado del acceso no cuenta como dato");
    assert.equal(C.conservarBorradorAlta({ form: vacio, turnos: [], estado: "editando" }), false, "abrir y cerrar sin cambios: no hay borrador");
    const turno = { id: "-1", fecha: "2026-10-18", hora: "19:30", personas: 2, minutos: 10, total: 20000 };
    for (const [motivo, form, turnos] of [
      ["personas", { ...vacio, personas: 2 }, []],
      ["rango", { ...vacio, rangos_etarios: ["18_24"] }, []],
      ["tipo de grupo", { ...vacio, tipo_grupo: "pareja" }, []],
      ["observación", { ...vacio, observaciones: "volvía mañana" }, []],
      ["hora elegida", { ...vacio, ocurrida: { modo: "manual", valor: "2026-10-18T19:00" } }, []],
      ["turno elegido", vacio, [turno]],
    ] as const) {
      assert.equal(C.conservarBorradorAlta({ form: form as typeof vacio, turnos: [...turnos], estado: "editando" }), true, `${motivo} se recuerda`);
    }
    assert.equal(C.altaSinDatos({ ...vacio, observaciones: "   " }, []), true, "espacios no son un dato");
    const ida = { ...vacio, personas: 2, rangos_etarios: ["18_24" as const] };
    assert.equal(C.altaSinDatos({ ...ida, personas: 1, rangos_etarios: [] }, []), true, "volver todo al valor inicial = sin datos");
    for (const r of ["miro", "pregunto", "subio"] as const) {
      const v = C.formularioVacio(r);
      assert.deepEqual([v.rangos_etarios, v.tipo_grupo, v.motivo, v.personas], [[], null, null, 1], `${r}: nada marcado por defecto (ni Paseando)`);
    }
    assert.equal(C.conservarBorradorAlta({ form: vacio, turnos: [], estado: "incierto" }), true,
      "un envío incierto se conserva aunque los datos sean los iniciales (misma clave para reintentar)");
  }

  // ── 15. Rangos etarios múltiples, tipo de grupo y "Paseando" ─────────────
  {
    const alta = (datos: Record<string, unknown>) => validarCuerpoAlta({ idempotency_key: K, datos: { resultado: "pregunto", personas_grupo: 3, ...datos } });
    const ok = alta({ rangos_etarios: ["50_mas", "menos_14"] });
    assert.ok(ok.ok && JSON.stringify(ok.valor.datos.rangos_etarios) === '["menos_14","50_mas"]', "se normaliza al orden de las opciones");
    assert.equal(err(alta({ rangos_etarios: ["18_24", "18_24"] })), "400:rangos_repetidos");
    assert.equal(err(alta({ rangos_etarios: ["mixto"] })), "400:campo_invalido:rangos_etarios", "no hay rango \"mixto\"");
    assert.equal(err(alta({ rangos_etarios: "18_24" })), "400:campo_invalido:rangos_etarios", "una cadena no es una lista");
    assert.equal(err(alta({ rangos_etarios: [null] })), "400:campo_invalido:rangos_etarios");
    assert.equal(err(alta({ personas_grupo: 2, rangos_etarios: ["14_17", "18_24", "25_34"] })), "400:rangos_superan_personas", "no más rangos que personas");
    assert.ok(alta({ personas_grupo: 3, rangos_etarios: ["14_17", "18_24", "25_34"] }).ok, "tantos rangos como personas está bien");
    const vacia = alta({ rangos_etarios: [] });
    assert.ok(vacia.ok && JSON.stringify(vacia.valor.datos.rangos_etarios) === "[]", "vacía = sin dato (opcional)");
    const nula = alta({ rangos_etarios: null });
    assert.ok(nula.ok && JSON.stringify(nula.valor.datos.rangos_etarios) === "[]");
    assert.equal(err(alta({ rangos_etarios: ["18_24"], rango_etario: "18_24" })), "400:campo_invalido:rangos_etarios", "las dos formas juntas: ambiguo");
    const legado = alta({ rango_etario: "25_34" });
    assert.ok(legado.ok && legado.valor.datos.rango_etario === "25_34" && legado.valor.datos.rangos_etarios === undefined,
      "la pantalla anterior (un rango) se sigue aceptando; la base lo convierte en un conjunto de uno");
    // Tipo de grupo: opcional, uno solo, códigos estables.
    assert.deepEqual([...TIPOS_GRUPO], ["familia", "amigos", "pareja", "solo", "companeros", "otro"]);
    assert.deepEqual(TIPOS_GRUPO.map((t) => ETIQUETAS.tipo_grupo[t]), ["Familia", "Amigos", "Pareja/s", "Solo/a", "Compañeros", "Otro"]);
    assert.ok(alta({ tipo_grupo: "companeros" }).ok);
    assert.ok(alta({ tipo_grupo: null }).ok);
    assert.equal(err(alta({ tipo_grupo: "sin_dato" })), "400:campo_invalido:tipo_grupo", "Sin dato es la ausencia, no un código");
    assert.equal(err(alta({ tipo_grupo: ["familia"] })), "400:campo_invalido:tipo_grupo", "selección única");
    // Rangos: seis opciones, etiquetas consistentes.
    assert.deepEqual(RANGOS_ETARIOS.map((r) => ETIQUETAS.rango_etario[r]), ["Menos de 14", "14–17", "18–24", "25–34", "35–49", "50+"]);
    // Paseando: código propio, nunca con "Se subió"; los códigos previos siguen.
    assert.ok(MOTIVOS.includes("paseando") && ETIQUETAS.motivo.paseando === "Paseando");
    for (const m of ["precio", "tiempo", "espera", "vuelve_despues", "no_interesa", "requisitos", "acompanantes", "otro"]) assert.ok((MOTIVOS as readonly string[]).includes(m), m);
    assert.ok(alta({ resultado: "miro", motivo: "paseando" }).ok);
    assert.ok(alta({ resultado: "pregunto", motivo: "paseando" }).ok);
    assert.equal(err(alta({ resultado: "subio", motivo: "paseando" })), "400:motivo_no_aplica");
    // Edición: omitido ≠ limpieza explícita; el exceso con personas se rechaza.
    const omitido = validarCuerpoEdicion({ version: 2, cambios: { observaciones: "x" } });
    assert.ok(omitido.ok && !("rangos_etarios" in omitido.valor.cambios) && !("tipo_grupo" in omitido.valor.cambios));
    const limpia = validarCuerpoEdicion({ version: 2, cambios: { rangos_etarios: [], tipo_grupo: null } });
    assert.ok(limpia.ok && JSON.stringify(limpia.valor.cambios) === '{"rangos_etarios":[],"tipo_grupo":null}');
    assert.equal(err(validarCuerpoEdicion({ version: 2, cambios: { personas_grupo: 1, rangos_etarios: ["18_24", "50_mas"] } })), "400:rangos_superan_personas");
    assert.ok(validarCuerpoEdicion({ version: 2, cambios: { rangos_etarios: ["18_24", "50_mas"] } }).ok, "sin personas en el cambio, la base compara con las guardadas");
    assert.deepEqual(errorDeRpc({ code: "22023", message: "rangos_superan_personas" })?.status, 400);
    const viejo = errorDeRpc({ code: "55000", message: "cliente_desactualizado" });
    assert.deepEqual([viejo?.status, viejo?.codigo], [409, "cliente_desactualizado"]);
    assert.ok(/recarg/i.test(viejo?.error ?? ""), "pide actualizar la pantalla");

    // Formulario: el alta de "Solo miró" no arrastra lo cargado en otro resultado.
    const C = await import("@/app/admin/(panel)/interacciones/cliente");
    const lleno = { ...C.formularioVacio("pregunto"), personas: 2, hombres: 1, mujeres: 1, rangos_etarios: ["50_mas", "18_24"] as Array<"50_mas" | "18_24">,
      tipo_grupo: "pareja" as const, conocia_sim: "si" as const, se_subio_antes: "no" as const, iniciador: "cliente" as const,
      atendio_empleado_id: "11111111-2222-4333-8444-555555555555", motivo: "paseando" as const, observaciones: " volvía ",
      ocurrida: { modo: "manual" as const, valor: "2026-10-18T19:00" } };
    const miroAlta = C.datosDesdeFormulario({ ...lleno, resultado: "miro" }, { alta: true });
    assert.deepEqual(miroAlta, {
      ocurrida_en: null, resultado: "miro", personas_grupo: 2, hombres: 1, mujeres: 1, rangos_etarios: ["18_24", "50_mas"], tipo_grupo: null,
      conocia_sim: null, se_subio_antes: null, iniciador: null, atendio_empleado_id: null, motivo: "paseando", observaciones: "volvía",
    }, "Solo miró: personas, desglose, edades, motivo y observaciones; la hora es la del guardado");
    const miroEdicion = C.datosDesdeFormulario({ ...lleno, resultado: "miro" });
    assert.deepEqual([miroEdicion.tipo_grupo, miroEdicion.conocia_sim, miroEdicion.iniciador], ["pareja", "si", "cliente"],
      "al EDITAR un Solo miró lo oculto conserva su valor (y como no cambió, no viaja)");
    assert.deepEqual(cambiosDeEdicion(miroEdicion, { ...miroEdicion, motivo: "precio" }), { motivo: "precio" }, "editar el motivo no vacía lo oculto");
    const preguntoAlta = C.datosDesdeFormulario(lleno, { alta: true });
    assert.deepEqual([preguntoAlta.tipo_grupo, preguntoAlta.conocia_sim, preguntoAlta.ocurrida_en !== null], ["pareja", "si", true]);
    assert.equal(C.datosDesdeFormulario({ ...lleno, resultado: "subio" }, { alta: true }).motivo, null);

    // Borradores de la pantalla anterior: no se pierde el rango; incierto = mismo envío exacto.
    const anterior = { ...C.formularioVacio("pregunto"), rango_etario: "35_49" as const } as Record<string, unknown>;
    delete anterior.rangos_etarios;
    delete anterior.tipo_grupo;
    const conv = C.formularioDeBorrador(anterior as Parameters<typeof C.formularioDeBorrador>[0]);
    assert.deepEqual([conv.rangos_etarios, conv.tipo_grupo, "rango_etario" in conv], [["35_49"], null, false]);
    assert.deepEqual(C.formularioDeBorrador({ ...(anterior as object), rango_etario: null } as Parameters<typeof C.formularioDeBorrador>[0]).rangos_etarios, []);
    assert.deepEqual(C.formularioDeBorrador({ ...C.formularioVacio("miro"), rangos_etarios: ["50_mas", "14_17"] }).rangos_etarios, ["14_17", "50_mas"]);
    const env = C.envioAnterior(anterior as Parameters<typeof C.envioAnterior>[0], []);
    assert.deepEqual(Object.keys(env.datos).sort(), ["atendio_empleado_id", "conocia_sim", "hombres", "iniciador", "motivo", "mujeres", "observaciones",
      "ocurrida_en", "personas_grupo", "rango_etario", "resultado", "se_subio_antes"], "las claves exactas que mandaba la pantalla anterior");
    assert.equal(env.datos.rango_etario, "35_49");
    assert.ok(!("turnos" in env));

    // sessionStorage simulado: el borrador viejo se convierte una vez, sin perder nada.
    const mem = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { sessionStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } };
    try {
      const turno = { id: "-7", fecha: "2026-10-18", hora: "19:30", personas: 2, minutos: 10, total: 20000 };
      const viejoSubio = { ...anterior, resultado: "subio", personas: 2 };
      mem.set("sim.interacciones.borrador.alta.v1", JSON.stringify({ clave: K, form: viejoSubio, turnos: [turno], estado: "incierto", actualizado: "x" }));
      const b = C.borradores.alta();
      assert.ok(b && b.clave === K && b.estado === "incierto");
      assert.deepEqual(b?.form.rangos_etarios, ["35_49"]);
      assert.equal(b?.envio?.datos.rango_etario, "35_49", "el reintento manda el contenido original (forma anterior)");
      assert.deepEqual(b?.envio?.turnos, ["-7"]);
      assert.ok(b?.envio && !("rangos_etarios" in b.envio.datos), "no se transforma antes de resolver el envío incierto");
      const guardado = JSON.parse(mem.get("sim.interacciones.borrador.alta.v1") ?? "{}");
      assert.deepEqual([guardado.form.rangos_etarios, guardado.envio.datos.rango_etario], [["35_49"], "35_49"], "queda convertido y con el envío original");
      mem.set("sim.interacciones.borrador.alta.v1", JSON.stringify({ clave: K, form: anterior, turnos: [], estado: "editando", actualizado: "x" }));
      const e = C.borradores.alta();
      assert.deepEqual([e?.form.rangos_etarios, e?.envio], [["35_49"], undefined], "uno en edición solo se convierte");
      mem.set("sim.interacciones.borrador.edicion.v1." + K, JSON.stringify({ id: K, version: 3, form: anterior, actualizado: "x" }));
      assert.deepEqual(C.borradores.edicion(K)?.form.rangos_etarios, ["35_49"]);
    } finally {
      g.window = prev;
    }
  }

  // ── 11. Validación de datos sueltos ──────────────────────────────────────
  {
    assert.equal(err(validarDatos([], "alta")), "400:datos_invalidos");
    assert.equal(err(validarDatos({ resultado: "miro", personas_grupo: 1, conocia_sim: "quizas" }, "alta")), "400:campo_invalido:conocia_sim");
    assert.ok(validarDatos({ resultado: "miro", personas_grupo: 1, conocia_sim: "no_sabe", se_subio_antes: "no_sabe" }, "alta").ok,
      "\"No sabe\" es una respuesta válida");
  }

  console.log("OK — Interacciones (puro): IDs bigint como cadena sin pérdida, alta/edición/anulación/cierre/desvínculo/borrado validados sin aceptar autoridad del cliente, edición parcial sin borrados silenciosos, medianoche y día anterior de Córdoba en cualquier TZ, ventana de vinculables (2 h, día, tolerancia, cruce de medianoche), pago contradictorio señalado, listados con cursor y ventana de staff, errores → HTTP sin SQL (pausa ≠ no habilitado; eliminada → 404), permisos con borrado solo admin, borrador vacío que no se recuerda e incierto que sí, rangos etarios múltiples (canónicos, sin repetidos ni más que personas, omitido ≠ limpiar), tipo de grupo, Paseando sin Se subió, alta de Solo miró sin arrastre y borradores de la pantalla anterior convertidos sin perder el rango.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
