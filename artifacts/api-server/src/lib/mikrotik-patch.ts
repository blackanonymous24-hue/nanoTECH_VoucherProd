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
 *    keeps draining. Receiver is reached via RouterOSAPI.prototype.connect
 *    (one-shot Receiver class capture from the first live connection)
 *    because esbuild bundles node-routeros and createRequire/dynamic-imports
 *    of its internal CommonJS files do not resolve at runtime.
 *
 * Both patches preserve happy-path behaviour byte-for-byte; they only
 * change the throw-and-poison branches.
 */
import { Channel, RouterOSAPI } from "node-routeros";
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

let patched = false;
let receiverPrototypePatched = false;

export function patchNodeRouterosEmptyReply(): void {
  if (patched) return;
  patched = true;

  patchChannelProcessPacket();
  installReceiverPatchHook();
}

function patchChannelProcessPacket(): void {
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

/**
 * `Receiver` is not exported by node-routeros and `createRequire` can't reach
 * it (esbuild bundle). Instead we hook `RouterOSAPI.prototype.connect`: when
 * the first real connection completes, we grab the live Receiver instance's
 * constructor and patch its prototype once for all subsequent connections.
 */
function installReceiverPatchHook(): void {
  try {
    const ApiCtor = RouterOSAPI as unknown as {
      prototype: Record<string, unknown> & {
        connect: (...args: unknown[]) => Promise<unknown>;
      };
    };
    const proto = ApiCtor.prototype;
    const originalConnect = proto.connect;
    if (typeof originalConnect !== "function") {
      logger.warn("[mikrotik-patch] RouterOSAPI.connect not found — skip");
      return;
    }
    if ((originalConnect as { __vouchernetReceiverHookInstalled?: boolean }).__vouchernetReceiverHookInstalled) {
      return;
    }
    const wrapped = async function (
      this: { connector?: { receiver?: object } },
      ...args: unknown[]
    ): Promise<unknown> {
      const result = await originalConnect.apply(this, args);
      try {
        if (!receiverPrototypePatched) {
          const receiver = this.connector?.receiver;
          if (receiver) {
            const receiverProto = Object.getPrototypeOf(receiver) as Record<string, unknown>;
            patchReceiverSendTagData(receiverProto);
            receiverPrototypePatched = true;
          }
        }
      } catch (err) {
        logger.warn({ err }, "[mikrotik-patch] failed to install Receiver patch on connect");
      }
      return result;
    };
    (wrapped as { __vouchernetReceiverHookInstalled?: boolean }).__vouchernetReceiverHookInstalled = true;
    proto.connect = wrapped;
    logger.info("[mikrotik-patch] RouterOSAPI.connect wrapped — Receiver will be patched on first connection");
  } catch (err) {
    logger.warn({ err }, "[mikrotik-patch] failed to install Receiver hook");
  }
}

function patchReceiverSendTagData(proto: Record<string, unknown>): void {
  const original = proto.sendTagData as PatchedSendTagData | undefined;
  if (typeof original !== "function") {
    logger.warn("[mikrotik-patch] Receiver.sendTagData not found on prototype — skip");
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
}
