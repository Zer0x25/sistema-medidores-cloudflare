# ADR 0008: Notificaciones Multicanal, Web Push y Telegram Nativo en Cloudflare Edge

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/routes/notificaciones.ts`, tablas `suscripciones_push` y `canales_notificacion`

---

## 1. Contexto y Problema
Los supervisores y técnicos deben recibir alertas críticas en tiempo real (medidores sin reporte, saltos atípicos de consumo, fugas):
- El sistema debe ser capaz de notificar tanto a navegadores web móviles/escritorio (Web Push VAPID) como a canales humanos directos (Telegram).
- Las librerías de Telegram tradicionales (como `telegraf` o `node-telegram-bot-api`) son pesadas, dependen de módulos obsoletos de Node y añaden sobrecarga innecesaria en V8 Isolates.
- Las suscripciones push caducan con frecuencia (cuando el usuario reinstala el navegador o revoca permisos).

---

## 2. Decisión

1. **Integración con Telegram 100% Nativa:**
   - Se utiliza la API HTTP directa de Telegram (`https://api.telegram.org/bot<token>/sendMessage`) mediante `fetch()` estándar.
   - Sin dependencias externas, con formato Markdown seguro y timeout de 5.000 ms.

2. **Web Push Estándar (VAPID RFC 8292):**
   - Gestión de suscripciones Push (`endpoint`, `p256dh`, `auth`) en la tabla `suscripciones_push` de D1.
   - En entornos de test o desarrollo donde no se disponga de claves VAPID configuradas, se generan valores de fallback seguros en memoria para garantizar que el Quality Gate nunca falle.

3. **Auto-Purga Determinista de Suscripciones Inválidas:**
   - Si el servicio push de destino (Mozilla, Google FCM, Apple) responde con HTTP 410 (Gone) o HTTP 404 (Not Found):
   - El Worker elimina de forma automática la suscripción de la tabla `suscripciones_push` en D1, evitando desperdiciar cuota de invocaciones y CPU en futuros envíos.

4. **Despacho Asíncrono no Bloqueante:**
   - El envío de notificaciones hacia operadores no detiene ni bloquea la respuesta HTTP al usuario que registró la lectura o disparó el evento.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Instalar SDKs Pesados de Telegram:** Mantener la llamada vía `fetch()` nativo.
- **Manejo Obligatorio de HTTP 410/404:** Cualquier actualización en el módulo de push debe preservar la auto-purga de endpoints caducados.
- **Respeto a Privacidad:** Prohibido registrar tokens de bot de Telegram o secretos privados en el código fuente.

---

## 4. Consecuencias

### Positivas
- Notificaciones en tiempo real a smartphones sin costo de servidores de mensajería dedicados.
- Base de datos limpia de suscripciones fantasma.

### Negativas / Trade-offs
- Se requiere configuración manual de token de bot de Telegram para habilitar ese canal en producción.
