# Estado del Proyecto: Sistema Medidores Cloudflare Edge (STATE.md)

Este archivo actúa como memoria persistente y tablero de control para humanos y agentes de software que operan dentro del entorno autónomo **`deploy-cloudflare`**.

---

## 🧭 Fase Actual: Entorno Autónomo Cloudflare Edge Potenciado & Certificado

- **Proyecto:** `sistema-medidores-cloudflare` (Cloudflare Workers + Hono + D1 + KV + Static Assets)
- **Estado:** 100% autónomo, portable, probado y certificado tanto en entorno local (`wrangler dev`) como en producción (`https://metric.zer0x.org`).
- **Dominio Edge:** `metric.zer0x.org`
- **Última verificación de Quality Gate (`./scripts/verify.sh`):** Código de salida 0 (Typecheck 0 errores, ESLint 0 advertencias, Vitest 33/33 tests pasando en 0.6s).
- **Herramienta CLI:** Actualizado a **Wrangler v4 (`^4.147.0`)** y `@cloudflare/workers-types` (`^5.20261006.1`) con soporte para tipos de runtime generados.
- **Test de Simetría de Contrato (`npm run test:contract:remote`):** 100% pasando sin fugas (`undefined`, `null`, `NaN`, `Invalid Date`, `[object Object]`).

---

## 📦 Componentes y Módulos Migrados a Edge

| Módulo / Ruta | Archivo | Estado | Descripción |
| :--- | :--- | :--- | :--- |
| **Health Probes** | `src/routes/health.ts` | ✅ 100% | `/healthz` (liveness), `/readyz` (readiness con ping a D1), `/api/health`, `/api/config` |
| **Autenticación** | `src/routes/auth.ts`, `src/auth.ts` | ✅ 100% | Login JWT HS256, hash de contraseñas con scrypt, cambio de contraseña |
| **Instalaciones** | `src/routes/instalaciones.ts` | ✅ 100% | Listado con Location Scoping (feat-021), creación, detalle y asignación con auditoría |
| **Medidores y Tipos** | `src/routes/medidores.ts` | ✅ 100% | Catálogo con Location Scoping (403 ante sede ajena), tipos de medidor, calibración, precintos, bajas técnicas |
| **Lecturas** | `src/routes/lecturas.ts` | ✅ 100% | Ingesta con validación incremental, Location Scoping y sincronización offline en lote (`batch-sync`) |
| **Dashboard KPIs** | `src/routes/dashboard.ts` | ✅ 100% | Métricas consolidadas, consumos agregados SQL y últimas lecturas filtradas por sedes asignadas |
| **Alertas & Reglas** | `src/routes/alertas.ts` | ✅ 100% | Motor de detección, filtrado territorial y resolución protegida (403 ante incidentes ajenos) |
| **Mantenimiento** | `src/routes/mantenimiento.ts` | ✅ 100% | Bitácora, órdenes de trabajo y fichas protegidas por sedes asignadas (403) |
| **Auditoría Inmutable** | `src/routes/auditoria.ts`, `src/audit.ts` | ✅ 100% | Bitácora append-only inviolable con filtros y metadatos JSON |
| **Reportes** | `src/routes/reportes.ts` | ✅ 100% | Resúmenes de consumo, facturas conciliadas y exportación CSV con Location Scoping estricto |
| **Webhooks** | `src/routes/webhooks.ts` | ✅ 100% | Gestión de endpoints salientes, firma HMAC-SHA256 y bitácora de entregas |
| **Notificaciones** | `src/routes/notificaciones.ts` | ✅ 100% | Canales Telegram y Web Push con auto-purga de tokens expirados |
| **Demo Seed** | `src/routes/demo.ts` | ✅ 100% | Endpoint determinista para inicialización rápida de datos de prueba |
| **Static Assets SPA** | `public/*` | ✅ 100% | UI Aurora Design System, Hash Router, telemetría `__DIAGNOSTICS__`, PWA Service Worker y sincronizador |

---

## 🛠️ Herramientas y Scripts Disponibles

- `./scripts/verify.sh` (`npm run verify`): Quality Gate determinista (Typecheck + Lint + Vitest).
- `./scripts/setup-local.sh` (`npm run setup`): Inicialización en un comando para nueva máquina.
- `./scripts/db-reset-local.sh` (`npm run db:reset:local`): Limpieza y reseeding de SQLite local D1.
- `./scripts/backup-remote.sh` (`npm run db:backup:remote`): Volcado SQL de la base de datos remota D1.
- `npm run test:contract`: Test de simetría de contrato contra servidor local (`http://127.0.0.1:8787`).
- `npm run test:contract:remote`: Test de simetría de contrato contra producción Cloudflare (`https://metric.zer0x.org`).

---

## 📥 Backlog de Sincronización desde Upstream (Repo Padre)

Este registro almacena los hitos o funcionalidades cerradas en el repo padre que están pendientes de ser portadas a Cloudflare Edge en sesiones dedicadas:

- [x] **Hito 1 a 15 (Núcleo y Simetría):** Portado al 100% y certificado en producción (`metric.zer0x.org`).
- [x] **Hito 15.3 (Explorabilidad DOM & Routing):** Sincronizado (`/#/[modulo]`, `data-state`, `window.__DIAGNOSTICS__`, `dataset.appReady`).
- [x] **Hito 15.4 / feat-021 (Aislamiento Territorial RBAC Multi-Sede):** Sincronizado en Edge (`allowedInstalacionIds` en D1 SQL y 403 fail-closed en todas las rutas).
- [ ] *(Pendiente)*: Cuando se completen nuevos hitos en el repo padre (ej: Hito 16), anótalos aquí con sus rutas, tablas e invariantes antes de iniciar la sesión de migración.

---

## 📜 Registro Canónico de Arquitectura (5 ADRs Maestros)

El proyecto consolida todas las lecciones y patrones en 5 decisiones maestras inmutables en `docs/adr/`:
- **[ADR 0000](file:///home/zer0x/proyectos/Mi-app-test-SSD-ADR/deploy-cloudflare/docs/adr/0000-gobernanza-agentica-y-quality-gates.md):** Gobernanza Agéntica, SDD y Quality Gates.
- **[ADR 0001](file:///home/zer0x/proyectos/Mi-app-test-SSD-ADR/deploy-cloudflare/docs/adr/0001-arquitectura-serverless-cloudflare-edge-y-presupuesto-d1.md):** Arquitectura Serverless Cloudflare Edge, Presupuesto D1 y Entornos con Wrangler.
- **[ADR 0002](file:///home/zer0x/proyectos/Mi-app-test-SSD-ADR/deploy-cloudflare/docs/adr/0002-frontend-aurora-pwa-offline-first-y-adaptabilidad-movil.md):** Frontend Aurora Design System, PWA Offline-First y Adaptabilidad Móvil.
- **[ADR 0003](file:///home/zer0x/proyectos/Mi-app-test-SSD-ADR/deploy-cloudflare/docs/adr/0003-seguridad-zero-trust-rbac-auditoria-e-integraciones.md):** Seguridad Zero-Trust, Criptografía Edge, RBAC, Auditoría e Integraciones Salientes.
- **[ADR 0004](file:///home/zer0x/proyectos/Mi-app-test-SSD-ADR/deploy-cloudflare/docs/adr/0004-simetria-de-contratos-cero-leaks-y-testing-automatizado.md):** Simetría de Contratos, Mandato Cero Leaks y Testing Automatizado en Edge.

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

