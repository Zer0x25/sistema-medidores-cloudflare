# ADR 0011: Fichas Móviles Táctiles y Adaptabilidad Responsiva en Tablas

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `public/app.css`, `public/js/components.js`, `public/index.html`

---

## 1. Contexto y Problema
En dispositivos móviles de 360px a 430px de ancho:
- Las tablas HTML convencionales con múltiples columnas generan desplazamiento horizontal forzado (horizontal scrolling), degradando severamente la experiencia de captura en terreno.
- Los botones pequeños y enlaces estrechos causan pulsaciones erróneas con guantes o dedos en movimiento.
- Se requiere una representación visual adaptativa: tablas densas en pantallas de escritorio y tarjetas apiladas en pantallas móviles.

---

## 2. Decisión

1. **Diseño Mobile-First con Tarjetas Apiladas (Meter Cards):**
   - En pantallas móviles (< 768px), los medidores y lecturas se renderizan como fichas o tarjetas táctiles independientes (`.meter-card`).
   - Cada tarjeta contiene: badge de recurso con código de color (azul para agua, amarillo para luz, naranja para gas, púrpura para petróleo), código de equipo, ubicación interna y lectura destacada con unidad de medida.

2. **Áreas Táctiles Mínimas (Touch Targets):**
   - Todo botón interactivo, selector o disparador de modal en entorno móvil tiene un área táctil mínima de **44px × 44px** cumpliendo pautas de accesibilidad WCAG.

3. **Degradación Elegante de Tablas en Móvil:**
   - Para vistas administrativas o de auditoría con tablas complejas, se aplica contenedor scrollable con sombra indicadora o transformación a lista de pares clave-valor (`data-label`).

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Desplazamiento Horizontal Involuntario:** Ningún componente o contenedor debe forzar scroll horizontal en el viewport móvil (`overflow-x: hidden` en el contenedor principal).
- **Consistencia Visual de Recursos:** Mantener siempre la paleta semántica por recurso (Agua: Cyan/Blue, Luz: Amber, Gas: Orange, Petróleo: Violet).

---

## 4. Consecuencias

### Positivas
- Agilidad y precisión extrema para operadores en terreno usando teléfonos móviles con una sola mano.
- Alta legibilidad sin necesidad de hacer zoom manual.

### Negativas / Trade-offs
- Mayor altura vertical de scroll en listas muy extensas en dispositivos móviles.
