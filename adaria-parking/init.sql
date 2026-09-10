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
  estado VARCHAR(20) NOT NULL DEFAULT 'activa',   -- activa | liberada
  cobrado BOOLEAN NOT NULL DEFAULT false,
  origen VARCHAR(20) NOT NULL DEFAULT 'manual',   -- manual | aci
  notas TEXT,
  creado_en TIMESTAMP NOT NULL DEFAULT now(),
  liberado_en TIMESTAMP
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
