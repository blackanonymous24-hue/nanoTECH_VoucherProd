/**
 * Rendu ticket « small » aligné sur Mikhmon v3 :
 * `voucher/print.php` (styles + body) + `voucher/template-small.php` (table).
 */

const UNITS = ["Byte", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Équivalent PHP `formatBytes($size, 2)` (divisions par 1024, libellés KiB/MiB…). */
export function formatMikhmonBytes(raw: string | number | null | undefined): string {
  let size = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(size) || size <= 0) return "";
  let i = 0;
  for (; size >= 1024 && i < UNITS.length - 1; i++) {
    size /= 1024;
  }
  return `${size.toFixed(2)} ${UNITS[i]}`;
}

export function mikhmonProfilePriceLabel(p?: { price?: string | null; sellingPrice?: string | null } | null): string {
  if (!p) return "";
  const sp = String(p.sellingPrice ?? "").trim();
  const pr = String(p.price ?? "").trim();
  const isZero = (s: string) => {
    const n = parseFloat(s.replace(",", "."));
    return s === "" || (Number.isFinite(n) && n === 0);
  };
  if (sp && !isZero(sp)) return sp;
  if (pr && !isZero(pr)) return pr;
  return "";
}

/**
 * Même règle que Mikhmon `print.php` : préfixe du commentaire / id (`vc-…`, `up-…`),
 * sinon username === password → vc.
 */
export function inferMikhmonUserMode(
  comment: string | null | undefined,
  username: string,
  password: string,
): "vc" | "up" {
  const first = (comment ?? "").split("-")[0]?.toLowerCase() ?? "";
  if (first === "vc") return "vc";
  if (first === "up") return "up";
  return username === password ? "vc" : "up";
}

export type MikhmonSmallTicket = {
  hotspotName: string;
  /** 1-based, affiché comme dans Mikhmon : ` [n]` */
  num: number;
  usermode: "vc" | "up";
  username: string;
  password: string;
  validity: string;
  timelimit: string;
  datalimit: string;
  price: string;
};

/** Une table `.voucher` alignée sur `ticket-templates/mikhmon-small.php.txt` (mode vc). */
export function buildMikhmonSmallTicketHtml(t: MikhmonSmallTicket): string {
  const hs = escapeHtml(t.hotspotName);
  const num = escapeHtml(String(t.num));
  const u = escapeHtml(t.username);
  const p = escapeHtml(t.password);
  const v = escapeHtml(t.validity);
  const time = escapeHtml(t.timelimit);
  const data = escapeHtml(t.datalimit);
  const price = escapeHtml(t.price);
  const bottom = [v, time, data, price].filter(Boolean).join(" ");

  if (t.usermode === "vc") {
    return `<table class="voucher" style=" width: 160px;">
  <tbody>
    <tr>
      <td style="text-align: left; font-size: 14px; font-weight:bold; border-bottom: 1px black solid;">${hs}<span id="num"> [${num}]</span></td>
    </tr>
    <tr>
      <td>
    <table style=" text-align: center; width: 150px;">
  <tbody>
    <tr style="color: black; font-size: 11px;">
      <td>
        <table style="width:100%;">
        <tr>
          <td style="font-size: 12px;">Code Ticket</td>
        </tr>
        <tr style="color: black; font-size: 14px;">
          <td style="width:100%; border: 1px solid black; font-weight:bold;">${u}</td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid black; font-weight:bold;">${bottom}</td>
        </tr>
        </table>
      </td>
    </tr>
  </tbody>
    </table>
      </td>
    </tr>
  </tbody>
</table>`;
  }

  return `<table class="voucher" style=" width: 160px;">
  <tbody>
    <tr>
      <td style="text-align: left; font-size: 14px; font-weight:bold; border-bottom: 1px black solid;">${hs}<span id="num"> [${num}]</span></td>
    </tr>
    <tr>
      <td>
    <table style=" text-align: center; width: 150px;">
  <tbody>
    <tr style="color: black; font-size: 11px;">
      <td>
        <table style="width:100%;">
          <tr>
          <td style="width: 50%">Username</td>
          <td>Password</td>
        </tr>
        <tr style="color: black; font-size: 14px;">
          <td style="border: 1px solid black; font-weight:bold;">${u}</td>
          <td style="border: 1px solid black; font-weight:bold;">${p}</td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid black; font-weight:bold;">${bottom}</td>
        </tr>
        </table>
      </td>
    </tr>
  </tbody>
    </table>
      </td>
    </tr>
  </tbody>
</table>`;
}

export function buildMikhmonSmallTicketsBody(tickets: MikhmonSmallTicket[]): string {
  return tickets.map(buildMikhmonSmallTicketHtml).join("\n");
}
