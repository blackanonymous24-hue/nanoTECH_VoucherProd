/**
 * Runtime monkey-patch for node-routeros@1.6.9 to handle `!empty` replies.
 *
 * Problem
 * -------
 * RouterOS v7+ replies with `!empty` (not `!done`) when a print query matches
 * zero rows. The bundled node-routeros Channel.processPacket only knows
 * `!re` / `!done` and routes everything else through the `unknown` event,
 * whose default listener THROWS:
 *
 *   throw new RosException("UNKNOWNREPLY", { reply })
 *
 * Because the surrounding `read()` callback is invoked from the socket data
 * loop (not inside the Promise constructor), the throw bubbles up as an
 * uncaughtException and the `await api.write(...)` Promise NEVER resolves
 * or rejects — the call hangs forever, blocking any operation that does a
 * filtered print (e.g. countHotspotUsersByComment on a brand-new lot ID).
 *
 * Concrete user-visible symptom
 * -----------------------------
 * Voucher generation gets stuck on "Préparation du routeur" 0% for admins
 * whose routers run a recent RouterOS, while super-admin / older-RouterOS
 * tenants succeed.
 *
 * Fix
 * ---
 * Override `Channel.prototype.processPacket` so `!empty` is treated like
 * `!done` (emit 'done' with the accumulated data — empty array — and close
 * the channel cleanly). Behaviour for `!re` / `!done` / `!trap` is preserved
 * byte-for-byte from the upstream source.
 */
import { Channel } from "node-routeros";
import { logger } from "./logger.js";

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
}
