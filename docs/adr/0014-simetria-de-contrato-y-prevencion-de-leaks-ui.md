# ADR 0014: Simetría de Contrato Bidireccional y Prevención de Fugas (Zero-Leak) en UI

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/routes/*`, `public/js/*`, `tests/contract/symmetry.test.ts`, `scripts/test-contract-symmetry.mjs`

---

## 1. Contexto y Problema
En aplicaciones web interactivas con frontend Vanilla JS desacoplado del backend:
- Frecuentemente ocurren sutiles asimetrías de nomenclatura entre lo que el cliente envía y lo que el backend devuelve (ej: el formulario envía `ubicacion`, pero la base de datos devuelve `direccion`; o el formulario envía `unidad`, pero el DTO retorna `unidadMedida`).
- Cuando una propiedad no coincide exactamente, JavaScript evalúa la propiedad inexistente como `undefined`, provocando que en la interfaz aparezcan textos como `"Sede Central (undefined)"` o `"Consumo: NaN kWh"`.
- Los motores SQLite almacenan fechas como strings con espacio (`2026-10-05 07:20:00`), lo cual en navegadores Safari o ciertos motores V8 produce `new Date("...") === Invalid Date`.

---

## 2. Decisión

1. **Invariante de Cero Fugas (Zero-Leak Mandate):**
   - Queda terminantemente prohibido que las cadenas `'undefined'`, `'null'`, `'NaN'`, `'Invalid Date'` o `'[object Object]'` se rendericen en el DOM de la aplicación o se envíen en payloads JSON hacia el cliente.
   - Todo renderizado dinámico debe contar con operadores de coalescencia o fallbacks defensivos (`val || ""`, `nombre || "Sin nombre"`).

2. **Simetría Bidireccional de Alias en Rutas:**
   - Para garantizar interoperabilidad total entre vistas previas y nuevos componentes, los controladores de Hono devuelven siempre las propiedades con ambos alias reconocidos:
     - Instalaciones: proveen tanto `ubicacion` como `direccion`.
     - Tipos de Medidor: proveen tanto `unidad` como `unidadMedida`.
     - Lecturas y Medidores: proveen tanto `fechaLectura`, `timestamp` como `fecha`.

3. **Normalización Rigurosa de Fechas a ISO-8601 Estricto:**
   - Toda fecha leída desde SQLite D1 se normaliza antes de emitirse en JSON:
     ```typescript
     let iso = raw;
     if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
       iso = raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
     }
     ```
   - Esto garantiza que `new Date(iso)` sea 100% válido en cualquier navegador y sistema operativo sin producir `Invalid Date`.

4. **Certificación Automatizada de Simetría:**
   - La suite de Vitest incluye `tests/contract/symmetry.test.ts` para verificar estas invariantes en tiempo de compilación.
   - El script ejecutable `scripts/test-contract-symmetry.mjs` (`npm run test:contract` y `npm run test:contract:remote`) valida la cadena completa creando entidades reales y asertando que la representación en pantalla contenga 0 leaks.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Emitir Fechas con Espacios:** Toda respuesta JSON con marcas temporales debe estar en formato ISO-8601 estándar (`YYYY-MM-DDTHH:mm:ssZ`).
- **Aserción Obligatoria `assertNoLeak`:** Al añadir nuevos campos a la interfaz o nuevas consultas, verificar que no existan propiedades indefinidas.
- **Mantener Aliasing Simétrico:** Si agregas una entidad con variantes de nombre históricas, mantén ambos campos en la salida del endpoint.

---

## 4. Consecuencias

### Positivas
- Erradicación total de fallos visuales vergonzosos (`undefined`, `Invalid Date`) en pantallas de producción.
- Experiencia de usuario sólida y predecible tanto en web como en dispositivos móviles.

### Negativas / Trade-offs
- Ligera duplicación de propiedades de alias en los DTOs de salida (impacto mínimo en tamaño de payload).
