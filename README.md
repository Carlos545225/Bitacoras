# Bitácoras automáticas (GFPI-F-147)

Envía por Gmail, cada mes y sin intervención, las bitácoras 003 (oct 2026) a 012 (jul 2027).
Solo cambia el número, el periodo y las fechas; el resto de la plantilla queda byte a byte igual.

**Cómo funciona:** GitHub Actions corre dos veces al día, calcula qué bitácoras ya vencieron y no se han enviado,
las genera, las valida y las envía. Si un día falla, la siguiente ejecución la reenvía. Nunca repite una ya enviada.

## Puesta en marcha (una sola vez)
1. **Repo PRIVADO** en GitHub y sube todo el contenido de esta carpeta (la plantilla trae datos personales).
2. **Contraseña de aplicación de Gmail:** activa la verificación en dos pasos en tu cuenta y crea una en
   https://myaccount.google.com/apppasswords (16 caracteres).
3. En el repo: *Settings → Secrets and variables → Actions → New repository secret*:
   - `GMAIL_USER` = tu correo de Gmail
   - `GMAIL_APP_PASSWORD` = la contraseña de aplicación
4. Edita `data/config.json`: pon el correo del destinatario en `destinatarios` (y `cc` si quieres). Asunto y cuerpo son editables.
5. *Settings → Actions → General → Workflow permissions* = **Read and write permissions**.
6. Pestaña **Actions → Enviar bitacora → Run workflow**:
   - primero con **dry_run** (genera y valida, no envía);
   - luego con **prueba** (te envía la bitácora a tu propio correo; no se registra).
7. Listo. La 003 saldrá el 31/10/2026 a las 18:00 (hora Bogotá) y las demás el último día de cada mes.
   Para enviar antes, añade en `config.json`: `"ajustes": { "003": { "envio": "2026-10-30T12:00" } }`.

## Panel (opcional)
Activa *Settings → Pages* (requiere repo público o plan que lo permita) o ábrelo local con `python -m http.server`.
Muestra calendario, estado, historial y descarga el Excel de cualquier mes.

## Que no se deje de enviar
- Contraseña de aplicación: no caduca a los 7 días como OAuth en modo Testing.
- Dos ejecuciones diarias + recuperación de bitácoras atrasadas, en orden.
- Un paso mantiene activo el cron (GitHub desactiva crons de repos sin actividad).
- Si falla, la ejecución queda en rojo y GitHub te avisa por correo (revisa *Settings → Notifications → Actions*).
- Si cambias la contraseña de Google, crea otra contraseña de aplicación y actualiza el Secret.

## Pausar o ajustar
`"activo": false` en `data/config.json` pausa todo. Fechas de un mes: `"ajustes": {"005": {"desde":"2026-12-01","hasta":"2026-12-31"}}`.
