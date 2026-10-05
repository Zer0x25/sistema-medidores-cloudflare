import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

export const dashboardRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboardRouter.get("/api/dashboard/kpis", async (c) => {
  // 1. Total medidores y activos
  const medidoresStat = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN activo = 1 THEN 1 ELSE 0 END) as activos
    FROM medidores
  `).first<{ total: number; activos: number }>();

  // 2. Total lecturas registradas
  const lecturasStat = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM lecturas
  `).first<{ total: number }>();

  // 3. Total alertas abiertas
  const alertasStat = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM incidentes_alerta WHERE estado = 'ABIERTO'
  `).first<{ total: number }>();

  return c.json({
    medidoresTotales: medidoresStat?.total || 0,
    medidoresActivos: medidoresStat?.activos || 0,
    lecturasRegistradas: lecturasStat?.total || 0,
    alertasActivas: alertasStat?.total || 0,
    timestamp: new Date().toISOString(),
  });
});
