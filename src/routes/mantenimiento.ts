import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

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
  const { results } = await c.env.DB.prepare(`
    SELECT 
      rm.*,
      m.codigo as medidorCodigo,
      i.nombre as instalacionNombre
    FROM registros_mantenimiento rm
    JOIN medidores m ON rm.medidorId = m.id
    JOIN instalaciones i ON m.instalacionId = i.id
    ORDER BY rm.fechaMantenimiento DESC LIMIT 100
  `).all();

  return c.json(results);
});

// Historial de un medidor específico
mantenimientoRouter.get("/api/mantenimiento/medidor/:medidorId", async (c) => {
  const medidorId = c.req.param("medidorId");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM registros_mantenimiento WHERE medidorId = ? ORDER BY fechaMantenimiento DESC"
  )
    .bind(medidorId)
    .all();

  return c.json(results);
});

// Registrar mantenimiento directo
mantenimientoRouter.post("/api/mantenimiento", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = RegistroMantenimientoSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const id = crypto.randomUUID();
  const data = parsed.data;

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

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: `MANTENIMIENTO_${data.tipo}`,
    entidad: "Medidor",
    entidadId: data.medidorId,
    detalles: data,
  });

  return c.json({ id, ...data }, 201);
});
