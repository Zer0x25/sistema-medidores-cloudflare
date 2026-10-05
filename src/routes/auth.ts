import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { verifyPassword, signJwt } from "../auth.js";

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/api/auth/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "BAD_REQUEST", message: "Cuerpo JSON inválido" }, 400);
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Credenciales malformadas" }, 400);
  }

  const { email, password } = parsed.data;

  // Consultar usuario en D1
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
    return c.json({ error: "UNAUTHORIZED", message: "Credenciales incorrectas o usuario inactivo" }, 401);
  }

  const valida = await verifyPassword(password, usuario.passwordHash);
  if (!valida) {
    return c.json({ error: "UNAUTHORIZED", message: "Credenciales incorrectas" }, 401);
  }

  const userPayload = {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
  };

  const token = signJwt(userPayload, c.env.JWT_SECRET);

  return c.json({
    token,
    usuario: userPayload,
  });
});

authRouter.get("/api/auth/perfil", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "UNAUTHORIZED", message: "Token requerido" }, 401);
  }
  return c.json({ usuario: user });
});
