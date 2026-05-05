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
    // 1. Build voucher data WITHOUT QR codes — use placeholder tokens instead.
    //    This keeps the PHP driver file small (< 1 MB even for 5000 vouchers),
    //    avoiding the 15 MB PHP string-literal that caused json_decode to stall.
    const QR_PLACEHOLDER = (i: number) => `__NTECH_QR_${i}__`;

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
        qrcode:      QR_PLACEHOLDER(i),   // placeholder — real QR injected after PHP
      };
    });

    // 2. Write the user's PHP template as-is to a temp file
    await writeFile(templateFile, php, "utf-8");

    // 3. Build the driver script (now lightweight — no base64 blobs inside)
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

    // 4. Generate QR codes in batches of 50 to avoid memory spikes,
    //    while PHP runs concurrently (started after writeFile resolves).
    const QR_BATCH = 50;
    const qrTagsPromise = (async () => {
      const tags: string[] = [];
      for (let i = 0; i < vouchers.length; i += QR_BATCH) {
        const chunk = vouchers.slice(i, i + QR_BATCH);
        const batch = await Promise.all(chunk.map(buildQrTag));
        tags.push(...batch);
      }
      return tags;
    })();

    // 5. Run PHP process and await QR generation in parallel
    const [output, qrTags] = await Promise.all([
      new Promise<string>((resolve, reject) => {
        execFile("php", [driverFile], { timeout: 120_000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      }),
      qrTagsPromise,
    ]);

    // 6. Split output by separator, extract mks markers, then inject QR codes
    const chunks = output.split(TICKET_SEP).filter((c) => c.trim() !== "");

    const htmlArray = chunks.map((chunk, i) => {
      const si = chunk.indexOf("<!--mks-mulai-->");
      const ei = chunk.indexOf("<!--mks-akhir-->");
      let html = (si !== -1 && ei !== -1)
        ? chunk.slice(si, ei + "<!--mks-akhir-->".length)
        : chunk.trim();
      // Inject the real QR tag in place of the placeholder
      if (qrTags[i]) {
        html = html.replace(QR_PLACEHOLDER(i), qrTags[i]);
      }
      return html;
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
