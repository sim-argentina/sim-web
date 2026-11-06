# SIM Marketing en Producción: publicado y DESHABILITADO

Desde el 06/11/2026 el código de Marketing está en `main` y en Producción, apagado. Se publicó
para conservar el trabajo y no mezclarlo con otros desarrollos. **No es un lanzamiento:**
ninguna parte de Marketing capta, prepara, ejecuta ni envía nada.

Qué está publicado:

- registro de consentimiento y bajas;
- retención de cupones de uso único (Reservas y Gift Cards);
- campañas en simulación;
- adaptador y webhook de WhatsApp Cloud API, con los envíos reales bloqueados.

## Las llaves y qué apaga cada una

Las llaves son estrictas: solo el literal `"true"` enciende. Ausente, vacía, `"1"` o
`"TRUE"` dejan la parte apagada. En Producción **ninguna está cargada**.

| Llave (entorno) | Apagada |
| --- | --- |
| `MARKETING_CONSENTIMIENTO_ENABLED` | `/promos`, `/api/promos/texto` y `/api/promos/alta` responden 404. La casilla del checkout de Reservas y Gift Cards no aparece y el servidor ignora un pedido de alta que llegue igual. El panel no carga altas con evidencia (la captación del stand) ni publica textos: responde 503 "Deshabilitado". **Las bajas siguen.** |
| `MARKETING_CAMPANIAS_ENABLED` (llave maestra) | Todas las rutas de `/api/admin/marketing/campanias/*` responden 503 "Deshabilitado". Eso incluye el ejecutor de servidor `…/ejecutar`, y se responde antes de mirar la sesión o la base: también ante llamadas directas. No se escribe ninguna campaña, ni siquiera en la base local, y no se generan beneficios. El envío real a WhatsApp no se abre (falla antes de la red), aunque los otros bloqueos digan `"true"`. |
| `MARKETING_WHATSAPP_ENVIOS_REALES` | Segundo bloqueo de los envíos reales. Hace falta además la configuración completa y una plantilla aprobada. |
| `MARKETING_WHATSAPP_PROVIDER` | Sin proveedor no se ejecuta ninguna campaña. Con `fake`, solo en la base local de pruebas y fuera de Vercel (`lib/marketing/entornoCampanias.ts`). |

En el código, ninguna ruta usa el adaptador real (`crearProveedorCloud`): solo lo usan las pruebas, con
transporte simulado.

**Cupones de campaña:** no existe la generación de códigos reales por destinatario. Las
simulaciones usan beneficios ficticios `SIMU-…`, que el alta de Códigos rechaza y que la
base reserva por constraint cuando `db/marketing-campanias.sql` está aplicada.

## Base de Producción

- **Aplicada:** `db/cupones-retencion.sql`. La nueva versión de la app la necesita para los cupones
  limitados: sin ella, esos cupones fallan cerrados con 503 y no cobran.
  - Se aplicó después del despliegue, con el procedimiento de [cupones-retencion.md](cupones-retencion.md).
  - Cubre con retenciones `legado` las compras pendientes previas.
- **No aplicadas, a propósito:**
  - `db/marketing-consentimiento.sql`
  - `db/marketing-campanias.sql`
  - `db/marketing-whatsapp.sql`

  La app detecta su ausencia y muestra "no instalado". Sin esas tablas no hay registro, cola
  ni bandeja que escribir.
- **Plantilla sin aplicar:** `db/marketing-campanias-cron.plantilla.sql`, que es Supabase Cron +
  `pg_net`. `pg_cron` y `pg_net` siguen sin instalar.

## Tareas automáticas

- `vercel.json` tiene solo los crons diarios conocidos: IA y la conciliación de cupones
  (`/api/admin/cupones/conciliar`, 05:20 UTC). Es parte de la retención de cupones, no una campaña.
- No hay ningún cron de campañas. El ejecutor responde "Deshabilitado".
- `lib/vercelCrons.test.ts` falla si aparece otro cron.

## Diagnóstico privado

- **Panel:** `/admin/marketing` (staff y admin). El encabezado dice **"Marketing: Deshabilitado"**
  y detalla cada parte.
- **Rutas:**
  - `GET /api/admin/marketing/estado` devuelve lo mismo en JSON. No muestra valores de
    variables ni lee la base.
  - `GET /api/admin/marketing/whatsapp` (admin) muestra el diagnóstico de la Cloud API.

Comprobación sin sesión (no escribe nada):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://simexperience.com.ar/promos
curl -s https://simexperience.com.ar/api/admin/marketing/campanias
```

La primera da 404. La segunda da 503 con `"estado":"Deshabilitado"`.

## Antes de encender cualquier parte (no hacerlo sin la decisión del owner)

1. **Captación.** Seguir estos pasos en orden:
   1. Revisión legal del texto `promos-v1` y de [privacidad-borrador.md](privacidad-borrador.md).
   2. Aplicar `db/marketing-consentimiento.sql`.
   3. Encender `MARKETING_CONSENTIMIENTO_ENABLED`.
   4. Recién entonces, publicar el texto desde el panel.
2. **Campañas.** Hacen falta las decisiones del owner:
   - las condiciones comerciales (el 15 % y los 7 días son propuesta);
   - si un cupón puede cubrir varias Gift Cards;
   - el control del teléfono.

   Hacen falta también:
   - los códigos reales por destinatario;
   - aplicar `db/marketing-campanias.sql`;
   - elegir el disparador de servidor (Hobby solo admite crons diarios).
3. **WhatsApp.** Antes de los envíos reales hacen falta:
   - la cuenta de Meta con el número verificado;
   - una plantilla de marketing aprobada;
   - el webhook verificado y `db/marketing-whatsapp.sql`;
   - recién después, abrir los dos bloqueos.

   Ver [whatsapp-cloud-api.md](whatsapp-cloud-api.md).
