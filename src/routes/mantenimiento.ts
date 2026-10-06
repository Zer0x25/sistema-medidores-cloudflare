import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";
import { sqlInList } from "../db.js";

export const mantenimientoRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const RegistroMantenimientoSchema = z.object({
  medidorId: z.string().min(1),
  tipo: z.enum(["CALIBRACION", "CAMBIO_PRECINTO", "REEMPLAZO_EQUIPO", "INSPECCION", "BAJA_TECNICA"]),
  tecnicoResponsable: z.string().min(2),
  numeroPrecintoAnterior: z.string().optional(),
  numeroPrecintoNuevo: z.string().optional(),
  proximaCalibracion: z.string().optional(),
  certificadoCalibracion: z.string().optional(),
  lecturaRetiro: z.number().optional(),
  motivoBaja: z.string().optional(),
  nuevoMedidorCodigo: z.string().optional(),
  observaciones: z.string().optional(),
});

// Listar todos los registros de mantenimiento
mantenimientoRouter.get("/api/mantenimiento", async (c) => {
  const user = c.get("user");
  let whereClause = "";
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    whereClause = `WHERE m.instalacionId IN (${sqlInList(allowed)})`;
  }

  const { results } = await c.env.DB.prepare(`
    SELECT 
      rm.*,
      m.codigo as medidorCodigo,
      i.nombre as instalacionNombre
    FROM registros_mantenimiento rm
    JOIN medidores m ON rm.medidorId = m.id
    JOIN instalaciones i ON m.instalacionId = i.id
    ${whereClause}
    ORDER BY rm.fechaMantenimiento DESC LIMIT 100
  `).all();

  return c.json(results);
});

// Historial y ficha de un medidor específico
mantenimientoRouter.get("/api/mantenimiento/medidor/:medidorId", async (c) => {
  const user = c.get("user");
  const medidorId = c.req.param("medidorId");

  const medidor = await c.env.DB.prepare(`
    SELECT 
      m.id, m.codigo, m.numeroSerie, m.ubicacionInterna, m.activo, m.precintoActual,
      m.fechaUltimaCalibracion, m.fechaProximaCalibracion, m.createdAt,
      i.id as instalacionId, i.nombre as instalacionNombre,
      t.id as tipoMedidorId, t.nombre as tipoNombre, t.recurso, t.unidad, t.tipoMedicion,
      (SELECT valor FROM lecturas l WHERE l.medidorId = m.id ORDER BY l.fechaLectura DESC LIMIT 1) as ultimaLecturaValor
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.id = ?
  `).bind(medidorId).first<{
    id: string;
    codigo: string;
    numeroSerie: string | null;
    ubicacionInterna: string;
    activo: number;
    precintoActual: string | null;
    fechaUltimaCalibracion: string | null;
    fechaProximaCalibracion: string | null;
    createdAt: string;
    instalacionId: string;
    instalacionNombre: string;
    tipoMedidorId: string;
    tipoNombre: string;
    recurso: string;
    unidad: string;
    tipoMedicion: string;
    ultimaLecturaValor: number | null;
  }>();

  if (!medidor) {
    return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  }

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(medidor.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
    }
  }

  const { results: historial } = await c.env.DB.prepare(`
    SELECT 
      rm.*,
      m.codigo as medidorCodigo,
      i.nombre as instalacionNombre
    FROM registros_mantenimiento rm
    JOIN medidores m ON rm.medidorId = m.id
    JOIN instalaciones i ON m.instalacionId = i.id
    WHERE rm.medidorId = ?
    ORDER BY rm.fechaMantenimiento DESC
  `).bind(medidorId).all();

  return c.json({
    ...medidor,
    activo: Boolean(medidor.activo),
    historial,
  });
});

// Registrar mantenimiento directo
mantenimientoRouter.post("/api/mantenimiento", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = RegistroMantenimientoSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const id = crypto.randomUUID();
  const data = parsed.data;

  const medidor = await c.env.DB.prepare("SELECT id, instalacionId FROM medidores WHERE id = ?").bind(data.medidorId).first<{ id: string; instalacionId: string }>();
  if (!medidor) {
    return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  }

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(medidor.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
    }
  }

  // Actualizar el medidor según el tipo de intervención
  if (data.tipo === "BAJA_TECNICA" || data.tipo === "REEMPLAZO_EQUIPO") {
    await c.env.DB.prepare("UPDATE medidores SET activo = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(data.medidorId).run();
  }
  if (data.tipo === "CAMBIO_PRECINTO" && data.numeroPrecintoNuevo) {
    await c.env.DB.prepare("UPDATE medidores SET precintoActual = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(data.numeroPrecintoNuevo, data.medidorId).run();
  }
  if (data.tipo === "CALIBRACION") {
    const hoy = new Date().toISOString();
    await c.env.DB.prepare("UPDATE medidores SET fechaUltimaCalibracion = ?, fechaProximaCalibracion = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(hoy, data.proximaCalibracion || null, data.medidorId).run();
  }

  await c.env.DB.prepare(`
    INSERT INTO registros_mantenimiento (
      id, medidorId, tipo, tecnicoResponsable, numeroPrecintoAnterior, numeroPrecintoNuevo,
      proximaCalibracion, certificadoCalibracion, lecturaRetiro, motivoBaja,
      nuevoMedidorCodigo, observaciones, fechaMantenimiento, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(
      id, data.medidorId, data.tipo, data.tecnicoResponsable,
      data.numeroPrecintoAnterior || null, data.numeroPrecintoNuevo || null,
      data.proximaCalibracion || null, data.certificadoCalibracion || null,
      data.lecturaRetiro || null, data.motivoBaja || null,
      data.nuevoMedidorCodigo || null, data.observaciones || null
    )
    .run();

  let accionAuditoria = `MANTENIMIENTO_${data.tipo}`;
  if (data.tipo === "BAJA_TECNICA" || data.tipo === "REEMPLAZO_EQUIPO") {
    accionAuditoria = "BAJA_MEDIDOR";
  } else if (data.tipo === "CAMBIO_PRECINTO") {
    accionAuditoria = "CAMBIO_PRECINTO";
  }

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: accionAuditoria,
    entidad: "Medidor",
    entidadId: data.medidorId,
    detalles: data,
  });

  return c.json({ id, ...data }, 201);
});
