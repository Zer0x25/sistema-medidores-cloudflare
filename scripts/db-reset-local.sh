#!/usr/bin/env bash
# ==============================================================================
# RESET DETERMINISTA DE LA BASE DE DATOS LOCAL D1 (SQLite)
# ==============================================================================
# Limpia el estado local de D1 (.wrangler/state) y reaplica las migraciones y seed.
# ==============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${YELLOW}--> Restableciendo base de datos local D1 (.wrangler/state)...${NC}"

if [ -d ".wrangler/state/v3/d1" ]; then
  rm -rf .wrangler/state/v3/d1
  echo -e "${GREEN}✓ Almacenamiento local SQLite de D1 eliminado.${NC}"
fi

echo -e "${BLUE}--> Aplicando migraciones locales...${NC}"
npm run db:migrate:local

echo -e "${BLUE}--> Aplicando datos semilla locales...${NC}"
npm run db:seed:local

echo -e "\n${GREEN}✓ Base de datos local D1 restablecida exitosamente.${NC}"
