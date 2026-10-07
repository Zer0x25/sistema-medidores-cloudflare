import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import { sqlInList } from "../db.js";

export const dashboardRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. KPIs del Dashboard (Contrato completo esperado por app.js)
dashboardRouter.get("/api/dashboard/kpis", async (c) => {
  const user = c.get("user");
  let instWhere = "WHERE activa = 1";
  let medidoresWhere = "WHERE m.activo = 1";
  let lecturasWhere = "";
  let alertasWhere = "WHERE estado = 'ABIERTO'";

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json({
        totalInstalaciones: 0,
        totalMedidores: 0,
        totalLecturas: 0,
        medidoresPorRecurso: {},
        medidoresTotales: 0,
        medidoresActivos: 0,
        lecturasRegistradas: 0,
        alertasActivas: 0,
        timestamp: new Date().toISOString(),
      });
    }
    const inSql = sqlInList(allowed);
    instWhere += ` AND id IN (${inSql})`;
    medidoresWhere += ` AND m.instalacionId IN (${inSql})`;
    lecturasWhere = `JOIN medidores m ON lecturas.medidorId = m.id WHERE m.instalacionId IN (${inSql})`;
    alertasWhere += ` AND instalacionId IN (${inSql})`;
  }

  // Total instalaciones activas
  const instStat = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM instalaciones ${instWhere}`
  ).first<{ total: number }>();

  // Total medidores activos y desglose por recurso
  const { results: medidoresPorRecursoRows } = await c.env.DB.prepare(`
    SELECT t.recurso, COUNT(m.id) as cantidad
    FROM medidores m
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    ${medidoresWhere}
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
    `SELECT COUNT(*) as total FROM lecturas ${lecturasWhere}`
  ).first<{ total: number }>();

  // Total alertas abiertas
  const alertasStat = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM incidentes_alerta ${alertasWhere}`
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
  const user = c.get("user");
  const horasParam = c.req.query("horas");
  const horasUmbral = horasParam ? parseInt(horasParam, 10) : 24;

  let whereExtra = "";
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    whereExtra = `AND m.instalacionId IN (${sqlInList(allowed)})`;
  }

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
    WHERE m.activo = 1 ${whereExtra}
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

// 3. Consumo neto agrupado por instalación y recurso (feat-024: por modo ACUMULATIVO/NIVEL/INSTANTANEO)
dashboardRouter.get("/api/dashboard/consumos", async (c) => {
  const user = c.get("user");
  let whereExtra = "";
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    whereExtra = `WHERE i.id IN (${sqlInList(allowed)})`;
  }

  const { results: medidores } = await c.env.DB.prepare(`
    SELECT
      i.id as instalacionId, i.nombre as instalacionNombre,
      m.id as medidorId, t.recurso, t.unidad as unidadMedida, t.tipoMedicion
    FROM instalaciones i
    JOIN medidores m ON m.instalacionId = i.id AND m.activo = 1
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    ${whereExtra}
    ORDER BY i.nombre, t.recurso LIMIT 500
  `).all<{
    instalacionId: string; instalacionNombre: string; medidorId: string;
    recurso: string; unidadMedida: string; tipoMedicion: string;
  }>();

  const { results: stats } = await c.env.DB.prepare(`
    SELECT medidorId, MIN(valor) as minVal, MAX(valor) as maxVal, AVG(valor) as avgVal, COUNT(id) as n
    FROM lecturas GROUP BY medidorId
  `).all<{ medidorId: string; minVal: number | null; maxVal: number | null; avgVal: number | null; n: number }>();
  const statMap = new Map(stats.map((s) => [s.medidorId, s]));

  const { results: recargas } = await c.env.DB.prepare(`
    SELECT medidorId, COALESCE(SUM(volumenRecargado), 0) as total
    FROM registros_mantenimiento WHERE tipo = 'RECARGA_TANQUE' GROUP BY medidorId
  `).all<{ medidorId: string; total: number }>().catch(() => ({ results: [] as Array<{ medidorId: string; total: number }> }));
  const recMap = new Map((recargas || []).map((r) => [r.medidorId, r.total || 0]));

  const grupos = new Map<string, { instalacionId: string; instalacionNombre: string; recurso: string; unidadMedida: string; cantidadMedidores: number; consumoNeto: number }>();
  for (const m of medidores) {
    const key = `${m.instalacionId}:${m.recurso}`;
    if (!grupos.has(key)) {
      grupos.set(key, { instalacionId: m.instalacionId, instalacionNombre: m.instalacionNombre, recurso: m.recurso, unidadMedida: m.unidadMedida, cantidadMedidores: 0, consumoNeto: 0 });
    }
    const g = grupos.get(key);
    if (!g) continue;
    g.cantidadMedidores += 1;
    const st = statMap.get(m.medidorId);
    if (!st || !st.n) continue;
    if (m.tipoMedicion === "ACUMULATIVO") {
      if (st.n >= 2 && st.minVal !== null && st.maxVal !== null) g.consumoNeto += Math.max(0, st.maxVal - st.minVal);
    } else if (m.tipoMedicion === "NIVEL") {
      const { results: ord } = await c.env.DB.prepare(
        "SELECT valor FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura ASC LIMIT 100"
      ).bind(m.medidorId).all<{ valor: number }>();
      if (ord.length >= 1) {
        const ini = ord[0].valor;
        const fin = ord[ord.length - 1].valor;
        g.consumoNeto += Math.max(0, Number((ini - fin).toFixed(2))) + (recMap.get(m.medidorId) || 0);
      }
    } else {
      // INSTANTANEO / otros: promedio
      if (st.avgVal !== null) g.consumoNeto += Number(st.avgVal.toFixed(2));
    }
  }
  // Corrección ACUMULATIVO ya sumado; NIVEL con doble conteo evitado: restar aproximación min/max previa (0) — redondear
  const out = [...grupos.values()].map((g) => ({ ...g, consumoNeto: Number(g.consumoNeto.toFixed(2)) }));

  return c.json(out);
});

// 4. Actividad reciente de telemetría (últimas lecturas con formato compatible con components.js)
dashboardRouter.get("/api/dashboard/actividad-reciente", async (c) => {
  const user = c.get("user");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 10;

  let whereExtra = "";
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
    whereExtra = `WHERE m.instalacionId IN (${sqlInList(allowed)})`;
  }

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
    ${whereExtra}
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
    const raw = r.fechaLectura ? r.fechaLectura.trim() : "";
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
