import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import app from "../../src/index.js";
import { signJwt } from "../../src/auth.js";
import { SQLiteD1 } from "../helpers/sqlite-d1.js";
import type { AuthUser } from "../../src/types.js";

describe("Custodia de JWT_SECRET y rotación", () => {
  it("JWT_SECRET no es una variable pública de Wrangler", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as { vars: Record<string, string> };
    expect(Object.hasOwn(config.vars, "JWT_SECRET")).toBe(false);
  });
  it("bootstrap y gate aprovisionan claves aleatorias en vez de copiar la plantilla", () => {
    for (const file of ["scripts/setup-local.sh", "scripts/verify.sh"]) {
      const content = readFileSync(file, "utf8");
      expect(content).toContain("node scripts/create-local-secrets.mjs");
      expect(content).not.toContain("cp .dev.vars.example .dev.vars");
    }
  });
  it("cada archivo local tiene clave distinta, permisos privados y se preserva al repetir", () => {
    const temp = mkdtempSync(join(tmpdir(), "medidores-jwt-local-test-"));
    try {
      const script = resolve("scripts/create-local-secrets.mjs");
      const outputs = [join(temp, "first.env"), join(temp, "second.env")];
      for (const path of outputs) {
        const result = spawnSync(process.execPath, [script, path], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
      const content = outputs.map((p) => readFileSync(p, "utf8"));
      const secrets = content.map((s) => /^JWT_SECRET="?([A-Za-z0-9_-]{64})"?$/m.exec(s)?.[1]);
      expect(secrets.every(Boolean)).toBe(true);
      expect(secrets[0]).not.toBe(secrets[1]);
      for (const value of content) expect(value).toContain("NODE_ENV=development");
      expect(spawnSync(process.execPath, [script, outputs[0]], { encoding: "utf8" }).status).toBe(0);
      expect(readFileSync(outputs[0], "utf8")).toBe(content[0]);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("el perímetro rechaza JWT previos y admite sesiones firmadas tras rotar", async () => {
    const db = new SQLiteD1();
    try {
      const user: AuthUser = { id: "admin-rotation-test", nombre: "Admin", email: "admin@rotation.test", rol: "ADMIN" };
      const oldKey = "test_rotation_previous_key_only_for_unit_test";
      const newKey = "test_rotation_new_independent_key_only_for_unit_test";
      const env = { DB: db, JWT_SECRET: newKey, NODE_ENV: "test" };
      for (const [key, expected] of [[oldKey, 401], [newKey, 200]] as const) {
        const token = signJwt(user, key);
        const response = await app.request("/api/usuarios", { headers: { Authorization: `Bearer ${token}` } }, env);
        expect(response.status).toBe(expected);
        if (expected === 401) expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
      }
    } finally { db.sqlite.close(); }
  });
});
