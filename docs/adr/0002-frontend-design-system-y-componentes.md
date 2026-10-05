# ADR 0002: Frontend Aurora Design System, Desacoplamiento de Lógica y Workers Static Assets

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `public/*`, `src/index.ts` (Workers Static Assets binding)

---

## 1. Contexto y Problema
Una aplicación metrológica para terreno y oficina requiere:
- Carga instantánea tanto en navegadores de escritorio como en smartphones de operadores con baja conectividad.
- Cero costo de cómputo en el Worker para archivos estáticos (HTML, CSS, JS, SVGs, iconos).
- Una interfaz pulida y consistente que soporte tema Claro y Oscuro sin frameworks pesados ni dependencias de compilación lenta.

---

## 2. Decisión

1. **Alojamiento en Cloudflare Static Assets (`./public`):**
   - La Single Page Application (SPA) y los recursos PWA residen en `./public`.
   - Se configuran mediante el binding `assets: { directory: "./public", binding: "ASSETS" }` en `wrangler.jsonc`.
   - El Worker despacha assets vía `c.env.ASSETS.fetch(c.req.raw)`. Cloudflare entrega estos recursos desde el cache Anycast global a costo $0 USD y con 0 invocaciones del Worker.

2. **Design System Aurora con CSS Custom Properties:**
   - Sistema de diseño implementado en `public/app.css` y `public/css/` con tokens semánticos HSL (`--bg-primary`, `--text-primary`, `--accent-color`, `--surface-card`, etc.).
   - Soporte automático y toggle de Tema Claro y Oscuro persistido en `localStorage` mediante `public/js/theme.js`.

3. **Desacoplamiento Modular de Lógica Frontend:**
   - **`ApiClient` (`public/js/api.js`):** Capa de transporte HTTP centralizada, interceptores de JWT, discriminación de errores de dominio y auto-detección de baseURL.
   - **`Components` (`public/js/components.js`):** Factorías puras de UI (`createMeterCard`, badges de estado, formatos numéricos y metrológicos).
   - **`ModalManager` y `ToastManager`:** Controladores de ventanas modales accesibles y notificaciones flotantes no intrusivas.
   - **`SyncManager` (`public/js/sync-manager.js`):** Gestor de cola fuera de línea para captura de lecturas en terreno.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Frameworks Pesados en Frontend:** La UI debe mantenerse en Vanilla JS (ES Modules) y CSS estándar para preservar la carga en < 100 ms y evitar empaquetadores pesados.
- **Cero Fugas en Plantillas:** Ninguna función que renderice HTML o inserte cadenas dinámicas debe producir `'undefined'`, `'null'` o `'NaN'`. Usar siempre valores por defecto defensivos.
- **Cero Mutaciones Directas de DOM sin Componentes:** Usar los métodos del Design System para renderizar tarjetas, alertas y modales.

---

## 4. Consecuencias

### Positivas
- Carga en frío del frontend en menos de 50 ms a nivel global desde la red Anycast de Cloudflare.
- Experiencia de usuario premium con modo oscuro, tipografía moderna y micro-animaciones fluidas.
- Mantenimiento sencillo: cambiar un archivo en `public/` se refleja inmediatamente sin procesos de build.

### Negativas / Trade-offs
- Requiere manipulación cuidadosa del DOM nativo en lugar de renderizado reactivo automático (ej. React/Vue).
