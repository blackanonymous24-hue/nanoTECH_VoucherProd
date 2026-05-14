import { buildHotspotLoginQrImgAttrs } from "@/lib/voucher-login-qr";

export type HotspotQrBatchItem = {
  username: string;
  password: string;
  usermode: "vc" | "up";
};

/** Petits lots côté serveur pour limiter le temps par requête (proxies). */
const HOTSPOT_QR_CHUNK = 25;
/** Au-delà, on bascule sur le navigateur pour ce lot et les suivants. */
const SERVER_CHUNK_DEADLINE_MS = 45_000;
/** Requêtes serveur QR en parallèle (reste borné par la taille des chunks). */
const SERVER_QR_PARALLEL_CHUNKS = 3;

async function fetchHotspotQrImgAttrsOneChunk(
  apiBase: string,
  loginHost: string,
  chunk: HotspotQrBatchItem[],
  signal: AbortSignal,
): Promise<string[]> {
  const r = await fetch(`${apiBase}/api/vouchers/hotspot-qr-attrs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginHost, items: chunk }),
    signal,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const data = (await r.json()) as { attrs?: unknown };
  if (!Array.isArray(data.attrs) || data.attrs.length !== chunk.length) {
    throw new Error("Réponse QR batch invalide");
  }
  return data.attrs.map((a) => (typeof a === "string" ? a : 'src="" alt=""'));
}

async function buildHotspotQrChunkClient(
  loginHost: string,
  chunk: HotspotQrBatchItem[],
): Promise<string[]> {
  return Promise.all(
    chunk.map((it) =>
      buildHotspotLoginQrImgAttrs(loginHost, it.username, it.password, {
        pixelWidth: 64,
        usermode: it.usermode,
      }),
    ),
  );
}

/**
 * Préfère l’API Node (lots courts) ; en cas d’échec (504, timeout, réseau), génère les QR dans le navigateur
 * pour que l’impression aboutisse même derrière un proxy strict.
 */
export async function fetchHotspotQrImgAttrsBatch(
  apiBase: string,
  loginHost: string,
  items: HotspotQrBatchItem[],
): Promise<string[]> {
  if (items.length === 0) return [];
  const chunks: HotspotQrBatchItem[][] = [];
  for (let i = 0; i < items.length; i += HOTSPOT_QR_CHUNK) {
    chunks.push(items.slice(i, i + HOTSPOT_QR_CHUNK));
  }

  let preferServer = true;
  const out: string[] = [];

  for (let b = 0; b < chunks.length; b += SERVER_QR_PARALLEL_CHUNKS) {
    const batch = chunks.slice(b, b + SERVER_QR_PARALLEL_CHUNKS);
    const batchResults = await Promise.all(
      batch.map(async (slice) => {
        if (!preferServer) {
          return {
            attrs: await buildHotspotQrChunkClient(loginHost, slice),
            serverOk: false as const,
          };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SERVER_CHUNK_DEADLINE_MS);
        try {
          const attrs = await fetchHotspotQrImgAttrsOneChunk(
            apiBase,
            loginHost,
            slice,
            controller.signal,
          );
          return { attrs, serverOk: true as const };
        } catch {
          return {
            attrs: await buildHotspotQrChunkClient(loginHost, slice),
            serverOk: false as const,
          };
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    for (const br of batchResults) {
      out.push(...br.attrs);
      if (!br.serverOk) preferServer = false;
    }
  }
  return out;
}
