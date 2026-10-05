#!/usr/bin/env bash
# ==============================================================================
# BOOTSTRAP DETERMINISTA: SETUP LOCAL EN NUEVA MÁQUINA
# ==============================================================================
# Prepara el entorno de desarrollo local 100% autónomo para Cloudflare Workers,
# D1 SQLite local y KV con un solo comando.
# ==============================================================================

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}  SETUP DE ENTORNO LOCAL — CLOUDFLARE WORKERS & D1    ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Comprobación de Node.js y npm
echo -e "\n${BLUE}--> [1/6] Verificando dependencias de runtime del sistema...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Error: Node.js no está instalado. Instala Node.js v20+ o v22+.${NC}"
  exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js detectado: ${NODE_VERSION}${NC}"

# 2. Instalación de paquetes de npm
echo -e "\n${BLUE}--> [2/6] Instalando dependencias de node_modules...${NC}"
npm install

# 3. Configuración de .dev.vars si no existe
echo -e "\n${BLUE}--> [3/6] Configurando variables de entorno locales...${NC}"
if [ ! -f ".dev.vars" ]; then
  if [ -f ".dev.vars.example" ]; then
    cp .dev.vars.example .dev.vars
    echo -e "${GREEN}✓ Archivo .dev.vars inicializado desde .dev.vars.example.${NC}"
  else
    cat <<EOF > .dev.vars
JWT_SECRET=desarrollo_local_jwt_secret_minimo_32_caracteres_cloudflare
JWT_EXPIRES_IN=8h
NODE_ENV=development
LOG_LEVEL=debug
EOF
    echo -e "${GREEN}✓ Archivo .dev.vars creado con valores seguros de desarrollo.${NC}"
  fi
else
  echo -e "${GREEN}✓ Archivo .dev.vars ya existe.${NC}"
fi

# 4. Generación de tipos Prisma y Wrangler
echo -e "\n${BLUE}--> [4/6] Sincronizando artefactos tipados (Prisma & Wrangler)...${NC}"
npm run prisma:generate
npx wrangler types

# 5. Aplicar migraciones y semilla en la base de datos D1 local
echo -e "\n${BLUE}--> [5/6] Preparando base de datos D1 local (.wrangler/state)...${NC}"
npm run db:migrate:local
npm run db:seed:local
echo -e "${GREEN}✓ Esquema y datos semilla aplicados en SQLite local.${NC}"

# 6. Ejecutar Quality Gate
echo -e "\n${BLUE}--> [6/6] Ejecutando Quality Gate de verificación...${NC}"
./scripts/verify.sh

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}🎉 ¡ENTORNO LOCAL LISTO Y OPERATIVO!                  ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "Para iniciar el servidor de desarrollo local con recarga en vivo:"
echo -e "👉 ${YELLOW}npm run dev${NC}  (abrirá http://localhost:8787)"
echo -e "\nPara correr los tests en cualquier momento:"
echo -e "👉 ${YELLOW}npm test${NC}"
echo -e "\nPara validar el Quality Gate antes de commit:"
echo -e "👉 ${YELLOW}npm run verify${NC}"
echo -e "\nPara desplegar a Cloudflare cuando configures tus credenciales:"
echo -e "👉 ${YELLOW}npm run deploy${NC}"
echo -e "======================================================\n"
