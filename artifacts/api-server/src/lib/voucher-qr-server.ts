import QRCode from "qrcode";

/** Hôte API (IP / DNS joignable), sans schéma. */
export function buildHotspotLoginUrl(
  loginHost: string,
  username: string,
  password: string,
): string | null {
  let host = (loginHost ?? "").trim();
  if (!host) return null;
  host = host.replace(/^https?:\/\//i, "");
  return `http://${host}/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

const QR_WIDTH = 64;
const QR_MARGIN = 1;

export async function hotspotQrImgAttrs(
  loginHost: string,
  username: string,
  password: string,
  usermode: "vc" | "up",
): Promise<string> {
  let qrPayload: string;
  if (usermode === "vc") {
    qrPayload = (username ?? "").trim() || " ";
  } else {
    const url = buildHotspotLoginUrl(loginHost, username, password);
    if (!url) return 'src="" alt=""';
    qrPayload = url;
  }
  try {
    const dataUrl = await QRCode.toDataURL(qrPayload, {
      width: QR_WIDTH,
      margin: QR_MARGIN,
      errorCorrectionLevel: "L",
      type: "image/png",
      color: { dark: "#000000", light: "#ffffff" },
    });
    return `src="${dataUrl}" alt=""`;
  } catch {
    return 'src="" alt=""';
  }
}

export async function batchHotspotQrImgAttrs(
  loginHost: string,
  items: Array<{ username: string; password: string; usermode: "vc" | "up" }>,
): Promise<string[]> {
  return Promise.all(
    items.map((it) => hotspotQrImgAttrs(loginHost, it.username, it.password, it.usermode)),
  );
}
