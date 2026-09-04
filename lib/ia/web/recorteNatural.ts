// IA SIM · Corrección 4D.5.3 — Recorte NATURAL de texto, puro y reutilizable. Reemplaza el
// `.slice(0, max)` ciego usado en la validación de emitir_analisis_web (4D.5.2), que podía
// cortar a mitad de palabra/número (caso real: "...septiembre 2026 (49 tur"). Nunca agrega
// datos ni completa una idea: solo decide DÓNDE cortar un texto que ya excede el límite.
//
// Orden de preferencia:
// 1) última oración completa dentro del límite (termina en . ! ?);
// 2) si no hay, último límite de palabra;
// 3) cierra/elimina paréntesis, comillas o marcado Markdown que quedaron abiertos;
// 4) termina siempre con puntuación válida (. ! ? o … si el corte fue a mitad de idea).

function esTerminadorOracion(ch: string): boolean {
  return ch === "." || ch === "!" || ch === "?";
}

// Cierra/elimina marcadores Markdown, paréntesis o comillas que quedaron SIN CERRAR tras el
// corte, recortando desde el último marcador abierto (no solo el carácter: todo lo que quedó
// colgando después de él, que es contenido incompleto).
function cerrarAperturasColgantes(s: string): string {
  let out = s;
  let cambio = true;
  while (cambio && out) {
    cambio = false;
    for (const marcador of ["**", "`"]) {
      const cantidad = out.split(marcador).length - 1;
      if (cantidad % 2 !== 0) { out = out.slice(0, out.lastIndexOf(marcador)).trim(); cambio = true; }
    }
    const corchete = out.lastIndexOf("[");
    if (corchete >= 0 && out.indexOf("]", corchete) === -1) { out = out.slice(0, corchete).trim(); cambio = true; }
    const parAbre = (out.match(/\(/g) || []).length;
    const parCierra = (out.match(/\)/g) || []).length;
    if (parAbre > parCierra) { out = out.slice(0, out.lastIndexOf("(")).trim(); cambio = true; }
    const comillaRecta = out.split('"').length - 1;
    if (comillaRecta % 2 !== 0) { out = out.slice(0, out.lastIndexOf('"')).trim(); cambio = true; }
    const abreCurva = out.lastIndexOf("“"); // “
    const cierraCurva = out.lastIndexOf("”"); // ”
    if (abreCurva > cierraCurva) { out = out.slice(0, abreCurva).trim(); cambio = true; }
  }
  // Puntuación de conexión colgante tras los recortes (coma, dos puntos, guion sueltos al final).
  return out.replace(/[,:;\-–—]+$/, "").trim();
}

export function recortarNatural(textoOriginal: string, max: number): string {
  const texto = (textoOriginal ?? "").trim();
  if (max <= 0) return "";
  if (texto.length <= max) return texto;

  // 1) Última oración completa dentro del límite: el terminador debe estar seguido de espacio,
  //    salto de línea o fin de texto (evita cortar en abreviaturas pegadas, ej. "Nro.5").
  const base = texto.slice(0, max);
  let idxOracion = -1;
  for (let i = base.length - 1; i >= 0; i--) {
    if (esTerminadorOracion(base[i])) {
      const siguiente = texto[i + 1];
      if (siguiente === undefined || siguiente === " " || siguiente === "\n") { idxOracion = i; break; }
    }
  }

  let candidato: string;
  if (idxOracion >= 0) {
    candidato = texto.slice(0, idxOracion + 1).trim();
  } else {
    // 2) Último límite de palabra. Se reserva 1 carácter para la elipsis del paso 4 (nunca se
    //    excede `max`, incluso si el corte queda a mitad de idea).
    const baseCorta = texto.slice(0, Math.max(1, max - 1));
    const espacio = baseCorta.lastIndexOf(" ");
    candidato = (espacio > 0 ? baseCorta.slice(0, espacio) : baseCorta).trim();
  }

  // 3) Cerrar paréntesis/comillas/Markdown que quedaron abiertos.
  candidato = cerrarAperturasColgantes(candidato);
  if (!candidato) candidato = texto.slice(0, Math.max(1, max - 1)).trim(); // defensivo (texto sin espacios/puntuación)

  // 4) Terminar SIEMPRE con puntuación válida. Nunca se agrega texto que complete la idea: la
  // elipsis solo marca que hubo un corte, no inventa el final.
  if (!/[.!?…]$/.test(candidato)) {
    if (candidato.length >= max) candidato = candidato.slice(0, Math.max(0, max - 1)).trim();
    candidato = `${candidato}…`;
  }
  return candidato;
}
