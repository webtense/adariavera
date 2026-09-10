-- ═══════════════════════════════════════════════════════════════
-- Adaria Parking — Migración: método de pago + plazas bonificadas
-- Idempotente (IF NOT EXISTS). Segura de re-ejecutar.
-- No toca filas existentes de plazas/asignaciones/ajustes/usuario/audit_log.
--
-- Calcado de btr_parking_siente/app/server.js:
--   - metodo_pago: 'efectivo' | 'tarjeta' | 'cuenta' | 'bonificado'
--   - "bonificado" es una plaza de cortesía: el importe se fuerza a 0,
--     tanto al asignar como al editar el cobro (ver server.js esBonificado()).
--   - No añade CHECK de valores: el propio backend valida/normaliza, igual
--     que en BTR (metodo_pago es VARCHAR libre en la BD).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE asignaciones ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20);
