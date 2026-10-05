import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

export const demoRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

demoRouter.post("/api/demo/seed", async (c) => {
  const defaultPasswordHash =
    "a1a12b3ffb856cd9a5dbaa89d02ff57c:9571b4697c3ab7b2ed7279fc80498a1cbcc25ddb77cc0bb9c720c26975e2c684da09036cb9a7a143bf6b863a71d83d59aeb774b40cf6fd4c2751f102c6a42c75";

  const cleanupQueries = [
    `DELETE FROM "facturas_servicio";`,
    `DELETE FROM "lecturas";`,
    `DELETE FROM "incidentes_alerta";`,
    `DELETE FROM "registros_mantenimiento";`,
    `DELETE FROM "asignaciones_operadores";`,
    `DELETE FROM "medidores";`,
    `DELETE FROM "tipos_medidor";`,
    `DELETE FROM "instalaciones";`,
    `DELETE FROM "webhook_entregas";`,
    `DELETE FROM "webhook_endpoints";`,
    `DELETE FROM "suscripciones_push";`,
    `DELETE FROM "notificaciones_historial";`,
    `DELETE FROM "auditoria_eventos";`,
    `DELETE FROM "reglas_alerta";`,
  ];

  for (const q of cleanupQueries) {
    try {
      await c.env.DB.prepare(q).run();
    } catch {
      // Ignore if table does not exist yet
    }
  }

  const seedQueries = [
    // 1. Usuarios Demo
    `INSERT INTO "usuarios" ("id", "email", "passwordHash", "nombre", "rol", "activo", "createdAt", "updatedAt")
     VALUES
       ('usr-admin-01', 'admin@medidores.cl', '${defaultPasswordHash}', 'Administrador Central', 'ADMIN', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('usr-super-01', 'supervisor@medidores.cl', '${defaultPasswordHash}', 'Carlos Supervisor (Planta Norte)', 'SUPERVISOR', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('usr-oper-01', 'operador@medidores.cl', '${defaultPasswordHash}', 'Juan Operador Terreno', 'OPERADOR', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT("email") DO UPDATE SET activo = 1, passwordHash = '${defaultPasswordHash}', nombre = excluded.nombre, rol = excluded.rol;`,

    // 2. Instalaciones
    `INSERT INTO "instalaciones" ("id", "nombre", "ubicacion", "activa", "createdAt", "updatedAt")
     VALUES
       ('inst-01', 'Planta Industrial Norte', 'Sector Industrial Panamericana Km 15', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('inst-02', 'Edificio Corporativo', 'Av. Las Condes 12500', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT("id") DO UPDATE SET nombre = excluded.nombre, ubicacion = excluded.ubicacion, activa = 1;`,

    // 3. Tipos de Medidor
    `INSERT INTO "tipos_medidor" ("id", "nombre", "recurso", "unidad", "tipoMedicion", "activo", "createdAt", "updatedAt")
     VALUES
       ('tipo-agua', 'Agua Potable Red', 'AGUA', 'M3', 'ACUMULATIVO', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('tipo-luz', 'Electricidad Trifásica', 'LUZ', 'KWH', 'ACUMULATIVO', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('tipo-petroleo', 'Diésel Generador Respaldo', 'PETROLEO', 'LITROS', 'NIVEL', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('tipo-gas', 'Gas Natural Calderas', 'GAS', 'M3', 'ACUMULATIVO', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT("id") DO UPDATE SET nombre = excluded.nombre, recurso = excluded.recurso, unidad = excluded.unidad, tipoMedicion = excluded.tipoMedicion, activo = 1;`,

    // 4. Medidores Físicos (códigos canónicos esperados por tests E2E)
    `INSERT INTO "medidores" ("id", "instalacionId", "tipoMedidorId", "codigo", "numeroSerie", "ubicacionInterna", "precintoActual", "activo", "createdAt", "updatedAt")
     VALUES
       ('med-01', 'inst-01', 'tipo-agua', 'MED-AG-NORTE-01', 'SN-AG-99120', 'Sala de bombas - Patio Exterior', 'PREC-AG-2026-01', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-02', 'inst-01', 'tipo-luz', 'MED-LUZ-NORTE-01', 'SN-EL-55410', 'Subestación Eléctrica 1', 'PREC-LUZ-2026-02', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-03', 'inst-01', 'tipo-petroleo', 'MED-DIE-NORTE-01', 'SN-PE-11200', 'Patio de Tanques - Tanque 5.000L', 'PREC-DIE-2026-03', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-04', 'inst-02', 'tipo-agua', 'MED-AG-CORP-01', 'SN-AG-88200', 'Subterráneo -1 Sala Técnica', 'PREC-CORP-2026-04', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-05', 'inst-02', 'tipo-gas', 'MED-GAS-CORP-01', 'SN-GS-88300', 'Azotea Climatización', 'PREC-GAS-2026-05', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT("id") DO UPDATE SET instalacionId = excluded.instalacionId, tipoMedidorId = excluded.tipoMedidorId, codigo = excluded.codigo, numeroSerie = excluded.numeroSerie, ubicacionInterna = excluded.ubicacionInterna, precintoActual = excluded.precintoActual, activo = 1;`,

    // 5. Asignaciones de Operador
    `INSERT INTO "asignaciones_operadores" ("id", "instalacionId", "usuarioId", "createdAt")
     VALUES
       ('asig-01', 'inst-01', 'usr-super-01', CURRENT_TIMESTAMP),
       ('asig-02', 'inst-01', 'usr-oper-01', CURRENT_TIMESTAMP),
       ('asig-03', 'inst-02', 'usr-oper-01', CURRENT_TIMESTAMP)
     ON CONFLICT("id") DO NOTHING;`,

    // 6. Lecturas de Demostración y Pruebas
    `INSERT INTO "lecturas" ("id", "medidorId", "operadorId", "valor", "fechaLectura", "notas", "createdAt")
     VALUES
       ('lec-01', 'med-01', 'usr-oper-01', 1200.0, datetime('now', '-48 hours'), 'Lectura inicial', datetime('now', '-48 hours')),
       ('lec-02', 'med-01', 'usr-oper-01', 1245.5, datetime('now', '-24 hours'), 'Cierre día anterior', datetime('now', '-24 hours')),
       ('lec-03', 'med-01', 'usr-oper-01', 1289.0, datetime('now', '-2 hours'), 'Turno mañana', datetime('now', '-2 hours')),
       ('lec-04', 'med-02', 'usr-oper-01', 45000.0, datetime('now', '-24 hours'), 'Lectura inicio de semana', datetime('now', '-24 hours')),
       ('lec-05', 'med-02', 'usr-oper-01', 45320.0, datetime('now', '-1 hours'), 'Turno actual', datetime('now', '-1 hours')),
       ('lec-06', 'med-03', 'usr-oper-01', 4800.0, datetime('now', '-72 hours'), 'Llenado de estanque', datetime('now', '-72 hours')),
       ('lec-07', 'med-03', 'usr-oper-01', 4200.0, datetime('now', '-30 hours'), 'Consumo prueba de generador', datetime('now', '-30 hours'))
     ON CONFLICT("id") DO UPDATE SET valor = excluded.valor, fechaLectura = excluded.fechaLectura, notas = excluded.notas;`,

    // 7. Reglas de Alerta Iniciales
    `INSERT INTO "reglas_alerta" ("id", "nombre", "tipo", "recurso", "umbralValor", "activa", "createdAt", "updatedAt")
     VALUES
       ('reg-01', 'Alerta por Medidor sin Reporte > 48 horas', 'SIN_REPORTE', NULL, 48, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('reg-02', 'Detección de Salto Atípico de Consumo (+50%)', 'SALTO_CONSUMO', NULL, 50, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('reg-03', 'Detección de Fuga Continua en Agua', 'FUGA_PROBABLE', 'AGUA', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT("id") DO UPDATE SET activa = 1, umbralValor = excluded.umbralValor;`,

    // 8. Eventos Iniciales de Auditoría
    `INSERT INTO "auditoria_eventos" ("id", "usuarioId", "accion", "entidad", "entidadId", "detalles", "ip", "createdAt")
     VALUES
       ('aud-seed-01', 'usr-admin-01', 'LOGIN_EXITOSO', 'USUARIO', 'usr-admin-01', '{"navegador":"Chrome"}', '127.0.0.1', datetime('now', '-1 hours')),
       ('aud-seed-02', 'usr-admin-01', 'CREAR_INSTALACION', 'Instalacion', 'inst-01', '{"nombre":"Planta Industrial Norte"}', '127.0.0.1', datetime('now', '-50 minutes'))
     ON CONFLICT("id") DO NOTHING;`
  ];

  for (const q of seedQueries) {
    await c.env.DB.prepare(q).run();
  }

  return c.json({
    success: true,
    message: "Base de datos inicializada y restablecida con datos demo para E2E y desarrollo.",
    usuarios: ["admin@medidores.cl", "supervisor@medidores.cl", "operador@medidores.cl"],
  });
});
