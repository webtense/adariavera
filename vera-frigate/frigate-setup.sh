#!/bin/bash
# ============================================================================
# FRIGATE NVR - SETUP AUTOMÁTICO
# v1.1.0 | Vera Adaria | 2026-09-01
# ============================================================================
# Instalación completa de Frigate NVR con:
# - Docker + docker-compose
# - Almacenamiento en /media/frigate
# - Base datos PostgreSQL
# - Integración con watchdog alerter

set -e

# ============================================================================
# CONFIGURACIÓN
# ============================================================================
FRIGATE_VERSION="0.13.0"
FRIGATE_HOST="${FRIGATE_HOST:-127.0.0.1}"
FRIGATE_PORT="${FRIGATE_PORT:-5000}"
FRIGATE_DATA_DIR="${FRIGATE_DATA_DIR:-/media/frigate}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-vera_adaria}"
POSTGRES_USER="${POSTGRES_USER:-frigate}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24)}"

# Colores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

# ============================================================================
# FUNCIONES
# ============================================================================
log_info() {
  echo -e "${BLUE}[*]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
  echo -e "${RED}[✗]${NC} $1"
}

check_docker() {
  if ! command -v docker &> /dev/null; then
    log_error "Docker no está instalado"
    log_info "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker $USER
    log_success "Docker instalado"
  else
    log_success "Docker detectado: $(docker --version)"
  fi
}

check_docker_compose() {
  if ! command -v docker-compose &> /dev/null; then
    log_error "docker-compose no está instalado"
    log_info "Instalando docker-compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    log_success "docker-compose instalado"
  else
    log_success "docker-compose detectado: $(docker-compose --version)"
  fi
}

create_directories() {
  log_info "Creando directorios..."
  mkdir -p "$FRIGATE_DATA_DIR"/{recordings,clips,snapshots,models,logs}
  chmod 755 "$FRIGATE_DATA_DIR"
  log_success "Directorios creados en $FRIGATE_DATA_DIR"
}

setup_storage() {
  log_info "Configurando almacenamiento..."

  # Verificar espacio disponible
  AVAILABLE=$(df "$FRIGATE_DATA_DIR" | awk 'NR==2 {print $4}')
  REQUIRED=$((100 * 1024 * 1024))  # 100GB en KB

  if [ $AVAILABLE -lt $REQUIRED ]; then
    log_warn "Espacio disponible: $((AVAILABLE / 1024 / 1024))GB (recomendado: 100GB)"
  else
    log_success "Espacio disponible: $((AVAILABLE / 1024 / 1024))GB"
  fi

  # Configurar límite de almacenamiento
  echo "$FRIGATE_DATA_DIR:100GB" > "$FRIGATE_DATA_DIR/.storage_limit"
}

download_models() {
  log_info "Descargando modelos YOLOv8..."

  MODELS_DIR="$FRIGATE_DATA_DIR/models"
  mkdir -p "$MODELS_DIR"

  # Descargar YOLOv8s (pequeño, rápido)
  if [ ! -f "$MODELS_DIR/yolov8s.pt" ]; then
    log_info "Descargando yolov8s.pt (43MB)..."
    cd "$MODELS_DIR"
    wget -q https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8s.pt \
      || log_warn "No se pudo descargar YOLOv8s automáticamente"
    cd -
  else
    log_success "yolov8s.pt ya existe"
  fi
}

setup_database() {
  log_info "Configurando base de datos PostgreSQL..."

  # Crear base de datos si no existe
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE $POSTGRES_DB;" 2>/dev/null || log_warn "BD $POSTGRES_DB podría existir ya"

  log_success "Base de datos lista: $POSTGRES_DB"
}

create_docker_compose() {
  log_info "Creando docker-compose.yml..."

  cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  # =========================================================================
  # FRIGATE NVR
  # =========================================================================
  frigate:
    image: ghcr.io/blakeblackshear/frigate:latest
    container_name: frigate
    privileged: true
    restart: unless-stopped
    shm_size: '256mb'

    environment:
      FRIGATE_RTSP_PASSWORD: password
      TZ: Europe/Madrid

    volumes:
      - ./frigate.yml:/config/config.yml:ro
      - /media/frigate:/media/frigate
      - /etc/localtime:/etc/localtime:ro

    ports:
      - "5000:5000"
      - "8554:8554"
      - "8555:8555/tcp"
      - "8555:8555/udp"

    networks:
      - frigate-net

    depends_on:
      - postgres

  # =========================================================================
  # POSTGRESQL (Histórico eventos)
  # =========================================================================
  postgres:
    image: postgres:16-alpine
    container_name: frigate-postgres
    restart: unless-stopped

    environment:
      POSTGRES_DB: vera_adaria
      POSTGRES_USER: frigate
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      PGDATA: /var/lib/postgresql/data/pgdata

    volumes:
      - /media/frigate/postgres:/var/lib/postgresql/data
      - ./schema-frigate.sql:/docker-entrypoint-initdb.d/01-schema.sql

    networks:
      - frigate-net

    ports:
      - "5432:5432"

  # =========================================================================
  # REDIS (Cache y anti-spam alertas)
  # =========================================================================
  redis:
    image: redis:7-alpine
    container_name: frigate-redis
    restart: unless-stopped

    command: redis-server --appendonly yes

    volumes:
      - /media/frigate/redis:/data

    networks:
      - frigate-net

    ports:
      - "6379:6379"

networks:
  frigate-net:
    driver: bridge
EOF

  log_success "docker-compose.yml creado"
}

start_services() {
  log_info "Iniciando servicios Frigate..."

  docker-compose up -d

  log_info "Esperando a que Frigate esté listo..."
  sleep 10

  # Verificar que Frigate está activo
  if curl -s http://localhost:5000/api/version > /dev/null 2>&1; then
    log_success "Frigate está en línea (http://localhost:5000)"
  else
    log_warn "Frigate aún no responde, comprobando logs..."
    docker-compose logs frigate | tail -20
  fi
}

setup_postgresql_schema() {
  log_info "Configurando esquema PostgreSQL..."

  # Esperar a que PostgreSQL esté listo
  sleep 5

  # Ejecutar schema
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" -f schema-frigate.sql

  log_success "Esquema PostgreSQL configurado"
}

create_alerter_integration() {
  log_info "Creando integración con alerter..."

  # Crear archivo de configuración para alerts-frigate.js
  cat > alerts-frigate-config.json << EOF
{
  "frigate": {
    "host": "$FRIGATE_HOST",
    "port": $FRIGATE_PORT,
    "api_url": "http://$FRIGATE_HOST:$FRIGATE_PORT"
  },
  "database": {
    "host": "$POSTGRES_HOST",
    "port": $POSTGRES_PORT,
    "database": "$POSTGRES_DB",
    "user": "$POSTGRES_USER",
    "password": "$POSTGRES_PASSWORD"
  },
  "redis": {
    "host": "127.0.0.1",
    "port": 6379
  },
  "alerts": {
    "whatsapp": {
      "enabled": true,
      "anti_spam_window": 120
    },
    "email": {
      "enabled": false
    }
  },
  "zones": {
    "parking": {
      "alert_level": "warning",
      "objects": ["car"]
    },
    "entrada": {
      "alert_level": "info",
      "objects": ["person"]
    },
    "zona_restringida": {
      "alert_level": "critical",
      "objects": ["person"]
    }
  }
}
EOF

  log_success "Configuración de alertas creada: alerts-frigate-config.json"
}

generate_passwords() {
  log_info "Generando credenciales seguras..."

  cat > .env.frigate << EOF
# Frigate Vera Adaria
FRIGATE_HOST=$FRIGATE_HOST
FRIGATE_PORT=$FRIGATE_PORT
FRIGATE_VERSION=$FRIGATE_VERSION

# PostgreSQL
POSTGRES_HOST=$POSTGRES_HOST
POSTGRES_PORT=$POSTGRES_PORT
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Almacenamiento
FRIGATE_DATA_DIR=$FRIGATE_DATA_DIR
EOF

  chmod 600 .env.frigate
  log_success "Credenciales guardadas en .env.frigate (SECRETO)"
}

# ============================================================================
# MAIN
# ============================================================================
main() {
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  FRIGATE NVR SETUP v1.1.0"
  echo "  Vera Adaria | 6x Tapo C210"
  echo "════════════════════════════════════════════════════════════════"
  echo ""

  log_info "Iniciando instalación..."

  check_docker
  check_docker_compose
  create_directories
  setup_storage
  download_models
  generate_passwords
  create_docker_compose
  start_services
  setup_postgresql_schema
  create_alerter_integration

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  log_success "Instalación completada"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
  echo "Próximos pasos:"
  echo ""
  echo "1. Editar frigate.yml con IPs reales de cámaras:"
  echo "   - recepcion:     192.168.1.11"
  echo "   - parking:       192.168.1.12"
  echo "   - entrada:       192.168.1.13"
  echo "   - servicio:      192.168.1.14"
  echo "   - trasera:       192.168.1.15"
  echo "   - lateral:       192.168.1.16"
  echo ""
  echo "2. Reiniciar Frigate con cambios:"
  echo "   docker-compose restart frigate"
  echo ""
  echo "3. Acceder a dashboard:"
  echo "   http://localhost:5000/"
  echo ""
  echo "4. Integrar alertas:"
  echo "   node alerts-frigate.js"
  echo ""
  echo "5. Ver logs:"
  echo "   docker-compose logs -f frigate"
  echo ""
}

# Ejecutar
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
