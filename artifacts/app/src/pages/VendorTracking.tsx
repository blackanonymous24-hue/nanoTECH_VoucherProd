import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Printer, Search, RotateCcw, Users, Loader2, AlertCircle,
  CalendarDays, ImageDown, AlertTriangle, CalendarRange,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTH_NAMES_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

function fmtAmount(n: number) {
  if (n === 0) return "0";
  return n.toLocaleString("fr-FR");
}

function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtDateFr(iso: string): string {
  const [y, m, day] = iso.split("-");
  return `${day} ${MONTH_NAMES_FR[parseInt(m, 10) - 1]} ${y}`;
}

function prevWeekSundayLocal(): string {
  const d = new Date();
  const day = d.getDay();
  const daysToLastSunday = day === 0 ? 7 : day;
  const lastSunday = new Date(d);
  lastSunday.setDate(d.getDate() - daysToLastSunday);
  return lastSunday.toISOString().slice(0, 10);
}

interface VoucherEntry {
  id: number;
  vendorId: number | null;
  vendorName: string;
  username: string;
  profileName: string;
  amount: number;
  usedAt: string | null;
  date: string | null;
  time: string | null;
}

interface VendorSummaryEntry {
  vendorId: number | null;
  vendorName: string;
  count: number;
  amount: number;
  paidAmount?: number;
  remainingAmount?: number;
  commission?: number;
  commissionRate?: number;
  paymentStatus?: "none" | "partial" | "full";
}

interface DailyTrackingResponse {
  date: string;
  summary: VendorSummaryEntry[];
  vouchers: VoucherEntry[];
  weekSummary: VendorSummaryEntry[];
  weekStart?: string;
  weekEnd?: string;
}

function weekLabelFromRange(weekStart?: string, weekEnd?: string): string {
  if (!weekStart || !weekEnd) return "Semaine";
  return `${fmtDateFr(weekStart)} – ${fmtDateFr(weekEnd)}`;
}

function statusBadge(status?: "none" | "partial" | "full"): {
  text: string; cls: string; icon?: boolean;
} {
  if (status === "full")    return { text: "Soldé",              cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (status === "partial") return { text: "Versement partiel",  cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { text: "Aucun versement", cls: "bg-red-50 text-red-700 border-red-200", icon: true };
}

function pct(paid: number, expected: number): string {
  if (expected <= 0) return "—";
  return Math.round((paid / expected) * 100) + "%";
}

/* ── Print helper: daily ─────────────────────────────────────── */
function openPrintWindow(data: DailyTrackingResponse, search: string) {
  const dateFr = fmtDateFr(data.date);
  const vouchers = search.trim()
    ? data.vouchers.filter(
        (v) =>
          v.username.toLowerCase().includes(search.toLowerCase()) ||
          v.profileName.toLowerCase().includes(search.toLowerCase()) ||
          v.vendorName.toLowerCase().includes(search.toLowerCase()),
      )
    : data.vouchers;

  const grandTotal  = data.summary.reduce((s, r) => s + r.amount, 0);
  const grandCount  = data.summary.reduce((s, r) => s + r.count,  0);
  const activeSummary = data.summary.filter((s) => s.count > 0);

  const summaryRows = activeSummary.map((s, i) => `<tr>
    <td>${i + 1}</td><td>${s.vendorName}</td>
    <td style="text-align:center">${s.count}</td>
    <td style="text-align:right">${fmtAmount(s.amount)}</td>
  </tr>`).join("");

  const detailRows = vouchers.map((v, i) => `<tr>
    <td>${i + 1}</td><td>${v.time ?? "—"}</td><td>${v.username}</td>
    <td>${v.profileName || "—"}</td><td>${v.vendorName}</td>
    <td style="text-align:right">${fmtAmount(v.amount)}</td>
  </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Suivi vendeurs — ${dateFr}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 8mm; }
  h2 { margin: 0 0 2px; font-size: 14px; }
  h3 { margin: 10px 0 4px; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  p  { margin: 0 0 8px; font-size: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #000; padding: 4px 6px; }
  th { background: #f0f0f0; font-weight: bold; text-align: left; }
  tfoot td { font-weight: bold; background: #e8e8e8; }
  .right { text-align: right; } .center { text-align: center; }
  @page { size: A4; margin: 10mm 7mm; }
  @media print { tr { page-break-inside: avoid; } thead { display: table-header-group; } tfoot { display: table-footer-group; } }
</style></head><body>
<h2>Suivi des ventes par vendeur</h2>
<p>Date : ${dateFr} &nbsp;|&nbsp; Généré le ${new Date().toLocaleString("fr-FR")}</p>
<h3>Résumé du jour — ${dateFr}</h3>
<table>
  <thead><tr><th>#</th><th>Vendeur</th><th class="center">Tickets vendus</th><th class="right">Total (FCFA)</th></tr></thead>
  <tbody>${summaryRows}</tbody>
  <tfoot><tr><td colspan="2" style="text-align:right">TOTAL JOUR</td><td class="center">${grandCount}</td><td class="right">${fmtAmount(grandTotal)}</td></tr></tfoot>
</table>
<h3>Détail (${vouchers.length} ticket${vouchers.length !== 1 ? "s" : ""})</h3>
<table>
  <thead><tr><th>#</th><th>Heure</th><th>Utilisateur</th><th>Profil</th><th>Vendeur</th><th class="right">Prix (FCFA)</th></tr></thead>
  <tbody>${detailRows}
    <tr><td colspan="4"></td><td style="text-align:right;font-weight:bold">TOTAL</td><td class="right" style="font-weight:bold">${fmtAmount(vouchers.reduce((s, v) => s + v.amount, 0))}</td></tr>
  </tbody>
</table>
<script>window.onload = function() { window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

/* ── Print helper: weekly report ─────────────────────────────── */
function openWeekPrintWindow(data: DailyTrackingResponse) {
  const weekLabel = weekLabelFromRange(data.weekStart, data.weekEnd);
  const ws = data.weekSummary ?? [];
  const totalCount  = ws.reduce((s, r) => s + r.count, 0);
  const totalAmount = ws.reduce((s, r) => s + r.amount, 0);
  const totalPaid   = ws.reduce((s, r) => s + (r.paidAmount ?? 0), 0);
  const totalReste  = ws.reduce((s, r) => s + (r.remainingAmount ?? 0), 0);
  const totalComm   = ws.reduce((s, r) => s + (r.commission ?? 0), 0);

  const rows = ws.map((s, i) => {
    const expected = Math.max(0, s.amount - (s.commission ?? 0));
    const paidPct = expected > 0 ? Math.round(((s.paidAmount ?? 0) / expected) * 100) + "%" : "—";
    const statusTxt = statusBadge(s.paymentStatus).text;
    const statusColor = s.paymentStatus === "full" ? "#065f46" : s.paymentStatus === "partial" ? "#92400e" : "#991b1b";
    const statusBg    = s.paymentStatus === "full" ? "#d1fae5" : s.paymentStatus === "partial" ? "#fef3c7" : "#fee2e2";
    return `<tr>
      <td>${i + 1}</td>
      <td>${s.vendorName}</td>
      <td class="center">${s.count}</td>
      <td class="right">${fmtAmount(s.amount)}</td>
      <td class="right">${fmtAmount(s.paidAmount ?? 0)}</td>
      <td class="right">${fmtAmount(s.remainingAmount ?? 0)}</td>
      <td class="center">${paidPct}</td>
      <td class="right">${s.commission ? fmtAmount(s.commission) : "—"}</td>
      <td class="center"><span style="background:${statusBg};color:${statusColor};padding:2px 6px;border-radius:4px;font-size:9px;font-weight:bold">${statusTxt}</span></td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Rapport hebdomadaire vendeurs</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 6mm; }
  h2 { margin: 0 0 2px; font-size: 13px; }
  p  { margin: 0 0 8px; font-size: 9px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #ccc; padding: 3px 5px; }
  th { background: #f0f0f0; font-weight: bold; text-align: left; font-size: 9px; }
  tfoot td { font-weight: bold; background: #e8e8e8; }
  .right { text-align: right; } .center { text-align: center; }
  @page { size: A4 landscape; margin: 8mm; }
  @media print { tr { page-break-inside: avoid; } }
</style></head><body>
<h2>Rapport hebdomadaire — Suivi des vendeurs</h2>
<p>Semaine : ${weekLabel} &nbsp;|&nbsp; Généré le ${new Date().toLocaleString("fr-FR")}</p>
<table>
  <thead>
    <tr>
      <th style="width:24px">#</th>
      <th>Vendeur</th>
      <th class="center" style="width:60px">Vendu (nb)</th>
      <th class="right" style="width:90px">Vendu (FCFA)</th>
      <th class="right" style="width:90px">Versé (FCFA)</th>
      <th class="right" style="width:90px">Reste (FCFA)</th>
      <th class="center" style="width:50px">%</th>
      <th class="right" style="width:90px">Rémunération</th>
      <th class="center" style="width:110px">Statut</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="2" style="text-align:right">TOTAL SEMAINE</td>
      <td class="center">${totalCount}</td>
      <td class="right">${fmtAmount(totalAmount)}</td>
      <td class="right">${fmtAmount(totalPaid)}</td>
      <td class="right">${fmtAmount(totalReste)}</td>
      <td></td>
      <td class="right">${totalComm > 0 ? fmtAmount(totalComm) : "—"}</td>
      <td></td>
    </tr>
  </tfoot>
</table>
<script>window.onload = function() { window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

/* ── Canvas JPEG: daily ──────────────────────────────────────── */
function saveJpegDaily(data: DailyTrackingResponse, appliedDate: string, setSaving: (v: boolean) => void) {
  setSaving(true);
  try {
    const DPR = 2; const W = 580; const PAD = 20;
    const ROW_H = 28; const HEAD_H = 36; const BAND_H = 24;
    const C0 = PAD; const C1 = PAD + 28; const C2 = W - PAD - 140 - 80; const C3 = W - PAD;
    const dailySummary = (data.summary ?? []).filter(s => s.count > 0);
    const dateFr = fmtDateFr(appliedDate);
    const titleH = 60; const tableGap = 16;
    const dailyH = HEAD_H + BAND_H + dailySummary.length * ROW_H + ROW_H;
    const totalH = titleH + tableGap + dailyH + PAD;
    const canvas = document.createElement("canvas");
    canvas.width = W * DPR; canvas.height = totalH * DPR;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);
    const rect = (x: number, y: number, w: number, h: number, fill: string) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
    const line = (x1: number, y1: number, x2: number, y2: number, color = "#e5e7eb") => { ctx.strokeStyle = color; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const txt = (str: string, x: number, y: number, { size = 11, bold = false, color = "#374151", align = "left" as CanvasTextAlign } = {}) => { ctx.font = `${bold ? "600" : "400"} ${size}px Inter,system-ui,sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(str, x, y); };
    rect(0, 0, W, totalH, "#ffffff");
    txt("Suivi des ventes — " + dateFr, PAD, 18, { size: 13, bold: true, color: "#111827" });
    txt("Généré le " + new Date().toLocaleString("fr-FR"), W - PAD, 30, { size: 9, color: "#9ca3af", align: "right" });
    const ticketsCenter = C2 + 40;
    let y = titleH + tableGap;
    rect(PAD, y, W - PAD * 2, HEAD_H, "#f9fafb");
    line(PAD, y, W - PAD, y, "#e5e7eb");
    txt("#", C0 + 4, y + HEAD_H / 2, { size: 10, color: "#6b7280" });
    txt("Vendeur", C1, y + HEAD_H / 2, { size: 10, color: "#6b7280" });
    txt("Tickets", ticketsCenter, y + HEAD_H / 2, { size: 10, color: "#6b7280", align: "center" });
    txt("FCFA", C3, y + HEAD_H / 2, { size: 10, color: "#6b7280", align: "right" });
    line(PAD, y + HEAD_H, W - PAD, y + HEAD_H, "#e5e7eb");
    y += HEAD_H;
    rect(PAD, y, W - PAD * 2, BAND_H, "#eff6ff");
    txt(`${dailySummary.length} vendeur${dailySummary.length !== 1 ? "s" : ""} — ${dateFr}`, C0 + 4, y + BAND_H / 2, { size: 10, bold: true, color: "#1d4ed8" });
    y += BAND_H;
    dailySummary.forEach((r, i) => {
      rect(PAD, y, W - PAD * 2, ROW_H, i % 2 === 0 ? "#ffffff" : "#f9fafb");
      txt(String(i + 1), C0 + 4, y + ROW_H / 2, { size: 10, color: "#9ca3af" });
      txt(r.vendorName, C1, y + ROW_H / 2, { size: 10, color: "#1f2937" });
      txt(String(r.count), ticketsCenter, y + ROW_H / 2, { size: 10, color: "#374151", align: "center" });
      txt(fmtAmount(r.amount), C3, y + ROW_H / 2, { size: 10, bold: true, color: "#1f2937", align: "right" });
      line(PAD, y + ROW_H, W - PAD, y + ROW_H, "#f3f4f6");
      y += ROW_H;
    });
    const grandCount = dailySummary.reduce((s, r) => s + r.count, 0);
    const grandAmount = dailySummary.reduce((s, r) => s + r.amount, 0);
    rect(PAD, y, W - PAD * 2, ROW_H, "#f3f4f6");
    txt("TOTAL JOUR", C1, y + ROW_H / 2, { size: 10, bold: true, color: "#6b7280" });
    txt(String(grandCount), ticketsCenter, y + ROW_H / 2, { size: 11, bold: true, color: "#1d4ed8", align: "center" });
    txt(fmtAmount(grandAmount) + " FCFA", C3, y + ROW_H / 2, { size: 11, bold: true, color: "#1d4ed8", align: "right" });
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1; ctx.strokeRect(PAD, titleH + tableGap, W - PAD * 2, y + ROW_H - (titleH + tableGap));
    const link = document.createElement("a");
    link.download = `suivi-vendeurs-${appliedDate}.jpeg`;
    link.href = canvas.toDataURL("image/jpeg", 0.93);
    link.click();
  } finally { setSaving(false); }
}

/* ── Canvas JPEG: weekly ─────────────────────────────────────── */
function saveJpegWeek(data: DailyTrackingResponse, setSaving: (v: boolean) => void) {
  setSaving(true);
  try {
    const ws = data.weekSummary ?? [];
    if (ws.length === 0) { setSaving(false); return; }

    const DPR = 2;
    const W = 820;
    const PAD = 18;
    const ROW_H = 30;
    const HEAD_H = 38;
    const BAND_H = 26;

    // columns: # | Vendeur | Vendu(nb) | Vendu(FCFA) | Versé | Reste | % | Rémunération | Statut
    const COL_NUM    = PAD;
    const COL_VENDOR = PAD + 26;
    const COL_QTY    = COL_VENDOR + 150;
    const COL_FCFA   = COL_QTY + 55;
    const COL_VERSE  = COL_FCFA + 90;
    const COL_RESTE  = COL_VERSE + 90;
    const COL_PCT    = COL_RESTE + 80;
    const COL_REMUN  = COL_PCT + 52;
    const COL_STATUT = COL_REMUN + 90;

    const weekLabel = weekLabelFromRange(data.weekStart, data.weekEnd);
    const titleH = 60;
    const tableGap = 12;
    const tableH = HEAD_H + BAND_H + ws.length * ROW_H + ROW_H;
    const totalH = titleH + tableGap + tableH + PAD;

    const canvas = document.createElement("canvas");
    canvas.width = W * DPR; canvas.height = totalH * DPR;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);

    const rect = (x: number, y: number, w: number, h: number, fill: string) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
    const line = (x1: number, y1: number, x2: number, y2: number, color = "#e5e7eb") => { ctx.strokeStyle = color; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const txt = (str: string, x: number, y: number, { size = 10, bold = false, color = "#374151", align = "left" as CanvasTextAlign } = {}) => { ctx.font = `${bold ? "600" : "400"} ${size}px Inter,system-ui,sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(str, x, y); };

    rect(0, 0, W, totalH, "#ffffff");
    txt("Rapport hebdomadaire — Vendeurs", PAD, 18, { size: 13, bold: true, color: "#111827" });
    txt("Semaine : " + weekLabel, PAD, 36, { size: 9, color: "#6b7280" });
    txt("Généré le " + new Date().toLocaleString("fr-FR"), W - PAD, 36, { size: 9, color: "#9ca3af", align: "right" });

    let y = titleH + tableGap;
    const right = W - PAD;

    rect(PAD, y, W - PAD * 2, HEAD_H, "#f9fafb");
    line(PAD, y, right, y, "#e5e7eb");
    txt("#",           COL_NUM + 4,    y + HEAD_H / 2, { size: 9, color: "#6b7280" });
    txt("Vendeur",     COL_VENDOR,     y + HEAD_H / 2, { size: 9, color: "#6b7280" });
    txt("Nb",          COL_QTY + 27,   y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "center" });
    txt("Vendu FCFA",  COL_FCFA + 85,  y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "right" });
    txt("Versé FCFA",  COL_VERSE + 85, y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "right" });
    txt("Reste FCFA",  COL_RESTE + 75, y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "right" });
    txt("%",           COL_PCT + 26,   y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "center" });
    txt("Rémunér.",    COL_REMUN + 85, y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "right" });
    txt("Statut",      COL_STATUT + 60,y + HEAD_H / 2, { size: 9, color: "#6b7280", align: "center" });
    line(PAD, y + HEAD_H, right, y + HEAD_H, "#e5e7eb");
    y += HEAD_H;

    rect(PAD, y, W - PAD * 2, BAND_H, "#eef2ff");
    txt("Semaine : " + weekLabel, COL_NUM + 4, y + BAND_H / 2, { size: 9, bold: true, color: "#4338ca" });
    y += BAND_H;

    for (let i = 0; i < ws.length; i++) {
      const s = ws[i];
      const expected = Math.max(0, s.amount - (s.commission ?? 0));
      const paidPct  = expected > 0 ? Math.round(((s.paidAmount ?? 0) / expected) * 100) + "%" : "—";
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      rect(PAD, y, W - PAD * 2, ROW_H, bg);
      txt(String(i + 1),                COL_NUM + 4,    y + ROW_H / 2, { size: 9, color: "#9ca3af" });
      txt(s.vendorName,                 COL_VENDOR,     y + ROW_H / 2, { size: 9, color: "#1f2937" });
      txt(String(s.count),              COL_QTY + 27,   y + ROW_H / 2, { size: 9, color: "#374151", align: "center" });
      txt(fmtAmount(s.amount),          COL_FCFA + 85,  y + ROW_H / 2, { size: 9, bold: true, color: "#1f2937", align: "right" });
      txt(fmtAmount(s.paidAmount ?? 0), COL_VERSE + 85, y + ROW_H / 2, { size: 9, color: "#374151", align: "right" });
      txt(fmtAmount(s.remainingAmount ?? 0), COL_RESTE + 75, y + ROW_H / 2, { size: 9, color: s.remainingAmount ? "#b91c1c" : "#374151", align: "right" });
      txt(paidPct,                      COL_PCT + 26,   y + ROW_H / 2, { size: 9, color: "#374151", align: "center" });
      txt(s.commission ? fmtAmount(s.commission) : "—", COL_REMUN + 85, y + ROW_H / 2, { size: 9, color: "#374151", align: "right" });

      const statusColor = s.paymentStatus === "full" ? "#065f46" : s.paymentStatus === "partial" ? "#92400e" : "#991b1b";
      const statusBg2   = s.paymentStatus === "full" ? "#d1fae5" : s.paymentStatus === "partial" ? "#fef3c7" : "#fee2e2";
      const statusTxt   = statusBadge(s.paymentStatus).text;
      const sW = 100; const sX = COL_STATUT + 10; const sY = y + ROW_H / 2;
      rect(sX, sY - 9, sW, 18, statusBg2);
      ctx.strokeStyle = statusColor + "44"; ctx.lineWidth = 0.5; ctx.strokeRect(sX, sY - 9, sW, 18);
      txt(statusTxt, sX + sW / 2, sY, { size: 8, bold: true, color: statusColor, align: "center" });

      line(PAD, y + ROW_H, right, y + ROW_H, "#f3f4f6");
      y += ROW_H;
    }

    const totalCount  = ws.reduce((s, r) => s + r.count, 0);
    const totalAmount = ws.reduce((s, r) => s + r.amount, 0);
    const totalPaid   = ws.reduce((s, r) => s + (r.paidAmount ?? 0), 0);
    const totalReste  = ws.reduce((s, r) => s + (r.remainingAmount ?? 0), 0);
    const totalComm   = ws.reduce((s, r) => s + (r.commission ?? 0), 0);

    rect(PAD, y, W - PAD * 2, ROW_H, "#f3f4f6");
    txt("TOTAL SEMAINE",             COL_VENDOR,     y + ROW_H / 2, { size: 9, bold: true, color: "#6b7280" });
    txt(String(totalCount),          COL_QTY + 27,   y + ROW_H / 2, { size: 10, bold: true, color: "#4338ca", align: "center" });
    txt(fmtAmount(totalAmount),      COL_FCFA + 85,  y + ROW_H / 2, { size: 10, bold: true, color: "#4338ca", align: "right" });
    txt(fmtAmount(totalPaid),        COL_VERSE + 85, y + ROW_H / 2, { size: 10, bold: true, color: "#4338ca", align: "right" });
    txt(fmtAmount(totalReste),       COL_RESTE + 75, y + ROW_H / 2, { size: 10, bold: true, color: totalReste > 0 ? "#b91c1c" : "#4338ca", align: "right" });
    txt(totalComm > 0 ? fmtAmount(totalComm) : "—", COL_REMUN + 85, y + ROW_H / 2, { size: 10, bold: true, color: "#4338ca", align: "right" });

    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.strokeRect(PAD, titleH + tableGap, W - PAD * 2, y + ROW_H - (titleH + tableGap));

    const link = document.createElement("a");
    link.download = `rapport-hebdo-${data.weekStart ?? "semaine"}.jpeg`;
    link.href = canvas.toDataURL("image/jpeg", 0.93);
    link.click();
  } finally { setSaving(false); }
}

/* ── Main page ───────────────────────────────────────────────── */
export default function VendorTracking() {
  const { selectedRouterId } = useRouterContext();

  const [date, setDate]       = useState<string>(yesterdayLocal());
  const [applied, setApplied] = useState<string>(yesterdayLocal());
  const [search, setSearch]   = useState("");
  const [saving, setSaving]   = useState(false);
  const [savingWeek, setSavingWeek] = useState(false);

  const summaryRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, error } = useQuery<DailyTrackingResponse>({
    queryKey: ["vendor-tracking", selectedRouterId, applied],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return { date: applied, summary: [], vouchers: [], weekSummary: [] };
      const params = new URLSearchParams({ date: applied, routerId: String(selectedRouterId) });
      const res = await fetch(`${BASE}/api/vendors/daily-tracking?${params}`, { signal });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedRouterId,
    staleTime: 60_000,
  });

  const prevWeekDate = prevWeekSundayLocal();
  const { data: prevWeekData, isLoading: prevWeekLoading } = useQuery<DailyTrackingResponse>({
    queryKey: ["vendor-tracking-prevweek", selectedRouterId, prevWeekDate],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return { date: prevWeekDate, summary: [], vouchers: [], weekSummary: [] };
      const params = new URLSearchParams({ date: prevWeekDate, routerId: String(selectedRouterId) });
      const res = await fetch(`${BASE}/api/vendors/daily-tracking?${params}`, { signal });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedRouterId,
    staleTime: 5 * 60_000,
  });

  const handleSaveDailyJpeg = useCallback(() => {
    if (!data) return;
    saveJpegDaily(data, applied, setSaving);
  }, [applied, data]);

  const handleSaveWeekJpeg = useCallback(() => {
    if (!prevWeekData) return;
    saveJpegWeek(prevWeekData, setSavingWeek);
  }, [prevWeekData]);

  const vouchers    = data?.vouchers    ?? [];
  const summary     = data?.summary     ?? [];
  const weekSummary = data?.weekSummary ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = search.toLowerCase();
    return vouchers.filter(
      (v) =>
        v.username.toLowerCase().includes(q) ||
        v.profileName.toLowerCase().includes(q) ||
        v.vendorName.toLowerCase().includes(q),
    );
  }, [vouchers, search]);

  const totalAmount      = useMemo(() => filtered.reduce((s, v) => s + v.amount, 0), [filtered]);
  const grandTotal       = useMemo(() => summary.reduce((s, r) => s + r.amount, 0), [summary]);
  const grandCount       = useMemo(() => summary.reduce((s, r) => s + r.count, 0), [summary]);
  const activeSummary    = useMemo(() => summary.filter((s) => s.count > 0), [summary]);
  const weekTotal_amount = useMemo(() => weekSummary.reduce((s, r) => s + r.amount, 0), [weekSummary]);
  const weekTotal_count  = useMemo(() => weekSummary.reduce((s, r) => s + r.count, 0), [weekSummary]);
  const weekTotal_paid   = useMemo(() => weekSummary.reduce((s, r) => s + (r.paidAmount ?? 0), 0), [weekSummary]);
  const weekTotal_reste  = useMemo(() => weekSummary.reduce((s, r) => s + (r.remainingAmount ?? 0), 0), [weekSummary]);
  const weekTotal_comm   = useMemo(() => weekSummary.reduce((s, r) => s + (r.commission ?? 0), 0), [weekSummary]);

  const prevWeekLabel = weekLabelFromRange(prevWeekData?.weekStart, prevWeekData?.weekEnd);
  const prevWeekSummary = prevWeekData?.weekSummary ?? [];
  const hasPrevWeekData = prevWeekSummary.length > 0;

  if (!selectedRouterId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Sélectionner un routeur pour voir le suivi des vendeurs.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dateLabelFr = applied ? fmtDateFr(applied) : "—";

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader className="pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-blue-500" />
              Suivi des vouchers par vendeur
            </CardTitle>
            <div className="flex items-center gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              {!isLoading && data && (
                <span className="text-xs text-gray-500 tabular-nums">
                  {grandCount} ticket{grandCount !== 1 ? "s" : ""} —{" "}
                  <span className="font-semibold text-gray-700">{fmtAmount(grandTotal)} FCFA</span>
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Date</span>
              <div className="relative flex items-center">
                <CalendarDays className="absolute left-2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  max={yesterdayLocal()}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 pl-7 pr-2 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setApplied(date); setSearch(""); }}>
              <Search className="h-3.5 w-3.5" /> Filtrer
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => { const y = yesterdayLocal(); setDate(y); setApplied(y); setSearch(""); }}>
              <RotateCcw className="h-3.5 w-3.5" /> Hier
            </Button>

            <div className="ml-auto flex flex-wrap gap-2">
              {/* Daily JPEG */}
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!data || grandCount === 0 || saving} onClick={handleSaveDailyJpeg} title="Enregistrer résumé journalier en image">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}
              </Button>
              {/* Daily print */}
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!data || grandCount === 0} onClick={() => data && openPrintWindow(data, search)}>
                <Printer className="h-3.5 w-3.5" /> Imprimer
              </Button>
              {/* Hebdo JPEG */}
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                disabled={!hasPrevWeekData || savingWeek || prevWeekLoading}
                onClick={handleSaveWeekJpeg}
                title={`Enregistrer rapport semaine précédente en image${prevWeekLabel !== "Semaine" ? " — " + prevWeekLabel : ""}`}
              >
                {savingWeek ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}
                JPEG Hebdo
              </Button>
              {/* Hebdo print */}
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                disabled={!hasPrevWeekData || prevWeekLoading}
                onClick={() => prevWeekData && openWeekPrintWindow(prevWeekData)}
                title={`Imprimer rapport semaine précédente${prevWeekLabel !== "Semaine" ? " — " + prevWeekLabel : ""}`}
              >
                <CalendarRange className="h-3.5 w-3.5" /> Imprimer Hebdo
              </Button>
            </div>
          </div>

          {hasPrevWeekData && (
            <p className="text-[10px] text-indigo-500">
              Rapport hebdo : semaine précédente ({prevWeekLabel})
            </p>
          )}

          {/* Search */}
          <Input
            placeholder="Rechercher vendeur, utilisateur, profil…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs max-w-xs"
          />

          {/* Error */}
          {isError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {(error as Error)?.message ?? "Erreur de chargement"}
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Chargement…</span>
            </div>
          )}

          {/* ── Capture zone ─────────────────────────────────── */}
          <div ref={summaryRef} className="space-y-3 bg-white rounded-xl p-3">

            {/* Daily summary table */}
            {!isLoading && activeSummary.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-10">#</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Vendeur</th>
                      <th className="px-3 py-2 text-center text-gray-500 font-medium w-28">Tickets vendus</th>
                      <th className="px-3 py-2 text-right text-gray-500 font-medium w-36">Total (FCFA)</th>
                    </tr>
                    <tr className="bg-blue-50 border-b border-blue-100">
                      <th colSpan={4} className="px-3 py-1.5 text-left text-blue-700 font-medium text-xs">
                        {activeSummary.length} vendeur{activeSummary.length !== 1 ? "s" : ""} — {dateLabelFr}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSummary.map((s, i) => (
                      <tr key={s.vendorId ?? "none"} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{s.vendorName}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-gray-700">{s.count}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">{fmtAmount(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={2} className="px-3 py-2 text-xs text-gray-500 font-medium text-right">Total</td>
                      <td className="px-3 py-2 text-center text-sm font-bold text-blue-700 tabular-nums">{grandCount}</td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-blue-700 tabular-nums">{fmtAmount(grandTotal)} FCFA</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* ── Weekly summary table (semaine de la date filtrée) ── */}
            {!isLoading && weekSummary.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-indigo-100">
                <table className="w-full text-xs border-collapse min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-2 py-2 text-left text-gray-500 font-medium w-8">#</th>
                      <th className="px-2 py-2 text-left text-gray-500 font-medium">Vendeur</th>
                      <th className="px-2 py-2 text-center text-gray-500 font-medium w-14">Vendu</th>
                      <th className="px-2 py-2 text-right text-gray-500 font-medium w-24">Montant</th>
                      <th className="px-2 py-2 text-right text-gray-500 font-medium w-24">Versé</th>
                      <th className="px-2 py-2 text-right text-gray-500 font-medium w-24">Reste</th>
                      <th className="px-2 py-2 text-center text-gray-500 font-medium w-12">%</th>
                      <th className="px-2 py-2 text-right text-gray-500 font-medium w-24">Rémunér.</th>
                      <th className="px-2 py-2 text-center text-gray-500 font-medium w-32">Statut</th>
                    </tr>
                    <tr className="bg-indigo-50 border-b border-indigo-100">
                      <th colSpan={9} className="px-3 py-1.5 text-left text-indigo-700 font-medium text-xs">
                        Semaine — {weekLabelFromRange(data?.weekStart, data?.weekEnd)}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekSummary.map((s, i) => {
                      const expected = Math.max(0, s.amount - (s.commission ?? 0));
                      const badge = statusBadge(s.paymentStatus);
                      const rowBg = s.paymentStatus === "full" ? "bg-emerald-50/40" : s.paymentStatus === "partial" ? "bg-amber-50/40" : "bg-red-50/30";
                      return (
                        <tr key={`week-${s.vendorId ?? "none"}`} className={`border-b border-gray-50 transition-colors ${rowBg}`}>
                          <td className="px-2 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                          <td className="px-2 py-2 font-medium text-gray-800">{s.vendorName}</td>
                          <td className="px-2 py-2 text-center tabular-nums text-gray-700 font-semibold">{s.count}</td>
                          <td className="px-2 py-2 text-right font-semibold text-gray-800 tabular-nums">{fmtAmount(s.amount)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-700">{fmtAmount(s.paidAmount ?? 0)}</td>
                          <td className={`px-2 py-2 text-right tabular-nums font-semibold ${(s.remainingAmount ?? 0) > 0 ? "text-red-600" : "text-gray-400"}`}>
                            {fmtAmount(s.remainingAmount ?? 0)}
                          </td>
                          <td className="px-2 py-2 text-center tabular-nums text-gray-600">{pct(s.paidAmount ?? 0, expected)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                            {(s.commission ?? 0) > 0 ? fmtAmount(s.commission!) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${badge.cls}`}>
                              {badge.icon && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
                              {badge.text}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                      <td colSpan={2} className="px-2 py-2 text-xs text-gray-500 text-right">Total semaine</td>
                      <td className="px-2 py-2 text-center text-indigo-700 tabular-nums">{weekTotal_count}</td>
                      <td className="px-2 py-2 text-right text-indigo-700 tabular-nums">{fmtAmount(weekTotal_amount)}</td>
                      <td className="px-2 py-2 text-right text-indigo-700 tabular-nums">{fmtAmount(weekTotal_paid)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${weekTotal_reste > 0 ? "text-red-700" : "text-indigo-700"}`}>{fmtAmount(weekTotal_reste)}</td>
                      <td />
                      <td className="px-2 py-2 text-right text-indigo-700 tabular-nums">{weekTotal_comm > 0 ? fmtAmount(weekTotal_comm) : "—"}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

          </div>{/* end capture zone */}

          {/* Detail table */}
          {!isLoading && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-10">#</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">Heure</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Utilisateur</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Profil</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Vendeur</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Prix (FCFA)</th>
                  </tr>
                  <tr className="bg-emerald-50 border-b border-emerald-100">
                    <th colSpan={4} className="px-3 py-1.5 text-left text-emerald-700 font-medium text-xs">
                      {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
                    </th>
                    <th colSpan={2} className="px-3 py-1.5 text-right text-emerald-700 font-bold text-xs">
                      Total : {fmtAmount(totalAmount)} FCFA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                        {vouchers.length === 0
                          ? "Aucune vente enregistrée pour cette date"
                          : "Aucun résultat pour cette recherche"}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((v, i) => (
                      <tr key={v.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                        <td className="px-3 py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-600">{v.time ?? "—"}</td>
                        <td className="px-3 py-1.5 font-mono font-semibold text-gray-800">{v.username}</td>
                        <td className="px-3 py-1.5 text-gray-600">{v.profileName || "—"}</td>
                        <td className="px-3 py-1.5 text-gray-600">{v.vendorName}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-800 tabular-nums">
                          {v.amount > 0 ? fmtAmount(v.amount) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
