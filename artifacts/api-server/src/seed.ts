import { db, routersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger.js";

/**
 * Idempotent production seed.
 * Inserts routers, vendors and the admin manager if the routers table is empty.
 * Safe to run on every startup — ON CONFLICT DO NOTHING guarantees no duplicates.
 */
export async function seedIfEmpty() {
  try {
    const [{ count }] = await db
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(routersTable);

    if (parseInt(count) > 0) return; // already seeded

    logger.info("Database appears empty — running production seed…");

    // ── Routers ──────────────────────────────────────────────────────────────
    await db.execute(sql`
      INSERT INTO routers (id, name, hotspot_name, host, port, username, password, is_active) VALUES
        (1, 'WIFI ABONNEMENT 2', 'WIFI ABONNEMENT', 'v12.mikroot.com', 8728, 'HS', 'root', true),
        (2, 'WIFI ABONNEMENT 3', 'WIFI ABONNEMENT', 'v6.mikroot.com',  8728, 'HS', 'root', true),
        (3, 'SOUM SERVICE',      NULL,               'v8.mikroot.com',  8728, 'HS', 'root', true),
        (4, 'WIFI ABONNEMENT 1', 'WIFI ABONNEMENT', 'v1.mikroot.com',  8728, 'HS', 'root', true)
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      SELECT setval('routers_id_seq', GREATEST((SELECT MAX(id) FROM routers), 1))
    `);

    // ── Vendors ───────────────────────────────────────────────────────────────
    await db.execute(sql`
      INSERT INTO vendors
        (id, name, phone, is_active, email, username, password_hash,
         router_id, comment_suffix, comment_suffix2, commission_rate, is_demo)
      VALUES
        ( 7, 'HOME',      '0767844233', true, NULL, '0767844233', '4e6e04b1188ed49fb548803d6c0fa101:d6df0b0ffd76961fff078c18beae6cf84529aedd178d8cf7d9826b7294a4700be322493d361df45d252a92bced52311a7375249faa878232403d89e985543f98', 2, 'HOME',      NULL,     15, false),
        ( 8, 'VINY',      '0708330826', true, NULL, '0708330826', 'c82812bae1024409330fd14bdb07cc28:6edcafa8573beaf2449cc9611ad83a6992049914b26fc8478a702f81cd9beb54a86c7f7f15f6da99b1b3f76e336ab023e75d6b7e52acfd6ecd2895ed7c274f76', 2, 'VINY',      'DIALLO', 15, false),
        ( 9, 'ALI',       '0748192753', true, NULL, '0748192753', '710b3b9c83d077ef2b10f0afd0bb87d5:6f2cfb8a639f3de9852f85aef228f512acf292dd85e398dbbe2901f206cd795b9c83ad5e3b2efbc753d2245cdc8d606f961b5086304e211b1c1969b552c9dce2',  2, 'ALI',       'CABINE', 15, false),
        (10, 'MAISON',    '0768353187', true, NULL, '0768353187', NULL,                                                                                                                                                                    1, 'MAISON',    NULL,      0, false),
        (11, 'RAPHAELLE', '0787242694', true, NULL, '0787242694', 'c86ae422961c066a4ee85dce5e090902:74b930ab6bbe47ea9c991e1ed8a07145c6ca4a03a9d65dc36ffa2df25c21ca506a235e88cefd4de06cfb669c0463e601aa614dbf82f16dd8994f40dc86a2f0c8', 1, 'RAPHAELLE', NULL,      0, false),
        (12, 'FULGENCE',  '0788255352', true, NULL, '0788255352', 'b249bd90e96cee78933e13fc498944ad:6cf6348341076e82c204ebfdc5f9f969d91c5105ae0d9202085b2b6494352a199153d9f88b644676cb18a2ea5fb0099a645250ca925b2817db2de8ea21d34e34',  1, 'FULGENCE',  NULL,      0, false),
        (13, 'HOME',      '0141557181', true, NULL, '0141557181', 'cbf3cb862a05c5eb208cfd2701871497:89f9bdf61cafc1572baa402fd03ec362eae49e9c67fcffc23c37820e30a249394ec09230970cf6225f1df5ad9e29d46e6d99b41777cebc64a697e30ee907dbe0', 4, 'HOME',      NULL,     20, false),
        (14, 'ABRAHAM',   '0749602086', true, NULL, '0749602086', '8256824099d1df0848c6730bb9f75f13:9e50013a8bbb5131fe95c15ce3d65b60563bad8c6c5f324b6d3992749fcaba0c44302fa494d5d87935ba872dd0779390fa58fd9a4d9791fcedae7fc6a018a07e',  4, 'ABRAHAM',   NULL,      0, true),
        (15, 'DIALLO',    '0595850918', true, NULL, '0595850918', 'e9b6d35aa7544e2e714c13ca8697ac52:8f37f705d76f19e76bc2b4f1aebd2e388dcbdd2c1c30922bd22466eb96d7a81e97cd9e2f80f01619bea40d8d350903aa79ef842c0a1567649eca3e680120ca13', 4, 'DIALLO',    NULL,     20, false),
        (16, 'EZECHIEL',  '0719306529', true, NULL, '0719306529', '563301a66cb9be55bb0cca07994e5335:8af65d222d998cf79a889bf0c74fc3ff7738de00651d9aa35246da95b1b44fa1b7c3704c4e9e70e58c0f8b8797b0f5cd552ea4ecf048d76390f265860869a7b3',  4, 'EZECHIEL',  NULL,     20, false),
        (17, 'ADJARA',    '0101718683', true, NULL, '0101718683', '8dfe34a57ae2948560a053087bb4da74:ba2c84b6ad955592773ec3e25322e206ee1b231e8439e87281eba8491cc6b78ad0f19b4b6f0728efce22932e8b9bd0b653431d5e909a65ab87a8e4f2699486b3',  4, 'ADJARA',    NULL,     20, false),
        (18, 'ZAHUI',     '0506393261', true, NULL, '0506393261', '89ac03aaf9a0ecced6fe27d342036123:9853514e354ac94eb0c5c54b5f9c52bf07d699294281a998404f310fe3b89394c81267127af20e34ffa62afb37a4e04acb2fdcc4fc7b160690f8b6ea81793f5d',  4, 'ZAHUI',     NULL,     20, false)
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      SELECT setval('vendors_id_seq', GREATEST((SELECT MAX(id) FROM vendors), 1))
    `);

    // ── Manager ───────────────────────────────────────────────────────────────
    await db.execute(sql`
      INSERT INTO managers (id, name, username, password_hash, is_active) VALUES
        (2, 'Mariam', '0767844233',
         '272eac78b74de6165958cf0ec18f32a6:e620a5a11fd98650ecd5810b0584af7d87d10a9b5c4f4668c4d12f3393475ff9915aa13925c04cf2cf7c15db19e560f7e401c9ca0cb46a87cd7b8b89a58c6766',
         true)
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      SELECT setval('managers_id_seq', GREATEST((SELECT MAX(id) FROM managers), 1))
    `);

    logger.info("Production seed completed — 4 routers, 12 vendors, 1 manager inserted.");
  } catch (err) {
    logger.error({ err }, "Seed failed — server will still start");
  }
}
