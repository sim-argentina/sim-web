// ============================================================================
// Simulación de la audiencia de recuperación del stand (Marketing · Etapa 1).
// ----------------------------------------------------------------------------
// SOLO LECTURA contra la base de .env.local (hoy, Producción):
//   · un guardián de red deja salir solo GET/HEAD al host de Supabase;
//   · insert/update/upsert/delete/rpc del cliente abortan antes de salir;
//   · no imprime nombres y los teléfonos salen enmascarados.
// No crea códigos ni envía nada: el proveedor falso solo cuenta en memoria.
// No existe todavía una fuente de consentimiento ni de bajas (19/10/2026): se
// simulan VACÍAS, y por eso la audiencia elegible da 0.
//
//   npx tsx --env-file=.env.local scripts/marketing/simular.ts --ventana 14
//
// Opciones:
//   --ventana 14|21            días hacia atrás (hoy excluido). Por defecto 14.
//   --incluir-gratis           cuenta también turnos gratis o sin cobro.
//   --codigos-area 351,3543    lista explícita de códigos de área completos.
//   --excluir-retornados       saca a quien vino 2 o más días (hoy incluido).
//   --excluir-mensualidades    saca a titulares de mensualidad (lee telefono_norm).
//   --tarifa 0.0618 --moneda USD   tarifa de marketing por mensaje entregado.
//   --limite 50                tope de destinatarios.
//   --presupuesto 10           tope de gasto, en la moneda de la tarifa.
//   --muestra 5                filas enmascaradas a mostrar (máx. 20).
// ============================================================================

import {
  MOTIVOS_FILA,
  MOTIVOS_TELEFONO,
  calcularAudiencia,
  enmascararDestino,
  prefijoReporte,
  validarConfigAudiencia,
  ventanaAudiencia,
  type ConfigAudiencia,
  type Destinatario,
  type MotivoExterno,
  type TurnoAudiencia,
  type VentanaAudiencia,
} from "@/lib/marketing/audiencia";
import { estimarCosto, type EstimacionCosto } from "@/lib/marketing/costo";
import { crearProveedorFalso } from "@/lib/marketing/proveedorWhatsapp";

type Opciones = {
  config: ConfigAudiencia;
  excluirMensualidades: boolean;
  tarifa: number | null;
  moneda: string;
  limite: number | null;
  presupuesto: number | null;
  muestra: number;
};

function leerOpciones(argv: string[]): Opciones {
  const o: Opciones = {
    config: { ventanaDias: 14 },
    excluirMensualidades: false,
    tarifa: null,
    moneda: "USD",
    limite: null,
    presupuesto: null,
    muestra: 5,
  };
  const numero = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (v === undefined || v.startsWith("--") || !Number.isFinite(n)) throw new Error(`${flag} necesita un número.`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--ventana": o.config.ventanaDias = numero(a, argv[++i]) as VentanaAudiencia; break;
      case "--incluir-gratis": o.config.incluirGratis = true; break;
      case "--excluir-retornados": o.config.excluirRetornados = true; break;
      case "--excluir-mensualidades": o.excluirMensualidades = true; break;
      case "--codigos-area": {
        const v = argv[++i];
        if (!v || v.startsWith("--")) throw new Error("--codigos-area necesita una lista, p. ej. 351,3543.");
        o.config.codigosArea = v.split(",").map((c) => c.trim()).filter(Boolean);
        break;
      }
      case "--tarifa": o.tarifa = numero(a, argv[++i]); break;
      case "--moneda": o.moneda = String(argv[++i] ?? "").trim(); break;
      case "--limite": o.limite = numero(a, argv[++i]); break;
      case "--presupuesto": o.presupuesto = numero(a, argv[++i]); break;
      case "--muestra": o.muestra = Math.min(20, Math.max(0, Math.floor(numero(a, argv[++i])))); break;
      default: throw new Error(`Opción desconocida: ${a}`);
    }
  }
  const errores = validarConfigAudiencia(o.config);
  if (errores.length > 0) throw new Error(errores.join(" "));
  if (o.presupuesto !== null && o.tarifa === null) throw new Error("--presupuesto necesita --tarifa.");
  if (o.limite !== null && (!Number.isInteger(o.limite) || o.limite < 0)) throw new Error("--limite tiene que ser un entero ≥ 0.");
  return o;
}

/** Guardián de red: solo GET/HEAD al host de la base. Se instala ANTES de crear el cliente. */
function instalarGuardianDeRed(): { pedidos: () => number } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL: correr con --env-file=.env.local.");
  const host = new URL(url).host;
  const original = globalThis.fetch;
  let pedidos = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const destino = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const metodo = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (destino.host !== host) throw new Error(`solo lectura: host no permitido (${destino.host})`);
    if (metodo !== "GET" && metodo !== "HEAD") throw new Error(`solo lectura: ${metodo} bloqueado`);
    pedidos++;
    return original(input, init);
  }) as typeof fetch;
  return { pedidos: () => pedidos };
}

const LOTE = 1000;

async function main() {
  const o = leerOpciones(process.argv.slice(2));
  const red = instalarGuardianDeRed();

  // El cliente se crea DESPUÉS del guardián, así usa el fetch vigilado.
  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
  const cliente = supabaseAdmin as unknown as Record<string, unknown>;
  const fromOriginal = cliente.from as (t: string) => Record<string, unknown>;
  cliente.from = (t: string) => {
    const q = fromOriginal.call(supabaseAdmin, t);
    for (const escritura of ["insert", "update", "upsert", "delete"]) {
      q[escritura] = () => { throw new Error(`solo lectura: ${escritura} sobre ${t}`); };
    }
    return q;
  };
  cliente.rpc = () => { throw new Error("solo lectura: rpc"); };

  // Autoverificación en cada corrida: una escritura tiene que fallar ANTES de
  // salir. Si alguna pasara, se aborta sin leer nada.
  const bloqueos: string[] = [];
  const intentar = async (nombre: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("solo lectura")) { bloqueos.push(nombre); return; }
      throw e;
    }
    throw new Error(`El guardián dejó pasar ${nombre}: abortado sin leer datos.`);
  };
  const antes = red.pedidos();
  await intentar("POST", () => fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/turnos_stand`, { method: "POST", body: "{}" }));
  await intentar("insert", () => supabaseAdmin.from("turnos_stand").insert({}));
  await intentar("rpc", () => supabaseAdmin.rpc("consumir_codigo_descuento", { p_codigo: "X" }));
  if (red.pedidos() !== antes) throw new Error("Una escritura bloqueada llegó a la red: abortado.");

  const ahora = new Date();
  const { hoy, desde, hasta } = ventanaAudiencia(ahora, o.config.ventanaDias);

  // Desde el primer día de la ventana HASTA HOY: hoy no es visita de la ventana,
  // pero dice si alguien ya volvió. Paginado (PostgREST corta en 1000) y
  // contrastado con un conteo exacto.
  async function leerTurnos(): Promise<{ filas: TurnoAudiencia[]; esperado: number }> {
    const { count, error: errCount } = await supabaseAdmin
      .from("turnos_stand")
      .select("id", { count: "exact", head: true })
      .gte("fecha", desde)
      .lte("fecha", hoy);
    if (errCount) throw errCount;
    const filas: TurnoAudiencia[] = [];
    for (let i = 0; ; i += LOTE) {
      const { data, error } = await supabaseAdmin
        .from("turnos_stand")
        .select("id, nombre, telefono, fecha, estado, total, metodo_pago")
        .gte("fecha", desde)
        .lte("fecha", hoy)
        .order("id", { ascending: true })
        .range(i, i + LOTE - 1);
      if (error) throw error;
      filas.push(...((data ?? []) as TurnoAudiencia[]));
      if (!data || data.length < LOTE) break;
    }
    return { filas, esperado: count ?? -1 };
  }

  let lectura = await leerTurnos();
  if (lectura.filas.length !== lectura.esperado) lectura = await leerTurnos();
  const consistente = lectura.filas.length === lectura.esperado;

  const otrasExclusiones = new Map<string, MotivoExterno>();
  if (o.excluirMensualidades) {
    for (let i = 0; ; i += LOTE) {
      const { data, error } = await supabaseAdmin
        .from("mensualidades")
        .select("telefono_norm")
        .not("telefono_norm", "is", null)
        .order("id", { ascending: true })
        .range(i, i + LOTE - 1);
      if (error) throw error;
      for (const f of (data ?? []) as { telefono_norm: string }[]) otrasExclusiones.set(f.telefono_norm, "titular_mensualidad");
      if (!data || data.length < LOTE) break;
    }
  }

  const r = calcularAudiencia(lectura.filas, o.config, {
    ahora,
    consentimientos: new Set(), // no existe fuente de consentimiento todavía
    bajas: new Set(), // ni de bajas
    otrasExclusiones,
  });

  // ── Envío simulado: proveedor falso en memoria, sin códigos reales ────────
  let costo: EstimacionCosto | null = null;
  let enviables = o.limite === null ? r.elegibles.length : Math.min(o.limite, r.elegibles.length);
  if (o.tarifa !== null) {
    costo = estimarCosto({
      destinatarios: r.elegibles.length,
      tarifaPorEntregado: o.tarifa,
      moneda: o.moneda,
      limiteDestinatarios: o.limite,
      presupuestoMaximo: o.presupuesto,
    });
    enviables = costo.enviables;
  }
  const proveedor = crearProveedorFalso();
  for (const d of r.elegibles.slice(0, enviables)) {
    await proveedor.enviarPlantilla({
      destino: d.destinoWhatsapp,
      plantilla: "simulacion_recuperacion_stand",
      idioma: "es_AR",
      variables: [d.nombre ?? ""],
      codigoCupon: null, // la simulación nunca genera códigos
      claveIdempotencia: `simulacion:${d.telefono}`,
    });
  }

  // ── Informe: conteos y muestras enmascaradas, nunca nombres ───────────────
  const linea = (s = "") => console.log(s);
  const conteo = (obj: Record<string, number>, orden: readonly string[]) =>
    orden.filter((k) => obj[k]).map((k) => `${k} ${obj[k]}`).join(" · ") || "ninguna";
  const prefijos = (lista: Destinatario[]) => {
    const m = new Map<string, number>();
    for (const d of lista) m.set(prefijoReporte(d.telefono), (m.get(prefijoReporte(d.telefono)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p, n]) => `${p}: ${n}`).join(" · ") || "—";
  };
  const muestra = (lista: Destinatario[]) =>
    lista.slice(0, o.muestra).map((d) =>
      `  ${enmascararDestino(d.telefono)} · última visita ${d.ultimaVisita} · ${d.visitas} turno(s) · ${d.diasConVisita} día(s)${d.variosNombres ? " · varios nombres" : ""}`);

  linea("Simulación de audiencia · SOLO LECTURA · no se envía ni se guarda nada");
  linea(`Hoy (Argentina): ${hoy} · ventana de ${r.ventanaDias} días: ${desde} a ${hasta} (hoy excluido)`);
  linea(
    `Configuración: ${o.config.incluirGratis ? "pagos y gratis" : "solo pagos"} · segmento: ${o.config.codigosArea?.length ? o.config.codigosArea.join(", ") : "sin filtro"}` +
      ` · excluir retornados: ${o.config.excluirRetornados ? "sí" : "no"} · excluir mensualidades: ${o.excluirMensualidades ? `sí (${otrasExclusiones.size} teléfono${otrasExclusiones.size === 1 ? "" : "s"})` : "no"}`,
  );
  linea(`Lectura: ${lectura.filas.length} filas de turnos_stand · conteo exacto ${lectura.esperado} · ${consistente ? "consistente" : "INCONSISTENTE: no usar estos números"}`);
  linea();
  linea(`Filas en la ventana: ${r.filas.enVentana} · válidas ${r.filas.validas}`);
  linea(`  excluidas: ${conteo(r.filas.excluidas, MOTIVOS_FILA)}`);
  linea(`  no normalizables por motivo: ${conteo(r.filas.rechazosTelefono as Record<string, number>, Object.keys(r.filas.rechazosTelefono).sort())}`);
  linea(`  fuera de la ventana: de hoy ${r.filas.deHoy} · anteriores ${r.filas.fueraDeVentana} · futuras ${r.filas.futuras} · fecha inválida ${r.filas.fechaInvalida}`);
  linea();
  linea(`Teléfonos únicos: ${r.telefonos.unicos}`);
  linea(`  ELEGIBLES: ${r.telefonos.elegibles}`);
  linea(`  excluidos: ${conteo(r.telefonos.excluidos, MOTIVOS_TELEFONO)}`);
  linea(`  con varios nombres (sin personalizar): ${r.excluidos.filter((x) => x.destinatario.variosNombres).length + r.elegibles.filter((d) => d.variosNombres).length}`);
  linea(`  volvieron otro día (hoy incluido): ${[...r.elegibles, ...r.excluidos.map((x) => x.destinatario)].filter((d) => d.diasConVisita >= 2).length}`);
  linea();
  linea(`Pendientes de consentimiento (pasan todo lo demás; NO se les escribe): ${r.pendientesConsentimiento.length}`);
  linea(`  prefijos (no son localidades): ${prefijos(r.pendientesConsentimiento)}`);
  if (o.muestra > 0 && r.pendientesConsentimiento.length > 0) {
    linea(`  muestra enmascarada (${Math.min(o.muestra, r.pendientesConsentimiento.length)}):`);
    for (const l of muestra(r.pendientesConsentimiento)) linea(l);
  }
  linea();
  linea(`Envío simulado (proveedor falso en memoria): ${proveedor.enviados.length} mensaje(s)`);
  if (o.tarifa !== null) {
    const potencial = estimarCosto({
      destinatarios: r.pendientesConsentimiento.length,
      tarifaPorEntregado: o.tarifa,
      moneda: o.moneda,
      limiteDestinatarios: o.limite,
      presupuestoMaximo: o.presupuesto,
    });
    const recorte = (c: EstimacionCosto) => (c.recortadoPor.length ? ` (recortado por ${c.recortadoPor.join(" y ")})` : "");
    linea(`Costo máximo con tarifa ${o.tarifa} ${o.moneda} por entregado:`);
    linea(`  elegibles: ${costo!.enviables} envío(s) → ${costo!.costoMaximo} ${costo!.moneda}${recorte(costo!)}`);
    linea(`  si los pendientes dieran su consentimiento: ${potencial.enviables} envío(s) → ${potencial.costoMaximo} ${potencial.moneda}${recorte(potencial)}`);
  }
  if (r.advertencias.length > 0) {
    linea();
    linea("Advertencias:");
    for (const a of r.advertencias) linea(`  · ${a}`);
  }
  linea();
  linea(`Pedidos a la base: ${red.pedidos()} (solo GET/HEAD) · escrituras bloqueadas en la autoverificación: ${bloqueos.join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
