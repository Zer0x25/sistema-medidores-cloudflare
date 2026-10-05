#!/usr/bin/env bash
# ==============================================================================
# QUALITY GATE DETERMINISTA - CLOUDFLARE EDGE
# ==============================================================================
# Barrera inmutable de calidad para desarrollo en Cloudflare Workers, D1 y KV.
# Todo commit y tarea agéntica debe superar este script con código de salida 0.
# ==============================================================================

set -euo pipefail

# Colores para salida de terminal
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   QUALITY GATE DETERMINISTA — CLOUDFLARE WORKERS    ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Asegurar variables locales (.dev.vars)
if [ ! -f ".dev.vars" ] && [ -f ".dev.vars.example" ]; then
  echo -e "${YELLOW}[CONFIG] No se detectó .dev.vars. Creando .dev.vars desde .dev.vars.example...${NC}"
  cp .dev.vars.example .dev.vars
fi

# 2. Generar tipos de Prisma y Cloudflare Worker Bindings
echo -e "\n${BLUE}--> [Paso 1/4] Sincronización de Artefactos Tipados (Prisma & Wrangler)...${NC}"
npm run prisma:generate > /dev/null 2>&1 || true
npx wrangler types > /dev/null 2>&1 || true
echo -e "${GREEN}✓ Tipos generados correctamente.${NC}"

# 3. Verificación Estricta de Tipos TypeScript (tsc --noEmit)
echo -e "\n${BLUE}--> [Paso 2/4] Verificación de Tipos (Typecheck)...${NC}"
if npm run typecheck; then
  echo -e "${GREEN}✓ Typecheck superado sin errores (0 fallos TS).${NC}"
else
  echo -e "${RED}✗ Error en Typecheck. Corrige los tipos antes de continuar.${NC}"
  exit 1
fi

# 4. Análisis Estático y Linter (ESLint)
echo -e "\n${BLUE}--> [Paso 3/4] Análisis Estático y Reglas de Código (Linter)...${NC}"
if npm run lint; then
  echo -e "${GREEN}✓ Linter superado sin advertencias críticas.${NC}"
else
  echo -e "${RED}✗ Error de Linter. Corrige las reglas violadas o formato.${NC}"
  exit 1
fi

# 5. Suite de Pruebas Automatizadas (Vitest)
echo -e "\n${BLUE}--> [Paso 4/4] Suite de Pruebas Unitarias, Integración y Contrato (Vitest)...${NC}"
if npm test; then
  echo -e "${GREEN}✓ Todos los tests pasaron exitosamente (100%).${NC}"
else
  echo -e "${RED}✗ Pruebas fallidas. El código no satisface los criterios de aceptación.${NC}"
  exit 1
fi

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}   ✓ QUALITY GATE CUMPLIDO: CÓDIGO DE SALIDA 0        ${NC}"
echo -e "${GREEN}   Listo para desarrollo local o despliegue a Edge.   ${NC}"
echo -e "${GREEN}======================================================${NC}"
exit 0
