# ADR 0005: Integraciones Salientes, Despacho Fail-Safe de Webhooks y Firma Criptográfica

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/routes/webhooks.ts`, tabla `webhooks` y `webhook_entregas`

---

## 1. Contexto y Problema
El sistema debe integrarse con plataformas externas de telemetría y monitoreo corporativo notificando eventos en tiempo real (alertas críticas, nuevas lecturas, órdenes de mantenimiento):
- La caída, latencia excesiva o respuesta errónea de un servidor receptor externo no debe bloquear ni hacer fallar la transacción en Cloudflare Workers.
- El receptor debe contar con un mecanismo infalsificable para autenticar que el payload fue emitido legítimamente por este sistema.
- Se debe mantener un registro de auditoría de cada intento de entrega (código HTTP devuelto, duración y errores).

---

## 2. Decisión

1. **Firma Criptográfica HMAC-SHA256:**
   - Si el endpoint del webhook cuenta con un `secreto` configurado, el Worker calcula la firma HMAC-SHA256 del cuerpo JSON crudo.
   - Se despacha en la cabecera HTTP estándar: `X-Webhook-Signature: sha256=<hex_digest>`.
   - Se incluye cabecera de evento `X-Webhook-Event: <tipo_evento>` y timestamp `X-Webhook-Timestamp: <iso_date>`.

2. **Aislamiento y Despacho Fail-Safe (`Promise.allSettled`):**
   - El envío hacia múltiples endpoints externos se realiza en paralelo sin bloquear el ciclo de vida del Worker.
   - Los fallos en endpoints remotos se capturan de forma segura y nunca generan excepciones no controladas ni alteran el estado de la base de datos principal.

3. **Timeout Estricto con `AbortController`:**
   - Toda petición saliente tiene un timeout improrrogable de **5.000 ms** utilizando `AbortSignal.timeout(5000)`.
   - Si el receptor no responde en 5 segundos, la petición se aborta inmediatamente liberando los recursos del isolate.

4. **Bitácora Inmutable de Entregas (`webhook_entregas`):**
   - Cada intento de despacho persiste en D1: `webhookId`, `evento`, `url`, `statusCode`, `duracionMs`, `exito` (0/1) y `errorDetalle`.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido `await fetch()` Bloqueante sin Timeout:** Toda petición externa saliente DEBE llevar `signal: AbortSignal.timeout(5000)`.
- **Prohibido Reintentar Infinitamente en Edge:** Los reintentos deben ser limitados para no consumir innecesariamente tiempo de CPU del Worker en el Free Tier.
- **Transacciones Inalteradas:** El éxito o fracaso de un webhook saliente jamás debe condicionar la persistencia de una lectura, alerta o registro en D1.

---

## 4. Consecuencias

### Positivas
- Resiliencia perimetral: el sistema continúa operando a máxima velocidad aunque los servidores receptores externos estén caídos.
- Trazabilidad y depuración inmediata desde el panel administrativo de webhooks.

### Negativas / Trade-offs
- Requiere persistir una fila en `webhook_entregas` por cada intento (controlado mediante paginación y límites).
