// IA SIM · Bloque 5A — Enrutamiento INTERNAL-FIRST, determinístico y auditable.
//
// Por qué existe: lib/ia/web/decision.ts decide si una consulta NECESITA internet, pero no
// decide de qué se trata la consulta. En producción, "la facturación de agosto de 2026" terminó
// en la rama web porque el detector de tema interno usaba /\b(...|factur|...)\b: el \b final
// convierte el prefijo "factur" en palabra exacta, así que "facturación" NUNCA matcheaba, y
// como el texto mencionaba un año ("2026") la consulta quedó clasificada como "información
// cambiante" → Tavily → síntesis estructurada externa → salida inválida (esa rama exige al
// menos un actor externo, imposible para una pregunta interna).
//
// Acá la clasificación es explícita, con prefijos de verdad, y el resultado manda: una consulta
// INTERNA bloquea la web del lado del servidor, no por confianza en lo que elija el modelo.

import { contienePII } from "@/lib/ia/web/sanitizar";

export type Ruta = "interna" | "externa" | "mixta" | "conocimiento" | "ambigua";

export type DecisionRuta = {
  ruta: Ruta;
  // Códigos AUDITABLES (no razonamiento): qué señales dispararon la clasificación.
  senales: string[];
  // Permiso EFECTIVO de búsqueda web para este turno. El servidor lo respeta a rajatabla.
  webPermitida: boolean;
  motivo: string;
};

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Temas INTERNOS de SIM. Son PREFIJOS reales (sin \b de cierre): "factur" tiene que matchear
// facturación/facturar/facturado, que es justamente lo que fallaba.
const TEMA_INTERNO: Array<{ id: string; re: RegExp }> = [
  { id: "facturacion", re: /\bfactur/ },
  { id: "ingresos", re: /\bingres/ },
  { id: "costos", re: /\bcost/ },
  { id: "gastos", re: /\bgast/ },
  { id: "ganancia", re: /\bganan|\brentab/ },
  { id: "turnos", re: /\bturno/ },
  { id: "personas", re: /\bpersona/ },
  { id: "operaciones", re: /\boperacion/ },
  { id: "minutos", re: /\bminuto/ },
  { id: "horas", re: /\bhora(s|rio)?\b|\bhs\b/ },
  { id: "reservas", re: /\breserva/ },
  { id: "mensualidades", re: /\bmensualidad/ },
  { id: "gift_cards", re: /\bgift ?card|\btarjeta de regalo/ },
  { id: "campeonatos", re: /\bcampeonato|\binscripcion/ },
  { id: "cronograma", re: /\bcronograma|\bjornada/ },
  { id: "empleados", re: /\bemplead|\bequipo\b|\bramiro\b|\brami\b|\bfrancisco\b|\bfran\b|\bfederico\b|\bfede\b/ },
  { id: "metodo_pago", re: /\bmetodo[s]? de pago|\bmedio[s]? de pago|\befectivo\b|\bposnet\b|\bmercado ?pago\b|\btransferencia\b/ },
  { id: "ocupacion", re: /\bocupacion|\bcapacidad\b/ },
  { id: "clientes", re: /\bcliente/ },
  { id: "stand", re: /\bstand\b|\bturnero\b/ },
  { id: "colectivo", re: /\bcolectiv/ },
  { id: "caja", re: /\bcaja\b|\bsaldo\b|\bcomision/ },
  { id: "neto_bruto", re: /\bneto\b|\bbruto\b/ },
  { id: "metricas", re: /\bmetrica|\brendimiento\b/ },
];

// Temas EXTERNOS: información que SIM no tiene y que sí justifica internet.
const TEMA_EXTERNO: Array<{ id: string; re: RegExp }> = [
  { id: "competencia", re: /\bcompetidor|\bcompetencia\b|\bcompetitiv|\botras? empresas?\b|\botros? negocios?\b/ },
  // "mercado" sí, "mercado pago" no (ese es un método de pago interno).
  { id: "mercado", re: /\bmercado\b(?! ?pago)|\bbenchmark\b|\bdel rubro\b|\bla industria\b/ },
  { id: "noticias", re: /\bnoticia|\bnovedad(es)?\b|\btendencia|\bevento[s]? (del|de la) (sector|industria)/ },
  { id: "normativa", re: /\bley(es)?\b|\bnormativ|\bdecreto\b|\bboletin oficial\b|\bhabilitacion municipal\b/ },
  { id: "indicadores_externos", re: /\bindec\b|\bbcra\b|\bdolar\b|\btipo de cambio\b|\bsalario minimo\b|\btasa de interes\b/ },
  { id: "precios_terceros", re: /\bprecios? (de mercado|externos?|de la competencia|publicos?)\b|\bcuanto (cobran|sale|cuesta) (en|la)\b/ },
  { id: "internet_explicito", re: /\ben internet\b|\ben la web\b|\bpor internet\b|\bonline\b|\bgooglea|\bbusca(r)? en (internet|la web|google)\b/ },
];

// "Inflación" es AMBIGUA a propósito: ajustar por inflación con el índice IPC ya cargado es
// interno (4E); pedir la inflación del INDEC es externo. Se resuelve por contexto.
const INFLACION = /\binflacion\b/;
const AJUSTE_INTERNO_INFLACION = /\bajust/;

const TEMA_CONOCIMIENTO = /\bdocument|\bmanual\b|\bpolitica|\breglament|\bprotocolo\b|\bque dice el\b|\bsegun el\b|\bconocimiento\b|\badjunt/;

const SIN_INTERNET = /\bsin internet\b|\bno busques\b|\bno uses internet\b|\bno consultes internet\b|\boffline\b/;

// Preguntas tan vagas que ninguna herramienta puede responderlas sin una decisión del admin.
const MUY_VAGA = /^(hola|buenas|que tal|ayuda|ayudame|necesito ayuda|que podes hacer|opciones)\b/;

export function clasificarConsulta(pregunta: string): DecisionRuta {
  const t = norm(pregunta);
  const senales: string[] = [];

  const internos = TEMA_INTERNO.filter((x) => x.re.test(t)).map((x) => x.id);
  const externos = TEMA_EXTERNO.filter((x) => x.re.test(t)).map((x) => x.id);
  const esConocimiento = TEMA_CONOCIMIENTO.test(t);
  const pidioSinInternet = SIN_INTERNET.test(t);
  const pii = contienePII(pregunta);

  // La inflación cuenta como externa SOLO si no es el ajuste interno por índice IPC ya cargado.
  if (INFLACION.test(t) && !AJUSTE_INTERNO_INFLACION.test(t)) externos.push("inflacion_externa");

  for (const i of internos) senales.push(`interno:${i}`);
  for (const e of externos) senales.push(`externo:${e}`);
  if (esConocimiento) senales.push("conocimiento");
  if (pidioSinInternet) senales.push("pedido:sin_internet");
  if (pii.hay) senales.push(`pii:${pii.tipos.join(",")}`);

  const negar = (ruta: Ruta, motivo: string): DecisionRuta => ({ ruta, senales, webPermitida: false, motivo });

  // 1) PII o "sin internet": nunca se busca afuera. Si hay tema interno, se responde con datos.
  if (pii.hay) return negar(internos.length > 0 ? "interna" : "ambigua", "pii_nunca_sale_de_sim");
  if (pidioSinInternet) return negar(internos.length > 0 ? "interna" : "conocimiento", "pedido_sin_internet");

  // 2) Interno + externo → MIXTA: la parte externa puede buscar; la interna sale del sistema.
  if (internos.length > 0 && externos.length > 0) {
    return { ruta: "mixta", senales, webPermitida: true, motivo: "interno_y_externo" };
  }

  // 3) Solo interno → INTERNA. Acá se bloquea la web del lado del servidor: mencionar un año,
  //    un mes o "actual" NO convierte una pregunta de facturación en una pregunta de mercado.
  if (internos.length > 0) return negar("interna", "solo_datos_internos");

  // 4) Solo externo → EXTERNA (con las reglas de confirmación/caché/presupuesto de 4D.5).
  if (externos.length > 0) return { ruta: "externa", senales, webPermitida: true, motivo: "solo_datos_externos" };

  // 5) Documentos/conocimiento permanente.
  if (esConocimiento) return negar("conocimiento", "conocimiento_documental");

  // 6) Nada identificable. El router NO bloquea lo que no reconoce: se limita a no opinar y la
  //    decisión de web queda en manos de decidirWeb (4D), con sus reglas de siempre. Bloquear acá
  //    apagaría búsquedas externas legítimas que este clasificador todavía no sabe nombrar.
  const motivo = MUY_VAGA.test(t.trim()) ? "sin_tema_identificable" : "sin_senales_suficientes";
  return { ruta: "ambigua", senales, webPermitida: true, motivo };
}
