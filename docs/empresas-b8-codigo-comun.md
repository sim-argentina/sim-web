# Empresas B8 — Código común por pack; el cupo en experiencias

**Estado:** implementado y verificado en una instancia local aislada, y probado junto con el CRM
en una integración local (ver «Integración con el CRM»). **Sin migrar en SIM WEB, sin push, sin
merge y sin deploy.** Rama `empresas-codigo-comun`, desde `origin/main` `33ca411`.

## Por qué

La condición comercial vigente (31/10/2026) para los packs corporativos:
- un **código común por pack**, compartido por sus tarjetas físicas;
- cada tarjeta es **una experiencia de 20 minutos**;
- el **cupo total** son las experiencias compradas.

El módulo Empresas no tenía una configuración correcta para eso:
- «Generar» creaba `cantidad_contratada` códigos, cada uno con `usos_por_codigo` usos:
  - **1 × 10** daba el cupo correcto, pero pantalla, informe y CRM decían «1 turno contratado»;
  - **10 × 10** multiplicaba el cupo.
- **Un canje sumaba un solo uso** aunque reservara hasta 4 simuladores: una reserva de 4 daba
  4 experiencias por un uso.
- **Cancelar liberando el código** devolvía siempre 1 uso, y ese canje seguía contando como
  utilizado.
- **Dos «Generar» simultáneos** podían emitir dos tandas.
- **Diferencia de permisos entre la réplica y Producción:** en la cadena del repositorio,
  `cancelar_reserva_empresa` (SECURITY DEFINER) la podían ejecutar `anon` y `authenticated`,
  porque `esquema-base.sql` no copió su permiso y conservaba el EXECUTE por defecto de PUBLIC.
  - **Producción no está expuesta.** Se verificó con una consulta de solo lectura, autorizada el
    31/10/2026: ACL `{postgres=X, service_role=X}`, igual que las otras cuatro funciones.
  - B8 deja la réplica igual a Producción (solo `service_role`).

## Reglas que implementa

1. **Cupo = experiencias contratadas** (`cantidad_contratada`):
   - con «Código común», **un** código con `usos_maximos = cantidad_contratada` (10, 25 o la
     cantidad personalizada);
   - sin la marca, `cantidad_contratada` códigos de un uso, como antes.
2. **Cada simulador reservado consume una experiencia:**
   - una reserva de 1 a 4 simuladores consume 1 a 4;
   - se registra en `empresa_codigo_usos.experiencias`, una fila por canje;
   - si `usos_actuales + simuladores > usos_maximos`, el canje se rechaza **sin consumir nada**.
3. **Reservas simultáneas:** la RPC toma el código `FOR UPDATE`, así que los canjes del mismo
   código se serializan y cada uno ve lo que consumió el anterior. El CHECK
   `usos_actuales <= usos_maximos` es la segunda barrera.
4. **Reintentos de canje:** con la misma clave de idempotencia, se devuelve la reserva ya creada
   sin consumir otra vez (como antes).
5. **Reprogramar** mueve la reserva con **la misma cantidad** de simuladores y no consume. Una
   reserva anterior de varios simuladores se mueve con la misma cantidad.
6. **Cancelar** (Administración, `cancelar_reserva_empresa`):
   - la reserva se toma `FOR UPDATE`;
   - si ya está cancelada, devuelve éxito **sin tocar nada**;
   - en la cancelación efectiva, con «liberar código», vuelven **exactamente las experiencias de
     los usos vigentes de esa reserva**, que pasan a `cancelado`;
   - sin «liberar», no vuelve nada y el uso queda consumido.

   En consecuencia, un reintento o dos cancelaciones simultáneas **no devuelven dos veces**, y
   **cancelar de nuevo con «liberar» no devuelve lo que no se liberó** en la primera. No se agregó
   ninguna condición comercial: cuándo liberar sigue siendo decisión del personal, como antes.
7. **Generación anticipada:**
   - el código común se puede generar antes del pago, para imprimir las tarjetas;
   - generar **no** fija fecha de inicio ni vencimiento;
   - el código se genera **una sola vez**: la generación se reserva antes de insertar;
   - los códigos individuales siguen exigiendo la campaña pagada.
8. **Bloqueo hasta la activación:** el código canjea solo con la campaña **pagada** (en Empresas,
   el pago es la marca manual del 100%) y con `fecha_inicio` ≤ hoy.
   - En un pack con código común, **la fecha de inicio solo se puede cargar con la campaña
     pagada**: no nace con fecha y no se adelanta antes del pago.
   - La fecha de inicio es la **entrega**: los **60 días corren desde ella** (compra única), no
     desde la generación.
9. **Configuración que multiplicaba:** ya no se acepta crear ni pasar a «códigos individuales con
   varios usos». Con el código generado, no se cambia el tipo de código ni el cupo de un código
   común.
10. **Métricas, listado e informe por experiencia:**
    - usadas = suma de `experiencias` de los canjes no cancelados;
    - restantes = contratadas − usadas;
    - % uso = usadas ÷ contratadas.

    La distribución por simulador ya no cuenta reservas canceladas.
11. **Funciones:**
    - las cinco funciones modificadas son SECURITY DEFINER con `search_path = public` (las legacy
      y `cancelar` no lo tenían);
    - solo `service_role` puede ejecutarlas;
    - `cancelar_reserva_empresa` deja de ser ejecutable por PUBLIC, `anon` y `authenticated`.

## Qué no cambia (a cargo del personal)

- **Activación:** el sistema no la dispara. Al entregar las tarjetas con el 100% cobrado, el
  personal marca pagada la campaña y carga `fecha_inicio` = día de la entrega. Si carga una fecha
  futura, el código se habilita ese día.
- **Tarjeta física:** el sistema no la valida. Quien conozca el código común puede reservar por la
  web hasta agotar el cupo; la revisión en el stand la hace el personal, que puede marcar ausente
  o cancelar.
- **La web pública** reserva de a un simulador. Las reservas de varios llegan por la API, con la
  regla 2.
- **Bloquear un código:** el admin solo puede bloquear un código sin usos (regla anterior).
- **Finanzas:** sin integración automática.

**Cómo se opera un pack:**
1. Crear la campaña: compra única, 20 minutos, experiencias, «Código común».
2. Generar el código e imprimir las tarjetas.
3. Cobrar el 50% al confirmar (en el CRM).
4. Al entregar, con el 100%:
   - marcar pagada;
   - cargar `fecha_inicio` = ese día;
   - en el CRM, registrar el cobro y la entrega.
5. En el stand, pedir la tarjeta.

## Producción (consulta de solo lectura, autorizada el 31/10/2026)

Hay una sola campaña, con `usos_por_codigo = 1`, mensual, legacy y cancelada. Ninguna campaña
real usa varios usos por código. Sus usos existentes quedan con `experiencias = 1`, que es lo que
consumieron.

## Pruebas (instancia local aislada `sim-web-empresas-local`, cadena desde cero)

| Prueba | Resultado |
|---|---|
| `db/empresas-b8-codigo-comun.verificacion.sql` (sin huella), con la cadena de 61 archivos desde cero y B8 aplicado dos veces | `OK`: T1 columnas; T2 v2 (2 simuladores = 2, sin cupo no, sin simulador no); T3 legacy; T4 idempotencia; T5 reprogramar; T6 cancelar una vez, reintento y sin liberar; T7 CHECK; T8 permisos de las cinco funciones |
| La misma verificación con las funciones **anteriores** (control, se deshace) | Falla en T2a, T2b, T3, T4, T5a, T5c, T6 y T8: exactamente lo que B8 corrige |
| `lib/empresas.test.ts` (puro): plan de códigos; experiencias por uso; métricas; configuración que multiplicaba; inicio del pack | OK |
| `lib/empresasCodigoComun.integration.ts` (ruta real, `v2_10`), tres corridas: 10, 25 y 37; generación única, anticipada y sin fechas; bloqueo hasta pagada + inicio; inicio del pack solo pagado; 60 días desde el inicio; **2 simuladores = 2**; **12×1 simultáneas sobre 10 → 10**; **mezcla de 4 y de 1 simultáneas ≤ 10, consumido = reservado**; reprogramar; cancelar una vez (reintento y **dos simultáneas**); sin «liberar»; métricas, listado e informe; individuales como antes | OK |
| La misma integración con las RPC anteriores (control) | Falla en «2 simuladores = 2 experiencias» |
| Regresión legacy (`empresasCanje.integration.ts` en una copia temporal con simuladores reales y modalidad legacy forzada en local) | OK |
| `lib/empresasB7.test.ts` | Falla en `main` y acá en la misma aserción previa (fixture con fecha fija). En una copia con la fecha alineada **pasa entera** (con ella se detectó y corrigió que el control de experiencias corriera antes que la validación de simuladores). |
| `lib/empresasFechaArgentina.test.ts`, `lib/guardiaPruebas.test.ts`, `tsc`, `eslint` y `next build` | OK |

**Hallazgos previos, no corregidos acá:**
- `lib/empresasCanje.integration.ts` está desactualizada desde B7: no manda `modalidad_vista` y
  usa simuladores `ZZ_SIM_*`.
- `lib/empresasB7.test.ts` tiene una fecha fija en el fixture que dejó de ser válida el 30/10.

## Integración con el CRM

Se probó en la rama local `integracion-crm-b8`: el CRM de `crm-b0-identidad` más este B8 y los
ajustes del CRM que lo necesitan. El detalle está en `docs/crm/cierre-mvp.md` de esa rama. El CRM
lee de la campaña el código común y las experiencias usadas y restantes, sin datos de
beneficiarios.

## Publicación (no ejecutada; cada paso con autorización)

1. **Prechequeos:**
   - comparar `pg_get_functiondef()` de las cinco funciones en Producción con
     `db/empresas-b8-codigo-comun.previo.sql`;
   - permisos ya confirmados el 31/10/2026 (solo lectura): las cinco funciones son SECURITY
     DEFINER, ejecutables solo por `postgres` y `service_role`. Las legacy y `cancelar` no fijan
     `search_path`, y B8 se lo agrega.
2. **Primero el SQL:** `db/empresas-b8-codigo-comun.sql` en SIM WEB por MCP. Con el código actual
   es inocuo: las columnas nacen con su valor por defecto, la web manda un simulador y un canje de
   1 consume 1, como hoy. Al revés no: el código nuevo escribe `codigo_comun` y fallaría sin la
   columna.
3. **Verificación:** `db/empresas-b8-codigo-comun.verificacion.sql` → `RESULTADO B8|…` sin
   `FALLA:`. Se deshace, pero bloquea `reservas` y `reserva_slots` un instante: correrla en un
   horario tranquilo.
4. **Código:** publicar (un push a `main` despliega).
5. **Después:** una campaña de prueba en borrador, sin cobros ni canjes reales, y archivarla.

**Vuelta atrás:**
- **Código:** promover el despliegue anterior.
- **Base:** `db/empresas-b8-codigo-comun.previo.sql` restaura las cinco funciones.
- **Lo que se conserva:** las columnas (el código anterior las ignora) y el permiso de
  `cancelar_reserva_empresa` (CREATE OR REPLACE no lo cambia, así que no se reabre a `anon`).
- **Si ya hubo reservas de varios simuladores o packs comunes:** sus usos quedan bien registrados,
  pero con las funciones anteriores cancelar devolvería 1 y la pantalla anterior mostraría
  «1 turno contratado».
