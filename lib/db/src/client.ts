import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is required. Set it in your shell, a .env file loaded by your process, or your IDE run configuration (see DEVELOPMENT.md)."
  );
}

export const db = drizzle(databaseUrl, { schema });
