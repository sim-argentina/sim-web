# CRM B2B · B4 — Métricas

Tablero de Administración para responder, con los registros del CRM:

- cuánta actividad de calle hay;
- cuántos contactos útiles y leads genera;
- cuántas oportunidades terminan en ventas;
- qué jornadas, zonas, rubros y necesidades rinden más;
- por qué se pierde;
- cuánto se acordó y se cobró según el CRM;
- qué comisiones corresponden;
- qué esfuerzo y movilidad quedaron registrados.

Estado: **B4 implementado y verificado en el entorno local aislado del CRM. Sin migrar, sin
publicar y sin cambios en Vercel.** Diseño general: [diseno.md](diseno.md). Bloques anteriores:
[b0-identidad.md](b0-identidad.md), [b1-prospeccion.md](b1-prospeccion.md),
[b2-seguimiento.md](b2-seguimiento.md), [b3-ventas-cobros-comisiones.md](b3-ventas-cobros-comisiones.md).

B4 es **solo lectura**:

- no cambia estados, atribuciones, comisiones ni datos para que el tablero cierre;
- no escribe en Finanzas;
- no agrega SQL, ni índices ni funciones: el volumen del CRM se lee completo, de a páginas.

## Pantalla y organización

`/admin/crm/metricas` (menú del CRM, solo admin).

- **Período**: últimos 90 días (inicial: da tiempo a que los leads tengan resultados), últimos 30
  días, este mes, mes anterior, este año, todo y personalizado. Nunca mira el futuro. Debajo
  se ven el rango, si está en curso, la fecha y hora de consulta y el día de SIM.
- **Filtros**: comercial, zona del negocio, rubro y necesidad, cada uno con su semántica a la vista.
- **Seis tarjetas**:
  - Negocios visitados;
  - Leads obtenidos (nuevos y de clientes);
  - Ventas;
  - Importe acordado;
  - Cobrado según CRM;
  - Comisión comercial generada.
- **Prospección y conversión**:
  - visitas, negocios, responsables y decisores contactados, leads, interesados y recompras de
    Administración;
  - el aviso «actividad del período ≠ conversión»;
  - la caja de la cohorte de leads: tamaño, observado hasta, antigüedad, abiertas, ganadas y
    perdidas, tasas y desglose por tipo;
  - las dos tasas de calle.
- **Jornadas y eficiencia**:
  - jornadas, km, movilidad y razones de eficiencia;
  - las dos lecturas de ventas, lado a lado («cerradas en el período» y «obtenidas hasta hoy por
    jornadas del período»), con las ventas sin jornada;
  - la lista por jornada.
- **Segmentos y motivos de pérdida**:
  - comparación por rubro, zona del negocio, necesidad, pack potencial, estado actual, interés,
    comercial de origen, mes del lead o tipo de lead, con una sola barra de conversión por fila
    (el único gráfico del tablero);
  - la tabla de motivos, con episodios y oportunidades distintas.
- **Detalle de resultados económicos**: los flujos del período, el estado de hoy de las ventas del
  período, la apertura por producto y el aviso sobre Finanzas y movilidad.

Cada cifra tiene una ayuda corta (ícono ⓘ) y **abre su detalle**. El detalle muestra:

- la definición completa: qué cuenta, fuente, fecha, unidad, lectura, fórmula y qué no cuenta;
- las filas, con enlace a la venta, la oportunidad, el negocio o la jornada;
- los totales de **todas** las filas.

En el celular las tarjetas van de a dos, las jornadas y los segmentos en tarjetas, y el detalle
ocupa la pantalla.

## Reglas generales

- **Fuente única**: `lib/crmB4.ts` (puro, sin base ni reloj propio; el «ahora» se pasa). Cada cifra
  se calcula sobre un conjunto de filas y su detalle es ese mismo conjunto, con los mismos
  filtros, fechas y exclusiones: no pueden diferir.
- **Sin límites de filas**: `lib/crmB4Server.ts` lee todo de a páginas (`todasLasFilas`, en
  `lib/crmB1Server.ts`). La lista de Ventas de B3 pasó a usar lo mismo; antes cortaba en 1000 filas.
  En el cierre del MVP también la bandeja de B2 ([cierre-mvp.md](cierre-mvp.md), §2).
- **Fecha de negocio de SIM** (Córdoba): las visitas, jornadas, acuerdos, cobros y pagos ya guardan
  el día. Los instantes (lead, señales, pérdidas) se pasan al día de Córdoba: las 23:30 del 31/10
  son octubre.
- **Registros vigentes hoy**: visitas, ventas, cobros y pagos anulados no cuentan; la trazabilidad
  queda en B1–B3. Una consulta de meses anteriores refleja los registros vigentes de hoy, así que
  una corrección o anulación posterior también la cambia. **No es un cierre**: no se reconstruye
  ninguna foto histórica que el modelo no guarda.
- **Flujo del período, lectura de hoy y cohorte** son tres cosas distintas: cada métrica declara
  cuál es (`lectura`).
- **«Sin datos»** cuando no hay con qué calcular: una razón sin denominador o una suma sin ningún
  registro completo (km o gastos). Nunca 0 % ni 0 km inventados.
- Importes en centavos enteros: los totales conservan los centavos.

## Diccionario de métricas

Generado desde `DEFINICIONES` (`lib/crmB4.ts`); la pantalla muestra la misma ayuda y la misma
definición.

| Métrica | Unidad | Fecha que usa | Lectura | Fórmula | No cuenta |
|---|---|---|---|---|---|
| `negocios_visitados` · **Negocios visitados** | negocios | Día de la visita (SIM) | Período | Negocios únicos de las visitas válidas del período. | Visitas anuladas. Un negocio cargado a mano o importado sin visita no cuenta. |
| `leads` · **Leads obtenidos** | oportunidades | Momento del lead (SIM) | Período | Oportunidades con origen en una visita y lead en el período (nuevas + de clientes). | Oportunidades cerradas porque se anuló su visita de origen; las recompras creadas por Administración (van aparte). |
| `ventas` · **Ventas** | ventas | Fecha del acuerdo | Período | Conteo de ventas vigentes. | Ventas anuladas. |
| `importe_acordado` · **Importe acordado** | pesos | Fecha del acuerdo | Período | Σ importe acordado. | Ventas anuladas. |
| `cobrado` · **Cobrado según CRM** | pesos | Fecha efectiva del cobro | Período | Σ importe de los cobros vigentes. | Cobros anulados. |
| `comision_generada` · **Comisión comercial generada** | pesos | Fecha efectiva del cobro que completó la venta | Período | Σ comisión pactada de las ventas cuya generación cae en el período. | Ventas anuladas, cobros anulados y ventas sin comisión. |
| `visitas` · **Visitas registradas** | visitas | Día de la visita (SIM) | Período | Conteo de visitas válidas. | Visitas anuladas. |
| `responsables` · **Responsables contactados** | negocios | Día de la visita (SIM) | Período | Negocios únicos con una visita marcada «habló con el responsable». | Visitas anuladas. |
| `decisores` · **Decisores contactados** | negocios | Día de la visita (SIM) | Período | Negocios únicos con una visita donde se habló con el contacto y ese contacto decide (`decisor_contactado`). | Visitas anuladas. |
| `interesados` · **Interesados** | oportunidades | Primera señal de interés | Período | Oportunidades con primera señal en el período. | «No evaluado» no es «sin interés» y tampoco cuenta. Saltar a negociación o vender sin señal de interés no se convierte en interés. |
| `recompras_admin` · **Recompras creadas por Administración** | oportunidades | Momento de creación (SIM) | Período | Conteo. | — |
| `visitas_con_lead` · **Visitas que generaron un lead** | visitas | Día de la visita | Período | Visitas del período que originaron una oportunidad ÷ visitas válidas del período. | Visitas anuladas; oportunidades cerradas por anulación del origen. |
| `cohorte_interesados` · **Leads → interesados** | oportunidades | Momento del lead (cohorte); resultados hasta hoy | Cohorte | Leads del período con alguna señal de interés ÷ leads del período. | Lo mismo que «Leads obtenidos». |
| `cohorte_ventas` · **Leads → ventas** | oportunidades | Momento del lead (cohorte); ventas hasta hoy | Cohorte | Leads del período con venta vigente ÷ leads del período. | Ventas anuladas (si se volvió a vender, cuenta la vigente). |
| `negocios_compradores` · **Negocios visitados → compradores** | negocios | Primera visita del negocio (cohorte); ventas hasta hoy | Cohorte | Negocios con primera visita en el período y una venta vigente con acuerdo desde esa fecha ÷ negocios con primera visita en el período. | Visitas anuladas; ventas anuladas; compras anteriores a la primera visita. |
| `jornadas` · **Jornadas** | jornadas | Día de la jornada | Período | Conteo. | — |
| `km` · **Km registrados** | km | Día de la jornada | Período | Σ km recorridos. | Jornadas sin uno de los dos extremos. |
| `movilidad` · **Movilidad registrada** | pesos | Día de la jornada | Período | Σ de los cuatro gastos de las jornadas completas. | Jornadas con algún gasto sin cargar (se informan aparte, con lo ya cargado). |
| `visitas_por_jornada` · **Visitas por jornada** | visitas por jornada | Día de la jornada | Período | Visitas de las jornadas del período ÷ jornadas del período. | Visitas anuladas. |
| `km_por_visita` · **Km por visita** | km por visita | Día de la jornada | Período | Σ km ÷ visitas, sobre las jornadas con km. | Jornadas con km pendientes. |
| `km_por_lead` · **Km por lead** | km por lead | Día de la jornada | Período | Σ km ÷ leads originados en esas jornadas. | Jornadas con km pendientes. |
| `movilidad_por_visita` · **Movilidad por visita** | pesos por visita | Día de la jornada | Período | Σ movilidad ÷ visitas, sobre las jornadas completas. | Jornadas con gastos pendientes. |
| `movilidad_por_lead` · **Movilidad por lead** | pesos por lead | Día de la jornada | Período | Σ movilidad ÷ leads originados en esas jornadas. | Jornadas con gastos pendientes. |
| `movilidad_por_venta` · **Movilidad por venta** | pesos por venta | Día de la jornada | Período | Σ movilidad ÷ ventas atribuidas a esas jornadas. | Jornadas con gastos pendientes; ventas anuladas. |
| `ventas_por_jornada` · **Ventas por jornada** | ventas por jornada | Día de la jornada | Período | Ventas atribuidas a las jornadas del período ÷ jornadas del período. | Ventas anuladas. |
| `importe_por_jornada` · **Importe acordado por jornada** | pesos por jornada | Día de la jornada | Período | Σ importe de las ventas atribuidas ÷ jornadas del período. | Ventas anuladas. |
| `ventas_jornadas` · **Ventas obtenidas hasta hoy por jornadas del período** | ventas | Día de la jornada atribuida | Cohorte | Ventas vigentes cuya jornada atribuida está en el período. | Ventas anuladas; ventas sin jornada atribuible. |
| `perdidas` · **Episodios de pérdida** | episodios | Momento de la pérdida | Período | Pérdidas de ciclos anteriores (reabiertos) + pérdida vigente. | — |
| `experiencias` · **Experiencias vendidas** | experiencias | Fecha del acuerdo | Período | Σ experiencias. | Ventas anuladas. |
| `saldo_actual` · **Saldo actual de las ventas del período** | pesos | Fecha del acuerdo; saldo a hoy | Hoy | Σ (importe − cobros vigentes hasta hoy) de las ventas del período. | Ventas y cobros anulados. |
| `comision_prevista` · **Comisión prevista (hoy)** | pesos | Fecha del acuerdo; estado a hoy | Hoy | Σ comisión pactada sin generar. | Ventas anuladas y sin comisión. |
| `comision_a_pagar` · **Comisión a pagar (hoy)** | pesos | Fecha del acuerdo; estado a hoy | Hoy | Σ (comisión pactada − pagado) de las ventas con comisión generada. | Ventas, cobros y pagos anulados. |
| `comision_pagada` · **Comisión pagada** | pesos | Fecha del pago | Período | Σ pagos vigentes. | Pagos anulados. |
| `cobros_menos_comisiones` · **Cobros menos comisiones pagadas** | pesos | Fecha efectiva del cobro y fecha del pago | Período | Cobrado según CRM − comisión pagada. | Cobros y pagos anulados. No usa comisiones devengadas. |

**Interesados**: una oportunidad tiene una **señal de interés** si cumple alguna de estas
condiciones:

- una visita suya anotó interés tibio o caliente;
- pasó a «Interesado» en el seguimiento (`interesado_en`, también el de un ciclo anterior
  reabierto).

La fecha es la de la primera señal. «Frío», «sin interés» y «no evaluado» no son señal. Una
oportunidad que saltó directo a negociación o se vendió sin señal **no** cuenta como
interesada: no se deducen etapas con hitos vacíos. En la lista **por jornada**, «interesados»
son los negocios con una visita de esa jornada que anotó interés tibio o caliente.

**Tipo de oportunidad**:

- **lead nuevo de calle**;
- **lead de un cliente**: la visita fue a un negocio que ya había comprado. Si la oportunidad
  vendió, manda su marca `es_recompra`; si no, se mira «cliente previo» o una venta vigente
  anterior;
- **recompra creada por Administración**: no es un lead de calle y va aparte.

Una reapertura es la misma oportunidad (otro ciclo): no crea un lead.

## Cohortes y conversión

- **Actividad del período**: visitas, leads, ventas y cobros, cada uno por su fecha. No se dividen
  entre sí: las ventas de un mes pueden venir de leads anteriores.
- **Cohorte principal**: los leads de calle originados en el período (nuevos y de clientes).
  - En **Leads → interesados** y **Leads → ventas**, el numerador son oportunidades del mismo
    denominador, y cada una cuenta una vez aunque tenga varios ciclos o actividades.
  - Una venta anulada y vuelta a vender cuenta una vez.
  - Se muestra hasta qué fecha se observan los resultados (hoy), la antigüedad (días desde el lead
    más reciente y desde el más antiguo) y cuántas siguen abiertas.
  - No se declara «madura» por plazo: con oportunidades abiertas, la tasa todavía puede subir.
  - Las recompras de Administración tienen su propia fila, fuera de la cohorte de calle.
- **Visitas que generaron un lead** = visitas del período que son el origen vigente de una
  oportunidad ÷ visitas válidas del período (por visita).
- **Negocios visitados → compradores** = negocios cuya primera visita válida cayó en el período y
  que después tuvieron una venta vigente (con acuerdo desde esa fecha) ÷ negocios de esa misma
  cohorte (por negocio).
- Numerador y denominador siempre a la vista; una división por cero da «Sin datos».

## Atribución de ventas a jornadas

Cada venta se atribuye **completa a una sola jornada**, por la relación explícita de su
operación, en este orden:

1. La jornada de la **visita de origen** de su oportunidad (lead de calle, incluida la visita a un
   cliente).
2. Si no hay visita de origen (recompra de Administración), la jornada de la **visita de
   intervención** de una recompra trabajada.
3. Si no, **«Sin jornada»**.

Nunca se usan la fecha del cierre, el responsable actual, la última visita ni la jornada de la
primera compra para una recompra. Las visitas adicionales cuentan como esfuerzo de su jornada,
pero no multiplican la venta. El comercial de una venta (para el filtro) es el de su jornada
atribuida.

Hay dos lecturas, rotuladas por separado:

- **Ventas**: cerradas en el período, por fecha del acuerdo.
- **Ventas obtenidas hasta hoy por jornadas del período**: atribuidas a esas jornadas y cerradas
  en cualquier fecha hasta hoy.

**Corrección de B3 hallada al revisar la atribución.** Una recompra «trabajada» aceptaba como
intervención una gestión de `crm_actividades`, que siempre es de Administración: una llamada de
Administración bastaba para pagar la comisión completa. Ahora la intervención es una visita del
beneficiario en esa oportunidad, y la gestión solo puede acompañarla. Commit `01f8a63`, con
verificación de B3 (OK 49) y un caso en la integración.

## Jornadas y eficiencia

- **Por jornada** se muestra:
  - fecha, comercial y **zona de la jornada**;
  - visitas, negocios únicos, responsables, decisores, leads e interesados;
  - ventas e importe atribuidos (hasta hoy);
  - km y movilidad;
  - advertencias: km sin cargar, gastos sin cargar, jornada abierta.

  Se incluyen las jornadas sin visitas.
- **Km**: solo de las jornadas con los dos extremos cargados.
- **Movilidad** = combustible + estacionamiento + peajes + otros, solo de las jornadas con los
  cuatro gastos cargados (0 = no hubo gasto; vacío = sin cargar). Lo ya cargado en jornadas
  incompletas se informa como parcial y no se suma.
- Cada razón usa un solo subconjunto para numerador y denominador, y se informa cuántas jornadas
  quedaron fuera:
  - visitas, ventas e importe por jornada: todas las jornadas;
  - km por visita y por lead: las jornadas con km;
  - movilidad por visita, por lead y por venta: las jornadas completas.

## Resultados económicos y movilidad

- **Flujos del período**, cada hecho por su fecha:
  - ventas, importe acordado y experiencias: fecha del acuerdo;
  - cobrado según CRM: fecha efectiva de cada cobro;
  - comisión generada: fecha del cobro que completó la venta, calculada con los cobros vigentes de
    hoy (sigue contando aunque se pague después);
  - comisión pagada: fecha del pago;
  - cobros menos comisiones pagadas.
- **Estado de hoy de las ventas del período**, rotulado como lectura de hoy: saldo actual,
  comisión prevista (pactada, todavía sin generar) y comisión a pagar (generada menos lo pagado).
  No es «saldo al cierre» de nada.
- **Cobros menos comisiones pagadas** es exactamente esa resta, con flujos del período. No
  descuenta movilidad, prestación de las experiencias, impuestos ni gastos fijos, ni usa
  comisiones devengadas: **no** es ganancia ni resultado comercial neto.
- **Movilidad registrada**: completas separadas de pendientes. Quién la paga todavía no está
  definido, así que no se declara egreso de SIM ni se resta de nada.
- Finanzas queda completamente aislado.

## Segmentos, necesidades y pérdidas

- Los segmentos se calculan sobre la cohorte de leads de calle del período. Cada fila muestra:
  oportunidades, interesados, ventas, conversión «leads → ventas» con su base e importe de esas
  ventas.
- Cada dimensión dice qué lectura refleja:

  | Dimensión | Lectura |
  |---|---|
  | Rubro y zona del negocio | Dato actual (no hay foto histórica) |
  | Estado | Estado de hoy |
  | Interés y pack potencial | Último anotado en sus visitas |
  | Comercial de origen | Fijo al lead; no es el responsable actual |
  | Mes del lead | Histórico |

- **Necesidades múltiples**:
  - una oportunidad puede tener varias, así que las filas se superponen: se marcan «no se suman»
    y el total va deduplicado;
  - las oportunidades sin necesidad anotada tienen su propia fila: no se elige una «principal».
- Las cifras muestran **asociaciones**, no causas; con pocos casos, una diferencia puede ser azar.
  No hay recomendaciones automáticas.
- **Pérdidas**: cada episodio va por su fecha (los ciclos reabiertos de B2 más la pérdida
  vigente), y una oportunidad perdida dos veces son dos episodios de una oportunidad. Se informan
  los episodios, las oportunidades distintas (no sumables entre motivos) y cuántas se reabrieron
  después.

## Filtros

| Filtro | Se aplica a |
|---|---|
| Comercial | Visitas y jornadas: quien las hizo. Leads: comercial de origen. Ventas y cobros: el comercial de la jornada atribuida. Comisiones: el beneficiario. Recompras de Administración: «No aplica» (no tienen comercial). |
| Zona | Zona actual del **negocio**, no la de la jornada (que se ve en cada jornada). |
| Rubro | Rubro actual del negocio. |
| Necesidad | Visitas: la anotada en esa visita. Oportunidades y ventas: alguna de las anotadas en sus visitas. |

Con zona, rubro o necesidad, las jornadas muestran solo sus visitas y leads del segmento. Km,
movilidad y todas las razones de eficiencia dicen **«No aplica con este filtro»**: los gastos son
de la jornada entera y no se reparten con porcentajes inventados. Ningún filtro excluye negocios
archivados: archivar no borra resultados.

## Permisos y privacidad

- `/admin/crm/metricas` exige admin en el layout.
- `/api/admin/crm/metricas` (tablero y `?detalle=<id>`) exige admin: sin sesión 401, staff 403,
  cookie comercial 401.
- La interfaz comercial no tiene rutas de B4 ni importa nada de B4 (prueba estática).
- El detalle no trae notas ni observaciones.
- La integración compara la cuenta de filas de las tablas del CRM, la auditoría y las operaciones
  antes y después de consultar: nada cambia.

## Pruebas y conciliación

| Prueba | Resultado |
|---|---|
| `lib/crmB4.test.ts` (puro, «hoy» fijo en el 10/12/2026) | OK (470 chequeos de conciliación) |
| `lib/crmB4.integration.ts` (ruta real) | OK (78 conciliaciones) |
| Regresión de B0–B3 y build | OK |

La prueba pura (`lib/crmB4.test.ts`) cubre:

- visitas repetidas, teléfono del decisor conseguido por un empleado y negocio importado sin visita;
- lead de octubre con venta en noviembre y cobros en noviembre y diciembre;
- comisión generada el 02/12 y pagada el 08/12;
- salto de etapas;
- pérdida, reapertura y venta (un solo lead), y una oportunidad perdida dos veces;
- recompras espontánea (sin jornada) y trabajada (jornada de su propia visita);
- jornada sin visitas, sin km y con gastos parciales;
- varias necesidades, negocio archivado, y ventas, cobros y pagos anulados;
- 23:30 del 31/10 y 00:15 del 01/11 en Córdoba, meses de 28 y 31 días;
- filtros y paginación.

La integración (`lib/crmB4.integration.ts`) cubre:

- permisos;
- un escenario sembrado por las RPCs reales: dos visitas al mismo negocio, teléfono por un
  empleado, visita cerrada, jornada vacía, anticipo y saldo con centavos, comisión, recompra sin
  jornada, venta anulada y un lead corrido 40 días;
- la cohorte separada de la actividad;
- la conciliación cifra = detalle, con y sin filtros;
- que consultar no escribe nada.

La regresión cubre:

- pruebas puras de Auth, B1, B2, B3, sesión, límite, contraseña y firma de Mercado Pago;
- integraciones B0, B1, B2 y B3;
- verificaciones SQL: cadena OK 60, B1 OK 110, B2 OK 42, B3 OK 49;
- tipos, lint y `next build` sobre Next 16.4.3.

**Contrato de conciliación**: en la prueba pura, para todas las métricas y 9 combinaciones de
período y filtros; en la integración, por la API.

- Cada cifra es igual a su detalle (conteo de filas o suma de la columna).
- En las tasas de cohorte, el denominador son las filas del detalle y el numerador sale de ellas.
- Los desgloses excluyentes suman el total: segmentos sumables, productos, nuevos + clientes,
  tipos de la cohorte y episodios por motivo.
- Los superpuestos (necesidades) se marcan, y su total va deduplicado.
- La suma de ventas por jornada es igual a las ventas con jornada, y ninguna venta está en dos
  jornadas.
- Los importes conservan los centavos.

## QA (escritorio y celular, servidor de producción local)

Sobre los datos ficticios del entorno local (los de B1–B3):

| Qué | Resultado |
|---|---|
| Tarjetas y ayudas | Las seis tarjetas tienen su ayuda; el ícono ⓘ la despliega junto con su lectura. |
| Detalle | «Importe acordado» muestra la definición completa, 2 ventas y un total de $ 510.000, igual a la tarjeta. Un segmento (Necesidad: Fidelización) abre sus 5 leads; una jornada, sus 10 visitas. |
| Período | 90 días → Todo → personalizado de febrero (sin datos): tarjetas en 0, tasas «Sin datos (0 ÷ 0)», «Sin jornadas», «Sin leads», «Sin pérdidas». |
| Filtros | Por zona del negocio: km, movilidad y eficiencia en «No aplica», con el aviso. Por comercial: recompras de Administración en «No aplica». La semántica de cada filtro está a la vista. |
| Datos incompletos | La única jornada (sin km ni gastos) da «Km registrados: Sin datos» y «1 jornada fuera por información pendiente». |
| Celular (375×812) | Sin desborde horizontal; tarjetas de a dos; todos los controles de 44 px o más; el detalle ocupa la pantalla. |

Hallado y corregido en el QA (`3539ba7`): con todas las jornadas pendientes, «Km registrados» y
«Movilidad registrada» mostraban 0; ahora dicen «Sin datos».

Límites del QA: emulación de Chrome. Con el panel del navegador oculto las capturas salen
recortadas, así que la geometría se verificó midiendo el DOM.

## Limitaciones y criterios de aceptación

- No hay fotos históricas: rubro, zona, estado e «interés» son los de hoy. Una corrección posterior
  cambia meses pasados (está advertido en pantalla).
- La señal de interés depende de lo que se anotó: lo no evaluado queda afuera.
- La bandeja de B2 ya no corta en 1000 oportunidades: desde el cierre del MVP lee todas y pagina de
  a 50 ([cierre-mvp.md](cierre-mvp.md), §2).
- La movilidad no se asigna a negocios ni a ventas, ni se resta: falta decidir quién la paga.
- «Cobros menos comisiones pagadas» no es caja ni resultado. Caja y contribución comercial siguen
  pendientes de definición (diseno.md, corrección 6).
- No hay comparación contra el período anterior (no se pidió) ni exportación.

**Aceptación**:

- seis tarjetas y cuatro secciones;
- cada cifra coincide con su detalle;
- las conversiones comparan la misma población;
- ninguna venta en dos jornadas;
- «Sin datos» en vez de ceros inventados;
- filtros con semántica explícita y «No aplica»;
- solo admin y solo lectura, con Finanzas intacto;
- pruebas puras e integración en verde, con regresiones de B0–B3 y build.
