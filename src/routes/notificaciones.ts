import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";

export const notificacionesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const PushSubSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

// Guardar suscripción Push PWA
notificacionesRouter.post("/api/notificaciones/suscripcion-push", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = PushSubSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos de suscripción inválidos" }, 400);

  const { endpoint, p256dh, auth } = parsed.data;
  const id = crypto.randomUUID();
  const usuarioId = user ? user.id : null;

  await c.env.DB.prepare(`
    INSERT INTO suscripciones_push (id, usuarioId, endpoint, p256dh, auth, activa, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET
      usuarioId = excluded.usuarioId,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      activa = 1,
      updatedAt = CURRENT_TIMESTAMP
  `)
    .bind(id, usuarioId, endpoint, p256dh, auth)
    .run();

  return c.json({ success: true, message: "Suscripción guardada" }, 201);
});

// Desactivar suscripción Push
notificacionesRouter.delete("/api/notificaciones/suscripcion-push", async (c) => {
  const body = await c.req.json() as { endpoint?: string };
  if (!body.endpoint) return c.json({ error: "BAD_REQUEST", message: "Endpoint requerido" }, 400);

  await c.env.DB.prepare("UPDATE suscripciones_push SET activa = 0, updatedAt = CURRENT_TIMESTAMP WHERE endpoint = ?")
    .bind(body.endpoint)
    .run();

  return c.json({ success: true, message: "Suscripción cancelada" });
});

// Historial de notificaciones
notificacionesRouter.get("/api/notificaciones/historial", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM notificaciones_historial ORDER BY createdAt DESC LIMIT 50"
  ).all();

  return c.json(results.map(r => ({ ...r, exitoso: Boolean(r.exitoso) })));
});

// Test de despacho de notificación
notificacionesRouter.post("/api/notificaciones/test", async (c) => {
  const body = await c.req.json() as { canal?: string; mensaje?: string };
  const canal = body.canal || "WEB_PUSH";
  const mensaje = body.mensaje || "Alerta de prueba desde Cloudflare Workers";

  const id = crypto.randomUUID();
  const t0 = performance.now();

  // Registro del intento
  await c.env.DB.prepare(`
    INSERT INTO notificaciones_historial (id, canal, destinatario, evento, severidad, titulo, exitoso, statusCode, duracionMs, createdAt)
    VALUES (?, ?, 'broadcast', 'sistema.alerta_test', 'INFO', ?, 1, 200, ?, CURRENT_TIMESTAMP)
  `)
    .bind(id, canal, mensaje, Math.round(performance.now() - t0))
    .run();

  return c.json({ success: true, message: "Notificación de prueba registrada" });
});
