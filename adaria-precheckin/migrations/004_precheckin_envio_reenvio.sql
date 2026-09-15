-- Reenvío manual de invitaciones desde el panel admin + columnas de reserva
-- necesarias para el listado/CSV/KPIs (habitación, fechas, apellido).
-- adaria-precheckin (14/09/2026)
--
-- Aditivo (ADD COLUMN IF NOT EXISTS). No toca ACI ni las tablas existentes.
ALTER TABLE precheckin_envio
  ADD COLUMN IF NOT EXISTS titular_nombre    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS titular_apellido  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS habitacion        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fecha_entrada     DATE,
  ADD COLUMN IF NOT EXISTS intentos          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reenviado_en      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reenviado_por     VARCHAR(60),
  ADD COLUMN IF NOT EXISTS error_motivo      VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_precheckin_envio_fecha_entrada ON precheckin_envio(fecha_entrada);
