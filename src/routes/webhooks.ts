import { Hono } from "hono";
import { z } from "zod";
import crypto from "node:crypto";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const webhooksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const WebhookSchema = z.object({
  url: z.string().url(),
  descripcion: z.string().min(3),
  secret: z.string().optional(),
  eventos: z.string().default("*"),
});

// Listar webhooks configurados
webhooksRouter.get("/api/webhooks", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, url, descripcion, eventos, activo, createdAt, updatedAt FROM webhook_endpoints ORDER BY createdAt DESC"
  ).all();

  return c.json(results.map(w => ({ ...w, activo: Boolean(w.activo) })));
});

// Registrar nuevo webhook
webhooksRouter.post("/api/webhooks", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  const body = await c.req.json();
  const parsed = WebhookSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const id = crypto.randomUUID();
  const { url, descripcion, secret, eventos } = parsed.data;

  await c.env.DB.prepare(`
    INSERT INTO webhook_endpoints (id, url, descripcion, secret, eventos, activo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(id, url, descripcion, secret || null, eventos)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CREAR_WEBHOOK_ENDPOINT",
    entidad: "WebhookEndpoint",
    entidadId: id,
    detalles: { url, eventos },
  });

  return c.json({ id, url, descripcion, eventos, activo: true }, 201);
});

// Eliminar webhook
webhooksRouter.delete("/api/webhooks/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM webhook_endpoints WHERE id = ?").bind(id).run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "ELIMINAR_WEBHOOK_ENDPOINT",
    entidad: "WebhookEndpoint",
    entidadId: id,
  });

  return c.json({ success: true, message: "Webhook eliminado" });
});

// Test de despacho de webhook con firma HMAC-SHA256 (ADR 0005)
webhooksRouter.post("/api/webhooks/:id/test", async (c) => {
  const id = c.req.param("id");
  const webhook = await c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id = ?").bind(id).first<{
    id: string;
    url: string;
    secret: string | null;
  }>();

  if (!webhook) return c.json({ error: "NOT_FOUND", message: "Webhook no encontrado" }, 404);

  const payload = JSON.stringify({
    evento: "sistema.test_ping",
    timestamp: new Date().toISOString(),
    mensaje: "Ping de prueba desde Cloudflare Workers",
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Sistema-Medidores-Cloudflare-Webhook/1.0",
  };

  if (webhook.secret) {
    const signature = crypto.createHmac("sha256", webhook.secret).update(payload).digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  const t0 = performance.now();
  let statusCode: number | null = null;
  let exitoso = false;
  let errorMsg: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    statusCode = resp.status;
    exitoso = resp.ok;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Fallo de conexión";
  }

  const duracionMs = Math.round(performance.now() - t0);
  const entregaId = crypto.randomUUID();

  // Guardar registro inmutable de la entrega
  await c.env.DB.prepare(`
    INSERT INTO webhook_entregas (id, webhookId, evento, url, statusCode, exitoso, error, duracionMs, createdAt)
    VALUES (?, ?, 'sistema.test_ping', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)
    .bind(entregaId, id, webhook.url, statusCode, exitoso ? 1 : 0, errorMsg, duracionMs)
    .run();

  return c.json({
    exitoso,
    statusCode,
    duracionMs,
    error: errorMsg,
  });
});

// Listar entregas de webhooks
webhooksRouter.get("/api/webhooks/entregas", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT e.*, w.descripcion as webhookDescripcion
    FROM webhook_entregas e
    JOIN webhook_endpoints w ON e.webhookId = w.id
    ORDER BY e.createdAt DESC LIMIT 50
  `).all();

  return c.json(results.map(r => ({ ...r, exitoso: Boolean(r.exitoso) })));
});
