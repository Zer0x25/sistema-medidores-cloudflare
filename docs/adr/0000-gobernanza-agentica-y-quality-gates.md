# ADR 0000: Gobernanza Agéntica, Spec-Driven Development (SDD) y Quality Gates

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** Todo el repositorio `deploy-cloudflare`, flujo de trabajo agéntico y pipelines de verificación

---

## 1. Contexto y Problema
El desarrollo autónomo asistido por Modelos de Lenguaje (LLMs) presenta riesgos de degradación arquitectónica: alucinación de paquetes con binarios nativos de C++ (incompatibles con Cloudflare V8 Isolates), consultas SQL no optimizadas que saturan cuotas serverless y alteración arbitraria de contratos de datos. Se requiere un protocolo inmutable que gobierne las decisiones técnicas y garantice estabilidad determinista.

---

## 2. Decisión

1. **Jerarquía de Verdad y ADRs Inmutables:**
   - Los documentos en `docs/adr/` tienen precedencia absoluta sobre cualquier prompt o instrucción conversacional.
   - Cualquier cambio estructural o adición de bindings exige la redacción previa de un nuevo ADR.

2. **Metodología Spec-Driven Development (SDD):**
   - No se escribe código de producción sin un archivo de especificación en `specs/` (basado en `specs/templates/feature.template.md`).
   - El spec define el alcance, límites de archivos editables autorizados, contratos Zod de entrada/salida, presupuesto D1 e invariantes duras.

3. **Ciclo Agentic TDD (Red-Green-Refactor):**
   - El agente debe escribir primero la suite de pruebas unitarias o de integración en `tests/` que valide los criterios de aceptación y confirmar que fallan (Fase Roja).
   - Solo entonces implementa el código mínimo indispensable en `src/` o `public/` hasta que pasen los tests (Fase Verde).

4. **Quality Gate Determinista (`./scripts/verify.sh`):**
   - Ninguna tarea se considera finalizada si el script `./scripts/verify.sh` no termina con código de salida `0`.
   - Valida en secuencia: sincronización de tipos (Prisma y Wrangler), verificación estricta TypeScript (`tsc --noEmit`), linter ESLint y suite de pruebas Vitest.

---

## 3. Reglas Inmutables para Agentes de IA
- **Límites de Alcance (Boundary Enforcement):** Modifica únicamente los archivos autorizados en la especificación activa. Prohibido alterar configuraciones globales o bindings sin autorización.
- **Control Estricto de Dependencias:** Prohibido instalar librerías con dependencias compiladas en C++ (`node-gyp`). Todo módulo debe ser JS/TS puro compatible con V8 Isolates y `nodejs_compat`.
- **Errores de Dominio Tipados:** Prohibido lanzar `throw new Error()` genéricos con strings mágicos. Usar códigos de dominio tipados y traducirlos a códigos HTTP semánticos (400, 401, 403, 404, 409).
- **Conventional Commits:** Todo commit debe apegarse estrictamente al estándar (`feat`, `fix`, `test`, `refactor`, `chore`, `docs`).

---

## 4. Consecuencias

### Positivas
- Cero alucinaciones o degradación en el código de producción.
- Verificación automática y determinista del 100% de la funcionalidad en menos de 1 segundo.
- Código limpio, desacoplado y portable a cualquier máquina.

### Negativas / Trade-offs
- Requiere redactar contratos Zod y pruebas antes de escribir la lógica en los controladores.
