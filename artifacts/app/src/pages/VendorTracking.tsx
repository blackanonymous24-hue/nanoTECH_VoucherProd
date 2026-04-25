import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAllPaymentQueries } from "@/lib/invalidatePayments";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Printer, Search, RotateCcw, Users, Loader2, AlertCircle,
  CalendarDays, ImageDown, AlertTriangle, CalendarRange,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Per-vendor color palette (deterministic by vendorId) ─── */
const VENDOR_PALETTE = [
  { light: "#eff6ff", border: "#93c5fd", mid: "#dbeafe", dark: "#1d4ed8" }, // blue
  { light: "#f0fdf4", border: "#86efac", mid: "#dcfce7", dark: "#15803d" }, // green
  { light: "#fdf4ff", border: "#d8b4fe", mid: "#f3e8ff", dark: "#7e22ce" }, // purple
  { light: "#fff7ed", border: "#fdba74", mid: "#ffedd5", dark: "#c2410c" }, // orange
  { light: "#f0fdfa", border: "#5eead4", mid: "#ccfbf1", dark: "#0f766e" }, // teal
  { light: "#fefce8", border: "#fde047", mid: "#fef9c3", dark: "#a16207" }, // yellow
  { light: "#fdf2f8", border: "#f9a8d4", mid: "#fce7f3", dark: "#be185d" }, // pink
  { light: "#ecfeff", border: "#67e8f9", mid: "#cffafe", dark: "#0e7490" }, // cyan
  { light: "#f5f3ff", border: "#c4b5fd", mid: "#ede9fe", dark: "#6d28d9" }, // violet
  { light: "#fff1f2", border: "#fda4af", mid: "#ffe4e6", dark: "#be123c" }, // rose
] as const;
function vpal(vendorId: number | null) {
  return VENDOR_PALETTE[(vendorId ?? 0) % VENDOR_PALETTE.length];
}

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
  paidAmount?: number;        // total paid (weekly + daily)
  weeklyPaid?: number;        // lump-sum weekly payments only
  dailyPaid?: number;         // daily payments only
  weeklyExpected?: number;    // amount - commission - dailyPaid
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

interface DailyArrearEntry {
  date: string;
  salesAmount: number;
  paidAmount: number;
  remaining: number;
  payments: { id: number; amount: number }[];
}

interface DailyArrearsResponse {
  arrears: Record<string, DailyArrearEntry[]>;
  vendorInfo?: Record<string, { name: string }>;
}

/** Consolidated arrears: when >3 daily arrears, merge all but the 2 most recent into one line dated the most recent of the merged days. */
type ConsolidatableArrearEntry = DailyArrearEntry & { __underlying?: DailyArrearEntry[] };
function consolidateArrears(entries: DailyArrearEntry[]): ConsolidatableArrearEntry[] {
  // Always return ascending (oldest first, most recent last)
  const asc = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (asc.length <= 3) return asc;
  const older = asc.slice(0, asc.length - 2);
  const recent = asc.slice(asc.length - 2);
  const merged: ConsolidatableArrearEntry = {
    date: older[older.length - 1].date,
    salesAmount: older.reduce((s, e) => s + e.salesAmount, 0),
    paidAmount:  older.reduce((s, e) => s + e.paidAmount,  0),
    remaining:   older.reduce((s, e) => s + e.remaining,   0),
    payments:    older.flatMap((e) => e.payments),
    __underlying: older,
  };
  return [merged, ...recent];
}

/** Returns YYYY-MM-DD of Monday of the week containing the given iso date (UTC) */
function mondayOfDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
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
function openPrintWindow(data: DailyTrackingResponse, search: string, arrears?: DailyArrearsResponse) {
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

  // Build profile map per vendor from vouchers
  const profileMap = new Map<number | null, { profileName: string; count: number; amount: number }[]>();
  for (const v of data.vouchers ?? []) {
    if (!profileMap.has(v.vendorId)) profileMap.set(v.vendorId, []);
    const list = profileMap.get(v.vendorId)!;
    const ex = list.find(p => p.profileName === v.profileName);
    if (ex) { ex.count += 1; ex.amount += v.amount; }
    else list.push({ profileName: v.profileName, count: 1, amount: v.amount });
  }
  for (const list of profileMap.values()) list.sort((a, b) => b.amount - a.amount);

  const vendorCards = activeSummary.map((s) => {
    const pal = vpal(s.vendorId);
    const profiles = profileMap.get(s.vendorId) ?? [];
    const arr = (arrears?.arrears[String(s.vendorId)] ?? []).filter(a => a.remaining > 0);
    const arrTotal = arr.reduce((sum, a) => sum + a.remaining, 0);
    const totalDu = s.amount + arrTotal;
    const profileRows = profiles.map(p => `
      <tr><td>${p.profileName}</td><td class="center">${p.count}</td><td class="right">${fmtAmount(p.amount)}</td></tr>`).join("");
    const arrearsSection = arr.length > 0 ? `
  <div class="arr-header">
    <span>Arriérés</span><span>${fmtAmount(arrTotal)} FCFA</span>
  </div>
  <table class="arr-table">
    <tbody>${arr.map(a => `<tr><td>${fmtDateFr(a.date)}</td><td class="right">${fmtAmount(a.remaining)} FCFA</td></tr>`).join("")}</tbody>
  </table>
  <div class="total-du">
    <span>Total dû (vendu + arriéré)</span><span>${fmtAmount(totalDu)} FCFA</span>
  </div>` : "";
    const hasArr = arr.length > 0;
    const borderColor = hasArr ? "#fdba74" : pal.border;
    return `<div class="vcard" style="border-color:${borderColor}">
  <div class="vcard-header" style="background:${pal.light};border-color:${pal.border}">
    <span class="vname" style="color:${pal.dark}">${s.vendorName}</span>
    <span class="vamount" style="color:${pal.dark}">${fmtAmount(s.amount)} FCFA</span>
  </div>
  <table>
    <thead><tr style="background:${pal.light}88"><th>Forfait</th><th class="center">Tkt</th><th class="right">Montant (FCFA)</th></tr></thead>
    <tbody>${profileRows}</tbody>
    <tfoot><tr style="background:${pal.mid};color:${pal.dark}"><td>Total vendu</td><td class="center">${s.count}</td><td class="right">${fmtAmount(s.amount)}</td></tr></tfoot>
  </table>${arrearsSection}
</div>`;
  }).join("");

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
  h3 { margin: 10px 0 4px; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 2px; color: #1e40af; }
  p  { margin: 0 0 8px; font-size: 10px; color: #555; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .vcard { border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .vcard-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: #eff6ff; border-bottom: 1px solid #bfdbfe; }
  .vname { font-weight: bold; font-size: 10px; color: #1e40af; }
  .vamount { font-weight: bold; font-size: 10px; color: #1d4ed8; }
  .vcard table { width: 100%; border-collapse: collapse; }
  .vcard th, .vcard td { padding: 3px 6px; font-size: 9px; border-bottom: 1px solid #f3f4f6; }
  .vcard th { background: #f9fafb; font-weight: 600; color: #6b7280; text-align: left; }
  .vcard tfoot td { background: #eff6ff; font-weight: bold; color: #1d4ed8; border-top: 1px solid #bfdbfe; border-bottom: none; }
  .vcard tr:last-child td { border-bottom: none; }
  .vcard-arr { border-color: #fca5a5; }
  .arr-header { display: flex; justify-content: space-between; padding: 3px 6px; background: #fef2f2; border-top: 1px solid #fca5a5; font-size: 8px; font-weight: bold; color: #b91c1c; }
  .arr-table { width: 100%; border-collapse: collapse; }
  .arr-table td { padding: 2px 6px; font-size: 8px; color: #ef4444; border-bottom: 1px solid #fee2e2; }
  .arr-table tr:last-child td { border-bottom: none; }
  .total-du { display: flex; justify-content: space-between; padding: 4px 6px; background: #1e3a8a; color: #ffffff; font-size: 9px; font-weight: bold; border-top: 2px solid #1e3a8a; }
  .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .detail-table th, .detail-table td { border: 1px solid #d1d5db; padding: 3px 5px; font-size: 9px; }
  .detail-table th { background: #f0f0f0; font-weight: bold; text-align: left; }
  .right { text-align: right; } .center { text-align: center; }
  @page { size: A4; margin: 0; }
  @media print { .vcard, tr { break-inside: avoid; } thead { display: table-header-group; } }
</style></head><body>
<h2>Suivi des ventes par vendeur</h2>
<p>Date : ${dateFr} &nbsp;|&nbsp; ${grandCount} ticket${grandCount !== 1 ? "s" : ""} &nbsp;|&nbsp; ${fmtAmount(grandTotal)} FCFA &nbsp;|&nbsp; Généré le ${new Date().toLocaleString("fr-FR")}</p>
<h3>Résumé de la vente du ${dateFr}</h3>
<div class="grid">${vendorCards}</div>
<h3>Détail (${vouchers.length} ticket${vouchers.length !== 1 ? "s" : ""})</h3>
<table class="detail-table">
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

/* ── Print helper: weekly report — un bloc par vendeur ──────── */
function openWeekPrintWindow(data: DailyTrackingResponse) {
  const weekLabel = weekLabelFromRange(data.weekStart, data.weekEnd);
  const ws = [...(data.weekSummary ?? [])].sort((a, b) => b.amount - a.amount);
  const totalAmount = ws.reduce((s, r) => s + r.amount, 0);
  const totalPaid   = ws.reduce((s, r) => s + (r.paidAmount ?? 0), 0);
  const totalReste  = ws.reduce((s, r) => s + (r.remainingAmount ?? 0), 0);
  const totalComm   = ws.reduce((s, r) => s + (r.commission ?? 0), 0);

  const vendorCards = ws.map((s) => {
    const badge = statusBadge(s.paymentStatus);
    const sColor = s.paymentStatus === "full" ? "#065f46" : s.paymentStatus === "partial" ? "#92400e" : "#991b1b";
    const sBg    = s.paymentStatus === "full" ? "#d1fae5" : s.paymentStatus === "partial" ? "#fef3c7" : "#fee2e2";
    const sBorder= s.paymentStatus === "full" ? "#6ee7b7" : s.paymentStatus === "partial" ? "#fcd34d" : "#fca5a5";
    const commRate = (s.commissionRate ?? 0);
    const resteColor = (s.remainingAmount ?? 0) > 0 ? "#991b1b" : "inherit";
    const statusIcon = s.paymentStatus === "none"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="${sColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;display:inline-block"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="${sColor}"/></svg>`
      : s.paymentStatus === "full"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="${sColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;display:inline-block"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
      : "";
    return `<div class="vcard">
  <div class="vcard-header">
    <span class="vname">${s.vendorName}</span>
    <span class="vstatus" style="background:${sBg};color:${sColor};border:1px solid ${sBorder}">${statusIcon}${badge.text}</span>
  </div>
  <table>
    <tr><td>Montant vendu</td><td class="val">${fmtAmount(s.amount)} FCFA</td></tr>
    <tr><td>Versé</td><td class="val">${fmtAmount(s.paidAmount ?? 0)} FCFA</td></tr>
    <tr><td>Reste à verser</td><td class="val" style="color:${resteColor};font-weight:bold">${fmtAmount(s.remainingAmount ?? 0)} FCFA</td></tr>
    <tr><td>Commission</td><td class="val">${commRate > 0 ? commRate + "%" : "—"}</td></tr>
    <tr><td>Rémunération</td><td class="val">${(s.commission ?? 0) > 0 ? fmtAmount(s.commission!) + " FCFA" : "—"}</td></tr>
  </table>
</div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Rapport hebdomadaire vendeurs</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 6mm; }
  h2 { margin: 0 0 3px; font-size: 13px; }
  .subtitle { margin: 0 0 10px; font-size: 9px; color: #555; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .vcard { border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .vcard-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; }
  .vname { font-weight: bold; font-size: 10px; color: #111; }
  .vstatus { font-size: 8px; font-weight: bold; padding: 2px 6px; border-radius: 10px; }
  .vcard table { width: 100%; border-collapse: collapse; }
  .vcard td { padding: 3px 8px; border-bottom: 1px solid #f3f4f6; font-size: 9px; }
  .vcard tr:last-child td { border-bottom: none; }
  .val { text-align: right; font-weight: 600; color: #1f2937; }
  .totals { margin-top: 10px; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .totals-header { padding: 4px 8px; background: #e0e7ff; font-weight: bold; font-size: 10px; color: #3730a3; border-bottom: 1px solid #c7d2fe; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 3px 8px; font-size: 9px; border-bottom: 1px solid #f3f4f6; }
  .totals tr:last-child td { border-bottom: none; }
  .tval { text-align: right; font-weight: bold; color: #3730a3; }
  @page { size: A4; margin: 0; }
  @media print { .vcard, .totals { break-inside: avoid; } }
</style></head><body>
<h2>Rapport hebdomadaire — Suivi des vendeurs</h2>
<p class="subtitle">Semaine : ${weekLabel} &nbsp;|&nbsp; Généré le ${new Date().toLocaleString("fr-FR")}</p>
<div class="grid">${vendorCards}</div>
<div class="totals">
  <div class="totals-header">Totaux de la semaine</div>
  <table>
    <tr><td>Montant total vendu</td><td class="tval">${fmtAmount(totalAmount)} FCFA</td></tr>
    <tr><td>Total versé</td><td class="tval">${fmtAmount(totalPaid)} FCFA</td></tr>
    <tr><td>Total reste</td><td class="tval" style="color:${totalReste > 0 ? "#991b1b" : "#3730a3"}">${fmtAmount(totalReste)} FCFA</td></tr>
  </table>
</div>
<script>window.onload = function() { window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

/* ── Canvas JPEG: daily ──────────────────────────────────────── */
function saveJpegDaily(data: DailyTrackingResponse, appliedDate: string, setSaving: (v: boolean) => void, arrears?: DailyArrearsResponse) {
  setSaving(true);
  try {
    const DPR = 2; const W = 430; const PAD = 16;
    const TITLE_H = 52; const CARD_GAP = 8;
    const CARD_HDR_H = 28; const COL_HDR_H = 18; const ROW_H = 20; const TOT_ROW_H = 24;
    const ARR_HDR_H = 20; const ARR_ROW_H = 18; const GRAND_ROW_H = 26; const FOOTER_H = 32;

    const dailySummary = (data.summary ?? []).filter(s => s.count > 0);
    const dateFr = fmtDateFr(appliedDate);

    // Build profile map from vouchers
    const profileMap = new Map<number | null, { profileName: string; count: number; amount: number }[]>();
    for (const v of data.vouchers ?? []) {
      if (!profileMap.has(v.vendorId)) profileMap.set(v.vendorId, []);
      const list = profileMap.get(v.vendorId)!;
      const ex = list.find(p => p.profileName === v.profileName);
      if (ex) { ex.count += 1; ex.amount += v.amount; }
      else list.push({ profileName: v.profileName, count: 1, amount: v.amount });
    }
    for (const list of profileMap.values()) list.sort((a, b) => b.amount - a.amount);

    const vendorArrears = (vendorId: number | null) =>
      (arrears?.arrears[String(vendorId)] ?? []).filter(a => a.remaining > 0);

    const cardH = (vendorId: number | null) => {
      const n = (profileMap.get(vendorId) ?? []).length;
      const arr = vendorArrears(vendorId);
      const arrH = arr.length > 0 ? ARR_HDR_H + arr.length * ARR_ROW_H + GRAND_ROW_H : 0;
      return CARD_HDR_H + COL_HDR_H + n * ROW_H + TOT_ROW_H + arrH;
    };
    const grandCount  = dailySummary.reduce((s, r) => s + r.count, 0);
    const grandAmount = dailySummary.reduce((s, r) => s + r.amount, 0);
    let totalH = TITLE_H;
    for (const s of dailySummary) totalH += cardH(s.vendorId) + CARD_GAP;
    totalH += FOOTER_H + PAD;

    const canvas = document.createElement("canvas");
    canvas.width = W * DPR; canvas.height = totalH * DPR;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);

    const rf = (x: number, y: number, w: number, h: number, fill: string, rad: number | number[] = 0) => {
      ctx.fillStyle = fill;
      if (rad) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.fill(); }
      else ctx.fillRect(x, y, w, h);
    };
    const ln = (x1: number, y1: number, x2: number, y2: number, c = "#e5e7eb") => {
      ctx.strokeStyle = c; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const t = (str: string, x: number, y: number, { size = 10, bold = false, color = "#374151", align = "left" as CanvasTextAlign } = {}) => {
      ctx.font = `${bold ? "600" : "400"} ${size}px Inter,system-ui,sans-serif`;
      ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(str, x, y);
    };

    rf(0, 0, W, totalH, "#f8fafc");
    t("Résumé de la vente du " + dateFr, PAD, 18, { size: 12, bold: true, color: "#111827" });
    t("Généré le " + new Date().toLocaleString("fr-FR"), W - PAD, 32, { size: 8, color: "#9ca3af", align: "right" });

    const CW = W - PAD * 2;
    const C_PROF = PAD + 10;
    const C_TKT  = W - PAD - 110;
    const C_AMT  = W - PAD - 10;

    let y = TITLE_H;
    dailySummary.forEach((s) => {
      const pal = vpal(s.vendorId);
      const profiles = profileMap.get(s.vendorId) ?? [];
      const arr = vendorArrears(s.vendorId);
      const ch = cardH(s.vendorId);
      rf(PAD, y, CW, ch, "#ffffff", 6);
      ctx.strokeStyle = arr.length > 0 ? "#fdba74" : pal.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(PAD, y, CW, ch, 6); ctx.stroke();

      // Header
      rf(PAD, y, CW, CARD_HDR_H, pal.light, [6, 6, 0, 0]);
      t(s.vendorName, PAD + 10, y + CARD_HDR_H / 2, { size: 10, bold: true, color: pal.dark });
      t(fmtAmount(s.amount) + " FCFA", C_AMT, y + CARD_HDR_H / 2, { size: 10, bold: true, color: pal.dark, align: "right" });
      ln(PAD, y + CARD_HDR_H, PAD + CW, y + CARD_HDR_H, pal.border);

      // Column headers
      const hy = y + CARD_HDR_H;
      rf(PAD, hy, CW, COL_HDR_H, pal.light + "55");
      t("Forfait", C_PROF, hy + COL_HDR_H / 2, { size: 8, color: "#9ca3af" });
      t("Tkt", C_TKT, hy + COL_HDR_H / 2, { size: 8, color: "#9ca3af", align: "center" });
      t("Montant", C_AMT, hy + COL_HDR_H / 2, { size: 8, color: "#9ca3af", align: "right" });
      ln(PAD, hy + COL_HDR_H, PAD + CW, hy + COL_HDR_H, "#f3f4f6");

      // Profile rows
      let ry = hy + COL_HDR_H;
      profiles.forEach((p, pi) => {
        rf(PAD, ry, CW, ROW_H, pi % 2 === 0 ? "#ffffff" : "#f9fafb");
        t(p.profileName, C_PROF, ry + ROW_H / 2, { size: 9, color: "#374151" });
        t(String(p.count), C_TKT, ry + ROW_H / 2, { size: 9, color: "#374151", align: "center" });
        t(fmtAmount(p.amount) + " FCFA", C_AMT, ry + ROW_H / 2, { size: 9, color: "#374151", align: "right" });
        ln(PAD, ry + ROW_H, PAD + CW, ry + ROW_H, "#f3f4f6");
        ry += ROW_H;
      });

      // Total row
      rf(PAD, ry, CW, TOT_ROW_H, pal.mid);
      t("Total", C_PROF, ry + TOT_ROW_H / 2, { size: 9, bold: true, color: pal.dark });
      t(String(s.count), C_TKT, ry + TOT_ROW_H / 2, { size: 10, bold: true, color: pal.dark, align: "center" });
      t(fmtAmount(s.amount) + " FCFA", C_AMT, ry + TOT_ROW_H / 2, { size: 10, bold: true, color: pal.dark, align: "right" });
      ry += TOT_ROW_H;

      // Arriérés rows
      if (arr.length > 0) {
        const arrTotal = arr.reduce((sum, a) => sum + a.remaining, 0);
        const totalDu = s.amount + arrTotal;
        rf(PAD, ry, CW, ARR_HDR_H, "#fef2f2");
        ln(PAD, ry, PAD + CW, ry, "#fca5a5");
        t("Arriérés", C_PROF, ry + ARR_HDR_H / 2, { size: 8, bold: true, color: "#b91c1c" });
        t(fmtAmount(arrTotal) + " FCFA", C_AMT, ry + ARR_HDR_H / 2, { size: 9, bold: true, color: "#b91c1c", align: "right" });
        ry += ARR_HDR_H;
        arr.forEach((a, ai) => {
          rf(PAD, ry, CW, ARR_ROW_H, ai % 2 === 0 ? "#fff7f7" : "#fef2f2");
          t(fmtDateFr(a.date), C_PROF, ry + ARR_ROW_H / 2, { size: 8, color: "#ef4444" });
          t(fmtAmount(a.remaining) + " FCFA", C_AMT, ry + ARR_ROW_H / 2, { size: 8, bold: true, color: "#b91c1c", align: "right" });
          ln(PAD, ry + ARR_ROW_H, PAD + CW, ry + ARR_ROW_H, "#fee2e2");
          ry += ARR_ROW_H;
        });
        // Total dû row
        rf(PAD, ry, CW, GRAND_ROW_H, "#1e3a8a", [0, 0, 6, 6]);
        t("Total dû (vendu + arriéré)", C_PROF, ry + GRAND_ROW_H / 2, { size: 8, bold: true, color: "#bfdbfe" });
        t(fmtAmount(totalDu) + " FCFA", C_AMT, ry + GRAND_ROW_H / 2, { size: 11, bold: true, color: "#ffffff", align: "right" });
        ry += GRAND_ROW_H;
      }

      y += ch + CARD_GAP;
    });

    // Footer total bar
    rf(PAD, y, CW, FOOTER_H, "#1e3a8a", 6);
    t("TOTAL", PAD + 10, y + FOOTER_H / 2, { size: 10, bold: true, color: "#ffffff" });
    t(String(grandCount) + " ticket" + (grandCount !== 1 ? "s" : ""), W / 2, y + FOOTER_H / 2, { size: 9, bold: true, color: "#93c5fd", align: "center" });
    t(fmtAmount(grandAmount) + " FCFA", C_AMT, y + FOOTER_H / 2, { size: 11, bold: true, color: "#ffffff", align: "right" });

    const link = document.createElement("a");
    link.download = `suivi-vendeurs-${appliedDate}.jpeg`;
    link.href = canvas.toDataURL("image/jpeg", 0.93);
    link.click();
  } finally { setSaving(false); }
}

/* ── Canvas JPEG: weekly — grille de cartes par vendeur ─────── */
function saveJpegWeek(data: DailyTrackingResponse, setSaving: (v: boolean) => void) {
  setSaving(true);
  try {
    const ws = [...(data.weekSummary ?? [])].sort((a, b) => b.amount - a.amount);
    if (ws.length === 0) { setSaving(false); return; }

    const DPR = 2;
    const PAD = 16;
    const COLS = 2;
    const CARD_GAP = 10;
    const CARD_W_RAW = 350;
    const W = PAD * 2 + COLS * CARD_W_RAW + (COLS - 1) * CARD_GAP;
    const CARD_H = 140; // per card height
    const ROW_COUNT = Math.ceil(ws.length / COLS);
    const TITLE_H = 58;
    const TOTAL_SECTION_H = 90;
    const totalH = TITLE_H + ROW_COUNT * (CARD_H + CARD_GAP) + CARD_GAP + TOTAL_SECTION_H + PAD;

    const canvas = document.createElement("canvas");
    canvas.width = W * DPR; canvas.height = totalH * DPR;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);

    const r = (x: number, y: number, w: number, h: number, fill: string, radius = 0) => {
      ctx.fillStyle = fill;
      if (radius > 0) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }
    };
    const ln = (x1: number, y1: number, x2: number, y2: number, color = "#e5e7eb", w = 0.5) => {
      ctx.strokeStyle = color; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const t = (str: string, x: number, y: number, { size = 10, bold = false, color = "#374151", align = "left" as CanvasTextAlign } = {}) => {
      ctx.font = `${bold ? "600" : "400"} ${size}px Inter,system-ui,sans-serif`;
      ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
      ctx.fillText(str, x, y);
    };

    const weekLabel = weekLabelFromRange(data.weekStart, data.weekEnd);

    // Background
    r(0, 0, W, totalH, "#ffffff");

    // Title
    t("Rapport hebdomadaire — Vendeurs", PAD, 18, { size: 13, bold: true, color: "#111827" });
    t("Semaine : " + weekLabel, PAD, 36, { size: 9, color: "#6b7280" });
    t("Généré le " + new Date().toLocaleString("fr-FR"), W - PAD, 36, { size: 9, color: "#9ca3af", align: "right" });

    // Draw vendor cards
    ws.forEach((s, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = PAD + col * (CARD_W_RAW + CARD_GAP);
      const cy = TITLE_H + row * (CARD_H + CARD_GAP);
      const cw = CARD_W_RAW;

      const sColor = s.paymentStatus === "full" ? "#065f46" : s.paymentStatus === "partial" ? "#92400e" : "#991b1b";
      const sBg    = s.paymentStatus === "full" ? "#d1fae5" : s.paymentStatus === "partial" ? "#fef3c7" : "#fee2e2";
      const sBorder= s.paymentStatus === "full" ? "#6ee7b7" : s.paymentStatus === "partial" ? "#fcd34d" : "#fca5a5";
      const sTxt   = (s.paymentStatus === "none" ? "⚠ " : s.paymentStatus === "full" ? "✓ " : "") + statusBadge(s.paymentStatus).text;
      const commRate = (s.commissionRate ?? 0);

      // Card background + border
      r(cx, cy, cw, CARD_H, "#ffffff", 6);
      ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cx, cy, cw, CARD_H, 6); ctx.stroke();

      // Header bar
      r(cx, cy, cw, 28, "#f9fafb", 6);
      r(cx, cy + 14, cw, 14, "#f9fafb"); // flatten bottom of header
      ln(cx, cy + 28, cx + cw, cy + 28);
      t(s.vendorName, cx + 8, cy + 14, { size: 10, bold: true, color: "#111827" });

      // Status badge
      const badgeW = ctx.measureText(sTxt).width + 16;
      r(cx + cw - badgeW - 6, cy + 5, badgeW, 18, sBg, 8);
      ctx.strokeStyle = sBorder; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.roundRect(cx + cw - badgeW - 6, cy + 5, badgeW, 18, 8); ctx.stroke();
      t(sTxt, cx + cw - badgeW / 2 - 6, cy + 14, { size: 8, bold: true, color: sColor, align: "center" });

      // Rows
      const rows: [string, string, string?][] = [
        ["Montant vendu", fmtAmount(s.amount) + " FCFA"],
        ["Versé",         fmtAmount(s.paidAmount ?? 0) + " FCFA"],
        ["Reste à verser", fmtAmount(s.remainingAmount ?? 0) + " FCFA", (s.remainingAmount ?? 0) > 0 ? "#b91c1c" : "#6b7280"],
        ["Commission",    commRate > 0 ? commRate + "%" : "—"],
        ["Rémunération",  (s.commission ?? 0) > 0 ? fmtAmount(s.commission!) + " FCFA" : "—"],
      ];
      const rowH = (CARD_H - 28) / rows.length;
      rows.forEach(([label, val, valColor], ri) => {
        const ry = cy + 28 + ri * rowH;
        const bg = ri % 2 === 0 ? "#ffffff" : "#f9fafb";
        r(cx, ry, cw, rowH, bg);
        t(label, cx + 8, ry + rowH / 2, { size: 9, color: "#6b7280" });
        t(val, cx + cw - 8, ry + rowH / 2, { size: 9, bold: true, color: (valColor as string) ?? "#1f2937", align: "right" });
        if (ri < rows.length - 1) ln(cx + 8, ry + rowH, cx + cw - 8, ry + rowH, "#f3f4f6");
      });
    });

    // Totals section
    const totalAmount = ws.reduce((s, r2) => s + r2.amount, 0);
    const totalPaid   = ws.reduce((s, r2) => s + (r2.paidAmount ?? 0), 0);
    const totalReste  = ws.reduce((s, r2) => s + (r2.remainingAmount ?? 0), 0);
    const totalComm   = ws.reduce((s, r2) => s + (r2.commission ?? 0), 0);
    const ty = TITLE_H + ROW_COUNT * (CARD_H + CARD_GAP) + CARD_GAP;
    const tw = W - PAD * 2;

    r(PAD, ty, tw, 24, "#eef2ff", 6);
    r(PAD, ty + 12, tw, 12, "#eef2ff");
    ctx.strokeStyle = "#c7d2fe"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(PAD, ty, tw, TOTAL_SECTION_H - 10, 6); ctx.stroke();
    t("Totaux de la semaine", PAD + 10, ty + 12, { size: 10, bold: true, color: "#3730a3" });
    ln(PAD, ty + 24, PAD + tw, ty + 24, "#c7d2fe");

    const totRows: [string, string, string?][] = [
      ["Montant total vendu", fmtAmount(totalAmount) + " FCFA"],
      ["Total versé",         fmtAmount(totalPaid + totalComm) + " FCFA"],
      ["Total reste",         fmtAmount(totalReste) + " FCFA", totalReste > 0 ? "#b91c1c" : "#3730a3"],
    ];
    const totRowH = (TOTAL_SECTION_H - 34) / totRows.length;
    totRows.forEach(([label, val, vc], ri) => {
      const ry = ty + 24 + ri * totRowH;
      t(label, PAD + 10, ry + totRowH / 2, { size: 9, color: "#6b7280" });
      t(val, PAD + tw - 10, ry + totRowH / 2, { size: 9, bold: true, color: (vc as string) ?? "#3730a3", align: "right" });
    });

    const link = document.createElement("a");
    link.download = `rapport-hebdo-${data.weekStart ?? "semaine"}.jpeg`;
    link.href = canvas.toDataURL("image/jpeg", 0.93);
    link.click();
  } finally { setSaving(false); }
}

/* ── Main page ───────────────────────────────────────────────── */
export default function VendorTracking() {
  const { selectedRouterId } = useRouterContext();

  const queryClient = useQueryClient();

  const [date, setDate]       = useState<string>(yesterdayLocal());
  const [applied, setApplied] = useState<string>(yesterdayLocal());
  const [search, setSearch]   = useState("");
  const [saving, setSaving]   = useState(false);
  const [savingWeek, setSavingWeek] = useState(false);
  const [payingKey, setPayingKey]   = useState<string | null>(null); // "vendorId|date"
  const [payAmount, setPayAmount]   = useState<string>("");
  const [payLoading, setPayLoading] = useState(false);

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

  const { data: arrearsData } = useQuery<DailyArrearsResponse>({
    queryKey: ["vendor-daily-arrears", selectedRouterId, applied],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return { arrears: {} };
      const params = new URLSearchParams({ date: applied, routerId: String(selectedRouterId) });
      const res = await fetch(`${BASE}/api/vendors/daily-arrears?${params}`, { signal });
      if (!res.ok) return { arrears: {} };
      return res.json();
    },
    enabled: !!selectedRouterId,
    staleTime: 60_000,
  });

  const handleSaveDailyJpeg = useCallback(() => {
    if (!data) return;
    saveJpegDaily(data, applied, setSaving, arrearsData);
  }, [applied, data, arrearsData]);

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

  const submitDailyPayment = useCallback(async (vendorId: number | null, date: string, amount: number, underlying?: DailyArrearEntry[]) => {
    if (!vendorId || !selectedRouterId || amount <= 0) return;
    setPayLoading(true);
    try {
      // If consolidated entry: distribute payment across underlying days, oldest first
      if (underlying && underlying.length > 0) {
        const ordered = [...underlying].filter((e) => e.remaining > 0).sort((a, b) => a.date.localeCompare(b.date));
        let left = Math.round(amount);
        let applied = 0;
        let failure: string | null = null;
        for (const e of ordered) {
          if (left <= 0) break;
          const pay = Math.min(left, e.remaining);
          if (pay > 0) {
            const r = await fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ routerId: selectedRouterId, date: e.date, amount: pay }),
            });
            if (!r.ok) { failure = await r.text().catch(() => "Échec inconnu"); break; }
            applied += pay;
            left -= pay;
          }
        }
        // Always invalidate if any sub-write succeeded so UI reflects partial application
        if (applied > 0) await invalidateAllPaymentQueries(queryClient, selectedRouterId);
        if (failure) {
          window.alert(applied > 0
            ? `Versement partiellement appliqué : ${applied} FCFA enregistré, ${Math.round(amount) - applied} FCFA non appliqué (${failure})`
            : `Erreur : ${failure}`);
          return;
        }
      } else {
        const r = await fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routerId: selectedRouterId, date, amount: Math.round(amount) }),
        });
        if (!r.ok) {
          window.alert(`Erreur : ${await r.text().catch(() => "Échec inconnu")}`);
          return;
        }
        await invalidateAllPaymentQueries(queryClient, selectedRouterId);
      }
      setPayingKey(null);
      setPayAmount("");
    } finally {
      setPayLoading(false);
    }
  }, [selectedRouterId, applied, queryClient]);

  /** Solder en intégralité tous les arriérés passés (avant la semaine en cours) pour un vendeur */
  const solderPrevArrears = useCallback(async (vendorId: number | null, prevEntries: DailyArrearEntry[]) => {
    if (!vendorId || !selectedRouterId || prevEntries.length === 0) return;
    setPayLoading(true);
    try {
      await Promise.all(
        prevEntries
          .filter((e) => e.remaining > 0)
          .map((e) =>
            fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ routerId: selectedRouterId, date: e.date, amount: Math.round(e.remaining) }),
            })
          )
      );
      await invalidateAllPaymentQueries(queryClient, selectedRouterId);
    } finally {
      setPayLoading(false);
    }
  }, [selectedRouterId, queryClient]);

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
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!data || grandCount === 0} onClick={() => data && openPrintWindow(data, search, arrearsData)}>
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

            {/* ── Résumé d'hier — cartes par vendeur ── */}
            {!isLoading && activeSummary.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                    Résumé de la vente du {dateLabelFr}
                  </span>
                  <span className="text-[10px] text-gray-400 tabular-nums">
                    {grandCount} ticket{grandCount !== 1 ? "s" : ""} · {fmtAmount(grandTotal)} FCFA
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeSummary.map((s) => {
                    const allArrears = arrearsData?.arrears[String(s.vendorId)] ?? [];
                    const currentWeekStart = mondayOfDate(applied);
                    // Split arriérés: previous weeks vs current week
                    const prevArrears = allArrears.filter((a) => a.date < currentWeekStart);
                    const currentArrears = allArrears.filter((a) => a.date >= currentWeekStart);
                    const prevTotal = prevArrears.reduce((sum, a) => sum + a.remaining, 0);
                    const hasArrears = prevTotal > 0 || currentArrears.length > 0;
                    const pal = vpal(s.vendorId);
                    return (
                      <div
                        key={`day-${s.vendorId ?? "none"}`}
                        className="rounded-lg border overflow-hidden text-xs"
                        style={{ borderColor: hasArrears ? "#fdba74" : pal.border }}
                      >
                        {/* Card header */}
                        <div
                          className="flex items-center justify-between px-3 py-2 border-b"
                          style={{ backgroundColor: pal.light, borderColor: pal.border }}
                        >
                          <span className="font-semibold truncate mr-2" style={{ color: pal.dark }}>{s.vendorName}</span>
                          <span className="font-bold tabular-nums flex-shrink-0" style={{ color: pal.dark }}>
                            {fmtAmount(s.amount)} FCFA
                          </span>
                        </div>
                        {/* Arrears only (forfait breakdown + total row removed) */}
                        <table className="w-full border-collapse">
                          <tbody>
                            {/* ── Arriérés semaine(s) précédente(s) — ligne agrégée ── */}
                            {prevTotal > 0 && (
                              <tr className="border-t-2 border-red-300 bg-red-50">
                                <td colSpan={3} className="px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                                      <div className="min-w-0">
                                        <span className="text-xs font-semibold text-red-700">Arriérés sem. précédente</span>
                                        <span className="text-[10px] text-red-500 ml-1">({prevArrears.length} jour{prevArrears.length > 1 ? "s" : ""})</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <span className="text-xs font-bold text-red-700 tabular-nums">{fmtAmount(prevTotal)} FCFA</span>
                                      <button
                                        className="text-[10px] px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                                        disabled={payLoading}
                                        onClick={() => solderPrevArrears(s.vendorId, prevArrears)}
                                      >
                                        {payLoading ? "…" : "Solder tout"}
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {/* ── Arriérés semaine en cours — lignes individuelles (regroupées si ≥3) ── */}
                            {consolidateArrears(currentArrears).map((arr) => {
                              const pKey = `${s.vendorId}|${arr.date}`;
                              const isPaying = payingKey === pKey;
                              const underlying = arr.__underlying;
                              return (
                                <tr key={arr.date} className="border-t border-orange-200 bg-orange-50">
                                  <td colSpan={3} className="px-3 py-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex flex-col gap-0.5 min-w-0">
                                        <div className="flex items-center gap-1 text-orange-700">
                                          <AlertTriangle className="h-3 w-3 flex-shrink-0 text-orange-500" />
                                          <span className="text-xs font-medium">
                                            {underlying
                                              ? `Arriérés cumulés (${underlying.length} jours, dernier : ${fmtDateFr(arr.date)})`
                                              : `Arriéré du ${fmtDateFr(arr.date)}`}
                                          </span>
                                        </div>
                                        {arr.paidAmount > 0 && (
                                          <span className="text-[10px] text-gray-500 pl-4">
                                            Ventes: {fmtAmount(arr.salesAmount)} · Versé: {fmtAmount(arr.paidAmount)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                        <span className="text-xs font-bold text-orange-700 tabular-nums">{fmtAmount(arr.remaining)} FCFA</span>
                                        {!isPaying && (
                                          <button
                                            className="text-[10px] px-2 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                                            onClick={() => { setPayingKey(pKey); setPayAmount(String(arr.remaining)); }}
                                          >
                                            Verser
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {isPaying && (
                                      <div className="mt-2 flex items-center gap-1.5 pl-4">
                                        <Input
                                          type="number"
                                          min={1}
                                          max={arr.remaining}
                                          className="h-7 w-28 text-xs"
                                          value={payAmount}
                                          onChange={(e) => setPayAmount(e.target.value)}
                                          placeholder="Montant"
                                        />
                                        <span className="text-[10px] text-gray-500">FCFA</span>
                                        <button
                                          className="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                                          disabled={payLoading || !payAmount || Number(payAmount) <= 0}
                                          onClick={() => submitDailyPayment(s.vendorId, arr.date, Number(payAmount), underlying)}
                                        >
                                          {payLoading ? "…" : "Confirmer"}
                                        </button>
                                        <button
                                          className="text-[10px] px-2 py-0.5 rounded bg-gray-300 text-gray-700 hover:bg-gray-400 transition-colors"
                                          onClick={() => { setPayingKey(null); setPayAmount(""); }}
                                        >
                                          Annuler
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {/* ── Total dû (vendu + arriérés) ── */}
                            {hasArrears && (() => {
                              const allArrearsTotal = allArrears.reduce((sum, a) => sum + a.remaining, 0);
                              const totalDu = s.amount + allArrearsTotal;
                              return (
                                <tr className="border-t-2 border-blue-900 bg-blue-900">
                                  <td className="px-3 py-2 font-bold text-white text-xs">Total dû <span className="font-normal text-blue-300">(vendu + arriéré)</span></td>
                                  <td />
                                  <td className="px-3 py-2 text-right font-bold text-white text-sm tabular-nums">{fmtAmount(totalDu)} FCFA</td>
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Weekly summary — cartes par vendeur ── */}
            {!isLoading && weekSummary.length > 0 && (
              <div className="space-y-2">
                {/* Titre section */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                    Semaine — {weekLabelFromRange(data?.weekStart, data?.weekEnd)}
                  </span>
                  <span className="text-[10px] text-gray-400 tabular-nums">
                    {fmtAmount(weekTotal_amount)} FCFA total · {fmtAmount(weekTotal_paid)} versé
                  </span>
                </div>

                {/* Grille de cartes 2 colonnes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...weekSummary].sort((a, b) => b.amount - a.amount).map((s) => {
                    const badge = statusBadge(s.paymentStatus);
                    const commRate = s.commissionRate ?? 0;
                    const cardBorder = s.paymentStatus === "full"
                      ? "border-emerald-200"
                      : s.paymentStatus === "partial"
                      ? "border-amber-200"
                      : "border-red-200";

                    return (
                      <div key={`week-${s.vendorId ?? "none"}`} className={`rounded-lg border ${cardBorder} overflow-hidden text-xs`}>
                        {/* Card header */}
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <span className="font-semibold text-gray-800 truncate mr-2">{s.vendorName}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold flex-shrink-0 ${badge.cls}`}>
                            {badge.icon && <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />}
                            {badge.text}
                          </span>
                        </div>
                        {/* Card body */}
                        <table className="w-full border-collapse">
                          <tbody>
                            <tr className="border-b border-gray-50">
                              <td className="px-3 py-1.5 text-gray-500">Montant vendu</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-gray-800 tabular-nums">{fmtAmount(s.amount)} FCFA</td>
                            </tr>
                            {(s.dailyPaid ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-sky-50/40">
                                <td className="px-3 py-1.5 text-sky-700">Versé en journalier</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-sky-700 tabular-nums">{fmtAmount(s.dailyPaid!)} FCFA</td>
                              </tr>
                            )}
                            {(s.weeklyPaid ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-emerald-50/40">
                                <td className="px-3 py-1.5 text-emerald-700">Versé en hebdomadaire</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-emerald-700 tabular-nums">{fmtAmount(s.weeklyPaid!)} FCFA</td>
                              </tr>
                            )}
                            {s.dailyPaid === undefined && (s.paidAmount ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-gray-50/50">
                                <td className="px-3 py-1.5 text-gray-500">Versé</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtAmount(s.paidAmount ?? 0)} FCFA</td>
                              </tr>
                            )}
                            {(s.dailyPaid ?? 0) > 0 && (s.weeklyExpected ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-blue-50/40">
                                <td className="px-3 py-1.5 text-blue-700">Hebdo. à régler</td>
                                <td className="px-3 py-1.5 text-right font-bold text-blue-700 tabular-nums">{fmtAmount(s.weeklyExpected!)} FCFA</td>
                              </tr>
                            )}
                            <tr className="border-b border-gray-50">
                              <td className="px-3 py-1.5 text-gray-500">Reste à verser</td>
                              <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${(s.remainingAmount ?? 0) > 0 ? "text-red-600" : "text-gray-400"}`}>
                                {fmtAmount(s.remainingAmount ?? 0)} FCFA
                              </td>
                            </tr>
                            <tr className="border-b border-gray-50 bg-gray-50/50">
                              <td className="px-3 py-1.5 text-gray-500">Commission</td>
                              <td className="px-3 py-1.5 text-right font-medium text-gray-600 tabular-nums">
                                {commRate > 0 ? `${commRate}%` : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-3 py-1.5 text-gray-500">Rémunération</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-gray-700 tabular-nums">
                                {(s.commission ?? 0) > 0 ? `${fmtAmount(s.commission!)} FCFA` : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>

                {/* Totaux de la semaine */}
                <div className="rounded-lg border border-indigo-100 overflow-hidden text-xs">
                  <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 text-indigo-700 font-semibold text-[10px] uppercase tracking-wide">
                    Totaux de la semaine
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-gray-100">
                    <div className="px-3 py-2">
                      <p className="text-gray-400 text-[10px]">Vendu</p>
                      <p className="font-bold text-gray-800 tabular-nums">{fmtAmount(weekTotal_amount)} <span className="font-normal text-gray-400">FCFA</span></p>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-gray-400 text-[10px]">Versé</p>
                      <p className="font-bold text-indigo-700 tabular-nums">{fmtAmount(weekTotal_paid)} <span className="font-normal text-gray-400">FCFA</span></p>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-gray-400 text-[10px]">Reste</p>
                      <p className={`font-bold tabular-nums ${weekTotal_reste > 0 ? "text-red-600" : "text-gray-400"}`}>{fmtAmount(weekTotal_reste)} <span className="font-normal text-gray-400">FCFA</span></p>
                    </div>
                  </div>
                </div>
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
