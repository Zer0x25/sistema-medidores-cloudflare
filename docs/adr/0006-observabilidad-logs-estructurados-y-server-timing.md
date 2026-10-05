# ADR 0006: Observabilidad en Edge, Server-Timing y Manejo de Errores Críticos

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/index.ts`, `wrangler.jsonc`

---

## 1. Contexto y Problema
En arquitecturas serverless edge distribuidas en cientos de centros de datos, diagnosticar cuellos de botella y errores es crítico:
- Las aplicaciones cliente necesitan visibilidad de los tiempos de respuesta desagregados (latencia de red vs cómputo del Worker vs consulta D1).
- Los errores de cliente (400, 401, 403, 404) no deben activar falsas alarmas operativas ni ensuciar los logs de infraestructura.
- Las excepciones no controladas (500) deben registrarse con traza detallada en el panel de Cloudflare sin filtrar detalles sensibles al cliente.

---

## 2. Decisión

1. **Cloudflare Workers Observability Nativa:**
   - Se activa la telemetría oficial de Cloudflare en `wrangler.jsonc`: `"observability": { "enabled": true }`.
   - Permite inspección de logs en tiempo real mediante `wrangler tail` y dashboards en Cloudflare Dashboard.

2. **Middleware W3C Server-Timing Estándar:**
   - Se integra el middleware nativo `timing()` de Hono en `src/index.ts`.
   - Inyecta la cabecera HTTP `Server-Timing` en todas las respuestas, permitiendo que el navegador (y DevTools) visualice la duración exacta del ciclo de procesamiento en el Worker.

3. **Logging Estructurado de Peticiones en Edge:**
   - Middleware de medición de tiempo por petición:
     `[Worker] ${method} ${path} -> ${status} (${ms} ms)`
   - Proporciona retroalimentación instantánea en consola durante el desarrollo local (`wrangler dev`) y en logs de producción.

4. **Discriminación Estricta de Errores (4xx vs 5xx):**
   - **Errores de Cliente (4xx):** Respuestas JSON semánticas `{ error: "CODIGO_ERROR", message: "..." }`. No se registran como incidentes críticos de servidor.
   - **Errores de Servidor (500):** Capturados en `app.onError()`. Se emite un log de error en consola para diagnóstico interno y se retorna una respuesta genérica y segura al cliente para evitar fugas de información interna.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Fugar Traza de Excepciones en HTTP 500:** El objeto `err.stack` nunca debe ser enviado directamente al cliente en respuestas HTTP.
- **Respeto a Códigos HTTP Semánticos:** Rutas de autenticación deben retornar 401, permisos insuficientes 403, validación Zod fallida 400, recursos inexistentes 404 y conflictos de duplicidad 409.

---

## 4. Consecuencias

### Positivas
- Medición precisa de latencias directamente en el navegador del usuario vía DevTools (pestaña Network / Timing).
- Diagnóstico rápido con `wrangler tail` en producción sin coste adicional.

### Negativas / Trade-offs
- Ligera adición de cabeceras HTTP en las respuestas (despreciable en ancho de banda).
