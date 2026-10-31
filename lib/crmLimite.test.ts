import { strict as assert } from "node:assert";
import { LIMITES_INGRESO, LimitadorCrm, controlarIp, controlarUsuario, registrarFalloUsuario } from "@/lib/crmLimite";

// Ejecutar: npx tsx lib/crmLimite.test.ts
// Límite de intentos del ingreso comercial (CRM B0.1), puro: reloj controlado y un
// Upstash simulado en memoria (INCR, PEXPIRE NX, PTTL, GET) que se puede "romper".
// Cubre: límite normal, remoto caído / con timeout / con error HTTP / con respuesta
// inválida (sigue limitando con el respaldo), recuperación del remoto y bloqueos
// que no se prolongan con nuevos rechazos.

type Modo = "ok" | "caido" | "timeout" | "http500" | "basura";

class UpstashFalso {
  modo: Modo = "ok";
  llamadas = 0;
  datos = new Map<string, { v: number; expira: number | null }>();
  constructor(private ahora: () => number) {}

  private vigente(k: string) {
    const e = this.datos.get(k);
    if (e && e.expira !== null && e.expira <= this.ahora()) {
      this.datos.delete(k);
      return undefined;
    }
    return e;
  }

  private ejecutar([cmd, k, ...a]: string[]): unknown {
    if (cmd === "INCR") {
      const e = this.vigente(k) ?? { v: 0, expira: null };
      e.v++;
      this.datos.set(k, e);
      return e.v;
    }
    if (cmd === "PEXPIRE") {
      const e = this.vigente(k);
      if (!e) return 0;
      if (a[1] === "NX" && e.expira !== null) return 0;
      e.expira = this.ahora() + Number(a[0]);
      return 1;
    }
    if (cmd === "PTTL") {
      const e = this.vigente(k);
      return !e ? -2 : e.expira === null ? -1 : e.expira - this.ahora();
    }
    if (cmd === "GET") {
      const e = this.vigente(k);
      return e ? String(e.v) : null;
    }
    throw new Error(`comando inesperado ${cmd}`);
  }

  fetch = (async (_url: unknown, init?: RequestInit) => {
    this.llamadas++;
    if (this.modo === "caido") throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.9:443");
    if (this.modo === "timeout") {
      // El temporizador de AbortSignal.timeout no mantiene vivo el proceso (en la
      // realidad lo hace el socket abierto): este setTimeout ocupa ese lugar.
      const vivo = setTimeout(() => {}, 10_000);
      return new Promise<Response>((_, rechazar) => {
        init!.signal!.addEventListener("abort", () => { clearTimeout(vivo); rechazar(init!.signal!.reason); });
      });
    }
    if (this.modo === "http500") return new Response("upstash interno", { status: 500 });
    if (this.modo === "basura") return new Response("{no es json", { status: 200 });
    const comandos = JSON.parse(String(init!.body)) as string[][];
    return new Response(JSON.stringify(comandos.map((c) => ({ result: this.ejecutar(c) }))), { status: 200 });
  }) as typeof fetch;
}

const avisos: string[] = [];
const warnOriginal = console.warn.bind(console);
console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

function armar(conRemoto: boolean) {
  let t = 1_000_000;
  const reloj = { avanzar: (ms: number) => { t += ms; }, ahora: () => t };
  const remoto = new UpstashFalso(reloj.ahora);
  const l = new LimitadorCrm({
    ahora: reloj.ahora,
    fetch: remoto.fetch,
    remoto: () => (conRemoto ? { url: "https://upstash.ejemplo.invalid", token: "token-secreto-de-prueba" } : null),
    timeoutMs: 40,
  });
  return { l, remoto, reloj };
}

async function intentosIp(l: LimitadorCrm, n: number, ip = "10.0.0.1") {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push((await controlarIp(ip, l)).permitido);
  return out;
}

async function main() {
  const { maximo: MAX_IP, ventanaMs: V_IP } = LIMITES_INGRESO.ip;
  const { maximo: MAX_U, ventanaMs: V_U } = LIMITES_INGRESO.usuario;
  const esperado = (n: number, max: number) => Array.from({ length: n }, (_, i) => i < max);

  // ── 1) Límite normal (solo memoria, sin remoto configurado) ─────────────
  {
    const { l, remoto, reloj } = armar(false);
    assert.deepEqual(await intentosIp(l, MAX_IP + 2), esperado(MAX_IP + 2, MAX_IP), "8 por minuto por IP");
    const d = await controlarIp("10.0.0.1", l);
    assert.equal(d.fuente, "memoria");
    assert.ok(d.reintentarEnMs > 0 && d.reintentarEnMs <= V_IP, "informa cuánto falta");
    assert.equal((await controlarIp("10.0.0.2", l)).permitido, true, "otra IP no está afectada");
    reloj.avanzar(V_IP);
    assert.equal((await controlarIp("10.0.0.1", l)).permitido, true, "vence la ventana");
    assert.equal(remoto.llamadas, 0, "sin remoto configurado no hay llamadas");
  }

  // ── 2) Remoto funcionando: decide el remoto ─────────────────────────────
  {
    const { l, remoto } = armar(true);
    assert.deepEqual(await intentosIp(l, MAX_IP + 1), esperado(MAX_IP + 1, MAX_IP));
    assert.equal((await controlarIp("10.0.0.1", l)).fuente, "remoto");
    assert.ok(remoto.llamadas >= MAX_IP + 1, "cada intento consulta al remoto");
    // El remoto es la fuente de verdad: otra instancia (otro limitador, misma base remota)
    // ve la cuenta compartida.
    const otra = new LimitadorCrm({ ahora: () => 1_000_000, fetch: remoto.fetch, remoto: () => ({ url: "x", token: "y" }), timeoutMs: 40 });
    assert.equal((await controlarIp("10.0.0.1", otra)).permitido, false, "cuenta compartida entre instancias vía remoto");
  }

  // ── 3) Remoto caído, con timeout, con 500 o con basura: sigue limitando ──
  for (const modo of ["caido", "timeout", "http500", "basura"] as Modo[]) {
    const { l, remoto } = armar(true);
    remoto.modo = modo;
    const t0 = Date.now();
    const r = await intentosIp(l, MAX_IP + 2);
    assert.deepEqual(r, esperado(MAX_IP + 2, MAX_IP), `${modo}: el respaldo en memoria mantiene el límite (no deja pasar)`);
    const d = await controlarIp("10.0.0.1", l);
    assert.equal(d.fuente, "memoria", `${modo}: decide el respaldo`);
    if (modo === "timeout") assert.ok(Date.now() - t0 < 2000, "el tope de tiempo corta la espera");
  }

  // ── 4) Caída a mitad de ventana: el respaldo ya trae la cuenta ───────────
  {
    const { l, remoto } = armar(true);
    assert.deepEqual(await intentosIp(l, 5), esperado(5, MAX_IP), "5 intentos con remoto");
    remoto.modo = "caido";
    assert.deepEqual(await intentosIp(l, 4), [true, true, true, false], "al caer, el respaldo sigue desde 5 (6, 7, 8 y bloquea)");
  }

  // ── 5) Recuperación del remoto ──────────────────────────────────────────
  {
    const { l, remoto, reloj } = armar(true);
    remoto.modo = "caido";
    await intentosIp(l, 3);
    remoto.modo = "ok";
    const d = await controlarIp("10.0.0.1", l);
    assert.equal(d.fuente, "remoto", "vuelve a decidir el remoto");
    assert.equal(d.permitido, true);
    reloj.avanzar(V_IP);
    assert.deepEqual(await intentosIp(l, MAX_IP + 1), esperado(MAX_IP + 1, MAX_IP), "y limita normalmente");
  }

  // ── 6) Usuario: solo fallos; el bloqueo vence y los rechazos no lo prolongan ──
  for (const conRemoto of [false, true]) {
    const etiqueta = conRemoto ? "remoto" : "memoria";
    const { l, reloj } = armar(conRemoto);
    for (let i = 0; i < MAX_U; i++) {
      assert.equal((await controlarUsuario("tobias", l)).permitido, true, `${etiqueta}: intento ${i + 1} permitido`);
      await registrarFalloUsuario("tobias", l);
      reloj.avanzar(1000);
    }
    const inicio = 1_000_000;
    const bloqueado = await controlarUsuario("tobias", l);
    assert.equal(bloqueado.permitido, false, `${etiqueta}: bloqueado tras ${MAX_U} fallos`);
    // Durante el bloqueo, cada minuto alguien insiste: se rechaza sin sumar.
    while (reloj.ahora() < inicio + V_U - 60_000) {
      reloj.avanzar(60_000);
      assert.equal((await controlarUsuario("tobias", l)).permitido, false, `${etiqueta}: sigue bloqueado`);
    }
    // El vencimiento lo fijó el PRIMER fallo: inicio + ventana.
    const falta = inicio + V_U - reloj.ahora();
    assert.ok(falta > 0);
    reloj.avanzar(falta - 1);
    assert.equal((await controlarUsuario("tobias", l)).permitido, false, `${etiqueta}: un milisegundo antes del vencimiento`);
    reloj.avanzar(1);
    assert.equal((await controlarUsuario("tobias", l)).permitido, true, `${etiqueta}: vence a la hora fijada, sin prolongarse`);
    assert.equal((await controlarUsuario("otro", l)).permitido, true, `${etiqueta}: otro usuario no estaba bloqueado`);
  }

  // IP: los intentos rechazados SÍ se cuentan, pero el vencimiento no se corre.
  for (const conRemoto of [false, true]) {
    const { l, reloj } = armar(conRemoto);
    await intentosIp(l, MAX_IP);
    for (let i = 0; i < 50; i++) {
      reloj.avanzar(1000);
      assert.equal((await controlarIp("10.0.0.1", l)).permitido, false);
      if (reloj.ahora() >= 1_000_000 + V_IP - 1000) break;
    }
    reloj.avanzar(1_000_000 + V_IP - reloj.ahora());
    assert.equal((await controlarIp("10.0.0.1", l)).permitido, true, `IP (${conRemoto ? "remoto" : "memoria"}): vence a la hora fijada pese a los rechazos`);
  }

  // Clave remota sin vencimiento (anomalía): el próximo intento se lo pone (PEXPIRE NX).
  {
    const { l, remoto, reloj } = armar(true);
    remoto.datos.set("crm:ingreso:ip:10.0.0.7", { v: 100, expira: null });
    assert.equal((await controlarIp("10.0.0.7", l)).permitido, false);
    reloj.avanzar(V_IP);
    assert.equal((await controlarIp("10.0.0.7", l)).permitido, true, "una clave sin TTL no bloquea para siempre");
  }

  // ── 7) Avisos: sin detalles de infraestructura y sin inundar el log ──────
  const respaldo = avisos.filter((a) => a.includes("crm_limite_respaldo_memoria"));
  assert.ok(respaldo.length >= 4, "se registra que se usó el respaldo");
  assert.ok(respaldo.every((a) => /^\[sec\] crm_limite_respaldo_memoria motivo=(red|tiempo|http|respuesta)$/.test(a)), "el aviso dice solo el motivo");
  for (const m of ["red", "tiempo", "http", "respuesta"]) assert.ok(respaldo.some((a) => a.endsWith(`motivo=${m}`)), `motivo ${m} registrado`);
  assert.ok(avisos.every((a) => !/upstash\.ejemplo|token-secreto|ECONNREFUSED|10\.0\.0\.9|upstash interno/i.test(a)), "sin URL, token ni mensaje del proveedor");
  const { l: l2, remoto: r2 } = armar(true);
  r2.modo = "caido";
  const antes = avisos.length;
  await intentosIp(l2, 5);
  assert.equal(avisos.length - antes, 1, "un aviso por minuto por instancia, no uno por intento");

  console.warn = warnOriginal;
  console.log("OK — crmLimite: límite normal, respaldo ante caída/timeout/500/respuesta inválida, recuperación y bloqueos sin prolongación.");
}

main().catch((e) => {
  console.warn = warnOriginal;
  console.error(e);
  process.exit(1);
});
