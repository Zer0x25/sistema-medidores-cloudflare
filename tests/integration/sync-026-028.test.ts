import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import app from "../../src/index.js";
import { signJwt } from "../../src/auth.js";
import type { AuthUser, Env } from "../../src/types.js";
import { SQLiteD1 } from "../helpers/sqlite-d1.js";

const secret = "local_test_sync_edge_secret_32_characters";
const identity = (rol: AuthUser["rol"]): AuthUser => ({ id: rol, email: `${rol}@test.cl`, nombre: rol, rol });
let db: SQLiteD1;
let env: Env;
async function req(path: string, rol: AuthUser["rol"] | null = "ADMIN", method = "GET", body?: unknown) {
  return app.request(path, {
    method, headers: { "Content-Type": "application/json", ...(rol ? { Authorization: `Bearer ${signJwt(identity(rol), secret)}` } : {}), "cf-connecting-ip": "127.0.0.2" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
}
interface Serie { medidorId: string; instalacionId: string; recurso: string; puntos: Array<{ fecha: string; valor: number }> }

beforeEach(() => {
  db = new SQLiteD1();
  env = { DB: db, JWT_SECRET: secret, NODE_ENV: "test" };
  db.sqlite.exec(`
    INSERT INTO usuarios(id,email,passwordHash,nombre,rol,updatedAt) VALUES
      ('ADMIN','ADMIN@test.cl','test','Admin','ADMIN',CURRENT_TIMESTAMP),
      ('SUPERVISOR','SUPERVISOR@test.cl','test','Supervisor','SUPERVISOR',CURRENT_TIMESTAMP),
      ('OPERADOR','OPERADOR@test.cl','test','Operador','OPERADOR',CURRENT_TIMESTAMP);
    INSERT INTO instalaciones(id,nombre,ubicacion,updatedAt) VALUES ('inst-01','Norte','Norte',CURRENT_TIMESTAMP),('inst-02','Sur','Sur',CURRENT_TIMESTAMP);
    INSERT INTO tipos_medidor(id,nombre,recurso,unidad,tipoMedicion,multiplicador,updatedAt) VALUES
      ('tipo-a','Tipo A','AGUA','M3','ACUMULATIVO',1,CURRENT_TIMESTAMP),
      ('tipo-b','Tipo B','LUZ','KWH','ACUMULATIVO',2,CURRENT_TIMESTAMP);
    INSERT INTO medidores(id,instalacionId,tipoMedidorId,codigo,ubicacionInterna,updatedAt) VALUES
      ('med-01','inst-01','tipo-a','MED-01','Sala',CURRENT_TIMESTAMP),
      ('med-02','inst-02','tipo-a','MED-02','Sala',CURRENT_TIMESTAMP),
      ('med-03','inst-01','tipo-b','MED-03','Sala',CURRENT_TIMESTAMP);
    INSERT INTO asignaciones_operadores(id,instalacionId,usuarioId) VALUES ('as-01','inst-01','SUPERVISOR'),('as-02','inst-01','OPERADOR');
    INSERT INTO lecturas(id,medidorId,operadorId,valor,fechaLectura,multiplicadorAplicado) VALUES
      ('l1','med-01','OPERADOR',10,'2026-01-01 12:00:00',1),
      ('l2','med-01','OPERADOR',20,'2026-01-02T12:00:00.000Z',1),
      ('l3','med-01','OPERADOR',30,'2026-01-03 12:00:00',1),
      ('l4','med-01','OPERADOR',35,'2026-01-03T12:00:00.000Z',1),
      ('l5','med-02','OPERADOR',50,'2026-01-02 12:00:00',1);
  `);
});
afterEach(() => db.sqlite.close());

describe("feat-027 y perímetro", () => {
  it.each(["production", "staging", "unknown", undefined])("seed bloqueado sin SQL destructivo en %s", async (NODE_ENV) => {
    env.NODE_ENV = NODE_ENV;
    const res = await req("/api/demo/seed", null, "POST");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "DEMO_SEED_DISABLED" });
    expect(db.sqlite.prepare("SELECT COUNT(*) as n FROM lecturas").get()?.n).toBe(5);
  });
  it.each(["development", "test", "staging", "production", "unknown", undefined])("flags fail-closed en %s", async (NODE_ENV) => {
    env.NODE_ENV = NODE_ENV;
    const res = await req("/api/config", null);
    expect(await res.json()).toMatchObject({ features: { devRoleSwitcher: NODE_ENV === "development" || NODE_ENV === "test" } });
  });
  it("rechaza anónimos y OPERADOR en series; no exime prefijos públicos", async () => {
    expect((await req("/api/dashboard/series", null)).status).toBe(401);
    expect((await req("/api/dashboard/series", "OPERADOR")).status).toBe(403);
    expect((await req("/api/config-private", null)).status).toBe(401);
  });
  it("mantiene probes públicos", async () => {
    expect((await req("/readyz", null)).status).toBe(200);
    expect((await req("/healthz", null)).status).toBe(200);
  });
  it("seed local retorna seedData estable y preserva auditoría histórica", async () => {
    db.sqlite.exec("INSERT INTO auditoria_eventos(id,accion,entidad,entidadId) VALUES ('audit-old','BACKUP_SISTEMA','Sistema','old')");
    const res = await req("/api/demo/seed", null, "POST");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seedData: { instalaciones: expect.any(Array), medidores: expect.any(Array), usuarios: expect.any(Array) } });
    expect(db.sqlite.prepare("SELECT id FROM auditoria_eventos WHERE id='audit-old'").get()?.id).toBe("audit-old");
  });
  it("frontend incluye gráficos y conserva probes fuera de cache", () => {
    expect(readFileSync("public/js/charts.js", "utf8")).toContain("dibujarLinea");
    expect(readFileSync("public/sw.js", "utf8")).toContain('"/js/charts.js"');
    expect(readFileSync("public/sw.js", "utf8")).toContain('"/readyz"');
  });
});

describe("feat-028 series D1", () => {
  it("limita a más recientes, ordena fechas mixtas y desempata por valor", async () => {
    const res = await req("/api/dashboard/series?medidorId=med-01&limite=2");
    expect(res.status).toBe(200);
    const series = await res.json() as Serie[];
    expect(series).toHaveLength(1);
    expect(series[0].puntos.map((p) => p.valor)).toEqual([30, 35]);
    expect(series[0].puntos[0].fecha).toBe("2026-01-03T12:00:00.000Z");
    expect(JSON.stringify(series)).not.toMatch(/undefined|NaN|Invalid Date|\[object Object\]/);
  });
  it("aplica filtros AND, fecha y conserva medidores sin lecturas", async () => {
    const res = await req("/api/dashboard/series?instalacionId=inst-01&recurso=AGUA&fechaInicio=2026-01-02&fechaFin=2026-01-02T23:59:59Z");
    const series = await res.json() as Serie[];
    expect(series).toHaveLength(1);
    expect(series[0].puntos.map((p) => p.valor)).toEqual([20]);
    const empty = await req("/api/dashboard/series?medidorId=med-03");
    expect(await empty.json()).toMatchObject([{ medidorId: "med-03", puntos: [] }]);
  });
  it("oculta inactivos y sedes ajenas; scope vacío fail-closed", async () => {
    db.sqlite.exec("UPDATE medidores SET activo=0 WHERE id='med-03'");
    const response = await req("/api/dashboard/series", "SUPERVISOR");
    expect((await response.json() as Serie[]).map((s) => s.medidorId)).toEqual(["med-01"]);
    expect((await req("/api/dashboard/series?instalacionId=inst-02", "SUPERVISOR")).status).toBe(403);
    expect(await (await req("/api/dashboard/series?medidorId=med-02", "SUPERVISOR")).json()).toEqual([]);
    db.sqlite.exec("DELETE FROM asignaciones_operadores");
    expect(await (await req("/api/dashboard/series", "SUPERVISOR")).json()).toEqual([]);
  });
  it("consulta de rango usa índice sin ordenar en tabla temporal", () => {
    const plan = db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT fechaLectura, valor FROM lecturas WHERE medidorId = ? AND julianday(fechaLectura) >= julianday(?) ORDER BY julianday(fechaLectura) DESC, valor DESC LIMIT ?").all("med-01", "2026-01-01", 2);
    const text = JSON.stringify(plan);
    expect(text).toContain("lecturas_medidor_fecha_juliana_valor_idx");
    expect(text).not.toContain("TEMP B-TREE");
  });
  it.each(["limite=0", "limite=501", "recurso=INVALIDO", "fechaInicio=foo", "medidorId=", "fechaInicio=2026-02-01&fechaFin=2026-01-01"])("rechaza query %s", async (query) => {
    expect((await req(`/api/dashboard/series?${query}`)).status).toBe(400);
  });
});

describe("feat-026 tipos y reasignación", () => {
  it.each(["SUPERVISOR", "OPERADOR"] as const)("solo ADMIN puede mutar tipos (%s)", async (rol) => {
    for (const path of ["/api/tipos-medidor", "/api/medidores/tipos"]) {
      expect((await req(path, rol, "POST", { nombre: "Nuevo", recurso: "AGUA", unidad: "M3", tipoMedicion: "ACUMULATIVO" })).status).toBe(403);
      expect((await req(`${path}/tipo-a`, rol, "PATCH", { nombre: "Cambio" })).status).toBe(403);
      expect((await req(`${path}/tipo-a`, rol, "DELETE")).status).toBe(403);
    }
  });
  it("bloquea edición/archivo/borrado incluso si medidores están archivados", async () => {
    db.sqlite.exec("UPDATE medidores SET activo=0 WHERE tipoMedidorId='tipo-a'");
    for (const [path, method, status, code] of [
      ["/api/tipos-medidor/tipo-a", "PATCH", 409, "TIPO_MEDIDOR_EN_USO"],
      ["/api/tipos-medidor/tipo-a/archivar", "PATCH", 409, "TIPO_MEDIDOR_EN_USO"],
      ["/api/tipos-medidor/tipo-a", "DELETE", 422, "TIPO_MEDIDOR_CON_MEDIDORES_NO_ELIMINABLE"],
    ] as const) {
      const res = await req(path, "ADMIN", method, { nombre: "Cambio" });
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ error: code });
    }
  });
  it("reasigna con roundtrip y conserva lecturas/factores históricos; ciclo de tipo sin uso", async () => {
    for (const id of ["med-01", "med-02"]) {
      expect((await req(`/api/medidores/${id}`, "ADMIN", "PATCH", { tipoMedidorId: "tipo-b" })).status).toBe(200);
      expect(await (await req(`/api/medidores/${id}`)).json()).toMatchObject({ tipoMedidorId: "tipo-b" });
    }
    expect(db.sqlite.prepare("SELECT multiplicadorAplicado FROM lecturas WHERE id='l1'").get()?.multiplicadorAplicado).toBe(1);
    expect((await req("/api/tipos-medidor/tipo-a", "ADMIN", "PATCH", { nombre: "Agua Editada", multiplicador: 3 })).status).toBe(200);
    expect(await (await req("/api/tipos-medidor/tipo-a")).json()).toMatchObject({ nombre: "Agua Editada", multiplicador: 3 });
    expect((await req("/api/tipos-medidor/tipo-a/archivar", "ADMIN", "PATCH")).status).toBe(200);
    expect(await (await req("/api/tipos-medidor?estado=archivados")).json()).toMatchObject([{ id: "tipo-a", activo: false }]);
    expect((await (await req("/api/tipos-medidor?estado=todos", "SUPERVISOR")).json() as Array<{ id: string }>).map((t) => t.id)).toEqual(["tipo-b"]);
    expect((await req("/api/tipos-medidor/tipo-a/restaurar", "ADMIN", "PATCH")).status).toBe(200);
    expect(await (await req("/api/tipos-medidor/tipo-a")).json()).toMatchObject({ activo: true });
    expect((await req("/api/tipos-medidor/tipo-a", "ADMIN", "DELETE")).status).toBe(200);
    expect((await req("/api/tipos-medidor/tipo-a")).status).toBe(404);
    const logs = db.sqlite.prepare("SELECT accion,detalles,ip FROM auditoria_eventos ORDER BY rowid").all();
    expect(logs.map((l) => l.accion)).toEqual(["MEDIDOR_EDITADO", "MEDIDOR_EDITADO", "TIPO_MEDIDOR_EDITADO", "TIPO_MEDIDOR_ARCHIVADO", "TIPO_MEDIDOR_RESTAURADO", "TIPO_MEDIDOR_ELIMINADO"]);
    expect(JSON.parse(String(logs[0].detalles))).toMatchObject({ antes: { tipoMedidorId: "tipo-a" }, despues: { tipoMedidorId: "tipo-b" } });
    expect(logs.every((l) => l.ip === "127.0.0.2")).toBe(true);
  });
  it("fallo de auditoría revierte la reasignación en la misma transacción", async () => {
    db.sqlite.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON auditoria_eventos BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    expect((await req("/api/medidores/med-01", "ADMIN", "PATCH", { tipoMedidorId: "tipo-b" })).status).toBe(500);
    expect(await (await req("/api/medidores/med-01")).json()).toMatchObject({ tipoMedidorId: "tipo-a" });
  });
  it("rechaza reasignación a tipo ausente o inactivo", async () => {
    expect((await req("/api/medidores/med-01", "ADMIN", "PATCH", { tipoMedidorId: "missing" })).status).toBe(404);
    db.sqlite.exec("UPDATE tipos_medidor SET activo=0 WHERE id='tipo-b'");
    expect((await req("/api/medidores/med-01", "ADMIN", "PATCH", { tipoMedidorId: "tipo-b" })).status).toBe(422);
  });
  it("rechaza schema inválido, duplicado y entidad inexistente sin auditoría espuria", async () => {
    expect((await req("/api/tipos-medidor/missing", "ADMIN", "PATCH", { nombre: "Cambio" })).status).toBe(404);
    db.sqlite.exec("UPDATE medidores SET tipoMedidorId='tipo-b'");
    expect((await req("/api/tipos-medidor/tipo-a", "ADMIN", "PATCH", { multiplicador: -1 })).status).toBe(400);
    expect((await req("/api/tipos-medidor/tipo-a", "ADMIN", "PATCH", { nombre: "Tipo B" })).status).toBe(409);
    expect(db.sqlite.prepare("SELECT COUNT(*) as n FROM auditoria_eventos").get()?.n).toBe(0);
  });
});
