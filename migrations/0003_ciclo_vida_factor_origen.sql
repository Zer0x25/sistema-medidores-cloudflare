-- Migración 0003: Ciclo de vida metrológico (feat-022), tipos con factor (feat-024) y alineación OBIS/origen (feat-025)
-- Upstream sync: b043883 + 5e5fbda

-- 1. Instalaciones: código humano corto (feat-022)
ALTER TABLE "instalaciones" ADD COLUMN "codigo" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "instalaciones_codigo_key" ON "instalaciones"("codigo");

-- 2. Tipos de medidor: multiplicador + capacidad máxima (feat-024)
ALTER TABLE "tipos_medidor" ADD COLUMN "multiplicador" REAL NOT NULL DEFAULT 1.0;
ALTER TABLE "tipos_medidor" ADD COLUMN "capacidadMaxima" REAL;

-- 3. Medidores: código externo interoperable + factor por activo (feat-022 gracia + feat-025)
ALTER TABLE "medidores" ADD COLUMN "codigoExterno" TEXT;
ALTER TABLE "medidores" ADD COLUMN "factorInstalacion" REAL;
CREATE UNIQUE INDEX IF NOT EXISTS "medidores_codigoExterno_key" ON "medidores"("codigoExterno");

-- 4. Lecturas: valor bruto + factor aplicado + origen (feat-024 + feat-025)
ALTER TABLE "lecturas" ADD COLUMN "valorBruto" REAL;
ALTER TABLE "lecturas" ADD COLUMN "multiplicadorAplicado" REAL;
ALTER TABLE "lecturas" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'MANUAL';

-- 5. Mantenimiento: recargas de tanque (feat-024)
ALTER TABLE "registros_mantenimiento" ADD COLUMN "volumenRecargado" REAL;
ALTER TABLE "registros_mantenimiento" ADD COLUMN "nivelPosterior" REAL;

-- Backfill: tanque diésel con cota 5000 L (feat-024 seed upstream)
UPDATE "tipos_medidor" SET "capacidadMaxima" = 5000 WHERE "nombre" LIKE '%Petr%' OR "nombre" LIKE '%Diésel%' OR "nombre" LIKE '%Diesel%';
