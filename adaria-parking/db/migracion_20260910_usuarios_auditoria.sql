-- ═══════════════════════════════════════════════════════════════
-- Adaria Parking — Migración: tabla usuario + audit_log
-- Idempotente (IF NOT EXISTS). Segura de re-ejecutar.
-- No toca plazas/asignaciones/ajustes.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usuario (
  id            SERIAL       PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  rol           VARCHAR(20)  NOT NULL DEFAULT 'operador'
                    CHECK (rol IN ('admin','operador')),
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  creado_por    VARCHAR(50)  NOT NULL DEFAULT 'sistema'
);

CREATE INDEX IF NOT EXISTS idx_usuario_username ON usuario(username);
CREATE INDEX IF NOT EXISTS idx_usuario_activo   ON usuario(activo);

CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL    PRIMARY KEY,
  usuario      VARCHAR(50)  NOT NULL,
  accion       VARCHAR(50)  NOT NULL,
  plaza_id     INTEGER,
  ocupacion_id INTEGER,
  detalle      JSONB,
  ip           VARCHAR(45),
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_plaza ON audit_log(plaza_id);
CREATE INDEX IF NOT EXISTS idx_audit_at    ON audit_log(creado_at DESC);
