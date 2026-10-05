import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const medidoresRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearMedidorSchema = z.object({
  instalacionId: z.string().min(1),
  tipoMedidorId: z.string().min(1),
  codigo: z.string().min(2),
  numeroSerie: z.string().optional(),
  ubicacionInterna: z.string().min(2),
  precintoActual: z.string().optional(),
});

const CalibrarMedidorSchema = z.object({
  tecnicoResponsable: z.string().min(2),
  proximaCalibracion: z.string().optional(),
  certificadoCalibracion: z.string().optional(),
  observaciones: z.string().optional(),
});

const CambiarPrecintoSchema = z.object({
  nuevoPrecinto: z.string().min(2),
  tecnicoResponsable: z.string().min(2),
  observaciones: z.string().optional(),
});

const BajaTecnicaSchema = z.object({
  motivoBaja: z.string().min(5),
  lecturaRetiro: z.number().optional(),
  nuevoMedidorCodigo: z.string().optional(),
  tecnicoResponsable: z.string().min(2),
  observaciones: z.string().optional(),
});

// 1. Listar medidores
medidoresRouter.get("/api/medidores", async (c) => {
  const activoQuery = c.req.query("activo");
  let sql = `
    SELECT 
      m.id, m.codigo, m.numeroSerie, m.ubicacionInterna, m.activo, m.precintoActual,
      m.fechaUltimaCalibracion, m.fechaProximaCalibracion, m.createdAt,
      i.id as instalacionId, i.nombre as instalacionNombre,
      t.id as tipoMedidorId, t.nombre as tipoNombre, t.recurso, t.unidad, t.tipoMedicion,
      (SELECT valor FROM lecturas l WHERE l.medidorId = m.id ORDER BY l.fechaLectura DESC LIMIT 1) as ultimaLecturaValor,
      (SELECT fechaLectura FROM lecturas l WHERE l.medidorId = m.id ORDER BY l.fechaLectura DESC LIMIT 1) as ultimaLecturaFecha
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
  `;

  if (activoQuery !== undefined) {
    sql += ` WHERE m.activo = ${activoQuery === "true" ? 1 : 0}`;
  }
  sql += " ORDER BY m.codigo ASC";

  const { results } = await c.env.DB.prepare(sql).all();

  const formatted = results.map((row) => ({
    id: row.id,
    codigo: row.codigo,
    numeroSerie: row.numeroSerie,
    ubicacionInterna: row.ubicacionInterna,
    activo: Boolean(row.activo),
    precintoActual: row.precintoActual,
    fechaUltimaCalibracion: row.fechaUltimaCalibracion,
    fechaProximaCalibracion: row.fechaProximaCalibracion,
    createdAt: row.createdAt,
    instalacion: {
      id: row.instalacionId,
      nombre: row.instalacionNombre,
    },
    tipoMedidor: {
      id: row.tipoMedidorId,
      nombre: row.tipoNombre,
      recurso: row.recurso,
      unidad: row.unidad,
      tipoMedicion: row.tipoMedicion,
    },
    ultimaLectura: row.ultimaLecturaValor !== null ? {
      valor: row.ultimaLecturaValor,
      fechaLectura: row.ultimaLecturaFecha,
    } : null,
  }));

  return c.json(formatted);
});

// 2. Crear medidor
medidoresRouter.post("/api/medidores", async (c) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const body = await c.req.json();
  const parsed = CrearMedidorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de medidor inválidos" }, 400);
  }

  const id = crypto.randomUUID();
  const { instalacionId, tipoMedidorId, codigo, numeroSerie, ubicacionInterna, precintoActual } = parsed.data;

  try {
    await c.env.DB.prepare(`
      INSERT INTO medidores (id, instalacionId, tipoMedidorId, codigo, numeroSerie, ubicacionInterna, precintoActual, activo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
      .bind(id, instalacionId, tipoMedidorId, codigo, numeroSerie || null, ubicacionInterna, precintoActual || null)
      .run();

    await registrarAuditoria({
      db: c.env.DB,
      usuario: user,
      accion: "CREAR_MEDIDOR",
      entidad: "Medidor",
      entidadId: id,
      detalles: { codigo, instalacionId },
    });

    return c.json({ id, codigo, instalacionId, tipoMedidorId, activo: true }, 201);
  } catch {
    return c.json({ error: "CODIGO_DUPLICADO", message: "El código de medidor ya existe" }, 409);
  }
});

// 3. Tipos de medidores
medidoresRouter.get("/api/tipos-medidor", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nombre, recurso, unidad, tipoMedicion, activo FROM tipos_medidor WHERE activo = 1 ORDER BY nombre ASC"
  ).all();
  return c.json(results);
});
medidoresRouter.get("/api/medidores/tipos", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nombre, recurso, unidad, tipoMedicion, activo FROM tipos_medidor WHERE activo = 1 ORDER BY nombre ASC"
  ).all();
  return c.json(results);
});

// 4. Detalle de medidor
medidoresRouter.get("/api/medidores/:id", async (c) => {
  const id = c.req.param("id");
  const medidor = await c.env.DB.prepare(`
    SELECT 
      m.id, m.codigo, m.numeroSerie, m.ubicacionInterna, m.activo, m.precintoActual,
      m.fechaUltimaCalibracion, m.fechaProximaCalibracion, m.createdAt,
      i.id as instalacionId, i.nombre as instalacionNombre,
      t.id as tipoMedidorId, t.nombre as tipoNombre, t.recurso, t.unidad, t.tipoMedicion
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.id = ?
  `)
    .bind(id)
    .first();

  if (!medidor) {
    return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  }

  const { results: lecturas } = await c.env.DB.prepare(
    "SELECT id, valor, fechaLectura, notas FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 10"
  )
    .bind(id)
    .all();

  return c.json({
    ...medidor,
    activo: Boolean(medidor.activo),
    lecturasRecientes: lecturas,
  });
});

// 5. Calibrar medidor
medidoresRouter.post("/api/medidores/:id/calibrar", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = CalibrarMedidorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const { tecnicoResponsable, proximaCalibracion, certificadoCalibracion, observaciones } = parsed.data;
  const hoy = new Date().toISOString();

  await c.env.DB.prepare(`
    UPDATE medidores 
    SET fechaUltimaCalibracion = ?, fechaProximaCalibracion = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(hoy, proximaCalibracion || null, id)
    .run();

  const mantId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO registros_mantenimiento (id, medidorId, tipo, tecnicoResponsable, proximaCalibracion, certificadoCalibracion, observaciones, fechaMantenimiento, createdAt)
    VALUES (?, ?, 'CALIBRACION', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(mantId, id, tecnicoResponsable, proximaCalibracion || null, certificadoCalibracion || null, observaciones || null)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CALIBRACION_MEDIDOR",
    entidad: "Medidor",
    entidadId: id,
    detalles: parsed.data,
  });

  return c.json({ success: true, message: "Calibración registrada exitosamente" });
});

// 6. Cambiar precinto
medidoresRouter.post("/api/medidores/:id/cambiar-precinto", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = CambiarPrecintoSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const medidor = await c.env.DB.prepare("SELECT precintoActual FROM medidores WHERE id = ?").bind(id).first<{ precintoActual: string }>();
  if (!medidor) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);

  const { nuevoPrecinto, tecnicoResponsable, observaciones } = parsed.data;

  await c.env.DB.prepare("UPDATE medidores SET precintoActual = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(nuevoPrecinto, id)
    .run();

  const mantId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO registros_mantenimiento (id, medidorId, tipo, tecnicoResponsable, numeroPrecintoAnterior, numeroPrecintoNuevo, observaciones, fechaMantenimiento, createdAt)
    VALUES (?, ?, 'CAMBIO_PRECINTO', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(mantId, id, tecnicoResponsable, medidor.precintoActual || null, nuevoPrecinto, observaciones || null)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CAMBIO_PRECINTO",
    entidad: "Medidor",
    entidadId: id,
    detalles: { precintoAnterior: medidor.precintoActual, nuevoPrecinto },
  });

  return c.json({ success: true, message: "Precinto actualizado exitosamente" });
});

// 7. Baja técnica de medidor
medidoresRouter.post("/api/medidores/:id/baja-tecnica", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = BajaTecnicaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const { motivoBaja, lecturaRetiro, nuevoMedidorCodigo, tecnicoResponsable, observaciones } = parsed.data;

  await c.env.DB.prepare("UPDATE medidores SET activo = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(id)
    .run();

  const mantId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO registros_mantenimiento (id, medidorId, tipo, tecnicoResponsable, lecturaRetiro, motivoBaja, nuevoMedidorCodigo, observaciones, fechaMantenimiento, createdAt)
    VALUES (?, ?, 'BAJA_TECNICA', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(mantId, id, tecnicoResponsable, lecturaRetiro || null, motivoBaja, nuevoMedidorCodigo || null, observaciones || null)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "BAJA_TECNICA_MEDIDOR",
    entidad: "Medidor",
    entidadId: id,
    detalles: parsed.data,
  });

  return c.json({ success: true, message: "Medidor dado de baja técnica correctamente" });
});
