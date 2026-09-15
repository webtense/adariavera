-- Esquema BD precheckin_adaria (Hotel Adaria Vera · módulo Pre check-in online)
-- SOLO estado propio del pre check-in. NUNCA se escribe en ACI desde esta app.

CREATE TABLE IF NOT EXISTS precheckin_reserva (
  id SERIAL PRIMARY KEY,
  res_guid VARCHAR(64),
  codigo VARCHAR(30) NOT NULL,          -- localizador ACI (RES_COD_str), snapshot
  apellido_busqueda VARCHAR(100) NOT NULL,
  titular_nombre VARCHAR(100),
  titular_apellido VARCHAR(100),
  habitacion VARCHAR(20),
  fecha_entrada DATE,
  fecha_salida DATE,
  pax INTEGER NOT NULL DEFAULT 1,
  email VARCHAR(150),
  telefono VARCHAR(30),
  hora_llegada_estimada VARCHAR(5),      -- 'HH:MM'
  observaciones TEXT,
  idioma VARCHAR(2) NOT NULL DEFAULT 'es',
  procesado BOOLEAN NOT NULL DEFAULT false,
  procesado_por VARCHAR(60),
  procesado_en TIMESTAMP,
  signature_png_path VARCHAR(300),   -- ruta relativa en storage/firmas/
  pdf_path VARCHAR(300),             -- ruta relativa en storage/pdfs/
  pdf_hash_sha256 VARCHAR(64),       -- SHA-256 del PDF generado
  signed_at TIMESTAMPTZ,             -- cuándo se firmó (server time)
  creado_en TIMESTAMP NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_precheckin_reserva_procesado ON precheckin_reserva(procesado);
CREATE INDEX IF NOT EXISTS idx_precheckin_reserva_fecha_entrada ON precheckin_reserva(fecha_entrada);

CREATE TABLE IF NOT EXISTS precheckin_persona (
  id SERIAL PRIMARY KEY,
  reserva_id INTEGER NOT NULL REFERENCES precheckin_reserva(id) ON DELETE CASCADE,
  es_titular BOOLEAN NOT NULL DEFAULT false,
  nombre VARCHAR(100) NOT NULL,
  apellido1 VARCHAR(100) NOT NULL,
  apellido2 VARCHAR(100),
  tipo_documento VARCHAR(20),             -- DNI | NIE | PASAPORTE | OTRO
  numero_documento VARCHAR(30),
  fecha_nacimiento DATE,
  nacionalidad VARCHAR(60),
  creado_en TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_precheckin_persona_reserva ON precheckin_persona(reserva_id);
