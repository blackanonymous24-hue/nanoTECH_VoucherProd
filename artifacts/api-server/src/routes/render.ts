import { Router } from "express";
import { execFile } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import QRCode from "qrcode";

const router = Router();

const MAX_VOUCHERS = 5_000;

const TICKET_SEP = "<!--__NTECH_TICKET_SEP__-->";

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
  color?: string;
};

function phpStr(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

async function buildQrTag(v: VoucherVars): Promise<string> {
  const username = String(v.username ?? "");
  const password = String(v.password ?? "");
  const dnsname  = String(v.dnsname ?? "");
  const usermode = username === password ? "vc" : "up";
  const qrData   = usermode === "vc"
    ? username
    : `http://${dnsname}/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  try {
    const dataUri = await QRCode.toDataURL(qrData || " ", {
      width: 64, margin: 1, color: { dark: "#000000", light: "#ffffff" },
    });
    return `<img src="${dataUri}" style="width:32px;height:32px;border-radius:3px;" alt="QR">`;
  } catch {
    return "";
  }
}

router.post("/render-tickets", async (req, res) => {
  const { php, vouchers } = req.body as { php: string; vouchers: VoucherVars[] };

  if (!php || !Array.isArray(vouchers) || vouchers.length === 0) {
    res.status(400).json({ error: "Paramètres manquants : php et vouchers requis." });
    return;
  }
  if (vouchers.length > MAX_VOUCHERS) {
    res.status(400).json({ error: `Maximum ${MAX_VOUCHERS} tickets par impression.` });
    return;
  }

  const id = randomBytes(8).toString("hex");
  const templateFile = join(tmpdir(), `vnet_tpl_${id}.php`);
  const driverFile   = join(tmpdir(), `vnet_drv_${id}.php`);

  try {
    // 1. Generate all QR codes in parallel (Node.js, much faster than PHP)
    const qrTags = await Promise.all(vouchers.map(buildQrTag));

    // 2. Build the voucher data array as a PHP JSON literal embedded in driver
    const voucherData = vouchers.map((v, i) => {
      const username = String(v.username ?? "");
      const password = String(v.password ?? "");
      const priceNum = String(v.price ?? "0").replace(/\D+/g, "");
      return {
        hotspotname: String(v.hotspotname ?? ""),
        dnsname:     String(v.dnsname ?? ""),
        price:       String(v.price ?? "0"),
        priceNum,
        currency:    String(v.currency ?? "FCFA"),
        username,
        password,
        usermode:    username === password ? "vc" : "up",
        timelimit:   String(v.timelimit ?? ""),
        datalimit:   String(v.datalimit ?? ""),
        validity:    String(v.validity ?? ""),
        num:         Number(v.num ?? i + 1),
        color:       String((v as any).color ?? "#1433FD"),
        qrcode:      qrTags[i],
      };
    });

    // 3. Write the user's PHP template as-is to a temp file
    await writeFile(templateFile, php, "utf-8");

    // 4. Build the driver script: sets PHP vars, includes template, repeats for each voucher
    const jsonData = JSON.stringify(voucherData).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    const driver = `<?php
// nanoTECH batch renderer — generated, do not edit
if (!function_exists('formatBytes')) {
  function formatBytes($bytes, $precision = 2) {
    $bytes = (int)$bytes;
    if ($bytes >= 1073741824) return round($bytes / 1073741824, $precision) . ' GB';
    if ($bytes >= 1048576)   return round($bytes / 1048576,   $precision) . ' MB';
    if ($bytes >= 1024)      return round($bytes / 1024,      $precision) . ' KB';
    return $bytes . ' B';
  }
}

$__colorMap = [
  '0'=>'#E50877','100'=>'#752CEB','200'=>'#804000','300'=>'#13C013',
  '500'=>'#ECA352','1000'=>'#F75418','1500'=>'#FF69B4','2500'=>'#F70000',
  '3000'=>'#F70000','13000'=>'#2E8B57','15000'=>'#2E8B57',
  '17000'=>'#0000FF','20000'=>'#0000FF','35000'=>'#6495ED',
  '40000'=>'#6495ED','80000'=>'#FF8C00','85000'=>'#FF8C00',
  '160000'=>'#DC143C','170000'=>'#DC143C',
];

$__sep      = '${TICKET_SEP}';
$__tpl      = ${phpStr(templateFile)};
$__vouchers = json_decode('${jsonData}', true);

foreach ($__vouchers as $__v) {
  $hotspotname = $__v['hotspotname'];
  $dnsname     = $__v['dnsname'];
  $getprice    = $__v['price'];
  $getsprice   = $__v['price'];
  $price       = $__v['price'];
  $currency    = $__v['currency'];
  $username    = $__v['username'];
  $password    = $__v['password'];
  $usermode    = $__v['usermode'];
  $timelimit   = $__v['timelimit'];
  $datalimit   = $__v['datalimit'];
  $validity    = $__v['validity'];
  $getvalidity = $__v['validity'];
  $profile     = '';
  $comment     = '';
  $num         = (int)$__v['num'];
  $color       = isset($__colorMap[$__v['priceNum']]) ? $__colorMap[$__v['priceNum']] : $__v['color'];
  $urilogin    = 'http://' . $dnsname . '/login?username=' . urlencode($username) . '&password=' . urlencode($password);
  $qrData      = ($usermode === 'vc') ? $username : $urilogin;
  $qrcode      = $__v['qrcode'];

  include $__tpl;
  echo $__sep;
}
?>`;

    await writeFile(driverFile, driver, "utf-8");

    // 5. Run a single PHP process for all vouchers
    const output = await new Promise<string>((resolve, reject) => {
      execFile("php", [driverFile], { timeout: 120_000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });

    // 6. Split output by separator, then extract mks markers if present
    const chunks = output.split(TICKET_SEP).filter((c) => c.trim() !== "");

    const htmlArray = chunks.map((chunk) => {
      const si = chunk.indexOf("<!--mks-mulai-->");
      const ei = chunk.indexOf("<!--mks-akhir-->");
      if (si !== -1 && ei !== -1) {
        return chunk.slice(si, ei + "<!--mks-akhir-->".length);
      }
      return chunk.trim();
    });

    res.json({ html: htmlArray });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  } finally {
    await Promise.allSettled([unlink(templateFile), unlink(driverFile)]);
  }
});

export default router;
