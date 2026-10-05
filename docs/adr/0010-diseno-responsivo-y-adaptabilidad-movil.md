# ADR 0010: Arquitectura PWA Offline-First, Service Worker y Sincronización en Lote

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `public/sw.js`, `public/js/sync-manager.js`, `src/routes/lecturas.ts`

---

## 1. Contexto y Problema
Los operadores metrológicos trabajan frecuentemente en subterráneos, salas de calderas, minas o zonas rurales sin cobertura de telefonía móvil ni Wi-Fi:
- El operador debe poder abrir la aplicación, consultar el listado de medidores previamente cargados y registrar nuevas lecturas sin conexión.
- Al recuperar la señal de red, las lecturas tomadas fuera de línea deben transmitirse en lote de forma ordenada y tolerante a fallos.
- Un error de validación en un medidor puntual no debe abortar la sincronización de las lecturas válidas del resto del lote.

---

## 2. Decisión

1. **Separación de Responsabilidades y Service Worker (`public/sw.js`):**
   - El Service Worker es responsable exclusivo del shell de navegación y recursos estáticos (`Cache-First` con fallback a red).
   - **Regla Estricta:** Queda terminantemente prohibido cachear peticiones mutantes (`POST`, `PUT`, `DELETE`) en el Service Worker.
   - **Acotamiento Same-Origin:** El listener `fetch` del Service Worker ignora (`url.origin !== self.location.origin`) cualquier petición a orígenes externos (ej. CDNs o Google Fonts) para evitar conflictos con la directiva `connect-src` de CSP.

2. **Gestión de Cola Local con `SyncManager` (`public/js/sync-manager.js`):**
   - Cuando no hay conexión (`navigator.onLine === false` o fallo de fetch), las lecturas se encolan en almacenamiento local del cliente (`localStorage` / `IndexedDB`) con un `localId` único y timestamp local.
   - La interfaz visualiza el contador de lecturas pendientes de sincronización.
   - Al detectar el evento `online` o pulsar "Sincronizar", se despacha el lote completo hacia el backend.

3. **Endpoint de Sincronización en Lote (`POST /api/lecturas/batch-sync`):**
   - Procesa cada elemento en orden cronológico.
   - **Respuesta Discriminada:** Retorna un reporte estructurado por ítem con estado `SYNCED` o `REJECTED`, especificando el `localId` y el error puntual si aplica.
   - Las lecturas válidas se persisten y actualizan la lectura actual del medidor en D1, mientras que las rechazadas se notifican al operador sin descartar el lote completo.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Abortar Todo el Lote:** El endpoint `batch-sync` debe procesar cada ítem de forma aislada mediante bloques `try/catch` internos.
- **Prohibido Interceptar Peticiones Externas en `sw.js`:** Mantener siempre la cláusula de guard `if (url.origin !== self.location.origin) return;`.

---

## 4. Consecuencias

### Positivas
- Operatividad 100% continua en terreno sin depender de conectividad constante.
- Resiliencia garantizada: ninguna lectura válida se pierde por fallos en registros adyacentes.

### Negativas / Trade-offs
- Requiere resolución de posibles desincronizaciones de tiempo si el reloj del dispositivo del operador difiere del servidor.
