# ADR 0000: Adopción de Gobernanza Agéntica, SDD, ADRs y Quality Gates (Edición Cloudflare Edge)

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** Todo el repositorio `deploy-cloudflare`, herramientas de build, testing y agentes autónomos

---

## 1. Contexto y Problema
El desarrollo de software en entornos serverless Edge asistido por Modelos de Lenguaje (LLMs) y agentes autónomos presenta desafíos únicos:
- Los agentes tienden a importar paquetes que dependen de binarios nativos de Node.js (incompatibles con V8 Isolates de Cloudflare Workers).
- Los agentes suelen escribir consultas SQL no indexadas que provocan Full Table Scans, agotando la cuota diaria del Free Tier de Cloudflare D1 (5 millones de filas leídas/día) en minutos.
- Sin un Quality Gate determinista y pruebas automatizadas rápidas, los agentes introducen asimetrías de datos, tipos rotos o literales prohibidos (`undefined`, `null`, `Invalid Date`) en la interfaz de usuario.

---

## 2. Decisión
Se adopta formalmente la metodología de **Gobernanza Agéntica** para Cloudflare Edge fundamentada en cuatro pilares inmutables:

1. **Spec-Driven Development (SDD):**
   - Todo nuevo desarrollo de ruta o módulo debe estar respaldado por un contrato cerrado en `specs/`.
   - Se definen previamente esquemas Zod, invariantes de negocio y criterios de aceptación (DoD).

2. **Architecture Decision Records (ADRs):**
   - Toda decisión arquitectónica, selección de bindings (D1, KV, Assets) o cambio de patrón queda documentada de forma inmutable en `docs/adr/`.
   - Tienen precedencia absoluta sobre cualquier prompt conversacional.

3. **Agentic Test-Driven Development (Agentic TDD):**
   - Antes de escribir código de producción, se redactan las pruebas en `tests/` (unitarias o integración HTTP con Hono `app.request()`).
   - Se valida la fase roja (falla el test) antes de implementar el código mínimo en `src/` que lleve a la fase verde.

4. **Deterministic Quality Gates:**
   - Ningún commit ni tarea se da por concluida sin superar `./scripts/verify.sh` con código de salida `0` (Sincronización de tipos Prisma/Wrangler, Typecheck TS, ESLint estricto y Vitest).

---

## 3. Reglas Inmutables para Agentes de IA
- **Entorno V8 Isolate:** Prohibido importar módulos con binarios compilados de C++ (`node-gyp`, bindings nativos). Únicamente TypeScript/JS puro y módulos compatibles con `nodejs_compat`.
- **Cero Full Table Scans en D1:** Toda consulta debe apoyarse en índices B-Tree de `migrations/0001_initial.sql`.
- **Contratos Cerrados y Tipado Estricto:** Toda ruta Hono debe usar bindings tipados (`Env`, `Variables`), Zod para validación y tipos explícitos sin `any`.
- **Conventional Commits:** Seguir estrictamente el formato `feat(...)`, `fix(...)`, `test(...)`, `refactor(...)`, `chore(...)`.

---

## 4. Consecuencias

### Positivas
- Cero alucinaciones destructivas en el entorno Cloudflare.
- Respeto absoluto del presupuesto diario del Free Tier.
- Ejecución determinista del Quality Gate en menos de 1 segundo.

### Negativas / Trade-offs
- Requiere disciplina estricta al consultar tablas en D1 y escribir pruebas antes de desplegar.
