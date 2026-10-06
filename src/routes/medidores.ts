import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";
import { sqlInList } from "../db.js";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

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
  const user = c.get("user");
  const activoQuery = c.req.query("activo");
  const instalacionId = c.req.query("instalacionId");

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (instalacionId && !allowed.includes(instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
    if (allowed.length === 0) {
      return c.json([]);
    }
  }

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

  const whereClauses: string[] = [];
  if (activoQuery !== undefined) {
    whereClauses.push(`m.activo = ${activoQuery === "true" ? 1 : 0}`);
  }
  if (instalacionId) {
    whereClauses.push(`m.instalacionId = '${instalacionId.replace(/'/g, "''")}'`);
  } else if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    whereClauses.push(`m.instalacionId IN (${sqlInList(allowed)})`);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  sql += " ORDER BY m.codigo ASC";

  const { results } = await c.env.DB.prepare(sql).all<{
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
    ultimaLecturaFecha: string | null;
  }>();

  const formatted = results.map((row) => {
    const rawFecha = row.ultimaLecturaFecha ? row.ultimaLecturaFecha.trim() : null;
    let isoFecha = rawFecha;
    if (rawFecha && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(rawFecha)) {
      isoFecha = rawFecha.replace(" ", "T") + (rawFecha.includes("Z") ? "" : "Z");
    }

    return {
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
        unidadMedida: row.unidad,
        tipoMedicion: row.tipoMedicion,
      },
      ultimaLectura: row.ultimaLecturaValor !== null ? {
        valor: row.ultimaLecturaValor,
        fechaLectura: isoFecha,
        timestamp: isoFecha,
        fecha: isoFecha,
      } : null,
    };
  });

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

  if (user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
  }

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
    return c.json({
      error: "MEDIDOR_CODIGO_DUPLICADO",
      message: `Ya existe un medidor con el código '${codigo}'.`,
    }, 409);
  }
});

const CrearTipoMedidorSchema = z.object({
  nombre: z.string().min(2),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO"]),
  unidad: z.string().min(1),
  tipoMedicion: z.enum(["ACUMULATIVO", "INTERVALO", "PULSOS", "NIVEL"]),
});

// 3. Tipos de medidores
const fetchTipos = async (c: AppContext) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nombre, recurso, unidad, tipoMedicion, activo FROM tipos_medidor WHERE activo = 1 ORDER BY nombre ASC"
  ).all<{ id: string; nombre: string; recurso: string; unidad: string; tipoMedicion: string; activo: number }>();

  return c.json(results.map(r => ({
    ...r,
    unidadMedida: r.unidad,
    activo: Boolean(r.activo),
  })));
};

medidoresRouter.get("/api/tipos-medidor", fetchTipos);
medidoresRouter.get("/api/medidores/tipos", fetchTipos);

const handleCrearTipo = async (c: AppContext) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const body = await c.req.json();
  const parsed = CrearTipoMedidorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de tipo de medidor inválidos", details: parsed.error.issues }, 400);
  }

  const { nombre, recurso, unidad, tipoMedicion } = parsed.data;
  const existente = await c.env.DB.prepare("SELECT id FROM tipos_medidor WHERE nombre = ?").bind(nombre).first();
  if (existente) {
    return c.json({
      error: "TIPO_MEDIDOR_NOMBRE_DUPLICADO",
      message: `Ya existe un tipo de medidor con el nombre '${nombre}'.`,
    }, 409);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO tipos_medidor (id, nombre, recurso, unidad, tipoMedicion, activo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(id, nombre, recurso, unidad, tipoMedicion).run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CREAR_TIPO_MEDIDOR",
    entidad: "TipoMedidor",
    entidadId: id,
    detalles: parsed.data,
  });

  return c.json({ id, nombre, recurso, unidad, unidadMedida: unidad, tipoMedicion, activo: true }, 201);
};

medidoresRouter.post("/api/tipos-medidor", handleCrearTipo);
medidoresRouter.post("/api/medidores/tipos", handleCrearTipo);

// 4. Detalle de medidor
medidoresRouter.get("/api/medidores/:id", async (c) => {
  const user = c.get("user");
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
    .first<{
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

  const { results: lecturas } = await c.env.DB.prepare(
    "SELECT id, valor, fechaLectura, notas FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 10"
  )
    .bind(id)
    .all<{ id: string; valor: number; fechaLectura: string; notas: string | null }>();

  const mappedLecturas = lecturas.map((l) => {
    const raw = l.fechaLectura ? l.fechaLectura.trim() : "";
    let iso = raw;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
      iso = raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
    }
    return {
      ...l,
      fechaLectura: iso,
      timestamp: iso,
      fecha: iso,
    };
  });

  return c.json({
    ...medidor,
    activo: Boolean(medidor.activo),
    lecturasRecientes: mappedLecturas,
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

  const medidor = await c.env.DB.prepare("SELECT id, instalacionId FROM medidores WHERE id = ?").bind(id).first<{ id: string; instalacionId: string }>();
  if (!medidor) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(medidor.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
    }
  }

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

  const medidor = await c.env.DB.prepare("SELECT id, instalacionId, precintoActual FROM medidores WHERE id = ?").bind(id).first<{ id: string; instalacionId: string; precintoActual: string }>();
  if (!medidor) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(medidor.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
    }
  }

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

  const medidor = await c.env.DB.prepare("SELECT id, instalacionId FROM medidores WHERE id = ?").bind(id).first<{ id: string; instalacionId: string }>();
  if (!medidor) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(medidor.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
    }
  }

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
