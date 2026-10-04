// Importar este módulo ACTIVA el guardián: si el destino no es una base de pruebas aislada, el
// proceso termina acá mismo, antes de que se inicialice ningún cliente de Supabase y antes de la
// primera escritura.
//
// Va como PRIMER import de toda suite que escriba en la base:
//
//   import "@/lib/guardiaPruebas.activar";
//
// Tiene que ser el primero: los imports se evalúan en orden, así que puesto arriba corre antes de
// que `@/lib/supabaseAdmin` (o cualquier módulo de producción que lo use por dentro) se cargue.
// Por eso el guardián protege también las escrituras indirectas, las que pasan por una función de
// producción en vez de por el cliente de la prueba.
//
// La lista de suites que tienen que importarlo no se mantiene a mano: `guardiaPruebas.contrato.test.ts`
// recorre los archivos de prueba, detecta cuáles escriben y falla si alguno no lo importa.

import { exigirBaseDePruebas } from "@/lib/guardiaPruebas";

exigirBaseDePruebas();
