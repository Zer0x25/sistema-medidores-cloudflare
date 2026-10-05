# ☁️ Sistema Medidores - Cloudflare Workers & D1 (Edge Native)

Este directorio es un **proyecto autónomo e independiente** listo para desarrollo local y despliegue en la infraestructura serverless de **Cloudflare (Workers + D1 + Assets)**.

Puedes trabajar aquí dentro del repositorio principal o copiar esta carpeta completa a otro directorio y ejecutar `git init` para convertirla en un repositorio separado.

---

## 🛠️ Stack Tecnológico

* **Runtime:** Cloudflare Workers (`workerd` / V8 Isolates).
* **Framework:** [Hono v4](https://hono.dev/) (ultrarrápido, tipado estricto, nativo para Workers).
* **Base de Datos:** [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite serverless distribuido en el edge).
* **ORM:** Prisma Client con `@prisma/adapter-d1` (o consultas D1 preparadas de baja latencia).
* **Validación:** [Zod](https://zod.dev/).
* **Frontend:** Single Page Application (HTML5, CSS3, JS, PWA) servida nativamente mediante Cloudflare Workers Static Assets (`assets: { directory: "./public" }`).
* **Telemetría:** Middleware estándar `Server-Timing` y profiling con Chrome DevTools vía Wrangler.

---

## 🚀 Inicio Rápido en Desarrollo Local (100% Offline)

Wrangler emula todo el ecosistema de Cloudflare en tu máquina sin necesidad de conexión a internet.

### 1. Instalar dependencias
Desde la terminal, entra a esta carpeta:
```bash
cd deploy-cloudflare
npm install
```

### 2. Inicializar la base de datos SQLite D1 en local
Ejecuta las migraciones y el seed inicial en tu base de datos local emulada:
```bash
# 1. Crear las tablas en local
npm run db:migrate:local

# 2. Cargar datos de prueba (usuarios, instalaciones, medidores)
npm run db:seed:local
```

### 3. Iniciar el servidor de desarrollo
```bash
npm run dev
```
Tu aplicación estará disponible de inmediato en:
* **Frontend Web (SPA):** `http://localhost:8787/`
* **Liveness Probe:** `http://localhost:8787/healthz`
* **Readiness Probe (D1):** `http://localhost:8787/readyz`
* **API Health:** `http://localhost:8787/api/health`
* **API Dashboard:** `http://localhost:8787/api/dashboard/kpis`

---

## ⏱️ Cómo Medir los Tiempos de Solicitud en Desarrollo

Este proyecto incluye herramientas para auditar tus tiempos de ejecución y asegurar que nunca superes los límites de Cloudflare:

### A. Tiempos en la Terminal
Cada llamada imprime automáticamente el tiempo de procesamiento en milisegundos:
```text
[Worker] GET /api/dashboard/kpis -> 200 (4.15 ms)
[Worker] POST /api/lecturas -> 201 (7.80 ms)
```

### B. Desglose en DevTools del Navegador (`Server-Timing`)
Abre tu navegador en `http://localhost:8787`:
1. Presiona `F12` y ve a la pestaña **Network (Red)**.
2. Haz clic en cualquier petición `/api/...`.
3. Ve a la subpestaña **Timing**.
4. Verás las métricas de `Server-Timing` inyectadas por el middleware `timing()` de Hono.

### C. CPU Profiler de Chrome en tiempo real
En la terminal donde corre `npm run dev`:
* Presiona la tecla **`d`**.
* Wrangler abrirá automáticamente una pestaña de **Chrome DevTools** conectada al runtime V8 local.
* En la pestaña **Profiler**, puedes grabar la ejecución para ver el *Flamegraph* y los microsegundos exactos de CPU consumidos por tu código.

---

## 🔑 Credenciales de Prueba (Seed Inicial)

* **Administrador:** `admin@medidores.cl` / `demo1234`
* **Supervisor:** `supervisor@medidores.cl` / `demo1234`
* **Operador:** `operador@medidores.cl` / `demo1234`

---

## ☁️ Despliegue a Producción en Cloudflare

Cuando decidas publicar tu aplicación a los servidores globales de Cloudflare:

1. **Iniciar sesión en Cloudflare:**
   ```bash
   npx wrangler login
   ```

2. **Crear la base de datos D1 en la nube:**
   ```bash
   npx wrangler d1 create sistema-medidores-db
   ```
   *Copia el `database_id` que te devuelva Cloudflare y pégalo en tu archivo `wrangler.jsonc`.*

3. **Aplicar las migraciones en la nube:**
   ```bash
   npm run db:migrate:remote
   ```

4. **Publicar el Worker y el Frontend:**
   ```bash
   npm run deploy
   ```
   Cloudflare te entregará una URL global permanente del tipo `https://sistema-medidores-edge.<tu-subdominio>.workers.dev`.
