import { Router } from "express";
import { execFile } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

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

function buildPreamble(v: VoucherVars): string {
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

  return `<?php
$hotspotname = '${hotspotname}';
$dnsname     = '${dnsname}';
$getprice    = '${price}';
$price       = '${price}';
$currency    = '${currency}';
$username    = '${username}';
$password    = '${password}';
$usermode    = ($username === $password) ? 'vc' : 'up';
$timelimit   = '${timelimit}';
$datalimit   = '${datalimit}';
$validity    = '${validity}';
$num         = ${num};

// QR code — remplace le canvas QRious.js de MikHmon par une image statique
$urilogin = 'http://' . $dnsname . '/login?username=' . urlencode($username) . '&password=' . urlencode($password);
$qrData   = ($usermode === 'vc') ? $username : $urilogin;
$qrcode   = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=' . urlencode($qrData) . '&margin=2" style="width:32px;height:32px;border-radius:3px;" alt="QR">';

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
      const script = buildPreamble(vars) + "\n" + php;
      const tmpFile = join(tmpdir(), `vnet_${randomBytes(8).toString("hex")}.php`);

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
