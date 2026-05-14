import { useMemo } from "react";
import { Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { renderVoucherTicketHtml, type VoucherTicketPrintRow } from "@/lib/voucher-ticket-render";
import { MIKHMON_VOUCHER_PRINT_CSS } from "@/lib/print";

/** Placeholder 1×1 PNG pour l’aperçu (évite une image cassée si le gabarit utilise $qrcode). */
const PREVIEW_QR_ATTRS =
  'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwADgwJ/lV1O6QAAAABJRU5ErkJggg==" alt=""';

const SAMPLE_ROW: VoucherTicketPrintRow = {
  hotspotName: "WiFi Bureau",
  num: 1,
  usermode: "vc",
  username: "user01abc",
  password: "pass1234",
  validityRaw: "1d",
  timelimitRaw: "8h",
  datalimit: "",
  /** Non affiché dans `$price` (réservé à la devise) — utile pour `$getprice` / nanoTECH. */
  priceDisplay: "1000",
  getpriceKey: "1000",
  currency: "FCFA",
  dnsname: "contact@wifi.local",
  qrcode: PREVIEW_QR_ATTRS,
};

const PREVIEW_WRAPPER_CSS = `
  body { margin: 8px; background: #fff; }
  * { box-sizing: border-box; }
`;

type Props = {
  code: string;
};

export function TicketTemplatePreview({ code }: Props) {
  const ticketHtml = useMemo(() => {
    if (!code.trim()) return "";
    try {
      return renderVoucherTicketHtml(code, SAMPLE_ROW);
    } catch {
      return "<p style='color:red;font-family:sans-serif;font-size:12px'>Erreur de rendu du modèle.</p>";
    }
  }, [code]);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${MIKHMON_VOUCHER_PRINT_CSS}${PREVIEW_WRAPPER_CSS}</style></head><body>${ticketHtml}</body></html>`;

  return (
    <Card className="flex min-h-[10rem] flex-col">
      <CardHeader className="shrink-0 p-3 py-2 pb-1">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <Eye className="h-3.5 w-3.5 shrink-0 text-violet-500" />
          Aperçu du ticket
          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-normal text-gray-500 uppercase tracking-wide">
            données fictives
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-3 pt-0">
        {!ticketHtml ? (
          <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
            Choisissez un modèle pour voir l'aperçu
          </div>
        ) : (
          <iframe
            key={srcDoc}
            srcDoc={srcDoc}
            title="Aperçu ticket"
            sandbox="allow-same-origin"
            className="w-full flex-1 rounded border border-gray-100 bg-white"
            style={{ minHeight: "9rem", height: "10rem" }}
          />
        )}
      </CardContent>
    </Card>
  );
}
