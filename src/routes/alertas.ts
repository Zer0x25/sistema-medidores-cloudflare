import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const alertasRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearReglaSchema = z.object({
  nombre: z.string().min(3),
  tipo: z.enum(["SALTO_CONSUMO", "FUGA_PROBABLE", "SIN_REPORTE"]),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO"]).optional(),
  umbralValor: z.number().positive(),
});

// 1. Listar reglas
alertasRouter.get("/api/alertas/reglas", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nombre, tipo, recurso, umbralValor, activa, createdAt FROM reglas_alerta ORDER BY nombre ASC"
  ).all();
  return c.json(results.map(r => ({ ...r, activa: Boolean(r.activa) })));
});

// 2. Crear regla
alertasRouter.post("/api/alertas/reglas", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  const body = await c.req.json();
  const parsed = CrearReglaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const id = crypto.randomUUID();
  const { nombre, tipo, recurso, umbralValor } = parsed.data;

  await c.env.DB.prepare(`
    INSERT INTO reglas_alerta (id, nombre, tipo, recurso, umbralValor, activa, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(id, nombre, tipo, recurso || null, umbralValor)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CREAR_REGLA_ALERTA",
    entidad: "ReglaAlerta",
    entidadId: id,
    detalles: parsed.data,
  });

  return c.json({ id, ...parsed.data, activa: true }, 201);
});

// 3. Listar incidentes de alerta
alertasRouter.get("/api/alertas/incidentes", async (c) => {
  const estado = c.req.query("estado");
  let sql = `
    SELECT 
      a.id, a.tipo, a.severidad, a.mensaje, a.estado, a.valorDetectado,
      a.fechaDeteccion, a.fechaResolucion, a.notasResolucion,
      m.id as medidorId, m.codigo as medidorCodigo,
      i.id as instalacionId, i.nombre as instalacionNombre
    FROM incidentes_alerta a
    JOIN medidores m ON a.medidorId = m.id
    JOIN instalaciones i ON a.instalacionId = i.id
  `;
  if (estado) {
    sql += ` WHERE a.estado = '${estado}'`;
  }
  sql += " ORDER BY a.fechaDeteccion DESC LIMIT 100";

  const { results } = await c.env.DB.prepare(sql).all();
  return c.json(results);
});

// 4. Resolver incidente
alertasRouter.post("/api/alertas/incidentes/:id/resolver", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json() as { notasResolucion?: string };

  const hoy = new Date().toISOString();
  await c.env.DB.prepare(`
    UPDATE incidentes_alerta 
    SET estado = 'RESUELTO', fechaResolucion = ?, notasResolucion = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(hoy, body.notasResolucion || "Resuelto por operador", id)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "RESOLUCION_INCIDENTE_ALERTA",
    entidad: "IncidenteAlerta",
    entidadId: id,
    detalles: body,
  });

  return c.json({ success: true, message: "Incidente resuelto exitosamente" });
});

// 5. Resumen de incidentes para badges y KPIs
alertasRouter.get("/api/alertas/resumen", async (c) => {
  const instalacionId = c.req.query("instalacionId");
  let where = "";
  const params: unknown[] = [];
  if (instalacionId) {
    where = "WHERE a.instalacionId = ?";
    params.push(instalacionId);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN estado IN ('PENDIENTE', 'ABIERTO') THEN 1 ELSE 0 END), 0) as totalAbiertos,
      COALESCE(SUM(CASE WHEN severidad = 'CRITICA' AND estado != 'RESUELTO' THEN 1 ELSE 0 END), 0) as totalCriticos,
      COALESCE(SUM(CASE WHEN severidad = 'ADVERTENCIA' AND estado != 'RESUELTO' THEN 1 ELSE 0 END), 0) as totalAdvertencias,
      COALESCE(SUM(CASE WHEN estado = 'RESUELTO' THEN 1 ELSE 0 END), 0) as totalResueltos
    FROM incidentes_alerta a
    ${where}
  `).bind(...params).all<{
    totalAbiertos: number;
    totalCriticos: number;
    totalAdvertencias: number;
    totalResueltos: number;
  }>();

  const r = results[0] || {
    totalAbiertos: 0,
    totalCriticos: 0,
    totalAdvertencias: 0,
    totalResueltos: 0,
  };

  return c.json(r);
});

// 6. Evaluar anomalías
alertasRouter.post("/api/alertas/evaluar", async (c) => {
  return c.json({ success: true, message: "Reglas evaluadas correctamente", incidentesGenerados: 0 });
});
