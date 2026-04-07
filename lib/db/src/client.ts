import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is required. In Replit Deployments, add DATABASE_URL in Deployment Secrets."
  );
}

export const db = drizzle(databaseUrl, { schema });
