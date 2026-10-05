import { Hono } from "hono";
import { z } from "zod";
import crypto from "node:crypto";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const webhooksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearWebhookSchema = z.object({
  url: z.string().url("URL de destino inválida"),
  descripcion: z.string().min(3, "La descripción debe tener al menos 3 caracteres"),
  secret: z.string().optional().nullable(),
  eventos: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  activo: z.boolean().optional(),
});

const ActualizarWebhookSchema = z.object({
  url: z.string().url("URL de destino inválida").optional(),
  descripcion: z.string().min(3).optional(),
  secret: z.string().optional().nullable(),
  eventos: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  activo: z.boolean().optional(),
});

// Listar webhooks configurados
webhooksRouter.get("/api/webhooks", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, url, descripcion, secret, eventos, activo, createdAt, updatedAt FROM webhook_endpoints ORDER BY createdAt DESC"
  ).all<{
    id: string;
    url: string;
    descripcion: string;
    secret: string | null;
    eventos: string;
    activo: number;
    createdAt: string;
    updatedAt: string;
  }>();

  return c.json(
    results.map((w) => {
      let evs: string[] = ["*"];
      try {
        if (typeof w.eventos === "string" && w.eventos.startsWith("[")) {
          evs = JSON.parse(w.eventos);
        } else if (w.eventos) {
          evs = [w.eventos];
        }
      } catch {
        evs = [w.eventos];
      }

      return {
        id: w.id,
        url: w.url,
        descripcion: w.descripcion,
        eventos: evs,
        hasSecret: Boolean(w.secret),
        activo: Boolean(w.activo),
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      };
    })
  );
});

// Registrar nuevo webhook
webhooksRouter.post("/api/webhooks", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "BAD_REQUEST", message: "JSON inválido" }, 400);
  }

  const parsed = CrearWebhookSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos", details: parsed.error.issues }, 400);

  const id = crypto.randomUUID();
  const { url, descripcion, secret, eventos, activo } = parsed.data;
  const eventosStr = Array.isArray(eventos) ? JSON.stringify(eventos) : (eventos || "*");
  const activoNum = activo === false ? 0 : 1;

  await c.env.DB.prepare(`
    INSERT INTO webhook_endpoints (id, url, descripcion, secret, eventos, activo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(id, url, descripcion, secret || null, eventosStr, activoNum)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CREAR_WEBHOOK_ENDPOINT",
    entidad: "WebhookEndpoint",
    entidadId: id,
    detalles: { url, eventos: eventosStr },
  });

  return c.json(
    {
      id,
      url,
      descripcion,
      eventos: Array.isArray(eventos) ? eventos : [eventos || "*"],
      hasSecret: Boolean(secret),
      activo: activoNum === 1,
    },
    201
  );
});

// Actualizar webhook (pausar, activar, cambiar configuración)
webhooksRouter.patch("/api/webhooks/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ error: "NOT_FOUND", message: "Webhook no encontrado" }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "BAD_REQUEST", message: "JSON inválido" }, 400);
  }

  const parsed = ActualizarWebhookSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos", details: parsed.error.issues }, 400);

  const { url, descripcion, secret, eventos, activo } = parsed.data;
  const eventosStr = eventos !== undefined ? (Array.isArray(eventos) ? JSON.stringify(eventos) : eventos) : undefined;
  const activoNum = activo !== undefined ? (activo ? 1 : 0) : undefined;

  await c.env.DB.prepare(`
    UPDATE webhook_endpoints
    SET
      url = COALESCE(?, url),
      descripcion = COALESCE(?, descripcion),
      secret = COALESCE(?, secret),
      eventos = COALESCE(?, eventos),
      activo = COALESCE(?, activo),
      updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(
      url ?? null,
      descripcion ?? null,
      secret ?? null,
      eventosStr ?? null,
      activoNum ?? null,
      id
    )
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "ACTUALIZAR_WEBHOOK_ENDPOINT",
    entidad: "WebhookEndpoint",
    entidadId: id,
    detalles: parsed.data,
  });

  const updated = await c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id = ?").bind(id).first<{
    id: string;
    url: string;
    descripcion: string;
    secret: string | null;
    eventos: string;
    activo: number;
    createdAt: string;
    updatedAt: string;
  }>();

  if (!updated) return c.json({ error: "NOT_FOUND", message: "Webhook no encontrado" }, 404);

  return c.json({
    id: updated.id,
    url: updated.url,
    descripcion: updated.descripcion,
    hasSecret: Boolean(updated.secret),
    activo: Boolean(updated.activo),
  });
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
    descripcion: string;
    secret: string | null;
  }>();

  if (!webhook) return c.json({ error: "NOT_FOUND", message: "Webhook no encontrado" }, 404);

  const payloadObj = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event: "test.ping",
    severity: "INFO",
    title: "Test Ping de Conectividad - Sistema Medidores",
    message: "Este es un mensaje de prueba para verificar la integración con el enrutador de webhooks.",
    data: {
      webhookId: webhook.id,
      descripcion: webhook.descripcion,
      timestamp: new Date().toISOString(),
    },
  };
  const payload = JSON.stringify(payloadObj);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Sistema-Medidores-Cloudflare-Webhook/1.0",
  };

  if (webhook.secret) {
    const signature = crypto.createHmac("sha256", webhook.secret).update(payload).digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  // Redirigir localhost:3000 al puerto del worker activo si corresponde
  let targetUrl = webhook.url;
  try {
    const parsedUrl = new URL(targetUrl);
    if ((parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost") && parsedUrl.port === "3000") {
      const currentHost = c.req.header("host") || "127.0.0.1:8787";
      const currentPort = currentHost.split(":")[1] || "8787";
      parsedUrl.port = currentPort;
      targetUrl = parsedUrl.toString();
    }
  } catch {
    // Si no es URL estándar, mantener original
  }

  const t0 = performance.now();
  let statusCode: number | null = null;
  let exitoso = false;
  let errorMsg: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    statusCode = resp.status;
    exitoso = resp.ok;
    if (!resp.ok) {
      const bodySnippet = await resp.text().catch(() => "");
      errorMsg = `HTTP ${resp.status}: ${bodySnippet.slice(0, 200)}`;
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Fallo de conexión";
  }

  const duracionMs = Math.round(performance.now() - t0);
  const entregaId = crypto.randomUUID();

  // Guardar registro inmutable de la entrega
  await c.env.DB.prepare(`
    INSERT INTO webhook_entregas (id, webhookId, evento, url, statusCode, exitoso, error, duracionMs, createdAt)
    VALUES (?, ?, 'test.ping', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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

// Listar entregas de un webhook específico
webhooksRouter.get("/api/webhooks/:id/entregas", async (c) => {
  const id = c.req.param("id");
  const limitParam = Number.parseInt(c.req.query("limit") || "50", 10);
  const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 100);

  const { results } = await c.env.DB.prepare(`
    SELECT id, webhookId, evento, url, statusCode, exitoso, error, duracionMs, createdAt
    FROM webhook_entregas
    WHERE webhookId = ?
    ORDER BY createdAt DESC
    LIMIT ?
  `)
    .bind(id, limit)
    .all<{
      id: string;
      webhookId: string;
      evento: string;
      url: string;
      statusCode: number | null;
      exitoso: number;
      error: string | null;
      duracionMs: number | null;
      createdAt: string;
    }>();

  return c.json(
    results.map((r) => ({
      ...r,
      exitoso: Boolean(r.exitoso),
    }))
  );
});

// Listar todas las entregas de webhooks globales
webhooksRouter.get("/api/webhooks/entregas", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT e.*, w.descripcion as webhookDescripcion
    FROM webhook_entregas e
    JOIN webhook_endpoints w ON e.webhookId = w.id
    ORDER BY e.createdAt DESC LIMIT 50
  `).all();

  return c.json(results.map((r) => ({ ...r, exitoso: Boolean(r.exitoso) })));
});

// Chequeo proactivo de calibraciones
webhooksRouter.post("/api/webhooks/check-calibraciones", async (c) => {
  return c.json({
    medidoresEvaluados: 0,
    eventosDespachados: 0,
    detalles: [],
  });
});
