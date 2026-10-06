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

  describe("Gestión de Usuarios y Asignación de Instalaciones (Persistencia y Simetría)", () => {
    const adminUser: AuthUser = {
      id: "usr-admin-1",
      email: "admin@empresa.com",
      nombre: "Admin Sistema",
      rol: "ADMIN",
    };
    const adminToken = signJwt(adminUser, JWT_SECRET);

    it("GET /api/usuarios debe entregar usuarios con su colección de instalaciones asignadas", async () => {
      const runMock = vi.fn().mockResolvedValue({ success: true });
      const firstMock = vi.fn().mockResolvedValue(null);
      const prepareMock = vi.fn((sql: string) => {
        if (sql.includes("FROM usuarios")) {
          return {
            all: vi.fn().mockResolvedValue({
              results: [
                { id: "usr-op-1", email: "op1@test.cl", nombre: "Operador 1", rol: "OPERADOR", activo: 1, createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" },
              ],
            }),
            bind: vi.fn().mockReturnThis(),
            run: runMock,
            first: firstMock,
          };
        }
        if (sql.includes("FROM asignaciones_operadores")) {
          return {
            all: vi.fn().mockResolvedValue({
              results: [
                { usuarioId: "usr-op-1", id: "inst-01", nombre: "Planta Norte" },
              ],
            }),
            bind: vi.fn().mockReturnThis(),
            run: runMock,
            first: firstMock,
          };
        }
        return {
          all: vi.fn().mockResolvedValue({ results: [] }),
          bind: vi.fn().mockReturnThis(),
          run: runMock,
          first: firstMock,
        };
      });

      const env = createMockEnv({
        DB: { prepare: prepareMock } as unknown as D1Database,
      });

      const res = await app.request(
        "/api/usuarios",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${adminToken}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Array<{ id: string; email: string; instalaciones: Array<{ id: string; nombre: string }> }>;
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBe(1);
      expect(json[0].id).toBe("usr-op-1");
      expect(Array.isArray(json[0].instalaciones)).toBe(true);
      expect(json[0].instalaciones.length).toBe(1);
      expect(json[0].instalaciones[0].id).toBe("inst-01");
      expect(json[0].instalaciones[0].nombre).toBe("Planta Norte");
    });

    it("PATCH /api/usuarios/:id con instalacionesIds debe sincronizar asignaciones_operadores", async () => {
      const statementsRun: string[] = [];
      const runMock = vi.fn().mockImplementation(function (this: { sql?: string }) {
        return Promise.resolve({ success: true });
      });

      const prepareMock = vi.fn((sql: string) => {
        statementsRun.push(sql);
        return {
          bind: vi.fn().mockReturnValue({
            run: runMock,
            all: vi.fn().mockResolvedValue({ results: [{ id: "inst-99", nombre: "Sede Centro" }] }),
            first: vi.fn().mockResolvedValue(null),
          }),
          run: runMock,
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(null),
        };
      });

      const env = createMockEnv({
        DB: { prepare: prepareMock } as unknown as D1Database,
      });

      const res = await app.request(
        "/api/usuarios/usr-op-1",
        {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            instalacionesIds: ["inst-99"],
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean; message: string; instalaciones: Array<{ id: string; nombre: string }> };
      expect(json.success).toBe(true);
      expect(json.instalaciones.length).toBe(1);

      // Verificar que se haya ejecutado DELETE previo y luego INSERT
      const hasDelete = statementsRun.some((s) => s.includes("DELETE FROM asignaciones_operadores"));
      const hasInsert = statementsRun.some((s) => s.includes("INSERT INTO asignaciones_operadores"));
      expect(hasDelete).toBe(true);
      expect(hasInsert).toBe(true);
    });

    it("POST /api/instalaciones/:id/operadores debe asignar operador con código 201", async () => {
      const statementsRun: string[] = [];
      const prepareMock = vi.fn((sql: string) => {
        statementsRun.push(sql);
        return {
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ success: true }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn().mockResolvedValue(null),
          }),
        };
      });

      const env = createMockEnv({
        DB: { prepare: prepareMock } as unknown as D1Database,
      });

      const res = await app.request(
        "/api/instalaciones/inst-01/operadores",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ usuarioId: "usr-op-1" }),
        },
        env
      );

      expect(res.status).toBe(201);
      const json = await res.json() as { instalacionId: string; usuarioId: string };
      expect(json.instalacionId).toBe("inst-01");
      expect(json.usuarioId).toBe("usr-op-1");
      expect(statementsRun.some((s) => s.includes("INSERT INTO asignaciones_operadores"))).toBe(true);
    });

    it("DELETE /api/instalaciones/:id/operadores/:usuarioId debe desasignar operador con código 200", async () => {
      const statementsRun: string[] = [];
      const prepareMock = vi.fn((sql: string) => {
        statementsRun.push(sql);
        return {
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ success: true }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn().mockResolvedValue(null),
          }),
        };
      });

      const env = createMockEnv({
        DB: { prepare: prepareMock } as unknown as D1Database,
      });

      const res = await app.request(
        "/api/instalaciones/inst-01/operadores/usr-op-1",
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean; message: string };
      expect(json.success).toBe(true);
      expect(statementsRun.some((s) => s.includes("DELETE FROM asignaciones_operadores"))).toBe(true);
    });
  });

  describe("Aislamiento Territorial y Location Scoping Multi-Sede (feat-021)", () => {
    const supervisorUser: AuthUser = {
      id: "usr-sup-1",
      email: "supervisor@empresa.com",
      nombre: "Supervisor Norte",
      rol: "SUPERVISOR",
    };
    const supervisorToken = signJwt(supervisorUser, JWT_SECRET);

    it("GET /api/instalaciones debe filtrar por instalaciones asignadas para SUPERVISOR", async () => {
      let executedSql = "";
      const prepareMock = vi.fn((sql: string) => {
        executedSql = sql;
        if (sql.includes("asignaciones_operadores WHERE usuarioId = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ instalacionId: "inst-01" }] }),
            }),
          };
        }
        return {
          all: vi.fn().mockResolvedValue({
            results: [{ id: "inst-01", nombre: "Planta Norte", ubicacion: "Sector 1", activa: 1 }],
          }),
        };
      });

      const env = createMockEnv({ DB: { prepare: prepareMock } as unknown as D1Database });
      const res = await app.request(
        "/api/instalaciones",
        { method: "GET", headers: { Authorization: `Bearer ${supervisorToken}` } },
        env
      );

      expect(res.status).toBe(200);
      expect(executedSql).toContain("WHERE i.id IN ('inst-01')");
    });

    it("GET /api/instalaciones debe retornar [] inmediatamente si el usuario no tiene sedes asignadas", async () => {
      const prepareMock = vi.fn((sql: string) => {
        if (sql.includes("asignaciones_operadores WHERE usuarioId = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [] }),
            }),
          };
        }
        return {
          all: vi.fn().mockResolvedValue({ results: [] }),
        };
      });

      const env = createMockEnv({ DB: { prepare: prepareMock } as unknown as D1Database });
      const res = await app.request(
        "/api/instalaciones",
        { method: "GET", headers: { Authorization: `Bearer ${supervisorToken}` } },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual([]);
    });

    it("GET /api/medidores debe responder 403 si solicita instalacionId no asignada", async () => {
      const prepareMock = vi.fn((sql: string) => {
        if (sql.includes("asignaciones_operadores WHERE usuarioId = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ instalacionId: "inst-01" }] }),
            }),
          };
        }
        return { all: vi.fn().mockResolvedValue({ results: [] }) };
      });

      const env = createMockEnv({ DB: { prepare: prepareMock } as unknown as D1Database });
      const res = await app.request(
        "/api/medidores?instalacionId=inst-02",
        { method: "GET", headers: { Authorization: `Bearer ${supervisorToken}` } },
        env
      );

      expect(res.status).toBe(403);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("FORBIDDEN");
    });

    it("GET /api/reportes/consumos debe responder 403 ante sede ajena", async () => {
      const prepareMock = vi.fn((sql: string) => {
        if (sql.includes("asignaciones_operadores WHERE usuarioId = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ instalacionId: "inst-01" }] }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        };
      });

      const env = createMockEnv({ DB: { prepare: prepareMock } as unknown as D1Database });
      const res = await app.request(
        "/api/reportes/consumos?instalacionId=inst-02",
        { method: "GET", headers: { Authorization: `Bearer ${supervisorToken}` } },
        env
      );

      expect(res.status).toBe(403);
    });

    it("POST /api/alertas/incidentes/:id/resolver debe rechazar con 403 si pertenece a sede ajena", async () => {
      const prepareMock = vi.fn((sql: string) => {
        if (sql.includes("asignaciones_operadores WHERE usuarioId = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ instalacionId: "inst-01" }] }),
            }),
          };
        }
        if (sql.includes("SELECT id, instalacionId FROM incidentes_alerta")) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({ id: "inc-1", instalacionId: "inst-02" }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            run: vi.fn().mockResolvedValue({ success: true }),
          }),
        };
      });

      const env = createMockEnv({ DB: { prepare: prepareMock } as unknown as D1Database });
      const res = await app.request(
        "/api/alertas/incidentes/inc-1/resolver",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supervisorToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notasResolucion: "Intento resolver sede ajena" }),
        },
        env
      );

      expect(res.status).toBe(403);
    });

    it("GET /api/mantenimiento/medidor/:id debe responder 403 ante medidor de sede ajena", async () => {
      const prepareMock = vi.fn((sql: string) => {
        if (sql.includes("asignaciones_operadores WHERE usuarioId = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ instalacionId: "inst-01" }] }),
            }),
          };
        }
        if (sql.includes("WHERE m.id = ?")) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                id: "med-1",
                codigo: "MED-01",
                instalacionId: "inst-02", // Sede ajena
                activo: 1,
              }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        };
      });

      const env = createMockEnv({ DB: { prepare: prepareMock } as unknown as D1Database });
      const res = await app.request(
        "/api/mantenimiento/medidor/med-1",
        { method: "GET", headers: { Authorization: `Bearer ${supervisorToken}` } },
        env
      );

      expect(res.status).toBe(403);
    });
  });
});
