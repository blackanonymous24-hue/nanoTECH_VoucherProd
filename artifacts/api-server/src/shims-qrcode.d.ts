/** Typage minimal pour `qrcode` (runtime : PNG data URL). */
declare module "qrcode" {
  const QRCode: {
    toDataURL(
      text: string,
      options?: {
        type?: "image/png" | "image/jpeg" | "image/webp";
        width?: number;
        margin?: number;
        errorCorrectionLevel?: "L" | "M" | "Q" | "H";
      },
    ): Promise<string>;
  };
  export default QRCode;
}
