import { strict as assert } from "node:assert";
import { parseInline, parseMarkdown, sanitizeUrl, type Inline } from "@/lib/ia/markdown";

// Ejecutar: npx tsx lib/ia/markdown.test.ts
// Markdown restringido y seguro: negritas/listas/tablas se estructuran; HTML/scripts y
// URLs peligrosas NO producen elementos ejecutables.

function tipos(ns: Inline[]): string[] { return ns.map((n) => n.t); }

// 1) Negrita.
{
  const r = parseInline("Hola **Federico** ok");
  assert.ok(r.some((n) => n.t === "bold"), "negrita detectada");
  const bold = r.find((n) => n.t === "bold")! as Extract<Inline, { t: "bold" }>;
  assert.equal((bold.v[0] as { v: string }).v, "Federico", "contenido de la negrita");
}

// 2) Itálica y código en línea.
{
  const r = parseInline("un *dato* y `codigo`");
  assert.ok(tipos(r).includes("italic") && tipos(r).includes("code"), "itálica y código");
}

// 3) Listas.
{
  const b = parseMarkdown("Desglose:\n- Stand: 378\n- Reservas: 7");
  assert.ok(b.some((x) => x.t === "ul"), "lista no ordenada");
  const ul = b.find((x) => x.t === "ul")! as Extract<typeof b[number], { t: "ul" }>;
  assert.equal(ul.items.length, 2, "2 ítems");
}
{
  const b = parseMarkdown("1. uno\n2. dos");
  assert.ok(b.some((x) => x.t === "ol"), "lista ordenada");
}

// 4) Tabla simple.
{
  const b = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
  const t = b.find((x) => x.t === "table") as Extract<typeof b[number], { t: "table" }> | undefined;
  assert.ok(t, "tabla detectada");
  assert.equal(t!.header.length, 2, "2 columnas");
  assert.equal(t!.rows.length, 1, "1 fila");
}

// 5) HTML / script → queda como TEXTO (no genera nodos peligrosos, se escapa al render).
{
  const r = parseInline("<script>alert(1)</script> y <img src=x onerror=alert(1)>");
  assert.deepEqual(tipos(r), ["text"], "html/script tratado como texto plano");
  assert.ok((r[0] as { v: string }).v.includes("<script>"), "el texto se conserva literal (React lo escapa)");
}

// 6) URLs peligrosas bloqueadas.
assert.equal(sanitizeUrl("javascript:alert(1)"), null, "javascript: bloqueado");
assert.equal(sanitizeUrl("data:text/html,<script>"), null, "data: bloqueado");
assert.equal(sanitizeUrl("vbscript:msgbox"), null, "vbscript: bloqueado");
assert.equal(sanitizeUrl("https://sim.com/x"), "https://sim.com/x", "https permitido");
{
  const r = parseInline("mirá [acá](javascript:alert(1))");
  assert.ok(!tipos(r).includes("link"), "enlace peligroso NO se vuelve link");
  assert.ok(r.some((n) => n.t === "text" && n.v.includes("acá")), "se conserva el texto del enlace");
}
{
  const r = parseInline("[docs](https://ej.com)");
  const link = r.find((n) => n.t === "link") as Extract<Inline, { t: "link" }> | undefined;
  assert.ok(link && link.href === "https://ej.com", "enlace http seguro");
}

// 7) Imagen bloqueada (solo se conserva el alt).
{
  const r = parseInline("![foto](https://ej.com/x.png) fin");
  assert.ok(!tipos(r).includes("link"), "imagen no genera enlace");
  assert.ok((r[0] as { v: string }).v.startsWith("foto"), "conserva el alt");
}

console.log("OK — markdown seguro: negritas/itálica/código/listas/tablas estructurados; HTML/script como texto; URLs javascript:/data: bloqueadas; imágenes bloqueadas.");
