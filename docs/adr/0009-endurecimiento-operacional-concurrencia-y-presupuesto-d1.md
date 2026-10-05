# ADR 0009: Endurecimiento Metrológico, Presupuesto de Filas Leídas en D1 y Snapshots en KV

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `migrations/0001_initial.sql`, `src/routes/medidores.ts`, `src/routes/lecturas.ts`, `src/routes/auditoria.ts`

---

## 1. Contexto y Problema
En Cloudflare D1 (SQLite Serverless), el cobro y las cuotas de uso se miden de manera crítica por **Filas Leídas (Rows Read)** y **Filas Escritas**:
- Cuota diaria gratuita: 5,000,000 de filas leídas y 100,000 escritas.
- Si una consulta no cuenta con un índice B-Tree apropiado, SQLite realiza un escaneo completo de tabla (Full Table Scan), leyendo todas las filas existentes en cada petición.
- Con 20,000 lecturas acumuladas, tan solo 250 consultas sin índice consumen las 5,000,000 de filas y bloquean la base de datos por el resto del día.
- Además, los medidores poseen invariantes físicas inviolables: las lecturas acumulativas de un medidor no pueden decrecer, los números de serie no pueden duplicarse y los precintos deben tener trazabilidad continua.

---

## 2. Decisión

1. **Estrategia Obligatoria de Índices B-Tree Compuestos:**
   Se definen índices estratégicos en `migrations/0001_initial.sql`:
   - `idx_lecturas_medidor_fecha`: `ON lecturas(medidorId, fechaLectura DESC)` -> Reduce la búsqueda de la última lectura de O(N) a O(log N), leyendo exactamente 1 fila en lugar de miles.
   - `idx_medidores_instalacion_activo`: `ON medidores(instalacionId, activo)` -> Filtrado directo de medidores activos por sede.
   - `idx_alertas_estado`: `ON incidentes_alerta(estado, fechaDeteccion DESC)` -> Búsqueda instantánea de incidentes abiertos sin escanear alertas resueltas.
   - `idx_auditoria_entidad_fecha`: `ON auditoria_eventos(entidad, createdAt DESC)` -> Paginación eficiente de bitácora.

2. **Proyecciones Quirúrgicas y Paginación Cursor/Limit:**
   - Queda estrictamente vetado el uso de `SELECT *` en tablas de alto volumen (`lecturas`, `auditoria_eventos`, `incidentes_alerta`).
   - Se seleccionan únicamente las columnas que la interfaz va a renderizar.
   - Todo endpoint de listado (`GET`) impone `LIMIT 50` o `LIMIT 100`.

3. **Invariantes Metrológicas Duras:**
   - **Lectura Monótonamente Creciente:** En medidores con `tipoMedicion = 'ACUMULATIVO'`, una nueva lectura no puede ser inferior a la lectura actual registrada (error `LECTURA_DECRECIENTE_PROHIBIDA`).
   - **Medidor Inactivo:** No se pueden ingresar lecturas a medidores dados de baja técnica (`MEDIDOR_INACTIVO`).
   - **Trazabilidad de Precintos:** Cada cambio de precinto registra el precinto anterior, el nuevo y el técnico responsable en la bitácora inmutable.

4. **Copias de Seguridad Atómicas en KV con TTL:**
   - El endpoint `POST /api/admin/backup` no duplica tablas pesadas en D1. Genera un snapshot inmutable en formato JSON y lo persiste en `KV_CACHE` con expiración automática de 30 días (`expirationTtl: 2592000`), limpiándose solo sin mantenimiento manual.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Crear Rutas con Filtros sin Índice:** Si agregas una cláusula `WHERE columna = ?`, dicha columna debe tener un índice en `migrations/` o estar justificada por bajo volumen (< 10 filas fijas).
- **Prohibido `.reduce()` en Memoria para Agregaciones SQL:** Usar siempre funciones nativas `SUM()`, `COUNT(*)`, `AVG()` en SQLite.
- **Invariante Creciente Intacta:** Jamás eliminar o relajar la validación de lectura creciente en `src/routes/lecturas.ts`.

---

## 4. Consecuencias

### Positivas
- Consumo real de filas leídas en D1 reducido en más del 98%, operando con holgura absoluta en el Free Tier.
- Blindaje contra lecturas erróneas o fraudulentas en terreno.

### Negativas / Trade-offs
- Ligero costo de espacio de almacenamiento para mantener los árboles B-Tree de los índices (despreciable frente al límite de 5 GB).
