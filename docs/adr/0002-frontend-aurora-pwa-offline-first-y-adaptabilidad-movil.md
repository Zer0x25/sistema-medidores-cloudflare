# ADR 0002: Frontend Aurora Design System, PWA Offline-First y Adaptabilidad Móvil

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `public/*`, `src/routes/lecturas.ts` (`batch-sync`)

---

## 1. Contexto y Problema
Los operadores de medidores trabajan frecuentemente en subterráneos, salas de bombas o faenas rurales con conexión móvil inestable o nula. Asimismo, el uso en smartphones requiere interfaces táctiles que no fuercen zoom ni desplazamiento horizontal. Por último, servir los archivos estáticos de la interfaz no debe consumir la cuota de invocaciones diarias del Worker (100,000 requests/día).

---

## 2. Decisión

1. **Alojamiento en Cloudflare Static Assets (`./public`):**
   - La SPA y el Service Worker residen en `./public` bajo el binding `ASSETS`.
   - Se despachan directamente por la CDN de Cloudflare con **0 invocaciones de Worker** y costo $0 USD.

2. **Aurora Design System y Desacoplamiento Frontend:**
   - Implementado en Vanilla JS modular y CSS moderno con tokens semánticos HSL (`public/app.css`).
   - Modo Claro y Oscuro nativo con persistencia local en `public/js/theme.js`.
   - Módulos desacoplados: `ApiClient` (transporte e interceptor JWT), `ModalManager` (modales accesibles), `ToastManager` (notificaciones no intrusivas) y `Components` (factorías de UI).

3. **Arquitectura PWA Offline-First:**
   - **Service Worker (`public/sw.js`):** Gestiona el shell de navegación y estáticos (`Cache-First`).
     - *Regla Estricta:* Prohibido cachear peticiones HTTP mutantes (`POST`, `PUT`, `DELETE`).
     - *Same-Origin Fetch:* Evalúa `url.origin !== self.location.origin` y retorna sin interceptar ante CDNs o fuentes externas para no violar la directiva `connect-src` de CSP.
   - **Cola Fuera de Línea (`SyncManager`):** Encola lecturas en `localStorage`/`IndexedDB` cuando no hay red con `localId` y timestamp.
   - **Endpoint de Sincronización en Lote (`POST /api/lecturas/batch-sync`):** Procesa cada ítem cronológicamente y retorna un reporte discriminado (`SYNCED` vs `REJECTED`). Un fallo puntual no aborta el resto de lecturas válidas del lote.

4. **Diseño Mobile-First con Tarjetas Táctiles:**
   - En pantallas pequeñas (< 768px), los medidores se muestran como tarjetas apiladas (`.meter-card`) con badges de color semántico por recurso (Agua, Luz, Gas, Petróleo).
   - Áreas táctiles mínimas de **44px × 44px** cumpliendo normas WCAG.
   - Prohibido el scroll horizontal en viewport móvil (`overflow-x: hidden`).

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Frameworks Pesados en Frontend:** Mantener Vanilla JS puro y CSS nativo; no introducir empaquetadores como Webpack o frameworks pesados.
- **Prohibido Interceptar Mutaciones en `sw.js`:** Las mutaciones deben gestionarse en la capa de aplicación con `SyncManager`.
- **Prohibido Abortar Todo el Lote en `batch-sync`:** Procesar cada elemento de forma aislada en D1.

---

## 4. Consecuencias

### Positivas
- Carga de la SPA en menos de 50 ms a nivel global sin consumir cuota del Worker.
- Operatividad 100% continua en terreno sin cobertura de red.
- Experiencia táctil fluida y profesional en cualquier dispositivo móvil.

### Negativas / Trade-offs
- Manipulación manual del DOM en lugar de librerías reactivas automáticas.
