import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt, hashPassword, verifyPassword } from "../../src/auth.js";
import type { AuthUser } from "../../src/types.js";

describe("Módulo de Autenticación y Criptografía (Edge-Native)", () => {
  const secret = "clave_secreta_super_segura_de_prueba_32_bytes_minimo";
  const mockUser: AuthUser = {
    id: "usr-test-123",
    email: "operador@medidores.cl",
    nombre: "Operador de Prueba",
    rol: "OPERADOR",
  };

  describe("JWT HS256", () => {
    it("debe emitir y verificar un token JWT válido con sus claims intactos", () => {
      const token = signJwt(mockUser, secret, 3600);
      expect(typeof token).toBe("string");
      expect(token.split(".").length).toBe(3);

      const verified = verifyJwt(token, secret);
      expect(verified.id).toBe(mockUser.id);
      expect(verified.email).toBe(mockUser.email);
      expect(verified.nombre).toBe(mockUser.nombre);
      expect(verified.rol).toBe(mockUser.rol);
    });

    it("debe rechazar un token con firma alterada o clave secreta incorrecta", () => {
      const token = signJwt(mockUser, secret, 3600);
      const wrongSecret = "otra_clave_completamente_distinta_y_falsa";

      expect(() => verifyJwt(token, wrongSecret)).toThrow("Firma JWT inválida");
    });

    it("debe rechazar un token malformado que no tenga 3 partes", () => {
      expect(() => verifyJwt("token_invalido_sin_puntos", secret)).toThrow("Token JWT malformado");
    });

    it("debe rechazar un token expirado", () => {
      // Expiración en el pasado (-10 segundos)
      const tokenExpirado = signJwt(mockUser, secret, -10);
      expect(() => verifyJwt(tokenExpirado, secret)).toThrow("Token JWT expirado");
    });
  });

  describe("Password Hashing con scrypt", () => {
    it("debe generar un hash con formato salt:derivedKey", async () => {
      const password = "PasswordSeguro123!";
      const hash = await hashPassword(password);

      expect(typeof hash).toBe("string");
      const parts = hash.split(":");
      expect(parts.length).toBe(2);
      expect(parts[0].length).toBe(32); // 16 bytes en hex
      expect(parts[1].length).toBe(128); // 64 bytes en hex
    });

    it("debe verificar exitosamente una contraseña correcta", async () => {
      const password = "MiClaveSuperSecreta2026";
      const hash = await hashPassword(password);

      const esValida = await verifyPassword(password, hash);
      expect(esValida).toBe(true);
    });

    it("debe rechazar una contraseña incorrecta", async () => {
      const password = "ClaveOriginal";
      const hash = await hashPassword(password);

      const esValida = await verifyPassword("ClaveEquivocada", hash);
      expect(esValida).toBe(false);
    });

    it("debe retornar false si el hash almacenado está malformado", async () => {
      const esValida = await verifyPassword("Cualquiera", "hash_invalido_sin_dos_puntos");
      expect(esValida).toBe(false);
    });
  });
});
