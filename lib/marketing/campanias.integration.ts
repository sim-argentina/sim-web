// GUARDIÁN: esta suite escribe en la base. Si el destino no es una base de pruebas aislada,
// el proceso aborta acá, antes de la primera escritura. Ver lib/guardiaPruebas.ts.
import "@/lib/guardiaPruebas.activar";
import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// Marketing · campañas en SIMULACIÓN — las RUTAS reales y el ejecutor por lotes
// contra el stack LOCAL, con datos sintéticos (turnos, consentimientos y bajas de
// teléfonos 3517XXXXXX inventados) y el proveedor SIMULADO. No sale nada a la red.
//
// Recorre: audiencia vacía · vista previa (conteos, exclusiones, enmascarado) ·
// permisos y entorno · doble clic al crear y al preparar · límite y presupuesto ·
// exclusividad entre campañas · lotes concurrentes (cada destinatario se envía
// UNA vez) · reinicio con el turno tomado (incierto, sin reenviar) · baja posterior
// a preparar · pausa, reanudación y cancelación sin borrar historial · errores
// transitorios, definitivos e inciertos · costo simulado · beneficios ficticios no
// canjeables · atribución por regreso al stand.
//
// CONCURRENCIA REAL: los pedidos simultáneos van con Promise.all; cada uno llega a
// la base por PostgREST con su propia conexión.
//
// Ejecutar: node scripts/pruebas/correr-mutantes.mjs lib/marketing/campanias.integration.ts

const CONTENEDOR = "supabase_db_sim-web-pruebas";
const ORIGEN = "https://simexperience.com.ar";
const RUN = Date.now().toString(36);
const MARCA = `zzcamp_${RUN}`;
const TEXTO = `zz-camp-${RUN}`.slice(0, 40);
const SEMILLA = (Number.parseInt(RUN.slice(-4), 36) * 37) % 900_000;
const tel = (i: number) => `3517${String((SEMILLA + i) % 1_000_000).padStart(6, "0")}`;
const telEscrito = (i: number) => { const t = tel(i); return i % 2 ? `+54 9 ${t.slice(0, 3)} ${t.slice(3, 6)}-${t.slice(6)}` : `0${t.slice(0, 3)} 15 ${t.slice(3)}`; };

{
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalido");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(u.hostname), "psql solo contra el stack local");
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { input: q, encoding: "utf8" }).trim();
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const campanias: string[] = [];
const turnos: number[] = [];
let vigentePrevio: string | null = null;

type Resp = { status: number; json: Record<string, unknown> };

async function main() {
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.MARKETING_WHATSAPP_PROVIDER = "fake";
  for (const k of ["VERCEL", "VERCEL_URL", "VERCEL_ENV", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];

  let cookie: string | undefined;
  const rutaHeaders = require.resolve("next/headers");
  require.cache[rutaHeaders] = {
    id: rutaHeaders, filename: rutaHeaders, loaded: true,
    exports: {
      cookies: async () => ({ get: (n: string) => (cookie && n === "sim-admin-session" ? { name: n, value: cookie } : undefined) }),
      headers: async () => new Headers(),
    },
  } as unknown as NodeJS.Module;

  const LISTA = await import("@/app/api/admin/marketing/campanias/route");
  const UNA = await import("@/app/api/admin/marketing/campanias/[id]/route");
  const SRV = await import("@/lib/marketing/campaniasServer");
  const { crearProveedorSimulado } = await import("@/lib/marketing/proveedorWhatsapp");
  const { validarCodigoDescuento } = await import("@/lib/codigosDescuento");
  const { createSessionToken } = await import("@/lib/adminSession");
  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
  const admin = await createSessionToken("admin");
  const staff = await createSessionToken("staff");
  cookie = admin;

  async function llamar(h: unknown, ruta: string, body?: unknown, ctx?: unknown, origen = ORIGEN): Promise<Resp> {
    const init: RequestInit = body === undefined
      ? { method: "GET" }
      : { method: "POST", headers: { "content-type": "application/json", origin: origen }, body: JSON.stringify(body) };
    const res = await (h as (r: Request, c?: unknown) => Promise<Response>)(new Request(`${ORIGEN}${ruta}`, init), ctx);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body: unknown, origen?: string) => llamar(LISTA.POST, "/api/admin/marketing/campanias", body, undefined, origen);
  const accion = (id: string, body: unknown) => llamar(UNA.POST, `/api/admin/marketing/campanias/${id}`, body, ctx(id));
  const detalle = async (id: string) => (await llamar(UNA.GET, `/api/admin/marketing/campanias/${id}`, undefined, ctx(id))).json as Record<string, unknown> & {
    campania: Record<string, unknown>; conteos: Record<string, number>; destinatarios: Record<string, unknown>[]; eventos: { tipo: string }[];
    atribucion: Record<string, number>;
  };
  const estadoDe = (campania: string, i: number) =>
    sql(`select estado || '|' || coalesce(motivo, '') from public.mkt_campania_destinatarios where campania_id = ${lit(campania)} and telefono = ${lit(tel(i))}`);

  // Proveedor simulado que además cuenta cada llamada por clave de idempotencia.
  const llamadas = new Map<string, number>();
  const contador = (sim: Parameters<typeof crearProveedorSimulado>[0]) => {
    const p = crearProveedorSimulado(sim);
    return { nombre: "falso" as const, enviarPlantilla: async (m: Parameters<typeof p.enviarPlantilla>[0]) => {
      llamadas.set(m.claveIdempotencia, (llamadas.get(m.claveIdempotencia) ?? 0) + 1);
      return p.enviarPlantilla(m);
    } };
  };
  const SIN_FALLOS = { fallo_definitivo_pct: 0, fallo_transitorio_pct: 0, incierto_pct: 0, no_entregado_pct: 0 };

  const datos = (extra: Record<string, unknown> = {}) => ({
    nombre: `Campaña ${MARCA}`, objetivo: "Prueba de integración", ventana_dias: 14, solo_pagos: true,
    excluir_retornados: false, excluir_mensualidades: false, indicativos: [], mensaje: "Hola {nombre}! {beneficio} con {codigo} hasta el {vence}. Baja: {baja}",
    productos: ["reserva", "gift_card"], beneficio_tipo: "porcentaje", beneficio_valor: 10, beneficio_vigencia_dias: 5,
    limite_destinatarios: null, tarifa: 0.05, moneda: "USD", presupuesto_maximo: null, simulacion: SIN_FALLOS, ...extra,
  });
  async function crear(extra: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
    const r = await post({ accion: "guardar", clave: randomUUID(), datos: datos(extra) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const c = r.json.campania as { id: string; version: number };
    campanias.push(c.id);
    return c;
  }
  async function correrHastaTerminar(id: string, opts: Parameters<typeof SRV.ejecutarLote>[1] = {}) {
    for (let i = 0; i < 40; i++) {
      const r = await SRV.ejecutarLote(id, opts);
      assert.ok(r.ok, JSON.stringify(r));
      if (r.valor.estado !== "ejecutando") return r.valor;
      if (r.valor.tomados === 0) await dormir(400);
    }
    assert.fail("la campaña no terminó");
  }

  // ═══ 0. Llave maestra apagada: TODO responde "Deshabilitado", también sin sesión ═══
  {
    delete process.env.MARKETING_CAMPANIAS_ENABLED;
    const EJEC = await import("@/app/api/admin/marketing/campanias/ejecutar/route");
    const antes = sql(`select count(*) || '|' || coalesce(max(creada_en)::text, '') from public.mkt_campanias`);
    const id0 = randomUUID();
    const respuestas = [
      await llamar(LISTA.GET, "/api/admin/marketing/campanias"),
      await post({ accion: "vista_previa", datos: datos() }),
      await post({ accion: "guardar", clave: randomUUID(), datos: datos() }),
      await llamar(UNA.GET, `/api/admin/marketing/campanias/${id0}`, undefined, ctx(id0)),
      await accion(id0, { accion: "ejecutar_lote" }),
    ];
    cookie = undefined;
    respuestas.push(await llamar(LISTA.GET, "/api/admin/marketing/campanias"), await post({ accion: "guardar", clave: randomUUID(), datos: datos() }));
    cookie = admin;
    for (const r of respuestas) assert.deepEqual([r.status, r.json.codigo, r.json.estado], [503, "marketing_deshabilitado", "Deshabilitado"], JSON.stringify(r.json));
    const ej = await EJEC.POST(new Request(`${ORIGEN}/api/admin/marketing/campanias/ejecutar`, { method: "POST" }));
    assert.equal(ej.status, 503, "el ejecutor de servidor tampoco corre");
    const srv = await SRV.ejecutarPendientes();
    assert.ok(!srv.ok && srv.e?.codigo === "solo_simulacion_local", "y el servidor, llamado directo, no escribe");
    assert.equal(sql(`select count(*) || '|' || coalesce(max(creada_en)::text, '') from public.mkt_campanias`), antes, "nada se escribió");
    process.env.MARKETING_CAMPANIAS_ENABLED = "true";
  }
  console.log("OK — 0: con MARKETING_CAMPANIAS_ENABLED apagada, rutas y ejecutor responden 503 \"Deshabilitado\" (con o sin sesión) y no se escribe nada.");

  // ── Datos sintéticos: texto vigente, 13 teléfonos con turnos en la ventana ──
  vigentePrevio =sql(`select coalesce((select version from public.mkt_textos_consentimiento where estado = 'vigente'), '')`) || null;
  sql(`insert into public.mkt_textos_consentimiento (version, titulo, texto, huella)
       values (${lit(TEXTO)}, 'Prueba campañas', 'Acepto recibir promociones de prueba de SIM Argentina por WhatsApp (integración de campañas).', '');
       select public.mkt_texto_publicar(${lit(TEXTO)}, 'admin');`);
  const hoy = sql(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date`);
  const base = Number(sql(`select coalesce(max(id), 0) + 1000 from public.turnos_stand`));
  const filas: string[] = [];
  const turno = (i: number, extra: { fecha?: string; total?: number; metodo?: string; estado?: string; telefono?: string | null } = {}) => {
    const id = base + filas.length;
    turnos.push(id);
    filas.push(`(${id}, ${lit(`Persona ${i} ${MARCA}`)}, ${extra.telefono === null ? "null" : lit(extra.telefono ?? telEscrito(i))},
      ${extra.fecha ? lit(extra.fecha) : `${lit(hoy)}::date - ${2 + (i % 9)}`}, '17:00', ${lit(extra.estado ?? "confirmado")}, ${extra.total ?? 12000}, ${lit(extra.metodo ?? "efectivo")})`);
  };
  for (let i = 0; i < 12; i++) turno(i);
  turno(0, { telefono: tel(0) });                              // mismo teléfono, otro formato: un solo destinatario
  turno(12, { total: 0, metodo: "gratis" });                   // sin pago: afuera con "solo pagos"
  turno(13, { estado: "cancelado" });                          // cancelado
  turno(14, { telefono: null });                               // sin teléfono
  sql(`insert into public.turnos_stand (id, nombre, telefono, fecha, hora, estado, total, metodo_pago) values ${filas.join(",\n")};`);
  const alta = (i: number) => sql(`select public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
      'tipo', 'alta', 'fuente', 'admin_evidencia', 'telefono', ${lit(tel(i))}, 'texto_version', ${lit(TEXTO)},
      'evidencia', jsonb_build_object('tipo', 'papel_firmado', 'referencia', ${lit(`Planilla sintética ${MARCA}`)}),
      'ocurrido_en', to_char((clock_timestamp() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'admin');`);
  const baja = (i: number) => sql(`select public.mkt_consentimiento_registrar(gen_random_uuid(), jsonb_build_object(
      'tipo', 'baja', 'fuente', 'admin_pedido', 'telefono', ${lit(tel(i))}, 'evidencia', jsonb_build_object('canal', 'presencial')), 'admin');`);
  const otrosElegibles = Number(sql(`select count(*) from public.mkt_consentimiento_estado where estado = 'alta'`));
  assert.equal(otrosElegibles, 0, "el registro local arranca sin altas ajenas (si no, los conteos de esta suite no aplican)");

  // ═══ 1. Audiencia vacía ═════════════════════════════════════════════════
  {
    const vp = await post({ accion: "vista_previa", datos: datos() });
    assert.equal(vp.status, 200, JSON.stringify(vp.json));
    const v = vp.json.vista_previa as Record<string, number & Record<string, unknown>>;
    assert.equal(v.elegibles, 0);
    assert.equal(v.seleccionados, 0);
    assert.ok(Number(v.pendientes_consentimiento) >= 12, "pasarían el resto de los filtros");
    const vacia = await crear();
    const r = await accion(vacia.id, { accion: "preparar", version: vacia.version });
    assert.deepEqual([r.status, r.json.codigo], [409, "audiencia_vacia"]);
    assert.equal(sql(`select estado from public.mkt_campanias where id = ${lit(vacia.id)}`), "borrador");
  }
  console.log("OK — 1: sin consentimientos la audiencia es 0, se muestra así y no se puede preparar.");

  for (let i = 0; i < 9; i++) alta(i);
  baja(8);

  // ═══ 2. Vista previa: conteos, exclusiones y enmascarado ════════════════
  {
    const vp = await post({ accion: "vista_previa", datos: datos() });
    assert.equal(vp.status, 200);
    const v = vp.json.vista_previa as Record<string, unknown> & { excluidos: Record<string, number>; filas: { excluidas: Record<string, number> }; consentimiento: Record<string, unknown> };
    assert.equal(v.elegibles, 8, "0..7 con alta; el 8 con baja");
    assert.equal(v.candidatos, 12, "un destinatario por teléfono normalizado (el 0 aparece dos veces)");
    assert.equal(v.excluidos.con_baja, 1);
    assert.equal(v.excluidos.sin_consentimiento, 3);
    assert.equal(v.filas.excluidas.no_pago, 1);
    assert.equal(v.filas.excluidas.cancelado, 1);
    assert.equal(v.filas.excluidas.sin_telefono, 1);
    assert.equal(v.consentimiento.control_telefono_verificado, 0);
    assert.equal(v.consentimiento.control_telefono_pendiente, true);
    const crudo = JSON.stringify(vp.json);
    for (let i = 0; i < 15; i++) assert.ok(!crudo.includes(tel(i)), "ningún teléfono completo en la respuesta");
    assert.ok(!crudo.includes(MARCA.slice(0, 12)) || !/Persona \d/.test(crudo), "ningún nombre en la respuesta");
    assert.match((v.muestra as { telefono: string }[])[0].telefono, /^\d{3}\*{5}\d{2}$/);
    assert.match(String((v.mensaje as { ejemplo: string }).ejemplo), /SIMU-XXXXXXXX/);
    const capacidades = v.capacidades as { restriccion: string; estado: string }[];
    assert.equal(capacidades.find((c) => c.restriccion === "Cantidad de Gift Cards por compra")?.estado, "no_aplicada");
    const soloGc = await post({ accion: "vista_previa", datos: datos({ productos: ["gift_card"] }) });
    assert.equal((soloGc.json.vista_previa as { capacidades: { restriccion: string; estado: string }[] }).capacidades.find((c) => c.restriccion === "Productos alcanzados")?.estado, "no_aplicada");
    const malo = await post({ accion: "vista_previa", datos: datos({ mensaje: "Hola {Nombre} tu {cupon}" }) });
    assert.equal(malo.status, 400);
  }
  console.log("OK — 2: vista previa con candidatos, elegibles, exclusiones por motivo, teléfonos enmascarados y sin nombres.");

  // ═══ 3. Permisos y entorno ══════════════════════════════════════════════
  {
    cookie = staff;
    assert.equal((await llamar(LISTA.GET, "/api/admin/marketing/campanias")).status, 200, "staff mira");
    assert.equal((await post({ accion: "vista_previa", datos: datos() })).status, 403, "staff no calcula ni crea");
    cookie = undefined;
    assert.equal((await llamar(LISTA.GET, "/api/admin/marketing/campanias")).status, 401);
    cookie = admin;
    assert.equal((await post({ accion: "guardar", clave: randomUUID(), datos: datos() }, "https://otro.invalid")).status, 403, "origen ajeno");
    const antes = { url: process.env.NEXT_PUBLIC_SUPABASE_URL };
    for (const [k, v] of [["VERCEL", "1"], ["NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co"], ["MARKETING_WHATSAPP_PROVIDER", ""]] as const) {
      const previo = process.env[k];
      process.env[k] = v;
      const g = await post({ accion: "guardar", clave: randomUUID(), datos: datos() });
      assert.deepEqual([g.status, g.json.codigo], [403, "solo_simulacion_local"], `${k}=${v}`);
      if (previo === undefined) delete process.env[k]; else process.env[k] = previo;
    }
    assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, antes.url);
    assert.equal((await post({ accion: "vista_previa", datos: datos() })).status, 200);
  }
  console.log("OK — 3: staff solo mira; sin sesión 401; fuera de la base local no se guarda ni ejecuta (403), la vista previa sí.");

  // ═══ 4. Doble clic al crear; editar con versión vieja ═══════════════════
  let A: { id: string; version: number };
  {
    const clave = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => post({ accion: "guardar", clave, datos: datos({ limite_destinatarios: 3 }) })));
    const ids = new Set(rs.map((r) => (r.json.campania as { id: string }).id));
    assert.equal(ids.size, 1, "una sola campaña");
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 201]);
    A = rs.map((r) => r.json.campania as { id: string; version: number })[0];
    campanias.push(A.id);
    const ed = await post({ accion: "guardar", id: A.id, version: A.version, datos: datos({ limite_destinatarios: 3, nombre: `A ${MARCA}` }) });
    assert.equal(ed.status, 200);
    const vieja = await post({ accion: "guardar", id: A.id, version: A.version, datos: datos({ limite_destinatarios: 3 }) });
    assert.deepEqual([vieja.status, vieja.json.codigo], [409, "version_desactualizada"]);
    A = ed.json.campania as { id: string; version: number };
  }
  console.log("OK — 4: tres clics al crear = una campaña; editar con una versión vieja se rechaza.");

  // ═══ 5. Preparar: doble clic concurrente, límite, beneficios ficticios ══
  {
    const rs = await Promise.all([1, 2, 3].map(() => accion(A.id, { accion: "preparar", version: A.version })));
    for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(rs.filter((r) => r.json.repetida === false).length, 1, "una sola preparación");
    assert.equal(sql(`select count(*) from public.mkt_campania_destinatarios where campania_id = ${lit(A.id)}`), "3", "límite 3");
    const cods = sql(`select string_agg(beneficio_codigo, ',' order by orden) from public.mkt_campania_destinatarios where campania_id = ${lit(A.id)}`).split(",");
    assert.equal(new Set(cods).size, 3);
    for (const c of cods) {
      assert.match(c, /^SIMU-[A-HJ-NP-Z2-9]{8}$/);
      const v = await validarCodigoDescuento(c, 20000);
      assert.equal(v.valido, false, "un beneficio ficticio no se puede canjear");
    }
    assert.equal(sql(`select count(*) from public.codigos_descuento where upper(codigo) like 'SIMU-%'`), "0");
    const d = await detalle(A.id);
    assert.equal(d.campania.estado, "preparada");
    assert.equal(Number(d.campania.costo_maximo), 0.15);
    const otra = await accion(A.id, { accion: "preparar", version: 1 });
    assert.equal(otra.status, 409, "una versión vieja no vuelve a preparar");
    assert.equal(sql(`select string_agg(beneficio_codigo, ',' order by orden) from public.mkt_campania_destinatarios where campania_id = ${lit(A.id)}`), cods.join(","), "beneficios estables");
  }
  console.log("OK — 5: tres clics al preparar = una preparación; límite aplicado; beneficios SIMU- únicos, estables y no canjeables.");

  // ═══ 6. Presupuesto y exclusividad entre campañas ═══════════════════════
  let B: { id: string; version: number };
  {
    B = await crear({ presupuesto_maximo: 0.1, nombre: `B ${MARCA}` });
    const vp = await post({ accion: "vista_previa", id: B.id, datos: datos({ presupuesto_maximo: 0.1 }) });
    const v = vp.json.vista_previa as { elegibles: number; seleccionados: number; recortado_por: string[]; excluidos: Record<string, number> };
    assert.equal(v.elegibles, 5, "los 3 de A están en otra campaña en curso");
    assert.equal(v.excluidos.en_otra_campania, 3);
    assert.deepEqual([v.seleccionados, v.recortado_por], [2, ["presupuesto"]]);
    const r = await accion(B.id, { accion: "preparar", version: B.version });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(sql(`select count(*) from public.mkt_campania_destinatarios d where d.campania_id = ${lit(B.id)}
                        and d.telefono in (select telefono from public.mkt_campania_destinatarios where campania_id = ${lit(A.id)})`), "0");
    const tampered = await supabaseAdmin.rpc("mkt_campania_preparar", { p_id: (await crear()).id, p_version: 1, p_audiencia: {}, p_destinatarios: [], p_rol: "admin" });
    assert.match(String(tampered.error?.message), /audiencia_vacia/);
  }
  console.log("OK — 6: el presupuesto recorta (2 de 5) y un teléfono en curso en otra campaña no se repite.");

  // ═══ 7. Lotes concurrentes: cada destinatario se envía una sola vez ═════
  {
    assert.equal((await accion(A.id, { accion: "iniciar" })).status, 200);
    assert.equal((await accion(A.id, { accion: "iniciar" })).json.repetida, true);
    const rs = await Promise.all([1, 2, 3].map(() => SRV.ejecutarLote(A.id, { tamano: 2, proveedor: contador(SIN_FALLOS) })));
    for (const r of rs) assert.ok(r.ok, JSON.stringify(r));
    const tomados = rs.reduce((n, r) => n + (r.ok ? r.valor.tomados : 0), 0);
    assert.equal(tomados, 3, "entre los tres ejecutores toman 3, no 6 ni 9");
    for (let i = 0; i < 8; i++) {
      const n = llamadas.get(`${A.id}:${tel(i)}`) ?? 0;
      assert.ok(n <= 1, `el ${i} se envió ${n} veces`);
    }
    assert.equal([...llamadas.keys()].filter((k) => k.startsWith(A.id)).length, 3);
    const fin = await correrHastaTerminar(A.id, { proveedor: contador(SIN_FALLOS) });
    assert.equal(fin.estado, "completada");
    const d = await detalle(A.id);
    assert.equal(d.conteos.entregados + d.conteos.no_entregados, 3);
    assert.equal(d.conteos.costo_simulado, Math.round(d.conteos.entregados * 0.05 * 1e6) / 1e6, "costo = entregados × tarifa");
    for (const x of d.destinatarios) assert.match(String(x.telefono), /^\d{3}\*{5}\d{2}$/);
    assert.ok(!JSON.stringify(d).includes(tel(0)), "detalle sin teléfonos completos");
  }
  console.log("OK — 7: tres lotes simultáneos envían cada destinatario una vez; costo simulado = entregados × tarifa.");

  // ═══ 8. Reinicio con el turno tomado, baja posterior a preparar ═════════
  let C: { id: string; version: number };
  {
    C = await crear({ nombre: `C ${MARCA}` });
    assert.equal((await accion(C.id, { accion: "preparar", version: C.version })).status, 200);
    const mios = sql(`select string_agg(telefono, ',' order by orden) from public.mkt_campania_destinatarios where campania_id = ${lit(C.id)}`).split(",");
    assert.equal(mios.length, 6, "8 elegibles menos los 2 de B (en curso)");
    assert.equal((await accion(C.id, { accion: "iniciar" })).status, 200);
    // Un ejecutor que se corta: toma 2 y nunca informa.
    const muerto = randomUUID();
    const t = await supabaseAdmin.rpc("mkt_campania_tomar_lote", { p_id: C.id, p_ejecutor: muerto, p_tamano: 2, p_turno_s: 1 });
    assert.equal(((t.data as { tomados: unknown[] }).tomados).length, 2);
    const tomadosMuerto = ((t.data as { tomados: { id: string; telefono: string }[] }).tomados);
    // Baja de un pendiente DESPUÉS de preparar.
    const iBaja = [...Array(8).keys()].find((i) => mios.includes(tel(i)) && !tomadosMuerto.some((x) => x.telefono === tel(i)))!;
    baja(iBaja);
    await dormir(1300);
    const fin = await correrHastaTerminar(C.id, { proveedor: contador(SIN_FALLOS) });
    assert.equal(fin.estado, "completada");
    for (const x of tomadosMuerto) {
      assert.equal(sql(`select estado || '|' || motivo from public.mkt_campania_destinatarios where id = ${lit(x.id)}`), "incierto|ejecutor_interrumpido");
      assert.equal(llamadas.get(`${C.id}:${x.telefono}`) ?? 0, 0, "no se reenvía a ciegas");
    }
    assert.equal(estadoDe(C.id, iBaja), "excluido|baja_posterior");
    assert.equal(llamadas.get(`${C.id}:${tel(iBaja)}`) ?? 0, 0, "con baja no se envía");
    // La respuesta tardía del ejecutor que se cortó resuelve su incierto.
    const tarde = await supabaseAdmin.rpc("mkt_campania_registrar_envio", { p_destinatario: tomadosMuerto[0].id, p_ejecutor: muerto, p_resultado: "aceptado", p_datos: { wamid: "wamid.TARDE.1" } });
    assert.equal((tarde.data as { estado: string }).estado, "aceptado");
    // El otro lo resuelve un admin: reintentar → la campaña vuelve a ejecutar y lo envía una vez.
    const res = await accion(C.id, { accion: "resolver_incierto", destinatario_id: tomadosMuerto[1].id, decision: "reintentar" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(sql(`select estado from public.mkt_campanias where id = ${lit(C.id)}`), "ejecutando");
    await correrHastaTerminar(C.id, { proveedor: contador(SIN_FALLOS) });
    assert.equal(llamadas.get(`${C.id}:${tomadosMuerto[1].telefono}`), 1);
    // (Una carga del panel no revierte esa baja: el teléfono queda afuera de lo que sigue.)
    assert.throws(() => alta(iBaja), /baja_vigente/);
  }
  console.log("OK — 8: un ejecutor cortado deja 'incierto' (sin reenvío); la baja posterior excluye; la respuesta tardía y el admin lo resuelven.");

  // ═══ 9. Pausa, reanudación y cancelación por las rutas ═════════════════
  {
    assert.equal((await accion(B.id, { accion: "pausar" })).status, 409, "no se pausa lo que no corre");
    assert.equal((await accion(B.id, { accion: "iniciar" })).status, 200);
    assert.equal((await accion(B.id, { accion: "pausar" })).status, 200);
    const enPausa = await accion(B.id, { accion: "ejecutar_lote" });
    assert.equal((enPausa.json.lote as { tomados: number; estado: string }).tomados, 0);
    assert.equal((enPausa.json.lote as { estado: string }).estado, "pausada");
    assert.equal((await accion(B.id, { accion: "reanudar" })).status, 200);
    const uno = await accion(B.id, { accion: "ejecutar_lote", tamano: 1 });
    assert.equal((uno.json.lote as { tomados: number }).tomados, 1);
    const can = await accion(B.id, { accion: "cancelar" });
    assert.equal(can.status, 200);
    assert.equal(can.json.pendientes_cancelados, 1);
    const d = await detalle(B.id);
    assert.equal(d.campania.estado, "cancelada");
    assert.equal(d.destinatarios.length, 2, "el historial queda");
    assert.deepEqual(d.eventos.map((e) => e.tipo).filter((t) => ["iniciar", "pausar", "reanudar", "cancelar"].includes(t)).reverse(), ["iniciar", "pausar", "reanudar", "cancelar"]);
    assert.equal((await accion(B.id, { accion: "reanudar" })).status, 409);
  }
  console.log("OK — 9: en pausa no se envía; reanudar sigue; cancelar pasa los pendientes a 'cancelado' sin borrar nada.");

  // ═══ 10. Errores del proveedor simulado ═════════════════════════════════
  {
    // Transitorio en el 1.er intento: vuelve a la cola con espera y sale en el 2.º.
    const E = await crear({ nombre: `E ${MARCA}`, limite_destinatarios: 2, simulacion: { ...SIN_FALLOS, fallo_transitorio_pct: 100 } });
    await accion(E.id, { accion: "preparar", version: E.version });
    await accion(E.id, { accion: "iniciar" });
    const l1 = await SRV.ejecutarLote(E.id, { esperaReintentoS: 1 });
    assert.ok(l1.ok && l1.valor.transitorios === 2, JSON.stringify(l1));
    const l2 = await SRV.ejecutarLote(E.id, { esperaReintentoS: 1 });
    assert.ok(l2.ok && l2.valor.tomados === 0, "esperan su reintento");
    await dormir(1200);
    const fin = await correrHastaTerminar(E.id, { esperaReintentoS: 1 });
    assert.equal(fin.estado, "completada");
    assert.equal(sql(`select string_agg(distinct estado || ':' || intentos, ',') from public.mkt_campania_destinatarios where campania_id = ${lit(E.id)}`).split(",").every((x) => /^(entregado|no_entregado):2$/.test(x)), true);

    // Definitivo: fallido sin reintentar.
    const F = await crear({ nombre: `F ${MARCA}`, limite_destinatarios: 1, simulacion: { ...SIN_FALLOS, fallo_definitivo_pct: 100 } });
    await accion(F.id, { accion: "preparar", version: F.version });
    await accion(F.id, { accion: "iniciar" });
    await correrHastaTerminar(F.id);
    assert.equal(sql(`select estado || '|' || motivo || '|' || ultimo_codigo || '|' || intentos from public.mkt_campania_destinatarios where campania_id = ${lit(F.id)}`), "fallido|error_definitivo|131026|1");

    // Transitorio que no se arregla: al 3.er intento, fallido por reintentos agotados.
    const T = await crear({ nombre: `T ${MARCA}`, limite_destinatarios: 1 });
    await accion(T.id, { accion: "preparar", version: T.version });
    await accion(T.id, { accion: "iniciar" });
    const siempre = { nombre: "falso" as const, enviarPlantilla: async () => ({ ok: false as const, codigo: "130429", transitorio: true, detalle: "límite (prueba)" }) };
    for (let i = 0; i < 3; i++) {
      const r = await SRV.ejecutarLote(T.id, { proveedor: siempre, esperaReintentoS: 1 });
      assert.ok(r.ok);
      if (i < 2) await dormir(1200);
    }
    assert.equal(sql(`select estado || '|' || motivo || '|' || intentos from public.mkt_campania_destinatarios where campania_id = ${lit(T.id)}`), "fallido|reintentos_agotados|3");

    // Incierto (sin respuesta / tiempo agotado): no se reintenta solo; "Dar por fallido".
    const G = await crear({ nombre: `G ${MARCA}`, limite_destinatarios: 1 });
    await accion(G.id, { accion: "preparar", version: G.version });
    await accion(G.id, { accion: "iniciar" });
    const colgado = { nombre: "falso" as const, enviarPlantilla: () => new Promise<never>(() => {}) };
    const lg = await SRV.ejecutarLote(G.id, { proveedor: colgado, tiempoEnvioMs: 200 });
    assert.ok(lg.ok && lg.valor.inciertos === 1, JSON.stringify(lg));
    assert.equal(sql(`select estado from public.mkt_campanias where id = ${lit(G.id)}`), "completada", "un incierto no deja la campaña colgada");
    const idG = sql(`select id from public.mkt_campania_destinatarios where campania_id = ${lit(G.id)}`);
    const rf = await accion(G.id, { accion: "resolver_incierto", destinatario_id: idG, decision: "fallido" });
    assert.equal(rf.status, 200);
    assert.equal(sql(`select estado || '|' || motivo from public.mkt_campania_destinatarios where id = ${lit(idG)}`), "fallido|incierto_descartado");
  }
  console.log("OK — 10: transitorio reintenta con espera, definitivo falla, reintentos agotados a los 3, incierto espera la decisión de un admin.");

  // ═══ 11. Atribución: regreso al stand por teléfono ══════════════════════
  {
    const entregadoA = sql(`select telefono from public.mkt_campania_destinatarios where campania_id = ${lit(A.id)} and aceptado_en is not null order by orden limit 1`);
    const id = base + 900;
    turnos.push(id);
    sql(`insert into public.turnos_stand (id, nombre, telefono, fecha, hora, estado, total, metodo_pago)
         values (${id}, ${lit(`Regreso ${MARCA}`)}, ${lit(entregadoA)}, ${lit(hoy)}, '20:00', 'confirmado', 12000, 'efectivo')`);
    const d = await detalle(A.id);
    assert.equal(d.atribucion.regresos_stand, 1);
    assert.equal(d.atribucion.reservas_pagadas + d.atribucion.gift_cards_pagadas, 0, "con beneficios ficticios no hay compras");
    assert.equal(d.atribucion.ficticios, 3);
  }
  console.log("OK — 11: la atribución cuenta el regreso al stand; con beneficios ficticios no hay compras atribuibles.");
}

function limpiar() {
  const ids = campanias.map(lit).join(", ") || "''";
  const tels = Array.from({ length: 16 }, (_, i) => lit(tel(i))).join(", ");
  sql(`begin;
       set local session_replication_role = replica;
       delete from public.mkt_whatsapp_envios where campania_id in (select id from public.mkt_campanias where id in (${ids}) or nombre like ${lit(`%${MARCA}%`)});
       delete from public.mkt_campania_eventos where campania_id in (select id from public.mkt_campanias where id in (${ids}) or nombre like ${lit(`%${MARCA}%`)});
       delete from public.mkt_campania_destinatarios where campania_id in (select id from public.mkt_campanias where id in (${ids}) or nombre like ${lit(`%${MARCA}%`)});
       delete from public.mkt_campanias where id in (${ids}) or nombre like ${lit(`%${MARCA}%`)};
       delete from public.mkt_consentimiento_eventos where telefono in (${tels});
       delete from public.turnos_stand where id in (${turnos.join(", ") || "0"});
       delete from public.mkt_textos_consentimiento where version = ${lit(TEXTO)};
       ${vigentePrevio ? `update public.mkt_textos_consentimiento set estado = 'vigente', retirado_en = null, retirado_por_rol = null where version = ${lit(vigentePrevio)};` : ""}
       commit;`);
  assert.equal(sql(`select count(*) from public.mkt_campanias where nombre like ${lit(`%${MARCA}%`)}`), "0");
  assert.equal(sql(`select count(*) from public.mkt_whatsapp_envios e where not exists (select 1 from public.mkt_campania_destinatarios d where d.id = e.destinatario_id)`), "0", "sin intentos huérfanos");
  assert.equal(sql(`select count(*) from public.mkt_consentimiento_eventos where telefono in (${tels})`), "0");
}

main()
  .then(() => { limpiar(); console.log("Limpieza hecha."); })
  .catch((e) => {
    console.error(e);
    try { limpiar(); } catch (err) { console.error("Limpieza falló:", err); }
    process.exit(1);
  });
