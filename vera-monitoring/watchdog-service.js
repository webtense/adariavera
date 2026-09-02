/**
 * Vera Adaria v1.1.0 — Health Checker Watchdog Service
 * Puerto: 3100
 * Función: Monitorea todos los servicios cada 30 segundos, gestiona alertas WhatsApp
 *
 * Uso:
 *   node watchdog-service.js
 *
 * Endpoints:
 *   GET /services/status — Estado actual JSON de todos los servicios
 *   GET /metrics — Agregado de métricas globales
 *   GET /health — Health del watchdog en sí
 */

const express = require('express');
const axios = require('axios');
const pg = require('pg');
const config = require('./services-monitor.config.json');
const Alerter = require('./alerter');

const app = express();
const alerter = new Alerter(config.whatsapp);
const pool = new pg.Pool(config.database);

// Estado en memoria
const serviceStates = {};
const alertHistory = {}; // { serviceName: { lastAlertTime, status } }

// Inicializar estados
config.services.forEach(service => {
  serviceStates[service.name] = {
    name: service.name,
    status: 'unknown',
    uptime: '0%',
    lastCheck: null,
    responseTime: null,
    errorRate: '0%',
    totalRequests: 0,
    totalErrors: 0,
    lastErrorMessage: null,
    trend: 'unknown',
    alertSentAt: null,
    alertNumber: service.alertNumber,
  };
  alertHistory[service.name] = { lastAlertTime: 0, status: 'unknown' };
});

/**
 * Health check para un servicio
 */
async function checkServiceHealth(serviceConfig) {
  const startTime = Date.now();
  try {
    const response = await axios.get(
      `${serviceConfig.url}${serviceConfig.healthEndpoint}`,
      { timeout: serviceConfig.timeout }
    );
    const latency = Date.now() - startTime;

    return {
      status: 'online',
      latency,
      httpStatus: response.status,
      responseTime: latency,
      errorMessage: null,
      data: response.data || {},
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      status: 'offline',
      latency,
      httpStatus: error.response?.status || 0,
      responseTime: latency,
      errorMessage: error.code === 'ECONNABORTED'
        ? `TIMEOUT (>${serviceConfig.timeout}ms)`
        : error.message,
      data: null,
    };
  }
}

/**
 * Procesar cambio de estado y alertar si es necesario
 */
async function handleStatusChange(serviceName, newStatus, errorMessage, serviceConfig) {
  const oldStatus = serviceStates[serviceName].status;
  const now = Date.now();
  const lastAlert = alertHistory[serviceName].lastAlertTime;
  const timeSinceLastAlert = now - lastAlert;

  // Cambio de online → offline: enviar alerta (si no se envió en los últimos 5 min)
  if (oldStatus !== 'offline' && newStatus === 'offline') {
    if (timeSinceLastAlert > 5 * 60 * 1000) {
      const timestamp = new Date().toISOString().split('T')[0] +
                       new Date().toLocaleTimeString('es-ES');
      const message = `⚠️ SERVICIO CAÍDO: ${serviceName}.\nÚltima respuesta: ${timestamp}.\nError: ${errorMessage || 'Sin respuesta'}`;

      if (config.whatsapp.enabled && serviceConfig.alertChannels?.includes('whatsapp')) {
        await alerter.send(serviceConfig.alertNumber, message);
        serviceStates[serviceName].alertSentAt = now;
      }
      alertHistory[serviceName].lastAlertTime = now;
      console.log(`[ALERT] ${serviceName} → OFFLINE at ${new Date().toISOString()}`);
    }
  }

  // Cambio de offline → online: enviar notificación de recuperación
  if (oldStatus === 'offline' && newStatus === 'online') {
    const message = `✅ SERVICIO RECUPERADO: ${serviceName}.\nTiempo de respuesta: ${serviceStates[serviceName].responseTime}ms`;
    if (config.whatsapp.enabled && serviceConfig.alertChannels?.includes('whatsapp')) {
      await alerter.send(serviceConfig.alertNumber, message);
    }
    console.log(`[RECOVERED] ${serviceName} → ONLINE at ${new Date().toISOString()}`);
  }
}

/**
 * Ciclo principal: ejecutar health checks cada 30s
 */
async function runWatchdog() {
  console.log('[WATCHDOG] Iniciando ciclo de checks...');

  for (const serviceConfig of config.services) {
    const result = await checkServiceHealth(serviceConfig);
    const previousState = serviceStates[serviceConfig.name].status;

    // Actualizar estado
    serviceStates[serviceConfig.name] = {
      ...serviceStates[serviceConfig.name],
      status: result.status,
      lastCheck: new Date().toISOString(),
      responseTime: result.responseTime,
      lastErrorMessage: result.errorMessage,
      totalRequests: serviceStates[serviceConfig.name].totalRequests + 1,
      totalErrors: result.status === 'offline'
        ? serviceStates[serviceConfig.name].totalErrors + 1
        : serviceStates[serviceConfig.name].totalErrors,
      trend: result.status === previousState ? 'stable' : 'changed',
    };

    // Recalcular métricas
    const state = serviceStates[serviceConfig.name];
    state.errorRate = ((state.totalErrors / state.totalRequests) * 100).toFixed(2) + '%';
    state.uptime = (((state.totalRequests - state.totalErrors) / state.totalRequests) * 100).toFixed(1) + '%';

    // Guardar en BD
    await saveHealthCheckToDB(serviceConfig.name, result);

    // Gestionar alertas
    if (result.status !== previousState) {
      await handleStatusChange(serviceConfig.name, result.status, result.errorMessage, serviceConfig);
    }

    console.log(`[CHECK] ${serviceConfig.name} → ${result.status} (${result.responseTime}ms)`);
  }

  // Próximo ciclo en 30 segundos
  setTimeout(runWatchdog, config.checkInterval || 30000);
}

/**
 * Guardar check en BD
 */
async function saveHealthCheckToDB(serviceName, result) {
  try {
    const query = `
      INSERT INTO service_health_log
      (service_name, status, response_time, error_code, timestamp)
      VALUES ($1, $2, $3, $4, NOW())
    `;
    await pool.query(query, [
      serviceName,
      result.status,
      result.responseTime,
      result.errorMessage || null,
    ]);
  } catch (error) {
    console.error(`[DB ERROR] ${serviceName}:`, error.message);
  }
}

/**
 * Cleanup: eliminar logs >30 días
 */
async function cleanupOldLogs() {
  try {
    await pool.query(`
      DELETE FROM service_health_log
      WHERE timestamp < NOW() - INTERVAL '30 days'
    `);
    console.log('[CLEANUP] Logs >30 días eliminados');
  } catch (error) {
    console.error('[CLEANUP ERROR]:', error.message);
  }
}

// ============ ENDPOINTS ============

/**
 * GET /services/status
 * Devuelve estado actual de todos los servicios
 */
app.get('/services/status', (req, res) => {
  const overallHealth = Object.values(serviceStates).every(s => s.status === 'online')
    ? 'HEALTHY'
    : Object.values(serviceStates).some(s => s.status === 'offline')
      ? 'DEGRADED'
      : 'UNKNOWN';

  res.json({
    timestamp: new Date().toISOString(),
    healthOverall: overallHealth,
    services: Object.values(serviceStates),
  });
});

/**
 * GET /metrics
 * Métricas agregadas
 */
app.get('/metrics', (req, res) => {
  const total = Object.values(serviceStates).length;
  const online = Object.values(serviceStates).filter(s => s.status === 'online').length;
  const offline = Object.values(serviceStates).filter(s => s.status === 'offline').length;

  const avgLatency = Object.values(serviceStates)
    .filter(s => s.responseTime)
    .reduce((sum, s) => sum + s.responseTime, 0) / (total || 1);

  res.json({
    timestamp: new Date().toISOString(),
    summary: {
      totalServices: total,
      online,
      offline,
      avgResponseTime: Math.round(avgLatency) + 'ms',
    },
    services: Object.values(serviceStates).map(s => ({
      name: s.name,
      status: s.status,
      uptime: s.uptime,
      errorRate: s.errorRate,
    })),
  });
});

/**
 * GET /health
 * Health del watchdog en sí
 */
app.get('/health', (req, res) => {
  res.json({
    service: 'watchdog',
    status: 'online',
    uptime: process.uptime().toFixed(0) + 's',
    timestamp: new Date().toISOString(),
  });
});

// ============ STARTUP ============

async function startup() {
  // Crear tabla si no existe
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_health_log (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        response_time INT,
        error_code TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_service_timestamp
      ON service_health_log(service_name, timestamp DESC);
    `);
    console.log('[DB] Tabla service_health_log lista');
  } catch (error) {
    console.error('[DB INIT ERROR]:', error.message);
  }

  // Iniciar servidor
  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => {
    console.log(`[WATCHDOG] Escuchando en puerto ${PORT}`);
    console.log(`[API] GET /services/status`);
    console.log(`[API] GET /metrics`);
    console.log(`[API] GET /health`);
  });

  // Iniciar ciclo de watchdog
  setTimeout(() => {
    runWatchdog();
    // Cleanup diario
    setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
  }, 2000);
}

startup().catch(error => {
  console.error('[STARTUP ERROR]:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[SHUTDOWN] Cerrando conexiones...');
  await pool.end();
  process.exit(0);
});
