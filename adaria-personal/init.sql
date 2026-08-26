-- Esquema BD personal_adaria (Gestión de Personal / RRHH, multi-propiedad)
-- NÚCLEO común a todas las propiedades del grupo (Hotel Adaria Vera, Poblet, BTR...).
-- Cada tabla lleva property_id para poder alojar varias propiedades en la misma BD
-- sin reescribir nada. En Fase 1 solo se usa 'vera'.
-- Sin nómina. Sin datos inventados: solo lo que se cargue por la UI/API.

CREATE TABLE IF NOT EXISTS propiedad (
  id VARCHAR(30) PRIMARY KEY,          -- p.ej. 'vera', 'poblet', 'btr-xxx'
  nombre VARCHAR(200) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departamento (
  id SERIAL PRIMARY KEY,
  property_id VARCHAR(30) NOT NULL REFERENCES propiedad(id),
  nombre VARCHAR(100) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(property_id, nombre)
);

CREATE TABLE IF NOT EXISTS empleado (
  id SERIAL PRIMARY KEY,
  property_id VARCHAR(30) NOT NULL REFERENCES propiedad(id),
  nombre VARCHAR(100) NOT NULL,
  apellidos VARCHAR(150) NOT NULL,
  dni_nie VARCHAR(20),
  fecha_nacimiento DATE,
  telefono VARCHAR(30),
  email VARCHAR(150),
  puesto VARCHAR(100),
  departamento_id INTEGER REFERENCES departamento(id),
  fecha_alta DATE NOT NULL,
  fecha_baja DATE,
  activo BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,
  creado_en TIMESTAMP NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(property_id, dni_nie)
);

CREATE INDEX IF NOT EXISTS idx_empleado_property ON empleado(property_id);
CREATE INDEX IF NOT EXISTS idx_empleado_activo ON empleado(property_id, activo);
CREATE INDEX IF NOT EXISTS idx_empleado_departamento ON empleado(departamento_id);
CREATE INDEX IF NOT EXISTS idx_empleado_nacimiento ON empleado(property_id, fecha_nacimiento); -- Fase Motivación (cumpleaños)
CREATE INDEX IF NOT EXISTS idx_empleado_alta ON empleado(property_id, fecha_alta);             -- Fase Motivación (aniversarios)

CREATE TABLE IF NOT EXISTS documento_empleado (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleado(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL DEFAULT 'otro',   -- contrato | dni | titulacion | otro
  nombre_fichero VARCHAR(255) NOT NULL,
  ruta VARCHAR(500) NOT NULL,                 -- relativa a /opt/adaria-personal/uploads
  subido_en TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documento_empleado ON documento_empleado(empleado_id);

-- Seed: la propiedad y 2-3 departamentos de ejemplo (editables). NO se seedean empleados.
INSERT INTO propiedad(id, nombre) VALUES ('vera', 'Hotel Adaria Vera')
ON CONFLICT (id) DO NOTHING;

INSERT INTO departamento(property_id, nombre) VALUES
  ('vera', 'Recepción'),
  ('vera', 'Pisos'),
  ('vera', 'Mantenimiento')
ON CONFLICT (property_id, nombre) DO NOTHING;

-- ═══ FASE 2 — Autofichaje / Quiosco (añadido, no reemplaza lo anterior) ═══
-- ═══════════════════════════════════════════════════════════════════
-- Migración FASE 2 — Autofichaje / Quiosco (adaria-personal)
-- Idempotente: se puede volver a ejecutar sin romper nada de Fase 1.
-- ═══════════════════════════════════════════════════════════════════

-- Nuevas columnas en empleado para identificación en el quiosco.
-- pin_hash: hash bcrypt del PIN (4-6 dígitos). NUNCA se guarda el PIN en claro.
-- pin_lookup: HMAC-SHA256(SESSION_SECRET, property_id:pin) en hex. Permite
--   localizar al empleado por el PIN tecleado con una consulta indexada
--   O(1) en vez de comparar con bcrypt contra toda la plantilla activa
--   (evitaría además una posible colisión silenciosa de PIN entre dos
--   empleados). El PIN en sí sigue sin poder reconstruirse a partir de
--   pin_lookup sin conocer SESSION_SECRET (que vive solo en el .env).
--   El pin_hash (bcrypt) se usa para la verificación criptográfica final.
-- qr_token: token aleatorio único para fichar por QR (no es secreto de acceso
--   al panel admin, solo identifica al empleado en el quiosco).
ALTER TABLE empleado ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(100);
ALTER TABLE empleado ADD COLUMN IF NOT EXISTS pin_lookup VARCHAR(64);
ALTER TABLE empleado ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empleado_property_pin_lookup_key'
  ) THEN
    ALTER TABLE empleado ADD CONSTRAINT empleado_property_pin_lookup_key UNIQUE (property_id, pin_lookup);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empleado_qr_token_key'
  ) THEN
    ALTER TABLE empleado ADD CONSTRAINT empleado_qr_token_key UNIQUE (qr_token);
  END IF;
END $$;

-- Tabla de fichajes. El "día laboral" NO se acota por fecha de calendario:
-- el estado de cada empleado se deriva del ÚLTIMO fichaje cronológico
-- (independientemente de si cae en el día de calendario anterior o el
-- actual), lo que resuelve de forma natural los turnos que cruzan la
-- medianoche (p.ej. entrada 23:40, salida 07:10 del día siguiente).
CREATE TABLE IF NOT EXISTS fichaje (
  id SERIAL PRIMARY KEY,
  property_id VARCHAR(30) NOT NULL REFERENCES propiedad(id),
  empleado_id INTEGER NOT NULL REFERENCES empleado(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL,             -- entrada | salida | pausa_inicio | pausa_fin
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen VARCHAR(20) NOT NULL DEFAULT 'quiosco',  -- quiosco | manual | qr
  nota TEXT,
  creado_por VARCHAR(100),               -- login admin si origen='manual'; null si quiosco/qr
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fichaje_tipo_chk CHECK (tipo IN ('entrada','salida','pausa_inicio','pausa_fin')),
  CONSTRAINT fichaje_origen_chk CHECK (origen IN ('quiosco','manual','qr'))
);

CREATE INDEX IF NOT EXISTS idx_fichaje_empleado_ts ON fichaje(empleado_id, ts);
CREATE INDEX IF NOT EXISTS idx_fichaje_property_ts ON fichaje(property_id, ts);

-- ═══════════════════════════════════════════════════════════════════
-- FASE 3 — Inspección de Trabajo (registro de jornada legal, RD 8/2019)
-- Idempotente: se puede volver a ejecutar sin romper nada de Fases 1-2.
-- Las horas trabajadas NO se guardan en una tabla propia: se calculan en
-- caliente a partir de `fichaje` (fuente única de verdad). Solo se añade
-- una tabla de auditoría de las exportaciones (quién generó qué informe
-- y con qué sello de integridad).
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS export_log (
  id SERIAL PRIMARY KEY,
  property_id VARCHAR(30) NOT NULL REFERENCES propiedad(id),
  generado_por VARCHAR(100) NOT NULL,
  empleado_id INTEGER REFERENCES empleado(id) ON DELETE SET NULL, -- NULL = informe "todos" o empleado ya purgado; el registro de auditoría se conserva siempre
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  formato VARCHAR(10) NOT NULL,                  -- pdf | csv
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash VARCHAR(64) NOT NULL,                     -- SHA-256 del contenido exportado (sello de integridad)
  CONSTRAINT export_log_formato_chk CHECK (formato IN ('pdf','csv'))
);

CREATE INDEX IF NOT EXISTS idx_export_log_property ON export_log(property_id, ts);

-- Política de retención (documentada, NO ejecutada automáticamente):
-- Los fichajes son la fuente del registro de jornada legal (RD 8/2019) y
-- deben conservarse un mínimo de 4 años. Esta fase NO borra fichajes
-- antiguos. Si en el futuro se decide limpiar datos con más de 4 años,
-- plantilla lista para activar manualmente (comentada a propósito,
-- revisar el impacto antes de descomentar/ejecutar):
--
-- DELETE FROM fichaje WHERE ts < (now() - interval '4 years');

-- ═══════════════════════════════════════════════════════════════════
-- FASE 4 — Informes (horas, ausencias/"días sin fichaje", coste, envío)
-- Idempotente: se puede volver a ejecutar sin romper nada de Fases 1-3.
-- Las métricas se siguen calculando en caliente a partir de `fichaje`
-- (misma función de la Fase 3). Solo se añade:
--  a) coste_hora en empleado: OPCIONAL y nullable. Si es null, el coste
--     de ese empleado se muestra como "(coste pendiente)" y se EXCLUYE
--     del total con una nota; nunca se asume 0 ni se inventa un valor.
--  b) dos formatos nuevos en export_log ('informe_pdf'/'informe_csv'),
--     además de los ya existentes de Fase 3 ('pdf'/'csv' de inspección).
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE empleado ADD COLUMN IF NOT EXISTS coste_hora NUMERIC(8,2);

-- 'informe_pdf'/'informe_csv' (11 caracteres) no caben en el VARCHAR(10)
-- original de Fase 3 (pensado solo para 'pdf'/'csv'). Se ensancha la
-- columna; ALTER ... TYPE VARCHAR(20) es seguro de repetir (no trunca
-- datos ya guardados, que son más cortos).
ALTER TABLE export_log ALTER COLUMN formato TYPE VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empleado_coste_hora_chk'
  ) THEN
    ALTER TABLE empleado ADD CONSTRAINT empleado_coste_hora_chk CHECK (coste_hora IS NULL OR coste_hora >= 0);
  END IF;
END $$;

-- Amplía el CHECK de export_log para admitir los formatos de informe de
-- Fase 4 sin perder los de Fase 3. DROP+ADD es seguro de repetir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_log_formato_chk') THEN
    ALTER TABLE export_log DROP CONSTRAINT export_log_formato_chk;
  END IF;
  ALTER TABLE export_log ADD CONSTRAINT export_log_formato_chk
    CHECK (formato IN ('pdf','csv','informe_pdf','informe_csv'));
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- FASE 5 — Motivación (mensaje del día por departamento, cumpleaños y
-- aniversario de antigüedad, mostrados en el QUIOSCO al fichar).
-- Idempotente: se puede volver a ejecutar sin romper nada de Fases 1-4.
-- Cumpleaños/aniversarios NO se guardan en tabla propia: se calculan en
-- caliente a partir de empleado.fecha_nacimiento / empleado.fecha_alta
-- (ya indexadas arriba, idx_empleado_nacimiento / idx_empleado_alta),
-- igual que las horas de las Fases 3-4. Solo se añade la tabla de
-- mensajes motivacionales configurables desde el panel admin.
-- PRIVACIDAD: en el quiosco NUNCA se expone la edad ni el año de
-- nacimiento de nadie; solo el nombre de pila y, en aniversarios, los
-- años de antigüedad (dato que SÍ se pide mostrar).
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mensaje_motivacional (
  id SERIAL PRIMARY KEY,
  property_id VARCHAR(30) NOT NULL REFERENCES propiedad(id),
  departamento_id INTEGER REFERENCES departamento(id), -- NULL = vale para todos los departamentos
  texto TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensaje_motivacional_dep ON mensaje_motivacional(property_id, departamento_id, activo);

-- Seed: mensajes de ejemplo GENÉRICOS (no son datos de personas reales).
-- Rotación determinista por día del año dentro del conjunto de mensajes
-- activos aplicable (ver server.js: mensajeMotivacionalDelDia). Guardado
-- tras NOT EXISTS para no duplicar si se vuelve a ejecutar esta migración.
INSERT INTO mensaje_motivacional (property_id, departamento_id, texto)
SELECT 'vera', NULL, t.texto FROM (VALUES
  ('Gracias por tu trabajo de hoy: cada detalle que cuidas hace mejor la experiencia de quien nos visita.'),
  ('Un equipo que se apoya llega más lejos. ¡Buen turno!'),
  ('Tu actitud de hoy puede ser el mejor recuerdo de un huésped. ¡A por ello!'),
  ('Pequeños gestos, gran impacto: gracias por cuidar los detalles.'),
  ('Hoy es un buen día para hacer las cosas un poco mejor que ayer.')
) AS t(texto)
WHERE NOT EXISTS (
  SELECT 1 FROM mensaje_motivacional WHERE property_id = 'vera' AND departamento_id IS NULL
);

INSERT INTO mensaje_motivacional (property_id, departamento_id, texto)
SELECT 'vera', d.id, t.texto
FROM departamento d
JOIN (VALUES
  ('Recepción', 'La primera sonrisa del día la pones tú: gracias por ser la mejor bienvenida al hotel.'),
  ('Pisos', 'Cada habitación impecable es un "gracias" silencioso a quien la ocupa. ¡Gran trabajo!'),
  ('Mantenimiento', 'Gracias a tu trabajo, todo funciona sin que nadie tenga que pensarlo en todo el día. Eso es hacerlo muy bien.')
) AS t(depnombre, texto) ON t.depnombre = d.nombre
WHERE d.property_id = 'vera'
  AND NOT EXISTS (
    SELECT 1 FROM mensaje_motivacional m WHERE m.property_id = 'vera' AND m.departamento_id = d.id
  );
