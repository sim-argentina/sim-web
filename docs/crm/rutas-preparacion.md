# CRM · Preparación de rutas (negocios importados para visitar)

Ajuste mínimo para cargar las rutas de prospección investigadas sin inventar actividad comercial.

## Estado (01/11/2026)

- **Lote `rutas-2026-10-31-v1` cargado en SIM WEB.** 15 rutas (01–10 y 12–16):
  - 1.092 negocios creados y asignados a Tobías;
  - 0 vinculados a negocios existentes y 0 pendientes;
  - 1.001 teléfonos publicados, con decisor «no sabe»; 252 con WhatsApp según la fuente;
  - 15 zonas y 16 rubros nuevos. Los 14 rubros existentes se reutilizaron y el rubro exacto de la fuente queda en las notas.
- **Traza:** `crm_auditoria`, con acción `registro` y `datos.lote`. Las correcciones posteriores figuran como `correccion`:
  - 177 fechas de consulta que la extracción no tomó;
  - 1.092 reconstrucciones de los saltos de línea de las notas.

  Ninguna corrección cambió ID, ruta, parada ni responsable.
- **Parecidos (`similar_a`, 112 negocios):** ningún duplicado.
  - 107 son negocios distintos: 106 en un mismo predio y 1 con nombre parecido.
  - 5 son sucursales legítimas de una misma marca: BestClub, Deporbas, Difarma I y II, y Organización Centro.
  - Ninguno requiere una decisión sobre la base. Las confirmaciones de campo están en las notas de cada ficha.
- **Pendiente documental:** Ruta 11 (Cofico / Alta Córdoba / San Martín). No está en el paquete y no se reconstruye. Cuando llegue, se carga con el mismo procedimiento.
- **Definiciones comerciales pendientes** (no bloquean la prospección): IVA, devoluciones y liquidación de la movilidad.

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
- **Notas:** `crm_empresa_importar` conserva los saltos de línea de `notas_preparacion`; normaliza los espacios y las líneas vacías. `crm_texto` los colapsa y no se usa para este campo.
- **Menú del panel:** el botón ☰ es `absolute`. Ocupa el espacio reservado arriba y se va con la página, así no tapa títulos al desplazarla.

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
