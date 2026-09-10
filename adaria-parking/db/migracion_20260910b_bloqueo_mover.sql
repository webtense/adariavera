-- ═══════════════════════════════════════════════════════════════
-- Adaria Parking — Migración: bloqueo de plaza + mover ocupación
-- Idempotente (IF NOT EXISTS). Segura de re-ejecutar.
-- No toca filas existentes de plazas/asignaciones/ajustes/usuario/audit_log.
--
-- Añade la columna motivo_bloqueo a asignaciones. El estado 'bloqueada'
-- no requiere ALTER porque `estado` ya es VARCHAR(20) sin CHECK constraint.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE asignaciones ADD COLUMN IF NOT EXISTS motivo_bloqueo VARCHAR(200);
