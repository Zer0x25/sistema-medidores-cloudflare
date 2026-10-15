import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { D1Database, D1DatabaseSession, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

// SQLite real ejecuta el SQL; este adaptador solo reproduce la superficie de D1.
class Statement implements D1PreparedStatement {
  constructor(private db: DatabaseSync, private sql: string, private values: SQLInputValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, values as SQLInputValue[]);
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values);
    return (column ? row?.[column] : row) as T ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.sql).all(...this.values) as T[];
    return {
      success: true, results,
      meta: { duration: 0, size_after: 0, rows_read: results.length, rows_written: 0,
        last_row_id: 0, changed_db: false, changes: 0 },
    };
  }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: {
      duration: 0, size_after: 0, rows_read: 0, rows_written: Number(result.changes),
      last_row_id: Number(result.lastInsertRowid), changed_db: true, changes: Number(result.changes),
    } };
  }
  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const stmt = this.db.prepare(this.sql);
    const columns = stmt.columns().map((c) => c.name);
    const rows = stmt.all(...this.values).map((r) => columns.map((col) => r[col])) as T[];
    return options?.columnNames ? [columns, ...rows] : rows;
  }
}

export class SQLiteD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql") && !f.includes("seed")).sort()) {
      this.sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
    }
  }
  prepare(sql: string): D1PreparedStatement { return new Statement(this.sqlite, sql); }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) results.push(await stmt.all<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 }; }
  withSession(): D1DatabaseSession {
    return { prepare: (sql) => this.prepare(sql), batch: (stmts) => this.batch(stmts), getBookmark: () => null };
  }
  async dump(): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
}
