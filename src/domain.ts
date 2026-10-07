const DIAS_GRACIA = 30;
const GRACE_MS = DIAS_GRACIA * 24 * 60 * 60 * 1000;

export function calcularPeriodoGracia(createdAt: string | Date): {
  enPeriodoGracia: boolean;
  diasRestantesGracia: number;
} {
  const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const diff = Date.now() - t;
  const enPeriodoGracia = diff <= GRACE_MS;
  const diasRestantesGracia = enPeriodoGracia
    ? Math.max(0, Math.ceil((t + GRACE_MS - Date.now()) / (24 * 3600 * 1000)))
    : 0;
  return { enPeriodoGracia, diasRestantesGracia };
}

export function factorEfectivo(
  factorInstalacion: number | null | undefined,
  multiplicadorTipo: number | null | undefined
): number {
  if (factorInstalacion !== null && factorInstalacion !== undefined) return factorInstalacion;
  if (multiplicadorTipo !== null && multiplicadorTipo !== undefined) return multiplicadorTipo;
  return 1;
}

export function calcularValorReal(valorBruto: number, efectivo: number): number {
  return Number((valorBruto * efectivo).toFixed(2));
}

export function calcularConsumoPorModo(
  tipoMedicion: string,
  valoresOrdenados: number[],
  recargaTotal = 0
): number {
  if (valoresOrdenados.length === 0) return 0;
  if (tipoMedicion === "ACUMULATIVO") {
    if (valoresOrdenados.length < 2) return 0;
    const ini = valoresOrdenados[0];
    const fin = valoresOrdenados[valoresOrdenados.length - 1];
    return Number(Math.max(0, fin - ini).toFixed(2));
  }
  if (tipoMedicion === "NIVEL") {
    const ini = valoresOrdenados[0];
    const fin = valoresOrdenados[valoresOrdenados.length - 1];
    const bajada = Math.max(0, Number((ini - fin).toFixed(2)));
    return Number((bajada + recargaTotal).toFixed(2));
  }
  const suma = valoresOrdenados.reduce((a, b) => a + b, 0);
  return Number((suma / valoresOrdenados.length).toFixed(2));
}

export function validarRecarga(
  tipoMedicion: string,
  volumenRecargado: number | null | undefined,
  nivelPosterior: number | null | undefined
): true {
  if (tipoMedicion !== "NIVEL") {
    throw new Error("RECARGA_SOLO_NIVEL: solo aplica a medidores NIVEL");
  }
  if (volumenRecargado === null || volumenRecargado === undefined || volumenRecargado <= 0) {
    throw new Error("VOLUMEN_RECARGA_REQUERIDO: requiere volumenRecargado > 0");
  }
  if (nivelPosterior === null || nivelPosterior === undefined || nivelPosterior < 0) {
    throw new Error("NIVEL_POSTERIOR_REQUERIDO: requiere nivelPosterior >= 0");
  }
  return true;
}

export function normalizarFechaISO(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t)) {
    return t.replace(" ", "T") + (t.includes("Z") ? "" : "Z");
  }
  return t;
}
