/**
 * Runtime monkey-patches for node-routeros@1.6.9 — two distinct bugs that
 * conspire to hang voucher generation under real-world VPN conditions.
 *
 * Bug #1 — `!empty` reply (Channel.processPacket)
 * -----------------------------------------------
 * RouterOS v7+ replies with `!empty` (not `!done`) when a print query matches
 * zero rows. Channel.processPacket only knows `!re` / `!done` and routes
 * everything else through the `unknown` event whose default listener
 * THROWS synchronously:
 *
 *   throw new RosException("UNKNOWNREPLY", { reply })
 *
 * Because the throw fires inside a socket-data callback (not inside the
 * Promise constructor), the surrounding `await api.write(...)` Promise
 * NEVER resolves or rejects — the call hangs forever, blocking the very
 * first MikroTik call of voucher generation (countHotspotUsersByComment
 * on a brand-new lot ID always matches zero rows).
 *
 * Bug #2 — UNREGISTEREDTAG (Receiver.sendTagData)
 * -----------------------------------------------
 * When a Channel closes (after `!done`/`!empty`/timeout), it unregisters its
 * tag in the shared Receiver. If the router then sends a late reply for that
 * same tag (slow VPN, retry, second `!re` after we already saw `!done`),
 * `sendTagData` finds no tag and THROWS:
 *
 *   throw new RosException("UNREGISTEREDTAG")
 *
 * Worse: the throw happens *inside* `processSentence`'s recursive `process()`
 * function, which BAILS without resetting `processingSentencePipe = false`.
 * Result: the Receiver permanently locks its `sentencePipe` queue. ALL other
 * channels on that TCP connection (including the in-flight high-priority
 * voucher writes) stop receiving data — every subsequent api.write() hangs
 * until the 4-second wrapper timeout fires, by which point the entire
 * batch is dead.
 *
 * User-visible symptom: voucher generation gets stuck on "Préparation du
 * routeur" 0% for admins whose routers exhibit either condition (recent
 * RouterOS / slow VPN tunnel), exactly what happened to Mik@, SOUM, Doum
 * starting May 22 once we added the `countHotspotUsersByComment` reconcile
 * at the start of every generate batch (commit 4a0d859).
 *
 * Fix
 * ---
 *  - Channel.processPacket: treat `!empty` like `!done` (emit 'done' with
 *    the accumulated data array, close cleanly). Other replies untouched.
 *  - Receiver.sendTagData: silently drop late data for unregistered tags
 *    instead of throwing. Always run cleanUp() so the sentencePipe pump
 *    keeps draining.
 *
 * Both patches preserve happy-path behaviour byte-for-byte; they only
 * change the throw-and-poison branches.
 */
import { Channel } from "node-routeros";
import { createRequire } from "module";
import { logger } from "./logger.js";

const req = createRequire(import.meta.url);

interface ChannelInternals {
  data: unknown[];
  trapped: boolean;
  streaming: boolean;
  emit: (event: string, payload?: unknown) => boolean;
  close: () => void;
  parsePacket: (packet: string[]) => Record<string, unknown>;
}

interface PatchedProcessPacket {
  (this: ChannelInternals, packet: string[]): void;
  __vouchernetEmptyPatched?: boolean;
}

let patched = false;

export function patchNodeRouterosEmptyReply(): void {
  if (patched) return;
  patched = true;

  try {
    const proto = (Channel as unknown as { prototype: Record<string, unknown> }).prototype;
    const original = proto.processPacket as PatchedProcessPacket | undefined;
    if (typeof original !== "function") {
      logger.warn("[mikrotik-patch] Channel.processPacket not found — skip");
      return;
    }
    if (original.__vouchernetEmptyPatched) return;

    const replacement: PatchedProcessPacket = function (
      this: ChannelInternals,
      packet: string[],
    ): void {
      const reply = packet.shift();
      const parsed = this.parsePacket(packet);
      if (reply === "!trap") {
        this.trapped = true;
        this.emit("trap", parsed);
        return;
      }
      if (packet.length > 0 && !this.streaming) this.emit("data", parsed);
      switch (reply) {
        case "!re":
          if (this.streaming) this.emit("stream", parsed);
          break;
        case "!done":
        case "!empty":
          if (!this.trapped) this.emit("done", this.data);
          this.close();
          break;
        default:
          this.emit("unknown", reply);
          this.close();
          break;
      }
    };
    replacement.__vouchernetEmptyPatched = true;
    proto.processPacket = replacement;
    logger.info("[mikrotik-patch] Channel.processPacket patched to handle '!empty' replies");
  } catch (err) {
    logger.warn({ err }, "[mikrotik-patch] failed to patch Channel.processPacket");
  }

  patchReceiverUnregisteredTag();
}

interface ReceiverInternals {
  tags: Map<string, { name: string; callback: (packet: string[]) => void }>;
  currentPacket: string[];
  currentTag: string | null;
  currentReply: string | null;
}

interface PatchedSendTagData {
  (this: ReceiverInternals, currentTag: string): void;
  __vouchernetUnregisteredTagPatched?: boolean;
}

function patchReceiverUnregisteredTag(): void {
  try {
    const mod = req("node-routeros/dist/connector/Receiver.js") as {
      Receiver: { prototype: Record<string, unknown> };
    };
    const proto = mod.Receiver.prototype;
    const original = proto.sendTagData as PatchedSendTagData | undefined;
    if (typeof original !== "function") {
      logger.warn("[mikrotik-patch] Receiver.sendTagData not found — skip");
      return;
    }
    if (original.__vouchernetUnregisteredTagPatched) return;

    const replacement: PatchedSendTagData = function (
      this: ReceiverInternals,
      currentTag: string,
    ): void {
      const tag = this.tags.get(currentTag);
      if (tag) {
        try {
          tag.callback(this.currentPacket);
        } catch (cbErr) {
          logger.warn({ err: cbErr, tag: currentTag }, "[mikrotik-patch] tag callback threw");
        }
      }
      // else: late reply for a closed channel — silently drop instead of
      // throwing. Throwing here used to poison Receiver.processSentence's
      // `processingSentencePipe` flag, freezing the entire connection.
      this.currentPacket = [];
      this.currentTag = null;
      this.currentReply = null;
    };
    replacement.__vouchernetUnregisteredTagPatched = true;
    proto.sendTagData = replacement;
    logger.info("[mikrotik-patch] Receiver.sendTagData patched to drop late data for unregistered tags");
  } catch (err) {
    logger.warn({ err }, "[mikrotik-patch] failed to patch Receiver.sendTagData");
  }
}
