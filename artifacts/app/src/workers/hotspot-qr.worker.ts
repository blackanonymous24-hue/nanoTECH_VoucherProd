/// <reference lib="webworker" />

import QRCode from "qrcode";
import { buildHotspotLoginUrl } from "@/lib/voucher-login-qr-url";

export type HotspotQrWorkerRequest = {
  id: number;
  loginHost: string;
  username: string;
  password: string;
  pixelWidth: number;
  margin: number;
  errorCorrectionLevel: "L" | "M" | "Q" | "H";
};

export type HotspotQrWorkerResponse = {
  id: number;
  attrs: string;
};

async function runJob(req: HotspotQrWorkerRequest): Promise<HotspotQrWorkerResponse> {
  const { id, loginHost, username, password, pixelWidth, margin, errorCorrectionLevel } = req;
  const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
  if (!loginUrl) return { id, attrs: 'src="" alt=""' };
  try {
    const dataUrl = await QRCode.toDataURL(loginUrl, {
      type: "image/png",
      width: pixelWidth || 64,
      margin,
      errorCorrectionLevel,
    });
    return { id, attrs: `src="${dataUrl}" width="64" height="64" alt="" decoding="async"` };
  } catch {
    return { id, attrs: 'src="" alt=""' };
  }
}

self.onmessage = (e: MessageEvent<HotspotQrWorkerRequest>) => {
  void runJob(e.data).then((res) => {
    (self as DedicatedWorkerGlobalScope).postMessage(res);
  });
};
