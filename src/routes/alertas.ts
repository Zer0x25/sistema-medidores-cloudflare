import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { registrarAuditoria } from "../audit.js";

export const alertasRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const CrearReglaSchema = z.object({
  nombre: z.string().min(3),
  tipo: z.enum(["SALTO_CONSUMO", "FUGA_PROBABLE", "SIN_REPORTE"]),
  recurso: z.enum(["AGUA", "LUZ", "GAS", "PETROLEO"]).optional(),
  umbralValor: z.number().positive(),
});

// 1. Listar reglas
alertasRouter.get("/api/alertas/reglas", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nombre, tipo, recurso, umbralValor, activa, createdAt FROM reglas_alerta ORDER BY nombre ASC"
  ).all();
  return c.json(results.map(r => ({ ...r, activa: Boolean(r.activa) })));
});

// 2. Crear regla
alertasRouter.post("/api/alertas/reglas", async (c) => {
  const user = c.get("user");
  if (!user || user.rol !== "ADMIN") return c.json({ error: "FORBIDDEN", message: "Permisos insuficientes" }, 403);

  const body = await c.req.json();
  const parsed = CrearReglaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", message: "Datos inválidos" }, 400);

  const id = crypto.randomUUID();
  const { nombre, tipo, recurso, umbralValor } = parsed.data;

  await c.env.DB.prepare(`
    INSERT INTO reglas_alerta (id, nombre, tipo, recurso, umbralValor, activa, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(id, nombre, tipo, recurso || null, umbralValor)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "CREAR_REGLA_ALERTA",
    entidad: "ReglaAlerta",
    entidadId: id,
    detalles: parsed.data,
  });

  return c.json({ id, ...parsed.data, activa: true }, 201);
});

// 3. Listar incidentes de alerta
alertasRouter.get("/api/alertas/incidentes", async (c) => {
  const estado = c.req.query("estado");
  const instalacionId = c.req.query("instalacionId");
  const severidad = c.req.query("severidad");
  const tipo = c.req.query("tipo");

  let sql = `
    SELECT 
      a.id, a.tipo, a.severidad, a.mensaje, a.estado, a.valorDetectado,
      a.fechaDeteccion, a.fechaResolucion, a.notasResolucion,
      m.id as medidorId, m.codigo as medidorCodigo,
      i.id as instalacionId, i.nombre as instalacionNombre
    FROM incidentes_alerta a
    JOIN medidores m ON a.medidorId = m.id
    JOIN instalaciones i ON a.instalacionId = i.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (estado && estado !== "TODOS") {
    sql += " AND a.estado = ?";
    params.push(estado);
  }
  if (instalacionId) {
    sql += " AND a.instalacionId = ?";
    params.push(instalacionId);
  }
  if (severidad) {
    sql += " AND a.severidad = ?";
    params.push(severidad);
  }
  if (tipo) {
    sql += " AND a.tipo = ?";
    params.push(tipo);
  }
  sql += " ORDER BY a.fechaDeteccion DESC LIMIT 100";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

// 4. Resolver incidente
alertasRouter.post("/api/alertas/incidentes/:id/resolver", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json() as { estado?: string; notasResolucion?: string };
  const nuevoEstado = body.estado || "RESUELTO";
  const notas = body.notasResolucion || "Resuelto por operador";
  const hoy = new Date().toISOString();

  await c.env.DB.prepare(`
    UPDATE incidentes_alerta 
    SET estado = ?, fechaResolucion = ?, notasResolucion = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(nuevoEstado, nuevoEstado === "RESUELTO" ? hoy : null, notas, id)
    .run();

  await registrarAuditoria({
    db: c.env.DB,
    usuario: user,
    accion: "RESOLUCION_INCIDENTE_ALERTA",
    entidad: "IncidenteAlerta",
    entidadId: id,
    detalles: body,
  });

  return c.json({ success: true, message: "Incidente resuelto exitosamente" });
});

// 5. Resumen de incidentes para badges y KPIs
alertasRouter.get("/api/alertas/resumen", async (c) => {
  const instalacionId = c.req.query("instalacionId");
  let where = "";
  const params: unknown[] = [];
  if (instalacionId) {
    where = "WHERE a.instalacionId = ?";
    params.push(instalacionId);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN estado IN ('PENDIENTE', 'ABIERTO') THEN 1 ELSE 0 END), 0) as totalAbiertos,
      COALESCE(SUM(CASE WHEN severidad = 'CRITICAL' AND estado != 'RESUELTO' THEN 1 ELSE 0 END), 0) as totalCriticos,
      COALESCE(SUM(CASE WHEN severidad = 'WARNING' AND estado != 'RESUELTO' THEN 1 ELSE 0 END), 0) as totalAdvertencias,
      COALESCE(SUM(CASE WHEN estado = 'RESUELTO' THEN 1 ELSE 0 END), 0) as totalResueltos
    FROM incidentes_alerta a
    ${where}
  `).bind(...params).all<{
    totalAbiertos: number;
    totalCriticos: number;
    totalAdvertencias: number;
    totalResueltos: number;
  }>();

  const r = results[0] || {
    totalAbiertos: 0,
    totalCriticos: 0,
    totalAdvertencias: 0,
    totalResueltos: 0,
  };

  return c.json(r);
});

// 6. Evaluar anomalías
alertasRouter.post("/api/alertas/evaluar", async (c) => {
  const ahora = new Date();

  // 1. Obtener reglas activas
  const { results: reglas } = await c.env.DB.prepare(
    "SELECT id, nombre, tipo, recurso, umbralValor FROM reglas_alerta WHERE activa = 1"
  ).all<{ id: string; nombre: string; tipo: string; recurso: string | null; umbralValor: number }>();

  // 2. Obtener medidores activos
  const { results: medidores } = await c.env.DB.prepare(`
    SELECT 
      m.id, m.codigo, m.instalacionId, i.nombre as instalacionNombre, tm.recurso, m.activo
    FROM medidores m
    JOIN instalaciones i ON m.instalacionId = i.id
    JOIN tipos_medidor tm ON m.tipoMedidorId = tm.id
    WHERE m.activo = 1
  `).all<{ id: string; codigo: string; instalacionId: string; instalacionNombre: string; recurso: string; activo: number }>();

  // 3. Obtener incidentes abiertos existentes para evitar duplicados
  const { results: incidentesAbiertos } = await c.env.DB.prepare(
    "SELECT medidorId, tipo FROM incidentes_alerta WHERE estado != 'RESUELTO'"
  ).all<{ medidorId: string; tipo: string }>();

  interface IncidenteAlertaNuevo {
    id: string;
    reglaId: string;
    medidorId: string;
    medidorCodigo: string;
    instalacionId: string;
    instalacionNombre: string;
    tipo: string;
    severidad: string;
    mensaje: string;
    estado: string;
    valorDetectado: number;
    fechaDeteccion: string;
  }

  const abiertosSet = new Set(incidentesAbiertos.map(i => `${i.medidorId}:${i.tipo}`));
  const nuevos: IncidenteAlertaNuevo[] = [];

  for (const medidor of medidores) {
    const { results: lecturas } = await c.env.DB.prepare(
      "SELECT valor, fechaLectura FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura ASC"
    ).bind(medidor.id).all<{ valor: number; fechaLectura: string }>();

    for (const regla of reglas) {
      if (regla.recurso && regla.recurso !== medidor.recurso) continue;

      const clave = `${medidor.id}:${regla.tipo}`;
      if (abiertosSet.has(clave)) continue;

      if (regla.tipo === "SIN_REPORTE") {
        const ultimaLectura = lecturas[lecturas.length - 1];
        const ultimaFecha = ultimaLectura ? new Date(ultimaLectura.fechaLectura) : new Date(0);
        const diffHoras = (ahora.getTime() - ultimaFecha.getTime()) / (1000 * 3600);

        if (diffHoras >= regla.umbralValor) {
          const severidad = diffHoras >= 72 ? "CRITICAL" : "WARNING";
          const mensaje = `El medidor «${medidor.codigo}» no ha registrado lecturas en las últimas ${Math.floor(diffHoras)} horas (umbral: ${regla.umbralValor}h).`;
          const id = crypto.randomUUID();
          const horasRedondeadas = Math.floor(diffHoras);

          await c.env.DB.prepare(`
            INSERT INTO incidentes_alerta (
              id, reglaId, medidorId, instalacionId, tipo, severidad, mensaje, estado, valorDetectado, fechaDeteccion, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, 'SIN_REPORTE', ?, ?, 'ABIERTO', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).bind(id, regla.id, medidor.id, medidor.instalacionId, severidad, mensaje, horasRedondeadas, ahora.toISOString()).run();

          abiertosSet.add(clave);
          nuevos.push({
            id,
            reglaId: regla.id,
            medidorId: medidor.id,
            medidorCodigo: medidor.codigo,
            instalacionId: medidor.instalacionId,
            instalacionNombre: medidor.instalacionNombre,
            tipo: "SIN_REPORTE",
            severidad,
            mensaje,
            estado: "ABIERTO",
            valorDetectado: horasRedondeadas,
            fechaDeteccion: ahora.toISOString(),
          });
        }
      }

      if (regla.tipo === "SALTO_CONSUMO" && lecturas.length >= 3) {
        const deltas: number[] = [];
        for (let i = 1; i < lecturas.length; i++) {
          deltas.push(lecturas[i].valor - lecturas[i - 1].valor);
        }
        if (deltas.length >= 2) {
          const ultimoDelta = deltas[deltas.length - 1];
          const deltasPrevios = deltas.slice(0, deltas.length - 1);
          const promedioPrevio = deltasPrevios.reduce((acc, d) => acc + d, 0) / deltasPrevios.length;

          if (promedioPrevio > 0) {
            const porcentajeAumento = ((ultimoDelta - promedioPrevio) / promedioPrevio) * 100;
            if (porcentajeAumento >= regla.umbralValor) {
              const severidad = porcentajeAumento >= 100 ? "CRITICAL" : "WARNING";
              const mensaje = `Salto atípico de consumo detectado en medidor «${medidor.codigo}»: delta actual (${ultimoDelta}) supera en ${porcentajeAumento.toFixed(1)}% el promedio histórico (${promedioPrevio.toFixed(1)}).`;
              const id = crypto.randomUUID();

              await c.env.DB.prepare(`
                INSERT INTO incidentes_alerta (
                  id, reglaId, medidorId, instalacionId, tipo, severidad, mensaje, estado, valorDetectado, fechaDeteccion, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, 'SALTO_CONSUMO', ?, ?, 'ABIERTO', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              `).bind(id, regla.id, medidor.id, medidor.instalacionId, severidad, mensaje, ultimoDelta, ahora.toISOString()).run();

              abiertosSet.add(clave);
              nuevos.push({
                id,
                reglaId: regla.id,
                medidorId: medidor.id,
                medidorCodigo: medidor.codigo,
                instalacionId: medidor.instalacionId,
                instalacionNombre: medidor.instalacionNombre,
                tipo: "SALTO_CONSUMO",
                severidad,
                mensaje,
                estado: "ABIERTO",
                valorDetectado: ultimoDelta,
                fechaDeteccion: ahora.toISOString(),
              });
            }
          }
        }
      }

      if (regla.tipo === "FUGA_PROBABLE" && lecturas.length >= 3) {
        const ultimas = lecturas.slice(-Math.max(3, regla.umbralValor));
        let esFuga = true;
        for (let i = 1; i < ultimas.length; i++) {
          if (ultimas[i].valor - ultimas[i - 1].valor <= 0) {
            esFuga = false;
            break;
          }
        }
        if (esFuga) {
          const id = crypto.randomUUID();
          const mensaje = `Patrón de consumo continuo anómalo detectado en medidor «${medidor.codigo}» (${ultimas.length} lecturas sucesivas en aumento).`;
          await c.env.DB.prepare(`
            INSERT INTO incidentes_alerta (
              id, reglaId, medidorId, instalacionId, tipo, severidad, mensaje, estado, valorDetectado, fechaDeteccion, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, 'FUGA_PROBABLE', 'CRITICAL', ?, 'ABIERTO', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).bind(id, regla.id, medidor.id, medidor.instalacionId, mensaje, ultimas.length, ahora.toISOString()).run();

          abiertosSet.add(clave);
          nuevos.push({
            id,
            reglaId: regla.id,
            medidorId: medidor.id,
            medidorCodigo: medidor.codigo,
            instalacionId: medidor.instalacionId,
            instalacionNombre: medidor.instalacionNombre,
            tipo: "FUGA_PROBABLE",
            severidad: "CRITICAL",
            mensaje,
            estado: "ABIERTO",
            valorDetectado: ultimas.length,
            fechaDeteccion: ahora.toISOString(),
          });
        }
      }
    }
  }

  return c.json({
    status: "ok",
    evaluados: true,
    totalNuevos: nuevos.length,
    incidentes: nuevos,
  });
});
