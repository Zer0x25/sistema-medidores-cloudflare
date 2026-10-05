# ADR 0004: Seguridad Criptográfica Edge, Probes de Salud y Auditoría Inmutable

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/auth.ts`, `src/audit.ts`, `src/routes/health.ts`, `src/routes/auditoria.ts`

---

## 1. Contexto y Problema
En sistemas de control metrológico de suministros (electricidad, agua, combustibles), la seguridad perimetral y la trazabilidad forense son innegociables:
- La manipulación no autorizada de medidores, precintos o contraseñas debe registrarse de forma inmutable.
- Los orquestadores y monitores de salud requieren diferenciar cuándo el Worker está vivo versus cuándo la base de datos D1 está respondiendo.
- Las librerías de hashing tradicionales (como `bcrypt`) contienen código nativo en C++ incompatible con V8 Isolates.

---

## 2. Decisión

1. **Criptografía Nativa Compatible con V8 Isolates:**
   - Se utiliza `node:crypto` bajo la bandera `nodejs_compat` en `src/auth.ts`.
   - **Hashing de Contraseñas:** Algoritmo `scrypt` con salt aleatorio criptográfico de 16 bytes y longitud de clave derivada de 64 bytes (`salt:derivedKey`).
   - **Tokens de Sesión:** JWT firmado con HMAC-SHA256 (`HS256`), con validación de expiración (`exp`) e integridad de payload sin librerías externas pesadas.

2. **Probes de Salud Operativa Desacoplados:**
   - **Liveness Probe (`GET /healthz`):** Verificación instantánea del runtime del Worker sin consultar la base de datos. Retorna `200 { status: "ok", runtime: "cloudflare-workers" }`.
   - **Readiness Probe (`GET /readyz`):** Verificación activa del motor Cloudflare D1 ejecutando `SELECT 1 as ok`. Retorna `200` si la base responde, o `503 Service Unavailable` si hay degradación o pérdida de conectividad.

3. **Invariante de Auditoría Inmutable (Append-Only Audit Trail):**
   - Toda acción que altere estado metrológico o de seguridad (cambio de roles, altas/bajas de medidores, aperturas de precinto, calibraciones, respaldos) DEBE registrarse en `auditoria_eventos` mediante `registrarAuditoria()` (`src/audit.ts`).
   - **Inmutabilidad Absoluta:** Queda prohibido implementar endpoints o sentencias de actualización (`UPDATE`) o eliminación física (`DELETE`) sobre la tabla `auditoria_eventos`.
   - **Acceso Restringido:** La consulta de la bitácora (`GET /api/auditoria`) queda reservada con exclusividad a roles `ADMIN` y `SUPERVISOR`.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido bcrypt o módulos C++ nativos:** Usar exclusivamente las funciones de `src/auth.ts`.
- **Instrumentación Obligatoria de Auditoría:** En cualquier nueva ruta que modifique registros críticos, el agente debe invocar `registrarAuditoria()`.
- **Manejo Fail-Safe en Auditoría:** El fallo en el registro de auditoría debe registrarse en consola pero jamás abortar de forma no controlada la operación de negocio.

---

## 4. Consecuencias

### Positivas
- Cero dependencias nativas o vulnerabilidades en binarios externos.
- Diagnóstico preciso en monitoreo sin falsos positivos de indisponibilidad.
- Trazabilidad legal y metrológica inmutable.

### Negativas / Trade-offs
- Ligero consumo de escrituras en D1 para los eventos de auditoría (controlado y justificado).
