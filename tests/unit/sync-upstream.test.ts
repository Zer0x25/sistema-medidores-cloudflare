import { describe, it, expect } from "vitest";
import {
  calcularPeriodoGracia,
  factorEfectivo,
  calcularValorReal,
  calcularConsumoPorModo,
  validarRecarga,
} from "../../src/domain.js";

describe("Sync Upstream feat-022/024/025 (Fase Roja -> Verde)", () => {
  it("periodo de gracia: recién creado está en gracia, viejo cristalizado", () => {
    const ahora = new Date();
    const reciente = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const viejo = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    expect(calcularPeriodoGracia(reciente).enPeriodoGracia).toBe(true);
    expect(calcularPeriodoGracia(viejo).enPeriodoGracia).toBe(false);
    expect(calcularPeriodoGracia(ahora.toISOString()).diasRestantesGracia).toBeGreaterThan(0);
  });

  it("factor efectivo: override por activo, si no tipo, si no 1", () => {
    expect(factorEfectivo(20, 1)).toBe(20);
    expect(factorEfectivo(null, 5)).toBe(5);
    expect(factorEfectivo(undefined, undefined)).toBe(1);
  });

  it("valor real = round2(bruto * efectivo)", () => {
    expect(calcularValorReal(5, 20)).toBe(100);
    expect(calcularValorReal(5.556, 1)).toBe(5.56);
  });

  it("consumo por modo: ACUMULATIVO max-min, NIVEL bajada+recargas, INSTANTANEO promedio", () => {
    expect(calcularConsumoPorModo("ACUMULATIVO", [100, 200, 300], 0)).toBe(200);
    expect(calcularConsumoPorModo("NIVEL", [4800, 4200], 0)).toBe(600);
    expect(calcularConsumoPorModo("NIVEL", [4800, 4200], 1000)).toBe(1600);
    expect(calcularConsumoPorModo("NIVEL", [4200, 4800], 0)).toBe(0);
    expect(calcularConsumoPorModo("INSTANTANEO", [10, 20, 30], 0)).toBe(20);
  });

  it("recarga solo válida en NIVEL con volumen>0 y nivelPosterior>=0", () => {
    expect(() => validarRecarga("ACUMULATIVO", 1000, 5000)).toThrow(/RECARGA_SOLO_NIVEL/);
    expect(() => validarRecarga("NIVEL", 0, 5000)).toThrow(/VOLUMEN_RECARGA_REQUERIDO/);
    expect(() => validarRecarga("NIVEL", 1000, -1)).toThrow(/NIVEL_POSTERIOR_REQUERIDO/);
    expect(validarRecarga("NIVEL", 1000, 5000)).toBe(true);
  });
});
