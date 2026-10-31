# CRM B2B · B3 — Ventas, cobros, comisiones y recompras

Administración registra la venta de una oportunidad (y recién ahí queda **Ganado**), carga los
cobros a medida que llegan, ve la comisión del comercial generarse cuando la venta está cobrada
por completo, registra sus pagos y, si el cliente vuelve a comprar, abre una oportunidad de
recompra. Todo es manual: no hay cobros reales, Mercado Pago, facturación ni movimientos de
Finanzas.

Estado: **B3 implementado y verificado en el entorno local aislado del CRM. Sin migrar, sin
publicar y sin cambios en Vercel.** Diseño general: [diseno.md](diseno.md). Bloques anteriores:
[b0-identidad.md](b0-identidad.md), [b1-prospeccion.md](b1-prospeccion.md),
[b2-seguimiento.md](b2-seguimiento.md).

## Pantallas (solo Administración)

| Dónde | Qué hace |
|---|---|
| Detalle de la oportunidad en `/admin/crm/seguimiento?op=<id>` | Botón **Registrar venta** (deshabilitado en pausa; una perdida se reabre antes). En una ganada: resumen de la venta (importe, cobrado, saldo, estado de cobro, comisión y tarjetas), **Ver la venta** y solo **Agregar nota**. |
| Bandeja `/admin/crm/seguimiento` | Vista nueva **Ganadas** (las ganadas salen de «Para seguir» pero siguen a mano). Filtro «Originado por» con **Administración (recompra)**. |
| `/admin/crm/ventas` | Lista con filtros (fecha de acuerdo desde/hasta, negocio, pack, estado de cobro, estado de comisión, ver anuladas), botones de pendientes (**Falta cobrar**, **Falta entregar tarjetas**, **Comisión para pagar**) y totales de la misma lista filtrada. |
| `/admin/crm/ventas/[id]` | Detalle: acuerdo (foto de las condiciones), cobros (**Registrar anticipo**, **Completar saldo** o **Cobro total**, **Otro cobro**, anular con motivo), comisión (estado, pagos, **Registrar pago de comisión**, anular pago), tarjetas y códigos (entrega con fecha, campaña de Empresas en solo lectura), **Corregir**, **Anular venta** e historial. |
| Ficha `/admin/crm/negocios/[id]` | Sección **Compras** (historial y cifras) y **Nueva oportunidad de recompra**. La inyecta la página de Administración: la ficha compartida con el comercial no la conoce. |
| `/admin/crm/configuracion` | **Productos y comisiones**: precio y comisión de lista de Pack 10 y Pack 25, activar o desactivar productos. |

Lo pendiente de cobro, de entrega y de comisión vive en «Ventas», separado de las próximas
acciones de B2.

## Productos

| Producto | Cantidad | Importe de lista | Comisión de lista |
|---|---|---|---|
| Pack 10 | 10 experiencias de 20 min | $ 150.000 | $ 40.000 |
| Pack 25 | 25 experiencias de 20 min | $ 360.000 | $ 90.000 |
| Personalizado | más de 25 (mínimo 26), duración a cargar | a mano | a mano |

Un pack no cambia su cantidad ni su duración. Cambiar el catálogo vale para las ventas que se
registren después: cada venta guarda su foto (`producto_nombre`, cantidad, duración, importe,
`precio_catalogo`, `comision_catalogo`).

## Venta y Ganado

- **Una sola operación** (`crm_venta_registrar`) registra la venta y pasa la oportunidad a
  `ganada` (`cerrada_en`, `cierre_motivo = 'ganada'`, `ganada_en`, `estado_al_ganar`), deja una
  actividad «Venta registrada» y cancela sus próximas acciones con motivo `ganada`. Visitas,
  gestiones, fechas, hitos y atribución quedan como estaban.
- No hace falta recorrer las etapas: se vende desde cualquier etapa abierta. Una pausada se
  retoma antes; una perdida se reabre antes.
- **Ganado ⇔ venta vigente**: un trigger diferido rechaza una oportunidad ganada sin venta
  vigente y una venta vigente con la oportunidad abierta. Un índice único deja **una venta
  vigente por oportunidad**.
- Campos: fecha del acuerdo (no futura ni anterior al inicio del ciclo; por defecto, hoy en
  Córdoba), producto, cantidad y duración (solo el personalizado), **importe acordado**,
  comisión y observación.
- **Importe acordado** = acuerdo comercial, sin IVA ni comprobantes. `numeric(12,2)`; la base
  valida centavos (hasta 2 decimales, ni un número con más). La pantalla entiende cómo se escribe
  en Argentina («150.000», «150.000,50») y muestra lo que va a guardar.
- Un importe distinto del de lista en un pack se confirma (`importe_confirmado`) y además pide
  revisar la comisión.

## Cobros

- Cada cobro: venta, **fecha efectiva** (entre el acuerdo y hoy), importe, medio (transferencia,
  efectivo, Mercado Pago *anotado a mano*, tarjeta, otro), referencia, concepto (anticipo,
  saldo, otro), actor (Administración) y **fecha de carga** aparte.
- Condición inicial 50/50: el **anticipo esperado** es la mitad del importe (redondeada al
  centavo hacia arriba); es una referencia para cargar, no un estado.
- Estado **derivado** de los cobros vigentes: *Sin cobros* · *Cobro parcial (menos que el
  anticipo)* · *Anticipo cobrado · falta el saldo* · *Cobrada por completo*. No hay casillas de
  «pagado».
- **Lo cobrado nunca supera el importe**: la RPC bloquea la venta (`FOR UPDATE`) y lo comprueba;
  un trigger diferido es la segunda barrera. Un importe no puede corregirse por debajo de lo ya
  cobrado.
- **Posible duplicado**: mismo importe y misma fecha que un cobro vigente → la base no lo
  registra y devuelve `posible_duplicado`; la pantalla pregunta «¿Es otro cobro?» y, si se
  confirma, lo registra (dos pagos iguales legítimos).
- Idempotente por clave de envío (ver «Consistencia»).

## Comisión comercial

| Caso | Regla |
|---|---|
| Venta nueva | Al comercial que **originó el lead** (`origen_usuario_id`), aunque cierre Administración o haya cambiado el responsable del negocio. A otra persona → `comision_origen`. |
| Recompra espontánea | **No corresponde** (sin importe ni beneficiario; nunca 0). |
| Recompra trabajada | Comisión completa a quien la trabajó, con la intervención **confirmada por Administración** y vinculada a una visita suya de esa oportunidad o a una gestión de esa oportunidad. Sin vínculo, o con una visita de otra persona u otra oportunidad → rechazo. |
| Personalizado | Comisión a mano (mayor que cero y no mayor que la venta) y confirmada. |
| Acuerdo especial | Con o sin comisión, con detalle obligatorio y confirmación. |

Es estándar (no pide confirmación) solo la comisión pactada de un pack, con el importe de
lista y la comisión de lista, a quien originó el lead o a quien trabajó la recompra. Todo lo
demás (descuento, personalizado, acuerdo especial) pide **confirmar la comisión**.

Estados (derivados de cobros y pagos vigentes):

- **No corresponde**: la venta no lleva comisión.
- **Prevista**: pactada, con la venta todavía sin cobrar por completo.
- **Generada · sin pagar**: venta cobrada por completo y ningún pago.
- **Parcialmente pagada** / **Pagada**: según lo pagado frente a lo pactado.
- **A revisar**: algo no cierra: pagos que superan lo pactado, pagos a otra persona, pagos en
  una venta sin comisión o que dejó de estar cobrada por completo (por ejemplo, tras corregir el
  importe). Mientras esté a revisar no se registran pagos nuevos.

Pagos de comisión: fecha, importe y referencia; solo con la comisión generada y sin superar lo
pactado (también con pagos simultáneos: bloqueo de la venta). El beneficiario queda copiado en
cada pago. Nada se borra; un pago se anula con motivo. Solo Administración ve comisiones:
Tobías no las ve en la V1.

## Recompras e historial

- La recompra es **una oportunidad nueva y una venta nueva**: la ganada nunca se reabre ni se
  pisa. Se crea de dos maneras:
  - **Administración**, desde la ficha («Nueva oportunidad de recompra»), con un contacto
    existente del negocio, nota y próxima acción opcionales (`origen_tipo = 'recompra_admin'`,
    sin visita ni comercial de origen). Exige compras previas (venta vigente o «cliente previo»),
    negocio sin archivar y ninguna otra oportunidad abierta.
  - **Una visita** de un comercial con contacto útil a un negocio cuya última oportunidad
    cerrada es una ganada: B1 abre una oportunidad nueva (la visita es su origen).
- Una venta es **recompra** si el negocio es cliente previo o tiene otra venta vigente.
- **Compras de la ficha** (`resumenCompras`):
  - *compras* = acuerdos **vigentes** registrados en el CRM, con o sin cobro (una anulada no
    cuenta);
  - *cobradas por completo* = las compras con el cobro según CRM igual al importe;
  - *última compra* = la fecha de acuerdo más reciente;
  - importes acordado, cobrado según CRM y saldo;
  - packs = compras por producto.
- «Cliente previo» se conserva: la ficha advierte que lo comprado antes del CRM no está cargado
  (historial incompleto). No hay importador histórico.

## Tarjetas, códigos y vencimiento

- Entrega de tarjetas: *Sin entregar* / *Entregadas* con fecha (y detalle opcional). Se marca a
  mano: no activa ni envía nada.
- Vínculo **de solo lectura** con una campaña de Empresas (`empresa_campanias`). El CRM muestra:
  - estado efectivo (con la regla de `lib/empresas.ts`), estado de pago en Empresas, turnos y
    duración, usos por código;
  - códigos generados, disponibles, utilizados, vencidos y cancelados, y cantidad de canjes;
  - vencimiento.

  No lee los códigos en sí ni datos de beneficiarios, y no crea ni modifica la campaña.
- Una campaña no puede estar vinculada a dos ventas vigentes (índice único; anular la venta la
  libera).
- **Vencimiento**: el de la campaña vinculada; sin campaña (o sin fecha en la campaña), **«Sin
  definir»**. El CRM no copia ni calcula 30 o 60 días.
- Avisos (solo informan, no modifican nada):
  - cantidad o duración distintas entre la campaña y la venta;
  - campaña eliminada;
  - **discordancia de cobro**: Empresas la marca pagada y el CRM no la tiene cobrada por
    completo, o al revés.

  Se comparan estados, no montos: la campaña tiene su propio precio con IVA.

## Correcciones y anulaciones

Una corrección o una anulación arregla un error de carga; **no es una devolución de dinero**.
Solo Administración, siempre con motivo y auditoría, sin borrar nada.

| Acción | Precondiciones y efecto |
|---|---|
| Anular un cobro / un pago de comisión | Motivo obligatorio. Queda marcado (fecha y motivo) y deja de sumar. |
| Corregir la venta | Motivo obligatorio. Fecha del acuerdo (no posterior al primer cobro), cantidad y duración (personalizado), importe (no por debajo de lo cobrado; distinto del de lista → confirmar), comisión (obligatoria y confirmada si cambia el importe) y observación. La auditoría guarda antes y después; la foto del catálogo no cambia. |
| Anular la venta | Motivo obligatorio. **Sin cobros ni pagos de comisión vigentes** (se anulan antes). Si el negocio tiene **otra oportunidad abierta**, conflicto (`otra_oportunidad_abierta`): no puede quedar con dos abiertas. Efecto: la venta queda anulada; la oportunidad vuelve **abierta a la etapa que tenía al ganar** (actividad «Venta anulada»); la campaña vinculada se libera; la oportunidad puede volver a venderse. |

Todo en una transacción. **Devoluciones reales** (dinero que vuelve al cliente) quedan fuera
de alcance: requieren definir su tratamiento en Finanzas y en la comisión antes de modelarlas.

## Finanzas, aislado

B3 no escribe en `fin_*`: ni movimientos, ni fuente de facturación, ni cuentas, ni
conciliación. No hay doble conteo porque nada del CRM se suma a Finanzas. Los nombres lo dejan
claro en pantalla: **Importe acordado**, **Cobrado según CRM**, **Comisión comercial**. Cada
venta, cobro y pago tiene un id estable para que un bloque futuro pueda conciliarlos; B3 no
empieza B4.

## Datos, RPC y permisos

`db/crm-b3-ventas.sql` va en `db/orden.txt` (sección 13j) **después de**
`crm-b2-seguimiento.sql`. Aditivo e idempotente; verificación:
`db/crm-b3-ventas.verificacion.sql` (se deshace entera; `RESULTADO CRM-B3|OK 48`).

| Objeto | Contenido |
|---|---|
| `crm_productos` | Catálogo (`pack_10`, `pack_25`, `personalizado`) con precio y comisión de lista, mínimo del personalizado, activo y versión. |
| `crm_ventas` | Foto del acuerdo, comisión (tipo, importe, beneficiario, fundamento, detalle, intervención), entrega, campaña (`campania_id`, sin FK al módulo Empresas), anulación, clave de operación y versión. |
| `crm_cobros` / `crm_comision_pagos` | Registros con fecha, importe, referencia y anulación (los pagos copian el beneficiario). |
| `crm_oportunidades` (+ columnas) | `origen_tipo` (`visita` · `recompra_admin`), `ganada_en`, `estado_al_ganar`; `origen_visita_id` y `origen_usuario_id` pasan a admitir nulo solo para `recompra_admin`. Estado y cierre suman `ganada`. |
| `crm_venta_registrar` | Venta + Ganado (solo admin). |
| `crm_venta_gestionar` | `cobro`, `anular_cobro`, `pago_comision`, `anular_pago_comision`, `corregir`, `anular`, `entrega`, `vincular_campania` (solo admin). Cobros y pagos no exigen la versión (son sumas protegidas por el bloqueo); el resto, sí. |
| `crm_oportunidad_recompra` | Oportunidad de recompra con un contacto existente (solo admin). |
| `crm_producto_actualizar` | Catálogo (solo admin). |
| Redefinidas de B2 | `crm_oportunidad_gestionar` (sobre una ganada solo nota o contacto principal), `crm_visita_registrar` (tras una ganada, una visita útil abre una oportunidad nueva), `crm_visita_anular` (no anula la visita que origina o sostiene la comisión de una venta vigente: `visita_con_venta`). |

Permisos: RLS sin políticas; `service_role` solo lee las tablas nuevas; toda escritura por las
RPCs (`SECURITY DEFINER`, actor validado, solo admin); funciones internas sin `EXECUTE`. Rutas
(todas con `actorAdmin`: sin sesión 401, staff 403, cookie comercial 401):

- `/api/admin/crm/ventas` y `/api/admin/crm/ventas/[id]`;
- `/api/admin/crm/oportunidades/[id]/venta`;
- `/api/admin/crm/negocios/[id]/compras` y `/api/admin/crm/negocios/[id]/recompra`;
- `/api/admin/crm/productos` y `/api/admin/crm/campanias`.

La interfaz comercial no tiene rutas de B3. Sus lecturas no consultan ventas, y su ficha excluye
las oportunidades ganadas: nada de importes, cobros ni comisiones le llega ni anidado.

**Revisión del cambio NOT VALID de B1 (pedido al empezar B3).** Las restricciones que un bloque
posterior amplía (auditoría en B1, B2 y B3; estado y cierre de la oportunidad en B2) se crean
`NOT VALID` y se intenta validarlas en el mismo archivo; si hay filas de un bloque posterior, el
intento avisa y deja la validación para ese bloque. Una restricción `NOT VALID` **igual se aplica
a lo que se escriba después**: lo inválido sigue rechazado. `db/crm-cadena.verificacion.sql`
exige el estado final de la cadena:

- ninguna restricción `crm_*` sin validar;
- todas las entidades y acciones legítimas de B0 a B3 aceptadas;
- lo inválido rechazado.

Resultado: `OK 60`. Reaplicar B1 → B2 → B3 con una venta, un cobro, un pago de comisión y una
recompra presentes deja todo validado. El único caso «sin validar» es transitorio: reaplicar un
bloque anterior solo, hasta reaplicar los siguientes (el orden de `db/orden.txt` lo evita).

### Consistencia, reintentos y concurrencia

- Cada operación es **atómica** (venta + Ganado + actividad + seguimientos + auditoría; cobro +
  auditoría; anulación + reapertura + actividad…).
- **Idempotencia**: clave por envío y huella calculada en el servidor (venta: oportunidad,
  versión y datos; gestión: venta, versión, acción y datos). Misma clave y contenido → el mismo
  resultado (`repetida`); otro contenido → `clave_reutilizada`. Una respuesta incierta bloquea
  el formulario y se reintenta con la misma clave y el mismo cuerpo.
- **Concurrencia**:
  - la venta bloquea la oportunidad y exige su versión;
  - cobros y pagos bloquean la venta (`FOR UPDATE`) antes de sumar;
  - el índice de una venta vigente por oportunidad y el trigger de cobros son la segunda barrera.

## Pruebas

| Prueba | Resultado |
|---|---|
| `db/crm-b3-ventas.verificacion.sql`: privilegios y catálogo; validaciones (comisión al responsable actual, importe sin confirmar, centavos, pack con otra cantidad, comisión 0, venta en pausa); Pack 10 desde «contacto»; invariantes con triggers en modo inmediato; anticipo, duplicado, tope y fechas; pagos parciales y tope; anulación y nueva venta; catálogo; visitas sobre una ganada; recompras trabajada y espontánea; personalizado y acuerdo especial; entrega y campaña; auditoría | OK 48 |
| `db/crm-cadena.verificacion.sql` (con B3) | OK 60 |
| `lib/crmB3.test.ts` (puro): importes (miles y decimales a la argentina, centavos, coma flotante), flujos de Pack 10 y Pack 25, estados de comisión, reglas y confirmaciones, avisos de campaña, filtros, totales y compras, huellas, aislamiento estático | OK |
| `lib/crmB3.integration.ts` (rutas reales): ver detalle abajo | OK |
| Regresión: integración B0, B1 (carrera de visitas: 1 vs. 8 en el control) y B2 (carrera de programaciones: 1 vs. 6); verificaciones B1 (OK 110) y B2 (OK 42); pruebas puras de B1, B2, Auth (cookies, aislamiento), panel (19 redirecciones, 18 casos de `/comercial`, 204 del router), sesión, límite y contraseña | OK |

Lo que cubre `lib/crmB3.integration.ts`:

- permisos en las 10 rutas;
- Pack 10 con el cierre de Ramiro sobre un lead de Tobías, con otro responsable;
- anticipo, duplicado avisado, saldo, comisión generada, pagos parcial y total;
- Pack 25 con un cobro único;
- recompras espontánea y trabajada, con ids cruzados;
- personalizado;
- cambio de catálogo;
- doble venta, reintentos en paralelo y respuesta incierta;
- **carreras reales** con ventana entre escritura y commit:
  - 6 cobros de $ 30.000 sobre $ 150.000 → $ 150.000 (control sin bloqueo ni trigger → $ 180.000);
  - 6 pagos de $ 10.000 sobre $ 40.000 → $ 40.000 (control sin bloqueo → $ 60.000);
- correcciones y anulaciones, con el conflicto de dos abiertas;
- Ganado en la bandeja y el detalle de B2;
- entrega y campaña ficticia sin modificarla;
- compras de la ficha y nada de ventas en respuestas comerciales;
- auditoría y errores sin detalles internos.

La suite de B2 ahora restaura solo la definición **vigente** de la cadena (B3 redefine la
gestión): antes reaplicaba su archivo entero, lo que habría pisado B3.

## QA (escritorio y celular, servidor de producción local)

Caso completo por la interfaz real, contra la instancia aislada: en escritorio con «Ferretería
Los Andes» (Pack 10) y en celular (375×812) con «Panadería Sol de Mayo» (Pack 25), ambos en
Negociación y originados por el comercial de prueba.

| Paso | Resultado comprobado |
|---|---|
| Registrar venta | El formulario propone la comisión del comercial que originó el lead y resume importe, anticipo esperado y saldo. Al guardar: «Venta registrada: la oportunidad pasó a Ganado»; el historial muestra «Venta registrada · Negociación → Ganado»; el pie queda en «Ver la venta» y «Agregar nota». |
| Anticipo | Se precarga el 50% ($ 75.000 / $ 180.000). Queda «Anticipo cobrado · falta el saldo» con comisión prevista. |
| Saldo | Mismo importe y fecha → aviso «¿Es otro cobro?» con el botón principal bloqueado; al confirmar: «Cobrada por completo», saldo $ 0 y comisión «Generada · sin pagar». |
| Pago de comisión | En escritorio, «15.000» se lee $ 15.000 → «Parcialmente pagada»; el resto (precargado) → «Pagada». En celular, un pago por el total. |
| Campaña de Empresas (ficticia) | Búsqueda por nombre; al vincular, códigos (10 · 8 disponibles · 2 utilizados), vencimiento «Sin definir» y el aviso de discordancia (cobrada en el CRM, pago pendiente en Empresas). La campaña no cambió. |
| Tarjetas | «Entregadas el sáb 31/10»; el aviso pasa a «Cobrada, entregada y sin comisión pendiente». |
| Ficha e historial | Compras: 1 · 1 cobrada por completo · última compra · $ 150.000 · 1 × Pack 10; el lead figura «Ganado (venta registrada)». |
| Recompra | «Nueva oportunidad de recompra» → lead «Originado por Administración»; la ganada queda intacta y el botón se oculta con el motivo. En la bandeja aparece como «Administración (recompra)»; la vista «Ganadas» lista las dos. |
| Lista de ventas | Pendientes y totales de la lista filtrada, coherentes con los detalles. |

En celular, sin desborde horizontal en la lista, el detalle, los paneles y la ficha (medido en el
DOM). Los paneles ocupan la pantalla y su pie queda fijo. El aviso de cookies ya no tapa el pie:
se corrigió al empezar B3 (`d30c1a6`).

Límites: emulación de Chrome (no un teléfono real) y red local. La interfaz comercial no se
recorrió a mano en este bloque: su aislamiento lo cubren la integración (respuestas) y el
análisis estático (código).

## Datos en el entorno local

Además de lo de B1 y B2, la instancia aislada tiene las dos ventas del QA (con sus cobros, pagos
y entrega), dos oportunidades de recompra abiertas y una campaña de Empresas **ficticia**:

- «Ferretería Los Andes · Clientes del mes (QA local)», `created_by = 'qa-crm-local'`;
- 10 códigos `QAB3….`, vinculada a la venta de Ferretería.

Solo existen ahí. Las suites automáticas limpian sus propios datos.

## Integración del parche de seguridad (cierre de B3)

Por decisión del usuario (transmitida por la sesión de Seguridad), al terminar la
implementación se incorporaron las correcciones vigentes de `main` que le faltaban a la rama,
con `git cherry-pick -x`, sin conflictos y sin duplicar commits:

- `bd7f170` ← `6f9f523`: Next 16.4.3, React y React DOM 19.2.9, sharp ^0.35.5;
- `958de20` ← `9e1ebf3`: eslint-config-next se mantiene en 16.2.9;
- `32c2700` ← `33ca411`: webhooks de Mercado Pago con falla cerrada.

`package.json` y `package-lock.json` quedaron idénticos a los de `main`. `npm ci` instaló next
16.4.3, react y react-dom 19.2.9, sharp 0.35.5 y eslint-config-next 16.2.9 (Node 24.22.1).

`npm audit --package-lock-only`: 0 críticas, 0 altas, 24 moderadas. Vienen de dos avisos raíz:
uuid < 11.1.1 y minimatch < 11.0.1. Es lo mismo que tiene `main`; no se tocó.

Repetido sobre 16.4.3:

- tipos y lint;
- todas las pruebas puras del CRM y `lib/mercadopagoFirma.test.ts`;
- las cuatro integraciones (permisos y carreras) y las cuatro verificaciones SQL;
- `next build`;
- servidor real: la entrada del router a `/comercial` desde afuera da 204 `no-store` y un
  documento da 200; `/admin/crm/ventas` sin sesión redirige al login (307); la API sin sesión
  da 401.

## Limitaciones y lo que queda

- Devoluciones reales fuera de alcance (ver «Correcciones y anulaciones»).
- Sin recordatorios: lo pendiente se ve al abrir «Ventas».
- Administración sigue siendo la credencial compartida: cobros y pagos figuran como
  «Administración».
- Movilidad (quién la paga y si resta) sigue sin decidir; no entra en la comisión.
- El estado del negocio en la ficha sigue siendo el de la prospección («Visitado», «Lead para
  seguimiento»); las compras se ven en su sección.
- **B4** (no empezado): métricas y tablero sobre ventas, cobros, comisiones, hitos y ciclos;
  allí se definen caja y contribución comercial (ver diseno.md, corrección 6).
