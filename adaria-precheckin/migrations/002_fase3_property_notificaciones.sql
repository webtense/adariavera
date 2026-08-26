-- FASE 3 — Gates, filtrado por propiedad, reintentos automáticos, panel de errores.
-- adaria-precheckin v1.2.0 (26/08/2026)
--
-- Todo aditivo (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS): no
-- rompe nada de lo que ya está en producción, y no toca ACI (esta app sigue
-- siendo SOLO LECTURA contra ACI Dali — ver REGLA DE ORO en aci.js).

-- ─── Filtrado por propiedad ────────────────────────────────────────────────
-- Hoy solo existe 'adaria' (una BD ACI, un hotel). La columna se añade ahora
-- para que cuando entre una segunda propiedad (Monasterio de Poblet, prevista
-- sep-2026 — ver inventario_mejoras_btr_vs_adaria_ago2026.md) las reservas ya
-- vengan marcadas y no haga falta una migración de datos histórica.
ALTER TABLE precheckin_reserva
  ADD COLUMN IF NOT EXISTS property VARCHAR(20) NOT NULL DEFAULT 'adaria';

CREATE INDEX IF NOT EXISTS idx_precheckin_reserva_property ON precheckin_reserva(property);

-- ─── Notificaciones (reintentos automáticos) ───────────────────────────────
-- Sustituye el "fire and forget" de mail.notify() en /api/precheckin: cada
-- intento de aviso a recepción queda registrado, con motivo diferenciado, para
-- que el cron (cron_precheckin_mejoras.js) pueda reintentar sin duplicar avisos
-- y el panel de errores pueda mostrar qué falló y por qué.
CREATE TABLE IF NOT EXISTS precheckin_notificacion_log (
  id            BIGSERIAL PRIMARY KEY,
  reserva_id    INTEGER NOT NULL REFERENCES precheckin_reserva(id) ON DELETE CASCADE,
  tipo          VARCHAR(30) NOT NULL DEFAULT 'confirmacion_recepcion',
  intentos      INTEGER NOT NULL DEFAULT 0,
  estado        VARCHAR(20) NOT NULL DEFAULT 'pendiente',  -- pendiente | enviado | error | omitido | agotado
  motivo        VARCHAR(60),                               -- gate_desactivado | smtp_no_configurado | error_envio | ok
  detalle       TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_intento_en TIMESTAMPTZ,
  UNIQUE (reserva_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_precheckin_notif_estado ON precheckin_notificacion_log(estado, intentos);

-- Traza de cada ejecución del cron, para el panel de errores y para saber que
-- el cron efectivamente corre (no solo que existe el script).
CREATE TABLE IF NOT EXISTS precheckin_cron_log (
  id            BIGSERIAL PRIMARY KEY,
  ejecutado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  candidatos    INTEGER NOT NULL DEFAULT 0,
  reintentados  INTEGER NOT NULL DEFAULT 0,
  enviados      INTEGER NOT NULL DEFAULT 0,
  errores       INTEGER NOT NULL DEFAULT 0,
  agotados      INTEGER NOT NULL DEFAULT 0,
  proximas_sin_procesar INTEGER NOT NULL DEFAULT 0,
  duracion_ms   INTEGER,
  detalle       JSONB
);
