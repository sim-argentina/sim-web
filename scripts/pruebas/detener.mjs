// Detiene el Supabase local de pruebas. No borra la base: usá --reset en el esquema
// para vaciarla, o `npm run pruebas:detener -- --borrar` para tirar también los datos.
//
//   node scripts/pruebas/detener.mjs            # detiene, conserva el volumen
//   node scripts/pruebas/detener.mjs --borrar   # detiene y borra los datos locales

import { execFileSync } from "node:child_process";

const BORRAR = process.argv.includes("--borrar");
try {
  execFileSync("npx", ["supabase", "stop", BORRAR ? "--no-backup" : "--backup"], {
    stdio: "inherit", shell: process.platform === "win32",
  });
  console.log(BORRAR ? "\nStack detenido y datos locales borrados." : "\nStack detenido (los datos locales quedan).");
} catch {
  console.log("\nEl stack ya estaba detenido.");
}
