"use client";

import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/ia/markdown";

// Render SEGURO de Markdown restringido: usa el parser puro (lib/ia/markdown) y arma
// elementos React nativos. NUNCA usa dangerouslySetInnerHTML, así que cualquier HTML o
// script del modelo queda como texto escapado. Enlaces solo http(s)/mailto ya saneados.

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, k) => {
    const key = `${keyPrefix}-${k}`;
    if (n.t === "text") {
      // Saltos de línea dentro de un párrafo → <br/>.
      const parts = n.v.split("\n");
      return (
        <Fragment key={key}>
          {parts.map((p, j) => (
            <Fragment key={j}>{j > 0 ? <br /> : null}{p}</Fragment>
          ))}
        </Fragment>
      );
    }
    if (n.t === "bold") return <strong key={key}>{renderInline(n.v, key)}</strong>;
    if (n.t === "italic") return <em key={key}>{renderInline(n.v, key)}</em>;
    if (n.t === "code") return <code key={key} className="rounded bg-white/10 px-1 py-0.5 text-[0.85em]">{n.v}</code>;
    // link: href ya saneado (http/https/mailto). rel seguro + target nueva pestaña.
    return <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-red-400 underline hover:text-red-300">{n.v}</a>;
  });
}

export default function SafeMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.t === "heading") {
          const Tag = (`h${Math.min(b.level + 2, 6)}`) as "h3" | "h4" | "h5" | "h6";
          return <Tag key={i} className="font-black text-white">{renderInline(b.inline, `h${i}`)}</Tag>;
        }
        if (b.t === "ul") return <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((it, k) => <li key={k}>{renderInline(it, `ul${i}-${k}`)}</li>)}</ul>;
        if (b.t === "ol") return <ol key={i} className="list-decimal space-y-1 pl-5">{b.items.map((it, k) => <li key={k}>{renderInline(it, `ol${i}-${k}`)}</li>)}</ol>;
        if (b.t === "table") {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>{b.header.map((c, k) => <th key={k} className="border border-white/15 px-2 py-1 text-left font-bold">{renderInline(c, `th${i}-${k}`)}</th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>{row.map((c, k) => <td key={k} className="border border-white/10 px-2 py-1">{renderInline(c, `td${i}-${r}-${k}`)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i}>{renderInline(b.inline, `p${i}`)}</p>;
      })}
    </div>
  );
}
