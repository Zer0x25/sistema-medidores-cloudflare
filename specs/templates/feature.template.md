# Spec: [Nombre de la Funcionalidad o Caso de Uso en Cloudflare Edge]

> **Instrucción para el Agente:** Este documento es un contrato cerrado. No implementes código de producción sin antes escribir las pruebas unitarias/integración que satisfagan estos criterios de aceptación (Agentic TDD).

---

## 1. Alcance y Límites de Archivos

- **Objetivo:** [Descripción precisa y concisa de lo que se va a implementar]
- **Archivos editables autorizados:**
  - `src/routes/[modulo].ts`
  - `src/types.ts`
  - `tests/unit/[modulo].test.ts`
  - `tests/integration/[modulo].test.ts`
  - `public/js/[componente].js` (si aplica a UI)
- **Archivos protegidos (solo lectura / prohibido modificar):**
  - `src/auth.ts`
  - `src/audit.ts`
  - `docs/adr/*`
  - `wrangler.jsonc`

---

## 2. Contrato Funcional de Datos (Zod Schemas)

### A. Contrato de Entrada (Input DTO)
```typescript
// Esquema Zod requerido para validar el body o query params
export const [Modulo]InputSchema = z.object({
  campoId: z.string().uuid(),
  campoTexto: z.string().trim().min(2).max(100),
  campoEnum: z.enum(["VALOR_A", "VALOR_B"]),
});
```

### B. Contrato de Salida (Output DTO / Respuestas HTTP)
- Salida esperada (HTTP 200/201):
  - `id`: Identificador único generado (`crypto.randomUUID()`).
  - `status`: Estado resultante.
  - `createdAt`: Timestamp ISO-8601 estricto en UTC (`toISOString()`).
  - *(Garantía: Cero fugas de `undefined`, `null`, `NaN` o `Invalid Date`)*.

---

## 3. Presupuesto de Base de Datos D1 (Free Tier)

- **Índice B-Tree Requerido:** [Especifica el índice de `migrations/` que soporta las consultas de este módulo].
- **Proyección de Columnas:** [Lista explícita de columnas requeridas; prohibido `SELECT *`].
- **Límite de Consulta:** `LIMIT 50` o `LIMIT 100` en endpoints de listado.

---

## 4. Invariantes del Negocio

### A. Invariantes Positivas (Garantías)
1. **[Garantía 1]:** Toda fecha emitida debe estar en formato ISO-8601 UTC estricto.
2. **[Garantía 2]:** Las alteraciones críticas deben invocar `registrarAuditoria()` en D1.

### B. Invariantes Negativas (Prohibiciones Duras)
1. **[Prohibición 1]:** Prohibido el uso de paquetes con binarios compilados de C++.
2. **[Prohibición 2]:** Prohibido Full Table Scans en tablas de alto volumen (`lecturas`, `auditoria_eventos`).
3. **[Prohibición 3]:** Prohibido fugar tokens o contraseñas en respuestas JSON.

---

## 5. Criterios de Aceptación (Definition of Done)

- [ ] **Tests de Esquemas de Validación (Zod):**
  - [ ] Rechazo de entradas incompletas o tipos erróneos con HTTP 400 (`VALIDATION_ERROR`).
- [ ] **Tests de Integración con `app.request()`:**
  - [ ] Flujo exitoso probado con mock de `D1Database`.
  - [ ] Rechazo 401 para peticiones no autenticadas.
  - [ ] Rechazo 403 para usuarios sin el rol requerido en la matriz RBAC.
- [ ] **Test de Simetría y Cero Leaks:**
  - [ ] Sin presencia de `undefined`, `null`, `NaN`, `Invalid Date` ni `[object Object]`.
- [ ] **Quality Gate Determinista (Código de salida 0 obligatorio):**
  - [ ] `./scripts/verify.sh` superado al 100%.
