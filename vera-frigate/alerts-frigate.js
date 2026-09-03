/**
 * ============================================================================
 * FRIGATE ALERTS - Integración Frigate → PostgreSQL → WhatsApp
 * v1.1.0 | Vera Adaria | 2026-09-01
 * ============================================================================
 * Monitorea eventos de Frigate y:
 * 1. Almacena en PostgreSQL (frigate_events)
 * 2. Analiza confianza y zona
 * 3. Evita spam (max 1 alerta / 2 min por cámara)
 * 4. Envía alertas a WhatsApp mediante /api/alert/frigate
 * 5. Mantiene histórico completo
 */

const axios = require('axios');
const { Pool } = require('pg');
const Redis = require('redis');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const CONFIG = {
  frigate: {
    host: process.env.FRIGATE_HOST || '127.0.0.1',
    port: process.env.FRIGATE_PORT || 5000,
    api_url: process.env.FRIGATE_API_URL || 'http://127.0.0.1:5000',
    poll_interval: 5000  // Sondear eventos cada 5s
  },
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'vera_adaria',
    user: process.env.POSTGRES_USER || 'frigate',
    password: process.env.POSTGRES_PASSWORD || ''
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379
  },
  alerts: {
    whatsapp_webhook: process.env.WHATSAPP_WEBHOOK || 'http://localhost:3000/api/alert/frigate',
    anti_spam_window: 120,  // 2 minutos entre alertas
    critical_objects: ['person'],
    warning_objects: ['car']
  }
};

// ============================================================================
// CLIENTES
// ============================================================================
class FrigateAlerter {
  constructor() {
    this.pgPool = null;
    this.redisClient = null;
    this.lastEventTime = new Map();  // Tracking último evento por cámara/objeto
    this.processedEvents = new Set();  // Evitar procesar 2x mismo evento
  }

  // =========================================================================
  // INICIALIZACIÓN
  // =========================================================================
  async init() {
    console.log('[*] Inicializando FrigateAlerter v1.1.0...');

    try {
      // Conectar PostgreSQL
      this.pgPool = new Pool(CONFIG.database);
      const pgTest = await this.pgPool.query('SELECT 1');
      console.log('[✓] PostgreSQL conectado');

      // Conectar Redis
      this.redisClient = Redis.createClient({
        host: CONFIG.redis.host,
        port: CONFIG.redis.port
      });

      await new Promise((resolve, reject) => {
        this.redisClient.on('connect', resolve);
        this.redisClient.on('error', reject);
      });
      console.log('[✓] Redis conectado');

      // Verificar Frigate
      const frigate = await axios.get(`${CONFIG.frigate.api_url}/api/version`);
      console.log(`[✓] Frigate ${frigate.data.version} conectado`);

      // Iniciar polling
      this.startPolling();

      console.log('[✓] FrigateAlerter listo');
    } catch (error) {
      console.error('[✗] Error al inicializar:', error.message);
      process.exit(1);
    }
  }

  // =========================================================================
  // POLLING DE EVENTOS
  // =========================================================================
  startPolling() {
    console.log(`[*] Iniciando polling cada ${CONFIG.frigate.poll_interval}ms...`);

    setInterval(async () => {
      try {
        await this.checkNewEvents();
      } catch (error) {
        console.error('[!] Error en polling:', error.message);
      }
    }, CONFIG.frigate.poll_interval);
  }

  async checkNewEvents() {
    try {
      // Obtener eventos últimas 2 horas de Frigate
      const response = await axios.get(
        `${CONFIG.frigate.api_url}/api/events?limit=50&include_thumbnails=1`,
        { timeout: 5000 }
      );

      const events = response.data || [];

      for (const event of events) {
        // Evitar procesar 2x mismo evento
        if (this.processedEvents.has(event.id)) {
          continue;
        }

        await this.processEvent(event);
        this.processedEvents.add(event.id);

        // Limpiar set si crece mucho
        if (this.processedEvents.size > 1000) {
          this.processedEvents.clear();
        }
      }
    } catch (error) {
      console.error('[!] Error fetching events:', error.message);
    }
  }

  // =========================================================================
  // PROCESAR EVENTO
  // =========================================================================
  async processEvent(event) {
    try {
      const camera = event.camera;
      const topObject = event.top_object || null;
      const startTime = new Date(event.start_time * 1000);
      const endTime = event.end_time ? new Date(event.end_time * 1000) : null;
      const confidence = event.top_score || 0;

      console.log(
        `[*] Evento: ${camera} | ${topObject} (${(confidence * 100).toFixed(1)}%)`
      );

      // Determinar tipo de evento
      const eventType = event.has_clip ? 'object' : 'motion';
      const durationSeconds = endTime
        ? Math.round((endTime - startTime) / 1000)
        : null;

      // Guardar en PostgreSQL
      await this.saveEventToDB({
        event_id: event.id,
        camera_name: camera,
        event_type: eventType,
        object_class: topObject,
        confidence,
        start_time: startTime,
        end_time: endTime,
        duration_seconds: durationSeconds,
        zone: this.detectZone(camera),
        snapshot_url: event.thumbnail || null,
        video_path: event.has_clip ? `events/${event.id}/clip.mp4` : null,
        has_clip: event.has_clip || false
      });

      // Verificar si enviar alerta
      const shouldAlert = await this.shouldSendAlert(camera, topObject, confidence);

      if (shouldAlert) {
        await this.sendAlert({
          event_id: event.id,
          camera,
          object: topObject,
          confidence,
          timestamp: startTime,
          zone: this.detectZone(camera),
          snapshot_url: event.thumbnail
        });
      }
    } catch (error) {
      console.error('[✗] Error procesando evento:', error.message);
    }
  }

  // =========================================================================
  // GUARDAR EN BASE DE DATOS
  // =========================================================================
  async saveEventToDB(eventData) {
    try {
      const query = `
        INSERT INTO frigate_events (
          event_id, camera_name, event_type, object_class, confidence,
          start_time, end_time, duration_seconds, zone, snapshot_url,
          video_path, has_clip, alert_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (event_id) DO NOTHING
      `;

      // Determinar alert_level
      let alertLevel = 'info';
      if (CONFIG.alerts.critical_objects.includes(eventData.object_class)) {
        alertLevel = 'critical';
      } else if (CONFIG.alerts.warning_objects.includes(eventData.object_class)) {
        alertLevel = 'warning';
      }

      const values = [
        eventData.event_id,
        eventData.camera_name,
        eventData.event_type,
        eventData.object_class,
        eventData.confidence,
        eventData.start_time,
        eventData.end_time,
        eventData.duration_seconds,
        eventData.zone,
        eventData.snapshot_url,
        eventData.video_path,
        eventData.has_clip,
        alertLevel
      ];

      await this.pgPool.query(query, values);
      console.log(`[✓] Evento ${eventData.event_id} guardado en BD`);
    } catch (error) {
      console.error('[✗] Error al guardar en BD:', error.message);
    }
  }

  // =========================================================================
  // ANTI-SPAM: Verificar si enviar alerta
  // =========================================================================
  async shouldSendAlert(camera, object, confidence) {
    // Solo alertar si confianza > 0.6
    if (confidence < 0.6) {
      return false;
    }

    // Solo alertar de objetos interesantes
    const interestingObjects = [...CONFIG.alerts.critical_objects, ...CONFIG.alerts.warning_objects];
    if (!interestingObjects.includes(object)) {
      return false;
    }

    // Anti-spam: máx 1 alerta cada 2 min por cámara/objeto
    const key = `frigate:alert:${camera}:${object}`;
    const lastAlert = await this.redisGet(key);

    if (lastAlert) {
      console.log(`[!] Alerta reciente para ${camera}/${object}, ignorando`);
      return false;
    }

    // Marcar como alertado
    await this.redisSet(key, '1', CONFIG.alerts.anti_spam_window);

    return true;
  }

  // =========================================================================
  // ENVIAR ALERTA
  // =========================================================================
  async sendAlert(eventData) {
    try {
      const message = this.buildAlertMessage(eventData);

      console.log(`[*] Enviando alerta: ${eventData.camera} | ${eventData.object}`);

      // Payload para webhook
      const payload = {
        alert_type: 'frigate_detection',
        camera: eventData.camera,
        object: eventData.object,
        confidence: `${(eventData.confidence * 100).toFixed(1)}%`,
        timestamp: eventData.timestamp.toISOString(),
        zone: eventData.zone,
        message,
        snapshot_url: eventData.snapshot_url,
        event_id: eventData.event_id
      };

      // Enviar a webhook
      const response = await axios.post(
        CONFIG.alerts.whatsapp_webhook,
        payload,
        { timeout: 10000 }
      );

      // Guardar en log de alertas
      await this.logAlert(eventData.event_id, response.status, response.data);

      console.log('[✓] Alerta enviada');
    } catch (error) {
      console.error('[✗] Error al enviar alerta:', error.message);
    }
  }

  // =========================================================================
  // CONSTRUIR MENSAJE DE ALERTA
  // =========================================================================
  buildAlertMessage(eventData) {
    const emoji = {
      person: '👤',
      car: '🚗',
      dog: '🐕',
      cat: '🐱'
    };

    const icon = emoji[eventData.object] || '⚠️';
    const time = eventData.timestamp.toLocaleTimeString('es-ES');

    return `
${icon} DETECCIÓN FRIGATE

Cámara: ${eventData.camera}
Objeto: ${eventData.object}
Confianza: ${eventData.confidence}%
Zona: ${eventData.zone}
Hora: ${time}
    `.trim();
  }

  // =========================================================================
  // GUARDAR LOG DE ALERTAS
  // =========================================================================
  async logAlert(eventId, httpStatus, response) {
    try {
      const query = `
        INSERT INTO frigate_alert_log (event_id, object_class, alert_type, http_status, response_body)
        VALUES ($1, $2, $3, $4, $5)
      `;

      const values = [
        eventId,
        'frigate_detection',
        'whatsapp',
        httpStatus,
        JSON.stringify(response)
      ];

      await this.pgPool.query(query, values);
    } catch (error) {
      console.error('[!] Error registrando alerta:', error.message);
    }
  }

  // =========================================================================
  // DETECTAR ZONA
  // =========================================================================
  detectZone(camera) {
    const zones = {
      recepcion: 'entrada',
      parking: 'parking_lot',
      entrada_principal: 'puerta',
      servicio: 'zona_restringida',
      trasera: 'trasera',
      lateral: 'lateral'
    };

    return zones[camera] || 'unknown';
  }

  // =========================================================================
  // REDIS HELPERS
  // =========================================================================
  async redisGet(key) {
    return new Promise((resolve, reject) => {
      this.redisClient.get(key, (err, value) => {
        if (err) reject(err);
        else resolve(value);
      });
    });
  }

  async redisSet(key, value, expireSeconds) {
    return new Promise((resolve, reject) => {
      this.redisClient.setex(key, expireSeconds, value, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // =========================================================================
  // LIMPIEZA
  // =========================================================================
  async cleanup() {
    console.log('[*] Limpiando conexiones...');
    if (this.pgPool) await this.pgPool.end();
    if (this.redisClient) this.redisClient.quit();
    console.log('[✓] Limpieza completada');
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log(`
════════════════════════════════════════════════════════════════
  FRIGATE ALERTS v1.1.0
  Vera Adaria | Polling mode
════════════════════════════════════════════════════════════════
  `);

  const alerter = new FrigateAlerter();

  // Manejo de señales
  process.on('SIGINT', async () => {
    console.log('\n[*] Recibido SIGINT, limpiando...');
    await alerter.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[*] Recibido SIGTERM, limpiando...');
    await alerter.cleanup();
    process.exit(0);
  });

  try {
    await alerter.init();
    console.log('\n[✓] Sistema operativo');
  } catch (error) {
    console.error('[✗] Error fatal:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { FrigateAlerter };
