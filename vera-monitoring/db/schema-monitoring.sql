/**
 * Vera Adaria v1.1.0 — Database Schema for Health Monitoring
 *
 * Crear base de datos y usuario:
 *   CREATE DATABASE vera_monitoring;
 *   CREATE USER vera_monitor WITH PASSWORD 'secure_password';
 *   GRANT ALL PRIVILEGES ON DATABASE vera_monitoring TO vera_monitor;
 *   \c vera_monitoring
 *   GRANT ALL ON SCHEMA public TO vera_monitor;
 *
 * Ejecutar este script como superuser en la DB vera_monitoring
 */

-- ============ TABLA PRINCIPAL: SERVICE_HEALTH_LOG ============

CREATE TABLE IF NOT EXISTS service_health_log (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'online', 'offline', 'degraded'
  response_time INT, -- milisegundos
  error_code TEXT, -- 'TIMEOUT', 'CONNECTION_REFUSED', etc.
  http_status INT, -- código HTTP si aplica
  timestamp TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_health_log_service_timestamp
ON service_health_log(service_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_service_health_log_timestamp
ON service_health_log(timestamp DESC);


-- ============ TABLA: SERVICE_STATUS (Estado actual) ============

CREATE TABLE IF NOT EXISTS service_status (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(255) UNIQUE NOT NULL,
  current_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
  last_check TIMESTAMP,
  uptime_percentage NUMERIC(5, 2) DEFAULT 0.00,
  error_rate NUMERIC(5, 2) DEFAULT 0.00,
  avg_response_time INT DEFAULT 0,
  total_requests INT DEFAULT 0,
  total_errors INT DEFAULT 0,
  last_error_message TEXT,
  alert_sent_at TIMESTAMP,
  alert_number VARCHAR(20),
  trend VARCHAR(20) DEFAULT 'unknown', -- 'stable', 'degrading', 'improving'
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_status_name
ON service_status(service_name);


-- ============ TABLA: ALERT_HISTORY ============

CREATE TABLE IF NOT EXISTS alert_history (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(255) NOT NULL,
  alert_type VARCHAR(50) NOT NULL, -- 'service_down', 'service_recovered', 'degradation'
  alert_number VARCHAR(20) NOT NULL,
  message TEXT,
  provider VARCHAR(50), -- 'twilio', 'n8n'
  provider_message_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'sent', -- 'sent', 'failed', 'delivered'
  sent_at TIMESTAMP DEFAULT NOW(),
  delivered_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_history_service_sent
ON alert_history(service_name, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_history_sent_at
ON alert_history(sent_at DESC);


-- ============ TABLA: SERVICE_METRICS (Agregados diarios) ============

CREATE TABLE IF NOT EXISTS service_metrics (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(255) NOT NULL,
  date_day DATE NOT NULL,
  uptime_percentage NUMERIC(5, 2),
  avg_response_time INT,
  p95_response_time INT,
  p99_response_time INT,
  error_rate NUMERIC(5, 2),
  total_requests INT,
  total_errors INT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_metrics_service_day
ON service_metrics(service_name, date_day);


-- ============ TABLA: INCIDENTS ============

CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(255) NOT NULL,
  incident_type VARCHAR(50) NOT NULL, -- 'outage', 'degradation', 'recovery'
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'resolved', 'acknowledged'
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  duration_minutes INT,
  description TEXT,
  root_cause TEXT,
  mitigation TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_incidents_service_status
ON incidents(service_name, status);

CREATE INDEX IF NOT EXISTS idx_incidents_start_time
ON incidents(start_time DESC);


-- ============ TABLA: AUDIT_LOG ============

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  action VARCHAR(255) NOT NULL,
  service_name VARCHAR(255),
  details JSONB,
  user_agent VARCHAR(255),
  remote_ip VARCHAR(45),
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_service_timestamp
ON audit_log(service_name, timestamp DESC);


-- ============ VISTAS ============

-- Vista: Estado actual de todos los servicios
CREATE OR REPLACE VIEW v_current_status AS
SELECT
  service_name,
  current_status AS status,
  last_check,
  uptime_percentage,
  error_rate,
  avg_response_time,
  total_requests,
  total_errors,
  last_error_message
FROM service_status
ORDER BY service_name;

-- Vista: Últimos incidentes
CREATE OR REPLACE VIEW v_recent_incidents AS
SELECT
  service_name,
  incident_type,
  status,
  start_time,
  end_time,
  COALESCE(duration_minutes, EXTRACT(MINUTE FROM (NOW() - start_time))::INT) AS duration_minutes,
  description
FROM incidents
WHERE start_time > NOW() - INTERVAL '30 days'
ORDER BY start_time DESC;

-- Vista: Alertas recientes
CREATE OR REPLACE VIEW v_recent_alerts AS
SELECT
  service_name,
  alert_type,
  alert_number,
  message,
  status,
  sent_at,
  delivered_at
FROM alert_history
WHERE sent_at > NOW() - INTERVAL '7 days'
ORDER BY sent_at DESC;


-- ============ FUNCIONES ============

-- Función: Limpiar logs antiguos (>30 días)
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM service_health_log
  WHERE timestamp < NOW() - INTERVAL '30 days';

  DELETE FROM alert_history
  WHERE sent_at < NOW() - INTERVAL '90 days';

  DELETE FROM service_metrics
  WHERE date_day < CURRENT_DATE - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Función: Calcular métricas agregadas diarias
CREATE OR REPLACE FUNCTION aggregate_daily_metrics(p_service_name VARCHAR)
RETURNS void AS $$
BEGIN
  INSERT INTO service_metrics
  (service_name, date_day, uptime_percentage, avg_response_time, p95_response_time, p99_response_time, error_rate, total_requests, total_errors)
  SELECT
    p_service_name,
    DATE(timestamp),
    ROUND(((COUNT(*) - COALESCE(SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END), 0))::NUMERIC / COUNT(*)::NUMERIC) * 100, 2),
    ROUND(AVG(response_time)::NUMERIC, 0)::INT,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time)::INT,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time)::INT,
    ROUND((COALESCE(SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END), 0)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2),
    COUNT(*),
    COALESCE(SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END), 0)
  FROM service_health_log
  WHERE service_name = p_service_name
    AND DATE(timestamp) = CURRENT_DATE - INTERVAL '1 day'
  GROUP BY DATE(timestamp)
  ON CONFLICT (service_name, date_day)
  DO UPDATE SET
    uptime_percentage = EXCLUDED.uptime_percentage,
    avg_response_time = EXCLUDED.avg_response_time,
    p95_response_time = EXCLUDED.p95_response_time,
    p99_response_time = EXCLUDED.p99_response_time,
    error_rate = EXCLUDED.error_rate,
    total_requests = EXCLUDED.total_requests,
    total_errors = EXCLUDED.total_errors;
END;
$$ LANGUAGE plpgsql;


-- ============ PERMISOS ============

-- Usuario vera_monitor (read/write para aplicación)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vera_monitor;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vera_monitor;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vera_monitor;

-- Usuario vera_readonly (solo lectura para dashboards)
CREATE USER IF NOT EXISTS vera_readonly WITH PASSWORD 'process.env.DB_PASSWORD_READONLY';
GRANT CONNECT ON DATABASE vera_monitoring TO vera_readonly;
GRANT USAGE ON SCHEMA public TO vera_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vera_readonly;
GRANT SELECT ON ALL VIEWS IN SCHEMA public TO vera_readonly;

-- Alertas de aplicación para logs
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO vera_readonly;


-- ============ DATOS INICIALES ============

-- Insertar servicios conocidos
INSERT INTO service_status (service_name, current_status)
VALUES
  ('Welcome Check-in', 'unknown'),
  ('Pre Check-in', 'unknown'),
  ('Admin Dashboard', 'unknown'),
  ('Portales Hub', 'unknown'),
  ('INE Module', 'unknown'),
  ('Parking System', 'unknown'),
  ('Guest Portal', 'unknown'),
  ('Scanner Module', 'unknown'),
  ('Manuales Portal', 'unknown')
ON CONFLICT (service_name) DO NOTHING;

-- Nota de referencia: ejecutar cleanup_old_logs() diariamente
-- SELECT cron.schedule('vera_cleanup', '0 2 * * *', 'SELECT cleanup_old_logs()');
