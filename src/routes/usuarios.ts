import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { verifyPassword, signJwt, hashPassword } from "../auth.js";
import { registrarAuditoria } from "../audit.js";

export const usuariosRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  nombre: z.string().min(2),
  rol: z.enum(["ADMIN", "SUPERVISOR", "OPERADOR"]).default("OPERADOR"),
  instalacionesIds: z.array(z.string()).optional(),
});

const CambiarPasswordSchema = z.object({
  passwordActual: z.string().min(1),
  passwordNueva: z.string().min(6),
});

const EditarUsuarioSchema = z.object({
  nombre: z.string().min(2).optional(),
  rol: z.enum(["ADMIN", "SUPERVISOR", "OPERADOR"]).optional(),
  activo: z.boolean().optional(),
  instalacionesIds: z.array(z.string()).optional(),
});

// 1. Registro de nuevo usuario
usuariosRouter.post("/api/auth/register", async (c) => {
  const body = await c.req.json();
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de usuario inválidos" }, 400);
  }

  const { email, password, nombre, rol, instalacionesIds } = parsed.data;

  // Verificar si ya existe
  const existente = await c.env.DB.prepare("SELECT id FROM usuarios WHERE email = ?").bind(email).first();
  if (existente) {
    return c.json({ error: "EMAIL_DUPLICADO", message: "El correo ya se encuentra registrado" }, 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await c.env.DB.prepare(`
    INSERT INTO usuarios (id, email, passwordHash, nombre, rol, activo, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(id, email, passwordHash, nombre, rol)
    .run();

  if (instalacionesIds && instalacionesIds.length > 0) {
    for (const instId of instalacionesIds) {
      const asigId = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO asignaciones_operadores (id, instalacionId, usuarioId, createdAt)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `)
        .bind(asigId, instId, id)
        .run();
    }
  }

  const { results: asignadas } = await c.env.DB.prepare(`
    SELECT i.id, i.nombre
    FROM asignaciones_operadores a
    JOIN instalaciones i ON a.instalacionId = i.id
    WHERE a.usuarioId = ?
    ORDER BY i.nombre ASC
  `).bind(id).all<{ id: string; nombre: string }>();

  const userPayload = {
    id,
    email,
    nombre,
    rol: rol as "ADMIN" | "SUPERVISOR" | "OPERADOR",
    instalaciones: asignadas || [],
  };
  const token = signJwt({ id, email, nombre, rol: rol as "ADMIN" | "SUPERVISOR" | "OPERADOR" }, c.env.JWT_SECRET);

  await registrarAuditoria({
    db: c.env.DB,
    usuario: userPayload,
    accion: "REGISTRO_USUARIO",
    entidad: "Usuario",
    entidadId: id,
    detalles: { email, rol, instalacionesIds },
  });

  return c.json({ token, usuario: userPayload }, 201);
});

// 2. Inicio de Sesión (Login)
usuariosRouter.post("/api/auth/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "BAD_REQUEST", message: "JSON inválido" }, 400);
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Credenciales malformadas" }, 400);
  }

  const { email, password } = parsed.data;

  const usuario = await c.env.DB.prepare(
    "SELECT id, email, passwordHash, nombre, rol, activo FROM usuarios WHERE email = ?"
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      passwordHash: string;
      nombre: string;
      rol: "ADMIN" | "SUPERVISOR" | "OPERADOR";
      activo: number;
    }>();

  if (!usuario || usuario.activo !== 1) {
    return c.json({ error: "UNAUTHORIZED", message: "Correo electrónico o contraseña incorrectos." }, 401);
  }

  const valida = await verifyPassword(password, usuario.passwordHash);
  if (!valida) {
    return c.json({ error: "UNAUTHORIZED", message: "Correo electrónico o contraseña incorrectos." }, 401);
  }

  const userPayload = {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
  };

  const token = signJwt(userPayload, c.env.JWT_SECRET);

  await registrarAuditoria({
    db: c.env.DB,
    usuario: userPayload,
    accion: "LOGIN_EXITOSO",
    entidad: "Usuario",
    entidadId: usuario.id,
  });

  return c.json({ token, usuario: userPayload });
});

// 3. Obtener perfil
usuariosRouter.get("/api/auth/me", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "UNAUTHORIZED", message: "Sesión requerida" }, 401);
  return c.json(user);
});
usuariosRouter.get("/api/auth/perfil", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "UNAUTHORIZED", message: "Sesión requerida" }, 401);
  return c.json({ usuario: user });
});

// 4. Cambiar propia contraseña
usuariosRouter.post("/api/auth/cambiar-password", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "UNAUTHORIZED", message: "Sesión requerida" }, 401);

  const body = await c.req.json();
  const parsed = CambiarPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de contraseña inválidos" }, 400);
  }

  const usuario = await c.env.DB.prepare("SELECT passwordHash FROM usuarios WHERE id = ?")
    .bind(user.id)
    .first<{ passwordHash: string }>();

  if (!usuario || !(await verifyPassword(parsed.data.passwordActual, usuario.passwordHash))) {
    return c.json({ error: "PASSWORD_ACTUAL_INVALIDA", message: "La contraseña actual no es correcta" }, 401);
  }

  const nuevoHash = await hashPassword(parsed.data.passwordNueva);
  await c.env.DB.prepare("UPDATE usuarios SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(nuevoHash, user.id)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CAMBIO_PASSWORD_PROPIO",
    entidad: "Usuario",
    entidadId: user.id,
  });

  return c.json({ success: true, message: "Contraseña actualizada exitosamente" });
});

// 5. Listar usuarios (ADMIN y SUPERVISOR)
usuariosRouter.get("/api/usuarios", async (c) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const { results: usuarios } = await c.env.DB.prepare(
    "SELECT id, email, nombre, rol, activo, createdAt, updatedAt FROM usuarios ORDER BY nombre ASC"
  ).all<{ id: string; email: string; nombre: string; rol: string; activo: number; createdAt: string; updatedAt: string }>();

  // Consultar todas las asignaciones vigentes vinculadas a instalaciones existentes
  const { results: asignaciones } = await c.env.DB.prepare(`
    SELECT a.usuarioId, i.id, i.nombre
    FROM asignaciones_operadores a
    JOIN instalaciones i ON a.instalacionId = i.id
    ORDER BY i.nombre ASC
  `).all<{ usuarioId: string; id: string; nombre: string }>();

  const asignacionesPorUsuario = new Map<string, Array<{ id: string; nombre: string }>>();
  for (const a of asignaciones) {
    if (!asignacionesPorUsuario.has(a.usuarioId)) {
      asignacionesPorUsuario.set(a.usuarioId, []);
    }
    asignacionesPorUsuario.get(a.usuarioId)!.push({ id: a.id, nombre: a.nombre });
  }

  const formatted = usuarios.map((u) => ({
    ...u,
    activo: Boolean(u.activo),
    instalaciones: asignacionesPorUsuario.get(u.id) || [],
  }));

  return c.json(formatted);
});

// 6. Editar usuario
usuariosRouter.patch("/api/usuarios/:id", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") {
    return c.json({ error: "FORBIDDEN", message: "Solo administradores pueden editar usuarios" }, 403);
  }

  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = EditarUsuarioSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos", details: parsed.error.issues }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (parsed.data.nombre !== undefined) {
    sets.push("nombre = ?");
    params.push(parsed.data.nombre);
  }
  if (parsed.data.rol !== undefined) {
    sets.push("rol = ?");
    params.push(parsed.data.rol);
  }
  if (parsed.data.activo !== undefined) {
    sets.push("activo = ?");
    params.push(parsed.data.activo ? 1 : 0);
  }

  if (sets.length > 0) {
    sets.push("updatedAt = CURRENT_TIMESTAMP");
    params.push(id);
    await c.env.DB.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  // Sincronizar asignaciones de instalaciones (transaccional e idempotente)
  if (parsed.data.instalacionesIds !== undefined) {
    await c.env.DB.prepare("DELETE FROM asignaciones_operadores WHERE usuarioId = ?")
      .bind(id)
      .run();

    for (const instId of parsed.data.instalacionesIds) {
      const asigId = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO asignaciones_operadores (id, instalacionId, usuarioId, createdAt)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `)
        .bind(asigId, instId, id)
        .run();
    }
  }

  if (sets.length === 0 && parsed.data.instalacionesIds === undefined) {
    return c.json({ message: "Sin cambios solicitados" });
  }

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "MODIFICACION_USUARIO",
    entidad: "Usuario",
    entidadId: id,
    detalles: parsed.data,
  });

  const { results: asignadas } = await c.env.DB.prepare(`
    SELECT i.id, i.nombre
    FROM asignaciones_operadores a
    JOIN instalaciones i ON a.instalacionId = i.id
    WHERE a.usuarioId = ?
    ORDER BY i.nombre ASC
  `).bind(id).all<{ id: string; nombre: string }>();

  return c.json({
    success: true,
    message: "Usuario y asignaciones actualizados exitosamente",
    instalaciones: asignadas || [],
  });
});

// 7. Resetear contraseña administrativamente
usuariosRouter.post("/api/usuarios/:id/reset-password", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") {
    return c.json({ error: "FORBIDDEN", message: "Solo administradores pueden restablecer contraseñas" }, 403);
  }

  const id = c.req.param("id");
  const body = await c.req.json() as { passwordNueva?: string };
  const passwordNueva = body.passwordNueva || "Admin1234!";

  const nuevoHash = await hashPassword(passwordNueva);
  await c.env.DB.prepare("UPDATE usuarios SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(nuevoHash, id)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "RESET_PASSWORD_ADMINISTRATIVO",
    entidad: "Usuario",
    entidadId: id,
  });

  return c.json({ success: true, message: "Contraseña restablecida correctamente" });
});
