import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types.js";

export const lecturasRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const LecturaInputSchema = z.object({
  medidorId: z.string().min(1),
  valor: z.number().nonnegative(),
  fechaLectura: z.string().optional(),
  notas: z.string().optional(),
});

// Listar lecturas recientes
lecturasRouter.get("/api/lecturas", async (c) => {
  const medidorId = c.req.query("medidorId");
  let sql = `
    SELECT 
      l.id, l.valor, l.fechaLectura, l.notas, l.createdAt,
      m.id as medidorId, m.codigo as medidorCodigo,
      t.recurso, t.unidad
    FROM lecturas l
    JOIN medidores m ON l.medidorId = m.id
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
  `;
  if (medidorId) {
    sql += ` WHERE l.medidorId = '${medidorId}'`;
  }
  sql += " ORDER BY l.fechaLectura DESC LIMIT 50";

  const { results } = await c.env.DB.prepare(sql).all();
  return c.json(results);
});

// Registrar nueva lectura (con verificación de regla inmutable no-decreciente si es acumulativo)
lecturasRouter.post("/api/lecturas", async (c) => {
  const body = await c.req.json();
  const parsed = LecturaInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", message: "Datos de lectura inválidos" }, 400);
  }

  const { medidorId, valor, notas } = parsed.data;
  const fecha = parsed.data.fechaLectura ? new Date(parsed.data.fechaLectura).toISOString() : new Date().toISOString();

  // 1. Obtener tipo de medición del medidor
  const medidor = await c.env.DB.prepare(`
    SELECT m.id, m.activo, t.tipoMedicion
    FROM medidores m
    JOIN tipos_medidor t ON m.tipoMedidorId = t.id
    WHERE m.id = ?
  `)
    .bind(medidorId)
    .first<{ id: string; activo: number; tipoMedicion: string }>();

  if (!medidor) {
    return c.json({ error: "NOT_FOUND", message: "Medidor no encontrado" }, 404);
  }

  // 2. Si es acumulativo, verificar que el nuevo valor sea >= a la última lectura
  if (medidor.tipoMedicion === "ACUMULATIVO") {
    const ultima = await c.env.DB.prepare(
      "SELECT valor FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 1"
    )
      .bind(medidorId)
      .first<{ valor: number }>();

    if (ultima && valor < ultima.valor) {
      return c.json({
        error: "LECTURA_DECRECIENTE_PROHIBIDA",
        message: `El valor ingresado (${valor}) no puede ser menor a la lectura anterior (${ultima.valor}) para un medidor acumulativo.`,
      }, 422);
    }
  }

  const lecturaId = crypto.randomUUID();
  const user = c.get("user");
  const operadorId = user ? user.id : "usr-oper-01";

  await c.env.DB.prepare(`
    INSERT INTO lecturas (id, medidorId, operadorId, valor, fechaLectura, notas, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)
    .bind(lecturaId, medidorId, operadorId, valor, fecha, notas || null)
    .run();

  return c.json({
    id: lecturaId,
    medidorId,
    valor,
    fechaLectura: fecha,
    notas,
  }, 201);
});

// Sincronización en lote offline (SyncManager PWA)
lecturasRouter.post("/api/lecturas/batch-sync", async (c) => {
  const body = await c.req.json() as {
    lecturas?: Array<{
      localId?: string;
      medidorId: string;
      operadorId?: string;
      valor: number;
      fechaLectura?: string;
      notas?: string;
    }>;
    items?: Array<any>;
  };

  const list = body.lecturas || body.items;
  if (!list || !Array.isArray(list)) {
    return c.json({ error: "BAD_REQUEST", message: "Formato de lote inválido: debe contener un arreglo de 'lecturas'" }, 400);
  }

  const results: Array<{ localId?: string; status: "SYNCED" | "REJECTED"; lectura?: any; error?: { code?: string; message: string } }> = [];
  let syncedCount = 0;
  let rejectedCount = 0;

  for (const item of list) {
    try {
      const medidor = await c.env.DB.prepare(`
        SELECT m.id, m.activo, t.tipoMedicion
        FROM medidores m
        JOIN tipos_medidor t ON m.tipoMedidorId = t.id
        WHERE m.id = ?
      `).bind(item.medidorId).first<{ id: string; activo: number; tipoMedicion: string }>();

      if (!medidor) {
        throw new Error(`Medidor con ID '${item.medidorId}' no encontrado`);
      }

      if (medidor.tipoMedicion === "ACUMULATIVO") {
        const ultima = await c.env.DB.prepare(
          "SELECT valor FROM lecturas WHERE medidorId = ? ORDER BY fechaLectura DESC LIMIT 1"
        ).bind(item.medidorId).first<{ valor: number }>();

        if (ultima && item.valor < ultima.valor) {
          throw new Error(`Lectura decreciente rechazada: ${item.valor} < ${ultima.valor}`);
        }
      }

      const id = crypto.randomUUID();
      const fecha = item.fechaLectura ? new Date(item.fechaLectura).toISOString() : new Date().toISOString();
      const operadorId = item.operadorId || "usr-oper-01";

      await c.env.DB.prepare(`
        INSERT INTO lecturas (id, medidorId, operadorId, valor, fechaLectura, notas, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(id, item.medidorId, operadorId, item.valor, fecha, item.notas || null).run();

      const lecturaCreada = {
        id,
        medidorId: item.medidorId,
        operadorId,
        valor: item.valor,
        fechaLectura: fecha,
        notas: item.notas,
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
