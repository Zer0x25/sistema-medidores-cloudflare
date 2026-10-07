import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";
import { sqlInList } from "../db.js";
import { factorEfectivo, calcularValorReal } from "../domain.js";

export const lecturasRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const OrigenEnum = z.enum(["MANUAL", "AJUSTE", "IMPORTADA"]);

const LecturaInputSchema = z.object({
  medidorId: z.string().min(1),
  valor: z.number().nonnegative(),
  origen: OrigenEnum.optional().default("MANUAL"),
  fechaLectura: z.string().optional(),
  timestamp: z.string().optional(),
  notas: z.string().optional(),
  observaciones: z.string().optional(),
});

function parseFecha(rawDate: string | undefined): string {
  let fecha = new Date().toISOString();
  if (rawDate) {
    let cleaned = String(rawDate).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(cleaned)) {
      cleaned = cleaned.replace(" ", "T") + (cleaned.includes("Z") ? "" : "Z");
    }
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      fecha = d.toISOString();
    }
  }
  return fecha;
}

// Listar lecturas recientes
lecturasRouter.get("/api/lecturas", async (c) => {
  const user = c.get("user");
  const medidorId = c.req.query("medidorId");

  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (allowed.length === 0) {
      return c.json([]);
    }
  }

  let sql = `
    SELECT
      l.id, l.valor, l.valorBruto, l.multiplicadorAplicado, l.origen, l.fechaLectura, l.notas, l.createdAt,
      m.id as medidorId, m.codigo as medidorCodigo,
      t.recurso, t.unidad
    FROM lecturas l
    JOIN medidores m ON l.medidorId = m.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
  `;

  const whereClauses: string[] = [];
  if (medidorId) {
    if (user && user.rol !== "ADMIN") {
      const allowed = user.allowedInstalacionIds || [];
      const m = await c.env.DB.prepare("SELECT instalacionId FROM medidores WHERE id = ?").bind(medidorId).first<{ instalacionId: string }>();
      if (!m || !allowed.includes(m.instalacionId)) {
        return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
      }
    }
    whereClauses.push(`l.medidorId = '${medidorId.replace(/'/g, "''")}'`);
  } else if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    whereClauses.push(`m.instalacionId IN (${sqlInList(allowed)})`);
  }
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  sql += " ORDER BY l.fechaLectura DESC LIMIT 50";

  const { results } = await c.env.DB.prepare(sql).all<{
    id: string;
    valor: number;
    valorBruto: number | null;
    multiplicadorAplicado: number | null;
    origen: string | null;
    fechaLectura: string;
    notas: string | null;
    createdAt: string;
    medidorId: string;
    medidorCodigo: string;
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
      ...r,
      origen: r.origen || "MANUAL",
      fechaLectura: iso,
      timestamp: iso,
      fecha: iso,
    };
  });

  return c.json(formatted);
});

// Registrar nueva lectura (factor efectivo + cota NIVEL + origen)
lecturasRouter.post("/api/lecturas", async (c) => {
  const body = await c.req.json();
  const parsed = LecturaInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de lectura inválidos" }, 400);
  }

  const { medidorId, valor: valorBrutoInput } = parsed.data;
  const origen = parsed.data.origen || "MANUAL";
  const rawDate = parsed.data.fechaLectura || parsed.data.timestamp;
  const fecha = parseFecha(rawDate);
  const notas = parsed.data.notas || parsed.data.observaciones || null;

  const medidor = await c.env.DB.prepare(`
    SELECT m.id, m.activo, m.instalacionId, m.factorInstalacion, t.tipoMedicion, t.multiplicador, t.capacidadMaxima
    FROM medidores m
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.id = ?
  `)
    .bind(medidorId)
    .first<{ id: string; activo: number; instalacionId: string; factorInstalacion: number | null; tipoMedicion: string; multiplicador: number | null; capacidadMaxima: number | null }>();

  if (!medidor) {
    return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  }
  if (!medidor.activo) {
    return c.json({ error: "MEDIDOR_INACTIVO", message: `El medidor '${medidorId}' se encuentra archivado y no admite lecturas.` }, 422);
  }

  const user = c.get("user");
  if (user && user.rol !== "ADMIN") {
    const allowed = user.allowedInstalacionIds || [];
    if (!allowed.includes(medidor.instalacionId)) {
      return c.json({ error: "FORBIDDEN", message: "Acceso denegado a este medidor" }, 403);
    }
  }

  const efectivo = factorEfectivo(medidor.factorInstalacion, medidor.multiplicador);
  const valorReal = calcularValorReal(valorBrutoInput, efectivo);

  if (medidor.tipoMedicion === "NIVEL") {
    const cap = medidor.capacidadMaxima ?? null;
    if (cap !== null && valorReal > cap) {
      return c.json({
        error: "NIVEL_FUERA_DE_RANGO",
        message: `El nivel ${valorReal} supera la capacidad máxima ${cap}.`,
      }, 422);
    }
  }

  if (medidor.tipoMedicion === "ACUMULATIVO") {
    const ultima = await c.env.DB.prepare(
      "SELECT valor FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 1"
    )
      .bind(medidorId)
      .first<{ valor: number }>();

    if (ultima && valorReal < ultima.valor) {
      return c.json({
        error: "LECTURA_DECRECIENTE_PROHIBIDA",
        message: `El valor ingresado (${valorReal}) no puede ser menor a la lectura anterior (${ultima.valor}) para un medidor acumulativo.`,
      }, 422);
    }
  }

  const lecturaId = crypto.randomUUID();
  const operadorId = user ? user.id : (body.operadorId || "usr-oper-01");

  await c.env.DB.prepare(`
    INSERT INTO lecturas (id, medidorId, operadorId, valor, valorBruto, multiplicadorAplicado, origen, fechaLectura, notas, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)
    .bind(lecturaId, medidorId, operadorId, valorReal, valorBrutoInput, efectivo, origen, fecha, notas)
    .run();

  return c.json({
    id: lecturaId,
    medidorId,
    valor: valorReal,
    valorBruto: valorBrutoInput,
    multiplicadorAplicado: efectivo,
    origen,
    fechaLectura: fecha,
    timestamp: fecha,
    fecha,
    notas,
  }, 201);
});

// Sincronización en lote offline (SyncManager PWA) con origen por ítem
interface LecturaBatchItem {
  localId?: string;
  medidorId: string;
  operadorId?: string;
  valor: number;
  origen?: string;
  fechaLectura?: string;
  timestamp?: string;
  notas?: string;
  observaciones?: string;
}

lecturasRouter.post("/api/lecturas/batch-sync", async (c) => {
  const body = (await c.req.json()) as {
    lecturas?: LecturaBatchItem[];
    items?: LecturaBatchItem[];
  };

  const list = body.lecturas || body.items;
  if (!list || !Array.isArray(list)) {
    return c.json({ error: "BAD_REQUEST", message: "Formato de lote inválido: debe contener un arreglo de 'lecturas'" }, 400);
  }

  const ordenadas = [...list].sort((a, b) => {
    const ta = a.fechaLectura || a.timestamp ? new Date(String(a.fechaLectura || a.timestamp)).getTime() : 0;
    const tb = b.fechaLectura || b.timestamp ? new Date(String(b.fechaLectura || b.timestamp)).getTime() : 0;
    return ta - tb;
  });

  const results: Array<{ localId?: string; status: "SYNCED" | "REJECTED"; lectura?: Record<string, unknown>; error?: { code?: string; message: string } }> = [];
  let syncedCount = 0;
  let rejectedCount = 0;

  for (const item of ordenadas) {
    try {
      const medidor = await c.env.DB.prepare(`
        SELECT m.id, m.activo, m.factorInstalacion, t.tipoMedicion, t.multiplicador, t.capacidadMaxima
        FROM medidores m
        JOIN tipos_medidor t ON m.tipoMedidorId = t.id
        WHERE m.id = ?
      `).bind(item.medidorId).first<{ id: string; activo: number; factorInstalacion: number | null; tipoMedicion: string; multiplicador: number | null; capacidadMaxima: number | null }>();

      if (!medidor) {
        throw new Error(`Medidor con ID '${item.medidorId}' no encontrado`);
      }
      if (!medidor.activo) {
        throw new Error(`Medidor '${item.medidorId}' archivado (MEDIDOR_INACTIVO)`);
      }

      const efectivo = factorEfectivo(medidor.factorInstalacion, medidor.multiplicador);
      const valorReal = calcularValorReal(item.valor, efectivo);
      const origen = item.origen || "MANUAL";

      if (medidor.tipoMedicion === "NIVEL") {
        const cap = medidor.capacidadMaxima ?? null;
        if (cap !== null && valorReal > cap) {
          throw new Error(`Nivel ${valorReal} supera capacidad ${cap} (NIVEL_FUERA_DE_RANGO)`);
        }
      }

      if (medidor.tipoMedicion === "ACUMULATIVO") {
        const ultima = await c.env.DB.prepare(
          "SELECT valor FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 1"
        ).bind(item.medidorId).first<{ valor: number }>();

        if (ultima && valorReal < ultima.valor) {
          throw new Error(`Lectura decreciente rechazada: ${valorReal} < ${ultima.valor}`);
        }
      }

      const id = crypto.randomUUID();
      const rawDate = item.fechaLectura || item.timestamp;
      const fecha = parseFecha(rawDate);
      const operadorId = item.operadorId || "usr-oper-01";
      const notas = item.notas || item.observaciones || null;

      await c.env.DB.prepare(`
        INSERT INTO lecturas (id, medidorId, operadorId, valor, valorBruto, multiplicadorAplicado, origen, fechaLectura, notas, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(id, item.medidorId, operadorId, valorReal, item.valor, efectivo, origen, fecha, notas).run();

      const lecturaCreada = {
        id,
        medidorId: item.medidorId,
        operadorId,
        valor: valorReal,
        valorBruto: item.valor,
        multiplicadorAplicado: efectivo,
        origen,
        fechaLectura: fecha,
        timestamp: fecha,
        fecha,
        notas,
      };

      results.push({
        localId: item.localId,
        status: "SYNCED",
        lectura: lecturaCreada,
      });
      syncedCount++;
    } catch (err) {
      rejectedCount++;
      results.push({
        localId: item.localId,
        status: "REJECTED",
        error: {
          code: "VALIDATION_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return c.json({
    totalProcessed: list.length,
    syncedCount,
    rejectedCount,
    results,
  });
});
