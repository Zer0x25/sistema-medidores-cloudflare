import type { D1Database, Fetcher, KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  KV_CACHE?: KVNamespace;
  ASSETS?: Fetcher;
  JWT_SECRET: string;
  JWT_EXPIRES_IN?: string;
  NODE_ENV?: string;
  LOG_LEVEL?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
  rol: "ADMIN" | "SUPERVISOR" | "OPERADOR";
}

export interface Variables {
  user?: AuthUser;
}
