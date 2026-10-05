import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

export const auditoriaRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Consultar bitácora de auditoría inmutable (Solo ADMIN y SUPERVISOR)
auditoriaRouter.get("/api/auditoria", async (c) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Acceso exclusivo para auditoría" }, 403);
  }

  const entidad = c.req.query("entidad");
  const accion = c.req.query("accion");
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);

  let sql = `
    SELECT 
      a.id, a.accion, a.entidad, a.entidadId, a.detalles, a.ip, a.createdAt,
      u.email as usuarioEmail, u.nombre as usuarioNombre
    FROM auditoria_eventos a
    LEFT JOIN usuarios u ON a.usuarioId = u.id
  `;

  const wheres: string[] = [];
  if (entidad) wheres.push(`a.entidad = '${entidad}'`);
  if (accion) wheres.push(`a.accion = '${accion}'`);

  if (wheres.length > 0) {
    sql += " WHERE " + wheres.join(" AND ");
  }

  sql += ` ORDER BY a.createdAt DESC LIMIT ${limit}`;

  const { results } = await c.env.DB.prepare(sql).all();

  const formatted = results.map((row) => ({
    id: row.id,
    accion: row.accion,
    entidad: row.entidad,
    entidadId: row.entidadId,
    detalles: row.detalles ? (typeof row.detalles === "string" ? JSON.parse(row.detalles) : row.detalles) : null,
    ip: row.ip,
    createdAt: row.createdAt,
    usuario: row.usuarioEmail ? {
      email: row.usuarioEmail,
      nombre: row.usuarioNombre,
    } : null,
  }));

  return c.json(formatted);
});

// Detalle de evento
auditoriaRouter.get("/api/auditoria/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Acceso restringido" }, 403);

  const id = c.req.param("id");
  const evento = await c.env.DB.prepare("SELECT * FROM auditoria_eventos WHERE id = ?").bind(id).first();
  if (!evento) return c.json({ error: "NOT_FOUND", message: "Evento de auditoría no encontrado" }, 404);

  return c.json(evento);
});
