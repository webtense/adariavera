-- Vera Adaria v1.1.0 — Agregar 4 tarjetas nuevas al panel de gestión
-- Fecha: 2026-09-03
-- Módulos: Health Monitoring, Frigate NVR, Pre Check-in KPIs, Welcome Check-in KPIs

INSERT INTO pieza (
  nombre, 
  descripcion, 
  icono, 
  url, 
  orden, 
  estado,
  app_code,
  version
) VALUES
  (
    'Health Monitoring',
    'Monitoreo de salud de servicios con alertas WhatsApp',
    '🔔',
    'http://localhost:3100/dashboard',
    10,
    'disponible',
    'health-monitoring',
    '1.1.0'
  ),
  (
    'Frigate NVR',
    'Vigilancia inteligente con detección de objetos',
    '🎥',
    'http://localhost:5000',
    11,
    'disponible',
    'frigate-nvr',
    '1.1.0'
  ),
  (
    'Pre Check-in KPIs',
    'Formularios recibidos hoy, tasa completado, pendientes',
    '📊',
    'http://localhost:3094/stats',
    12,
    'disponible',
    'precheckin-kpis',
    '1.1.0'
  ),
  (
    'Welcome KPIs',
    'Estado de búsquedas, respuesta, uptime Welcome',
    '📈',
    'http://localhost:3093/stats',
    13,
    'disponible',
    'welcome-kpis',
    '1.1.0'
  );
