/**
 * Logique « Ajouter un utilisateur » — alignée sur Mikhmon V3 adduser.php.
 * (name == password) → vc- ; sinon → up- ; limites vides → "0" ; disabled → no ; server → all.
 */

export type MikhmonAddUserMode = "vc" | "up";

/** Comme adduser.php : `if ($name == $password)` — sans trim. */
export function mikhmonAddUserCredentialsMode(name: string, password: string): MikhmonAddUserMode {
  return name === password ? "vc" : "up";
}

export function mikhmonAddUserCommentPrefix(name: string, password: string): "vc-" | "up-" {
  return mikhmonAddUserCredentialsMode(name, password) === "vc" ? "vc-" : "up-";
}

/** `$usermode . $comment` — commentaire utilisateur sans préfixe vc-/up- en double. */
export function buildMikhmonAddUserComment(
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

const MB = 1048576;
const GB = 1073741824;

export interface MikhmonAddUserRequestInput {
  name: string;
  password: string;
  profile: string;
  server: string;
  timeLimit: string;
  dataLimit: string;
  dataUnit: "MB" | "GB";
  comment: string;
  macAddress?: string;
}

/** Corps JSON pour POST /api/routers/:id/hotspot-users (adduser.php). */
export function buildMikhmonAddUserRequestBody(
  opts: MikhmonAddUserRequestInput,
): Record<string, string> {
  const name = opts.name;
  const password = opts.password;
  const timelimit = opts.timeLimit;
  const datalimitRaw = opts.dataLimit;

  let limitBytesTotal = "0";
  if (datalimitRaw !== "") {
    const n = Number(datalimitRaw);
    if (Number.isFinite(n)) {
      const mult = opts.dataUnit === "GB" ? GB : MB;
      limitBytesTotal = String(Math.round(n * mult));
    }
  }

  const body: Record<string, string> = {
    name,
    password,
    profile: opts.profile.trim(),
    comment: buildMikhmonAddUserComment(name, password, opts.comment),
    server: opts.server.trim() || "all",
    limitUptime: timelimit === "" ? "0" : timelimit,
    limitBytesTotal,
  };

  const mac = opts.macAddress?.trim();
  if (mac) body.macAddress = mac;

  return body;
}

export function getMikhmonAddUserUiState(name: string, password: string, comment: string) {
  const mode = mikhmonAddUserCredentialsMode(name, password);
  const finalComment = buildMikhmonAddUserComment(name, password, comment);
  const isVoucher = mode === "vc";
  return {
    mode,
    finalComment,
    isVoucher,
    modeLabel: isVoucher ? "Voucher (vc-)" : "Compte (up-)",
    portalHint: isVoucher
      ? "Portail captif : un seul champ — saisir le code (nom = mot de passe)."
      : "Portail captif : deux champs — identifiant et mot de passe.",
    commentHint: isVoucher
      ? "Commentaire vide → « vc- » sur MikroTik (comme Mikhmon)."
      : "Commentaire vide → « up- » sur MikroTik (comme Mikhmon).",
  };
}
