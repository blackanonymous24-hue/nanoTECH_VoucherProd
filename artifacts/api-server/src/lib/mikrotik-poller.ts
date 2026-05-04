import { EventEmitter } from "events";
import { logger } from "./logger.js";

/**
 * Shared background poller for MikroTik dashboard-priority snapshots.
 *
 * Architecture:
 *   N SSE clients → 1 shared poller per router → 1 MikroTik call per POLL_INTERVAL_MS
 *
 * Instead of each SSE connection having its own setInterval that triggers a
 * MikroTik call, all clients for the same router share ONE EventEmitter-based
 * poller. The poller calls buildSnapshot() once per interval and broadcasts
 * the result to all subscribers.
 *
 * This eliminates "Rate exceeded" errors caused by N clients × 1500ms = N
 * independent MikroTik connections per second.
 */

const POLL_INTERVAL_MS = parseInt(process.env.MIK_POLLER_INTERVAL_MS ?? "5000", 10);

interface PollerEntry {
  emitter: EventEmitter;
  timer: ReturnType<typeof setInterval>;
  refCount: number;
  lastSnapshot: unknown | null;
  inFlight: boolean;
}

const pollers = new Map<number, PollerEntry>();

/**
 * Subscribe to the shared router poller.
 *
 * @param routerId     — DB row id of the router
 * @param buildSnapshot — async function that fetches a fresh snapshot (called once per POLL_INTERVAL_MS)
 * @param onSnapshot   — called immediately with the last known snapshot (if any), then on each poll
 * @param onError      — called when buildSnapshot throws
 * @returns unsubscribe — call when the SSE connection closes
 */
export function subscribeRouterPoller<T>(
  routerId: number,
  buildSnapshot: () => Promise<T>,
  onSnapshot: (snap: T) => void,
  onError: (msg: string) => void,
): () => void {
  let entry = pollers.get(routerId);

  if (!entry) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(500);

    const newEntry: PollerEntry = {
      emitter,
      timer: null!,
      refCount: 0,
      lastSnapshot: null,
      inFlight: false,
    };

    const tick = async () => {
      if (newEntry.inFlight) return;
      newEntry.inFlight = true;
      try {
        const snap = await buildSnapshot();
        newEntry.lastSnapshot = snap;
        emitter.emit("snap", snap);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur routeur";
        emitter.emit("err", msg);
        logger.warn({ routerId, err: msg }, "mikrotik-poller: erreur snapshot");
      } finally {
        newEntry.inFlight = false;
      }
    };

    void tick();
    newEntry.timer = setInterval(tick, POLL_INTERVAL_MS);
    pollers.set(routerId, newEntry);
    entry = newEntry;
  }

  entry.refCount++;

  const snapHandler = (snap: T) => { try { onSnapshot(snap); } catch { /* ignore client errors */ } };
  const errHandler  = (msg: string) => { try { onError(msg); } catch { /* ignore */ } };

  entry.emitter.on("snap", snapHandler as (...args: unknown[]) => void);
  entry.emitter.on("err",  errHandler);

  if (entry.lastSnapshot !== null) {
    try { onSnapshot(entry.lastSnapshot as T); } catch { /* ignore */ }
  }

  return () => {
    const e = pollers.get(routerId);
    if (!e) return;
    e.emitter.off("snap", snapHandler as (...args: unknown[]) => void);
    e.emitter.off("err",  errHandler);
    e.refCount--;
    if (e.refCount <= 0) {
      clearInterval(e.timer);
      pollers.delete(routerId);
      logger.info({ routerId }, "mikrotik-poller: plus de clients — poller arrêté");
    }
  };
}

/** Returns the number of active pollers (for diagnostics). */
export function getPollerCount(): number {
  return pollers.size;
}

/** Returns per-poller diagnostic info. */
export function getPollerStats(): Array<{ routerId: number; refCount: number; hasSnapshot: boolean }> {
  return [...pollers.entries()].map(([routerId, e]) => ({
    routerId,
    refCount: e.refCount,
    hasSnapshot: e.lastSnapshot !== null,
  }));
}
