# Mini CRM comercial B2B — nota de diseño

Prospección presencial de packs corporativos (Tobías) y seguimiento, venta y cobro (Ramiro /
admin). Objetivo del MVP: registrar → seguir → vender → medir.

Este documento resume el diseño acordado y las correcciones que se aplican a los bloques
posteriores. Lo implementado está en [b0-identidad.md](b0-identidad.md).

## Bloques

| Bloque | Alcance | Estado |
|---|---|---|
| B0 | Identidad comercial: usuarios individuales, sesión propia, administración de usuarios (+ B0.1: límite con respaldo, aislamiento de la analítica) | Implementado y verificado en local; sin migrar ni publicar |
| B1 | Empresas, contactos, jornadas y visitas desde el celular | Pendiente |
| B2 | Oportunidades, bandeja de seguimiento, tareas y transiciones | Pendiente |
| B3 | Ventas, cobros, saldo y comisiones; vínculo de solo lectura con Empresas | Pendiente |
| B4 | Métricas y tablero | Pendiente |

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
   empresa ajena.
4. **La ventana de 48 h para editar o anular visitas es una propuesta técnica**, no una regla
   comercial aprobada. Queda pendiente para B1.
5. **Teléfono compartido.** Varios contactos de una misma empresa pueden tener el mismo número
   (por ejemplo, el central del local para el encargado y el dueño). No hay unicidad por
   teléfono; a lo sumo, un aviso informativo.
6. **Caja y contribución comercial se definen por separado antes de B4.** "Cobrado − comisión
   generada − movilidad" mezcla cobros con obligaciones devengadas y no se usa. Se definirán,
   con fechas y conceptos coherentes: un movimiento de caja (cobros, comisiones pagadas,
   gastos pagados) y una contribución comercial (ventas, comisiones devengadas, movilidad del
   período).
7. **Nombre de las conversiones.** Si el denominador son negocios únicos, la métrica se llama
   conversión *de negocios* ("negocios visitados → ventas"), no de visitas.
8. **Historia B2B en Finanzas.** La auditoría buscó "empresa" y "pack" en descripciones y
   observaciones de `fin_movimientos`. Eso no demuestra que no haya operaciones B2B
   históricas: quedan *no identificadas con las comprobaciones realizadas*.
9. **Decisiones comerciales pendientes, sin adoptar por defecto:** IVA de los precios,
   vigencia de los packs, momento de entrega y activación de tarjetas/códigos, formato de
   códigos (individuales o uno con varios usos), descuentos y su efecto en la comisión,
   intervención comercial en recompras, movilidad (quién la paga y si resta) y visibilidad de
   las comisiones para Tobías. B0 no implementa ni presupone ninguna.
