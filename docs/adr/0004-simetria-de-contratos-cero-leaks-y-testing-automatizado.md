# ADR 0004: Simetría de Contratos, Mandato Cero Leaks y Testing Automatizado en Edge

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/routes/*`, `public/js/*`, `tests/*`, `scripts/test-contract-symmetry.mjs`

---

## 1. Contexto y Problema
En aplicaciones web desacopladas, las discrepancias entre los modelos de datos devueltos por el backend y los esperados por el frontend conducen a fallos visuales degradantes: cadenas `'undefined'`, `'NaN'` o `'Invalid Date'` mostradas al usuario final. Asimismo, probar aplicaciones de Cloudflare Workers históricamente requería procesos pesados y lentos. Se requiere una estrategia de simetría de datos garantizada y una suite de pruebas ultrarrápida.

---

## 2. Decisión

1. **Mandato Inmutable de Cero Fugas (Zero-Leak Mandate):**
   - Queda estrictamente prohibido que las cadenas `'undefined'`, `'null'`, `'NaN'`, `'Invalid Date'` o `'[object Object]'` se rendericen en el DOM o se transmitan en cargas útiles JSON hacia el cliente.
   - Todo componente del frontend y endpoint del backend debe proveer valores por defecto defensivos.

2. **Simetría Bidireccional de Alias en Respuestas HTTP:**
   - Los controladores de Hono emiten siempre las propiedades con ambos alias reconocidos históricamente para evitar roturas:
     - Instalaciones: proveen tanto `ubicacion` como `direccion`.
     - Tipos de Medidor: proveen tanto `unidad` como `unidadMedida`.
     - Medidores y Lecturas: proveen tanto `fechaLectura`, `timestamp` como `fecha`.

3. **Normalización Universal de Fechas a ISO-8601 Estricto:**
   - SQLite almacena marcas temporales con espacio (`YYYY-MM-DD HH:mm:ss`), lo que produce `Invalid Date` en ciertos motores de navegador.
   - Todo endpoint normaliza las fechas antes de responder:
     ```typescript
     let iso = raw;
     if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
       iso = raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
     }
     ```

4. **Suite de Pruebas Ultrarrápida con Vitest y Hono `app.request()`:**
   - Configurada en `vitest.config.ts`.
   - Se prueban los endpoints invocando directamente `app.request(path, init, env)` con mocks tipados de D1 y KV.
   - **Rendimiento:** Permite evaluar el ciclo completo de middlewares, CORS, esquemas Zod, auth y controladores sin abrir sockets de red TCP, completando **todas las pruebas en < 600 ms**.

5. **Certificación de Simetría en Entornos Vivos (`scripts/test-contract-symmetry.mjs`):**
   - Script ejecutable que crea entidades de prueba reales y verifica que no existan fugas visuales:
     - `npm run test:contract`: Ejecuta contra el servidor local (`http://127.0.0.1:8787`).
     - `npm run test:contract:remote`: Ejecuta contra la nube en producción (`https://metric.zer0x.org`).

---

## 3. Reglas Inmutables para Agentes de IA
- **Aserción `assertNoLeak` Obligatoria:** Todo nuevo componente o endpoint debe superar las aserciones de no-fuga.
- **Fechas en ISO-8601:** Prohibido retornar fechas crudas con espacios desde los controladores.
- **Tipado sin `any` en Tests:** Los mocks de `D1Database` en pruebas deben implementar sus interfaces tipadas sin incurrir en `@typescript-eslint/no-explicit-any`.

---

## 4. Consecuencias

### Positivas
- Cero interfaces rotas o textos con `(undefined)` en producción.
- Tiempos de ejecución de tests inferiores a 1 segundo para un ciclo TDD ágil.
- Paridad absoluta y simétrica entre la base de datos, la API y la UI.

### Negativas / Trade-offs
- Ligera redundancia intencional de alias en los DTOs de respuesta.
