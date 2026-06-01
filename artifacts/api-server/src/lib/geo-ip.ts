import fs from "fs";
import path from "path";
import maxmind, { type CityResponse, type Reader } from "maxmind";
import { logger } from "./logger.js";
import { isPrivateOrLocalIp } from "./client-ip.js";

export type SessionGeo = {
  countryCode: string | null;
  countryName: string | null;
  city: string | null;
};

let readerPromise: Promise<Reader<CityResponse> | null> | null = null;
let warnedMissing = false;

function pickLocalizedName(names: Record<string, string> | undefined): string | null {
  if (!names) return null;
  return names.fr || names.en || Object.values(names)[0] || null;
}

function resolveGeoLitePath(): string | null {
  const fromEnv = process.env.GEOLITE2_CITY_MMDB_PATH?.trim();
  if (fromEnv) return fromEnv;
  const prodDefault = "/var/www/vouchernet/data/GeoLite2-City.mmdb";
  if (process.env.NODE_ENV === "production" && fs.existsSync(prodDefault)) return prodDefault;
  const localDefault = path.join(process.cwd(), "data", "GeoLite2-City.mmdb");
  if (fs.existsSync(localDefault)) return localDefault;
  return null;
}

async function openReader(): Promise<Reader<CityResponse> | null> {
  const dbPath = resolveGeoLitePath();
  if (!dbPath) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn(
        "GeoLite2-City.mmdb introuvable — pays/ville non renseignés au login. Définir GEOLITE2_CITY_MMDB_PATH.",
      );
    }
    return null;
  }
  try {
    const reader = await maxmind.open<CityResponse>(dbPath);
    logger.info({ dbPath }, "GeoLite2 City chargé");
    return reader;
  } catch (err) {
    logger.error({ err, dbPath }, "Impossible de charger GeoLite2-City.mmdb");
    return null;
  }
}

async function getReader(): Promise<Reader<CityResponse> | null> {
  if (!readerPromise) readerPromise = openReader();
  return readerPromise;
}

/** Préchauffe le lecteur MaxMind au démarrage (non bloquant). */
export function warmGeoIpReader(): void {
  void getReader();
}

export function isGeoIpConfigured(): boolean {
  return resolveGeoLitePath() !== null;
}

export async function lookupGeoFromIp(ip: string): Promise<SessionGeo | null> {
  if (isPrivateOrLocalIp(ip)) return null;
  const reader = await getReader();
  if (!reader) return null;
  try {
    const hit = reader.get(ip);
    if (!hit) return null;
    const countryCode = hit.country?.iso_code?.toUpperCase() ?? null;
    const countryName = pickLocalizedName(hit.country?.names);
    const city = pickLocalizedName(hit.city?.names);
    if (!countryCode && !countryName && !city) return null;
    return { countryCode, countryName, city };
  } catch (err) {
    logger.debug({ err, ip }, "lookup GeoLite2 échoué");
    return null;
  }
}

export function formatSessionLocation(
  countryName: string | null | undefined,
  city: string | null | undefined,
  countryCode?: string | null,
): string | null {
  const parts: string[] = [];
  if (city?.trim()) parts.push(city.trim());
  const country = countryName?.trim() || countryCode?.trim() || null;
  if (country) parts.push(country);
  return parts.length > 0 ? parts.join(", ") : null;
}
