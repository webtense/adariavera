# Changelog — Adaria Pre check-in

Todas las versiones notables de esta app se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [1.2.0] - 2026-09-10
### Added
- **Desplegado a producción** (10/09/2026), fusionando dos líneas de trabajo
  que habían divergido desde el 26/08: FASE 3 (este changelog) nunca se
  había desplegado al servicio systemd, mientras que en paralelo producción
  evolucionó `mail.js` (28/08) con envío SMTP real — ver más abajo.
- Filtrado por propiedad: columna `property` en `precheckin_reserva`
  (migración `002_fase3_property_notificaciones.sql`, ya aplicada en la BD
  real desde el 26/08) + middleware `requireProperty()` aplicado a todas las
  rutas de `/admin`. Hoy solo existe `adaria`; deja preparado el terreno para
  Monasterio de Poblet (prevista sep-2026) sin migración de datos histórica
  cuando llegue.
- Reintentos automáticos de notificación: `cron_precheckin_mejoras.js` — 3
  intentos en 3 días (24h entre cada uno), motivo diferenciado por intento
  (tomado del `modo` real de `mail.js`: `test`, `live`, `sin_smtp`,
  `sin_destinatario`, `error`, `excepcion`). Registra cada ejecución en
  `precheckin_cron_log`. Programado en crontab de producción, 09:00 diario.
- Panel de errores en `/admin/errores`: notificaciones con incidencia, check-
  ins en ≤2 días sin marcar como procesados, y últimas ejecuciones del cron.
- Gates `PRECHECKIN_EMAIL_ENABLED` / `PRECHECKIN_WRITE` / `PRECHECKIN_ALTA`
  reservados por continuidad de nombre con `btr_gestion_portal`, los tres
  SIN CABLEAR a ningún código — ver nota importante más abajo sobre
  `PRECHECKIN_EMAIL_ENABLED`.
- `deshacer_escritura_aci.js` preparado (stub, sin usar): no hay escritura en
  ACI que revertir hasta que la Tarea E entregue conector + usuario SQL
  `adaria_rw` + tabla de backup previo.

### Changed
- `mail.js` **NO se toca en esta fusión** — se mantiene tal cual estaba en
  producción desde el 28/08 (envío real SMTP vía nodemailer, redirección a
  buzón de pruebas en `SEND_MODE=test`, copia BCC de auditoría en ambos
  modos). El diseño original de FASE 3 (26/08) cableaba el gate
  `PRECHECKIN_EMAIL_ENABLED` DENTRO de `mail.js` para bloquear el envío,
  pero ese `mail.js` nunca llegó a implementar SMTP real; el que sí lo hizo
  fue el de producción, sin ese gate. Para no regresar el envío real ya en
  producción, `PRECHECKIN_EMAIL_ENABLED` queda reservado sin cablear — el
  control real de envío lo sigue teniendo `SEND_MODE` (test/live) dentro de
  `mail.js`, sin cambios respecto a como ya funcionaba.
- `precheckin_notificacion_log.motivo` ahora se rellena con el campo `modo`
  (o `error`) que devuelve el `mail.js` real, en vez de los códigos que
  proponía el diseño original de FASE 3 (`gate_desactivado`,
  `smtp_no_implementado`, `send_mode_test`), que asumían un `mail.js` que ya
  no es el que corre en producción.

### Notes
- Verificado antes de desplegar: la migración 002 ya estaba aplicada en la
  BD real desde el 26/08 (columna `property` con `DEFAULT 'adaria'` y tablas
  `precheckin_notificacion_log`/`precheckin_cron_log` ya existentes) — el
  despliegue de esta versión es solo de código (server.js/cron), sin tocar
  datos.
- Probado en local en el propio CT111 (mismo entorno de red que producción,
  requerido para alcanzar ACI y la BD propia) contra una instancia temporal
  en otro puerto, antes de tocar el servicio systemd real.

## [1.1.0] - 2026-08-26
### Added
- Sistema de versión unificado FASE 1: `VERSION/version.json` + `CHANGELOG.md` propios de la app.
- Compatibilidad con el endpoint `/api/versiones` de adaria-gestion, que agrega la versión y el changelog de todas las apps del ecosistema Adaria para mostrarlos en la card "Changelog" del portal.

### Notes
- Arranque de versión unificado en 1.1.0 para las 11 apps del ecosistema Adaria (gestion, welcome, precheckin, personal, parking, ine, guest, estadisticas, escaner, manuales, it).
