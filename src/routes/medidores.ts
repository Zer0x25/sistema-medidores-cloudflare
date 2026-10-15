import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";
import { sqlInList } from "../db.js";
import { EditarTipoSchema, SyncError, type TipoAccionSync } from "../schemas/sync.schema.js";
import { calcularPeriodoGracia, normalizarFechaISO } from "../domain.js";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const medidoresRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearMedidorSchema = z.object({
  instalacionId: z.string().min(1),
  tipoMedidorId: z.string().min(1),
  codigo: z.string().min(2),
  codigoExterno: z.string().trim().min(3).max(100).nullable().optional(),
  factorInstalacion: z.number().positive().max(1000000).nullable().optional(),
  numeroSerie: z.string().optional(),
  ubicacionInterna: z.string().min(2),
  precintoActual: z.string().optional(),
});

const EditarMedidorSchema = z.object({
  tipoMedidorId: z.string().trim().min(1).max(128).optional(),
  codigo: z.string().trim().min(3).max(50).optional(),
  codigoExterno: z.string().trim().min(3).max(100).nullable().optional(),
  factorInstalacion: z.number().positive().max(1000000).nullable().optional(),
  numeroSerie: z.string().nullable().optional(),
  ubicacionInterna: z.string().trim().min(2).max(200).optional(),
  activo: z.boolean().optional(),
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

// 1. Listar medidores (con estado feat-022 + campos OBIS/factor feat-025)
medidoresRouter.get("/api/medidores", async (c) => {
  const user = c.get("user");
  const activoQuery = c.req.query("activo");
  const estado = c.req.query("estado") || "activos";
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
      m.id, m.codigo, m.codigoExterno, m.factorInstalacion, m.numeroSerie, m.ubicacionInterna, m.activo, m.precintoActual,
      m.fechaUltimaCalibracion, m.fechaProximaCalibracion, m.createdAt,
      i.id as instalacionId, i.nombre as instalacionNombre,
      t.id as tipoMedidorId, t.nombre as tipoNombre, t.recurso, t.unidad, t.tipoMedicion,
      t.multiplicador, t.capacidadMaxima,
      (SELECT valor FROM lecturas l WHERE l.medidorId = m.id ORDER BY l.fechaLectura DESC LIMIT 1) as ultimaLecturaValor,
      (SELECT fechaLectura FROM lecturas l WHERE l.medidorId = m.id ORDER BY l.fechaLectura DESC LIMIT 1) as ultimaLecturaFecha
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
  `;

  const whereClauses: string[] = [];
  if (activoQuery !== undefined) {
    whereClauses.push(`m.activo = ${activoQuery === "true" ? 1 : 0}`);
  } else if (estado === "activos") {
    whereClauses.push("m.activo = 1");
  } else if (estado === "archivados") {
    whereClauses.push("m.activo = 0");
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
  sql += " ORDER BY m.codigo ASC LIMIT 100";

  const { results } = await c.env.DB.prepare(sql).all<{
    id: string;
    codigo: string;
    codigoExterno: string | null;
    factorInstalacion: number | null;
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
    multiplicador: number | null;
    capacidadMaxima: number | null;
    ultimaLecturaValor: number | null;
    ultimaLecturaFecha: string | null;
  }>();

  const formatted = results.map((row) => {
    const rawFecha = row.ultimaLecturaFecha ? row.ultimaLecturaFecha.trim() : null;
    let isoFecha = rawFecha;
    if (rawFecha && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(rawFecha)) {
      isoFecha = rawFecha.replace(" ", "T") + (rawFecha.includes("Z") ? "" : "Z");
    }
    const { enPeriodoGracia, diasRestantesGracia } = calcularPeriodoGracia(row.createdAt);

    return {
      id: row.id,
      codigo: row.codigo,
      codigoExterno: row.codigoExterno,
      factorInstalacion: row.factorInstalacion,
      numeroSerie: row.numeroSerie,
      ubicacionInterna: row.ubicacionInterna,
      activo: Boolean(row.activo),
      enPeriodoGracia,
      diasRestantesGracia,
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
        multiplicador: row.multiplicador ?? 1,
        capacidadMaxima: row.capacidadMaxima,
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

// 2. Crear medidor (con codigoExterno/factor feat-025)
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
  const codigoExterno = parsed.data.codigoExterno?.trim() || null;
  const factorInstalacion = parsed.data.factorInstalacion ?? null;

  if (user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
  }

  try {
    if (codigoExterno) {
      const dupExt = await c.env.DB.prepare("SELECT id FROM medidores WHERE codigoExterno = ?").bind(codigoExterno).first();
      if (dupExt) {
        return c.json({
          error: "MEDIDOR_CODIGO_EXTERNO_DUPLICADO",
          message: `Ya existe un medidor con el código externo '${codigoExterno}'.`,
        }, 409);
      }
    }
    await c.env.DB.prepare(`
      INSERT INTO medidores (id, instalacionId, tipoMedidorId, codigo, codigoExterno, factorInstalacion, numeroSerie, ubicacionInterna, precintoActual, activo, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
      .bind(id, instalacionId, tipoMedidorId, codigo, codigoExterno, factorInstalacion, numeroSerie || null, ubicacionInterna, precintoActual || null)
      .run();

    await registrarAuditoria({
      db: c.env.DB,
      usuario: user,
      accion: "CREAR_MEDIDOR",
      entidad: "Medidor",
      entidadId: id,
      detalles: { codigo, codigoExterno, factorInstalacion, instalacionId },
    });

    return c.json({ id, codigo, codigoExterno, factorInstalacion, instalacionId, tipoMedidorId, activo: true }, 201);
  } catch {
    return c.json({
      error: "MEDIDOR_CODIGO_DUPLICADO",
      message: `Ya existe un medidor con el código '${codigo}'.`,
    }, 409);
  }
});

const CrearTipoMedidorSchema = z.object({
  nombre: z.string().min(2),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO", "OTRO"]),
  unidad: z.string().min(1),
  tipoMedicion: z.enum(["ACUMULATIVO", "INSTANTANEO", "NIVEL", "INTERVALO", "PULSOS"]),
  multiplicador: z.number().positive().max(1000000).default(1),
  capacidadMaxima: z.number().positive().max(100000000).nullable().optional(),
});

// 3. Tipos de medidores
const fetchTipos = async (c: AppContext) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, recurso, unidad, tipoMedicion, multiplicador, capacidadMaxima, activo FROM tipos_medidor
     ${c.get("user")?.rol === "ADMIN" && c.req.query("estado") === "todos" ? "" : c.get("user")?.rol === "ADMIN" && c.req.query("estado") === "archivados" ? "WHERE activo = 0" : "WHERE activo = 1"}
     ORDER BY nombre ASC LIMIT 100`
  ).all<{ id: string; nombre: string; recurso: string; unidad: string; tipoMedicion: string; multiplicador: number | null; capacidadMaxima: number | null; activo: number }>();

  return c.json(results.map((r) => ({
    ...r,
    multiplicador: r.multiplicador ?? 1,
    capacidadMaxima: r.capacidadMaxima ?? null,
    unidadMedida: r.unidad,
    activo: Boolean(r.activo),
  })));
};

medidoresRouter.get("/api/tipos-medidor", fetchTipos);
medidoresRouter.get("/api/medidores/tipos", fetchTipos);

const handleCrearTipo = async (c: AppContext) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const body = await c.req.json();
  const parsed = CrearTipoMedidorSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de tipo de medidor inválidos", details: parsed.error.issues }, 400);
  }

  const { nombre, recurso, unidad, tipoMedicion } = parsed.data;
  const multiplicador = parsed.data.multiplicador ?? 1;
  const capacidadMaxima = parsed.data.capacidadMaxima ?? null;
  const existente = await c.env.DB.prepare("SELECT id FROM tipos_medidor WHERE nombre = ?").bind(nombre).first();
  if (existente) {
    return c.json({
      error: "TIPO_MEDIDOR_NOMBRE_DUPLICADO",
      message: `Ya existe un tipo de medidor con el nombre '${nombre}'.`,
    }, 409);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO tipos_medidor (id, nombre, recurso, unidad, tipoMedicion, multiplicador, capacidadMaxima, activo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(id, nombre, recurso, unidad, tipoMedicion, multiplicador, capacidadMaxima).run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CREAR_TIPO_MEDIDOR",
    entidad: "TipoMedidor",
    entidadId: id,
    detalles: parsed.data,
  });

  return c.json({ id, nombre, recurso, unidad, unidadMedida: unidad, tipoMedicion, multiplicador, capacidadMaxima, activo: true }, 201);
};

medidoresRouter.post("/api/tipos-medidor", handleCrearTipo);
medidoresRouter.post("/api/medidores/tipos", handleCrearTipo);

interface TipoRow {
  id: string; nombre: string; recurso: string; unidad: string; tipoMedicion: string;
  multiplicador: number; capacidadMaxima: number | null; activo: number;
  createdAt: string; updatedAt: string;
}
const tipoColumns = "id, nombre, recurso, unidad, tipoMedicion, multiplicador, capacidadMaxima, activo, createdAt, updatedAt";
function formatoTipo(row: TipoRow) {
  return { ...row, activo: Boolean(row.activo), unidadMedida: row.unidad,
    multiplicador: row.multiplicador ?? 1, capacidadMaxima: row.capacidadMaxima ?? null,
    createdAt: new Date(normalizarFechaISO(row.createdAt) || row.createdAt).toISOString(),
    updatedAt: new Date(normalizarFechaISO(row.updatedAt) || row.updatedAt).toISOString() };
}
function syncAudit(c: AppContext, accion: TipoAccionSync, entidad: string, id: string, detalles: unknown) {
  return c.env.DB.prepare(`INSERT INTO auditoria_eventos
    (id, usuarioId, accion, entidad, entidadId, detalles, ip, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .bind(crypto.randomUUID(), c.get("user")?.id ?? null, accion, entidad, id,
      JSON.stringify(detalles), c.req.header("cf-connecting-ip") ?? null);
}
async function findTipo(c: AppContext, id: string) {
  return c.env.DB.prepare(`SELECT ${tipoColumns} FROM tipos_medidor WHERE id = ?`).bind(id).first<TipoRow>();
}
async function countTipo(c: AppContext, id: string): Promise<number> {
  const row = await c.env.DB.prepare("SELECT COUNT(*) as n FROM medidores WHERE tipoMedidorId = ?").bind(id).first<{ n: number }>();
  return row?.n ?? 0;
}

for (const base of ["/api/tipos-medidor", "/api/medidores/tipos"]) {
  medidoresRouter.get(`${base}/:id`, async (c) => {
    const row = await findTipo(c, c.req.param("id"));
    if (!row || (!row.activo && c.get("user")?.rol !== "ADMIN")) {
      return c.json({ error: SyncError.tipoNoEncontrado, message: "Tipo de medidor no encontrado" }, 404);
    }
    return c.json(formatoTipo(row));
  });
  medidoresRouter.patch(`${base}/:id`, async (c) => {
    const parsed = EditarTipoSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos de tipo inválidos" }, 400);
    const id = c.req.param("id");
    const actual = await findTipo(c, id);
    if (!actual) return c.json({ error: SyncError.tipoNoEncontrado, message: "Tipo de medidor no encontrado" }, 404);
    const count = await countTipo(c, id);
    if (count) return c.json({ error: SyncError.tipoEnUso, message: "Reasigne los medidores a otro tipo antes de editar.", details: { tipoId: id, count, operacion: "editar" } }, 409);
    if (parsed.data.nombre !== undefined) {
      const duplicate = await c.env.DB.prepare("SELECT id FROM tipos_medidor WHERE nombre = ? AND id <> ?").bind(parsed.data.nombre, id).first();
      if (duplicate) return c.json({ error: SyncError.nombreDuplicado, message: "Nombre de tipo duplicado" }, 409);
    }
    const fields = Object.entries(parsed.data);
    const sql = `UPDATE tipos_medidor SET ${fields.map(([key]) => `${key} = ?, `).join("")}updatedAt = CURRENT_TIMESTAMP WHERE id = ?`;
    await c.env.DB.batch([
      c.env.DB.prepare(sql).bind(...fields.map(([, value]) => value), id),
      syncAudit(c, "TIPO_MEDIDOR_EDITADO", "TipoMedidor", id, { antes: actual, despues: { ...actual, ...parsed.data } }),
    ]);
    const updated = await findTipo(c, id);
    return c.json(formatoTipo(updated ?? actual));
  });
  for (const action of ["archivar", "restaurar"] as const) {
    medidoresRouter.patch(`${base}/:id/${action}`, async (c) => {
      const id = c.req.param("id");
      const actual = await findTipo(c, id);
      if (!actual) return c.json({ error: SyncError.tipoNoEncontrado, message: "Tipo de medidor no encontrado" }, 404);
      if (action === "archivar") {
        const count = await countTipo(c, id);
        if (count) return c.json({ error: SyncError.tipoEnUso, message: "Reasigne los medidores antes de archivar.", details: { tipoId: id, count, operacion: action } }, 409);
      }
      const activo = action === "restaurar" ? 1 : 0;
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE tipos_medidor SET activo = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(activo, id),
        syncAudit(c, action === "archivar" ? "TIPO_MEDIDOR_ARCHIVADO" : "TIPO_MEDIDOR_RESTAURADO", "TipoMedidor", id, { antes: actual, despues: { ...actual, activo: Boolean(activo) } }),
      ]);
      return c.json({ success: true, id, activo: Boolean(activo) });
    });
  }
  medidoresRouter.delete(`${base}/:id`, async (c) => {
    const id = c.req.param("id");
    const actual = await findTipo(c, id);
    if (!actual) return c.json({ error: SyncError.tipoNoEncontrado, message: "Tipo de medidor no encontrado" }, 404);
    const count = await countTipo(c, id);
    if (count) return c.json({ error: SyncError.tipoNoEliminable, message: "El tipo tiene medidores asociados.", details: { tipoId: id, count } }, 422);
    await c.env.DB.batch([
      syncAudit(c, "TIPO_MEDIDOR_ELIMINADO", "TipoMedidor", id, { snapshot: actual }),
      c.env.DB.prepare("DELETE FROM tipos_medidor WHERE id = ?").bind(id),
    ]);
    return c.json({ success: true, id });
  });
}

// 4. Detalle de medidor
medidoresRouter.get("/api/medidores/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const medidor = await c.env.DB.prepare(`
    SELECT
      m.id, m.codigo, m.codigoExterno, m.factorInstalacion, m.numeroSerie, m.ubicacionInterna, m.activo, m.precintoActual,
      m.fechaUltimaCalibracion, m.fechaProximaCalibracion, m.createdAt,
      i.id as instalacionId, i.nombre as instalacionNombre,
      t.id as tipoMedidorId, t.nombre as tipoNombre, t.recurso, t.unidad, t.tipoMedicion,
      t.multiplicador, t.capacidadMaxima
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.id = ?
  `)
    .bind(id)
    .first<{
      id: string;
      codigo: string;
      codigoExterno: string | null;
      factorInstalacion: number | null;
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
      multiplicador: number | null;
      capacidadMaxima: number | null;
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
    "SELECT id, valor, valorBruto, multiplicadorAplicado, origen, fechaLectura, notas FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 10"
  )
    .bind(id)
    .all<{ id: string; valor: number; valorBruto: number | null; multiplicadorAplicado: number | null; origen: string | null; fechaLectura: string; notas: string | null }>();

  const mappedLecturas = lecturas.map((l) => {
    const raw = l.fechaLectura ? l.fechaLectura.trim() : "";
    let iso = raw;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
      iso = raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
    }
    return {
      ...l,
      origen: l.origen || "MANUAL",
      fechaLectura: iso,
      timestamp: iso,
      fecha: iso,
    };
  });

  const { enPeriodoGracia, diasRestantesGracia } = calcularPeriodoGracia(medidor.createdAt);

  return c.json({
    ...medidor,
    activo: Boolean(medidor.activo),
    enPeriodoGracia,
    diasRestantesGracia,
    lecturasRecientes: mappedLecturas,
  });
});

// 4b. Editar medidor (PATCH, ADMIN)
medidoresRouter.patch("/api/medidores/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = EditarMedidorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);
  const actual = await c.env.DB.prepare("SELECT * FROM medidores WHERE id = ?").bind(id).first<{
    id: string; codigo: string; tipoMedidorId: string; codigoExterno: string | null; factorInstalacion: number | null;
    numeroSerie: string | null; ubicacionInterna: string; createdAt: string;
  }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  const { enPeriodoGracia } = calcularPeriodoGracia(actual.createdAt);
  if (parsed.data.codigo !== undefined && parsed.data.codigo !== actual.codigo) {
    if (!enPeriodoGracia) {
      return c.json({ error: "PERIODO_GRACIA_EXPIRADO", message: "El código se cristalizó tras 30 días." }, 422);
    }
    const dup = await c.env.DB.prepare("SELECT id FROM medidores WHERE codigo = ?").bind(parsed.data.codigo).first<{ id: string }>();
    if (dup && dup.id !== id) return c.json({ error: "MEDIDOR_CODIGO_DUPLICADO", message: `Ya existe un medidor con el código '${parsed.data.codigo}'.` }, 409);
  }
  if (parsed.data.codigoExterno !== undefined && parsed.data.codigoExterno !== null) {
    const ext = parsed.data.codigoExterno.trim();
    if (ext !== (actual.codigoExterno || "")) {
      const dupExt = await c.env.DB.prepare("SELECT id FROM medidores WHERE codigoExterno = ?").bind(ext).first<{ id: string }>();
      if (dupExt && dupExt.id !== id) {
        return c.json({ error: "MEDIDOR_CODIGO_EXTERNO_DUPLICADO", message: `Ya existe un medidor con el código externo '${ext}'.` }, 409);
      }
    }
  }
  if (parsed.data.tipoMedidorId !== undefined && parsed.data.tipoMedidorId !== actual.tipoMedidorId) {
    const tipo = await findTipo(c, parsed.data.tipoMedidorId);
    if (!tipo) return c.json({ error: SyncError.tipoNoEncontrado, message: "Tipo de medidor no encontrado" }, 404);
    if (!tipo.activo) return c.json({ error: SyncError.tipoInactivo, message: "Tipo de medidor archivado" }, 422);
  }
  const sets: string[] = ["updatedAt = CURRENT_TIMESTAMP"];
  const vals: unknown[] = [];
  if (parsed.data.tipoMedidorId !== undefined) { sets.push("tipoMedidorId = ?"); vals.push(parsed.data.tipoMedidorId); }
  if (parsed.data.codigo !== undefined) { sets.push("codigo = ?"); vals.push(parsed.data.codigo.trim()); }
  if (parsed.data.codigoExterno !== undefined) { sets.push("codigoExterno = ?"); vals.push(parsed.data.codigoExterno === null ? null : parsed.data.codigoExterno.trim()); }
  if (parsed.data.factorInstalacion !== undefined) { sets.push("factorInstalacion = ?"); vals.push(parsed.data.factorInstalacion); }
  if (parsed.data.numeroSerie !== undefined) { sets.push("numeroSerie = ?"); vals.push(parsed.data.numeroSerie); }
  if (parsed.data.ubicacionInterna !== undefined) { sets.push("ubicacionInterna = ?"); vals.push(parsed.data.ubicacionInterna.trim()); }
  if (parsed.data.activo !== undefined) { sets.push("activo = ?"); vals.push(parsed.data.activo ? 1 : 0); }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE medidores SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    syncAudit(c, "MEDIDOR_EDITADO", "Medidor", id, { antes: actual, despues: { ...actual, ...parsed.data } }),
  ]);
  return c.json({ success: true, id });
});

// 4c. Archivar / restaurar / eliminar físico
medidoresRouter.patch("/api/medidores/:id/archivar", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const actual = await c.env.DB.prepare("SELECT id, codigo FROM medidores WHERE id = ?").bind(id).first<{ id: string; codigo: string }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  await c.env.DB.prepare("UPDATE medidores SET activo = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "MEDIDOR_ARCHIVADO", entidad: "Medidor", entidadId: id,
    detalles: { codigo: actual.codigo },
  });
  return c.json({ success: true, id, activo: false });
});

medidoresRouter.patch("/api/medidores/:id/restaurar", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const actual = await c.env.DB.prepare("SELECT id, codigo FROM medidores WHERE id = ?").bind(id).first<{ id: string; codigo: string }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  await c.env.DB.prepare("UPDATE medidores SET activo = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "MEDIDOR_RESTAURADO", entidad: "Medidor", entidadId: id,
    detalles: { codigo: actual.codigo },
  });
  return c.json({ success: true, id, activo: true });
});

medidoresRouter.delete("/api/medidores/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const actual = await c.env.DB.prepare("SELECT * FROM medidores WHERE id = ?").bind(id).first<{
    id: string; codigo: string; tipoMedidorId: string; codigoExterno: string | null; factorInstalacion: number | null;
    numeroSerie: string | null; ubicacionInterna: string; instalacionId: string; createdAt: string;
  }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  const { enPeriodoGracia } = calcularPeriodoGracia(actual.createdAt);
  if (!enPeriodoGracia) {
    return c.json({ error: "ELIMINACION_FISICA_PROHIBIDA", message: "Fuera de marcha blanca solo se permite archivar." }, 422);
  }
  const cnt = await c.env.DB.prepare("SELECT COUNT(*) as n FROM lecturas WHERE medidorId = ?").bind(id).first<{ n: number }>();
  if ((cnt?.n || 0) > 0) {
    return c.json({ error: "MEDIDOR_CON_LECTURAS_NO_ELIMINABLE", message: "El medidor tiene lecturas; archívelo en su lugar." }, 422);
  }
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "MEDIDOR_ELIMINADO_GRACIA", entidad: "Medidor", entidadId: id,
    detalles: { snapshot: actual },
  });
  await c.env.DB.prepare("DELETE FROM medidores WHERE id = ?").bind(id).run();
  return c.json({ success: true, id });
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
