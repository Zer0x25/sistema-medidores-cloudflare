import { Hono } from "hono";
import { cors } from "hono/cors";
import { timing } from "hono/timing";
import type { Env, Variables } from "./types.js";
import { verifyJwt } from "./auth.js";
import { healthRouter } from "./routes/health.js";
import { usuariosRouter } from "./routes/usuarios.js";
import { instalacionesRouter } from "./routes/instalaciones.js";
import { medidoresRouter } from "./routes/medidores.js";
import { lecturasRouter } from "./routes/lecturas.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { alertasRouter } from "./routes/alertas.js";
import { mantenimientoRouter } from "./routes/mantenimiento.js";
import { auditoriaRouter } from "./routes/auditoria.js";
import { reportesRouter } from "./routes/reportes.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { notificacionesRouter } from "./routes/notificaciones.js";
import { demoRouter } from "./routes/demo.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Middleware de telemetría y medición de tiempo (Server-Timing estándar)
app.use("*", timing());

// 2. Middleware de logging con tiempo de ejecución en consola
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(2);
  console.log(`[Worker] ${c.req.method} ${c.req.path} -> ${c.res.status} (${ms} ms)`);
});

// 3. CORS
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-e2e-client"],
}));

// 4. Hook de Autenticación y extracción de JWT
app.use("/api/*", async (c, next) => {
  // Rutas públicas exentas de autenticación
  const publicRoutes = ["/api/auth/login", "/api/auth/register", "/api/health", "/api/config", "/api/demo/seed"];
  if (publicRoutes.some(route => c.req.path.startsWith(route))) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    try {
      const user = verifyJwt(token, c.env.JWT_SECRET);
      c.set("user", user);
    } catch {
      if (!c.req.path.includes("/cambiar-password")) {
        return c.json({ error: "UNAUTHORIZED", message: "Token inválido o expirado" }, 401);
      }
    }
  }

  await next();
});

// 5. Manejo Global de Errores
app.onError((err, c) => {
  console.error("❌ [Worker Error]", err);
  return c.json({
    error: "INTERNAL_SERVER_ERROR",
    message: err.message || "Error interno del servidor",
  }, 500);
});

// 6. Registro de Todos los Módulos de Dominio Migrados
app.route("/", healthRouter);
app.route("/", usuariosRouter);
app.route("/", instalacionesRouter);
app.route("/", medidoresRouter);
app.route("/", lecturasRouter);
app.route("/", dashboardRouter);
app.route("/", alertasRouter);
app.route("/", mantenimientoRouter);
app.route("/", auditoriaRouter);
app.route("/", reportesRouter);
app.route("/", webhooksRouter);
app.route("/", notificacionesRouter);
app.route("/", demoRouter);

// 7. Despacho de Archivos Estáticos (Frontend SPA en ./public vía Workers Assets)
app.get("*", async (c) => {
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("Sistema Medidores API - Cloudflare Workers", 200);
});

export default app;
