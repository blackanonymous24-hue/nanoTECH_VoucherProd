import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is required. Set it in your shell, a .env file loaded by your process, or your IDE run configuration (see DEVELOPMENT.md)."
  );
}

const poolMax = Math.max(5, parseInt(process.env.PG_POOL_MAX ?? "25", 10));

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

export const db = drizzle(pool, { schema });
