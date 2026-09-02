# Vera Adaria Health Checker v1.1.0

Sistema centralizado de monitoreo para todos los servicios de Vera Adaria. Ejecuta health checks cada 30 segundos, gestiona alertas WhatsApp y proporciona dashboard en tiempo real.

## 🚀 Inicio Rápido

### Requisitos
- Node.js 16+
- PostgreSQL 12+
- npm o yarn

### 1. Instalación

```bash
# Clonar o descargar archivos
mkdir -p /opt/vera-monitor
cd /opt/vera-monitor

# Copiar todos los archivos:
cp watchdog-service.js alerter.js health-endpoints.js .
cp services-monitor.config.json .
cp monitor-dashboard.html .
cp schema-monitoring.sql .

# Instalar dependencias
npm init -y
npm install express axios pg dotenv
```

### 2. Configurar Base de Datos

```bash
# Conectarse a PostgreSQL como superuser
psql -U postgres

# Ejecutar script de esquema
\c vera_monitoring
\i schema-monitoring.sql

# Verificar tablas
\dt
```

### 3. Configurar Variables de Entorno

```bash
# Crear .env
cat > .env << 'EOF'
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=vera_monitor
DB_PASSWORD=secure_password_here
DB_NAME=vera_monitoring

# Twilio (si usas alertas WhatsApp)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=auth_token_here
TWILIO_PHONE_NUMBER=+34634567890

# n8n (alternativa a Twilio)
N8N_WEBHOOK_URL=http://localhost:5678/webhook/vera-alerts

# Server
PORT=3100
NODE_ENV=production
EOF

chmod 600 .env
```

### 4. Configurar Servicios

Editar `services-monitor.config.json` para definir tus servicios:

```json
{
  "services": [
    {
      "name": "Welcome Check-in",
      "url": "http://localhost:3093",
      "healthEndpoint": "/health",
      "timeout": 3000,
      "alertNumber": "+34630219712"
    },
    // ... más servicios
  ]
}
```

### 5. Iniciar Watchdog

```bash
# En producción (con PM2)
npm install -g pm2
pm2 start watchdog-service.js --name vera-monitor --instances 1

# O directamente
node watchdog-service.js
```

El watchdog escuchará en `http://localhost:3100`

### 6. Acceder al Dashboard

Abrir en navegador:
```
file:///opt/vera-monitor/monitor-dashboard.html
```

O servir por HTTP:
```bash
npm install -g http-server
http-server -p 8000
# Visitar http://localhost:8000/monitor-dashboard.html
```

---

## 📋 Integrar Health Endpoints en Servicios Existentes

### Express.js

```javascript
const express = require('express');
const { setupHealthEndpoints } = require('./health-endpoints');
const pool = require('./db'); // Tu pool PostgreSQL

const app = express();

// Registrar endpoints /health y /metrics
setupHealthEndpoints(app, {
  db: pool,
  serviceName: 'Welcome Check-in',
  version: '1.0.0',
});

app.get('/', (req, res) => res.send('OK'));

app.listen(3093, () => console.log('Welcome Check-in on :3093'));
```

### Next.js

Crear `pages/api/health.js`:

```javascript
import { healthHandler } from '../../health-endpoints';
import pool from '../../db';

export default healthHandler({
  serviceName: 'Welcome Check-in',
  db: pool,
});
```

---

## 🔧 Configuración Avanzada

### Anti-spam de Alertas

Configurar ventana de tiempo (milisegundos):

```json
{
  "alertConfig": {
    "antiSpamWindow": 300000,        // 5 minutos
    "maxAlertsPerService": 3,        // máximo 3 alertas por servicio
    "escalationEnabled": false       // alertas escalonadas a otros números
  }
}
```

### Providers de Alertas

#### Twilio (recomendado)

```json
{
  "whatsapp": {
    "enabled": true,
    "provider": "twilio",
    "accountSid": "${TWILIO_ACCOUNT_SID}",
    "authToken": "${TWILIO_AUTH_TOKEN}",
    "fromNumber": "+34634567890"
  }
}
```

#### n8n Local

```json
{
  "whatsapp": {
    "enabled": true,
    "provider": "n8n",
    "webhookUrl": "http://localhost:5678/webhook/vera-alerts"
  }
}
```

### Métricas Personalizadas

En `services-monitor.config.json`:

```json
{
  "services": [
    {
      "name": "Welcome Check-in",
      "url": "http://localhost:3093",
      "timeout": 3000,
      "criticalThreshold": 2,  // alertar después de 2 fallos consecutivos
      "alertChannels": ["whatsapp", "slack"],
      "alertNumber": "+34630219712"
    }
  ]
}
```

---

## 📊 APIs Disponibles

### GET /services/status

Retorna estado de todos los servicios:

```json
{
  "timestamp": "2026-09-02T14:35:00Z",
  "healthOverall": "DEGRADED",
  "services": [
    {
      "name": "Welcome Check-in",
      "status": "online",
      "uptime": "99.8%",
      "errorRate": "0.2%",
      "responseTime": "145ms",
      "lastCheck": "2026-09-02T14:35:00Z"
    }
  ]
}
```

### GET /metrics

Métricas agregadas:

```json
{
  "timestamp": "2026-09-02T14:35:00Z",
  "summary": {
    "totalServices": 9,
    "online": 8,
    "offline": 1,
    "avgResponseTime": "256ms"
  }
}
```

### GET /health

Health del watchdog en sí:

```json
{
  "service": "watchdog",
  "status": "online",
  "uptime": "3600s"
}
```

---

## 🗄️ Esquema de Base de Datos

### `service_health_log`
Histórico de checks (30 días):
- `service_name`, `status`, `response_time`, `error_code`, `timestamp`

### `service_status`
Estado actual de cada servicio:
- `service_name`, `current_status`, `last_check`, `uptime_percentage`, `error_rate`

### `alert_history`
Log de alertas WhatsApp enviadas:
- `service_name`, `alert_type`, `alert_number`, `status`, `sent_at`

### `incidents`
Incidentes abiertos/resueltos:
- `service_name`, `status`, `start_time`, `end_time`, `root_cause`

---

## 🚨 Rollback a v1.0.0

Si necesitas volver atrás:

```bash
# Guardar config actual
cp services-monitor.config.json services-monitor.config.json.backup

# Restaurar versión anterior
git revert HEAD --no-edit

# O simplemente:
git checkout v1.0.0

# Reiniciar
pm2 restart vera-monitor
```

---

## 📈 Métricas Clave

### Uptime %
```
(Total checks - Checks fallidos) / Total checks * 100
```

### Error Rate %
```
Checks fallidos / Total checks * 100
```

### Response Time (P95/P99)
Percentil 95 y 99 de latencias

### Throughput
```
Requests / minuto
```

---

## 🔔 Manejo de Alertas

### Cuándo se envía alerta
1. **Service Down**: Cuando un servicio pasa de "online" → "offline"
2. **Service Recovered**: Cuando vuelve de "offline" → "online"
3. **High Error Rate**: Cuando error rate > 50% (configurable)
4. **Timeout**: Cuando latencia > timeout configurado

### Anti-spam
- Máximo 1 alerta por servicio cada 5 minutos
- Se resetea el contador cuando el servicio se recupera
- Se pueden ignorar alertas en mantenimiento (futuro)

### Formato de alerta

```
⚠️ SERVICIO CAÍDO: Welcome Check-in
Última respuesta: 02/09/2026 14:35
Error: TIMEOUT (>3000ms)
```

---

## 🐛 Troubleshooting

### No se envían alertas WhatsApp
- ✓ Verificar `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN` en `.env`
- ✓ Verificar que `whatsapp.enabled: true` en config
- ✓ Revisar logs: `pm2 logs vera-monitor`

### Services muestran "unknown" siempre
- ✓ Verificar que cada servicio expongas `/health` endpoint
- ✓ Verificar URLs en `services-monitor.config.json`
- ✓ Verificar firewall/conectividad: `curl http://localhost:3093/health`

### Base de datos llena
- ✓ Se ejecuta cleanup automático cada 24h
- ✓ Ejecutar manualmente: `SELECT cleanup_old_logs();`

### Dashboard no se actualiza
- ✓ Verificar CORS: watchdog debe estar en mismo origen o con CORS habilitado
- ✓ Verificar console del navegador (F12)

---

## 📊 Monitoreo de Producción

### PM2
```bash
# Ver logs en vivo
pm2 logs vera-monitor

# Ver métrica de salud
pm2 monit

# Guardar proceso
pm2 save
pm2 startup
```

### Metrics diarias
```sql
SELECT * FROM service_metrics 
WHERE date_day = CURRENT_DATE
ORDER BY service_name;
```

### Últimos incidentes
```sql
SELECT * FROM v_recent_incidents
WHERE status = 'open'
ORDER BY start_time DESC;
```

---

## 🔐 Seguridad

- Usar `.env` para credenciales (NO commitear)
- Base de datos con usuario `vera_monitor` (sin permisos DDL)
- Watchdog en red interna (no exponer a Internet sin auth)
- Rate-limiting en dashboard si es público
- Encriptar contraseñas en `service_status` (futuro)

---

## 🗂️ Estructura de Archivos

```
/opt/vera-monitor/
├── watchdog-service.js          # Servicio principal (140 líneas)
├── alerter.js                   # Gestor de alertas WhatsApp
├── health-endpoints.js          # Middleware/handler para servicios
├── services-monitor.config.json # Configuración de servicios
├── schema-monitoring.sql        # Esquema PostgreSQL
├── monitor-dashboard.html       # UI dashboard (HTML + JS)
├── README-MONITORING.md         # Este archivo
├── .env                         # Variables de entorno (NO commitear)
├── .env.example                 # Template
└── logs/                        # PM2 logs
```

---

## 🚀 Roadmap v1.1.0 → v1.2.0

- [ ] Alert history en DB (no solo memoria)
- [ ] Slack integration
- [ ] PagerDuty integration
- [ ] Incident tracking automático
- [ ] Gráficas de tendencia (Chart.js)
- [ ] Autenticación en dashboard
- [ ] SLA reporting
- [ ] Custom rules (e.g., "alert solo si 2+ servicios down")

---

## 📞 Soporte

Para problemas:
1. Revisar logs: `pm2 logs vera-monitor`
2. Verificar conexión DB: `psql -U vera_monitor -d vera_monitoring -c "SELECT 1"`
3. Verificar endpoints: `curl http://localhost:3100/health`
4. Contactar con Andrés Sánchez (asanchez@viajesparati.com)

---

**v1.1.0** — 02/09/2026 — Vera Adaria Health Checker
