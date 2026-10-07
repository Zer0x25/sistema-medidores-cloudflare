import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";
import { sqlInList } from "../db.js";
import type { D1Database } from "@cloudflare/workers-types";

export const reportesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

async function consumoMedidoPorModo(
  db: D1Database,
  instalacionId: string,
  recurso: string,
  inicio: string,
  fin: string
): Promise<number> {
  const { results: meds } = await db.prepare(
    "SELECT m.id, t.tipoMedicion FROM medidores m JOIN tipos_medidor t ON m.tipoMedidorId = t.id WHERE m.instalacionId = ? AND t.recurso = ? AND m.activo = 1"
  ).bind(instalacionId, recurso).all<{ id: string; tipoMedicion: string }>();
  let total = 0;
  for (const m of meds) {
    const { results: lecs } = await db.prepare(
      "SELECT valor FROM lecturas WHERE medidorId = ? AND fechaLectura >= ? AND fechaLectura <= ? ORDER BY fechaLectura ASC LIMIT 500"
    ).bind(m.id, inicio, fin).all<{ valor: number }>();
    if (lecs.length === 0) continue;
    if (m.tipoMedicion === "ACUMULATIVO") {
      if (lecs.length >= 2) total += Math.max(0, lecs[lecs.length - 1].valor - lecs[0].valor);
    } else if (m.tipoMedicion === "NIVEL") {
      const bajada = Math.max(0, Number((lecs[0].valor - lecs[lecs.length - 1].valor).toFixed(2)));
      const rec = await db.prepare(
        "SELECT COALESCE(SUM(volumenRecargado),0) as t FROM registros_mantenimiento WHERE medidorId = ? AND tipo = 'RECARGA_TANQUE' AND fechaMantenimiento >= ? AND fechaMantenimiento <= ?"
      ).bind(m.id, inicio, fin).first<{ t: number }>().catch(() => ({ t: 0 }));
      total += bajada + (rec?.t || 0);
    } else {
      const suma = lecs.reduce((a, l) => a + l.valor, 0);
      total += suma / lecs.length;
    }
  }
  return Number(total.toFixed(2));
}

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

// Consumo agregado por instalación y recurso (feat-024 por modo)
reportesRouter.get("/api/reportes/consumo-instalacion", async (c) => {
  const user = c.get("user");
  let whereClause = "";
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    whereClause = `WHERE i.id IN (${sqlInList(allowed)})`;
  }

  const { results: meds } = await c.env.DB.prepare(`
    SELECT i.id as instalacionId, i.nombre as instalacionNombre, t.recurso, t.unidad,
      m.id as medidorId, t.tipoMedicion
    FROM instalaciones i
    JOIN medidores m ON m.instalacionId = i.id AND m.activo = 1
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    ${whereClause}
    ORDER BY i.nombre, t.recurso LIMIT 500
  `).all<{ instalacionId: string; instalacionNombre: string; recurso: string; unidad: string; medidorId: string; tipoMedicion: string }>();

  const { results: stats } = await c.env.DB.prepare(
    "SELECT medidorId, MIN(valor) as minV, MAX(valor) as maxV, AVG(valor) as avgV, COUNT(id) as n FROM lecturas GROUP BY medidorId"
  ).all<{ medidorId: string; minV: number | null; maxV: number | null; avgV: number | null; n: number }>();
  const statMap = new Map(stats.map((s) => [s.medidorId, s]));
  const { results: recs } = await c.env.DB.prepare(
    "SELECT medidorId, COALESCE(SUM(volumenRecargado),0) as t FROM registros_mantenimiento WHERE tipo = 'RECARGA_TANQUE' GROUP BY medidorId"
  ).all<{ medidorId: string; t: number }>().catch(() => ({ results: [] as Array<{ medidorId: string; t: number }> }));
  const recMap = new Map((recs || []).map((r) => [r.medidorId, r.t || 0]));

  const grupos = new Map<string, { instalacionId: string; instalacionNombre: string; recurso: string; unidad: string; medidoresCount: number; lecturasCount: number; consumoNetoEstimado: number }>();
  for (const m of meds) {
    const key = `${m.instalacionId}:${m.recurso}`;
    if (!grupos.has(key)) {
      grupos.set(key, { instalacionId: m.instalacionId, instalacionNombre: m.instalacionNombre, recurso: m.recurso, unidad: m.unidad, medidoresCount: 0, lecturasCount: 0, consumoNetoEstimado: 0 });
    }
    const g = grupos.get(key);
    if (!g) continue;
    g.medidoresCount += 1;
    const st = statMap.get(m.medidorId);
    if (!st) continue;
    g.lecturasCount += st.n || 0;
    if (m.tipoMedicion === "ACUMULATIVO") {
      if ((st.n || 0) >= 2 && st.minV !== null && st.maxV !== null) g.consumoNetoEstimado += Math.max(0, st.maxV - st.minV);
    } else if (m.tipoMedicion === "NIVEL") {
      const { results: ord } = await c.env.DB.prepare(
        "SELECT valor FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura ASC LIMIT 200"
      ).bind(m.medidorId).all<{ valor: number }>();
      if (ord.length >= 1) {
        g.consumoNetoEstimado += Math.max(0, Number((ord[0].valor - ord[ord.length - 1].valor).toFixed(2))) + (recMap.get(m.medidorId) || 0);
      }
    } else if (st.avgV !== null) {
      g.consumoNetoEstimado += Number(st.avgV.toFixed(2));
    }
  }
  return c.json([...grupos.values()].map((g) => ({ ...g, consumoNetoEstimado: Number(g.consumoNetoEstimado.toFixed(2)) })));
});

// Registrar factura de servicio y conciliar inmediatamente
reportesRouter.post("/api/reportes/facturas", async (c) => {
  const user = c.get("user");
  if (!user || (user.rol !== "ADMIN" && user.rol !== "SUPERVISOR")) {
    return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);
  }

  const body = await c.req.json();
  const parsed = FacturaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos de factura inválidos" }, 400);

  const id = crypto.randomUUID();
  const data = parsed.data;

  if (user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(data.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
  }

  const inst = await c.env.DB.prepare("SELECT id FROM instalaciones WHERE id = ?").bind(data.instalacionId).first();
  if (!inst) return c.json({ error: "NOT_FOUND", message: "Instalación no encontrada" }, 404);

  // Calcular consumo medido por modo (feat-024) en el período
  const consumoMedido = await consumoMedidoPorModo(c.env.DB, data.instalacionId, data.recurso, data.periodoInicio, data.periodoFin);
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
  const user = c.get("user");
  let whereClause = "";
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    whereClause = `WHERE f.instalacionId IN (${sqlInList(allowed)})`;
  }

  const { results } = await c.env.DB.prepare(`
    SELECT f.*, i.nombre as instalacionNombre
    FROM facturas_servicio f
    JOIN instalaciones i ON f.instalacionId = i.id
    ${whereClause}
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

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(factura.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
  }

  // Calcular consumo medido por modo (feat-024) en el período
  const consumoMedido = await consumoMedidoPorModo(c.env.DB, factura.instalacionId, factura.recurso, factura.periodoInicio, factura.periodoFin);
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

// Consumos detallados por medidor (feat-024 por modo)
reportesRouter.get("/api/reportes/consumos", async (c) => {
  const user = c.get("user");
  const instalacionId = c.req.query("instalacionId");
  const medidorId = c.req.query("medidorId");
  const recurso = c.req.query("recurso");
  const fechaInicio = c.req.query("fechaInicio");
  const fechaFin = c.req.query("fechaFin");

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (instalacionId && !allowed.includes(instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
    if (allowed.length === 0) {
      return c.json([]);
    }
  }

  const medConds: string[] = [];
  const medParams: unknown[] = [];
  if (instalacionId) { medConds.push("m.instalacionId = ?"); medParams.push(instalacionId); }
  else if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    medConds.push(`m.instalacionId IN (${sqlInList(allowed)})`);
  }
  if (medidorId) { medConds.push("m.id = ?"); medParams.push(medidorId); }
  if (recurso) { medConds.push("t.recurso = ?"); medParams.push(recurso); }
  const medWhere = medConds.length > 0 ? `WHERE ${medConds.join(" AND ")}` : "";

  const { results: meds } = await c.env.DB.prepare(`
    SELECT i.nombre as instalacionNombre, m.id as medidorId, m.codigo as medidorCodigo,
      t.recurso, t.unidad, t.tipoMedicion
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    ${medWhere}
    ORDER BY i.nombre, m.codigo LIMIT 200
  `).bind(...medParams).all<{
    instalacionNombre: string; medidorId: string; medidorCodigo: string;
    recurso: string; unidad: string; tipoMedicion: string;
  }>();

  const out = [];
  for (const m of meds) {
    const lecConds: string[] = ["medidorId = ?"];
    const lecParams: unknown[] = [m.medidorId];
    if (fechaInicio) { lecConds.push("fechaLectura >= ?"); lecParams.push(fechaInicio); }
    if (fechaFin) { lecConds.push("fechaLectura <= ?"); lecParams.push(fechaFin); }
    const { results: lecs } = await c.env.DB.prepare(
      `SELECT valor FROM lecturas WHERE ${lecConds.join(" AND ")} ORDER BY fechaLectura ASC LIMIT 500`
    ).bind(...lecParams).all<{ valor: number }>();
    let consumoNeto = 0;
    if (m.tipoMedicion === "ACUMULATIVO") {
      if (lecs.length >= 2) consumoNeto = Math.max(0, Number((lecs[lecs.length - 1].valor - lecs[0].valor).toFixed(2)));
    } else if (m.tipoMedicion === "NIVEL") {
      if (lecs.length >= 1) {
        const bajada = Math.max(0, Number((lecs[0].valor - lecs[lecs.length - 1].valor).toFixed(2)));
        let recTotal: number;
        try {
          const recConds: string[] = ["medidorId = ?", "tipo = 'RECARGA_TANQUE'"];
          const recParams: unknown[] = [m.medidorId];
          if (fechaInicio) { recConds.push("fechaMantenimiento >= ?"); recParams.push(fechaInicio); }
          if (fechaFin) { recConds.push("fechaMantenimiento <= ?"); recParams.push(fechaFin); }
          const rec = await c.env.DB.prepare(
            `SELECT COALESCE(SUM(volumenRecargado),0) as t FROM registros_mantenimiento WHERE ${recConds.join(" AND ")}`
          ).bind(...recParams).first<{ t: number }>();
          recTotal = rec?.t || 0;
        } catch { recTotal = 0; }
        recTotal = recTotal ?? 0;
        consumoNeto = Number((bajada + recTotal).toFixed(2));
      }
    } else if (lecs.length >= 1) {
      const suma = lecs.reduce((a, l) => a + l.valor, 0);
      consumoNeto = Number((suma / lecs.length).toFixed(2));
    }
    out.push({
      instalacionNombre: m.instalacionNombre,
      medidorId: m.medidorId,
      medidorCodigo: m.medidorCodigo,
      recurso: m.recurso,
      unidad: m.unidad,
      lecturaInicial: lecs.length > 0 ? lecs[0].valor : 0,
      lecturaFinal: lecs.length > 0 ? lecs[lecs.length - 1].valor : 0,
      consumoNeto,
      totalLecturas: lecs.length,
    });
  }

  return c.json(out);
});

// Exportar reporte de consumos a CSV
reportesRouter.get("/api/reportes/consumos/exportar-csv", async (c) => {
  const user = c.get("user");
  const instalacionId = c.req.query("instalacionId");
  const medidorId = c.req.query("medidorId");
  const recurso = c.req.query("recurso");
  const fechaInicio = c.req.query("fechaInicio");
  const fechaFin = c.req.query("fechaFin");

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (instalacionId && !allowed.includes(instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a esta instalación" }, 403);
    }
    if (allowed.length === 0) {
      return new Response("Instalacion,Medidor,Recurso,Unidad,Lectura Inicial,Lectura Final,Consumo Neto,Total Lecturas\r\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="reporte_consumos.csv"',
        },
      });
    }
  }

  const medConds: string[] = [];
  const medParams: unknown[] = [];

  if (instalacionId) {
    medConds.push("m.instalacionId = ?");
    medParams.push(instalacionId);
  } else if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    medConds.push(`m.instalacionId IN (${sqlInList(allowed)})`);
  }
  if (medidorId) {
    medConds.push("m.id = ?");
    medParams.push(medidorId);
  }
  if (recurso) {
    medConds.push("t.recurso = ?");
    medParams.push(recurso);
  }

  const medWhere = medConds.length > 0 ? `WHERE ${medConds.join(" AND ")}` : "";

  const { results: medsCsv } = await c.env.DB.prepare(`
    SELECT
      i.nombre as instalacionNombre,
      m.id as medidorId,
      m.codigo as medidorCodigo,
      t.recurso,
      t.unidad,
      t.tipoMedicion
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    ${medWhere}
    ORDER BY i.nombre, m.codigo LIMIT 200
  `).bind(...medParams).all<{
    instalacionNombre: string; medidorId: string; medidorCodigo: string;
    recurso: string; unidad: string; tipoMedicion: string;
  }>();

  const rows: Array<{ instalacionNombre: string; medidorCodigo: string; recurso: string; unidad: string; lecturaInicial: number; lecturaFinal: number; consumoNeto: number; totalLecturas: number }> = [];
  for (const m of medsCsv) {
    const lecConds: string[] = ["medidorId = ?"];
    const lecParams: unknown[] = [m.medidorId];
    if (fechaInicio) { lecConds.push("fechaLectura >= ?"); lecParams.push(fechaInicio); }
    if (fechaFin) { lecConds.push("fechaLectura <= ?"); lecParams.push(fechaFin); }
    const { results: lecs } = await c.env.DB.prepare(
      `SELECT valor FROM lecturas WHERE ${lecConds.join(" AND ")} ORDER BY fechaLectura ASC LIMIT 500`
    ).bind(...lecParams).all<{ valor: number }>();
    let consumoNeto = 0;
    if (m.tipoMedicion === "ACUMULATIVO") {
      if (lecs.length >= 2) consumoNeto = Math.max(0, Number((lecs[lecs.length - 1].valor - lecs[0].valor).toFixed(2)));
    } else if (m.tipoMedicion === "NIVEL") {
      if (lecs.length >= 1) {
        const bajada = Math.max(0, Number((lecs[0].valor - lecs[lecs.length - 1].valor).toFixed(2)));
        let recTotal: number;
        try {
          const recConds: string[] = ["medidorId = ?", "tipo = 'RECARGA_TANQUE'"];
          const recParams: unknown[] = [m.medidorId];
          if (fechaInicio) { recConds.push("fechaMantenimiento >= ?"); recParams.push(fechaInicio); }
          if (fechaFin) { recConds.push("fechaMantenimiento <= ?"); recParams.push(fechaFin); }
          const rec = await c.env.DB.prepare(
            `SELECT COALESCE(SUM(volumenRecargado),0) as t FROM registros_mantenimiento WHERE ${recConds.join(" AND ")}`
          ).bind(...recParams).first<{ t: number }>();
          recTotal = rec?.t || 0;
        } catch { recTotal = 0; }
        recTotal = recTotal ?? 0;
        consumoNeto = Number((bajada + recTotal).toFixed(2));
      }
    } else if (lecs.length >= 1) {
      consumoNeto = Number((lecs.reduce((a, l) => a + l.valor, 0) / lecs.length).toFixed(2));
    }
    rows.push({
      instalacionNombre: m.instalacionNombre,
      medidorCodigo: m.medidorCodigo,
      recurso: m.recurso,
      unidad: m.unidad,
      lecturaInicial: lecs.length > 0 ? lecs[0].valor : 0,
      lecturaFinal: lecs.length > 0 ? lecs[lecs.length - 1].valor : 0,
      consumoNeto,
      totalLecturas: lecs.length,
    });
  }

  let csv = "Instalacion,Medidor,Recurso,Unidad,Lectura Inicial,Lectura Final,Consumo Neto,Total Lecturas\r\n";
  for (const r of rows) {
    csv += `"${r.instalacionNombre}","${r.medidorCodigo}","${r.recurso}","${r.unidad}",${r.lecturaInicial},${r.lecturaFinal},${r.consumoNeto},${r.totalLecturas}\r\n`;
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reporte_consumos.csv"',
    },
  });
});
