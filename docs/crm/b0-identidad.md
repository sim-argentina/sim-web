# CRM B2B · B0 — Identidad comercial

Usuarios individuales para la interfaz comercial (`/comercial`): Tobías ingresa con su propio
usuario y contraseña, sin acceso al panel. La administración da de alta, restablece, desactiva,
reactiva y revoca sesiones desde `/admin/crm/configuracion`.

Estado: **B0 + B0.1 implementados y verificados solo en local. Sin migrar, sin publicar y sin
configurar en Vercel.** Diseño general y correcciones para los bloques siguientes:
[diseno.md](diseno.md).

B0 no implementa prospectos, visitas, jornadas, seguimiento, ventas, cobros, comisiones ni
métricas, y no cambia reglas ni datos de Turnero, Reservas, Gift Cards, Empresas, Mensualidades,
Colectivo, Finanzas, Marketing ni Cupones.

## Archivos

| Pieza | Dónde |
|---|---|
| Esquema, RPCs y privilegios | `db/crm-b0-identidad.sql` (en `db/orden.txt`, sección 13g) |
| Verificación SQL (se revierte entera) | `db/crm-b0-identidad.verificacion.sql` |
| Token de sesión comercial (puro) | `lib/crmSesion.ts` |
| Hash de contraseñas (scrypt) | `lib/crmContrasena.ts` |
| Validación, política de contraseñas y DTO (puro) | `lib/crmUsuarios.ts` |
| Acceso a datos (service_role, solo RPC para escribir) | `lib/crmUsuariosServer.ts` |
| Ingreso (verificar y confirmar sin carrera) | `lib/crmIngreso.ts` |
| Límite de intentos del ingreso (con respaldo) | `lib/crmLimite.ts` |
| Actor y guard `requireCrmActor` | `lib/crmAuth.ts` |
| Qué es el área comercial | `lib/areaComercial.ts` |
| Ingreso / cierre / actor | `app/comercial/api/{ingresar,salir,sesion}/route.ts` |
| Pantallas comerciales | `app/comercial/` (layout propio, sin el menú del panel ni GTM) |
| Administración de usuarios | `app/api/admin/crm/usuarios/`, `app/admin/(panel)/crm/configuracion/` |

Cambios compartidos, solo para navegación y protección:
- `components/AdminSidebar.tsx`: enlace "CRM", solo admin.
- `middleware.ts`: `/admin/crm` en la lista solo-admin; matcher ampliado a `/comercial` solo
  para aislarla de la analítica (ver abajo). El comportamiento de `/admin` no cambió.
- `components/analytics/GoogleTagManager.tsx` + `GoogleTagManagerCarga.tsx`: el loader de
  GTM y su `<noscript>` no se cargan en `/comercial`. En el resto del sitio, igual que antes.
- `NavbarWrapper`, `FooterWrapper` y `CookieConsent` no se muestran en `/comercial`.
- `lib/analytics.ts`: el código no emite eventos en `/comercial` (igual que en `/admin`).
- `app/robots.ts`: `Disallow: /comercial`.
- `.env.example`: `CRM_SESSION_SECRET`.

## Base de datos

- `crm_usuarios`: `usuario` (único, minúsculas), `nombre`, `rol = 'comercial'`, `activo`,
  `password_hash` (scrypt; formato validado por CHECK), `sesion_version`, fechas de alta,
  cambio de contraseña, desactivación y último ingreso.
- `crm_auditoria`: solo agregado. `actor_rol` `admin` (sin usuario) o `comercial` (con su id),
  `accion` ∈ alta · desactivacion · reactivacion · restablecimiento_contrasena ·
  revocacion_sesiones · ingreso · cierre_sesion. `datos` lleva una lista explícita de campos
  (`usuario`, `nombre`, `activo`, `antes`/`despues`, `sesiones_revocadas`); un CHECK rechaza
  claves de autenticación.
- RPCs `SECURITY DEFINER`, `search_path = public`, EXECUTE solo para `service_role`:
  `crm_usuario_crear`, `crm_usuario_restablecer_contrasena`, `crm_usuario_desactivar`,
  `crm_usuario_reactivar`, `crm_usuario_revocar_sesiones` (actor `admin`);
  `crm_login_credencial`, `crm_login_confirmar`, `crm_sesion_cerrar` (el propio usuario).
- Funciones internas sin EXECUTE para nadie: `crm_normalizar_usuario`, `crm_hash_valido`,
  `crm_usuario_auditable`, `crm_usuario_dto`, `crm_auditar`.
- Privilegios: RLS sin policies; `anon` y `authenticated` sin acceso; `service_role` solo lee
  `crm_auditoria` y las columnas no sensibles de `crm_usuarios` (sin `password_hash`: un
  `select *` falla). Toda escritura y la auditoría van dentro de la misma transacción de la RPC.
- No depende de ningún objeto de otro módulo: verificado en una instancia local sin Marketing
  (ver "Independencia de Marketing").

## Sesión comercial

- Cookie `sim-crm-session`: HttpOnly, `Secure` en producción, `SameSite=strict`,
  `Path=/comercial`, 7 días. Las APIs comerciales viven en `/comercial/api/*` para que la cookie
  les llegue. El `Path` es una comodidad, no la barrera: las APIs del panel no leen esta cookie
  aunque se la manden a mano (probado).
- Token `crm1.<payload>.<firma>`: HMAC-SHA256 con `CRM_SESSION_SECRET` (mínimo 32 caracteres y
  distinta de `ADMIN_SESSION_SECRET`) y un prefijo de dominio en lo firmado. El payload trae tipo
  `crm_comercial`, id, versión, emisión y vencimiento.
- En cada petición protegida se verifica firma, tipo, id, versión y vencimiento, y en la base
  que el usuario siga activo con esa misma `sesion_version`. Si falta la clave o la base no
  responde, falla cerrado (503), nunca deja pasar.
- Revocación: desactivar, reactivar, restablecer, revocar y cerrar sesión suben
  `sesion_version`. Reactivar no revive sesiones anteriores. Cerrar sesión cierra **todas** las
  sesiones del usuario (no hay sesiones por dispositivo).

`requireCrmActor` (para las rutas comerciales de los próximos bloques):

| Cookies | Resultado |
|---|---|
| comercial válida (con o sin cookie del panel) | actor comercial, con su id |
| admin, sin comercial válida | actor "Administración" |
| staff, sin comercial válida | 403 |
| nada válido | 401 |
| comercial con firma válida pero la base no responde | 503 (no cae a admin) |
| comercial presente y `CRM_SESSION_SECRET` ausente o inválida | 503 salvo admin válido |

Una cookie comercial inválida, vencida, de versión anterior o de un usuario desactivado se
ignora: no anula una sesión admin legítima, y sin cookie de admin nunca se convierte en acceso de
"Administración" (401). La identidad y el rol nunca salen del formulario ni de la consulta.

## Ingreso

1. Origen propio y límite de intentos (`lib/crmLimite.ts`, ver abajo).
2. Lee la credencial y verifica la contraseña con scrypt. Si el usuario no existe, verifica
   contra un hash simulado: mismo costo y la misma respuesta 401 para usuario inexistente,
   desactivado o contraseña incorrecta.
3. `crm_login_confirmar` bloquea la fila y exige el mismo hash y la misma versión que se leyeron.
   Si en el medio hubo un restablecimiento, una desactivación o una revocación, no emite sesión.
4. Firma la sesión con la versión confirmada. El token va solo en la cookie; el cuerpo trae
   `{ ok, nombre }`.

Contraseñas: scrypt N = 2^17, r = 8, p = 1, sal de 16 bytes, clave de 32 (~250–400 ms por
verificación). Política: 10 a 128 caracteres, sin espacios en los bordes, sin contener el
usuario. La define la administración (puede generarla en el navegador); no se guarda ni se
devuelve en texto plano.

## Límite de intentos del ingreso

Propio del CRM (`lib/crmLimite.ts`). `lib/rateLimit.ts` y sus consumidores (login del panel, APIs
públicas) no cambiaron.

| Límite | Qué cuenta | Ventana | Protege contra |
|---|---|---|---|
| Por origen (IP que informa la plataforma) | todos los intentos de esa IP | 8 por minuto | probar muchas cuentas desde un lugar |
| Por usuario | solo los intentos **fallidos** contra ese nombre, de cualquier IP | 10 cada 15 minutos | probar contraseñas de una cuenta desde muchas IPs |

- **Ventana fija:** el vencimiento lo fija el primer intento y no se corre. Los intentos
  rechazados durante un bloqueo no lo prolongan (Upstash: `PEXPIRE … NX`; memoria: vencimiento
  fijo). Una clave remota sin vencimiento recibe uno en el siguiente intento.
- **Con Upstash configurado:** decide el contador remoto, compartido entre instancias.
- **Si Upstash falla** (error de red, más de 800 ms, HTTP distinto de 2xx o respuesta inválida):
  **no deja pasar**. Decide un contador en memoria que se lleva siempre en paralelo, así que ya
  trae la cuenta de esa instancia. Ese respaldo protege **por instancia**, no de forma
  distribuida: en Vercel cada instancia cuenta lo suyo y se reinicia con ella. Se registra
  `crm_limite_respaldo_memoria motivo=red|tiempo|http|respuesta` (una vez por minuto por
  instancia), sin URL, token ni mensaje del proveedor.
- **Sin Upstash configurado:** solo memoria, por instancia.
- Al superar el límite: 429 genérico con `Retry-After`, sin detalles de la infraestructura.
- **Riesgo residual:** quien conozca un nombre de usuario puede provocar su bloqueo durante 15
  minutos con 10 intentos fallidos, y repetirlo cuando vence. El límite por usuario no lo evita;
  lo acota en el tiempo. No hay desbloqueo manual en B0 (sí se puede restablecer la contraseña o
  esperar el vencimiento).
- No se pudo verificar si Producción tiene Upstash (sin permiso para listar variables del
  proyecto en Vercel).

## Aislamiento de la analítica

Las pantallas comerciales no cargan ni activan Google Tag Manager:

1. **Entrada directa** (`/comercial`, `/comercial/ingresar`): el loader de GTM y su `<noscript>`
   no se renderizan ahí (`GoogleTagManagerCarga.tsx`); ni el código del loader viaja en el HTML.
   Solo queda el script de consentimiento por defecto ("denegado"), que no hace red.
2. **Dentro del área** (ingreso → inicio, cierre de sesión → ingreso): navegaciones del router
   en el mismo documento, que nunca cargó GTM.
3. **Entrada desde una página que ya cargó GTM** (pública o del panel): dejar de renderizar un
   componente no descarga un script que ya corrió, así que esa entrada se convierte en
   navegación de documento completo. El middleware responde 204 sin contenido a las peticiones
   del router hacia `/comercial` hechas desde fuera del área (lo detecta por `next-url`, o por el
   `Referer` del mismo origen cuando falta) y el router de Next 16 navega por documento
   **antes** de tocar el historial. Documentos, APIs de `/comercial/api` y peticiones desde el
   área pasan igual. Si no se puede saber de dónde viene, se trata como de afuera: el peor caso
   es una recarga.
4. **Salida del área:** con `<a>` (navegación de documento), nunca con `<Link>`; así un documento
   comercial nunca carga GTM y volver atrás no lo hereda.
5. **Defensa en profundidad:** el layout comercial recarga una vez el documento si encontrara
   GTM (`AislamientoAnalitica.tsx`), sin bucle.

En `/admin` y en el sitio público GTM se carga como siempre.

## Matriz de acceso

| Ruta | Sin sesión | Staff | Comercial | Admin |
|---|---|---|---|---|
| `/comercial/ingresar` (página) | sí | sí | redirige a `/comercial` | sí |
| `/comercial` (página) | → ingresar | → ingresar | su inicio | inicio como "Administración" |
| `POST /comercial/api/ingresar` | sí (es el login) | sí | sí | sí |
| `POST /comercial/api/salir` | inocuo | inocuo | revoca y borra cookie | inocuo |
| `GET /comercial/api/sesion` | 401 | 403 | 200 | 200 |
| `/admin/crm/configuracion` | → login | → calendario | → login del panel | sí |
| `GET/POST /api/admin/crm/usuarios` | 401 | 403 | 401 | sí |
| `PATCH /api/admin/crm/usuarios/[id]` | 401 | 403 | 401 | sí |
| Cualquier otra ruta del panel o API existente | sin cambios | sin cambios | 401 / login (como sin sesión) | sin cambios |

## Pruebas

```bash
npx tsx lib/crmSesion.test.ts          # token, cookie, configuración, tokens cruzados
npx tsx lib/crmContrasena.test.ts      # scrypt, contrato del formato con la base, costo simulado
npx tsx lib/crmLimite.test.ts          # límite normal, remoto caído/timeout/500/basura, recuperación, sin prolongación
npx tsx lib/crmAuth.test.ts            # cookies que conviven, cableado, navegación y GTM (estático)
npx tsx lib/crmRegresionPanel.test.ts  # middleware: /admin igual + aislamiento de /comercial; login admin/staff
node scripts/pruebas/correr-mutantes.mjs lib/crmB0.integration.ts   # rutas reales, solo stack local
docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -X -q -f - < db/crm-b0-identidad.verificacion.sql
```

`crmAuth.test.ts` importa el cliente de servidor; necesita variables de Supabase cualesquiera
(no conecta). La integración corre únicamente contra una base local, con el guardián. Para
correrla contra otra instancia local, `SIM_TEST_CONTENEDOR_DB` nombra su contenedor de base.

### Independencia de Marketing (verificado el 29/10/2026)

La base local compartida tiene el esquema de Marketing/Cupones aplicado. Para descartar que B0
funcione gracias a esos objetos, se levantó una instancia local descartable aparte
(`sim-web-crm-aislada`, puertos 556xx), se aplicó el esquema de `main` (60 archivos de
`db/orden.txt` sin el de B0; 115 tablas, 0 de Marketing), luego `db/crm-b0-identidad.sql` dos
veces, la verificación SQL (`OK 129`) y la integración completa de B0 (OK). La instancia se
eliminó al terminar.

## Datos en la base local de pruebas (`sim-web-pruebas`)

Solo en el entorno local; nada de esto está en Producción ni en el repositorio:
- **Estructura:** las tablas `crm_usuarios` y `crm_auditoria` y las 13 funciones `crm_*`
  (el SQL de B0 aplicado, aditivo, junto al esquema de Marketing, que no se tocó).
- **Datos:** un usuario de demostración, `demo.comercial` ("Tobías (demo local)"), con su
  auditoría de alta, ingresos y cierres de las pruebas en navegador. Las suites de integración
  limpian sus propios usuarios (`zzcrmb0…`): no queda ninguno.
- **Credenciales:** la contraseña del usuario de demostración, `CRM_SESSION_SECRET` y las
  credenciales locales del panel están en `.env.test.local` del worktree (ignorado por git).

Para quitar el usuario de demostración (solo local):

```bash
docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -c "delete from public.crm_auditoria where entidad_id in (select id from public.crm_usuarios where usuario = 'demo.comercial'); delete from public.crm_usuarios where usuario = 'demo.comercial';"
```

## Aplicación futura (no ejecutada)

1. Revisar y aprobar este bloque.
2. Generar `CRM_SESSION_SECRET` (32 bytes al azar, distinta de `ADMIN_SESSION_SECRET`) y
   cargarla en Vercel para Production (y Preview si se va a probar ahí).
3. Aplicar `db/crm-b0-identidad.sql` en SIM WEB por MCP. La verificación completa escribe
   dentro de una transacción que se revierte: se corre en el stack local. En Producción se
   confirma con consultas de solo lectura equivalentes a sus secciones T1–T4 (tablas, RLS,
   privilegios de tablas y columnas, funciones, `search_path` y EXECUTE).
4. Recién con la migración aplicada, publicar el código (un push a `main` despliega).
5. Crear el usuario real de Tobías desde `/admin/crm/configuracion` y pasarle la contraseña por
   un medio privado.

Sin la migración, las pantallas nuevas fallan cerradas (503 o error genérico); sin la clave, el
ingreso comercial queda cerrado (503). Nada de eso afecta al panel.

## Limitaciones conocidas

- **Administración no identifica a una persona:** la sesión del panel es compartida; la auditoría
  registra "Administración", no a Ramiro.
- **Límite de intentos:** el respaldo en memoria protege por instancia, no de forma distribuida;
  el bloqueo por usuario lo puede provocar un tercero (ver arriba).
- **Cerrar sesión cierra todas las sesiones** del usuario, en todos sus dispositivos.
- **SameSite=strict:** al abrir `/comercial` desde un enlace de otra app, la primera carga no lleva
  la cookie; el formulario de ingreso detecta la sesión y redirige.
- **Sin cambio de contraseña por el propio usuario ni recuperación por email:** la restablece la
  administración.
- **Script de consentimiento:** sigue en todas las páginas (también en `/comercial`); no hace red y
  solo declara el consentimiento denegado. Lo que el contenedor de GTM hace en las páginas donde
  sí se carga se configura fuera del repositorio.
- **`router.refresh()` dentro del área** se resuelve por `Referer`; si un navegador no lo enviara,
  termina en recarga completa (seguro, más lento).
- El panel no tiene ruta de logout (ni antes ni ahora).
