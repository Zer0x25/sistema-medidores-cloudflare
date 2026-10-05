# ADR 0003: Despliegue Serverless con Wrangler y Aislamiento de Entornos Edge

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `wrangler.jsonc`, `package.json`, `scripts/`, `.dev.vars`

---

## 1. Contexto y Problema
En arquitecturas tradicionales basadas en contenedores Docker y servidores dedicados (VPS, Staging, Producción):
- Existen costos fijos mensuales de infraestructura independientemente del volumen de tráfico.
- El arranque de contenedores, la gestión de volúmenes en disco y la configuración de reverse proxies (Nginx/Traefik) añaden complejidad operacional innecesaria.
- Se requiere un modelo serverless con arranque instantáneo, despliegue global atómico y ambientes de desarrollo desacoplados pero idénticos en comportamiento.

---

## 2. Decisión

1. **Despliegue Serverless con Cloudflare Wrangler (v3 CLI):**
   - Se elimina la necesidad de Docker y empaquetamiento de contenedores en este repositorio.
   - El despliegue a producción se realiza con `wrangler deploy`, distribuyendo el código a los POPs Anycast de Cloudflare en segundos.
   - El dominio de producción oficial queda enlazado como custom domain: `metric.zer0x.org`.

2. **Entorno de Desarrollo Local Autónomo (`wrangler dev`):**
   - El desarrollo local corre sobre el motor de emulación Miniflare/workerd (`npm run dev`).
   - Escucha en `http://localhost:8787` con soporte completo de Hono, recarga en vivo (hot reload) y simulación exacta de los bindings `DB`, `KV_CACHE` y `ASSETS`.

3. **Aislamiento y Migraciones de Base de Datos D1:**
   - **Local:** Los datos de desarrollo se almacenan en SQLite local dentro de `.wrangler/state/v3/d1`. Las migraciones locales se aplican con `npm run db:migrate:local`.
   - **Remoto:** Las migraciones de producción en la nube se aplican con `npm run db:migrate:remote`.
   - **Reset:** La base de datos local puede restablecerse deterministamente con `npm run db:reset:local`.

4. **Gestión Segura de Secretos y Variables:**
   - En local: Se utiliza `.dev.vars` (ignorado en git), inicializado a partir de `.dev.vars.example`.
   - En producción: Variables públicas en `wrangler.jsonc` (`vars: { ... }`) y secretos sensibles inyectados mediante `wrangler secret put`.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Reintroducir Docker en este Repo:** Este proyecto opera con tooling serverless nativo de Cloudflare. No generes Dockerfiles ni scripts de docker-compose dentro de `deploy-cloudflare`.
- **Aislamiento Local vs Remoto:** Queda terminantemente prohibido ejecutar comandos con la bandera `--remote` durante el ciclo de desarrollo regular o pruebas unitarias/integración. Los tests automatizados y el desarrollo cotidiano deben correr exclusivamente contra el entorno `--local`.
- **Sincronización de Migraciones:** Toda modificación al modelo relacional debe plasmarse en un archivo SQL numerado en `migrations/NNNN_nombre.sql` y sincronizarse en `prisma/schema.prisma`.

---

## 4. Consecuencias

### Positivas
- Reducción del costo de infraestructura a $0 USD (Free Tier).
- Tiempos de arranque y ciclo de retroalimentación de desarrollo de menos de 1 segundo.
- Setup en cualquier máquina nueva mediante un único comando (`./scripts/setup-local.sh`).

### Negativas / Trade-offs
- No se dispone de un sistema de archivos persistente en disco (toda persistencia debe residir en D1 o KV).
