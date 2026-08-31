// IA SIM · Bloque 4A — Parser de Markdown RESTRINGIDO y SEGURO (núcleo puro).
// Convierte texto del modelo en una estructura tipada que el componente React
// renderiza con elementos nativos (nunca dangerouslySetInnerHTML). Por diseño, todo
// HTML/script del modelo queda como TEXTO literal (React lo escapa). Solo se permiten:
// negritas, itálicas, código en línea, enlaces http(s)/mailto seguros, listas,
// párrafos, saltos de línea, encabezados y tablas simples. Imágenes: bloqueadas.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: Inline[] }
  | { t: "italic"; v: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; v: string };

export type Block =
  | { t: "p"; inline: Inline[] }
  | { t: "heading"; level: number; inline: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "table"; header: Inline[][]; rows: Inline[][][] };

// Solo http(s) y mailto se consideran seguros. javascript:, data:, vbscript:, etc. → null.
export function sanitizeUrl(url: string): string | null {
  const u = (url || "").trim();
  if (/^https?:\/\/[^\s]+$/i.test(u)) return u;
  if (/^mailto:[^\s]+$/i.test(u)) return u;
  return null;
}

// ── Inline ────────────────────────────────────────────────────────────────────
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };

  while (i < text.length) {
    const rest = text.slice(i);

    // Imagen ![alt](url): se BLOQUEA la imagen; se conserva solo el alt como texto.
    const img = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(rest);
    if (img) { buf += img[1]; i += img[0].length; continue; }

    // Enlace [texto](url): solo si la URL es segura; si no, queda como texto plano.
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = sanitizeUrl(link[2]);
      flush();
      if (href) out.push({ t: "link", href, v: link[1] });
      else out.push({ t: "text", v: link[1] }); // URL peligrosa → solo el texto
      i += link[0].length;
      continue;
    }

    // Código en línea `code` (sin formato interno).
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) { flush(); out.push({ t: "code", v: text.slice(i + 1, end) }); i = end + 1; continue; }
    }

    // Negrita **texto** (recursivo).
    if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 1) { flush(); out.push({ t: "bold", v: parseInline(text.slice(i + 2, end)) }); i = end + 2; continue; }
    }

    // Itálica *texto* (un solo asterisco; evita chocar con **).
    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i) { flush(); out.push({ t: "italic", v: parseInline(text.slice(i + 1, end)) }); i = end + 1; continue; }
    }

    buf += text[i];
    i++;
  }
  flush();
  return out;
}

// ── Bloques ─────────────────────────────────────────────────────────────────
function esFilaTabla(l: string): boolean { return /\|/.test(l) && l.trim().startsWith("|"); }
function esSeparadorTabla(l: string): boolean { return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && /-/.test(l); }
function celdas(l: string): string[] {
  return l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const lines = (src || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Encabezado
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ t: "heading", level: h[1].length, inline: parseInline(h[2]) }); i++; continue; }

    // Tabla: fila con | seguida de separador |---|
    if (esFilaTabla(line) && i + 1 < lines.length && esSeparadorTabla(lines[i + 1])) {
      const header = celdas(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && esFilaTabla(lines[i])) { rows.push(celdas(lines[i]).map(parseInline)); i++; }
      blocks.push({ t: "table", header, rows });
      continue;
    }

    // Lista no ordenada
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*[-*+]\s+/, ""))); i++; }
      blocks.push({ t: "ul", items });
      continue;
    }

    // Lista ordenada
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*\d+\.\s+/, ""))); i++; }
      blocks.push({ t: "ol", items });
      continue;
    }

    // Párrafo (junta líneas hasta blanco / cambio de bloque; saltos = <br>)
    const parr: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) && !(esFilaTabla(lines[i]) && i + 1 < lines.length && esSeparadorTabla(lines[i + 1]))) {
      parr.push(lines[i]); i++;
    }
    line = parr.join("\n");
    blocks.push({ t: "p", inline: parseInline(line) });
  }
  return blocks;
}
