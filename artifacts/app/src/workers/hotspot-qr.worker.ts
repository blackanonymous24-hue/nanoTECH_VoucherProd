/// <reference lib="webworker" />

import QRCode from "qrcode";
import { buildHotspotLoginUrl } from "@/lib/voucher-login-qr-url";
import type { HotspotQrWorkerRequest, HotspotQrWorkerResponse } from "@/workers/hotspot-qr-worker-protocol";

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
  const usermode = req.usermode ?? "up";
  let qrPayload: string;
  if (usermode === "vc") {
    qrPayload = (username ?? "").trim() || " ";
  } else {
    const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
    if (!loginUrl) return { id, attrs: 'src="" alt=""' };
    qrPayload = loginUrl;
  }
  try {
    const svg = await QRCode.toString(qrPayload, {
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
