# Mini CRM comercial B2B — nota de diseño

Prospección presencial de packs corporativos (Tobías) y seguimiento, venta y cobro (Ramiro /
admin). Objetivo del MVP: registrar → seguir → vender → medir.

Este documento resume el diseño acordado y las correcciones que se aplican a los bloques
posteriores. Lo implementado está en [b0-identidad.md](b0-identidad.md),
[b1-prospeccion.md](b1-prospeccion.md), [b2-seguimiento.md](b2-seguimiento.md),
[b3-ventas-cobros-comisiones.md](b3-ventas-cobros-comisiones.md) y [b4-metricas.md](b4-metricas.md).
Cierre del MVP, publicación, vuelta atrás y condiciones pendientes: [cierre-mvp.md](cierre-mvp.md).

## Bloques

| Bloque | Alcance | Estado |
|---|---|---|
| B0 | Identidad comercial: usuarios individuales, sesión propia, administración de usuarios (+ B0.1: límite con respaldo, aislamiento de la analítica) | Implementado y verificado en local; sin migrar ni publicar |
| B1 | Negocios, contactos, jornadas y visitas desde el celular; oportunidad al obtener un contacto útil; revisitas | Implementado y verificado en local (incluye QA móvil); sin migrar ni publicar |
| B2 | Bandeja "Contactos para seguir": estados (contacto, conversación, interesado, negociación, pausa, perdida), actividades manuales, próxima acción, pérdida con motivo y reapertura por ciclos | Implementado y verificado en local; sin migrar ni publicar |
| B3 | Ventas (y recién ahí "Ganado"), cobros, saldo y comisiones; recompras; vínculo de solo lectura con Empresas; correcciones y anulaciones | Implementado y verificado en local (incluye QA móvil); sin migrar ni publicar. Integró al cierre las correcciones de seguridad vigentes de `main` (Next 16.4.3, React 19.2.9, sharp 0.35.5, webhooks de Mercado Pago) |
| B4 | Métricas y tablero (`/admin/crm/metricas`): prospección, conversión por cohorte, jornadas y eficiencia, segmentos y pérdidas, resultados económicos; una definición por métrica; solo lectura | Implementado y verificado en local (incluye QA móvil); sin migrar ni publicar. Corrigió la intervención de la recompra trabajada de B3 |
| Cierre | Sin módulos nuevos: Seguimiento sin el límite de 1000, recorrido integral con ambos roles, control de solo lectura del esquema, plan de publicación y de vuelta atrás, condiciones comerciales pendientes | Verificado en local; sin migrar ni publicar |

Fuera de la V1: WhatsApp o emails automáticos, IA, scoring, mapas, propuestas automáticas e
integración automática con Finanzas.

## Principios que ya están decididos

- La identidad de Tobías es individual y autenticada (B0). La administración sigue siendo la
  credencial compartida del panel: se registra como "Administración", no como Ramiro.
- Los códigos, el canje y el vencimiento son los del módulo Empresas (`empresa_campanias`,
  `empresa_codigos`). El CRM los vincula; no crea un sistema paralelo.
- Finanzas queda aislado: el CRM no escribe en `fin_*`.
- Cobros, saldo y estado de comisión se derivan de registros con fecha e importe; nunca de
  casillas independientes.

## Correcciones al diseño (registradas antes de B1)

1. **Archivo, anulación y exclusión son cosas distintas.**
   - *Archivar* una empresa o un contacto la saca de las listas operativas (búsqueda,
     asignación, bandeja). Sus visitas, ventas, cobros e importes siguen contando en las
     métricas históricas del período en que ocurrieron.
   - *Anular* es corregir un registro incorrecto (una visita duplicada, un cobro mal cargado):
     sale de las métricas y queda en la auditoría con motivo.
   - *Excluir de una vista* es un filtro de pantalla y no cambia ningún dato.
2. **"Interés no evaluado" no es "sin interés".** El interés es nulo hasta que alguien lo
   declara. Guardar una visita con negocio e interlocutor no puede escribir un rechazo ni un
   nivel de interés por defecto. Las métricas tratan el nulo como "no evaluado" y lo informan
   aparte.
3. **Alcance de Tobías en la V1.** Trabaja únicamente con las empresas asignadas a él y con
   las que crea, que quedan asignadas a él. No registra visitas en empresas ajenas ni sin
   asignar. Cualquier excepción de asignación se define explícitamente antes de B1. El aviso
   de posible duplicado muestra solo lo mínimo para no duplicar (nombre, zona, rubro y si está
   asignada a otra persona): nunca contactos, notas ni importes, y no permite modificar la
   empresa ajena. *B1: así quedó implementado, sin excepciones de asignación.*
4. **La ventana de 48 h para editar o anular visitas es una propuesta técnica**, no una regla
   comercial aprobada. *Resuelto en B1: no hay ventana. Tobías no edita ni anula visitas;
   agrega notas cuando quiera. Corregir y anular es de la administración, con motivo y
   auditoría.*
5. **Teléfono compartido.** Varios contactos de una misma empresa pueden tener el mismo número
   (por ejemplo, el central del local para el encargado y el dueño). No hay unicidad por
   teléfono; a lo sumo, un aviso informativo. *B1: un solo campo de teléfono/WhatsApp por
   contacto, guardado tal como se escribió y normalizado; sin unicidad.*
6. **Caja y contribución comercial se definen por separado antes de B4.** "Cobrado − comisión
   generada − movilidad" mezcla cobros con obligaciones devengadas y no se usa. Se definirán,
   con fechas y conceptos coherentes: un movimiento de caja (cobros, comisiones pagadas,
   gastos pagados) y una contribución comercial (ventas, comisiones devengadas, movilidad del
   período). *B4 no las construye:* muestra solo «cobros menos comisiones pagadas» (flujos del
   período, rotulado como tal, que no descuenta movilidad, experiencias, impuestos ni gastos fijos)
   y la movilidad registrada sin restarla. Caja y contribución siguen pendientes.
7. **Nombre de las conversiones.** Si el denominador son negocios únicos, la métrica se llama
   conversión *de negocios* ("negocios visitados → ventas"), no de visitas. *B4: así quedó
   («Visitas que generaron un lead» por visita; «Negocios visitados → compradores» por negocio).*
8. **Historia B2B en Finanzas.** La auditoría buscó "empresa" y "pack" en descripciones y
   observaciones de `fin_movimientos`. Eso no demuestra que no haya operaciones B2B
   históricas: quedan *no identificadas con las comprobaciones realizadas*.
9. **Decisiones comerciales pendientes, sin adoptar por defecto:** IVA de los precios,
   vigencia de los packs, momento de entrega y activación de tarjetas/códigos, formato de
   códigos (individuales o uno con varios usos), descuentos y su efecto en la comisión,
   intervención comercial en recompras, movilidad (quién la paga y si resta) y visibilidad de
   las comisiones para Tobías. B0 no implementa ni presupone ninguna.
   *B3 resolvió:*
   - el importe es el acuerdo comercial, sin IVA ni comprobantes;
   - vigencia y vencimiento son los de la campaña de Empresas vinculada («sin definir» si no
     hay), sin copiar 30 o 60 días;
   - la entrega de tarjetas se marca a mano con fecha, sin activar nada;
   - los códigos son los de la campaña de Empresas;
   - un descuento o un personalizado exige confirmar la comisión;
   - la recompra espontánea no lleva comisión y la trabajada lleva la completa, con la
     intervención confirmada por Administración y vinculada a una visita suya de esa
     oportunidad (una gestión de Administración sola no alcanza: corregido en B4);
   - Tobías no ve comisiones en la V1.

   *Sigue pendiente* la movilidad (y las devoluciones reales, fuera de B3).
