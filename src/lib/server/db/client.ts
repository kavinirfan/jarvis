import "server-only";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { config } from "../config";
import * as schema from "./schema";

/**
 * One database API for two engines:
 *  - DATABASE_URL set → a real PostgreSQL server (node-postgres pool). Use this in production.
 *  - otherwise       → PGlite, real Postgres compiled to WebAssembly, stored in .data/pglite.
 * Migrations in ./drizzle run automatically on first use.
 */
export type Db = NodePgDatabase<typeof schema>;

const MIGRATIONS = join(process.cwd(), "drizzle");

interface DbHolder {
  promise?: Promise<Db>;
}
const holder = globalThis as typeof globalThis & { __jarvisDb?: DbHolder };
holder.__jarvisDb ??= {};

export async function createDb(opts: { url?: string; dataDir?: string; memory?: boolean }): Promise<Db> {
  if (opts.url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: opts.url, max: 5 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (!opts.memory && opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });
  const client = opts.memory ? new PGlite() : new PGlite(opts.dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  const h = holder.__jarvisDb!;
  if (!h.promise) {
    const c = config();
    h.promise = createDb({ url: c.databaseUrl, dataDir: c.pgliteDir }).catch((e) => {
      h.promise = undefined; // let the next request retry
      throw e;
    });
  }
  return h.promise;
}

/** For tests: use an in-memory database for everything in this process. */
export function setDbForTests(db: Promise<Db>) {
  holder.__jarvisDb!.promise = db;
}

export { schema };
