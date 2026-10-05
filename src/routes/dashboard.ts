import { Hono } from "hono";
import type { Env, Variables } from "../types.js";

export const dashboardRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. KPIs del Dashboard (Contrato completo esperado por app.js)
dashboardRouter.get("/api/dashboard/kpis", async (c) => {
  // Total instalaciones activas
  const instStat = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM instalaciones WHERE activa = 1"
  ).first<{ total: number }>();

  // Total medidores activos y desglose por recurso
  const { results: medidoresPorRecursoRows } = await c.env.DB.prepare(`
    SELECT t.recurso, COUNT(m.id) as cantidad
    FROM medidores m
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.activo = 1
    GROUP BY t.recurso
  `).all<{ recurso: string; cantidad: number }>();

  const medidoresPorRecurso: Record<string, number> = {};
  let totalMedidores = 0;
  for (const row of medidoresPorRecursoRows) {
    medidoresPorRecurso[row.recurso] = row.cantidad;
    totalMedidores += row.cantidad;
  }

  // Total lecturas
  const lecturasStat = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM lecturas"
  ).first<{ total: number }>();

  // Total alertas abiertas
  const alertasStat = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM incidentes_alerta WHERE estado = 'ABIERTO'"
  ).first<{ total: number }>();

  return c.json({
    totalInstalaciones: instStat?.total || 0,
    totalMedidores,
    totalLecturas: lecturasStat?.total || 0,
    medidoresPorRecurso,
    // Compatibilidad adicional
    medidoresTotales: totalMedidores,
    medidoresActivos: totalMedidores,
    lecturasRegistradas: lecturasStat?.total || 0,
    alertasActivas: alertasStat?.total || 0,
    timestamp: new Date().toISOString(),
  });
});

// 2. Medidores desatendidos (+24h)
dashboardRouter.get("/api/dashboard/desatendidos", async (c) => {
  const horasParam = c.req.query("horas");
  const horasUmbral = horasParam ? parseInt(horasParam, 10) : 24;

  const { results: medidores } = await c.env.DB.prepare(`
    SELECT 
      m.id as medidorId,
      m.codigo,
      m.ubicacionInterna,
      i.id as instalacionId,
      i.nombre as instalacionNombre,
      MAX(l.fechaLectura) as ultimaLecturaFecha
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    LEFT JOIN lecturas l ON l.medidorId = m.id
    WHERE m.activo = 1
    GROUP BY m.id
  `).all<{
    medidorId: string;
    codigo: string;
    ubicacionInterna: string;
    instalacionId: string;
    instalacionNombre: string;
    ultimaLecturaFecha: string | null;
  }>();

  const now = Date.now();
  const umbralMs = horasUmbral * 3600 * 1000;
  const desatendidos = [];

  for (const m of medidores) {
    if (!m.ultimaLecturaFecha) {
      desatendidos.push({
        medidorId: m.medidorId,
        codigo: m.codigo,
        instalacionId: m.instalacionId,
        instalacionNombre: m.instalacionNombre,
        ubicacionInterna: m.ubicacionInterna,
        ultimaLecturaFecha: null,
        horasSinLectura: null,
      });
    } else {
      let raw = m.ultimaLecturaFecha.trim();
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
        raw = raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
      }
      const diffMs = now - new Date(raw).getTime();
      if (diffMs >= umbralMs) {
        desatendidos.push({
          medidorId: m.medidorId,
          codigo: m.codigo,
          instalacionId: m.instalacionId,
          instalacionNombre: m.instalacionNombre,
          ubicacionInterna: m.ubicacionInterna,
          ultimaLecturaFecha: m.ultimaLecturaFecha,
          horasSinLectura: Math.floor(diffMs / (3600 * 1000)),
        });
      }
    }
  }

  return c.json(desatendidos);
});

// 3. Consumo neto agrupado por instalación y recurso
dashboardRouter.get("/api/dashboard/consumos", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      i.id as instalacionId,
      i.nombre as instalacionNombre,
      t.recurso,
      t.unidad as unidadMedida,
      COUNT(DISTINCT m.id) as cantidadMedidores,
      COALESCE(SUM(CASE WHEN t.tipoMedicion = 'ACUMULATIVO' THEN (sub.maxVal - sub.minVal) ELSE 0 END), 0) as consumoNeto
    FROM instalaciones i
    JOIN medidores m ON m.instalacionId = i.id AND m.activo = 1
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    LEFT JOIN (
      SELECT medidorId, MIN(valor) as minVal, MAX(valor) as maxVal, COUNT(id) as countLec
      FROM lecturas
      GROUP BY medidorId
      HAVING countLec >= 2
    ) sub ON sub.medidorId = m.id
    GROUP BY i.id, t.recurso
    ORDER BY i.nombre, t.recurso
  `).all<{
    instalacionId: string;
    instalacionNombre: string;
    recurso: string;
    unidadMedida: string;
    cantidadMedidores: number;
    consumoNeto: number;
  }>();

  return c.json(results);
});

// 4. Actividad reciente de telemetría (últimas lecturas con formato compatible con components.js)
dashboardRouter.get("/api/dashboard/actividad-reciente", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 10;

  const { results } = await c.env.DB.prepare(`
    SELECT 
      l.id,
      l.valor,
      l.fechaLectura,
      l.notas,
      m.id as medidorId,
      m.codigo as medidorCodigo,
      m.ubicacionInterna,
      i.id as instalacionId,
      i.nombre as instalacionNombre,
      t.id as tipoMedidorId,
      t.nombre as tipoMedidorNombre,
      t.recurso,
      t.unidad
    FROM lecturas l
    JOIN medidores m ON l.medidorId = m.id
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    ORDER BY l.fechaLectura DESC
    LIMIT ?
  `).bind(limit).all<{
    id: string;
    valor: number;
    fechaLectura: string;
    notas: string | null;
    medidorId: string;
    medidorCodigo: string;
    ubicacionInterna: string;
    instalacionId: string;
    instalacionNombre: string;
    tipoMedidorId: string;
    tipoMedidorNombre: string;
    recurso: string;
    unidad: string;
  }>();

  const formatted = results.map((r) => {
    let raw = r.fechaLectura ? r.fechaLectura.trim() : "";
    let iso = raw;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
      iso = raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
    }
    return {
      id: r.id,
      valor: r.valor,
      timestamp: iso,
      fechaLectura: iso,
      fecha: iso,
      notas: r.notas,
    medidor: {
      id: r.medidorId,
      codigo: r.medidorCodigo,
      ubicacionInterna: r.ubicacionInterna,
      instalacion: {
        id: r.instalacionId,
        nombre: r.instalacionNombre,
      },
      tipoMedidor: {
        id: r.tipoMedidorId,
        nombre: r.tipoMedidorNombre,
        recurso: r.recurso,
        unidadMedida: r.unidad,
        unidad: r.unidad,
      },
    },
  };
});

  return c.json(formatted);
});
