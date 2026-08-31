process.env.IA_PROVIDER = "fake"; // proveedor falso determinístico (no usa Claude)
import { strict as assert } from "node:assert";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { correrChat } from "@/lib/ia/server";

// Integración de la capa server con proveedor FALSO. Aísla por owner ZZTEST y limpia
// todo. Read-only sobre datos de negocio; solo escribe tablas ia_* de prueba.
//   npx tsx --env-file=.env.local lib/ia/server.integration.ts
const OWNER = "ZZTEST:ia-owner";

function hoyISO() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" }); }

async function limpiar() {
  const { data: convs } = await supabaseAdmin.from("ia_conversaciones").select("id").eq("owner", OWNER);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (ids.length) {
    const { data: msgs } = await supabaseAdmin.from("ia_mensajes").select("id").in("conversacion_id", ids);
    const mids = (msgs ?? []).map((m) => m.id as string);
    if (mids.length) await supabaseAdmin.from("ia_feedback").delete().in("mensaje_id", mids);
    const { data: ejes } = await supabaseAdmin.from("ia_ejecuciones").select("id").in("conversacion_id", ids);
    const eids = (ejes ?? []).map((e) => e.id as string);
    if (eids.length) await supabaseAdmin.from("ia_herramientas_ejecuciones").delete().in("ejecucion_id", eids);
    await supabaseAdmin.from("ia_ejecuciones").delete().in("conversacion_id", ids);
    await supabaseAdmin.from("ia_mensajes").delete().in("conversacion_id", ids);
    await supabaseAdmin.from("ia_conversaciones").delete().in("id", ids);
  }
  await supabaseAdmin.from("ia_consumo").delete().eq("owner", OWNER);
}

async function main() {
  await limpiar();
  try {
    const { data: conv } = await supabaseAdmin.from("ia_conversaciones").insert({ owner: OWNER, estado: "activa" }).select("id").single();
    const convId = conv!.id as string;

    // 1) Happy path: consulta → herramienta real → respuesta persistida.
    const r1 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "¿Cuántos turnos hizo Federico en agosto?", idempotencyKey: "k1" });
    assert.ok(r1.ok, "correrChat ok");
    if (!r1.ok) return;
    assert.ok(r1.texto.length > 0, "respuesta con texto");
    assert.ok(Array.isArray(r1.herramientas) && (r1.herramientas as unknown[]).length >= 1, "corrió al menos una herramienta");

    const { data: msgs } = await supabaseAdmin.from("ia_mensajes").select("rol, estado").eq("conversacion_id", convId).order("created_at");
    assert.equal((msgs ?? []).filter((m) => m.rol === "user").length, 1, "1 mensaje de usuario");
    assert.equal((msgs ?? []).filter((m) => m.rol === "assistant").length, 1, "1 respuesta");
    const { data: ejes } = await supabaseAdmin.from("ia_ejecuciones").select("id, estado").eq("conversacion_id", convId);
    assert.equal((ejes ?? []).length, 1, "1 ejecución auditada");
    const { data: consumo1 } = await supabaseAdmin.from("ia_consumo").select("solicitudes, tokens_in, tokens_out").eq("owner", OWNER).eq("dia", hoyISO()).single();
    assert.equal(consumo1!.solicitudes, 1, "1 solicitud contada");
    assert.ok(Number(consumo1!.tokens_in) + Number(consumo1!.tokens_out) > 0, "tokens medidos");

    // 2) Idempotencia: mismo key → misma respuesta, SIN nueva solicitud ni doble cobro.
    const r2 = await correrChat({ owner: OWNER, conversacionId: convId, pregunta: "¿Cuántos turnos hizo Federico en agosto?", idempotencyKey: "k1" });
    assert.ok(r2.ok && r2.duplicado === true, "idempotente: duplicado");
    if (r2.ok) assert.equal(r2.mensajeId, r1.mensajeId, "misma respuesta devuelta");
    const { data: consumo2 } = await supabaseAdmin.from("ia_consumo").select("solicitudes").eq("owner", OWNER).eq("dia", hoyISO()).single();
    assert.equal(consumo2!.solicitudes, 1, "idempotencia no incrementa la cuota");
    const { data: msgs2 } = await supabaseAdmin.from("ia_mensajes").select("id").eq("conversacion_id", convId).eq("rol", "user");
    assert.equal((msgs2 ?? []).length, 1, "idempotencia no duplica el mensaje del usuario");

    // 3) Título automático generado tras el primer intercambio.
    const { data: convT } = await supabaseAdmin.from("ia_conversaciones").select("titulo").eq("id", convId).single();
    assert.ok(convT!.titulo && convT!.titulo.length > 0, "título automático");

    // 4) Cuota ATÓMICA diaria (RPC): con tope 1 la segunda reserva se rechaza.
    const owner2 = OWNER + ":q";
    await supabaseAdmin.from("ia_consumo").delete().eq("owner", owner2);
    const q1 = await supabaseAdmin.rpc("ia_reservar_solicitud", { p_owner: owner2, p_dia: hoyISO(), p_max_dia: 1, p_max_mes: 999999999 });
    const q2 = await supabaseAdmin.rpc("ia_reservar_solicitud", { p_owner: owner2, p_dia: hoyISO(), p_max_dia: 1, p_max_mes: 999999999 });
    assert.equal((q1.data as { ok: boolean }).ok, true, "1ra reserva ok");
    assert.equal((q2.data as { ok: boolean; motivo: string }).ok, false, "2da reserva rechazada");
    assert.equal((q2.data as { motivo: string }).motivo, "limite_diario", "motivo limite_diario");
    await supabaseAdmin.from("ia_consumo").delete().eq("owner", owner2);

    // 5) Feedback (tabla) sobre la respuesta.
    const { error: fe } = await supabaseAdmin.from("ia_feedback").insert({ mensaje_id: r1.mensajeId, tipo: "util", actor: OWNER });
    assert.equal(fe, null, "feedback insertado");

    // 6) Papelera + purga (>30 días).
    await supabaseAdmin.from("ia_conversaciones").update({ estado: "papelera", deleted_at: new Date(Date.now() - 40 * 86400000).toISOString() }).eq("id", convId);
    const purga = await supabaseAdmin.rpc("ia_purgar_papelera", { p_dias: 30 });
    assert.ok(Number(purga.data) >= 1, "purga elimina la conversación vencida");
    const { data: sigue } = await supabaseAdmin.from("ia_conversaciones").select("id").eq("id", convId).maybeSingle();
    assert.equal(sigue, null, "conversación purgada");

    console.log("✔ server.integration OK (persistencia, cuota atómica, idempotencia, título, feedback, papelera/purga)");
  } finally {
    await limpiar();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
