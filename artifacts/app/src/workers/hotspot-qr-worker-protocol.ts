/** Messages worker QR hotspot — partagé pool + worker (pas de logique QR ici). */
export type HotspotQrWorkerRequest = {
  id: number;
  loginHost: string;
  username: string;
  password: string;
  /** Comme MHM : `vc` = payload username seul. */
  usermode?: "vc" | "up";
  pixelWidth: number;
  margin: number;
  errorCorrectionLevel: "L" | "M" | "Q" | "H";
};

export type HotspotQrWorkerResponse = {
  id: number;
  attrs: string;
};
