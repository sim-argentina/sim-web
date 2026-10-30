# CRM B2B · B2 — Seguimiento comercial de Administración

Ramiro recibe los leads que deja la prospección de Tobías y los gestiona a mano desde una
bandeja: primer contacto, conversaciones, interés, propuesta, negociación, próxima acción,
pausa ("retomar más adelante"), pérdida con motivo y reapertura.

Estado: **B2 implementado y verificado en el entorno local aislado del CRM. Sin migrar, sin
publicar y sin cambios en Vercel.** Diseño general: [diseno.md](diseno.md). Bloques
anteriores: [b0-identidad.md](b0-identidad.md), [b1-prospeccion.md](b1-prospeccion.md).

B2 **no** incluye ventas, cobros, comisiones, emisión de códigos, Finanzas ni mensajes
automáticos. **"Ganado" queda reservado para B3**: no existe como estado ni como acción.

## Pantallas

| Dónde | Qué hace |
|---|---|
| `/admin/crm/seguimiento` (entrada principal del CRM y del menú) | Bandeja "Contactos para seguir": vista **Para seguir** (oportunidades abiertas, en grupos) y vista **Perdidas**; búsqueda por negocio o contacto; filtros por estado, comercial de origen, interés, rubro, zona y próxima acción. |
| Detalle (`?op=<id>`, sobre la bandeja) | Panel lateral en escritorio y pantalla completa en el celular (cerrar vuelve a la bandeja con sus filtros). Contacto principal (con "Abrir WhatsApp" manual), lo que dejó la visita (interés, necesidades, pack, última nota de Tobías), próxima acción, advertencias con su acción y el historial completo. Acciones: registrar gestión, programar/reprogramar, retomar más adelante, retomar ahora, marcar perdida, reabrir y cambiar el contacto principal. |
| `/admin/crm/negocios/[id]` | La ficha muestra el estado de la oportunidad y enlaza a "Gestionar en Seguimiento". |
| `/comercial/negocios/[id]` | Tobías ve solo el **resumen** (estado de la abierta y si hubo una perdida, quién la originó y cuándo). Nada de gestiones, notas, próximas acciones ni motivos de Administración. |

Negocios, Jornadas y Configuración siguen en el menú del CRM.

## Estados y transiciones

Se reutiliza `crm_oportunidades` (sin pipeline paralelo). Etapas con orden de avance:

`contacto` (Contacto conseguido) → `conversacion` (En conversación) → `interesado` →
`negociacion`. Además: `pausada` (Retomar más adelante) y `perdida`.

| Acción | Efecto |
|---|---|
| WhatsApp enviado · No respondió · Llamada realizada | Se registra; el estado no cambia. |
| Respondió | Contacto → En conversación. En una etapa posterior no cambia nada (no prueba interés). |
| Propuesta enviada | Hecho registrado (`propuesta_en`); **no** pasa a negociación. |
| Inicio de negociación | Avanza a Negociación desde una etapa anterior. |
| Cambio de estado | Manual a cualquier etapa. Hacia atrás (retroceso) exige motivo y queda auditado. |
| Nota | No cambia el estado ni completa una próxima acción. |
| Retomar más adelante | Fecha de recontacto (desde mañana). Guarda el estado previo; cancela la próxima acción pendiente y la reemplaza por "retomar". Mientras dura no se puede avanzar ni programar. |
| Retomar ahora | Explícito: vuelve al estado previo y resuelve el "retomar" (puede programar la siguiente en el mismo paso). Llegar la fecha **no** la reanuda sola. |
| Marcar perdida | Motivo de la lista (Precio · Sin presupuesto · No le encontró utilidad · No le interesa el producto · Ya utiliza otro sistema de beneficios · No es prioridad actualmente · No se pudo llegar al decisor · Dejó de responder · Condiciones / horarios · Otro, con detalle obligatorio). Cierra la oportunidad y cancela **solo sus** próximas acciones. Sobre una perdida solo se agregan notas. |
| Reabrir | Solo admin, con motivo, a la etapa elegida (por defecto la que tenía al perderse). Falla con conflicto si el negocio tiene otra oportunidad abierta, sin cambiar nada. |

Los avances automáticos nunca hacen retroceder una etapa más avanzada y nada se deduce del
texto libre. "Seguimiento pendiente" no es un estado: es una próxima acción pendiente.
"Por visitar" y "Visitado" siguen describiendo la prospección del negocio.

### Hitos y ciclos (para medir sin sobrescribir)

- `lead_en`, `origen_usuario_id` y `origen_visita_id` son la **adquisición del lead** (ciclo 1).
  La gestión y la reapertura no los cambian; solo la reasignación del origen al anular su
  visita (B1), y entonces toman la fecha de la nueva visita de origen.
- `gestionada_en`: primera gestión de Administración (no cambia después).
- Hitos del ciclo vigente: `conversacion_en`, `interesado_en`, `propuesta_en`,
  `negociacion_en` = primera vez que llegó, con el **momento de la actividad** (no el del
  registro). Un salto (por ejemplo, contacto → negociación) deja vacíos los intermedios: "llegó
  a interesado" = `interesado_en` o `negociacion_en` presentes.
- **Reapertura** = nuevo ciclo de la misma oportunidad: el ciclo perdido se copia completo e
  inmutable a `crm_oportunidad_ciclos` (inicio, estado inicial, hitos, estado al perder, fecha
  y motivo de pérdida, reapertura y su motivo); en la oportunidad `ciclo` suma 1,
  `ciclo_inicio_en` = momento de la reapertura, `ciclo_estado_inicial` = etapa elegida y los
  hitos vuelven a NULL. Las actividades llevan su ciclo y no pueden fecharse antes del inicio
  del ciclo.

## Bandeja, grupos y contadores

Cada oportunidad abierta cae en **un solo** grupo (no hay filas repetidas), por esta regla
(`grupoDe`, `lib/crmB2.ts`):

1. Con acción pendiente "retomar" (pausa): si llegó la fecha → **Retomar: llegó la fecha**; si
   no → **Próximas acciones y pausas**.
2. Con próxima acción pendiente: vencida → **Seguimientos vencidos**; hoy → **Acciones de
   hoy**; futura → **Próximas acciones y pausas**.
3. Sin acción pendiente: nunca gestionada → **Leads nuevos sin gestionar**; gestionada →
   **Sin próxima acción**.

"Hoy" es la fecha de negocio de SIM (Córdoba): a las 00:00 de Córdoba una acción de "hoy" pasa
a vencida. Los contadores salen de la **misma lista filtrada** que las filas; elegir un grupo
solo recorta las filas. Las advertencias son etiquetas, no grupos: **sin contacto principal**,
**contacto archivado**, **contacto sin teléfono utilizable** y **negocio archivado**. Ninguna
oculta la oportunidad, y el detalle ofrece cómo resolverla (elegir otro contacto principal,
cargar o editar contactos, desarchivar o revisar el negocio). Las perdidas se consultan en su
vista, con fecha, motivo y cuántas visitas hubo después.

## Próxima acción

- Una sola pendiente por oportunidad (índice único parcial). Opciones rápidas (mañana, en 3
  días, en una semana) o fecha elegida, desde hoy (fecha de SIM), con una descripción opcional.
- **Reprogramar** deja la anterior como `reprogramada` y crea otra que la referencia (historia
  completa). Cambiar la fecha de una pausa también actualiza el "retomar el".
- Registrar una gestión puede **resolver** la próxima acción (casilla explícita que nombra qué
  acción se resuelve) y programar la siguiente en la **misma transacción**. Una nota no puede
  resolverla. Sin próxima fecha, la oportunidad queda en "Sin próxima acción".
- Consultar la oportunidad, abrir WhatsApp, escribir una nota o mirar la ficha **no** completan
  nada. "Abrir WhatsApp" es solo un enlace: el envío se registra cuando Ramiro marca "WhatsApp
  enviado". El enlace aparece solo si el número está cargado completo en formato internacional
  (`+54 9 …`, `00…` o `549…`); no se inventan el código de país ni el 9.
- Las **revisitas** de Tobías (B1, `crm_tareas`) son acciones de calle con su responsable y no
  se mezclan: una visita resuelve la revisita, nunca el seguimiento de Ramiro; perder la
  oportunidad no cancela revisitas.

## Integración con B1

| Situación | Comportamiento |
|---|---|
| Visita con contacto útil y negocio sin oportunidades | Crea la oportunidad (como en B1): aparece en "Leads nuevos". |
| Visita sobre una oportunidad abierta (cualquier etapa) | Se liga a ella. Solo hace avanzar `contacto`/`conversacion` → `interesado` con interés tibio o caliente; nunca retrocede una negociación. |
| Visita sobre una oportunidad en pausa | Se liga; no la saca de la pausa ni cambia el estado previo. |
| Visita en un negocio cuya última oportunidad está **perdida** | No la reabre. Si el contacto útil se **cargó nuevo en esa visita**, nace una oportunidad nueva (lead realmente nuevo, atribuido a quien visitó; la auditoría registra `tras_perdida`). Si solo se eligió un contacto ya cargado, la visita queda ligada a la perdida como historia ("N visitas después") y la decisión de reabrir es de Administración. |
| Corregir una visita (admin) | Si la oportunidad ya tiene gestión de Administración, no se recalcula el estado (manda la gestión). Sin gestión, se recalcula como en B1. |
| Anular la visita de origen | "Cerrar el lead" se **rechaza** si hay gestión (`oportunidad_gestionada`), sin cambios; "reasignar el origen" sigue disponible y conserva la gestión y el contacto principal elegido por Administración. |
| Archivar el negocio | No borra ni oculta sus oportunidades abiertas: siguen en la bandeja con advertencia. |

**Reapertura vs. oportunidad nueva**: la reapertura es la misma fila (mismo origen, misma
fecha de lead, ciclo + 1) y la decide Administración; una oportunidad nueva es otra fila con
su propio origen, que solo nace de una visita que obtiene un contacto útil nuevo cuando no hay
otra abierta. Las cerradas conservan su historia (actividades, próximas acciones, ciclos y
visitas ligadas).

## Datos, RPC y permisos

`db/crm-b2-seguimiento.sql` va en `db/orden.txt` (sección 13i) **después de**
`crm-b1-prospeccion.sql`. Aditivo e idempotente; verificación:
`db/crm-b2-seguimiento.verificacion.sql` (se deshace entera; `RESULTADO CRM-B2|OK 42`).
B1 pasa a crear sus restricciones de auditoría `NOT VALID` para que reaplicar la cadena B1 → B2
sobre una base con filas de B2 no falle; B2 las amplía y las deja validadas.

| Objeto | Contenido |
|---|---|
| `crm_oportunidades` (+ columnas) | Estados de B2, `estado_previo`/`retomar_el`/`pausada_en` (pausa), `perdida_*` y `estado_al_perder`, ciclo e hitos, `gestionada_en`. Restricciones nuevas reemplazan a las de B1. |
| `crm_actividades` | Gestiones y cambios de estado: oportunidad, ciclo, tipo, contacto (de ese negocio), `ocurrida_en` vs. `registrada_en`, actor (Administración), observación, estado antes/después, motivo, clave de la operación. |
| `crm_seguimientos` | Próximas acciones (`seguimiento` o `retomar`), vencimiento, descripción, estado (`pendiente`, `hecha`, `reprogramada`, `cancelada`), la anterior, la actividad que la resolvió y el motivo de cancelación. |
| `crm_oportunidad_ciclos` | Ciclos perdidos y luego reabiertos (inmutables). |
| `crm_operaciones` | Idempotencia de cada acción (nadie la lee). |
| `crm_oportunidad_gestionar(clave, huella, oportunidad, versión, acción, datos, actor)` | Única RPC de escritura: `gestion`, `programar`, `reprogramar`, `pausar`, `retomar`, `perder`, `reabrir`, `contacto_principal`. Solo admin. |
| Redefinidas de B1 | `crm_visita_registrar`, `crm_visita_anular`, `crm_oportunidad_recalcular` (ver "Integración con B1"). |

Permisos: RLS sin políticas; `service_role` solo lee las tablas nuevas (y nada de
`crm_operaciones`); toda escritura por la RPC; funciones internas sin `EXECUTE`. Las rutas
`/api/admin/crm/seguimiento` y `/api/admin/crm/oportunidades/[id]` exigen admin (sin sesión
401, staff 403, cookie comercial 401). La interfaz comercial no tiene rutas de B2 y sus lecturas
de B1 no consultan las tablas del seguimiento; su DTO de oportunidad no trae hitos.
**Reasignación**: el acceso de Tobías depende del responsable actual del negocio; haberlo
creado no da acceso permanente (la autoría queda en `creada_por_usuario`).

### Consistencia, reintentos y concurrencia

- Cada acción es **atómica**: actividad, cambio de estado, resolución de la acción pendiente,
  la siguiente y la auditoría se guardan juntas o no se guarda nada.
- **Idempotencia**: cada envío lleva una clave; la huella (oportunidad, versión, acción y
  datos) la calcula el servidor. Misma clave y contenido → el mismo resultado (`repetida`);
  otro contenido → `clave_reutilizada`. Ante una respuesta incierta, el panel bloquea el
  formulario y reintenta con la misma clave.
- **Concurrencia**: la RPC bloquea la oportunidad (`FOR UPDATE`) y exige la versión que vio el
  usuario; dos pestañas que programan a la vez → una gana y la otra recibe "alguien cambió
  esto, recargá". El índice único de una pendiente es la segunda barrera.

## Pruebas

| Prueba | Resultado |
|---|---|
| `db/crm-b2-seguimiento.verificacion.sql`: privilegios, restricciones, actividades, idempotencia y versión, próxima acción única, nota y propuesta sin efectos de más, retrocesos, visitas que no retroceden ni sacan de pausa, corrección y anulación con gestión, pausa y retomar, pérdida, visitas tras la pérdida, reapertura con y sin otra abierta, contacto principal, auditoría | OK 42 |
| `lib/crmB2.test.ts` (puro): grupos y precedencia, medianoche de SIM, contadores = filas, filtros, estados, WhatsApp sin prefijos inventados, advertencias, huella, aislamiento estático | OK |
| `lib/crmB2.integration.ts` (rutas reales): permisos; lead de B1 en la bandeja; consultar no gestiona; gestiones con y sin próxima acción; reprogramar; nota y propuesta; fecha de SIM y vencidas; visitas sobre avanzadas, pausadas y perdidas; corrección y anulación; pausa → fecha → retomar; pérdida; reapertura con y sin otra abierta; reintentos secuenciales y en paralelo; **carrera real** (6 programaciones a la vez → 1 pendiente; control sin bloqueo ni índice → 6); resumen comercial sin datos privados; reasignación sin acceso; advertencias; contadores = grupos = filas | OK |
| Regresión: verificación B0 (OK 129), B1 (OK 110), integración B0 y B1 (con su carrera y control), pruebas puras de B1 y navegación | OK |

## QA (escritorio y celular, servidor de producción local)

Caso completo hecho dos veces por la interfaz real, contra la instancia aislada: en escritorio
(panel lateral) con «Ferretería Los Andes» y en celular (375×812, pantalla completa) con
«Panadería Sol de Mayo». Ambos leads salieron de visitas del comercial de prueba, con el interés
sin evaluar.

| Paso | Resultado comprobado |
|---|---|
| Lead nuevo | Aparece en «Leads nuevos sin gestionar». Abrir el detalle (y ver el enlace de WhatsApp, `wa.me/549…` desde el número cargado completo) **no** lo marca gestionado: 0 actividades, versión intacta. |
| WhatsApp enviado + mañana | Estado sin cambio; próxima acción programada; pasa a «Próximas acciones». |
| Respondió (resolviendo) + en 3 días | Contacto → En conversación; la acción anterior queda «Resuelta … con «Respondió»» y se programa la siguiente en el mismo paso. |
| Cambio de estado → Interesado | Avance sin motivo; la próxima acción no se toca. |
| Propuesta enviada (resolviendo) + en una semana | Sigue Interesado (el formulario lo anticipa: «la negociación se marca aparte»). |
| Inicio de negociación | Interesado → Negociación. |
| Retomar más adelante | Pausa con «estaba en Negociación; retomar el …»; la próxima acción se cancela «por la pausa» y la reemplaza «Retomar»; en la bandeja, «Próximas acciones y pausas». |
| Llega la fecha (simulada en la base local: el reloj no se adelanta) | Pasa a «Retomar: llegó la fecha» y **sigue en pausa** hasta la acción explícita. |
| Retomar ahora | Vuelve a Negociación; con o sin próxima acción (sin ella, «Sin próxima acción»). |
| Marcar perdida | Motivo de la lista (en celular «Otro»: el botón no se habilita sin detalle). Se cancela la próxima acción «por la pérdida»; queda en «Perdidas» con fecha y motivo; el pie solo ofrece «Reabrir» y «Agregar nota». |
| Reabrir con otra abierta (una visita con contacto nuevo creó otra) | «El negocio ya tiene otra oportunidad abierta…»; nada cambia. |
| Reabrir sin otra abierta | Ciclo 2 en la etapa al perder, con «Fin del ciclo 1» y la pérdida en el historial; en la base: 9 actividades con su ciclo, el ciclo 1 archivado con todos sus hitos, `lead_en` y la atribución intactos. |

Además: los contadores de los grupos suman siempre «Todas»; sin desborde horizontal; todos los
controles de la bandeja y del detalle de 44 px o más; el panel de celular ocupa la pantalla y
su pie de acciones queda fijo fuera del área que se desplaza.

Hallazgos durante el QA:
- **Corregido**: el historial no mostraba cuándo se **resolvía** una próxima acción (ahora:
  «Resuelta: … con «Respondió»»); el enlace «Ver ficha del negocio» y los de las advertencias
  medían 20 px (ahora 44 px).
- **Preexistente, fuera de B2**: en el celular, el aviso de cookies del sitio (`z-index` 90) tapa
  el pie de acciones del panel (`z-index` 60) hasta que se responde una vez. Se respondió
  «Rechazar». No se cambió el componente compartido.
- El login de admin local falló una vez por la contraseña copiada; el servidor y su configuración
  estaban bien (con el valor de `.env.crm.local`: 200; con una incorrecta: 401 «Credenciales
  inválidas»; un bloqueo daría 429 y una configuración faltante, 500).

Límites: emulación de Chrome (no un teléfono real), red local y fechas de vencimiento simuladas
moviendo la fecha en la base local.

## Datos en el entorno local

Además de lo de B1, la instancia aislada tiene los leads del QA de B2 ("Óptica Mirador",
"Gimnasio Núcleo", "Ferretería Los Andes" y "Panadería Sol de Mayo", esta con una segunda
oportunidad perdida), con sus gestiones, próximas acciones y ciclos. Son ficticios y solo existen
ahí; sirven para seguir probando la bandeja. Las suites automáticas limpian sus propios datos.
Para el login de admin local se usa `ADMIN_PASSWORD` de `.env.crm.local` (ignorado por git),
copiada sola en un archivo local fuera de los repositorios para facilitar el ingreso.

## Limitaciones y lo que queda para B3/B4

- Sin recordatorios ni notificaciones: la bandeja se ordena por fecha al abrirla.
- La administración sigue siendo la credencial compartida ("Administración"); las actividades
  no distinguen personas dentro de Administración.
- "Interés" de la bandeja = el último interés declarado en una visita; Administración expresa
  el avance con el estado, no editando ese interés.
- Un salto de etapa deja hitos intermedios vacíos (documentado arriba para las métricas).
- **B3**: ventas (y recién ahí "Ganado"), cobros, comisiones y vínculo con Empresas.
  **B4**: métricas y tablero (con los hitos y ciclos de B2).
