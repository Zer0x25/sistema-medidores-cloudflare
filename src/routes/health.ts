import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

export const healthRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Liveness Probe: verifica vivacidad del runtime sin consultar la base de datos
healthRouter.get("/healthz", (c) => {
  return c.json({
    status: "ok",
    runtime: "cloudflare-workers",
    timestamp: new Date().toISOString(),
  }, 200);
});

// Readiness Probe: verifica conectividad real con Cloudflare D1
healthRouter.get("/readyz", async (c) => {
  try {
    const res = await c.env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
    if (res && res.ok === 1) {
      return c.json({
        status: "ready",
        database: "connected",
        timestamp: new Date().toISOString(),
      }, 200);
    }
    return c.json({ status: "not_ready", database: "unexpected_result" }, 503);
  } catch (err) {
    return c.json({
      status: "not_ready",
      database: "disconnected",
      error: err instanceof Error ? err.message : "Error desconocido",
    }, 503);
  }
});

// API Health
healthRouter.get("/api/health", async (c) => {
  const t0 = performance.now();
  let dbStatus = "connected";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    dbStatus = "disconnected";
  }

  const durationMs = (performance.now() - t0).toFixed(2);
  return c.json({
    status: dbStatus === "connected" ? "ok" : "degraded",
    environment: c.env.NODE_ENV || "production",
    database: dbStatus,
    responseTimeMs: `${durationMs}ms`,
  });
});
