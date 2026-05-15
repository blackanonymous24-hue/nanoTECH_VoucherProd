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

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error("FileReader error"));
    fr.readAsDataURL(blob);
  });
}

async function runJob(req: HotspotQrWorkerRequest): Promise<HotspotQrWorkerResponse> {
  const { id, loginHost, username, password, pixelWidth, margin, errorCorrectionLevel } = req;
  const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
  if (!loginUrl) return { id, attrs: 'src="" alt=""' };
  try {
    const svg = await QRCode.toString(loginUrl, {
      type: "svg",
      width: pixelWidth,
      margin,
      errorCorrectionLevel,
    });
    const dataUrl = await readBlobAsDataUrl(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    return { id, attrs: `src="${dataUrl}" alt=""` };
  } catch {
    return { id, attrs: 'src="" alt=""' };
  }
}

self.onmessage = (e: MessageEvent<HotspotQrWorkerRequest>) => {
  void runJob(e.data).then((res) => {
    (self as DedicatedWorkerGlobalScope).postMessage(res);
  });
};
