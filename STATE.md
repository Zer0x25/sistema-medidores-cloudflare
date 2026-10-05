# Estado del Proyecto: Sistema Medidores Cloudflare Edge (STATE.md)

Este archivo actúa como memoria persistente y tablero de control para humanos y agentes de software que operan dentro del entorno autónomo **`deploy-cloudflare`**.

---

## 🧭 Fase Actual: Entorno Autónomo Cloudflare Edge Potenciado & Certificado

- **Proyecto:** `sistema-medidores-cloudflare` (Cloudflare Workers + Hono + D1 + KV + Static Assets)
- **Estado:** 100% autónomo, portable, probado y certificado tanto en entorno local (`wrangler dev`) como en producción (`https://metric.zer0x.org`).
- **Dominio Edge:** `metric.zer0x.org`
- **Última verificación de Quality Gate (`./scripts/verify.sh`):** Código de salida 0 (Typecheck 0 errores, ESLint 0 advertencias, Vitest 23/23 tests pasando en 0.5s).
- **Test de Simetría de Contrato (`npm run test:contract:remote`):** 100% pasando sin fugas (`undefined`, `null`, `NaN`, `Invalid Date`, `[object Object]`).

---

## 📦 Componentes y Módulos Migrados a Edge

| Módulo / Ruta | Archivo | Estado | Descripción |
| :--- | :--- | :--- | :--- |
| **Health Probes** | `src/routes/health.ts` | ✅ 100% | `/healthz` (liveness), `/readyz` (readiness con ping a D1), `/api/health`, `/api/config` |
| **Autenticación** | `src/routes/auth.ts`, `src/auth.ts` | ✅ 100% | Login JWT HS256, hash de contraseñas con scrypt, cambio de contraseña |
| **Instalaciones** | `src/routes/instalaciones.ts` | ✅ 100% | Listado, creación, detalle y asignación con auditoría |
| **Medidores y Tipos** | `src/routes/medidores.ts` | ✅ 100% | Catálogo, tipos de medidor, calibración, precintos, bajas técnicas |
| **Lecturas** | `src/routes/lecturas.ts` | ✅ 100% | Ingesta con validación incremental y sincronización offline en lote (`batch-sync`) |
| **Dashboard KPIs** | `src/routes/dashboard.ts` | ✅ 100% | Métricas consolidadas, consumos agregados SQL y últimas lecturas |
| **Alertas & Reglas** | `src/routes/alertas.ts` | ✅ 100% | Motor de detección de saltos de consumo y medidores sin reporte |
| **Mantenimiento** | `src/routes/mantenimiento.ts` | ✅ 100% | Órdenes de trabajo, transiciones de estado y asignación de técnicos |
| **Auditoría Inmutable** | `src/routes/auditoria.ts`, `src/audit.ts` | ✅ 100% | Bitácora append-only inviolable con filtros y metadatos JSON |
| **Reportes** | `src/routes/reportes.ts` | ✅ 100% | Resúmenes de consumo por recurso e instalación y exportación CSV |
| **Webhooks** | `src/routes/webhooks.ts` | ✅ 100% | Gestión de endpoints salientes, firma HMAC-SHA256 y bitácora de entregas |
| **Notificaciones** | `src/routes/notificaciones.ts` | ✅ 100% | Canales Telegram y Web Push con auto-purga de tokens expirados |
| **Demo Seed** | `src/routes/demo.ts` | ✅ 100% | Endpoint determinista para inicialización rápida de datos de prueba |
| **Static Assets SPA** | `public/*` | ✅ 100% | Interfaz de usuario Aurora Design System, PWA Service Worker y sincronizador |

---

## 🛠️ Herramientas y Scripts Disponibles

- `./scripts/verify.sh` (`npm run verify`): Quality Gate determinista (Typecheck + Lint + Vitest).
- `./scripts/setup-local.sh` (`npm run setup`): Inicialización en un comando para nueva máquina.
- `./scripts/db-reset-local.sh` (`npm run db:reset:local`): Limpieza y reseeding de SQLite local D1.
- `./scripts/backup-remote.sh` (`npm run db:backup:remote`): Volcado SQL de la base de datos remota D1.
- `npm run test:contract`: Test de simetría de contrato contra servidor local (`http://127.0.0.1:8787`).
- `npm run test:contract:remote`: Test de simetría de contrato contra producción Cloudflare (`https://metric.zer0x.org`).

---

## 🚀 Portabilidad a Otra Máquina

Para llevar este proyecto a otro PC:
1. Copia o clona la carpeta `deploy-cloudflare`.
2. En la terminal del nuevo PC, ejecuta:
   ```bash
   ./scripts/setup-local.sh
   ```
3. Inicia el servidor de desarrollo local:
   ```bash
   npm run dev
   ```
4. El proyecto estará completamente funcional en `http://localhost:8787`.
