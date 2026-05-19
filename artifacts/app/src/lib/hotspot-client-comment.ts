/** Préfixe commentaire Mikhmon : user = password → vc-, sinon up-. */
export function hotspotClientCommentMode(username: string, password: string): "vc" | "up" {
  const name = username.trim();
  const pass = password.trim();
  if (name.length > 0 && pass.length > 0 && name === pass) return "vc";
  return "up";
}

export function makeClientBatchId(mode: "vc" | "up"): string {
  const now = new Date();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const Y = String(now.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `${mode}-${rand}-${M}.${D}.${Y}`;
}

export function makeClientCommentForCredentials(username: string, password: string): string {
  return makeClientBatchId(hotspotClientCommentMode(username, password));
}

export {
  buildMikhmonAddUserComment,
  buildMikhmonAddUserRequestBody,
  getMikhmonAddUserUiState,
  mikhmonAddUserCredentialsMode,
} from "./mikhmon-add-user";

/** Comme Mikhmon generateuser (lots) — pas adduser.php. */
export function resolveHotspotClientComment(
  comment: string,
  username: string,
  password: string,
): string {
  const c = comment.trim();
  if (/^(vc|up)-/i.test(c)) return c;
  const mode = hotspotClientCommentMode(username, password);
  if (!c) return makeClientBatchId(mode);
  return `${mode}-${c}`;
}
