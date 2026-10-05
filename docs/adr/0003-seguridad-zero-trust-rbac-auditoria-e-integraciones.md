# ADR 0003: Seguridad Zero-Trust, Criptografía Edge, RBAC, Auditoría e Integraciones Salientes

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/auth.ts`, `src/audit.ts`, `src/routes/health.ts`, `src/routes/webhooks.ts`, `src/routes/notificaciones.ts`

---

## 1. Contexto y Problema
El sistema gestiona infraestructuras críticas y metrología legal. La superficie de ataque en internet debe estar protegida perimetralmente, las contraseñas no pueden residir en texto plano, los cambios de precintos y equipos deben ser inmutables, y las notificaciones a sistemas externos (Webhooks, Telegram, Push) no deben degradar ni bloquear las transacciones en Cloudflare Workers.

---

## 2. Decisión

1. **Criptografía Nativa en V8 Isolates:**
   - Se utiliza `node:crypto` (`nodejs_compat`).
   - **Contraseñas:** Algoritmo `scrypt` con salt aleatorio de 16 bytes y clave de 64 bytes (`salt:derivedKey`). Prohibido `bcrypt` o binarios nativos.
   - **Sesión:** Tokens JWT firmados con HMAC-SHA256 (`HS256`) verificados en el middleware del Worker.

2. **Perímetro Zero-Trust y Matriz RBAC Fail-Closed:**
   - Toda ruta bajo `/api/*` exige token JWT válido, excepto la lista blanca explícita: `/api/auth/login`, `/api/auth/register`, `/api/health`, `/api/config` y `/api/demo/seed`.
   - **3 Roles Jerárquicos:**
     - `ADMIN`: Control global de infraestructura, usuarios, auditoría, bajas técnicas y respaldos.
     - `SUPERVISOR`: Gestión de medidores, órdenes de trabajo, calibraciones e inspección de auditoría.
     - `OPERADOR`: Modo terreno exclusivo. Captura de lecturas y sincronización offline. Bloqueado (HTTP 403) ante reportes ejecutivos o creación de sedes.
   - **Preservación de Token:** Si el usuario falla la contraseña actual en `/cambiar-password`, el token JWT se mantiene en el cliente para no forzar el cierre de sesión por un error tipográfico.

3. **Probes de Salud Desacoplados:**
   - **Liveness (`GET /healthz`):** Verificación instantánea del runtime V8 sin consultar base de datos (`200 ok`).
   - **Readiness (`GET /readyz`):** Verificación activa de D1 (`SELECT 1`). Retorna `200 ready` si responde o `503 not_ready` si se degrada.

4. **Invariante de Pistas de Auditoría Inmutables (Append-Only):**
   - Toda modificación de roles, bajas técnicas, calibraciones, precintos o respaldos DEBE registrarse mediante `registrarAuditoria()` en la tabla `auditoria_eventos`.
   - **Inmutabilidad Absoluta:** Queda prohibido implementar sentencias `UPDATE` o `DELETE` sobre `auditoria_eventos`.

5. **Integraciones Salientes y Webhooks Resilientes:**
   - **Firma Criptográfica HMAC-SHA256:** Payload firmado y transmitido en `X-Webhook-Signature: sha256=<hex>`.
   - **Despacho Fail-Safe:** Despacho en paralelo con `Promise.allSettled` y timeout estricto de 5.000 ms (`AbortSignal.timeout(5000)`). Un receptor caído jamás aborta la transacción en el Worker.
   - **Bitácora de Entregas:** Persistencia de estado, duración y errores en `webhook_entregas`.

6. **Notificaciones Multicanal y Entornos:**
   - **Telegram:** Despacho nativo directo vía `fetch()` a la API de bots de Telegram sin librerías pesadas.
   - **Web Push (VAPID):** Auto-purga automática de suscripciones caducadas en D1 cuando el proveedor responde HTTP 410 (Gone) o 404.
   - **Diferenciación por Entorno:** `/api/config` expone `NODE_ENV`. El selector rápido de roles de desarrollo (`devRoleSwitcher`) queda estrictamente bloqueado en producción.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Endpoints Privados sin Guardias:** Todo endpoint con mutaciones de datos debe verificar `c.get("user")`.
- **Prohibido `UPDATE`/`DELETE` en Auditoría:** La bitácora es inviolable.
- **Timeout Obligatorio en Fetches Salientes:** Todo `fetch()` hacia sistemas externos debe llevar timeout máximo de 5000 ms.

---

## 4. Consecuencias

### Positivas
- Seguridad militar perimetral sin dependencias externas vulnerables.
- Trazabilidad legal y metrológica inmutable para auditorías.
- Aislamiento total: la lentitud de receptores externos no afecta la experiencia del usuario.

### Negativas / Trade-offs
- Requiere configuración de variables y secretos en Cloudflare (`JWT_SECRET`, tokens de Telegram).
