#!/bin/bash

# Rollback Script Pre-checkin — v1.1.0 → v1.0.0
# Uso: ./rollback-precheckin.sh [--backup-db]
# Rollback a tag v1.0.0-precheckin-baseline

set -e

BACKUP_DB="$1"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
BASELINE_TAG="v1.0.0-precheckin-baseline"

echo "=========================================="
echo "Rollback Pre-checkin v1.1.0 → v1.0.0"
echo "Baseline Tag: $BASELINE_TAG"
echo "=========================================="
echo ""

# Crear directorio de backups
mkdir -p "$BACKUP_DIR"

# Backup de base de datos si se solicita
if [ "$BACKUP_DB" = "--backup-db" ]; then
    echo "[1/4] Realizando backup de base de datos..."
    if [ -f "package.json" ] && [ -f ".env" ]; then
        echo "⚠️  Detectada aplicación con BD"
        echo "    Backup se realiza manualmente según BD específica"
    fi
fi

# Parar la aplicación
echo "[2/4] Parando aplicación..."
SERVICE_NAME="adaria-precheckin"
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    sudo systemctl stop "$SERVICE_NAME" 2>/dev/null
    echo "✓ Servicio detenido"
fi

# Resetear a v1.0.0-precheckin-baseline
echo "[3/4] Revirtiendo código a $BASELINE_TAG..."
if git rev-parse --verify "$BASELINE_TAG" >/dev/null 2>&1; then
    git checkout "$BASELINE_TAG"
    echo "✓ Código revertido a baseline"
else
    echo "❌ No se encontró tag $BASELINE_TAG"
    exit 1
fi

# Reinstalar dependencias
echo "[4/4] Reinstalando dependencias..."
if [ -f "package.json" ]; then
    npm ci --production
    echo "✓ Dependencias instaladas"
fi

echo ""
echo "=========================================="
echo "Rollback completado exitosamente"
echo "Ejecutar: systemctl start $SERVICE_NAME"
echo "=========================================="
