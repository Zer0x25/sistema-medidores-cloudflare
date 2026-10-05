import { describe, it, expect, vi } from "vitest";
import { registrarAuditoria } from "../../src/audit.js";
import type { D1Database } from "@cloudflare/workers-types";
import type { AuthUser } from "../../src/types.js";

describe("Módulo de Auditoría Inmutable (Append-Only)", () => {
  const mockUser: AuthUser = {
    id: "usr-admin-1",
    email: "admin@medidores.cl",
    nombre: "Administrador Sistema",
    rol: "ADMIN",
  };

  it("debe preparar y ejecutar la inserción SQL con los parámetros correspondientes", async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

    const mockDb = {
      prepare: prepareMock,
    } as unknown as D1Database;

    await registrarAuditoria({
      db: mockDb,
      usuario: mockUser,
      accion: "MODIFICAR_ROL",
      entidad: "Usuario",
      entidadId: "usr-target-99",
      detalles: { nuevoRol: "SUPERVISOR", previo: "OPERADOR" },
      ip: "192.168.1.50",
    });

    expect(prepareMock).toHaveBeenCalledOnce();
    expect(bindMock).toHaveBeenCalledOnce();

    const args = bindMock.mock.calls[0];
    expect(args[1]).toBe("usr-admin-1"); // usuarioId
    expect(args[2]).toBe("MODIFICAR_ROL"); // accion
    expect(args[3]).toBe("Usuario"); // entidad
    expect(args[4]).toBe("usr-target-99"); // entidadId
    expect(args[5]).toBe(JSON.stringify({ nuevoRol: "SUPERVISOR", previo: "OPERADOR" })); // detalles
    expect(args[6]).toBe("192.168.1.50"); // ip
    expect(runMock).toHaveBeenCalledOnce();
  });

  it("debe capturar errores de base de datos de manera fail-safe sin propagar excepciones", async () => {
    const prepareMock = vi.fn().mockImplementation(() => {
      throw new Error("D1_TIMEOUT_SIMULATED");
    });

    const mockDb = {
      prepare: prepareMock,
    } as unknown as D1Database;

    // No debe lanzar excepción
    await expect(
      registrarAuditoria({
        db: mockDb,
        usuario: mockUser,
        accion: "CREAR_MEDIDOR",
        entidad: "Medidor",
        entidadId: "med-1",
      })
    ).resolves.not.toThrow();
  });
});
