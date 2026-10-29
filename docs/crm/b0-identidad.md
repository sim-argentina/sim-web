# CRM B2B · B0 — Identidad comercial

Usuarios individuales para la interfaz comercial (`/comercial`): Tobías ingresa con su propio
usuario y contraseña, sin acceso al panel. La administración da de alta, restablece, desactiva,
reactiva y revoca sesiones desde `/admin/crm/configuracion`.

Estado: **implementado y verificado en el stack local. Sin migrar ni desplegar.** Diseño general y
correcciones para los bloques siguientes: [diseno.md](diseno.md).

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
| Actor y guard `requireCrmActor` | `lib/crmAuth.ts` |
| Ingreso / cierre / actor | `app/comercial/api/{ingresar,salir,sesion}/route.ts` |
| Pantallas comerciales | `app/comercial/` (layout propio, sin el menú del panel) |
| Administración de usuarios | `app/api/admin/crm/usuarios/`, `app/admin/(panel)/crm/configuracion/` |

Cambios compartidos, solo para navegación y protección:
- `components/AdminSidebar.tsx`: enlace "CRM", solo admin.
- `middleware.ts`: `/admin/crm` en la lista solo-admin. El matcher no cambió.
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

## Sesión comercial

- Cookie `sim-crm-session`: HttpOnly, `Secure` en producción, `SameSite=strict`,
  `Path=/comercial`, 7 días. Las APIs comerciales viven en `/comercial/api/*` para que la cookie
  les llegue; el navegador no la manda a `/admin` ni a `/api/admin`.
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

Una cookie comercial inválida, vencida o revocada se ignora: no anula una sesión admin legítima.
La identidad y el rol nunca salen del formulario.

## Ingreso

1. Origen propio y límite de intentos: 8 por minuto por IP y 10 cada 15 minutos por usuario.
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
npx tsx lib/crmAuth.test.ts            # matriz de cookies que conviven y cableado estático
npx tsx lib/crmRegresionPanel.test.ts  # middleware y login admin/staff sin cambios
node scripts/pruebas/correr-mutantes.mjs lib/crmB0.integration.ts   # rutas reales, solo stack local
docker exec -i supabase_db_sim-web-pruebas psql -U postgres -d postgres -X -q -f - < db/crm-b0-identidad.verificacion.sql
```

`crmAuth.test.ts` importa el cliente de servidor; necesita variables de Supabase cualesquiera
(no conecta). La integración corre únicamente contra el stack local, con el guardián.

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
- **Límite de intentos:** con Upstash configurado es una ventana fija compartida entre instancias,
  pero si Upstash falla deja pasar (fail-open, comportamiento de `lib/rateLimit.ts`). Sin Upstash es
  en memoria por instancia: en Vercel cada instancia lleva su propia cuenta y se reinicia con ella,
  así que no es una protección distribuida. No se pudo verificar si Producción tiene Upstash (sin
  permiso para listar variables del proyecto). El límite por usuario permite que alguien bloquee
  el ingreso de un usuario conocido durante 15 minutos.
- **Cerrar sesión cierra todas las sesiones** del usuario, en todos sus dispositivos.
- **SameSite=strict:** al abrir `/comercial` desde un enlace de otra app, la primera carga no lleva
  la cookie; el formulario de ingreso detecta la sesión y redirige.
- **Sin cambio de contraseña por el propio usuario ni recuperación por email:** la restablece la
  administración.
- **Google Tag Manager** se carga en todas las páginas desde el layout raíz (como ya pasa en
  `/admin`). El código no envía eventos en `/comercial` y ni la URL ni el título llevan datos
  personales, pero lo que haga el contenedor de GTM se configura fuera del repositorio.
- El panel no tiene ruta de logout (ni antes ni ahora).
