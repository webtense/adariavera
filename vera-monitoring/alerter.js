/**
 * Vera Adaria v1.1.0 — AlertService (WhatsApp)
 *
 * Maneja envío de alertas WhatsApp con anti-spam y logging
 *
 * Providers soportados:
 *   - twilio: Usa Twilio API
 *   - n8n: Usa n8n local webhook
 */

const axios = require('axios');

class Alerter {
  constructor(config) {
    this.config = config;
    this.provider = config.provider || 'twilio';
    this.sentAlerts = {}; // Tracking de alertas enviadas
  }

  /**
   * Enviar alerta WhatsApp
   * @param {string} phoneNumber — Número destino (+34 630 219 712)
   * @param {string} message — Texto del mensaje
   */
  async send(phoneNumber, message) {
    if (!this.config.enabled) {
      console.log('[ALERTER] WhatsApp deshabilitado, skipping:', message);
      return;
    }

    try {
      switch (this.provider) {
        case 'twilio':
          return await this.sendViaTwilio(phoneNumber, message);
        case 'n8n':
          return await this.sendViaN8N(phoneNumber, message);
        default:
          console.warn(`[ALERTER] Provider no soportado: ${this.provider}`);
      }
    } catch (error) {
      console.error('[ALERTER ERROR]:', error.message);
      throw error;
    }
  }

  /**
   * Twilio API
   */
  async sendViaTwilio(phoneNumber, message) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

    const auth = Buffer.from(
      `${this.config.accountSid}:${this.config.authToken}`
    ).toString('base64');

    try {
      const response = await axios.post(
        url,
        new URLSearchParams({
          From: `whatsapp:${this.config.fromNumber}`,
          To: `whatsapp:${phoneNumber}`,
          Body: message,
        }),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      console.log(`[TWILIO] Alert enviada a ${phoneNumber} (SID: ${response.data.sid})`);
      this.logAlertSent(phoneNumber, message, 'twilio', response.data.sid);
      return response.data;
    } catch (error) {
      console.error(`[TWILIO ERROR] ${phoneNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * n8n webhook (para envío local sin provider externo)
   */
  async sendViaN8N(phoneNumber, message) {
    const webhookUrl = this.config.webhookUrl || 'http://localhost:5678/webhook/vera-alerts';

    try {
      const response = await axios.post(webhookUrl, {
        phoneNumber,
        message,
        timestamp: new Date().toISOString(),
        service: 'vera-adaria-watchdog',
      });

      console.log(`[N8N] Alert enviada a ${phoneNumber}`);
      this.logAlertSent(phoneNumber, message, 'n8n', response.data.messageId || 'N/A');
      return response.data;
    } catch (error) {
      console.error(`[N8N ERROR] ${phoneNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Logging de alertas (en memoria para v1.1.0; v1.2.0 → DB)
   */
  logAlertSent(phoneNumber, message, provider, externalId) {
    const key = `${phoneNumber}:${Date.now()}`;
    this.sentAlerts[key] = {
      phoneNumber,
      message: message.substring(0, 100), // Primeros 100 chars
      provider,
      externalId,
      timestamp: new Date().toISOString(),
    };

    // Limpiar historial >7 días
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(this.sentAlerts).forEach(k => {
      const timestamp = parseInt(k.split(':')[1]);
      if (timestamp < sevenDaysAgo) {
        delete this.sentAlerts[k];
      }
    });
  }

  /**
   * Obtener historial de alertas enviadas
   */
  getAlertHistory(phoneNumber = null) {
    if (!phoneNumber) {
      return Object.values(this.sentAlerts);
    }
    return Object.values(this.sentAlerts).filter(a => a.phoneNumber === phoneNumber);
  }

  /**
   * Verificar si alerta ya fue enviada (para anti-spam)
   * @returns {boolean} true si fue enviada en los últimos X minutos
   */
  wasRecentlySent(phoneNumber, minutesWindow = 5) {
    const recentAlerts = this.getAlertHistory(phoneNumber)
      .filter(a => {
        const diff = Date.now() - new Date(a.timestamp).getTime();
        return diff < minutesWindow * 60 * 1000;
      });
    return recentAlerts.length > 0;
  }
}

module.exports = Alerter;
