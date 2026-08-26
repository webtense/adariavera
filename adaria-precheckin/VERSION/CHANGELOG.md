# Changelog — Adaria Pre check-in

Todas las versiones notables de esta app se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [1.2.0] - 2026-08-26
### Added
- Gates apagados de fábrica: `PRECHECKIN_EMAIL_ENABLED` (activo: con él en
  false, el aviso a recepción siempre cae a log). `PRECHECKIN_WRITE` /
  `PRECHECKIN_ALTA` (reservados, sin cablear a ningún código — esta app
  sigue siendo solo lectura contra ACI; ver cabecera de `server.js`).
- Filtrado por propiedad: columna `property` en `precheckin_reserva`
  (migración `002_fase3_property_notificaciones.sql`) + middleware
  `requireProperty()` aplicado a todas las rutas de `/admin`. Hoy solo existe
  `adaria`; deja preparado el terreno para Monasterio de Poblet (prevista
  sep-2026) sin migración de datos histórica cuando llegue.
- Reintentos automáticos de notificación: `cron_precheckin_mejoras.js` — 3
  intentos en 3 días (24h entre cada uno), motivo diferenciado por intento
  (`gate_desactivado`, `smtp_no_implementado`, `send_mode_test`,
  `excepcion`...). Registra cada ejecución en `precheckin_cron_log`.
- Panel de errores en `/admin/errores`: notificaciones con incidencia, check-
  ins en ≤2 días sin marcar como procesados, y últimas ejecuciones del cron.
- `deshacer_escritura_aci.js` preparado (stub, sin usar): no hay escritura en
  ACI que revertir hasta que la Tarea E entregue conector + usuario SQL
  `adaria_rw` + tabla de backup previo.
- Manual de recepción (`/opt/adaria-manuales/precheckin.html`) corregido para
  describir el flujo real (huésped busca por localizador+apellido; no hay
  enlace personalizado por email todavía) y con los datos reales del hotel
  (check-in 14:00, check-out 12:00, parking 61 plazas · 10€/noche).

### Fixed
- `mail.js`: el `.env` de producción tenía `SEND_MODE=live` pero el código
  solo trataba como activo el valor `real` — con el nuevo gate explícito
  (`PRECHECKIN_EMAIL_ENABLED`) ese desajuste de nombres queda documentado en
  vez de ser un comportamiento accidental.

### Notes
- Sin desplegar todavía: cambios preparados en el repo y probados contra la
  BD real en modo aditivo (migración + una ejecución del cron), pero el
  servicio systemd sigue corriendo el `server.js` anterior hasta que se
  decida el despliegue.

## [1.1.0] - 2026-08-26
### Added
- Sistema de versión unificado FASE 1: `VERSION/version.json` + `CHANGELOG.md` propios de la app.
- Compatibilidad con el endpoint `/api/versiones` de adaria-gestion, que agrega la versión y el changelog de todas las apps del ecosistema Adaria para mostrarlos en la card "Changelog" del portal.

### Notes
- Arranque de versión unificado en 1.1.0 para las 11 apps del ecosistema Adaria (gestion, welcome, precheckin, personal, parking, ine, guest, estadisticas, escaner, manuales, it).
