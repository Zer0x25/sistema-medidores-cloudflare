# ADR 0007: Estrategia de Testing Edge con Vitest, Hono app.request() y Simetría de Contrato

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `tests/*`, `vitest.config.ts`, `scripts/test-contract-symmetry.mjs`

---

## 1. Contexto y Problema
Probar aplicaciones de Cloudflare Workers tradicionalmente requería:
- Levantar procesos pesados de Miniflare o navegadores Playwright completos para verificar respuestas básicas de la API.
- Tiempos de ejecución de tests lentos (varios minutos) que desincentivan la adopción rigurosa de TDD en los agentes de IA.
- Riesgo de asimetría: que los tests pasen en memoria pero fallen por sutiles diferencias de formato o fugas de cadenas prohibidas en el renderizado final.

---

## 2. Decisión

1. **Suite Unificada con Vitest:**
   - Se selecciona **Vitest** como motor de pruebas de alta velocidad.
   - Configurado en `vitest.config.ts` con entorno Node.js estándar y paralelismo optimizado.

2. **Harness de Integración HTTP Ultrarrápido (`app.request()`):**
   - Hono implementa la API estándar de Fetch (`Request` / `Response`).
   - Se ejecutan pruebas de integración completas invocando directamente `app.request(path, init, env)` pasando mocks tipados de los bindings (`DB`, `KV_CACHE`, `JWT_SECRET`).
   - **Ventaja de Rendimiento:** Evalúa middlewares de autenticación, CORS, validación Zod y controladores de rutas sin abrir sockets de red TCP ni requerir puertos libres en el sistema operativo. Tiempo de ejecución: **< 100 ms para decenas de rutas**.

3. **Pruebas de Simetría de Contrato y Cero Leaks UI (`npm run test:contract`):**
   - Script automatizado `scripts/test-contract-symmetry.mjs` que valida de extremo a extremo:
     - Creación y recuperación simétrica de instalaciones, tipos de medidor, medidores y lecturas.
     - Simulación de renderizado en componentes de interfaz asegurando cero apariciones de:
       `'undefined'`, `'null'`, `'NaN'`, `'Invalid Date'`, `'[object Object]'`.
   - Soporta doble objetivo: local por defecto (`http://127.0.0.1:8787`) o remoto en la nube (`npm run test:contract:remote` contra `https://metric.zer0x.org`).

---

## 3. Reglas Inmutables para Agentes de IA
- **Pruebas Rápidas y Deterministas:** Las pruebas unitarias e integración en `tests/` deben ejecutarse en menos de 5 segundos en total.
- **Inyección de Bindings Tipados:** En `tests/integration/`, los mocks de `Env` deben implementar los métodos de `D1Database` requeridos (`prepare`, `bind`, `run`, `first`, `all`) sin usar `any`.
- **Validación de Cero Leaks Obligatoria:** Todo nuevo endpoint o componente debe pasar por la aserción `assertNoLeak()`.

---

## 4. Consecuencias

### Positivas
- Bucle de retroalimentación de pruebas instantáneo (< 1s) para el desarrollador y el agente.
- Cobertura exhaustiva de rutas, autenticación y errores sin necesidad de infraestructura pesada.

### Negativas / Trade-offs
- `app.request()` simula la petición en memoria; las pruebas end-to-end completas contra SQLite D1 real se delegan a `test-contract-symmetry.mjs`.
