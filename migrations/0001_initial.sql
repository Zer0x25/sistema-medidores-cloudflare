-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'OPERADOR',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "instalaciones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "asignaciones_operadores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instalacionId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asignaciones_operadores_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "instalaciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "asignaciones_operadores_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tipos_medidor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "tipoMedicion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "medidores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instalacionId" TEXT NOT NULL,
    "tipoMedidorId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "numeroSerie" TEXT,
    "ubicacionInterna" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "precintoActual" TEXT,
    "fechaUltimaCalibracion" DATETIME,
    "fechaProximaCalibracion" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "medidores_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "instalaciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "medidores_tipoMedidorId_fkey" FOREIGN KEY ("tipoMedidorId") REFERENCES "tipos_medidor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lecturas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medidorId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "valor" REAL NOT NULL,
    "fechaLectura" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notas" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lecturas_medidorId_fkey" FOREIGN KEY ("medidorId") REFERENCES "medidores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "facturas_servicio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instalacionId" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "periodoInicio" DATETIME NOT NULL,
    "periodoFin" DATETIME NOT NULL,
    "consumoFacturado" REAL NOT NULL,
    "unidad" TEXT NOT NULL,
    "montoTotal" REAL,
    "numeroFactura" TEXT,
    "estadoConciliacion" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "consumoMedido" REAL,
    "diferenciaConsumo" REAL,
    "porcentajeDesvio" REAL,
    "notas" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "facturas_servicio_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "instalaciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reglas_alerta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "recurso" TEXT,
    "umbralValor" REAL NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "incidentes_alerta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reglaId" TEXT,
    "medidorId" TEXT NOT NULL,
    "instalacionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidad" TEXT NOT NULL DEFAULT 'WARNING',
    "mensaje" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "valorDetectado" REAL,
    "fechaDeteccion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaResolucion" DATETIME,
    "notasResolucion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "incidentes_alerta_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas_alerta" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incidentes_alerta_medidorId_fkey" FOREIGN KEY ("medidorId") REFERENCES "medidores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incidentes_alerta_instalacionId_fkey" FOREIGN KEY ("instalacionId") REFERENCES "instalaciones" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "registros_mantenimiento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medidorId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "fechaMantenimiento" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tecnicoResponsable" TEXT NOT NULL,
    "numeroPrecintoAnterior" TEXT,
    "numeroPrecintoNuevo" TEXT,
    "proximaCalibracion" DATETIME,
    "certificadoCalibracion" TEXT,
    "lecturaRetiro" REAL,
    "motivoBaja" TEXT,
    "nuevoMedidorCodigo" TEXT,
    "observaciones" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "registros_mantenimiento_medidorId_fkey" FOREIGN KEY ("medidorId") REFERENCES "medidores" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auditoria_eventos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "detalles" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "secret" TEXT,
    "eventos" TEXT NOT NULL DEFAULT '*',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "webhook_entregas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "webhookId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "exitoso" BOOLEAN NOT NULL,
    "error" TEXT,
    "duracionMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_entregas_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhook_endpoints" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suscripciones_push" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "suscripciones_push_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notificaciones_historial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canal" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "severidad" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "exitoso" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "duracionMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "instalaciones_nombre_key" ON "instalaciones"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "asignaciones_operadores_instalacionId_usuarioId_key" ON "asignaciones_operadores"("instalacionId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_medidor_nombre_key" ON "tipos_medidor"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "medidores_codigo_key" ON "medidores"("codigo");

-- CreateIndex
CREATE INDEX "lecturas_medidorId_fechaLectura_idx" ON "lecturas"("medidorId", "fechaLectura" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "lecturas_medidorId_fechaLectura_key" ON "lecturas"("medidorId", "fechaLectura");

-- CreateIndex
CREATE INDEX "auditoria_eventos_entidad_entidadId_idx" ON "auditoria_eventos"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "auditoria_eventos_accion_idx" ON "auditoria_eventos"("accion");

-- CreateIndex
CREATE INDEX "auditoria_eventos_createdAt_idx" ON "auditoria_eventos"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_entregas_webhookId_createdAt_idx" ON "webhook_entregas"("webhookId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_push_endpoint_key" ON "suscripciones_push"("endpoint");

-- CreateIndex
CREATE INDEX "suscripciones_push_usuarioId_idx" ON "suscripciones_push"("usuarioId");

-- CreateIndex
CREATE INDEX "notificaciones_historial_canal_createdAt_idx" ON "notificaciones_historial"("canal", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notificaciones_historial_evento_idx" ON "notificaciones_historial"("evento");

