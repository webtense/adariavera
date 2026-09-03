# Frigate NVR - Vera Adaria
**v1.1.0 | 2026-09-01 | Sistema de Vigilancia Inteligente**

---

## 📋 Descripción General

Frigate es un **NVR (Network Video Recorder) de código abierto** que proporciona:

- ✅ **Detección inteligente** de objetos (YOLO v8)
- ✅ **Grabación on-demand** (solo cuando hay eventos)
- ✅ **Pre/post buffer** (10 min antes + evento + 10 min después)
- ✅ **Almacenamiento optimizado** (máx 100GB, 30 eventos)
- ✅ **Integración de alertas** (WhatsApp, email)
- ✅ **Dashboard web** completo
- ✅ **API REST** para consultas

**6 Cámaras Tapo C210** en Vera Adaria:
1. Recepción
2. Parking
3. Entrada Principal
4. Servicio (zona restringida)
5. Trasera
6. Lateral

---

## 🚀 Inicio Rápido

### Requisitos Previos

```bash
# Sistema
- Linux (Proxmox, Ubuntu 22.04+)
- Docker + docker-compose
- 2+ cores CPU
- 2GB RAM mínimo
- 100GB almacenamiento (SSD recomendado)
- 192.168.x.x red local

# Permisos
- sudo acceso
- Puertos: 5000 (Frigate), 5432 (PostgreSQL), 6379 (Redis)
```

### Instalación Automática

```bash
# 1. Clonar configuración
cd /opt/frigate
git clone <repo> .

# 2. Ejecutar setup
bash frigate-setup.sh

# 3. Ver estado
docker-compose ps
docker-compose logs -f frigate
```

### Instalación Manual

```bash
# 1. Crear directorios
sudo mkdir -p /media/frigate/{recordings,clips,snapshots,models,postgres,redis}
sudo chmod 755 /media/frigate

# 2. Descargar archivos
# Copiar: frigate.yml, schema-frigate.sql, docker-compose.yml, etc

# 3. Generar contraseña PostgreSQL
echo "export POSTGRES_PASSWORD=$(openssl rand -base64 24)" >> .env

# 4. Iniciar servicios
docker-compose up -d

# 5. Verificar
curl http://localhost:5000/api/version
```

---

## 📁 Estructura de Archivos

```
frigate/
├── frigate.yml                 # Configuración principal
├── schema-frigate.sql          # Esquema PostgreSQL
├── docker-compose.yml          # Orquestación servicios
├── frigate-setup.sh            # Instalación automática
├── alerts-frigate.js           # Script alertas
├── alerts-frigate-config.json  # Config alertas
├── frigate-dashboard.html      # Dashboard web
├── frigate-calibration.md      # Guía calibración
├── README-FRIGATE.md           # Este archivo
└── .env                        # Credenciales (NO comitear)
```

---

## 🔧 Configuración

### 1. Frigate.yml (Configuración Principal)

```yaml
# Especificar IPs reales de cámaras:
cameras:
  recepcion:
    ffmpeg:
      inputs:
        - path: rtsp://admin:password@192.168.1.11:554/stream1

  parking:
    ffmpeg:
      inputs:
        - path: rtsp://admin:password@192.168.1.12:554/stream1

  # ... resto de cámaras
```

**Cambios comunes:**
- Cambiar `admin/password` por credenciales reales
- Ajustar resolución si necesario
- Modificar `detect.fps` según CPU disponible
- Personalizar zonas de interés por cámara

Ver **frigate-calibration.md** para tuning completo.

### 2. Docker-compose.yml (Orquestación)

Servicios:
1. **frigate** (5000): API REST + streaming
2. **postgres** (5432): Histórico eventos
3. **redis** (6379): Cache + anti-spam
4. **frigate-alerts**: Polling eventos

**Variables de entorno:**
```bash
POSTGRES_PASSWORD=<contraseña segura>
FRIGATE_API_URL=http://127.0.0.1:5000
REDIS_HOST=redis
```

### 3. Schema PostgreSQL

Crea tablas automáticamente:
- `frigate_events`: Histórico eventos
- `frigate_cameras`: Config por cámara
- `frigate_zones`: Zonas de interés
- `frigate_alert_log`: Log de alertas enviadas

---

## 🎥 Acceso y Dashboard

### Frigate Web UI

```
URL: http://localhost:5000/
Usuarios: Sin autenticación (añadir en producción)
```

**Funcionalidades:**
- Feed en vivo de 6 cámaras
- Últimos 10 eventos
- Snapshots con confianza
- Timeline de eventos
- Estadísticas por cámara

### API REST

```bash
# Ver versión
curl http://localhost:5000/api/version

# Listar cámaras
curl http://localhost:5000/api/cameras

# Eventos últimas 2h
curl http://localhost:5000/api/events?limit=50

# Estadísticas
curl http://localhost:5000/api/stats
```

### PostgreSQL Consultas

```bash
# Conectar
docker-compose exec postgres psql -U frigate -d vera_adaria

# Ver eventos recientes
SELECT camera_name, object_class, confidence, start_time
FROM frigate_events
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY start_time DESC LIMIT 10;

# Estadísticas 24h
SELECT * FROM v_frigate_stats_24h;

# Eventos sin clip
SELECT COUNT(*) FROM frigate_events WHERE has_clip = false AND created_at > NOW() - INTERVAL '7 days';
```

---

## 🔔 Alertas

### Integración WhatsApp

**Flujo:**
1. Frigate detecta evento
2. `alerts-frigate.js` consulta API REST
3. Guarda en PostgreSQL
4. Envía webhook a `http://localhost:3000/api/alert/frigate`
5. Watchdog alerter reenvía a WhatsApp

**Iniciar alerter:**
```bash
# En docker-compose (automático)
docker-compose logs -f frigate-alerts

# O manualmente
node alerts-frigate.js
```

**Configurar webhook:**
Editar `alerts-frigate-config.json`:
```json
{
  "alerts": {
    "whatsapp": {
      "enabled": true,
      "anti_spam_window": 120
    }
  },
  "zones": {
    "parking": {
      "alert_level": "warning",
      "objects": ["car"]
    }
  }
}
```

**Anti-spam:**
- Máx 1 alerta cada 2 minutos por cámara/objeto
- Confianza mínima 0.6 (60%)
- Se almacena en Redis

### Tipos de Alertas

| Zona | Objeto | Nivel | Acción |
|------|--------|-------|--------|
| parking | car | ⚠️ warning | WhatsApp a guardián |
| entrada | person | ℹ️ info | Silenciado (mucho tráfico) |
| zona_restringida | person | 🔴 critical | WhatsApp + email |
| trasera | person | 🔴 critical | WhatsApp + email |

---

## 📊 Almacenamiento

### Cálculo de Espacio

```
Por evento:
- Duración: 20 min (10 min pre + evento + 10 min post)
- Bitrate: 1.5 Mbps (reducido)
- Tamaño: 20min × 1.5Mbps = 225 MB/evento

Por cámara (30 eventos máx):
- 30 eventos × 225 MB = 6.75 GB

Total (6 cámaras):
- 6.75 GB × 6 = 40.5 GB

Realista: 50-100 GB/mes con 10 eventos/día por cámara
```

### Gestión Automática

```bash
# Limpiar eventos >30 días sin video
docker-compose exec postgres psql -U frigate -d vera_adaria \
  -c "SELECT frigate_cleanup_old_events();"

# Ver límite de almacenamiento
df -h /media/frigate/

# Configurar en frigate.yml
record:
  retain:
    motions: 30    # Máx 30 eventos de movimiento
    objects: 30    # Máx 30 eventos de objetos
```

### SSD vs HDD

```
Recomendación:
- Grabaciones: SSD (mejor performance)
- PostgreSQL:  SSD (escrituras frecuentes)
- Backups:     HDD (bajo costo)

Mínimo: SSD 100GB
```

---

## 🐛 Troubleshooting

### Frigate no inicia

```bash
# Ver logs
docker-compose logs frigate

# Errores comunes:

# 1. "Address already in use :5000"
docker-compose down
docker system prune -f
docker-compose up -d

# 2. "Connection refused to 192.168.1.11:554"
# → Verificar IP y RTSP de cámara
ffmpeg -rtsp_transport tcp -i rtsp://admin:password@192.168.1.11:554/stream1 -t 5 -f null -

# 3. "Out of memory"
# → Aumentar shm_size en docker-compose.yml
shm_size: '512mb'  # De 256mb
```

### Cámara desconectada

```bash
# Test RTSP
ffmpeg -rtsp_transport tcp -i rtsp://admin:password@192.168.1.11:554/stream1 -t 10 -f null -

# Si falla:
1. Ping a cámara: ping 192.168.1.11
2. Reiniciar cámara (desconectar 30s)
3. Verificar credenciales en App Tapo
4. Verificar que puerto 554 no está bloqueado
```

### Almacenamiento lleno

```bash
# Ver uso
df -h /media/frigate/

# Limpiar
docker-compose exec postgres psql -U frigate -d vera_adaria << 'EOF'
DELETE FROM frigate_events 
WHERE created_at < NOW() - INTERVAL '30 days' 
  AND has_clip = false;
EOF

# Reducir retención
# Editar frigate.yml:
record:
  retain:
    motions: 20  # De 30
```

### Alertas no llegan

```bash
# 1. Ver logs de alerter
docker-compose logs frigate-alerts

# 2. Verificar webhook
curl -X POST http://localhost:3000/api/alert/frigate \
  -H "Content-Type: application/json" \
  -d '{"test":"alert"}'

# 3. Verificar Redis
docker-compose exec redis redis-cli ping

# 4. Verificar PostgreSQL
docker-compose exec postgres psql -U frigate -d vera_adaria \
  -c "SELECT COUNT(*) FROM frigate_events WHERE alert_sent = true;"
```

### CPU/Memoria alta

```bash
# Ver recursos
docker stats

# Reducir:
1. Bajar detect.fps: 5 → 2
2. Cambiar modelo: yolov8s → yolov8n
3. Reducir input_size: 320 → 256
4. Desactivar motion en cámaras inactivas
```

---

## 📚 Archivos Complementarios

| Archivo | Función |
|---------|---------|
| **frigate-calibration.md** | Guía completa de calibración por cámara |
| **alerts-frigate.js** | Script polling eventos + alertas |
| **frigate-dashboard.html** | Dashboard web (opcional, complementa Frigate UI) |
| **schema-frigate.sql** | Esquema PostgreSQL + vistas + funciones |

---

## 🔒 Seguridad

### Antes de Producción

1. **Cambiar credenciales:**
   ```bash
   # Editar frigate.yml
   ffmpeg:
     password: "NuevaContraseña123!"
   
   # Editar docker-compose.yml
   POSTGRES_PASSWORD=PgSecure123!
   REDIS_PASSWORD=RedisSecure123!
   ```

2. **Habilitar autenticación en Frigate:**
   ```yaml
   # frigate.yml (cuando sea soportado)
   auth:
     enabled: true
     users:
       - username: admin
         password: $2b$12$...  # bcrypt hash
   ```

3. **Firewall:**
   ```bash
   # Solo localhost
   sudo ufw allow from 127.0.0.1 to any port 5000

   # O específica
   sudo ufw allow from 192.168.1.0/24 to any port 5000
   ```

4. **TLS/HTTPS:**
   - Usar nginx/traefik proxy con certificados Let's Encrypt
   - No exponer Frigate directamente a internet

5. **Credenciales cámaras:**
   - NO comitear frigate.yml con contraseñas
   - Usar `.env` o secrets de Docker

---

## 🚀 Deployment

### En Proxmox/LXC

```bash
# 1. Container Ubuntu 22.04
# 2. Instalar Docker
curl -fsSL https://get.docker.com | sh

# 3. Clonar repo
git clone <repo> /opt/frigate

# 4. Ejecutar setup
cd /opt/frigate
bash frigate-setup.sh

# 5. Systemd service (opcional)
sudo systemctl enable docker
sudo tee /etc/systemd/system/frigate.service > /dev/null << 'EOF'
[Unit]
Description=Frigate NVR
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/frigate
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable frigate
sudo systemctl start frigate
```

### Backups

```bash
# Backup eventos (PostgreSQL)
docker-compose exec postgres pg_dump -U frigate vera_adaria \
  | gzip > backup-$(date +%Y%m%d).sql.gz

# Backup de videos
rsync -av /media/frigate/ /backup/frigate/

# Script cron (diario)
0 3 * * * /opt/frigate/backup.sh
```

---

## 📞 Soporte

- **Frigate Docs:** https://docs.frigatenvr.org/
- **GitHub Issues:** https://github.com/blakeblackshear/frigate/issues
- **Slack Community:** https://join.slack.com/t/frigate-nvr/shared_invite/...

---

## 📝 Changelog

### v1.1.0 (2026-09-01)
- ✅ Soporte 6 cámaras Tapo C210
- ✅ Detección YOLO v8 (person, car, dog, cat)
- ✅ Grabación inteligente (pre/post buffer)
- ✅ Integración PostgreSQL + Redis
- ✅ Script alertas + anti-spam
- ✅ Dashboard web
- ✅ Documentación completa

---

**Última actualización:** 2026-09-01 | v1.1.0  
**Autor:** Vera Adaria Infrastructure Team  
**Licencia:** MIT
