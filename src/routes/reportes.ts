import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const reportesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const FacturaSchema = z.object({
  instalacionId: z.string().min(1),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO"]),
  periodoInicio: z.string(),
  periodoFin: z.string(),
  consumoFacturado: z.number().positive(),
  unidad: z.string().min(1),
  montoTotal: z.number().optional(),
  numeroFactura: z.string().optional(),
  notas: z.string().optional(),
});

// Consumo agregado por instalación y recurso
reportesRouter.get("/api/reportes/consumo-instalacion", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      i.id as instalacionId,
      i.nombre as instalacionNombre,
      t.recurso,
      t.unidad,
      COUNT(DISTINCT m.id) as medidoresCount,
      COUNT(l.id) as lecturasCount,
      COALESCE(MAX(l.valor) - MIN(l.valor), 0) as consumoNetoEstimado
    FROM instalaciones i
    JOIN medidores m ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    LEFT JOIN lecturas l ON l.medidorId = m.id
    GROUP BY i.id, t.recurso
    ORDER BY i.nombre, t.recurso
  `).all();

  return c.json(results);
});

// Registrar factura de servicio y conciliar inmediatamente
reportesRouter.post("/api/reportes/facturas", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  const body = await c.req.json();
  const parsed = FacturaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos de factura inválidos" }, 400);

  const id = crypto.randomUUID();
  const data = parsed.data;

  const inst = await c.env.DB.prepare("SELECT id FROM instalaciones WHERE id = ?").bind(data.instalacionId).first();
  if (!inst) return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);

  // Calcular consumo medido por medidores de esa instalación y recurso en el período
  const medicion = await c.env.DB.prepare(`
    SELECT COALESCE(MAX(l.valor) - MIN(l.valor), 0) as consumoMedido
    FROM lecturas l
    JOIN medidores m ON l.medidorId = m.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.instalacionId = ? AND t.recurso = ?
      AND l.fechaLectura >= ? AND l.fechaLectura <= ?
  `)
    .bind(data.instalacionId, data.recurso, data.periodoInicio, data.periodoFin)
    .first<{ consumoMedido: number }>();

  const consumoMedido = medicion?.consumoMedido || 0;
  const diferencia = data.consumoFacturado - consumoMedido;
  const porcentajeDesvio = consumoMedido > 0 ? (diferencia / consumoMedido) * 100 : 0;
  const estado = (consumoMedido > 0 && Math.abs(porcentajeDesvio) <= 5.0) ? "CONCILIADO" : "DISCREPANCIA";

  await c.env.DB.prepare(`
    INSERT INTO facturas_servicio (
      id, instalacionId, recurso, periodoInicio, periodoFin, consumoFacturado,
      unidad, montoTotal, numeroFactura, estadoConciliacion, consumoMedido, diferenciaConsumo, porcentajeDesvio, notas, createdAt, updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(
      id, data.instalacionId, data.recurso, data.periodoInicio, data.periodoFin,
      data.consumoFacturado, data.unidad, data.montoTotal || null,
      data.numeroFactura || null, estado, consumoMedido, diferencia, porcentajeDesvio, data.notas || null
    )
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "REGISTRO_FACTURA_SERVICIO",
    entidad: "FacturaServicio",
    entidadId: id,
    detalles: { ...data, estadoConciliacion: estado },
  });

  return c.json({
    id,
    ...data,
    consumoMedido,
    diferenciaConsumo: diferencia,
    porcentajeDesvio,
    estadoConciliacion: estado,
  }, 201);
});

// Listar facturas
reportesRouter.get("/api/reportes/facturas", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT f.*, i.nombre as instalacionNombre
    FROM facturas_servicio f
    JOIN instalaciones i ON f.instalacionId = i.id
    ORDER BY f.periodoInicio DESC
  `).all();

  return c.json(results);
});

// Conciliar factura contra consumo medido en el período
reportesRouter.post("/api/reportes/conciliar/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const factura = await c.env.DB.prepare("SELECT * FROM facturas_servicio WHERE id = ?").bind(id).first<{
    id: string;
    instalacionId: string;
    recurso: string;
    periodoInicio: string;
    periodoFin: string;
    consumoFacturado: number;
  }>();

  if (!factura) return c.json({ error: "NOT_FOUND", message: "Factura no encontrada" }, 404);

  // Calcular consumo medido por medidores de esa instalación y recurso en el período
  const medicion = await c.env.DB.prepare(`
    SELECT COALESCE(MAX(l.valor) - MIN(l.valor), 0) as consumoMedido
    FROM lecturas l
    JOIN medidores m ON l.medidorId = m.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.instalacionId = ? AND t.recurso = ?
      AND l.fechaLectura >= ? AND l.fechaLectura <= ?
  `)
    .bind(factura.instalacionId, factura.recurso, factura.periodoInicio, factura.periodoFin)
    .first<{ consumoMedido: number }>();

  const consumoMedido = medicion?.consumoMedido || 0;
  const diferencia = factura.consumoFacturado - consumoMedido;
  const porcentajeDesvio = consumoMedido > 0 ? (diferencia / consumoMedido) * 100 : 0;
  const estado = Math.abs(porcentajeDesvio) <= 5 ? "CONCILIADO" : "DISCREPANCIA";

  await c.env.DB.prepare(`
    UPDATE facturas_servicio
    SET consumoMedido = ?, diferenciaConsumo = ?, porcentajeDesvio = ?, estadoConciliacion = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(consumoMedido, diferencia, porcentajeDesvio, estado, id)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CONCILIACION_FACTURA",
    entidad: "FacturaServicio",
    entidadId: id,
    detalles: { consumoMedido, diferencia, porcentajeDesvio, estado },
  });

  return c.json({
    facturaId: id,
    consumoFacturado: factura.consumoFacturado,
    consumoMedido,
    diferenciaConsumo: diferencia,
    porcentajeDesvio,
    estadoConciliacion: estado,
  });
});

// Consumos detallados por medidor
reportesRouter.get("/api/reportes/consumos", async (c) => {
  const instalacionId = c.req.query("instalacionId");
  const medidorId = c.req.query("medidorId");
  const recurso = c.req.query("recurso");
  const fechaInicio = c.req.query("fechaInicio");
  const fechaFin = c.req.query("fechaFin");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (instalacionId) {
    conditions.push("m.instalacionId = ?");
    params.push(instalacionId);
  }
  if (medidorId) {
    conditions.push("m.id = ?");
    params.push(medidorId);
  }
  if (recurso) {
    conditions.push("t.recurso = ?");
    params.push(recurso);
  }
  if (fechaInicio) {
    conditions.push("l.fechaLectura >= ?");
    params.push(fechaInicio);
  }
  if (fechaFin) {
    conditions.push("l.fechaLectura <= ?");
    params.push(fechaFin);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await c.env.DB.prepare(`
    SELECT 
      i.nombre as instalacionNombre,
      m.id as medidorId,
      m.codigo as medidorCodigo,
      t.recurso,
      t.unidad,
      COALESCE(MIN(l.valor), 0) as lecturaInicial,
      COALESCE(MAX(l.valor), 0) as lecturaFinal,
      COALESCE(MAX(l.valor) - MIN(l.valor), 0) as consumoNeto,
      COUNT(l.id) as totalLecturas
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    LEFT JOIN lecturas l ON l.medidorId = m.id
    ${whereClause}
    GROUP BY m.id
    ORDER BY i.nombre, m.codigo
  `).bind(...params).all();

  return c.json(results);
});

// Exportar reporte de consumos a CSV
reportesRouter.get("/api/reportes/consumos/exportar-csv", async (c) => {
  const instalacionId = c.req.query("instalacionId");
  const medidorId = c.req.query("medidorId");
  const recurso = c.req.query("recurso");
  const fechaInicio = c.req.query("fechaInicio");
  const fechaFin = c.req.query("fechaFin");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (instalacionId) {
    conditions.push("m.instalacionId = ?");
    params.push(instalacionId);
  }
  if (medidorId) {
    conditions.push("m.id = ?");
    params.push(medidorId);
  }
  if (recurso) {
    conditions.push("t.recurso = ?");
    params.push(recurso);
  }
  if (fechaInicio) {
    conditions.push("l.fechaLectura >= ?");
    params.push(fechaInicio);
  }
  if (fechaFin) {
    conditions.push("l.fechaLectura <= ?");
    params.push(fechaFin);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await c.env.DB.prepare(`
    SELECT 
      i.nombre as instalacionNombre,
      m.codigo as medidorCodigo,
      t.recurso,
      t.unidad,
      COALESCE(MIN(l.valor), 0) as lecturaInicial,
      COALESCE(MAX(l.valor), 0) as lecturaFinal,
      COALESCE(MAX(l.valor) - MIN(l.valor), 0) as consumoNeto,
      COUNT(l.id) as totalLecturas
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    LEFT JOIN lecturas l ON l.medidorId = m.id
    ${whereClause}
    GROUP BY m.id
    ORDER BY i.nombre, m.codigo
  `).bind(...params).all<{
    instalacionNombre: string;
    medidorCodigo: string;
    recurso: string;
    unidad: string;
    lecturaInicial: number;
    lecturaFinal: number;
    consumoNeto: number;
    totalLecturas: number;
  }>();

  let csv = "Instalacion,Medidor,Recurso,Unidad,Lectura Inicial,Lectura Final,Consumo Neto,Total Lecturas\r\n";
  for (const r of results) {
    csv += `"${r.instalacionNombre}","${r.medidorCodigo}","${r.recurso}","${r.unidad}",${r.lecturaInicial},${r.lecturaFinal},${r.consumoNeto},${r.totalLecturas}\r\n`;
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reporte_consumos.csv"',
    },
  });
});
