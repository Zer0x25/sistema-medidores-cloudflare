import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

export const demoRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

demoRouter.post("/api/demo/seed", async (c) => {
  const defaultPasswordHash =
    "a1a12b3ffb856cd9a5dbaa89d02ff57c:9571b4697c3ab7b2ed7279fc80498a1cbcc25ddb77cc0bb9c720c26975e2c684da09036cb9a7a143bf6b863a71d83d59aeb774b40cf6fd4c2751f102c6a42c75";

  const seedQueries = [
    `INSERT OR IGNORE INTO "usuarios" ("id", "email", "passwordHash", "nombre", "rol", "activo", "createdAt", "updatedAt")
     VALUES
       ('usr-admin-01', 'admin@medidores.cl', '${defaultPasswordHash}', 'Administrador Central', 'ADMIN', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('usr-super-01', 'supervisor@medidores.cl', '${defaultPasswordHash}', 'Carlos Supervisor (Planta Norte)', 'SUPERVISOR', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('usr-oper-01', 'operador@medidores.cl', '${defaultPasswordHash}', 'Juan Operador Terreno', 'OPERADOR', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,

    `UPDATE "usuarios" SET activo = 1, passwordHash = '${defaultPasswordHash}' WHERE id IN ('usr-admin-01', 'usr-super-01', 'usr-oper-01');`,

    `INSERT OR IGNORE INTO "instalaciones" ("id", "nombre", "ubicacion", "activa", "createdAt", "updatedAt")
     VALUES
       ('inst-01', 'Planta Industrial Norte', 'Sector Industrial Panamericana Km 15', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('inst-02', 'Edificio Corporativo', 'Av. Las Condes 12500', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,

    `INSERT OR IGNORE INTO "tipos_medidor" ("id", "nombre", "recurso", "unidad", "tipoMedicion", "activo", "createdAt", "updatedAt")
     VALUES
       ('tipo-agua', 'Agua Potable Matriz', 'AGUA', 'M3', 'ACUMULATIVO', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('tipo-luz', 'Electricidad Trifásica', 'LUZ', 'KWH', 'ACUMULATIVO', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('tipo-petroleo', 'Tanque Petróleo Diésel', 'PETROLEO', 'LITROS', 'NIVEL', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('tipo-gas', 'Gas Natural Red', 'GAS', 'M3', 'ACUMULATIVO', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,

    `INSERT OR IGNORE INTO "medidores" ("id", "instalacionId", "tipoMedidorId", "codigo", "numeroSerie", "ubicacionInterna", "activo", "createdAt", "updatedAt")
     VALUES
       ('med-01', 'inst-01', 'tipo-agua', 'MED-AGUA-01', 'SN-AG-99120', 'Sala de Bombas Principal', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-02', 'inst-01', 'tipo-luz', 'MED-LUZ-01', 'SN-EL-55410', 'Subestación Eléctrica 1', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-03', 'inst-01', 'tipo-petroleo', 'MED-PETR-01', 'SN-PE-11200', 'Patio de Calderas', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ('med-04', 'inst-02', 'tipo-gas', 'MED-GAS-01', 'SN-GS-88300', 'Entrada Red Gas Poniente', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,

    `INSERT OR IGNORE INTO "asignaciones_operadores" ("id", "instalacionId", "usuarioId", "createdAt")
     VALUES
       ('asig-01', 'inst-01', 'usr-super-01', CURRENT_TIMESTAMP),
       ('asig-02', 'inst-01', 'usr-oper-01', CURRENT_TIMESTAMP);`,

    `INSERT OR IGNORE INTO "lecturas" ("id", "medidorId", "operadorId", "valor", "fechaLectura", "notas", "createdAt")
     VALUES
       ('lec-01', 'med-01', 'usr-oper-01', 1250.5, CURRENT_TIMESTAMP, 'Lectura inicial de verificación', CURRENT_TIMESTAMP),
       ('lec-02', 'med-02', 'usr-oper-01', 48200.0, CURRENT_TIMESTAMP, 'Lectura inicial de subestación', CURRENT_TIMESTAMP);`
  ];

  for (const q of seedQueries) {
    await c.env.DB.prepare(q).run();
  }

  return c.json({
    success: true,
    message: "Base de datos inicializada y restablecida con datos demo.",
    usuarios: ["admin@medidores.cl", "supervisor@medidores.cl", "operador@medidores.cl"],
  });
});
