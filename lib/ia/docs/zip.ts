import { inflateRawSync } from "node:zlib";

// IA SIM · Bloque 4B — Lector ZIP MÍNIMO y SEGURO para OOXML (docx/pptx/xlsx).
// Lee solo las entradas necesarias vía el Central Directory. Nunca ejecuta nada.
// Protección anti "bomba de descompresión": tope por entrada y total.

const TOPE_ENTRADA = 20 * 1024 * 1024; // 20 MB descomprimido por entrada
const TOPE_TOTAL = 80 * 1024 * 1024; // 80 MB descomprimido total

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

export type EntradaZip = { nombre: string; datos: Buffer };

// Lee las entradas cuyo nombre cumpla el predicado. Lanza si detecta una bomba.
export function leerEntradasZip(buf: Uint8Array, quiero: (nombre: string) => boolean): EntradaZip[] {
  // Buscar End Of Central Directory (firma PK\x05\x06), desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip_invalido");
  const total = u16(buf, eocd + 10);
  let cd = u32(buf, eocd + 16);

  const out: EntradaZip[] = [];
  let acumulado = 0;
  for (let n = 0; n < total; n++) {
    if (cd + 46 > buf.length || u32(buf, cd) !== 0x02014b50) break; // firma central dir
    const metodo = u16(buf, cd + 10);
    const compSize = u32(buf, cd + 20);
    const uncompSize = u32(buf, cd + 24);
    const nameLen = u16(buf, cd + 28);
    const extraLen = u16(buf, cd + 30);
    const commentLen = u16(buf, cd + 32);
    const localOff = u32(buf, cd + 42);
    const nombre = Buffer.from(buf.slice(cd + 46, cd + 46 + nameLen)).toString("utf8");
    cd = cd + 46 + nameLen + extraLen + commentLen;

    if (!quiero(nombre)) continue;
    if (uncompSize > TOPE_ENTRADA) throw new Error("bomba_descompresion");
    acumulado += uncompSize;
    if (acumulado > TOPE_TOTAL) throw new Error("bomba_descompresion");

    // Cabecera local: nombre y extra pueden diferir en longitud.
    if (localOff + 30 > buf.length || u32(buf, localOff) !== 0x04034b50) continue;
    const lNameLen = u16(buf, localOff + 26);
    const lExtraLen = u16(buf, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = Buffer.from(buf.slice(dataStart, dataStart + compSize));
    let datos: Buffer;
    if (metodo === 0) datos = comp; // stored
    else if (metodo === 8) {
      datos = inflateRawSync(comp);
      if (datos.length > TOPE_ENTRADA) throw new Error("bomba_descompresion");
    } else continue; // método no soportado
    out.push({ nombre, datos });
  }
  return out;
}

// Quita etiquetas XML y devuelve el texto plano, respetando saltos de párrafo/salto.
export function xmlATexto(xml: string, saltoEn: string[] = []): string {
  let s = xml;
  for (const tag of saltoEn) s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "g"), "\n");
  s = s.replace(/<[^>]+>/g, ""); // quita todo el markup
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
