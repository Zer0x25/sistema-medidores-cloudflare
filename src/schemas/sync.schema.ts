import { z } from "zod";

const EdgeIdSchema = z.string().trim().min(1).max(128);
export const EditarTipoSchema = z.object({
  nombre: z.string().trim().min(2).max(100).optional(),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO", "OTRO"]).optional(),
  unidad: z.string().trim().min(1).max(30).optional(),
  tipoMedicion: z.enum(["ACUMULATIVO", "INSTANTANEO", "NIVEL", "INTERVALO", "PULSOS"]).optional(),
  multiplicador: z.number().positive().max(1000000).optional(),
  capacidadMaxima: z.number().positive().max(100000000).nullable().optional(),
});
export const DashboardSerieQuerySchema = z.object({
  medidorId: EdgeIdSchema.optional(),
  instalacionId: EdgeIdSchema.optional(),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO", "OTRO"]).optional(),
  fechaInicio: z.coerce.date().optional(),
  fechaFin: z.coerce.date().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});
export const DashboardSerieSchema = z.object({
  medidorId: EdgeIdSchema, medidorCodigo: z.string(),
  instalacionId: EdgeIdSchema, instalacionNombre: z.string(),
  recurso: z.string(), unidad: z.string(),
  puntos: z.array(z.object({ fecha: z.string().datetime(), valor: z.number() })).max(500),
});
export type DashboardSerie = z.infer<typeof DashboardSerieSchema>;
export const SyncError = {
  tipoNoEncontrado: "TIPO_MEDIDOR_NOT_FOUND",
  tipoInactivo: "TIPO_MEDIDOR_INACTIVO",
  tipoEnUso: "TIPO_MEDIDOR_EN_USO",
  tipoNoEliminable: "TIPO_MEDIDOR_CON_MEDIDORES_NO_ELIMINABLE",
  nombreDuplicado: "TIPO_MEDIDOR_NOMBRE_DUPLICADO",
  rangoInvalido: "RANGO_FECHAS_INVALIDO",
  instalacionAjena: "INSTALACION_NO_ASIGNADA",
  demoDeshabilitada: "DEMO_SEED_DISABLED",
} as const;
export type SyncErrorCode = typeof SyncError[keyof typeof SyncError];
export type TipoAccionSync = "TIPO_MEDIDOR_EDITADO" | "TIPO_MEDIDOR_ARCHIVADO" |
  "TIPO_MEDIDOR_RESTAURADO" | "TIPO_MEDIDOR_ELIMINADO" | "MEDIDOR_EDITADO";
