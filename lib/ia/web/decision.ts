// IA SIM · Bloque 4D — Decisión DETERMINÍSTICA (antes de llamar al proveedor) de si
// una consulta debe habilitar la búsqueda web. No depende del modelo. Explicable y
// testeable. Regla de oro: para datos ACTUALES de SIM el sistema es la fuente; internet
// es para información externa, cambiante o de mercado. "Sin internet" siempre gana.

import { contienePII } from "@/lib/ia/web/sanitizar";

export type DecisionWeb = {
  habilitar: boolean;
  explicita: boolean; // el admin pidió explícitamente buscar en internet
  motivo: string;     // por qué (para auditoría)
};

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Pedido EXPLÍCITO de NO usar internet (gana sobre todo lo demás).
const SIN_INTERNET = /\b(sin internet|no busques( en)?( internet| la web| online)?|no uses internet|no consultes internet|no navegues|offline|sin buscar en internet)\b/;

// Pedido EXPLÍCITO de usar internet.
const INTERNET_EXPLICITO = /\b(en internet|en la web|por internet|online|en google|googlea|googlear|navega( por)?|consulta( en)? internet|busca(r)? en (internet|la web|google)|buscar online)\b/;

// Verbos de investigación (débiles por sí solos; requieren tema externo).
const VERBO_BUSQUEDA = /\b(busca|buscar|busque|investiga|investigar|averigua|averiguar|consulta|consultar)\b/;

// Temas EXTERNOS / de mercado / cambiantes (habilitan búsqueda).
const TEMA_EXTERNO: Array<{ re: RegExp; que: string }> = [
  { re: /\b(competidor|competencia|competidores|la competencia|otras? empresas?|otros? negocios?|otras? marcas?)\b/, que: "competencia" },
  { re: /\b(experiencias?|simuladores?|karting|kartodromo|pista|autodromo|entretenimiento).{0,40}\bcordoba\b/, que: "mercado_local" },
  { re: /\bcordoba\b.{0,40}(experiencias?|simuladores?|karting|entretenimiento|opciones)\b/, que: "mercado_local" },
  { re: /\b(que (hay|existe|existen|ofrecen|opciones)|quienes? (son|hay|ofrecen)|donde (hay|puedo))\b/, que: "oferta_externa" },
  { re: /\b(precios? (de mercado|externos?|de la competencia|publicos?|referencia)|cuanto (cobran|sale|cuesta) (en|la))\b/, que: "precios_externos" },
  { re: /\b(ley|leyes|normativa|normativas|decreto|resolucion|reglamentacion|boletin oficial|habilitacion municipal|impuesto)\b/, que: "normativa" },
  { re: /\b(inflacion|indec|bcra|dolar|tipo de cambio|indicador economico|indicadores economicos|tasa de interes|salario minimo)\b/, que: "indicadores" },
  { re: /\b(noticia|noticias|novedad|novedades|tendencia|tendencias|evento|eventos|feria|convencion|lanzamiento)\b/, que: "noticias_tendencias" },
];

// Datos INTERNOS de SIM (resolubles con el sistema; no requieren internet).
const TEMA_INTERNO = /\b(turno|turnos|factur|ganancia|ingreso|ingresos|cronograma|reserva|reservas|stand|colectivo|comision|comisiones|equipo|federico|francisco|ramiro|fede|fran|rami|cierre|saldo|metrica|metricas|jornada|empleado|empleados|personas|operaciones|neto|bruto)\b/;

// Marcadores temporales de "información cambiante".
const TEMPORAL_CAMBIANTE = /\b(actual|actualmente|actuales|hoy|ultimo|ultima|ultimos|vigente|vigentes|reciente|recientes|ahora mismo|hoy en dia|este ano|202[6-9]|203\d)\b/;

// Comparación con algo externo (para consultas mixtas SIM ↔ mercado).
const COMPARA_EXTERNO = /\b(compara|comparar|comparacion|versus|\bvs\b|frente a|contra|diferencias? (con|principales)|respecto (a|de))\b/;

export function decidirWeb(pregunta: string): DecisionWeb {
  const t = norm(pregunta);

  // 1) "Sin internet" gana siempre.
  if (SIN_INTERNET.test(t)) return { habilitar: false, explicita: false, motivo: "pedido_sin_internet" };

  // 2) PII / datos privados que no deben salir de SIM → no se busca en internet.
  const pii = contienePII(pregunta);
  if (pii.hay) return { habilitar: false, explicita: false, motivo: `pii:${pii.tipos.join(",")}` };

  const temaExterno = TEMA_EXTERNO.find((x) => x.re.test(t));
  const interno = TEMA_INTERNO.test(t);
  const temporal = TEMPORAL_CAMBIANTE.test(t);
  const compara = COMPARA_EXTERNO.test(t);
  const verbo = VERBO_BUSQUEDA.test(t);

  // 3) Pedido explícito de internet → habilita (salvo que sea puramente interno sin tema externo,
  //    en cuyo caso "buscá X interno" es una búsqueda del sistema, no de internet).
  if (INTERNET_EXPLICITO.test(t)) {
    if (interno && !temaExterno && !temporal && !compara) {
      return { habilitar: false, explicita: false, motivo: "interno_pese_a_verbo" };
    }
    return { habilitar: true, explicita: true, motivo: temaExterno ? `explicito_internet:${temaExterno.que}` : "explicito_internet" };
  }

  // 4) Tema externo detectado → habilita (explícita si además hay verbo de búsqueda).
  if (temaExterno) {
    return { habilitar: true, explicita: verbo, motivo: `tema_externo:${temaExterno.que}` };
  }

  // 5) Comparación con el mercado (mixta): SIM + comparación/temporal + no puramente interno.
  if (compara && (temporal || !interno) && !(interno && !temporal)) {
    return { habilitar: true, explicita: verbo, motivo: "comparacion_externa" };
  }

  // 6) Información cambiante sin tema interno claro → habilita.
  if (temporal && !interno) {
    return { habilitar: true, explicita: verbo, motivo: "informacion_cambiante" };
  }

  // 7) Todo lo demás se resuelve con datos internos (sin internet).
  return { habilitar: false, explicita: false, motivo: "resoluble_internamente" };
}
