// ============================================================================
// Simulación de la audiencia de recuperación del stand (Marketing).
// ----------------------------------------------------------------------------
// SOLO LECTURA contra la base del archivo de entorno (con .env.local, Producción):
//   · el cliente usa un transporte de solo lectura: GET/HEAD al host de la base y
//     nada más (lib/marketing/soloLectura.ts); además, insert/update/upsert/
//     delete y rpc están cortados en el cliente. El script NO intenta ninguna
//     escritura, ni para comprobar que se rechaza: eso se prueba con un transporte
//     simulado en lib/marketing/soloLectura.test.ts;
//   · no imprime nombres y los teléfonos salen enmascarados.
// No crea códigos ni envía nada: el proveedor falso solo cuenta en memoria.
// Consentimientos y bajas salen del registro (vista mkt_consentimiento_estado);
// si la base no lo tiene instalado, el informe lo dice y los simula vacíos.
//
//   npx tsx --env-file=.env.local scripts/marketing/simular.ts --ventana 14
//   npx tsx --env-file=.env.test.local scripts/marketing/simular.ts   # stack local
//
// Opciones (todos los filtros comerciales son opcionales):
//   --ventana 14|21            días hacia atrás (hoy excluido). Por defecto 14.
//   --incluir-gratis           apaga "solo pagos" (por defecto encendido).
//   --excluir-retornados       saca a quien vino 2 o más días (por defecto NO).
//   --indicativos 351,3543     segmento por indicativos OFICIALES completos.
//   --excluir-mensualidades    saca a titulares de mensualidad (lee telefono_norm).
//   --tarifa 0.0618 --moneda USD   tarifa de marketing por mensaje entregado.
//   --limite 50                tope de destinatarios.
//   --presupuesto 10           tope de gasto, en la moneda de la tarifa.
//   --muestra 5                filas enmascaradas a mostrar (máx. 20).
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  MOTIVOS_FILA,
  MOTIVOS_TELEFONO,
  calcularAudiencia,
  enmascararDestino,
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
import { leerRegistroParaAudiencia } from "@/lib/marketing/registroLectura";
import { blindarCliente, crearFetchSoloLectura } from "@/lib/marketing/soloLectura";

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
    config: { ventanaDias: 14, soloPagos: true, excluirRetornados: false },
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
      case "--incluir-gratis": o.config.soloPagos = false; break;
      case "--excluir-retornados": o.config.excluirRetornados = true; break;
      case "--excluir-mensualidades": o.excluirMensualidades = true; break;
      case "--indicativos": {
        const v = argv[++i];
        if (!v || v.startsWith("--")) throw new Error("--indicativos necesita una lista, p. ej. 351,3543.");
        o.config.indicativos = v.split(",").map((c) => c.trim()).filter(Boolean);
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

const LOTE = 1000;

async function main() {
  const o = leerOpciones(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: correr con --env-file.");

  // Cliente PROPIO de solo lectura (no el de la app): transporte GET/HEAD al host
  // de la base y escrituras cortadas en el cliente.
  const transporte = crearFetchSoloLectura(globalThis.fetch.bind(globalThis), new URL(url).host);
  const cliente = blindarCliente(createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transporte.fetch as typeof fetch },
  }));

  const ahora = new Date();
  const { hoy, desde, hasta } = ventanaAudiencia(ahora, o.config.ventanaDias);

  // Desde el primer día de la ventana HASTA HOY: hoy no es visita de la ventana,
  // pero dice si alguien ya volvió. Paginado (PostgREST corta en 1000) y
  // contrastado con un conteo exacto.
  async function leerTurnos(): Promise<{ filas: TurnoAudiencia[]; esperado: number }> {
    const { count, error: errCount } = await cliente
      .from("turnos_stand").select("id", { count: "exact", head: true }).gte("fecha", desde).lte("fecha", hoy);
    if (errCount) throw errCount;
    const filas: TurnoAudiencia[] = [];
    for (let i = 0; ; i += LOTE) {
      const { data, error } = await cliente
        .from("turnos_stand")
        .select("id, nombre, telefono, fecha, estado, total, metodo_pago")
        .gte("fecha", desde).lte("fecha", hoy)
        .order("id", { ascending: true }).range(i, i + LOTE - 1);
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
      const { data, error } = await cliente
        .from("mensualidades").select("telefono_norm").not("telefono_norm", "is", null)
        .order("id", { ascending: true }).range(i, i + LOTE - 1);
      if (error) throw error;
      for (const f of (data ?? []) as { telefono_norm: string }[]) otrasExclusiones.set(f.telefono_norm, "titular_mensualidad");
      if (!data || data.length < LOTE) break;
    }
  }

  const registro = await leerRegistroParaAudiencia(cliente);
  if (!registro.ok) throw new Error(`No se pudo leer el registro de consentimiento: ${registro.causa}`);

  const r = calcularAudiencia(lectura.filas, o.config, {
    ahora,
    consentimientos: new Set(registro.valor.consentimientos.keys()),
    bajas: registro.valor.bajas,
    otrasExclusiones,
  });
  const elegiblesPorFuente = new Map<string, number>();
  for (const d of r.elegibles) {
    const f = registro.valor.consentimientos.get(d.telefono) ?? "?";
    elegiblesPorFuente.set(f, (elegiblesPorFuente.get(f) ?? 0) + 1);
  }

  // ── Envío simulado: proveedor falso en memoria, sin códigos reales ────────
  let costo: EstimacionCosto | null = null;
  let enviables = o.limite === null ? r.elegibles.length : Math.min(o.limite, r.elegibles.length);
  if (o.tarifa !== null) {
    costo = estimarCosto({
      destinatarios: r.elegibles.length, tarifaPorEntregado: o.tarifa, moneda: o.moneda,
      limiteDestinatarios: o.limite, presupuestoMaximo: o.presupuesto,
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
  const porIndicativo = (lista: Destinatario[]) => {
    const m = new Map<string, number>();
    let sin = 0;
    for (const d of lista) {
      if (!d.indicativo) { sin++; continue; }
      const k = `${d.indicativo} ${d.areaNumeracion}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    const top = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12);
    return `${top.map(([k, n]) => `${k}: ${n}`).join(" · ") || "—"}${m.size > 12 ? ` · (+${m.size - 12} indicativos)` : ""} · sin indicativo determinable: ${sin}`;
  };
  const muestra = (lista: Destinatario[]) =>
    lista.slice(0, o.muestra).map((d) =>
      `  ${enmascararDestino(d.telefono)} · indicativo ${d.indicativo ?? "indeterminado"} · última visita ${d.ultimaVisita} · ${d.visitas} turno(s) · ${d.diasConVisita} día(s)${d.variosNombres ? " · varios nombres" : ""}`);
  const f = r.filtros;
  const si = (b: boolean) => (b ? "SÍ" : "no");

  linea("Simulación de audiencia · SOLO LECTURA · no se envía ni se guarda nada");
  linea(`Hoy (Argentina): ${hoy} · ventana de ${r.ventanaDias} días: ${desde} a ${hasta} (hoy excluido)`);
  linea(`Lectura: ${lectura.filas.length} filas de turnos_stand · conteo exacto ${lectura.esperado} · ${consistente ? "consistente" : "INCONSISTENTE: no usar estos números"}`);
  linea(
    registro.valor.instalado
      ? `Registro de consentimiento: ${registro.valor.consentimientos.size} con alta vigente · ${registro.valor.bajas.size} con baja (todas las fechas)`
      : "Registro de consentimiento: NO instalado en esta base (falta db/marketing-consentimiento.sql) → se simula vacío",
  );
  linea();
  linea("Filtros (todos configurables) y su efecto en esta corrida:");
  linea(`  ventana ${f.ventana.desde}..${f.ventana.hasta}: ${f.ventana.filasEnVentana} filas adentro · ${f.ventana.filasFuera} afuera (hoy, anteriores o futuras)`);
  linea(`  solo pagos: ${si(f.soloPagos.activo)} · excluyó ${f.soloPagos.filasExcluidas} fila(s) · alcanza a ${f.soloPagos.filasAfectables}`);
  linea(`  excluir a quien ya volvió: ${si(f.excluirRetornados.activo)} · excluyó ${f.excluirRetornados.telefonosExcluidos} teléfono(s) · alcanza a ${f.excluirRetornados.telefonosAfectables}`);
  linea(`  segmento por indicativo: ${f.segmento.activo ? f.segmento.indicativos.join(", ") : "no"} · fuera ${f.segmento.telefonosFuera} · indeterminados ${f.segmento.telefonosIndeterminados}`);
  linea(`  titulares de mensualidad: ${o.excluirMensualidades ? `SÍ (${otrasExclusiones.size} en la base) · excluyó ${r.telefonos.excluidos.titular_mensualidad}` : "no"}`);
  linea(`  bajas: excluyó ${f.bajas.telefonosExcluidos} · sin consentimiento: ${f.consentimiento.telefonosSin}`);
  linea();
  linea(`Filas en la ventana: ${r.filas.enVentana} · válidas ${r.filas.validas}`);
  linea(`  excluidas: ${conteo(r.filas.excluidas, MOTIVOS_FILA)}`);
  linea(`  no normalizables por motivo: ${conteo(r.filas.rechazosTelefono as Record<string, number>, Object.keys(r.filas.rechazosTelefono).sort())}`);
  linea();
  linea(`Teléfonos únicos: ${r.telefonos.unicos} · sin indicativo determinable: ${r.telefonos.sinIndicativo}`);
  linea(`  ELEGIBLES: ${r.telefonos.elegibles}${r.telefonos.elegibles ? ` (por fuente del consentimiento: ${[...elegiblesPorFuente.entries()].map(([k, n]) => `${k} ${n}`).join(" · ")})` : ""}`);
  linea(`  excluidos: ${conteo(r.telefonos.excluidos, MOTIVOS_TELEFONO)}`);
  if (o.muestra > 0 && r.elegibles.length > 0) {
    linea(`  muestra enmascarada de elegibles (${Math.min(o.muestra, r.elegibles.length)}):`);
    for (const l of muestra(r.elegibles)) linea(l);
  }
  linea();
  linea(`Pendientes de consentimiento (pasan todo lo demás; NO se les escribe): ${r.pendientesConsentimiento.length}`);
  linea(`  por indicativo (área de NUMERACIÓN de ENACOM, no residencia): ${porIndicativo(r.pendientesConsentimiento)}`);
  if (o.muestra > 0 && r.pendientesConsentimiento.length > 0) {
    linea(`  muestra enmascarada (${Math.min(o.muestra, r.pendientesConsentimiento.length)}):`);
    for (const l of muestra(r.pendientesConsentimiento)) linea(l);
  }
  linea();
  linea(`Envío simulado (proveedor falso en memoria): ${proveedor.enviados.length} mensaje(s)`);
  if (o.tarifa !== null) {
    const potencial = estimarCosto({
      destinatarios: r.pendientesConsentimiento.length, tarifaPorEntregado: o.tarifa, moneda: o.moneda,
      limiteDestinatarios: o.limite, presupuestoMaximo: o.presupuesto,
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
  const pedidos = transporte.pedidos();
  const porMetodo = pedidos.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.metodo]: (acc[p.metodo] ?? 0) + 1 }), {});
  linea(`Transporte de solo lectura: ${pedidos.length} pedido(s) (${Object.entries(porMetodo).map(([m, n]) => `${m} ${n}`).join(" · ")}) · cortados antes de salir: ${transporte.bloqueados()}`);
  if (transporte.bloqueados() > 0) {
    console.error("Algo intentó escribir o salir a otro host: revisar antes de usar estos números.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
