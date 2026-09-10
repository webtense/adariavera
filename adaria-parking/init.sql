-- Esquema BD parking_adaria (Hotel Adaria Vera · módulo Parking)
-- SOLO estado local del parking. NUNCA se escribe en ACI.

CREATE TABLE IF NOT EXISTS plazas (
  numero INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS asignaciones (
  id SERIAL PRIMARY KEY,
  plaza_numero INTEGER NOT NULL REFERENCES plazas(numero),
  habitacion VARCHAR(20),
  huesped_nombre VARCHAR(200),
  fecha_entrada DATE NOT NULL,
  fecha_salida DATE NOT NULL,
  noches INTEGER NOT NULL,
  tarifa_dia NUMERIC(10,2) NOT NULL,
  importe_total NUMERIC(10,2) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'activa',   -- activa | bloqueada | liberada
  cobrado BOOLEAN NOT NULL DEFAULT false,
  metodo_pago VARCHAR(20),   -- efectivo | tarjeta | cuenta | bonificado (calcado de btr_parking_siente)
  origen VARCHAR(20) NOT NULL DEFAULT 'manual',   -- manual | aci
  notas TEXT,
  creado_en TIMESTAMP NOT NULL DEFAULT now(),
  liberado_en TIMESTAMP,
  motivo_bloqueo VARCHAR(200)   -- solo relevante cuando estado = 'bloqueada'
);

CREATE INDEX IF NOT EXISTS idx_asignaciones_plaza_estado ON asignaciones(plaza_numero, estado);
CREATE INDEX IF NOT EXISTS idx_asignaciones_estado ON asignaciones(estado);

CREATE TABLE IF NOT EXISTS ajustes (
  clave VARCHAR(50) PRIMARY KEY,
  valor VARCHAR(200) NOT NULL
);

INSERT INTO plazas(numero)
SELECT generate_series(1, 61)
ON CONFLICT (numero) DO NOTHING;

INSERT INTO ajustes(clave, valor) VALUES ('tarifa_dia_eur', '10')
ON CONFLICT (clave) DO NOTHING;

-- ─────────────────────────────────────────────
-- Autenticación local (bcrypt puro, sin SSO/Odoo) + auditoría.
-- Ver db/migracion_20260910_usuarios_auditoria.sql para aplicar esto solo
-- (idempotente) sobre una BD que ya tenía plazas/asignaciones/ajustes.
-- ─────────────────────────────────────────────
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
  accion       VARCHAR(50)  NOT NULL,     -- 'login' | 'asignar' | 'liberar' | 'cobro' | 'usuario_crear' | ...
  plaza_id     INTEGER,                   -- referencia lógica a plazas.numero (sin FK, ver nota BTR)
  ocupacion_id INTEGER,                   -- referencia lógica a asignaciones.id
  detalle      JSONB,
  ip           VARCHAR(45),
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_plaza ON audit_log(plaza_id);
CREATE INDEX IF NOT EXISTS idx_audit_at    ON audit_log(creado_at DESC);
