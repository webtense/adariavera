# Frigate NVR - Guía de Calibración
**v1.1.0 | Vera Adaria | 2026-09-01**

---

## Tabla de Contenidos
1. [Introducción](#introducción)
2. [Acceso a Cámaras](#acceso-a-cámaras)
3. [Configuración por Cámara](#configuración-por-cámara)
4. [Tuning de Detección](#tuning-de-detección)
5. [Zonas de Interés](#zonas-de-interés)
6. [Troubleshooting](#troubleshooting)

---

## Introducción

Esta guía explica cómo calibrar y optimizar las **6 cámaras Tapo C210** en Frigate para obtener detecciones precisas sin falsas alarmas.

**Especificaciones Tapo C210:**
- Resolución: 2560x1440 (4K)
- FPS nativo: 30
- RTSP: `rtsp://admin:password@{IP}:554/stream1`
- Lens: 103° FOV

**Reducción de carga CPU:**
- Detectar a 5 FPS (vs nativo 30 FPS)
- Grabar reducido a 1920x1080
- Bitrate de grabación: 1.5 Mbps

---

## Acceso a Cámaras

### Encontrar IPs de Cámaras

1. **Método 1: Router**
   ```bash
   # Ver dispositivos conectados
   arp-scan -l
   # Buscar dispositivos Tapo
   ```

2. **Método 2: Tapo App**
   - Abrir app Tapo
   - Settings > About
   - Ver IP en red local

3. **Método 3: Predicción**
   ```
   Recepción:       192.168.1.11
   Parking:         192.168.1.12
   Entrada Ppal:    192.168.1.13
   Servicio:        192.168.1.14
   Trasera:         192.168.1.15
   Lateral:         192.168.1.16
   ```

### Verificar Acceso RTSP

```bash
# Test stream
ffmpeg -rtsp_transport tcp -i rtsp://admin:password@192.168.1.11:554/stream1 -t 5 -f null -

# O con VLC
vlc rtsp://admin:password@192.168.1.11:554/stream1
```

---

## Configuración por Cámara

### 1. RECEPCIÓN (192.168.1.11)

**Ubicación:** Entrada hall principal

**Zona de Interés:**
- Entrada puertas automáticas
- Detector: personas entrando/saliendo

**Parámetros:**
```yaml
detect:
  fps: 5
  objects:
    - person       # Objetivo principal
motion:
  contour_area: 10 # Sensible a movimiento
zones:
  entrada:
    coordinates: 0,0,100,100,100,500,0,500
```

**Tuning:**
- ✅ Si se pierden personas: ↓ `min_area` a 200
- ❌ Si hay falsas alarmas (reflejos): ↑ `min_area` a 800
- ✅ Si sombras generan alertas: ↑ `contour_area` a 20

---

### 2. PARKING (192.168.1.12)

**Ubicación:** Zona de aparcamiento

**Zona de Interés:**
- Vehículos entrando/saliendo
- Detector: coches, motos

**Parámetros:**
```yaml
detect:
  fps: 5
  objects:
    - car          # Objetivo principal
    - person       # Secundario
motion:
  contour_area: 15 # Menos sensible (muchos cambios de luz)
zones:
  parking:
    coordinates: 0,0,200,100,200,500,0,500
```

**Tuning:**
- ✅ Si se pierden autos pequeños: ↓ `min_area` a 500
- ❌ Si falsa alerta en cambios de sombra: ↑ `contour_area` a 25
- ✅ Si persona pasa cerca de auto sin alertar: ↓ person `min_area` a 300

---

### 3. ENTRADA PRINCIPAL (192.168.1.13)

**Ubicación:** Puerta principal acceso

**Zona de Interés:**
- Personas franqueando puerta
- Detector: personas

**Parámetros:**
```yaml
detect:
  fps: 5
  objects:
    - person
motion:
  contour_area: 10
zones:
  puerta:
    coordinates: 100,200,300,200,300,400,100,400
```

**Tuning:**
- ✅ Zona pequeña → usar coordenadas precisas
- ❌ Si falsa alerta en cristal: añadir zona "cristal" con objetos vacío
- ✅ Si se pierden personas rápidas: ↓ `detection_fps` del polling

---

### 4. SERVICIO (192.168.1.14)

**Ubicación:** Zona de servicios (cocina, mantenimiento)

**Zona de Interés:**
- Acceso personal autorizado
- Detector: personas, animales (detectar intrusiones)

**Parámetros:**
```yaml
detect:
  fps: 5
  objects:
    - person
    - dog
    - cat
motion:
  contour_area: 5     # Sensible (área restringida)
zones:
  zona_restringida:
    coordinates: 0,0,500,0,500,400,0,400
```

**Tuning:**
- ⚠️ CRÍTICA - Usar `min_area` pequeño para detectar cualquier cosa
- ✅ Si se pierden niños pequeños: ↓ `min_area` a 50
- ❌ Si alerta con insectos: ↑ `min_area` a 500

---

### 5. TRASERA (192.168.1.15)

**Ubicación:** Zona trasera/salida emergencia

**Zona de Interés:**
- Vigilancia perimetral
- Detector: personas, vehículos

**Parámetros:**
```yaml
detect:
  fps: 5
  objects:
    - person
    - car
    - dog
motion:
  contour_area: 20    # Menos sensible (luz variable)
zones:
  trasera:
    coordinates: 0,0,500,0,500,400,0,400
```

**Tuning:**
- ✅ Zona amplia → detectar movimiento perimetral
- ❌ Si viento mueve ramas: ↑ `motion.contour_area` a 30
- ✅ Si lluvia genera falsas alarmas: ↑ `min_area` a 1000

---

### 6. LATERAL (192.168.1.16)

**Ubicación:** Lado del edificio

**Zona de Interés:**
- Acceso lateral
- Detector: personas, vehículos

**Parámetros:**
```yaml
detect:
  fps: 5
  objects:
    - person
    - car
motion:
  contour_area: 15
zones:
  lateral:
    coordinates: 0,0,400,0,400,500,0,500
```

**Tuning:**
- Similar a TRASERA
- ✅ Si se pierden vehículos lejanos: ↓ `confidence` a 0.5
- ❌ Si falsas alarmas de sombras: ↑ `motion.contour_area` a 25

---

## Tuning de Detección

### Parámetros Clave

| Parámetro | Efecto | Rango | Recomendado |
|-----------|--------|-------|-------------|
| `detect.fps` | Cuán a menudo analizar | 1-30 | 5 (CPU efficient) |
| `objects.min_area` | Tamaño mínimo del objeto | 0-100000 | 500 |
| `objects.threshold` | Confianza mínima | 0-1 | 0.6-0.7 |
| `motion.contour_area` | Cambio de píxeles minimo | 0-1000 | 10-20 |
| `motion.frame_alpha` | Suavizado de frames | 0-1 | 0.005 |

### Troubleshooting Detección

**Problema: Muchas falsas alarmas**
```yaml
# Opciones (en orden de menos a más severa):
1. ↑ contour_area: 20 → 30
2. ↑ min_area: 500 → 1000
3. ↑ threshold: 0.6 → 0.75
4. ↓ detect.fps: 5 → 2
```

**Problema: Se pierden objetos verdaderos**
```yaml
# Opciones (en orden de menos a más agresiva):
1. ↓ min_area: 500 → 200
2. ↓ threshold: 0.7 → 0.5
3. ↑ detect.fps: 5 → 10
4. ↑ max_disappeared: 5 → 10
```

**Problema: Mucha latencia de detección**
```yaml
# Opciones:
1. ↑ detect.fps: 5 → 10
2. ↓ model input_size: 320 → 256 (más rápido)
3. Usar YOLOv8n en vez de v8s (más pequeño)
```

---

## Zonas de Interés

### Cómo Dibujar Zonas

En `frigate.yml`, cada zona es un polígono definido por coordenadas (x,y):

```yaml
zones:
  entrada:
    coordinates: 0,0,    # Top-left
                 100,0,   # Top-right
                 100,500, # Bottom-right
                 0,500    # Bottom-left
    objects:
      - person
```

**Visualizar zonas:**
1. Abrir Frigate dashboard en `http://localhost:5000/`
2. Ir a cada cámara
3. Activar "Show Zones" (si disponible)
4. Ajustar coordenadas en frigate.yml
5. Recargar

### Ejemplo: Zona de Entrada + Zona de Ignorar

```yaml
cameras:
  recepcion:
    zones:
      entrada:
        coordinates: 100,200,400,200,400,450,100,450
        objects:
          - person
      cristal:                    # Ignorar cristal (sin objetos)
        coordinates: 0,0,100,100,100,200,0,200
        objects: []               # Vacío = ignorar
```

---

## Troubleshooting

### Frigate no inicia

```bash
# Ver logs
docker-compose logs frigate

# Errores comunes:
# - "Address already in use" → Puerto 5000 ocupado
#   Solución: docker-compose down && docker-compose up -d

# - "No NVIDIA GPU found" → Normal si no hay GPU
#   CPU detection funciona igual

# - "RTSP connection refused" → IP de cámara incorrecta
#   Solución: Verificar con ffmpeg
```

### Cámara desconectada

```bash
# Test RTSP stream
ffmpeg -rtsp_transport tcp \
  -i rtsp://admin:password@192.168.1.11:554/stream1 \
  -t 10 -f null -

# Si falla:
# 1. Verificar IP (ping 192.168.1.11)
# 2. Verificar credenciales (default: admin/password)
# 3. Reiniciar cámara (desconectar 30s)
```

### Almacenamiento lleno

```bash
# Ver uso
df -h /media/frigate

# Limpiar eventos antiguos
docker-compose exec postgres psql -U frigate -d vera_adaria \
  -c "DELETE FROM frigate_events WHERE created_at < NOW() - INTERVAL '30 days' AND has_clip = false;"

# Limitar nuevos eventos
# Editar frigate.yml: record.retain.motions: 20 (reducir de 30)
```

### Alertas no llegan

```bash
# Verificar logs de alerter
docker logs frigate-alerts

# Probar webhook manualmente
curl -X POST http://localhost:3000/api/alert/frigate \
  -H "Content-Type: application/json" \
  -d '{
    "alert_type": "frigate_detection",
    "camera": "recepcion",
    "object": "person",
    "confidence": "85%",
    "timestamp": "2026-09-01T10:00:00Z"
  }'
```

### CPU / Memoria alta

```bash
# Ver recursos
docker stats frigate

# Reducir:
1. ↓ detect.fps: 5 → 2
2. Cambiar modelo: yolov8s → yolov8n (nano)
3. ↓ input_size: 320 → 256
4. Desactivar motion en cámaras con pocos eventos
```

---

## Próximos Pasos

1. ✅ Instalar Frigate (`frigate-setup.sh`)
2. ✅ Calibrar cada cámara (esta guía)
3. ✅ Configurar alertas (`alerts-frigate.js`)
4. ✅ Integrar con watchdog (webhook `/api/alert/frigate`)
5. ✅ Verificar almacenamiento y limpiezas automáticas
6. ✅ Monitorear dashboard 24-48h para ajustes finales

---

## Referencias

- **Frigate Docs:** https://docs.frigatenvr.org/
- **YOLOv8 Docs:** https://docs.ultralytics.com/
- **Tapo C210 Manual:** Check documentation for detailed RTSP settings

**Última actualización:** 2026-09-01 | v1.1.0
