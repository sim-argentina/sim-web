# CRM · Preparación de rutas (negocios importados para visitar)

Ajuste mínimo para cargar las rutas de prospección investigadas sin inventar actividad comercial.

## Qué cambia

- **Base (`db/crm-rutas-preparacion.sql`)**
  - `crm_empresas.recorrido_tramo` y `recorrido_orden`: tramo y número de parada del documento de ruta. La ruta es la **zona**. Es un orden de recorrido propuesto, no una jornada ni una agenda.
  - `crm_empresas.notas_preparacion` (hasta 4000 caracteres): lo que la investigación aporta y el CRM no tiene como campo propio. Incluye ID de investigación, fuente, fecha de consulta, enlaces, rubro de la fuente, cuenta o vínculo sugerido, «Para la visita» y advertencias.
  - `crm_empresa_importar(lote, ref, datos, contactos, actor)`: solo Administración.
    - Crea el negocio con `origen = 'importacion'` y `origen_ref = ref`; el índice único de B1 ya existía.
    - Usa las validaciones de `crm_empresa_insertar` y `crm_contacto_insertar`. Los negocios parecidos se confirman y quedan en `similar_a` para revisión.
    - Si el ID ya fue importado devuelve `ya_aplicado` y no toca nada.
    - Audita la creación y el lote.
- **App**
  - La ficha muestra un bloque desplegable «Preparación de la ruta», con tramo, parada y notas, a los dos roles.
  - La lista muestra la parada.
  - El comercial puede filtrar por zona/ruta y prioridad. Con una zona elegida, la lista sale en orden de recorrido.
  - La lista de negocios lee **todas** las filas: antes se cortaba en 300 por nombre.
- **Control**: `crm-poscontrol.sql` pasa a P8 = 58 funciones / 27 RPC.

## Qué no hace

- No crea jornadas, visitas, oportunidades, tareas ni gestiones.
- No modifica ni fusiona negocios existentes.
- No marca decisores: los teléfonos publicados quedan como contacto sin nombre, `es_decisor = 'no_sabe'` y WhatsApp solo si la fuente lo dice.
- No hay pantalla de importación: la carga la hace un importador puntual, fuera del repositorio, que llama a la RPC con la clave de servidor.

## Prueba

`node scripts/pruebas/crm-local.mjs suite lib/crmRutasPreparacion.integration.ts` cubre:

- importación;
- reejecución;
- permisos;
- ausencia de actividad generada;
- vista comercial en orden de recorrido sin datos de Administración;
- 323 filas en una zona sin tope.

## Publicar

1. Aplicar `db/crm-rutas-preparacion.sql` en SIM WEB (es aditivo e inocuo con el código anterior).
2. Desplegar el código.
3. Correr el poscontrol.

Recién entonces cargar los datos.

Para volver atrás:

- desplegar el código anterior: las columnas nuevas quedan sin uso;
- revocar o eliminar `crm_empresa_importar` si hiciera falta;
- no borrar negocios con actividad.
