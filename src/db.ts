import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import type { D1Database } from "@cloudflare/workers-types";

let cachedPrisma: PrismaClient | null = null;

export function getPrisma(db: D1Database): PrismaClient {
  if (!cachedPrisma) {
    const adapter = new PrismaD1(db);
    cachedPrisma = new PrismaClient({ adapter });
  }
  return cachedPrisma;
}

export function sqlInList(ids: string[]): string {
  if (ids.length === 0) return "NULL";
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
}
