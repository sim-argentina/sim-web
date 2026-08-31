import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ejecutar: npx tsx lib/ia/iaChatComposer.test.ts
// Regresión del composer del chat: el campo para escribir DEBE existir siempre y
// quedar dentro del viewport (el bug era altura 100vh sin restar el pt-20 del layout).

const src = readFileSync(join(process.cwd(), "app/admin/(panel)/ia/IAChat.tsx"), "utf8");

// 1) Causa raíz: altura acotada al viewport MENOS el offset del layout; sin md:h-screen.
assert.ok(/h-\[calc\(100dvh-5rem\)\]/.test(src), "usa altura acotada calc(100dvh-5rem)");
assert.ok(!/md:h-screen/.test(src), "NO usa md:h-screen (regresión del bug de altura)");
assert.ok(/min-h-0[^\n]*flex-1[^\n]*overflow-y-auto/.test(src) || /flex-1[^\n]*min-h-0/.test(src), "área de mensajes con min-h-0 para scrollear internamente");
assert.ok(/shrink-0 border-t/.test(src), "composer con shrink-0 (no se aplasta ni se empuja fuera)");

// 2) Composer presente con el placeholder EXACTO y accesible.
assert.ok(src.includes("Preguntale algo a IA SIM…"), "placeholder exacto");
assert.ok(/id="ia-composer"/.test(src) && /ref=\{textareaRef\}/.test(src), "textarea identificable con ref para foco");
assert.ok(/aria-label="Escribí tu pregunta para IA SIM"/.test(src), "textarea con aria-label");

// 3) El composer NO depende de que existan mensajes (está fuera del bloque de sugeridas).
const idxSug = src.indexOf("mensajes.length === 0");
const idxComposer = src.indexOf('id="ia-composer"');
assert.ok(idxSug > 0 && idxComposer > idxSug, "el composer se renderiza después/independiente de las sugeridas");
// La única condición de sugeridas envuelve la grilla de ayuda, no el textarea.
assert.ok(!/mensajes\.length === 0 &&[\s\S]*id="ia-composer"[\s\S]*\)\}/.test(src.slice(idxSug, idxSug + 400)), "el textarea no está adentro del gate de sugeridas");

// 4) Enter envía; Shift+Enter hace nueva línea (no envía).
assert.ok(/e\.key === "Enter" && !e\.shiftKey/.test(src) && /e\.preventDefault\(\); enviar\(\)/.test(src), "Enter envía, Shift+Enter no");

// 5) Botón deshabilitado solo si enviando o texto vacío.
assert.ok(/disabled=\{enviando \|\| !input\.trim\(\)\}/.test(src), "botón deshabilitado por enviando/vacío");

// 6) Indicador de envío + prevención de doble envío (guarda `enviando`) + conserva texto al fallar.
assert.ok(/if \(!pregunta \|\| enviando\) return/.test(src), "no reenvía mientras hay uno en curso (anti doble envío)");
assert.ok(/setInput\(pregunta\)/.test(src), "conserva el borrador si la solicitud falla");
assert.ok(/PASOS\[paso\]/.test(src), "muestra indicador mientras responde");

// 7) Las sugeridas usan el MISMO flujo de envío (no un flujo alternativo).
assert.ok(/onClick=\{\(\) => enviar\(q\)\}/.test(src), "sugeridas llaman a enviar() (mismo flujo, idempotencia/límites/auditoría)");

// 8) Foco automático al crear/abrir conversación.
assert.ok(/enfocar\(\);?/.test(src), "enfoca el composer al crear/abrir conversación");

console.log("OK — IAChat composer: siempre visible (altura acotada), placeholder exacto, aria-label, Enter/Shift+Enter, anti doble envío, conserva borrador, sugeridas mismo flujo, foco automático.");
