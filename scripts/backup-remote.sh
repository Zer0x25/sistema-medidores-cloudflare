#!/usr/bin/env bash
# ==============================================================================
# RESPALDO ATÓMICO Y EXPORTACIÓN DE BASE DE DATOS D1
# ==============================================================================
# Ejecuta un respaldo de la base de datos remota D1 o genera un snapshot en KV.
# ==============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

FECHA=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}     RESPALDO DE BASE DE DATOS CLOUDFLARE D1          ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Modo de operación
MODO="${1:---remote}"
ARCHIVO_SALIDA="${BACKUP_DIR}/d1_backup_${FECHA}.sql"

if [ "$MODO" == "--local" ]; then
  echo -e "${YELLOW}--> Exportando D1 LOCAL a SQL dump...${NC}"
  npx wrangler d1 export sistema-medidores-db --local --output="$ARCHIVO_SALIDA"
else
  echo -e "${YELLOW}--> Exportando D1 REMOTO a SQL dump (${ARCHIVO_SALIDA})...${NC}"
  npx wrangler d1 export sistema-medidores-db --remote --output="$ARCHIVO_SALIDA"
fi

echo -e "${GREEN}✓ Respaldo completado exitosamente: ${ARCHIVO_SALIDA}${NC}"
