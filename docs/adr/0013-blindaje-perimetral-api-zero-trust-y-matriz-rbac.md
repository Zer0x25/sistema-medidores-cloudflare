# ADR 0013: Blindaje Perimetral Zero-Trust en Edge y Matriz de Permisos RBAC

- **Fecha:** 2026-10-05
- **Estado:** Aceptado (Inmutable)
- **Afecta a:** `src/index.ts`, `src/routes/*`, `src/types.ts`

---

## 1. Contexto y Problema
En sistemas expuestos a internet global mediante Cloudflare Workers:
- Cada endpoint `/api/*` puede recibir intentos de escaneo y explotación automatizada.
- Si la verificación de autenticación se deja a criterio de cada controlador individual, es inevitable que un desarrollador o agente olvide proteger una nueva ruta privada.
- Se requiere un perímetro Zero-Trust centralizado en la entrada del Worker con una matriz de roles estricta (Fail-Closed).

---

## 2. Decisión

1. **Perímetro de Autenticación Centralizado (Middleware Hono):**
   - En `src/index.ts`, se intercepta toda petición dirigida a `/api/*`.
   - **Lista Blanca Explícita (Allow-List):** Solo se permite el paso sin token a rutas explícitamente públicas:
     - `/api/auth/login`
     - `/api/auth/register`
     - `/api/health`
     - `/api/config`
     - `/api/demo/seed`
   - Si se presenta una cabecera `Authorization: Bearer <token>`, se verifica criptográficamente la firma con `JWT_SECRET`.
   - Si el token es inválido o expiró, se responde inmediatamente con `HTTP 401 { error: "UNAUTHORIZED" }`.

2. **Matriz Jerárquica de Control de Acceso (RBAC):**
   - **`ADMIN`:** Acceso irrestricto. Puede crear instalaciones, usuarios, editar configuraciones, ejecutar respaldos, bajas técnicas y consultar auditoría.
   - **`SUPERVISOR`:** Acceso de gestión y control. Puede crear medidores, registrar calibraciones, gestionar órdenes de mantenimiento y consultar auditoría. No puede crear instalaciones ni gestionar usuarios globales.
   - **`OPERADOR`:** Modo terreno exclusivo. Puede consultar medidores asignados, registrar lecturas y sincronizar lotes offline (`batch-sync`). Bloqueado con `HTTP 403 { error: "FORBIDDEN" }` ante intentos de acceder a auditoría, reportes ejecutivos o creación de infraestructura.

3. **Preservación de Tokens en Cambio de Contraseña:**
   - Si un usuario ingresa una contraseña actual errónea en `/cambiar-password`, el sistema responde con error de dominio tipado (`400` / `401`), pero el cliente web preserva el token de sesión para no desloguear forzadamente al usuario por un error tipográfico en el formulario.

---

## 3. Reglas Inmutables para Agentes de IA
- **Prohibido Endpoints Privados sin Verificación:** Todo nuevo endpoint que modifique o consulte datos de negocio debe requerir el objeto `user` autenticado vía `c.get("user")`.
- **Fallos Fail-Closed:** Ante la duda de permisos, el sistema debe denegar el acceso (`403 FORBIDDEN`), jamás permitirlo por omisión.

---

## 4. Consecuencias

### Positivas
- Protección robusta contra accesos no autorizados en la red perimetral de Cloudflare.
- Gobernanza limpia y predecible de permisos por rol.

### Negativas / Trade-offs
- Requiere inyectar tokens JWT válidos en todas las pruebas de integración que consuman rutas protegidas.
