import type { D1Database } from "@cloudflare/workers-types";
import type { AuthUser } from "./types.js";

export interface RegistrarAuditoriaParams {
  db: D1Database;
  usuario?: AuthUser;
  accion: string;
  entidad: string;
  entidadId: string;
  detalles?: Record<string, unknown> | string;
  ip?: string;
}

/**
 * Registra un evento inmutable en la bitácora de auditoría (ADR 0004 / ADR 0010).
 * Es de tipo append-only: nunca se actualiza ni se elimina.
 */
export async function registrarAuditoria({
  db,
  usuario,
  accion,
  entidad,
  entidadId,
  detalles,
  ip,
}: RegistrarAuditoriaParams): Promise<void> {
  const id = crypto.randomUUID();
  const usuarioId = usuario?.id || null;
  const detallesStr = detalles
    ? typeof detalles === "string"
      ? detalles
      : JSON.stringify(detalles)
    : null;

  try {
    await db.prepare(`
      INSERT INTO auditoria_eventos (id, usuarioId, accion, entidad, entidadId, detalles, ip, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
      .bind(id, usuarioId, accion, entidad, entidadId, detallesStr, ip || null)
      .run();
  } catch (err) {
    console.error("⚠️ [Auditoria] Error al persistir evento de auditoría:", err);
  }
}
