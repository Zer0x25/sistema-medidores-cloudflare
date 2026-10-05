import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const instalacionesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearInstalacionSchema = z.object({
  nombre: z.string().min(3),
  ubicacion: z.string().min(3),
});

// Listar todas las instalaciones
instalacionesRouter.get("/api/instalaciones", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      i.id, i.nombre, i.ubicacion, i.activa, i.createdAt, i.updatedAt,
      (SELECT COUNT(*) FROM medidores m WHERE m.instalacionId = i.id) as totalMedidores,
      (SELECT COUNT(*) FROM asignaciones_operadores a WHERE a.instalacionId = i.id) as totalOperadores
    FROM instalaciones i
    ORDER BY i.nombre ASC
  `).all();

  const formatted = results.map(row => ({
    ...row,
    direccion: row.ubicacion,
    activa: Boolean(row.activa),
  }));

  return c.json(formatted);
});

// Crear instalación
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
  const { nombre, ubicacion } = parsed.data;

  try {
    await c.env.DB.prepare(`
      INSERT INTO instalaciones (id, nombre, ubicacion, activa, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
      .bind(id, nombre, ubicacion)
      .run();

    await registrarAuditoria({
      db: c.env.DB,
      usuario: user,
      accion: "CREAR_INSTALACION",
      entidad: "Instalacion",
      entidadId: id,
      detalles: { nombre, ubicacion },
    });

    return c.json({ id, nombre, ubicacion, direccion: ubicacion, activa: true }, 201);
  } catch {
    return c.json({ error: "INSTALACION_DUPLICADA", message: "Ya existe una instalación con ese nombre" }, 409);
  }
});

// Obtener por ID
instalacionesRouter.get("/api/instalaciones/:id", async (c) => {
  const id = c.req.param("id");
  const inst = await c.env.DB.prepare("SELECT * FROM instalaciones WHERE id = ?").bind(id).first<{
    id: string;
    nombre: string;
    ubicacion: string;
    activa: number;
    createdAt: string;
    updatedAt: string;
  }>();
  if (!inst) {
    return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);
  }
  return c.json({ ...inst, direccion: inst.ubicacion, activa: Boolean(inst.activa) });
});

import type { Context } from "hono";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

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
    SELECT i.id, i.nombre, i.ubicacion, i.activa
    FROM asignaciones_operadores a
    JOIN instalaciones i ON a.instalacionId = i.id
    WHERE a.usuarioId = ? AND i.activa = 1
  `)
    .bind(usuarioId)
    .all<{ id: string; nombre: string; ubicacion: string; activa: number }>();

  return c.json(results.map(r => ({ ...r, direccion: r.ubicacion, activa: Boolean(r.activa) })));
});
