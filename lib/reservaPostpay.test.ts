import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  AVISO_24H, TITULO_EVENTO, archivoIcs, enlaceGoogleCalendar, escaparTexto, fechaLarga, plegar,
  sumarMinutos, type EventoReserva,
} from "@/lib/reservaPostpayCalendario";
import * as A from "@/lib/analytics";

// Experiencia post-pago de Reservas (EXPERIMENTAL).
// Ejecutar: npx tsx --env-file=.env.local lib/reservaPostpay.test.ts
//
// NO toca nada real: supabaseAdmin se reemplaza por una base EN MEMORIA, `fetch`
// queda bloqueado y la sesión del panel se firma con un secreto DESCARTABLE
// generado acá (nunca el real). Las rutas se prueban de verdad: next/headers se
// reemplaza por un almacén de cookies en memoria. Las fechas de ejemplo evitan
// el día del corte comercial (la guarda B0 lo reserva para su fuente única).

// ── Base en memoria (solo lo que lee el módulo) ────────────────────────────────
type Fila = Record<string, unknown>;
const RESERVAS: Fila[] = [];
const columnasPedidas: string[] = [];
const tablasTocadas = new Set<string>();
let fallarLectura = false;

class Consulta implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private cols: string[] = [];
  private filtros: Array<(f: Fila) => boolean> = [];
  private uno = false;
  constructor(private readonly t: string) { tablasTocadas.add(t); }
  select(c = "*") { this.cols = c.split(",").map((x) => x.trim()); columnasPedidas.push(c); return this; }
  eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
  maybeSingle() { this.uno = true; return this; }
  then<A1 = { data: unknown; error: { message: string } | null }, B = never>(
    ok?: ((v: { data: unknown; error: { message: string } | null }) => A1 | PromiseLike<A1>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A1 | B> {
    return Promise.resolve().then(() => {
      if (fallarLectura) return { data: null, error: { message: "caída simulada" } };
      const lista = (this.t === "reservas" ? RESERVAS : []).filter((f) => this.filtros.every((fn) => fn(f)));
      const proy = (f: Fila) => Object.fromEntries(this.cols.map((c) => [c, f[c]]));
      return { data: this.uno ? (lista[0] ? proy(lista[0]) : null) : lista.map(proy), error: null };
    }).then(ok, ko);
  }
}
const cliente = supabaseAdmin as unknown as { from: (t: string) => unknown; rpc: (...a: unknown[]) => unknown };
cliente.from = (t: string) => new Consulta(t);
cliente.rpc = (fn: unknown) => { throw new Error(`el módulo no debería llamar a la RPC ${String(fn)}`); };
globalThis.fetch = (async (u: unknown) => { throw new Error(`sin red (${String(u).slice(0, 40)})`); }) as typeof fetch;

const base = {
  origen: "web", fecha: "2026-10-20", hora: "18:30", duracion_minutos: 20, simuladores: ["Ferrari", "McLaren"],
  total: 34000, reprogramaciones: 0, referencia_publica: null, nombre: "Zz Prueba Postpay", telefono: "3510000000",
  mercado_pago_payment_id: null as string | null, estado: "pendiente_pago",
};
function reiniciar() {
  RESERVAS.length = 0;
  RESERVAS.push(
    { ...base, id: 9001, estado: "activa", mercado_pago_payment_id: "MP-PAGO-PRUEBA" },
    { ...base, id: 9002 },
    { ...base, id: 9003, origen: "mensualidad", estado: "activa", referencia_publica: "RES-ABCD-EFGH" },
    { ...base, id: 9004, estado: "activa", total: 0 },
    { ...base, id: 9005, estado: "conflicto_pago", mercado_pago_payment_id: "MP-PAGO-PRUEBA-2" },
    { ...base, id: 9006, estado: "cancelada" },
    { ...base, id: 9007, estado: "activa", mercado_pago_payment_id: "MP-PAGO-PRUEBA-3", referencia_publica: "RES-WXYZ-2345" },
    { ...base, id: 9008, estado: "error_pago" },
  );
  fallarLectura = false;
}

const EVENTO: EventoReserva = {
  fecha: "2026-10-20", hora: "18:30", duracionMin: 20, simuladores: 2,
  codigo: "SIM-ABCD-EFGH", uid: "reserva-0123456789abcdef01234567@simexperience.com.ar", secuencia: 0,
};
const desplegar = (ics: string) => ics.replace(/\r\n /g, "");

async function main() {
  // ── 1. Google Calendar: enlace estándar, sin OAuth ─────────────────────────
  {
    const url = new URL(enlaceGoogleCalendar(EVENTO));
    assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
    const p = url.searchParams;
    assert.equal(p.get("action"), "TEMPLATE");
    assert.equal(p.get("text"), "Reserva SIM 🏁", "título");
    assert.equal(p.get("dates"), "20261020T183000/20261020T185000", "inicio y fin exactos: 20 minutos");
    assert.equal(p.get("ctz"), "America/Argentina/Cordoba", "zona horaria");
    assert.equal(p.get("location"), "Nuevo Centro Shopping, Córdoba", "ubicación");
    const det = p.get("details") ?? "";
    assert.ok(det.includes("20 minutos") && det.includes("SIM-ABCD-EFGH") && det.includes("https://simexperience.com.ar"));
    assert.ok(!/MP-|payment|preference|\$|9001|telefono|351/.test(det), "sin datos internos ni financieros");
    // Todo encodeado: ni espacios ni comas sueltas en la URL.
    assert.ok(!/ |,/.test(enlaceGoogleCalendar(EVENTO)), "valores encodeados");
    // Cruza la medianoche bien y respeta la duración real.
    const tarde = new URL(enlaceGoogleCalendar({ ...EVENTO, hora: "23:50", duracionMin: 30 }));
    assert.equal(tarde.searchParams.get("dates"), "20261020T235000/20261021T002000");
    assert.deepEqual(sumarMinutos("2026-12-31", "23:45", 30), { fecha: "2027-01-01", hora: "00:15" });
    assert.throws(() => enlaceGoogleCalendar({ ...EVENTO, hora: "25:99x" }));
    assert.throws(() => enlaceGoogleCalendar({ ...EVENTO, duracionMin: 0 }));
  }

  // ── 2. Archivo .ics (RFC 5545) ─────────────────────────────────────────────
  {
    const ahora = new Date("2026-10-15T14:00:00Z");
    const ics = archivoIcs(EVENTO, ahora);
    assert.ok(ics.endsWith("\r\n"));
    assert.ok(!/[^\r]\n/.test(ics), "todas las líneas terminan en CRLF");
    const enc = new TextEncoder();
    for (const l of ics.split("\r\n")) assert.ok(enc.encode(l).length <= 75, `línea de más de 75 octetos: ${l}`);
    const d = desplegar(ics);
    const lineas = d.split("\r\n").filter(Boolean);
    for (const req of [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SIM Argentina//Reservas//ES", "BEGIN:VTIMEZONE",
      "TZID:America/Argentina/Cordoba", "TZOFFSETTO:-0300", "BEGIN:VEVENT",
      `UID:${EVENTO.uid}`, "DTSTAMP:20261015T140000Z", "SEQUENCE:0",
      "DTSTART;TZID=America/Argentina/Cordoba:20261020T183000",
      "DTEND;TZID=America/Argentina/Cordoba:20261020T185000",
      `SUMMARY:${TITULO_EVENTO}`, "LOCATION:Nuevo Centro Shopping\\, Córdoba",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${AVISO_24H}`, "TRIGGER:-PT24H", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ]) assert.ok(lineas.includes(req), `falta ${req}`);
    const desc = lineas.find((l) => l.startsWith("DESCRIPTION:Reserva SIM"))!;
    assert.ok(desc.includes("\\n") && !desc.includes("\n"), "saltos de línea escapados");
    // BEGIN/END balanceados y anidados.
    const pila: string[] = [];
    for (const l of lineas) {
      if (l.startsWith("BEGIN:")) pila.push(l.slice(6));
      if (l.startsWith("END:")) assert.equal(pila.pop(), l.slice(4), "BEGIN/END anidados");
    }
    assert.equal(pila.length, 0);
    // UID estable: dos descargas en momentos distintos → mismo UID y mismo horario.
    const otra = desplegar(archivoIcs(EVENTO, new Date("2026-10-16T10:00:00Z")));
    assert.equal(otra.match(/^UID:.*$/m)![0], `UID:${EVENTO.uid}`);
    assert.notEqual(otra.match(/^DTSTAMP:.*$/m)![0], "DTSTAMP:20261015T140000Z");
    // Reprogramada: mismos UID, horario NUEVO y SEQUENCE más alto.
    const repro = desplegar(archivoIcs({ ...EVENTO, fecha: "2026-10-22", hora: "11:00", secuencia: 1 }, ahora));
    assert.ok(repro.includes(`UID:${EVENTO.uid}`));
    assert.ok(repro.includes("DTSTART;TZID=America/Argentina/Cordoba:20261022T110000"));
    assert.ok(repro.includes("DTEND;TZID=America/Argentina/Cordoba:20261022T112000"));
    assert.ok(repro.includes("SEQUENCE:1"));
    // Escapes y plegado sin cortar caracteres multibyte.
    assert.equal(escaparTexto("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
    const larga = "DESCRIPTION:" + "Mañana tenés tu reserva en SIM 🏁 ".repeat(6);
    const plegada = plegar(larga);
    for (const l of plegada.split("\r\n")) {
      assert.ok(enc.encode(l).length <= 75);
      assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(enc.encode(l)), l, "UTF-8 intacto");
    }
    assert.equal(plegada.replace(/\r\n /g, ""), larga, "desplegar devuelve la línea original");
    // La fecha en palabras no depende de la zona del proceso.
    const tz = process.env.TZ;
    try {
      for (const z of ["UTC", "Asia/Tokyo", "Etc/GMT+12"]) {
        process.env.TZ = z;
        assert.equal(fechaLarga("2026-10-20"), "martes 20 de octubre de 2026", `TZ=${z}`);
      }
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  }

  // ── 3. Sesión y módulos del servidor (secreto descartable) ─────────────────
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  let cookie: string | undefined;
  let lecturasDeCookie = 0;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: {
      cookies: async () => {
        lecturasDeCookie++;
        return { get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) };
      },
    },
  } as unknown as NodeJS.Module;
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN"]) delete process.env[k];
  const { createSessionToken } = await import("@/lib/adminSession");
  const P = await import("@/lib/reservaPostpay");
  const tokenAdmin = await createSessionToken("admin");
  const tokenStaff = await createSessionToken("staff");

  // ── 4. Enlace firmado: sin la firma correcta no se lee nada (IDOR) ─────────
  {
    const t = P.firmarComprobante(9001)!;
    assert.match(t, /^[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
    assert.equal(P.leerComprobante(t), 9001);
    const [idB36, sig] = t.split(".");
    assert.equal(P.leerComprobante(`${(9002).toString(36)}.${sig}`), null, "cambiar el número no abre otra reserva");
    assert.equal(P.leerComprobante(`${idB36}.${"A".repeat(22)}`), null, "firma inventada");
    assert.equal(P.leerComprobante(`0${t}`), null, "ceros a la izquierda no valen");
    for (const malo of [undefined, null, "", "9001", 9001, "abc", `${t}x`, t.toUpperCase()]) {
      assert.equal(P.leerComprobante(malo), null, `${JSON.stringify(malo)}`);
    }
    const secreto = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
    assert.equal(P.leerComprobante(t), null, "otra clave del servidor → inválido");
    process.env.ADMIN_SESSION_SECRET = "";
    assert.equal(P.firmarComprobante(9001), null, "sin secreto no se firma (falla cerrado)");
    assert.equal(P.leerComprobante(t), null);
    assert.equal(P.retornoExperimental("https://simexperience.com.ar", 9001), null, "sin firma: retorno de siempre");
    process.env.ADMIN_SESSION_SECRET = secreto;
    const r = P.retornoExperimental("https://simexperience.com.ar", 9001)!;
    assert.deepEqual(r, {
      success: `https://simexperience.com.ar/reservas/confirmacion?t=${t}&vuelta=exito`,
      pending: `https://simexperience.com.ar/reservas/confirmacion?t=${t}&vuelta=pendiente`,
      failure: `https://simexperience.com.ar/reservas/confirmacion?t=${t}&vuelta=error`,
    });
  }

  // ── 5. Feature flag + sesión del panel (dos llaves) ────────────────────────
  {
    delete process.env.EXPERIMENTAL_RESERVA_POSTPAY;
    cookie = tokenAdmin;
    lecturasDeCookie = 0;
    assert.equal(await P.experimentoPostpayActivo(), false, "variable ausente → apagado");
    assert.equal(lecturasDeCookie, 0, "apagado: ni siquiera se lee la cookie");
    for (const v of ["TRUE", "1", "yes", " true", "false"]) {
      process.env.EXPERIMENTAL_RESERVA_POSTPAY = v;
      assert.equal(await P.experimentoPostpayActivo(), false, `"${v}" no activa`);
    }
    process.env.EXPERIMENTAL_RESERVA_POSTPAY = "true";
    cookie = undefined;
    assert.equal(await P.experimentoPostpayActivo(), false, "cliente común (sin sesión) → retorno de siempre");
    cookie = "falsa.firma";
    assert.equal(await P.experimentoPostpayActivo(), false, "cookie inventada → no");
    cookie = tokenStaff;
    assert.equal(await P.experimentoPostpayActivo(), true, "staff del panel → experimento");
    cookie = tokenAdmin;
    assert.equal(await P.experimentoPostpayActivo(), true, "admin del panel → experimento");
  }

  // ── 6. Estado público: sale de la base, la vuelta solo cambia el mensaje ───
  {
    const casos: Array<[string, "exito" | "pendiente" | "error" | null, string]> = [
      ["activa", "error", "confirmada"], ["activa", null, "confirmada"],
      ["pendiente_pago", "exito", "procesando"], ["pendiente_pago", null, "procesando"],
      ["pendiente_pago", "pendiente", "pendiente"], ["pendiente_pago", "error", "rechazada"],
      ["error_pago", "exito", "rechazada"], ["conflicto_pago", "exito", "revision"],
      ["cancelada", "exito", "cancelada"], ["reembolsada", "exito", "cancelada"], ["otro", "exito", "pendiente"],
    ];
    for (const [estado, vuelta, esperado] of casos) assert.equal(P.estadoPublico(estado, vuelta), esperado, `${estado}/${vuelta}`);
    assert.equal(P.leerVuelta("approved"), null, "valores de Mercado Pago no se interpretan");
  }

  // ── 7. Comprobante: lo justo, sin datos sensibles ni ids técnicos ──────────
  reiniciar();
  const tk = (id: number) => P.firmarComprobante(id)!;
  {
    const c = (await P.comprobantePorToken(tk(9001), "exito"))!;
    assert.equal(c.estado, "confirmada");
    assert.deepEqual(
      { ...c.reserva!, codigo: "-" },
      { codigo: "-", fecha: "2026-10-20", hora: "18:30", horaFin: "18:50", duracionMin: 20, simuladores: ["Ferrari", "McLaren"], total: 34000, pagada: true },
    );
    assert.match(c.reserva!.codigo, /^SIM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, "código visible derivado");
    assert.equal((await P.comprobantePorToken(tk(9001), null))!.reserva!.codigo, c.reserva!.codigo, "estable");
    assert.ok(c.calendario!.google.startsWith("https://calendar.google.com/calendar/render?"));
    assert.equal(c.calendario!.ics, `/api/reservas/comprobante/ics?t=${tk(9001)}`);
    assert.deepEqual(c.analitica, { transaccion: "reserva_9001" }, "el mismo transaction_id de begin_checkout");
    const json = JSON.stringify({ ...c, analitica: null });
    for (const prohibido of ["Zz Prueba", "3510000000", "MP-PAGO", "9001", "nombre", "telefono", "payment", "preference"]) {
      assert.ok(!json.includes(prohibido), `el comprobante no expone ${prohibido}`);
    }
    for (const cols of columnasPedidas) assert.ok(!/nombre|telefono|email|apellido/.test(cols), "ni siquiera se leen datos personales");
    assert.deepEqual([...tablasTocadas], ["reservas"], "solo se lee reservas");

    // Referencia pública existente: se usa esa.
    assert.equal((await P.comprobantePorToken(tk(9007), null))!.reserva!.codigo, "RES-WXYZ-2345");
    // Activa sin pago (bonificada): confirmada pero no "pagada" ni purchase.
    const bonif = (await P.comprobantePorToken(tk(9004), "exito"))!;
    assert.equal(bonif.estado, "confirmada");
    assert.equal(bonif.reserva!.pagada, false);
    assert.equal(bonif.analitica, null);
    // Otros estados: sin detalle ni calendario.
    for (const [id, vuelta, esperado] of [
      [9002, "exito", "procesando"], [9002, "pendiente", "pendiente"], [9002, "error", "rechazada"],
      [9005, "exito", "revision"], [9006, "exito", "cancelada"], [9008, "exito", "rechazada"],
    ] as const) {
      const x = (await P.comprobantePorToken(tk(id), vuelta))!;
      assert.deepEqual([x.estado, x.reserva, x.calendario, x.analitica], [esperado, null, null, null], `${id}/${vuelta}`);
    }
    // Reservas que no son web (Mensualidades) o inexistentes: no hay comprobante.
    assert.equal(await P.comprobantePorToken(tk(9003), "exito"), null);
    assert.equal(await P.comprobantePorToken(tk(424242), "exito"), null);
    assert.equal(await P.comprobantePorToken("inventado.AAAAAAAAAAAAAAAAAAAAAA", "exito"), null);
  }

  // ── 8. Webhook retrasado: "procesando" hasta que la base confirma ──────────
  {
    reiniciar();
    const t = tk(9002);
    for (let i = 0; i < 3; i++) {
      assert.equal((await P.comprobantePorToken(t, "exito"))!.estado, "procesando", "sin falso positivo");
    }
    // Lo que persiste el webhook (procesarPagoAprobadoReserva): activa + payment_id.
    Object.assign(RESERVAS.find((f) => f.id === 9002)!, { estado: "activa", mercado_pago_payment_id: "MP-PAGO-TARDE" });
    const c = (await P.comprobantePorToken(t, "exito"))!;
    assert.equal(c.estado, "confirmada");
    assert.equal(c.reserva!.pagada, true);
    // Si el pago ni siquiera se pudo crear (error_pago), se dice que no se completó.
    assert.equal((await P.comprobantePorToken(tk(9008), "exito"))!.estado, "rechazada");
  }

  // ── 9. Rutas reales (flag apagada → 404 en todas) ──────────────────────────
  {
    reiniciar();
    const rutaComp = await import("@/app/api/reservas/comprobante/route");
    const rutaIcs = await import("@/app/api/reservas/comprobante/ics/route");
    const rutaPrevia = await import("@/app/api/reservas/comprobante/vista-previa/route");
    const pagina = (await import("@/app/reservas/confirmacion/page")).default;
    for (const m of [rutaComp, rutaIcs, rutaPrevia]) assert.equal(m.dynamic, "force-dynamic");
    let ip = 0;
    const req = (path: string) => new Request(`https://simexperience.com.ar${path}`, { headers: { "x-real-ip": `10.9.0.${++ip}` } });
    const noEncontrado = async (p: Promise<unknown>) => {
      try { await p; return false; } catch (e) { return String((e as { digest?: string }).digest ?? "").includes("404"); }
    };

    delete process.env.EXPERIMENTAL_RESERVA_POSTPAY;
    cookie = tokenAdmin;
    assert.equal((await rutaComp.GET(req(`/api/reservas/comprobante?t=${tk(9001)}`))).status, 404, "apagada: comprobante 404");
    assert.equal((await rutaIcs.GET(req(`/api/reservas/comprobante/ics?t=${tk(9001)}`))).status, 404, "apagada: ics 404");
    assert.equal((await rutaPrevia.GET(req("/api/reservas/comprobante/vista-previa?id=9001"))).status, 404, "apagada: vista previa 404 aun siendo admin");
    assert.ok(await noEncontrado(pagina({ searchParams: Promise.resolve({ t: tk(9001), vuelta: "exito" }) })), "apagada: la página da 404");

    process.env.EXPERIMENTAL_RESERVA_POSTPAY = "true";
    // Comprobante
    let res = await rutaComp.GET(req(`/api/reservas/comprobante?t=${tk(9001)}&vuelta=error&status=approved&collection_status=approved`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal((await res.json()).estado, "confirmada", "la vuelta 'error' no tapa lo que dice la base");
    res = await rutaComp.GET(req(`/api/reservas/comprobante?t=${tk(9002)}&vuelta=exito&status=approved&collection_status=approved&payment_id=1`));
    assert.equal((await res.json()).estado, "procesando", "los parámetros de Mercado Pago no aprueban nada");
    assert.equal((await rutaComp.GET(req(`/api/reservas/comprobante?t=${(9001).toString(36)}.AAAAAAAAAAAAAAAAAAAAAA`))).status, 404, "URL manipulada → 404");
    assert.equal((await rutaComp.GET(req("/api/reservas/comprobante?t=1"))).status, 404);
    fallarLectura = true;
    res = await rutaComp.GET(req(`/api/reservas/comprobante?t=${tk(9001)}`));
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(await res.json()).includes("caída"), "sin detalle interno");
    fallarLectura = false;

    // .ics
    res = await rutaIcs.GET(req(`/api/reservas/comprobante/ics?t=${tk(9001)}`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="reserva-sim-2026-10-20.ics"');
    const ics1 = desplegar(await res.text());
    assert.ok(ics1.startsWith("BEGIN:VCALENDAR\r\n") && ics1.includes("TRIGGER:-PT24H"));
    assert.ok(ics1.includes("DTSTART;TZID=America/Argentina/Cordoba:20261020T183000"));
    const ics2 = desplegar(await (await rutaIcs.GET(req(`/api/reservas/comprobante/ics?t=${tk(9001)}`))).text());
    assert.equal(ics1.match(/^UID:.*$/m)![0], ics2.match(/^UID:.*$/m)![0], "UID estable entre descargas");
    assert.ok(!/9001|MP-PAGO|Zz Prueba|3510000000/.test(ics1), "el .ics no lleva datos internos");
    for (const id of [9002, 9005, 9006, 9003]) {
      assert.equal((await rutaIcs.GET(req(`/api/reservas/comprobante/ics?t=${tk(id)}`))).status, 404, `sin .ics para ${id}`);
    }
    // Reprogramación: el próximo .ics trae el horario nuevo con el mismo UID.
    Object.assign(RESERVAS.find((f) => f.id === 9001)!, { fecha: "2026-10-23", hora: "16:10", reprogramaciones: 1 });
    const ics3 = desplegar(await (await rutaIcs.GET(req(`/api/reservas/comprobante/ics?t=${tk(9001)}`))).text());
    assert.ok(ics3.includes("DTSTART;TZID=America/Argentina/Cordoba:20261023T161000") && ics3.includes("SEQUENCE:1"));
    assert.equal(ics3.match(/^UID:.*$/m)![0], ics1.match(/^UID:.*$/m)![0]);
    reiniciar();

    // Vista previa: solo admin; no escribe nada.
    cookie = undefined;
    assert.equal((await rutaPrevia.GET(req("/api/reservas/comprobante/vista-previa?id=9001"))).status, 401);
    cookie = tokenStaff;
    assert.equal((await rutaPrevia.GET(req("/api/reservas/comprobante/vista-previa?id=9001"))).status, 403);
    cookie = tokenAdmin;
    assert.equal((await rutaPrevia.GET(req("/api/reservas/comprobante/vista-previa?id=abc"))).status, 400);
    res = await rutaPrevia.GET(req("/api/reservas/comprobante/vista-previa?id=9002&vuelta=pendiente"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `https://simexperience.com.ar/reservas/confirmacion?t=${tk(9002)}&vuelta=pendiente`);

    // Página
    const el = await pagina({ searchParams: Promise.resolve({ t: tk(9001), vuelta: "exito" }) }) as { props: { inicial: { estado: string }; token: string } };
    assert.equal(el.props.inicial.estado, "confirmada");
    assert.ok(await noEncontrado(pagina({ searchParams: Promise.resolve({ t: `${(9002).toString(36)}.${tk(9001).split(".")[1]}` }) })), "URL manipulada → 404");
    assert.ok(await noEncontrado(pagina({ searchParams: Promise.resolve({}) })), "sin enlace → 404");
    assert.ok(await noEncontrado(pagina({ searchParams: Promise.resolve({ t: tk(9003) }) })), "reserva de Mensualidades → 404");
    delete process.env.EXPERIMENTAL_RESERVA_POSTPAY;
  }

  // ── 10. Analytics: eventos nuevos, purchase sin duplicar ───────────────────
  {
    // sessionStorage en memoria, sobre un objeto simple (no es una base de datos).
    class Mem { private m: Record<string, string> = {}; getItem(k: string) { return k in this.m ? this.m[k] : null; } setItem(k: string, v: string) { this.m[k] = String(v); } removeItem(k: string) { delete this.m[k]; } }
    const g = globalThis as unknown as { window?: { location: { hostname: string; pathname: string }; dataLayer: Array<Record<string, unknown>> }; sessionStorage?: Mem };
    g.window = { location: { hostname: "simexperience.com.ar", pathname: "/reservas/confirmacion" }, dataLayer: [] };
    g.sessionStorage = new Mem();
    A.setPendingPurchase({ value: 34000, currency: "ARS", type: "reserva" });
    A.trackReservaPagoConfirmadoVista("reserva_9001");
    A.trackReservaPagoConfirmadoVista("reserva_9001"); // recarga
    A.trackAgregarCalendario();
    A.trackDescargaIcs();
    const ev = g.window.dataLayer.map((e) => e.event);
    assert.deepEqual(ev, ["reserva_payment_success_view", "purchase", "reserva_payment_success_view", "add_to_calendar_click", "calendar_ics_download"]);
    assert.deepEqual(g.window.dataLayer[1], { event: "purchase", transaction_id: "reserva_9001", value: 34000, currency: "ARS" }, "un solo purchase, deduplicado");
    // En /admin, localhost o previews no se emite nada.
    g.window = { location: { hostname: "localhost", pathname: "/reservas/confirmacion" }, dataLayer: [] };
    A.trackReservaPagoConfirmadoVista("reserva_1");
    assert.deepEqual(g.window.dataLayer, []);
    delete g.window;
    delete g.sessionStorage;
  }

  // ── 11. Fuentes: aislamiento y seguridad ───────────────────────────────────
  {
    const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const pagina = sinComentarios(leer("app/reservas/confirmacion/page.tsx"));
    const cliente = sinComentarios(leer("app/reservas/confirmacion/ConfirmacionReserva.tsx"));
    for (const [nombre, src] of [["página", pagina], ["cliente", cliente]] as const) {
      assert.ok(!/collection_status|payment_status|payment_id|preference_id|merchant_order|sp\.status|useSearchParams/.test(src),
        `${nombre}: no usa lo que Mercado Pago agrega a la URL`);
      assert.ok(!/supabaseAdmin|SERVICE_ROLE|service_role|createClient/.test(src), `${nombre}: sin service role`);
    }
    assert.ok(/^"use client"/.test(leer("app/reservas/confirmacion/ConfirmacionReserva.tsx")));
    assert.ok(/import type \{[^}]+\} from "@\/lib\/reservaPostpay";/.test(cliente), "del módulo de servidor, solo tipos");
    assert.ok(!/from "@\/lib\/reservaPostpay";/.test(cliente.replace(/import type \{[^}]+\} from "@\/lib\/reservaPostpay";/, "")));
    // Verificación acotada: intervalo y tope explícitos.
    assert.match(cliente, /export const INTERVALO_MS = 3000;/);
    assert.match(cliente, /export const MAX_INTENTOS = 10;/);
    // Preferencia: lo único nuevo es el retorno experimental bajo las dos llaves.
    const pref = leer("app/api/mercadopago/preference/route.ts");
    assert.ok(pref.includes("back_urls: experimental ?? {") && pref.includes('...(experimental ? { auto_return: "approved" } : {}),'));
    assert.ok(pref.includes("success: `${baseUrl}/reservas/exito`") && pref.includes("failure: `${baseUrl}/reservas/error`") && pref.includes("pending: `${baseUrl}/reservas/pendiente`"),
      "el retorno de siempre sigue intacto");
    assert.ok(!leer("app/api/mercadopago/webhook/route.ts").includes("reservaPostpay"), "el webhook no cambia");
    for (const f of ["app/reservas/exito/page.tsx", "app/reservas/pendiente/page.tsx", "app/reservas/error/page.tsx"]) {
      assert.ok(!leer(f).includes("reservaPostpay") && !leer(f).includes("confirmacion"), `${f} sigue igual`);
    }
    // La bandera es server-side y estricta.
    const flags = leer("lib/featureFlags.ts");
    assert.ok(flags.includes("process.env.EXPERIMENTAL_RESERVA_POSTPAY") && !flags.includes("NEXT_PUBLIC_EXPERIMENTAL"));
    assert.ok(!/EXPERIMENTAL_RESERVA_POSTPAY/.test(cliente), "el navegador no ve la bandera");
  }

  console.log("OK — Reservas post-pago (experimental): Google Calendar y .ics (RFC 5545, aviso 24 h, UID estable, reprogramación), enlace firmado sin IDOR, estado desde la base, webhook retrasado sin falso positivo, flag apagada = 404 y retorno de siempre, analytics sin purchase duplicado.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
