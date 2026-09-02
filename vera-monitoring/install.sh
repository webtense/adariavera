#!/bin/bash

###############################################################################
# Vera Adaria v1.1.0 — Health Checker Installation Script
#
# Uso:
#   bash install.sh
#
# Este script automatiza la instalación completa del sistema de monitoreo
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_PATH="/opt/vera-monitor"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Vera Adaria v1.1.0 — Health Checker Installer        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo

# ============ CHECKS PREVIOS ============

echo -e "${YELLOW}[1/7] Verificando requisitos...${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js no encontrado. Instala Node.js 16+${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

if ! command -v npm &> /dev/null; then
  echo -e "${RED}✗ npm no encontrado${NC}"
  exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

if ! command -v psql &> /dev/null; then
  echo -e "${RED}✗ PostgreSQL no encontrado. Instala PostgreSQL 12+${NC}"
  exit 1
fi
echo -e "${GREEN}✓ PostgreSQL ${PSQL_VERSION}${NC}"

# ============ CREAR DIRECTORIOS ============

echo
echo -e "${YELLOW}[2/7] Creando estructura de directorios...${NC}"

sudo mkdir -p "$INSTALL_PATH"
sudo cp -r "$SCRIPT_DIR"/* "$INSTALL_PATH/"
sudo chown -R $(whoami):$(whoami) "$INSTALL_PATH"

echo -e "${GREEN}✓ Archivos copiados a $INSTALL_PATH${NC}"

# ============ INSTALAR DEPENDENCIAS ============

echo
echo -e "${YELLOW}[3/7] Instalando dependencias npm...${NC}"

cd "$INSTALL_PATH"
npm install

echo -e "${GREEN}✓ Dependencias instaladas${NC}"

# ============ CONFIGURAR BASE DE DATOS ============

echo
echo -e "${YELLOW}[4/7] Configurando PostgreSQL...${NC}"

read -p "Usuario PostgreSQL superuser (default: postgres): " PG_USER
PG_USER=${PG_USER:-postgres}

read -p "Contraseña para vera_monitor (leave empty para generar): " DB_PASSWORD
if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
  echo -e "${BLUE}  Generada contraseña: $DB_PASSWORD${NC}"
fi

# Crear usuario y BD
sudo -u "$PG_USER" psql << EOF
CREATE DATABASE IF NOT EXISTS vera_monitoring;
CREATE USER IF NOT EXISTS vera_monitor WITH PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE vera_monitoring TO vera_monitor;
\c vera_monitoring
GRANT ALL ON SCHEMA public TO vera_monitor;
EOF

# Ejecutar esquema
psql -U vera_monitor -d vera_monitoring < "$INSTALL_PATH/schema-monitoring.sql"

echo -e "${GREEN}✓ Base de datos configurada${NC}"

# ============ CREAR .env ============

echo
echo -e "${YELLOW}[5/7] Configurando variables de entorno...${NC}"

if [ -f "$INSTALL_PATH/.env" ]; then
  echo -e "${YELLOW}  .env ya existe, no sobrescribiendo${NC}"
else
  cat > "$INSTALL_PATH/.env" << EOF
DB_HOST=localhost
DB_PORT=5432
DB_USER=vera_monitor
DB_PASSWORD=$DB_PASSWORD
DB_NAME=vera_monitoring

TWILIO_ENABLED=false
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

PORT=3100
NODE_ENV=production
LOG_LEVEL=info
EOF

  chmod 600 "$INSTALL_PATH/.env"
  echo -e "${GREEN}✓ .env creado${NC}"
  echo -e "${BLUE}  ⚠ Editar $INSTALL_PATH/.env para configurar Twilio (opcional)${NC}"
fi

# ============ INSTALAR PM2 ============

echo
echo -e "${YELLOW}[6/7] Configurando PM2 (process manager)...${NC}"

npm install -g pm2

cd "$INSTALL_PATH"
pm2 start watchdog-service.js --name vera-monitor --instances 1
pm2 save

echo -e "${GREEN}✓ PM2 configurado${NC}"

# ============ VERIFICAR ============

echo
echo -e "${YELLOW}[7/7] Verificando instalación...${NC}"

sleep 3

if curl -s http://localhost:3100/health | grep -q "watchdog"; then
  echo -e "${GREEN}✓ Watchdog está corriendo en http://localhost:3100${NC}"
else
  echo -e "${RED}✗ Error: Watchdog no responde${NC}"
  echo -e "${BLUE}  Ver logs: pm2 logs vera-monitor${NC}"
  exit 1
fi

# ============ INSTALACIÓN COMPLETADA ============

echo
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Instalación completada exitosamente                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo

echo -e "${BLUE}📊 Dashboard:${NC}"
echo -e "   Abrir: file://$INSTALL_PATH/monitor-dashboard.html"
echo -e "   O servir: python3 -m http.server -d $INSTALL_PATH 8000"
echo -e "   URL: http://localhost:8000/monitor-dashboard.html"
echo

echo -e "${BLUE}🔧 Comandos útiles:${NC}"
echo -e "   Ver logs:      pm2 logs vera-monitor"
echo -e "   Reiniciar:     pm2 restart vera-monitor"
echo -e "   Parar:         pm2 stop vera-monitor"
echo -e "   Status:        pm2 status"
echo

echo -e "${BLUE}⚙️  Próximos pasos:${NC}"
echo -e "   1. Editar $INSTALL_PATH/services-monitor.config.json"
echo -e "   2. Agregar endpoints /health en tus servicios (ver README-MONITORING.md)"
echo -e "   3. Configurar Twilio en .env (si deseas alertas WhatsApp)"
echo -e "   4. Reiniciar watchdog: pm2 restart vera-monitor"
echo

echo -e "${BLUE}📖 Documentación:${NC}"
echo -e "   $INSTALL_PATH/README-MONITORING.md"
echo
