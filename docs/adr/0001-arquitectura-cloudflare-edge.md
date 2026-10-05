# ADR 0001: Arquitectura Cloudflare Edge — Workers, Hono, D1, KV y Static Assets

## Estado
Aceptado (Inmutable)

## Contexto y Motivación
El sistema original fue diseñado y empaquetado para entornos Node.js / Docker sobre Fastify y SQLite en disco persistente. Con el objetivo de eliminar costos fijos de servidor ($0 USD de infraestructura) y proveer latencia sub-10ms a nivel global mediante la red Anycast, se adapta y optimiza la arquitectura completa para la plataforma serverless de **Cloudflare**.

## Decisión Técnica

1. **Framework HTTP y Routing: Hono v4**
   - Se selecciona **Hono** por su compatibilidad nativa con V8 Isolates de Cloudflare Workers, sobrecarga de memoria mínima (< 15 KB gzipped), tipado estricto extremo con TypeScript y middleware nativo (`timing`, `cors`, etc.).
   - Sustituye a Fastify manteniendo paridad exacta en rutas, códigos HTTP y validaciones Zod.

2. **Base de Datos Relacional: Cloudflare D1 (SQLite Serverless)**
   - Se emplea D1 para persistencia transaccional.
   - **Invariante de Filas Leídas (Free Tier):** Se optimizan todas las consultas SQL mediante índices B-Tree en `migrations/0001_initial.sql`. Queda estrictamente vetado el uso de filtros sin índice para evitar agotar la cuota de 5 millones de filas leídas diarias.

3. **Caché en Edge y Snapshots: Cloudflare KV (`KV_CACHE`)**
   - Se utiliza un namespace KV para acelerar lecturas masivas y persistir copias de seguridad atómicas con expiración TTL automática de 30 días (`POST /api/admin/backup`), evitando sobrecargar la base de datos relacional.

4. **Frontend SPA y PWA: Cloudflare Static Assets (`./public`)**
   - El shell de navegación, interfaz Aurora Design System y Service Worker se sirven directamente desde el CDN de Cloudflare mediante el binding `ASSETS`, consumiendo **0 invocaciones del Worker** para tráfico estático.

5. **Simetría de Contrato y Prevención de Leaks en UI**
   - Normalización de fechas SQLite a ISO-8601 en todas las respuestas.
   - Erradicación obligatoria de literales `'undefined'`, `'null'`, `'NaN'`, `'Invalid Date'`, `'[object Object]'` en respuestas y renderizados.

6. **Quality Gate Determinista**
   - Script `./scripts/verify.sh` que ejecuta en secuencia: generación de tipos (Prisma + Wrangler), verificación de tipos con TypeScript (`tsc --noEmit`), linter estricto (`eslint`) y suite de pruebas (`vitest run`).

## Consecuencias
- Despliegue global instantáneo en más de 300 ciudades con costo de infraestructura $0 USD.
- Ejecución determinista en desarrollo local mediante `wrangler dev` y base de datos local SQLite en `.wrangler/state`.
- Código 100% tipado, sin dependencias nativas de C++ y probado con tests unitarios, de integración y de contrato.
