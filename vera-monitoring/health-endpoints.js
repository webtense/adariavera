/**
 * Vera Adaria v1.1.0 — Health Endpoints Middleware
 *
 * Middleware Express/Next.js que expone /health y /metrics en cada módulo
 *
 * Uso en Express:
 *   const { setupHealthEndpoints } = require('./health-endpoints');
 *   setupHealthEndpoints(app, { db: pgPool, serviceName: 'Welcome Check-in' });
 *
 * Uso en Next.js:
 *   export { default } from './health-endpoints-nextjs';
 */

const os = require('os');
const startTime = Date.now();

/**
 * Setup Express/Fastify health endpoints
 */
function setupHealthEndpoints(app, options = {}) {
  const {
    db = null,
    serviceName = 'Unknown Service',
    port = 3000,
    version = '1.0.0',
    dependencies = [],
  } = options;

  let requestCount = 0;
  let errorCount = 0;
  const responseTimes = [];

  // Middleware para contar requests y errores
  app.use((req, res, next) => {
    requestCount++;
    const startTime = Date.now();

    res.on('finish', () => {
      const latency = Date.now() - startTime;
      responseTimes.push(latency);

      // Mantener últimas 100 mediciones
      if (responseTimes.length > 100) {
        responseTimes.shift();
      }

      // Contar errores (5xx, 4xx selectos)
      if (res.statusCode >= 500 || res.statusCode === 408 || res.statusCode === 503) {
        errorCount++;
      }
    });

    next();
  });

  /**
   * GET /health
   * Health check básico: responde si el servicio está vivo
   */
  app.get('/health', async (req, res) => {
    try {
      const uptime = (Date.now() - startTime) / 1000; // segundos

      // Verificar conectividad DB si existe
      let dbHealthy = true;
      if (db) {
        try {
          const result = await db.query('SELECT 1');
          dbHealthy = !!result;
        } catch (error) {
          dbHealthy = false;
        }
      }

      const status = dbHealthy ? 'online' : 'offline';
      const statusCode = dbHealthy ? 200 : 503;

      res.status(statusCode).json({
        service: serviceName,
        status,
        uptime: Math.round(uptime) + 's',
        version,
        timestamp: new Date().toISOString(),
        dependencies: {
          database: dbHealthy ? 'connected' : 'disconnected',
        },
      });
    } catch (error) {
      res.status(503).json({
        service: serviceName,
        status: 'offline',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /metrics
   * Métricas detalladas: latencia, errores, throughput, etc.
   */
  app.get('/metrics', (req, res) => {
    const uptime = (Date.now() - startTime) / 1000;
    const avgLatency = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    const p95Latency = responseTimes.length > 0
      ? Math.round(responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)] || 0)
      : 0;

    const p99Latency = responseTimes.length > 0
      ? Math.round(responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.99)] || 0)
      : 0;

    const errorRate = requestCount > 0
      ? ((errorCount / requestCount) * 100).toFixed(2)
      : 0;

    const throughput = uptime > 0
      ? (requestCount / (uptime / 60)).toFixed(2)
      : 0;

    res.json({
      service: serviceName,
      timestamp: new Date().toISOString(),
      uptime: Math.round(uptime) + 's',
      requests: {
        total: requestCount,
        errors: errorCount,
        errorRate: errorRate + '%',
        throughput: throughput + ' req/min',
      },
      latency: {
        avg: avgLatency + 'ms',
        p95: p95Latency + 'ms',
        p99: p99Latency + 'ms',
      },
      system: {
        uptime: Math.round(os.uptime()) + 's',
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        },
        cpuUsage: process.cpuUsage(),
      },
    });
  });

  /**
   * GET /readiness
   * Readiness probe (para K8s / orchestradores)
   */
  app.get('/readiness', (req, res) => {
    // Consideramos "listo" si:
    // - No hemos tenido más del 10% de errores
    // - La latencia promedio no excede 5s
    const readinessOk = errorRate < 10 && avgLatency < 5000;

    res.status(readinessOk ? 200 : 503).json({
      service: serviceName,
      ready: readinessOk,
      timestamp: new Date().toISOString(),
    });
  });

  console.log(`[HEALTH] Endpoints registrados en ${serviceName}`);
}

/**
 * Middleware Next.js: API route handler
 *
 * Ejemplo de uso en pages/api/health.js:
 *   export default healthHandler({ serviceName: 'Welcome', db: dbPool });
 */
function healthHandler(options = {}) {
  return async (req, res) => {
    const { serviceName = 'API', db = null } = options;

    if (req.method === 'GET') {
      try {
        let dbHealthy = true;
        if (db) {
          try {
            await db.query('SELECT 1');
            dbHealthy = true;
          } catch {
            dbHealthy = false;
          }
        }

        const status = dbHealthy ? 'online' : 'offline';
        const uptime = (Date.now() - startTime) / 1000;

        res.status(dbHealthy ? 200 : 503).json({
          service: serviceName,
          status,
          uptime: Math.round(uptime) + 's',
          timestamp: new Date().toISOString(),
          dependencies: { database: dbHealthy ? 'connected' : 'disconnected' },
        });
      } catch (error) {
        res.status(503).json({
          service: serviceName,
          status: 'offline',
          error: error.message,
        });
      }
    } else {
      res.status(405).json({ error: 'Method Not Allowed' });
    }
  };
}

module.exports = {
  setupHealthEndpoints,
  healthHandler,
};
