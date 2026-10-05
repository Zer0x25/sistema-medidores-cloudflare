import { describe, it, expect } from "vitest";

describe("Verificación de Contrato y Prevención de Leaks en UI", () => {
  const FORBIDDEN_LEAKS = ["undefined", "null", "NaN", "Invalid Date", "[object Object]"];

  function assertNoLeak(text: unknown, context: string): void {
    const str = String(text);
    for (const forbidden of FORBIDDEN_LEAKS) {
      if (str.includes(forbidden)) {
        throw new Error(`[LEAK DETECTADO en ${context}]: Contiene '${forbidden}' -> "${str}"`);
      }
    }
  }

  it("debe garantizar que el formateo de fechas no produzca 'Invalid Date'", () => {
    const validIso = "2026-10-05T07:00:00.000Z";
    const d = new Date(validIso);

    expect(isNaN(d.getTime())).toBe(false);
    const formatted = d.toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    expect(typeof formatted).toBe("string");
    assertNoLeak(formatted, "Formateo Fecha ISO");
  });

  it("debe formatear correctamente opciones de selector de instalación sin fugas", () => {
    const instalacion = {
      id: "inst-1",
      nombre: "Planta San Bernardo",
      ubicacion: "Av. Las Industrias 7800",
      direccion: "Av. Las Industrias 7800",
    };

    const rendered = `${instalacion.nombre} (${instalacion.ubicacion || instalacion.direccion})`;
    expect(rendered).toBe("Planta San Bernardo (Av. Las Industrias 7800)");
    assertNoLeak(rendered, "Selector Instalación");
  });

  it("debe formatear tipos de medidor y unidades de medida sin undefined o null", () => {
    const tipo = {
      id: "tipo-agua",
      nombre: "Caudalímetro Principal",
      recurso: "AGUA",
      unidad: "M3",
      unidadMedida: "M3",
    };

    const unidad = tipo.unidadMedida || tipo.unidad || "";
    const rendered = `${tipo.nombre} (${tipo.recurso}${unidad ? " - " + unidad : ""})`;
    expect(rendered).toBe("Caudalímetro Principal (AGUA - M3)");
    assertNoLeak(rendered, "Dropdown Tipo Medidor");
  });

  it("debe rechazar cadenas que contengan literales prohibidos", () => {
    expect(() => assertNoLeak("Medidor: undefined", "Test Fuga")).toThrow("LEAK DETECTADO");
    expect(() => assertNoLeak("Consumo: NaN kWh", "Test Fuga")).toThrow("LEAK DETECTADO");
    expect(() => assertNoLeak("Fecha: Invalid Date", "Test Fuga")).toThrow("LEAK DETECTADO");
    expect(() => assertNoLeak("Objeto: [object Object]", "Test Fuga")).toThrow("LEAK DETECTADO");
  });
});
