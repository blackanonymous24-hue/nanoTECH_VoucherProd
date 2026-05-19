import type { AddHotspotUserOpts } from "./mikrotik.js";

/**
 * Logique « Ajouter un utilisateur » — alignée sur Mikhmon V3 adduser.php.
 * Garder synchronisé avec artifacts/app/src/lib/mikhmon-add-user.ts
 */

export type MikhmonAddUserMode = "vc" | "up";

/** Comme adduser.php : `if ($name == $password)` — sans trim. */
export function mikhmonAddUserCredentialsMode(name: string, password: string): MikhmonAddUserMode {
  return name === password ? "vc" : "up";
}

export function mikhmonAddUserCommentPrefix(name: string, password: string): "vc-" | "up-" {
  return mikhmonAddUserCredentialsMode(name, password) === "vc" ? "vc-" : "up-";
}

export function formatMikhmonAddUserComment(
  name: string,
  password: string,
  userComment = "",
): string {
  const prefix = mikhmonAddUserCommentPrefix(name, password);
  let tail = userComment;
  if (/^(vc|up)-/i.test(tail.trim())) {
    tail = tail.trim().replace(/^(vc|up)-/i, "");
  }
  return prefix + tail;
}

export interface MikhmonAddHotspotUserInput {
  name: string;
  password: string;
  profile: string;
  comment?: string;
  server?: string;
  limitUptime?: string;
  limitBytesTotal?: string;
  macAddress?: string;
}

export function normalizeMikhmonAddHotspotUser(
  input: MikhmonAddHotspotUserInput,
): AddHotspotUserOpts {
  const name = input.name;
  const password = input.password;
  const timelimit = input.limitUptime ?? "";
  const datalimit = input.limitBytesTotal ?? "";

  return {
    name,
    password,
    profile: input.profile.trim(),
    comment: formatMikhmonAddUserComment(name, password, input.comment ?? ""),
    server: (input.server ?? "").trim() || "all",
    limitUptime: timelimit === "" ? "0" : timelimit,
    limitBytesTotal: datalimit === "" ? "0" : datalimit,
    macAddress: input.macAddress?.trim() || undefined,
  };
}
