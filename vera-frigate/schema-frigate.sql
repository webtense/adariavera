-- ============================================================================
-- FRIGATE NVR - SCHEMA EVENTOS
-- v1.1.0 | Vera Adaria | 2026-09-01
-- ============================================================================
-- Histórico completo de eventos detectados por Frigate
-- Almacena: objetos detectados, confianza, ubicación, snapshot, video

CREATE TABLE IF NOT EXISTS frigate_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(64) UNIQUE NOT NULL,           -- Frigate event ID
  camera_name VARCHAR(100) NOT NULL,              -- Nombre cámara (Recepción, Parking, etc)
  event_type VARCHAR(50) NOT NULL,                -- 'motion' | 'object'
  object_class VARCHAR(50),                       -- 'person' | 'car' | 'dog' | 'cat' | NULL si motion
  confidence DECIMAL(5,2),                        -- 0.0 - 1.0
  detection_count INT DEFAULT 1,                  -- Frames donde detectó
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,  -- Timestamp inicio evento
  end_time TIMESTAMP WITH TIME ZONE,              -- Timestamp fin evento
  duration_seconds INT,                           -- Duración total

  -- Ubicación
  zone VARCHAR(100),                              -- Zona de interés ('entrada', 'parking', etc)
  detection_box JSONB,                            -- {"x": 100, "y": 200, "w": 50, "h": 75}

  -- Almacenamiento
  snapshot_url VARCHAR(500),                      -- URL al snapshot
  video_path VARCHAR(500),                        -- Ruta archivo video en disco
  video_duration_seconds INT,                     -- Duración video grabado
  has_clip BOOLEAN DEFAULT false,                 -- Si se grabó video

  -- Alertas
  alert_sent BOOLEAN DEFAULT false,               -- Si se envió alerta WhatsApp
  alert_level VARCHAR(20),                        -- 'info' | 'warning' | 'critical'
  alert_message TEXT,                             -- Mensaje de alerta

  -- Índices
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT valid_event_type CHECK (event_type IN ('motion', 'object'))
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_frigate_camera ON frigate_events(camera_name);
CREATE INDEX IF NOT EXISTS idx_frigate_timestamp ON frigate_events(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_frigate_type ON frigate_events(event_type);
CREATE INDEX IF NOT EXISTS idx_frigate_object ON frigate_events(object_class);
CREATE INDEX IF NOT EXISTS idx_frigate_zone ON frigate_events(zone);
CREATE INDEX IF NOT EXISTS idx_frigate_alert ON frigate_events(alert_sent);

-- Tabla de configuración por cámara
CREATE TABLE IF NOT EXISTS frigate_cameras (
  id SERIAL PRIMARY KEY,
  camera_name VARCHAR(100) UNIQUE NOT NULL,
  rtsp_url VARCHAR(500) NOT NULL,
  ip_address INET,
  resolution VARCHAR(20),                         -- "2560x1440" o "1920x1080"
  fps INT DEFAULT 30,
  bitrate_kbps INT DEFAULT 2000,

  -- Detección
  detection_enabled BOOLEAN DEFAULT true,
  detection_fps INT DEFAULT 5,                    -- FPS para detect (reducido)
  recording_fps INT DEFAULT 30,                   -- FPS para grabación

  -- Objetos a detectar
  detect_objects TEXT,                            -- 'person,car,dog,cat' (CSV)
  min_confidence DECIMAL(5,2) DEFAULT 0.5,        -- Confianza mínima

  -- Grabación
  recording_enabled BOOLEAN DEFAULT false,        -- NO grabar siempre
  pre_buffer_minutes INT DEFAULT 10,              -- Minutos antes evento
  post_buffer_minutes INT DEFAULT 10,             -- Minutos después evento
  max_events_retained INT DEFAULT 30,             -- Max eventos guardados

  -- Estado
  is_active BOOLEAN DEFAULT true,
  last_seen TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de zonas por cámara (regiones de interés)
CREATE TABLE IF NOT EXISTS frigate_zones (
  id SERIAL PRIMARY KEY,
  camera_name VARCHAR(100) NOT NULL,
  zone_name VARCHAR(100) NOT NULL,
  zone_type VARCHAR(50),                          -- 'entry' | 'parking' | 'service' | 'restricted'
  coordinates JSONB,                              -- [{x,y}, {x,y}, ...]
  is_active BOOLEAN DEFAULT true,
  description TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (camera_name) REFERENCES frigate_cameras(camera_name) ON DELETE CASCADE,
  UNIQUE(camera_name, zone_name)
);

-- Tabla alertas enviadas (anti-spam)
CREATE TABLE IF NOT EXISTS frigate_alert_log (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(64),
  camera_name VARCHAR(100),
  object_class VARCHAR(50),
  alert_type VARCHAR(50),                         -- 'whatsapp' | 'email' | 'webhook'
  recipient VARCHAR(500),                         -- Tel whatsapp o email
  alert_message TEXT,
  http_status INT,
  response_body TEXT,

  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (event_id) REFERENCES frigate_events(event_id) ON DELETE CASCADE
);

-- Vista: Últimos eventos por cámara
CREATE OR REPLACE VIEW v_frigate_latest_events AS
  SELECT DISTINCT ON (camera_name, object_class)
    camera_name,
    object_class,
    event_type,
    confidence,
    start_time,
    alert_level,
    snapshot_url,
    has_clip
  FROM frigate_events
  WHERE created_at > NOW() - INTERVAL '7 days'
  ORDER BY camera_name, object_class, start_time DESC;

-- Vista: Estadísticas por cámara (últimas 24h)
CREATE OR REPLACE VIEW v_frigate_stats_24h AS
  SELECT
    camera_name,
    COUNT(*) as total_events,
    COUNT(CASE WHEN event_type = 'motion' THEN 1 END) as motion_events,
    COUNT(CASE WHEN event_type = 'object' THEN 1 END) as object_events,
    COUNT(DISTINCT object_class) as unique_objects,
    AVG(confidence) as avg_confidence,
    MAX(confidence) as max_confidence,
    COUNT(CASE WHEN has_clip THEN 1 END) as videos_recorded
  FROM frigate_events
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY camera_name;

-- Función: Auto-limpieza eventos antiguos
CREATE OR REPLACE FUNCTION frigate_cleanup_old_events()
RETURNS void AS $$
DECLARE
  v_days_retention INT := 30;
BEGIN
  DELETE FROM frigate_events
  WHERE created_at < NOW() - (v_days_retention || ' days')::INTERVAL
    AND has_clip = false;  -- Solo eliminar si no hay video

  DELETE FROM frigate_alert_log
  WHERE sent_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Trigger: Actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_frigate_events
BEFORE UPDATE ON frigate_events
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_frigate_cameras
BEFORE UPDATE ON frigate_cameras
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMENTARIOS v1.1.0
-- ============================================================================
-- • frigate_events: Índices en camera_name + timestamp para búsqueda rápida
-- • alert_level: ['info' (movimiento), 'warning' (objeto), 'critical' (persona/vehículo zona restringida)]
-- • duration_seconds: Calculado como (end_time - start_time)
-- • frigate_alert_log: Evita enviar 2 alertas en <2min (CHECK en alerts-frigate.js)
-- • v_frigate_stats_24h: Para dashboard KPIs
-- • frigate_cleanup_old_events(): Cron job (3am) para eliminar eventos >30 días sin video
