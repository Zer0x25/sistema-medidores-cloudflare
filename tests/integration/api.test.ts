import { describe, it, expect, vi } from "vitest";
import app from "../../src/index.js";
import { signJwt } from "../../src/auth.js";
import type { Env, AuthUser } from "../../src/types.js";
import type { D1Database } from "@cloudflare/workers-types";

describe("Integración HTTP en Cloudflare Workers (Hono App)", () => {
  const JWT_SECRET = "secreto_de_integracion_para_pruebas_minimo_32_bytes";

  const createMockEnv = (overrides: Partial<Env> = {}): Env => {
    const runMock = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    const firstMock = vi.fn().mockResolvedValue({ ok: 1 });
    const allMock = vi.fn().mockResolvedValue({ results: [] });
    const bindMock = vi.fn().mockReturnValue({ run: runMock, first: firstMock, all: allMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock, run: runMock, first: firstMock, all: allMock });

    const mockDb = {
      prepare: prepareMock,
    } as unknown as D1Database;

    return {
      DB: mockDb,
      JWT_SECRET,
      NODE_ENV: "development",
      ...overrides,
    };
  };

  describe("Probes de Salud (Liveness & Readiness)", () => {
    it("GET /healthz debe responder 200 con status: ok sin tocar base de datos", async () => {
      const env = createMockEnv();
      const res = await app.request("/healthz", { method: "GET" }, env);

      expect(res.status).toBe(200);
      const json = await res.json() as { status: string; runtime: string };
      expect(json.status).toBe("ok");
      expect(json.runtime).toBe("cloudflare-workers");
    });

    it("GET /readyz debe responder 200 cuando D1 responde", async () => {
      const env = createMockEnv();
      const res = await app.request("/readyz", { method: "GET" }, env);

      expect(res.status).toBe(200);
      const json = await res.json() as { status: string; database: string };
      expect(json.status).toBe("ready");
      expect(json.database).toBe("connected");
    });

    it("GET /readyz debe responder 503 cuando D1 falla", async () => {
      const failingDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockRejectedValue(new Error("D1 connection lost")),
        }),
      } as unknown as D1Database;

      const env = createMockEnv({ DB: failingDb });
      const res = await app.request("/readyz", { method: "GET" }, env);

      expect(res.status).toBe(503);
      const json = await res.json() as { status: string; database: string };
      expect(json.status).toBe("not_ready");
      expect(json.database).toBe("disconnected");
    });

    it("GET /api/config debe entregar configuración pública según el entorno", async () => {
      const env = createMockEnv({ NODE_ENV: "development" });
      const res = await app.request("/api/config", { method: "GET" }, env);

      expect(res.status).toBe(200);
      const json = await res.json() as { env: string; features: { devRoleSwitcher: boolean } };
      expect(json.env).toBe("development");
      expect(json.features.devRoleSwitcher).toBe(true);
    });
  });

  describe("Seguridad, CORS y Middleware de Autenticación", () => {
    it("debe incluir cabeceras CORS en respuestas", async () => {
      const env = createMockEnv();
      const res = await app.request("/healthz", { method: "GET" }, env);

      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("debe responder 403 FORBIDDEN en endpoints protegidos (como /api/auditoria) sin usuario autenticado", async () => {
      const env = createMockEnv();
      const res = await app.request("/api/auditoria", { method: "GET" }, env);

      expect(res.status).toBe(403);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("FORBIDDEN");
    });

    it("debe responder 401 UNAUTHORIZED si el token JWT es inválido", async () => {
      const env = createMockEnv();
      const res = await app.request(
        "/api/instalaciones",
        {
          method: "GET",
          headers: { Authorization: "Bearer token_falso_invalido" },
        },
        env
      );

      expect(res.status).toBe(401);
    });

    it("debe rechazar con 403 FORBIDDEN si un OPERADOR intenta crear instalaciones", async () => {
      const operadorUser: AuthUser = {
        id: "usr-op-1",
        email: "operador@empresa.com",
        nombre: "Operador Terreno",
        rol: "OPERADOR",
      };
      const token = signJwt(operadorUser, JWT_SECRET);
      const env = createMockEnv();

      const res = await app.request(
        "/api/instalaciones",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nombre: "Planta Norte", ubicacion: "Sector 4" }),
        },
        env
      );

      expect(res.status).toBe(403);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("FORBIDDEN");
    });

    it("debe responder 400 VALIDATION_ERROR si el body de login es inválido", async () => {
      const env = createMockEnv();
      const res = await app.request(
        "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "no-es-un-email" }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("VALIDATION_ERROR");
    });
  });
});
