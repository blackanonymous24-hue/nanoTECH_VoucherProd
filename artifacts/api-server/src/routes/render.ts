import { Router } from "express";
import { execFile } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import QRCode from "qrcode";

const router = Router();

type VoucherVars = {
  hotspotname?: string;
  dnsname?: string;
  price?: string | number;
  currency?: string;
  username?: string;
  password?: string;
  timelimit?: string;
  datalimit?: string;
  validity?: string;
  num?: string | number;
};

async function buildPreamble(v: VoucherVars): Promise<string> {
  const e = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const hotspotname = e(String(v.hotspotname ?? ""));
  const dnsname     = e(String(v.dnsname ?? ""));
  const price       = e(String(v.price ?? "0"));
  const currency    = e(String(v.currency ?? "FCFA"));
  const username    = e(String(v.username ?? ""));
  const password    = e(String(v.password ?? ""));
  const timelimit   = e(String(v.timelimit ?? ""));
  const datalimit   = e(String(v.datalimit ?? ""));
  const validity    = e(String(v.validity ?? ""));
  const num         = Number(v.num ?? 1);

  // Determine QR data the same way Mikhmon does
  const usermode  = (String(v.username ?? "") === String(v.password ?? "")) ? "vc" : "up";
  const urilogin  = `http://${String(v.dnsname ?? "")}/login?username=${encodeURIComponent(String(v.username ?? ""))}&password=${encodeURIComponent(String(v.password ?? ""))}`;
  const qrData    = usermode === "vc" ? String(v.username ?? "") : urilogin;

  // Generate QR code as base64 data URI — no external request needed at print time
  let qrDataUri = "";
  try {
    qrDataUri = await QRCode.toDataURL(qrData || " ", {
      width: 64,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    qrDataUri = "";
  }

  const qrImgTag = qrDataUri
    ? `<img src="${qrDataUri}" style="width:32px;height:32px;border-radius:3px;" alt="QR">`
    : "";

  return `<?php
$hotspotname = '${hotspotname}';
$dnsname     = '${dnsname}';
$getprice    = '${price}';
$getsprice   = '${price}';
$price       = '${price}';
$currency    = '${currency}';
$username    = '${username}';
$password    = '${password}';
$usermode    = ($username === $password) ? 'vc' : 'up';
$timelimit   = '${timelimit}';
$datalimit   = '${datalimit}';
$validity    = '${validity}';
$getvalidity = '${validity}';
$profile     = '';
$comment     = '';
$num         = ${num};

// Color map aligned with Mikhmon-like defaults (fallback included)
$__priceKey = preg_replace('/\\D+/', '', (string)$getprice);
$__colorMap = [
  '0' => '#E50877', '100' => '#752CEB', '200' => '#804000', '300' => '#13C013',
  '500' => '#ECA352', '1000' => '#F75418', '1500' => '#FF69B4', '2500' => '#F70000',
  '3000' => '#F70000', '13000' => '#2E8B57', '15000' => '#2E8B57',
  '17000' => '#0000FF', '20000' => '#0000FF', '35000' => '#6495ED',
  '40000' => '#6495ED', '80000' => '#FF8C00', '85000' => '#FF8C00',
  '160000' => '#DC143C', '170000' => '#DC143C',
];
$color = $__colorMap[$__priceKey] ?? '#1433FD';

// QR code — pré-généré en base64 côté serveur, pas de requête externe à l'impression
$urilogin = 'http://' . $dnsname . '/login?username=' . urlencode($username) . '&password=' . urlencode($password);
$qrData   = ($usermode === 'vc') ? $username : $urilogin;
$qrcode   = '${qrImgTag.replace(/'/g, "\\'")}';

// Stub formatBytes si non disponible
if (!function_exists('formatBytes')) {
  function formatBytes($bytes, $precision = 2) {
    $bytes = (int)$bytes;
    if ($bytes >= 1073741824) return round($bytes / 1073741824, $precision) . ' GB';
    if ($bytes >= 1048576)   return round($bytes / 1048576, $precision)   . ' MB';
    if ($bytes >= 1024)      return round($bytes / 1024, $precision)      . ' KB';
    return $bytes . ' B';
  }
}
?>
`;
}

router.post("/render-tickets", async (req, res) => {
  const { php, vouchers } = req.body as {
    php: string;
    vouchers: VoucherVars[];
  };

  if (!php || !Array.isArray(vouchers) || vouchers.length === 0) {
    res.status(400).json({ error: "Paramètres manquants : php et vouchers requis." });
    return;
  }

  try {
    const htmlArray: string[] = [];

    for (const vars of vouchers) {
      const preamble = await buildPreamble(vars);
      const script   = preamble + "\n" + php;
      const tmpFile  = join(tmpdir(), `vnet_${randomBytes(8).toString("hex")}.php`);

      await writeFile(tmpFile, script, "utf-8");

      const output = await new Promise<string>((resolve, reject) => {
        execFile("php", [tmpFile], { timeout: 15_000 }, (err, stdout, stderr) => {
          unlink(tmpFile).catch(() => {});
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      });

      // Extraire uniquement la section entre les marqueurs MikHmon
      const si = output.indexOf("<!--mks-mulai-->");
      const ei = output.indexOf("<!--mks-akhir-->");
      if (si !== -1 && ei !== -1) {
        htmlArray.push(output.slice(si, ei + "<!--mks-akhir-->".length));
      } else {
        htmlArray.push(output.trim());
      }
    }

    res.json({ html: htmlArray });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
