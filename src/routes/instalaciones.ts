import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";
import { sqlInList } from "../db.js";
import { calcularPeriodoGracia } from "../domain.js";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const instalacionesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearInstalacionSchema = z.object({
  nombre: z.string().min(3),
  codigo: z.string().trim().min(2).max(50).optional(),
  ubicacion: z.string().min(3).optional(),
  direccion: z.string().min(3).optional(),
});

const EditarInstalacionSchema = z.object({
  nombre: z.string().trim().min(3).max(100).optional(),
  codigo: z.string().trim().min(2).max(50).optional(),
  ubicacion: z.string().trim().min(3).max(200).optional(),
  direccion: z.string().trim().min(3).max(200).optional(),
  activa: z.boolean().optional(),
});

function withGracia(row: { createdAt: string } & Record<string, unknown>) {
  const { enPeriodoGracia, diasRestantesGracia } = calcularPeriodoGracia(row.createdAt);
  return { ...row, enPeriodoGracia, diasRestantesGracia };
}

// Listar todas las instalaciones (con filtro estado feat-022)
instalacionesRouter.get("/api/instalaciones", async (c) => {
  const user = c.get("user");
  const estado = c.req.query("estado") || "activas";
  let whereClause = "";
  const clauses: string[] = [];
  if (estado === "activas") clauses.push("i.activa = 1");
  else if (estado === "archivadas") clauses.push("i.activa = 0");
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    clauses.push(`i.id IN (${sqlInList(allowed)})`);
    // No-ADMIN siempre restringido a activas salvo que pida archivadas de sus sedes
    if (estado === "todas") {
      // Reemplazar filtro por solo sus sedes (activas y archivadas)
      const idx = clauses.findIndex((x) => x === "i.activa = 1" || x === "i.activa = 0");
      if (idx >= 0) clauses.splice(idx, 1);
    }
  }
  if (clauses.length > 0) whereClause = `WHERE ${clauses.join(" AND ")}`;

  const { results } = await c.env.DB.prepare(`
    SELECT
      i.id, i.codigo, i.nombre, i.ubicacion, i.activa, i.createdAt, i.updatedAt,
      (SELECT COUNT(*) FROM medidores m WHERE m.instalacionId = i.id) as totalMedidores,
      (SELECT COUNT(*) FROM asignaciones_operadores a WHERE a.instalacionId = i.id) as totalOperadores
    FROM instalaciones i
    ${whereClause}
    ORDER BY i.nombre ASC LIMIT 100
  `).all<{
    id: string; codigo: string | null; nombre: string; ubicacion: string;
    activa: number; createdAt: string; updatedAt: string;
    totalMedidores: number; totalOperadores: number;
  }>();

  const formatted = results.map((row) => ({
    ...withGracia({ ...row, activa: Boolean(row.activa) } as unknown as { createdAt: string } & Record<string, unknown>),
    direccion: row.ubicacion,
    activa: Boolean(row.activa),
  }));

  return c.json(formatted);
});

// Crear instalación (con codigo feat-022)
instalacionesRouter.post("/api/instalaciones", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") {
    return c.json({ error: "FORBIDDEN", message: "Solo administradores pueden crear instalaciones" }, 403);
  }

  const body = await c.req.json();
  const parsed = CrearInstalacionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);
  }

  const id = crypto.randomUUID();
  const nombre = parsed.data.nombre.trim();
  const ubicacion = (parsed.data.ubicacion || parsed.data.direccion || "").trim();
  if (!ubicacion || ubicacion.length < 3) {
    return c.json({ error: "VALIDATION_ERROR", message: "Ubicación o dirección requerida (mín 3 caracteres)" }, 400);
  }
  const codigo = parsed.data.codigo?.trim() || null;

  try {
    if (codigo) {
      const dup = await c.env.DB.prepare("SELECT id FROM instalaciones WHERE codigo = ?").bind(codigo).first();
      if (dup) {
        return c.json({ error: "INSTALACION_CODIGO_DUPLICADO", message: `Ya existe una instalación con el código '${codigo}'.` }, 409);
      }
    }
    await c.env.DB.prepare(`
      INSERT INTO instalaciones (id, codigo, nombre, ubicacion, activa, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
      .bind(id, codigo, nombre, ubicacion)
      .run();

    await registrarAuditoria({
      db: c.env.DB,
      usuario: user,
      accion: "CREAR_INSTALACION",
      entidad: "Instalacion",
      entidadId: id,
      detalles: { nombre, codigo, ubicacion },
    });

    return c.json({ id, codigo, nombre, ubicacion, direccion: ubicacion, activa: true }, 201);
  } catch {
    return c.json({ error: "INSTALACION_DUPLICADA", message: "Ya existe una instalación con ese nombre" }, 409);
  }
});

// Obtener por ID
instalacionesRouter.get("/api/instalaciones/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(id)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
  }

  const inst = await c.env.DB.prepare("SELECT * FROM instalaciones WHERE id = ?").bind(id).first<{
    id: string;
    codigo: string | null;
    nombre: string;
    ubicacion: string;
    activa: number;
    createdAt: string;
    updatedAt: string;
  }>();
  if (!inst) {
    return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);
  }
  return c.json({ ...withGracia(inst as unknown as { createdAt: string } & Record<string, unknown>), direccion: inst.ubicacion, activa: Boolean(inst.activa) });
});

// Editar instalación (PATCH, ADMIN, gracia para codigo)
instalacionesRouter.patch("/api/instalaciones/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") {
    return c.json({ error: "FORBIDDEN", message: "Solo administradores pueden editar instalaciones" }, 403);
  }
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = EditarInstalacionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);
  }
  const actual = await c.env.DB.prepare("SELECT * FROM instalaciones WHERE id = ?").bind(id).first<{
    id: string; codigo: string | null; nombre: string; ubicacion: string; activa: number; createdAt: string;
  }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);

  const { enPeriodoGracia } = calcularPeriodoGracia(actual.createdAt);
  if (parsed.data.codigo !== undefined && parsed.data.codigo !== (actual.codigo || undefined)) {
    if (!enPeriodoGracia) {
      return c.json({ error: "PERIODO_GRACIA_EXPIRADO", message: "El código se cristalizó tras 30 días de marcha blanca." }, 422);
    }
    const dup = await c.env.DB.prepare("SELECT id FROM instalaciones WHERE codigo = ?").bind(parsed.data.codigo).first<{ id: string }>();
    if (dup && dup.id !== id) {
      return c.json({ error: "INSTALACION_CODIGO_DUPLICADO", message: `Ya existe una instalación con el código '${parsed.data.codigo}'.` }, 409);
    }
  }
  if (parsed.data.nombre !== undefined && parsed.data.nombre !== actual.nombre) {
    const dupN = await c.env.DB.prepare("SELECT id FROM instalaciones WHERE nombre = ?").bind(parsed.data.nombre).first<{ id: string }>();
    if (dupN && dupN.id !== id) {
      return c.json({ error: "INSTALACION_DUPLICADA", message: "Ya existe una instalación con ese nombre" }, 409);
    }
  }
  const ubic = parsed.data.ubicacion || parsed.data.direccion;
  const sets: string[] = ["updatedAt = CURRENT_TIMESTAMP"];
  const vals: unknown[] = [];
  if (parsed.data.nombre !== undefined) { sets.push("nombre = ?"); vals.push(parsed.data.nombre.trim()); }
  if (parsed.data.codigo !== undefined) { sets.push("codigo = ?"); vals.push(parsed.data.codigo.trim()); }
  if (ubic !== undefined) { sets.push("ubicacion = ?"); vals.push(ubic.trim()); }
  if (parsed.data.activa !== undefined) { sets.push("activa = ?"); vals.push(parsed.data.activa ? 1 : 0); }
  if (vals.length === 0) {
    return c.json({ ...withGracia(actual as unknown as { createdAt: string } & Record<string, unknown>), direccion: actual.ubicacion, activa: Boolean(actual.activa) });
  }
  await c.env.DB.prepare(`UPDATE instalaciones SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "INSTALACION_EDITADA", entidad: "Instalacion", entidadId: id,
    detalles: { antes: { nombre: actual.nombre, codigo: actual.codigo, ubicacion: actual.ubicacion }, despues: parsed.data },
  });
  const upd = await c.env.DB.prepare("SELECT * FROM instalaciones WHERE id = ?").bind(id).first<{
    id: string; codigo: string | null; nombre: string; ubicacion: string; activa: number; createdAt: string; updatedAt: string;
  }>();
  return c.json({ ...withGracia(upd as unknown as { createdAt: string } & Record<string, unknown>), direccion: upd?.ubicacion, activa: Boolean(upd?.activa) });
});

// Archivar (soft delete)
instalacionesRouter.patch("/api/instalaciones/:id/archivar", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const actual = await c.env.DB.prepare("SELECT * FROM instalaciones WHERE id = ?").bind(id).first<{
    id: string; codigo: string | null; nombre: string; ubicacion: string; activa: number; createdAt: string;
  }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);
  const activos = await c.env.DB.prepare("SELECT COUNT(*) as n FROM medidores WHERE instalacionId = ? AND activo = 1").bind(id).first<{ n: number }>();
  if ((activos?.n || 0) > 0) {
    return c.json({ error: "INSTALACION_TIENE_MEDIDORES_ACTIVOS", message: "Archive primero los medidores activos de la sede." }, 422);
  }
  await c.env.DB.prepare("UPDATE instalaciones SET activa = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "INSTALACION_ARCHIVADA", entidad: "Instalacion", entidadId: id,
    detalles: { nombre: actual.nombre, codigo: actual.codigo },
  });
  return c.json({ success: true, id, activa: false });
});

// Restaurar
instalacionesRouter.patch("/api/instalaciones/:id/restaurar", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const actual = await c.env.DB.prepare("SELECT id, nombre, codigo FROM instalaciones WHERE id = ?").bind(id).first<{ id: string; nombre: string; codigo: string | null }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);
  await c.env.DB.prepare("UPDATE instalaciones SET activa = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "INSTALACION_RESTAURADA", entidad: "Instalacion", entidadId: id,
    detalles: { nombre: actual.nombre, codigo: actual.codigo },
  });
  return c.json({ success: true, id, activa: true });
});

// Eliminar físicamente (solo gracia + 0 medidores)
instalacionesRouter.delete("/api/instalaciones/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Solo administradores" }, 403);
  const id = c.req.param("id");
  const actual = await c.env.DB.prepare("SELECT * FROM instalaciones WHERE id = ?").bind(id).first<{
    id: string; codigo: string | null; nombre: string; ubicacion: string; createdAt: string;
  }>();
  if (!actual) return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);
  const { enPeriodoGracia } = calcularPeriodoGracia(actual.createdAt);
  if (!enPeriodoGracia) {
    return c.json({ error: "ELIMINACION_FISICA_PROHIBIDA", message: "Fuera de marcha blanca solo se permite archivar." }, 422);
  }
  const cnt = await c.env.DB.prepare("SELECT COUNT(*) as n FROM medidores WHERE instalacionId = ?").bind(id).first<{ n: number }>();
  if ((cnt?.n || 0) > 0) {
    return c.json({ error: "INSTALACION_CON_MEDIDORES_NO_ELIMINABLE", message: "La instalación tiene medidores; archívela en su lugar." }, 422);
  }
  await registrarAuditoria({
    db: c.env.DB, usuario: user, accion: "INSTALACION_ELIMINADA_GRACIA", entidad: "Instalacion", entidadId: id,
    detalles: { snapshot: actual },
  });
  await c.env.DB.prepare("DELETE FROM instalaciones WHERE id = ?").bind(id).run();
  return c.json({ success: true, id });
});

// Asignar operador a instalación (soporta tanto /asignar-operador como estándar /operadores)
const handleAsignarOperador = async (c: AppContext) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const instalacionId = c.req.param("id");
  const body = await c.req.json() as { usuarioId: string };
  if (!body.usuarioId) {
    return c.json({ error: "BAD_REQUEST", message: "usuarioId requerido" }, 400);
  }

  const asignacionId = crypto.randomUUID();
  try {
    await c.env.DB.prepare(`
      INSERT INTO asignaciones_operadores (id, instalacionId, usuarioId, createdAt)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `)
      .bind(asignacionId, instalacionId, body.usuarioId)
      .run();

    return c.json({ id: asignacionId, instalacionId, usuarioId: body.usuarioId }, 201);
  } catch {
    return c.json({ error: "ASIGNACION_DUPLICADA", message: "El operador ya está asignado a esta instalación" }, 409);
  }
};

instalacionesRouter.post("/api/instalaciones/:id/asignar-operador", handleAsignarOperador);
instalacionesRouter.post("/api/instalaciones/:id/operadores", handleAsignarOperador);

// Remover operador de instalación
const handleRemoverOperador = async (c: AppContext) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const instalacionId = c.req.param("id");
  const usuarioId = c.req.param("usuarioId");

  await c.env.DB.prepare("DELETE FROM asignaciones_operadores WHERE instalacionId = ? AND usuarioId = ?")
    .bind(instalacionId, usuarioId)
    .run();

  return c.json({ success: true, message: "Asignación removida" });
};

instalacionesRouter.delete("/api/instalaciones/:id/remover-operador/:usuarioId", handleRemoverOperador);
instalacionesRouter.delete("/api/instalaciones/:id/operadores/:usuarioId", handleRemoverOperador);

// Listar operadores de una instalación
instalacionesRouter.get("/api/instalaciones/:id/operadores", async (c) => {
  const instalacionId = c.req.param("id");
  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.nombre, u.email, u.rol, a.createdAt as fechaAsignacion
    FROM asignaciones_operadores a
    JOIN usuarios u ON a.usuarioId = u.id
    WHERE a.instalacionId = ?
  `)
    .bind(instalacionId)
    .all();

  return c.json(results);
});

// Listar instalaciones asignadas a un operador
instalacionesRouter.get("/api/instalaciones/operador/:usuarioId", async (c) => {
  const usuarioId = c.req.param("usuarioId");
  const { results } = await c.env.DB.prepare(`
    SELECT i.id, i.codigo, i.nombre, i.ubicacion, i.activa
    FROM asignaciones_operadores a
    JOIN instalaciones i ON a.instalacionId = i.id
    WHERE a.usuarioId = ? AND i.activa = 1
  `)
    .bind(usuarioId)
    .all<{ id: string; codigo: string | null; nombre: string; ubicacion: string; activa: number }>();

  return c.json(results.map((r) => ({ ...r, direccion: r.ubicacion, activa: Boolean(r.activa) })));
});
