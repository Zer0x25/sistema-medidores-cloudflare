# ADR 0012: Identificación Visual Diferenciada por Entorno y Selector Rápido de Roles

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/routes/health.ts`, `public/js/api.js`, `public/index.html`

---

## 1. Contexto y Problema
Al operar simultáneamente en entornos locales (`http://localhost:8787`), staging o producción (`https://metric.zer0x.org`):
- Los desarrolladores o testers corren el riesgo de confundir la pestaña del navegador y realizar mutaciones destructivas o pruebas con datos ficticios en producción pensando que están en local.
- Durante el desarrollo local, alternar constantemente entre usuarios con distintos roles (`ADMIN`, `SUPERVISOR`, `OPERADOR`) cerrando sesión y volviendo a loguearse ralentiza el flujo de trabajo.

---

## 2. Decisión

1. **Endpoint Público de Configuración de Entorno (`GET /api/config`):**
   - El Worker expone la variable `c.env.NODE_ENV` (`development` | `staging` | `production`).
   - Retorna:
     ```json
     {
       "env": "development",
       "features": {
         "devRoleSwitcher": true
       }
     }
     ```
   - La propiedad `devRoleSwitcher` se desactiva estrictamente en producción (`env === "production"` -> `false`).

2. **Indicador Visual de Entorno (Banner de Desarrollo):**
   - En entornos locales o de prueba, la interfaz despliega un distintivo visual visible ("MODO DESARROLLO") en la barra superior.
   - En producción, el banner desaparece por completo ofreciendo una experiencia limpia.

3. **Selector Rápido de Roles para Desarrollo:**
   - Si `features.devRoleSwitcher` es verdadero, la interfaz muestra un dropdown rápido que permite alternar el token activo entre los perfiles demo (`Admin`, `Supervisor`, `Operador`) sin tener que ingresar credenciales manualmente.
   - En producción, este selector no se renderiza bajo ninguna circunstancia.

---

## 3. Reglas Inmutables para Agentes de IA
- **Protección Incondicional de Producción:** Prohibido habilitar `devRoleSwitcher` cuando `NODE_ENV === "production"`.
- **Autenticación Real Preservada:** El selector de desarrollo no altera las reglas perimetrales del backend: el backend siempre exige y valida el token JWT firmado correspondiente al rol simulado.

---

## 4. Consecuencias

### Positivas
- Prevención total de accidentes operacionales en la nube de producción.
- Aceleración radical en las pruebas manuales locales de los 3 niveles de permisos RBAC.

### Negativas / Trade-offs
- Una llamada HTTP inicial adicional `/api/config` al arrancar el frontend (mitigada por respuesta instantánea en < 1ms).
