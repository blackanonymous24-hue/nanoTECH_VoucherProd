import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAllPaymentQueries } from "@/lib/invalidatePayments";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Printer, Search, RotateCcw, Users, Loader2, AlertCircle,
  CalendarDays, ImageDown, AlertTriangle, CalendarRange, ChevronDown,
} from "lucide-react";
import { foldText } from "@/lib/text";
import { paidShownVersusWeekContext, splitDailyWeeklyPaidShown } from "@/lib/vendorWeekPaymentDisplay";
import {
  applyMaskedWeeksToDailyArrearsResponse,
  groupArrearsByCalendarWeek,
  mondayOfDateUtc,
  splitArrearsMergedAndRecentTail,
  sundayFromMondayUtc,
  weekArrearLabelWithFmt,
} from "@/lib/arrearsWeekGrouping";

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

/** Libellé singulier/pluriel selon le nombre de semaines antérieures avec reliquat (somme affichée = carryOverAmount). */
function carryOverWeekLabel(priorWeeksWithBalance: number): string {
  return priorWeeksWithBalance > 1 ? "Restes semaines antérieures" : "Reste semaine antérieure";
}

/** YYYY-MM-DD pour le jour civil local (évite le décalage UTC de `toISOString()`). */
function formatLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayLocal(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return formatLocalIsoDate(d);
}

function fmtDateFr(iso: string): string {
  const [y, m, day] = iso.split("-");
  return `${day} ${MONTH_NAMES_FR[parseInt(m, 10) - 1]} ${y}`;
}

/** Dernier dimanche (calendrier local), pour charger la semaine civile complète terminée juste avant la semaine en cours. */
function prevWeekSundayLocal(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysToLastSunday = day === 0 ? 7 : day;
  d.setDate(d.getDate() - daysToLastSunday);
  return formatLocalIsoDate(d);
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
  carryOverAmount?: number;   // unpaid net from previous weeks (somme des reliquats)
  carryOverWeekCount?: number; // nombre de semaines antérieures avec reliquat > 0
  totalToPay?: number;        // carryOver + current week net - paid in current week
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
  /** Lundis (YYYY-MM-DD) des semaines soldées — aligne l’affichage si cache partiel. */
  settledWeeks?: Record<string, string[]>;
}

function weekLabelFromRange(weekStart?: string, weekEnd?: string): string {
  if (!weekStart || !weekEnd) return "Semaine";
  return `${fmtDateFr(weekStart)} – ${fmtDateFr(weekEnd)}`;
}

function isoAddDaysUtc(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Net semaine courante après commission (aligné sur le résumé hebdo API). */
function weekExpectedNetFromSummary(s: VendorSummaryEntry): number {
  return Math.max(0, (s.amount ?? 0) - (s.commission ?? 0));
}

/**
 * Imputation des versements : d'abord sur l'arriéré des semaines antérieures, puis sur la semaine affichée.
 * Sert à afficher Montant à verser (semaine) et Total à verser à ce jour (= reliquat arriéré + montant semaine).
 */
function weekPaymentBreakdown(s: VendorSummaryEntry) {
  const co0 = Math.max(0, s.carryOverAmount ?? 0);
  const paid = Math.max(0, s.paidAmount ?? 0);
  const expectedNet = weekExpectedNetFromSummary(s);
  const paidTowardCarry = Math.min(paid, co0);
  const remainingCarry = Math.max(0, co0 - paidTowardCarry);
  const montantAVerser = Math.max(0, expectedNet - Math.max(0, paid - co0));
  const totalVerseCeJour = remainingCarry + montantAVerser;
  const totalToPay = s.totalToPay ?? s.remainingAmount ?? 0;
  return { co0, paid, expectedNet, remainingCarry, montantAVerser, totalVerseCeJour, totalToPay };
}

function mergeDailyArrearEntries(days: DailyArrearEntry[]): DailyArrearEntry & { __underlying: DailyArrearEntry[] } {
  const u = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = u[u.length - 1]!;
  return {
    date: last.date,
    salesAmount: u.reduce((s, e) => s + e.salesAmount, 0),
    paidAmount: u.reduce((s, e) => s + e.paidAmount, 0),
    remaining: u.reduce((s, e) => s + e.remaining, 0),
    payments: u.flatMap((e) => e.payments),
    __underlying: u,
  };
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

/** Carte vendeur pour impression / inclusion dans le rapport journalier (même logique que l’écran). */
function weekVendorCardHtml(s: VendorSummaryEntry, data: DailyTrackingResponse): string {
  const badge = statusBadge(s.paymentStatus);
  const sColor = s.paymentStatus === "full" ? "#065f46" : s.paymentStatus === "partial" ? "#92400e" : "#991b1b";
  const sBg = s.paymentStatus === "full" ? "#d1fae5" : s.paymentStatus === "partial" ? "#fef3c7" : "#fee2e2";
  const sBorder = s.paymentStatus === "full" ? "#6ee7b7" : s.paymentStatus === "partial" ? "#fcd34d" : "#fca5a5";
  const commRate = s.commissionRate ?? 0;
  const toPay = s.totalToPay ?? s.remainingAmount ?? 0;
  const resteColor = toPay > 0 ? "#991b1b" : "inherit";
  const bd = weekPaymentBreakdown(s);
  const prevMon = data.weekStart ? isoAddDaysUtc(data.weekStart, -7) : "";
  const arrearLabel =
    bd.co0 > 0 && prevMon
      ? `${weekArrearLabelWithFmt(prevMon, fmtDateFr)}${(s.carryOverWeekCount ?? 1) > 1 ? ` (${s.carryOverWeekCount} semaines)` : ""}`
      : bd.co0 > 0
        ? carryOverWeekLabel(s.carryOverWeekCount ?? 1)
        : "";
  const coRow =
    bd.co0 > 0
      ? `<tr><td>${arrearLabel}</td><td class="val" style="color:#991b1b;font-weight:700">${fmtAmount(bd.remainingCarry)} FCFA</td></tr>`
      : "";
  const midLabel = bd.co0 > 0 ? "Montant à verser" : "Total à verser";
  const midVal = bd.co0 > 0 ? bd.montantAVerser : toPay;
  const midColor = midVal > 0 ? "#991b1b" : "inherit";
  const formulaSub =
    prevMon && bd.co0 > 0
      ? `Arriéré (${fmtDateFr(prevMon)} – ${fmtDateFr(sundayFromMondayUtc(prevMon))}) + Montant à verser`
      : "Arriéré semaine antérieure + Montant à verser";
  const totalCeJourRow =
    bd.co0 > 0
      ? `<tr><td>Total à verser à ce jour<br/><span style="font-size:8px;font-weight:400;color:#6b7280">= ${formulaSub}</span></td><td class="val" style="color:${resteColor};font-weight:bold">${fmtAmount(bd.totalVerseCeJour)} FCFA</td></tr>`
      : "";
  const statusIcon =
    s.paymentStatus === "none"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="${sColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;display:inline-block"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="${sColor}"/></svg>`
      : s.paymentStatus === "full"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="${sColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;display:inline-block"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
        : "";
  return `<div class="vcard week-vcard">
  <div class="vcard-header week-vcard-h">
    <span class="vname">${s.vendorName}</span>
    <span class="vstatus" style="background:${sBg};color:${sColor};border:1px solid ${sBorder}">${statusIcon}${badge.text}</span>
  </div>
<table>
    <tr><td>Montant vendu</td><td class="val">${fmtAmount(s.amount)} FCFA</td></tr>
    ${coRow}
    <tr><td>Versé</td><td class="val">${fmtAmount(paidShownVersusWeekContext(s.paidAmount, s.amount, s.commission, s.carryOverAmount))} FCFA</td></tr>
    <tr><td>${midLabel}</td><td class="val" style="color:${midColor};font-weight:bold">${fmtAmount(midVal)} FCFA</td></tr>
    <tr><td>Commission</td><td class="val">${commRate > 0 ? commRate + "%" : "—"}</td></tr>
    <tr><td>Rémunération</td><td class="val">${(s.commission ?? 0) > 0 ? fmtAmount(s.commission!) + " FCFA" : "—"}</td></tr>
    ${totalCeJourRow}
</table>
</div>`;
}

function weekTotalsPrintHtml(totalAmount: number, totalPaid: number, totalReste: number): string {
  return `<div class="totals week-totals">
  <div class="totals-header">Totaux de la semaine</div>
<table>
    <tr><td>Montant total vendu</td><td class="tval">${fmtAmount(totalAmount)} FCFA</td></tr>
    <tr><td>Total versé</td><td class="tval">${fmtAmount(totalPaid)} FCFA</td></tr>
    <tr><td>Total à verser</td><td class="tval" style="color:${totalReste > 0 ? "#991b1b" : "#3730a3"}">${fmtAmount(totalReste)} FCFA</td></tr>
</table>
</div>`;
}

/** Bloc HTML résumé hebdo (cartes + totaux) pour le rapport journalier ou la page hebdo seule. */
function weekSummaryPrintBlockHtml(
  data: DailyTrackingResponse,
  opts?: { omitSectionHeading?: boolean },
): string {
  const ws = [...(data.weekSummary ?? [])].sort((a, b) => b.amount - a.amount);
  if (ws.length === 0) return "";
  const weekLabel = weekLabelFromRange(data.weekStart, data.weekEnd);
  const totalAmount = ws.reduce((s, r) => s + r.amount, 0);
  const totalPaid = ws.reduce((s, r) => s + paidShownVersusWeekContext(r.paidAmount, r.amount, r.commission, r.carryOverAmount), 0);
  const totalReste = ws.reduce((s, r) => s + (r.totalToPay ?? r.remainingAmount ?? 0), 0);
  const vendorCards = ws.map((s) => weekVendorCardHtml(s, data)).join("");
  const gridAndTotals = `
<div class="grid">${vendorCards}</div>
${weekTotalsPrintHtml(totalAmount, totalPaid, totalReste)}`;
  if (opts?.omitSectionHeading) return gridAndTotals;
  return `
<h3 class="week-block-h3">Semaine — ${weekLabel}</h3>
<p class="week-block-sub">${fmtAmount(totalAmount)} FCFA total · ${fmtAmount(totalPaid)} versé</p>
${gridAndTotals}`;
}

/* ── Print helper: daily ─────────────────────────────────────── */
function openPrintWindow(data: DailyTrackingResponse, search: string, arrears?: DailyArrearsResponse) {
  const dateFr = fmtDateFr(data.date);
  const q = foldText(search);
  const vouchers = search.trim()
    ? data.vouchers.filter(
        (v) =>
          foldText(v.username).includes(q) ||
          foldText(v.profileName).includes(q) ||
          foldText(v.vendorName).includes(q),
      )
    : data.vouchers;

  const grandTotal  = data.summary.reduce((s, r) => s + r.amount, 0);
  const grandCount  = data.summary.reduce((s, r) => s + r.count,  0);
  const activeSummary = data.summary.filter((s) => s.count > 0);

  const vendorCards = activeSummary.map((s) => {
    const pal = vpal(s.vendorId);
    const arr = (arrears?.arrears[String(s.vendorId)] ?? []).filter(a => a.remaining > 0);
    const arrTotal = arr.reduce((sum, a) => sum + a.remaining, 0);
    const totalDu = s.amount + arrTotal;
    const arrearsSection = arr.length > 0 ? `
  <table class="arr-table">
    <tbody>${arr.map(a => `<tr><td>${fmtDateFr(a.date)}</td><td class="right">${fmtAmount(a.remaining)} FCFA</td></tr>`).join("")}</tbody>
  </table>
  <div class="total-du">
    <span>Total à verser</span><span>${fmtAmount(totalDu)} FCFA</span>
  </div>` : "";
    const hasArr = arr.length > 0;
    const borderColor = hasArr ? "#fdba74" : pal.border;
    return `<div class="vcard" style="border-color:${borderColor}">
  <div class="vcard-header" style="background:${pal.light};border-color:${pal.border}">
    <span class="vname" style="color:${pal.dark}">${s.vendorName}</span>
    <span class="vamount" style="color:${pal.dark}">${fmtAmount(s.amount)} FCFA</span>
  </div>${arrearsSection}
</div>`;
  }).join("");

  const detailRows = vouchers.map((v, i) => `<tr>
    <td>${i + 1}</td><td>${v.time ?? "—"}</td><td>${v.username}</td>
    <td>${v.profileName || "—"}</td><td>${v.vendorName}</td>
        <td style="text-align:right">${fmtAmount(v.amount)}</td>
  </tr>`).join("");

  const weekBlock = weekSummaryPrintBlockHtml(data);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Suivi des ventes par vendeur — ${dateFr}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 8mm; }
  h2 { margin: 0 0 2px; font-size: 14px; }
  h3 { margin: 10px 0 4px; font-size: 12px; border-bottom: 1px solid #ccc; padding-bottom: 2px; color: #1e40af; }
  h3.week-block-h3 { margin: 14px 0 4px; font-size: 12px; border-bottom: 1px solid #c7d2fe; padding-bottom: 2px; color: #3730a3; }
  p  { margin: 0 0 8px; font-size: 10px; color: #555; }
  p.week-block-sub { margin: 0 0 8px; font-size: 9px; color: #6b7280; }
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
  .week-vcard .vcard-header.week-vcard-h { background: #f3f4f6; border-bottom: 1px solid #e5e7eb; }
  .week-vcard .vname { color: #111; }
  .week-vcard .vstatus { font-size: 8px; font-weight: bold; padding: 2px 6px; border-radius: 10px; }
  .week-vcard table { width: 100%; border-collapse: collapse; }
  .week-vcard td { padding: 3px 8px; border-bottom: 1px solid #f3f4f6; font-size: 9px; }
  .week-vcard .val { text-align: right; font-weight: 600; color: #1f2937; }
  .week-totals { margin-top: 10px; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .week-totals .totals-header { padding: 4px 8px; background: #e0e7ff; font-weight: bold; font-size: 10px; color: #3730a3; border-bottom: 1px solid #c7d2fe; }
  .week-totals table { width: 100%; border-collapse: collapse; }
  .week-totals td { padding: 3px 8px; font-size: 9px; border-bottom: 1px solid #f3f4f6; }
  .week-totals tr:last-child td { border-bottom: none; }
  .week-totals .tval { text-align: right; font-weight: bold; color: #3730a3; }
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
${weekBlock}
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
  const totalPaid = ws.reduce((s, r) => s + paidShownVersusWeekContext(r.paidAmount, r.amount, r.commission, r.carryOverAmount), 0);
  const block = weekSummaryPrintBlockHtml(data, { omitSectionHeading: true });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Rapport hebdomadaire — Suivi des ventes par vendeur</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 6mm; }
  h2 { margin: 0 0 3px; font-size: 13px; }
  h3.week-block-h3 { margin: 0 0 4px; font-size: 12px; border-bottom: 1px solid #c7d2fe; padding-bottom: 2px; color: #3730a3; }
  p.week-block-sub { margin: 0 0 8px; font-size: 9px; color: #6b7280; }
  .subtitle { margin: 0 0 10px; font-size: 9px; color: #555; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
  .vcard { border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .vcard-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; }
  .vname { font-weight: bold; font-size: 10px; color: #111; }
  .vstatus { font-size: 8px; font-weight: bold; padding: 2px 6px; border-radius: 10px; }
  .vcard table { width: 100%; border-collapse: collapse; }
  .vcard td { padding: 3px 8px; border-bottom: 1px solid #f3f4f6; font-size: 9px; }
  .vcard tr:last-child td { border-bottom: none; }
  .val { text-align: right; font-weight: 600; color: #1f2937; }
  .week-totals { margin-top: 10px; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .week-totals .totals-header { padding: 4px 8px; background: #e0e7ff; font-weight: bold; font-size: 10px; color: #3730a3; border-bottom: 1px solid #c7d2fe; }
  .week-totals table { width: 100%; border-collapse: collapse; }
  .week-totals td { padding: 3px 8px; font-size: 9px; border-bottom: 1px solid #f3f4f6; }
  .week-totals tr:last-child td { border-bottom: none; }
  .week-totals .tval { text-align: right; font-weight: bold; color: #3730a3; }
  @page { size: A4; margin: 0; }
  @media print { .vcard, .week-totals { break-inside: avoid; } }
</style></head><body>
<h2>Rapport hebdomadaire — Suivi des ventes par vendeur</h2>
<p class="subtitle">Semaine : ${weekLabel} &nbsp;|&nbsp; ${fmtAmount(totalAmount)} FCFA total · ${fmtAmount(totalPaid)} versé &nbsp;|&nbsp; Généré le ${new Date().toLocaleString("fr-FR")}</p>
${block || `<p class="subtitle">Aucun résumé hebdomadaire pour cette période.</p>`}
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
    const TITLE_H = 60; const CARD_GAP = 8;
    const CARD_HDR_H = 28;
    const ARR_HDR_H = 20; const ARR_ROW_H = 18; const GRAND_ROW_H = 26; const FOOTER_H = 32;

    const dailySummary = (data.summary ?? []).filter(s => s.count > 0);
    const dateFr = fmtDateFr(appliedDate);

    const vendorArrears = (vendorId: number | null) =>
      (arrears?.arrears[String(vendorId)] ?? []).filter(a => a.remaining > 0);

    const cardH = (vendorId: number | null) => {
      const arr = vendorArrears(vendorId);
      const arrH = arr.length > 0 ? arr.length * ARR_ROW_H + GRAND_ROW_H : 0;
      return CARD_HDR_H + arrH;
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
    t("Suivi des ventes par vendeur", PAD, 14, { size: 11, bold: true, color: "#111827" });
    t("Résumé du " + dateFr, PAD, 30, { size: 10, bold: true, color: "#1e40af" });
    t("Généré le " + new Date().toLocaleString("fr-FR"), W - PAD, 30, { size: 8, color: "#9ca3af", align: "right" });

    const CW = W - PAD * 2;
    const C_PROF = PAD + 10;
    const C_TKT  = W - PAD - 110;
    const C_AMT  = W - PAD - 10;

    let y = TITLE_H;
    dailySummary.forEach((s) => {
      const pal = vpal(s.vendorId);
      const arr = vendorArrears(s.vendorId);
      const ch = cardH(s.vendorId);
      rf(PAD, y, CW, ch, "#ffffff", 6);
      ctx.strokeStyle = arr.length > 0 ? "#fdba74" : pal.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(PAD, y, CW, ch, 6); ctx.stroke();

      // Header (vendor name + total amount only)
      rf(PAD, y, CW, CARD_HDR_H, pal.light, [6, 6, 0, 0]);
      t(s.vendorName, PAD + 10, y + CARD_HDR_H / 2, { size: 10, bold: true, color: pal.dark });
      t(fmtAmount(s.amount) + " FCFA", C_AMT, y + CARD_HDR_H / 2, { size: 10, bold: true, color: pal.dark, align: "right" });
      ln(PAD, y + CARD_HDR_H, PAD + CW, y + CARD_HDR_H, pal.border);

      let ry = y + CARD_HDR_H;

      // Arriérés rows (sum line removed)
      if (arr.length > 0) {
        const arrTotal = arr.reduce((sum, a) => sum + a.remaining, 0);
        const totalDu = s.amount + arrTotal;
        ln(PAD, ry, PAD + CW, ry, "#fca5a5");
        arr.forEach((a, ai) => {
          rf(PAD, ry, CW, ARR_ROW_H, ai % 2 === 0 ? "#fff7f7" : "#fef2f2");
          t(fmtDateFr(a.date), C_PROF, ry + ARR_ROW_H / 2, { size: 8, color: "#ef4444" });
          t(fmtAmount(a.remaining) + " FCFA", C_AMT, ry + ARR_ROW_H / 2, { size: 8, bold: true, color: "#b91c1c", align: "right" });
          ln(PAD, ry + ARR_ROW_H, PAD + CW, ry + ARR_ROW_H, "#fee2e2");
          ry += ARR_ROW_H;
        });
        // Total à verser row
        rf(PAD, ry, CW, GRAND_ROW_H, "#1e3a8a", [0, 0, 6, 6]);
        t("Total à verser", C_PROF, ry + GRAND_ROW_H / 2, { size: 8, bold: true, color: "#bfdbfe" });
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
    link.download = `suivi-ventes-${appliedDate}.jpeg`;
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
    t("Rapport hebdomadaire — Suivi des ventes", PAD, 18, { size: 12, bold: true, color: "#111827" });
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
      const bd = weekPaymentBreakdown(s);
      const prevMon = data.weekStart ? isoAddDaysUtc(data.weekStart, -7) : "";
      const arrearLabel =
        bd.co0 > 0 && prevMon
          ? `${weekArrearLabelWithFmt(prevMon, fmtDateFr)}${(s.carryOverWeekCount ?? 1) > 1 ? ` (${s.carryOverWeekCount}s.)` : ""}`
          : bd.co0 > 0
            ? carryOverWeekLabel(s.carryOverWeekCount ?? 1)
            : "";
      const midPay = bd.co0 > 0 ? bd.montantAVerser : (s.totalToPay ?? s.remainingAmount ?? 0);
      const rows: [string, string, string?][] = [
        ["Montant vendu", fmtAmount(s.amount) + " FCFA"],
        ...(bd.co0 > 0
          ? [[arrearLabel, fmtAmount(bd.remainingCarry) + " FCFA", "#991b1b"]] as [string, string, string?][]
          : []),
        ["Versé", fmtAmount(paidShownVersusWeekContext(s.paidAmount, s.amount, s.commission, s.carryOverAmount)) + " FCFA"],
        [bd.co0 > 0 ? "Montant à verser" : "Total à verser", fmtAmount(midPay) + " FCFA", midPay > 0 ? "#b91c1c" : "#6b7280"],
        ["Commission", commRate > 0 ? commRate + "%" : "—"],
        ["Rémunération", (s.commission ?? 0) > 0 ? fmtAmount(s.commission!) + " FCFA" : "—"],
        ...(bd.co0 > 0
          ? ([["Total à verser à ce jour", fmtAmount(bd.totalVerseCeJour) + " FCFA", bd.totalVerseCeJour > 0 ? "#b91c1c" : "#6b7280"]] as [string, string, string?][])
          : []),
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
    const totalPaid   = ws.reduce((s, r2) => s + paidShownVersusWeekContext(r2.paidAmount, r2.amount, r2.commission, r2.carryOverAmount), 0);
    const totalReste  = ws.reduce((s, r2) => s + (r2.totalToPay ?? r2.remainingAmount ?? 0), 0);
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
      ["Total versé",         fmtAmount(totalPaid) + " FCFA"],
      ["Total à verser",      fmtAmount(totalReste) + " FCFA", totalReste > 0 ? "#b91c1c" : "#3730a3"],
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

  // L'endpoint /vendors/daily-arrears utilise une fenêtre [date−31j ; date−1j].
  // On envoie `applied` directement pour que seuls les jours STRICTEMENT
  // antérieurs au jour consulté apparaissent en arriérés — le jour `applied`
  // est déjà affiché dans le résumé journalier, il ne doit pas figurer ici.
  const arrearsQueryDate = applied;
  const { data: arrearsData } = useQuery<DailyArrearsResponse>({
    queryKey: ["vendor-daily-arrears", selectedRouterId, arrearsQueryDate],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return { arrears: {} };
      const params = new URLSearchParams({ date: arrearsQueryDate, routerId: String(selectedRouterId) });
      const res = await fetch(`${BASE}/api/vendors/daily-arrears?${params}`, { signal });
      if (!res.ok) return { arrears: {} };
      return res.json();
    },
    enabled: !!selectedRouterId,
    staleTime: 60_000,
  });

  const arrearsDataEffective = useMemo(
    () => applyMaskedWeeksToDailyArrearsResponse(arrearsData),
    [arrearsData],
  );

  const handleSaveDailyJpeg = useCallback(() => {
    if (!data) return;
    saveJpegDaily(data, applied, setSaving, arrearsDataEffective);
  }, [applied, data, arrearsDataEffective]);

  const handleSaveWeekJpeg = useCallback(() => {
    if (!prevWeekData) return;
    saveJpegWeek(prevWeekData, setSavingWeek);
  }, [prevWeekData]);

  const vouchers    = data?.vouchers    ?? [];
  const summary     = data?.summary     ?? [];
  const weekSummary = data?.weekSummary ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = foldText(search);
    return vouchers.filter(
      (v) =>
        foldText(v.username).includes(q) ||
        foldText(v.profileName).includes(q) ||
        foldText(v.vendorName).includes(q),
    );
  }, [vouchers, search]);

  const totalAmount      = useMemo(() => filtered.reduce((s, v) => s + v.amount, 0), [filtered]);
  const grandTotal       = useMemo(() => summary.reduce((s, r) => s + r.amount, 0), [summary]);
  const grandCount       = useMemo(() => summary.reduce((s, r) => s + r.count, 0), [summary]);
  const activeSummary    = useMemo(() => summary.filter((s) => s.count > 0), [summary]);

  const weekTotal_amount = useMemo(() => weekSummary.reduce((s, r) => s + r.amount, 0), [weekSummary]);
  const weekTotal_count  = useMemo(() => weekSummary.reduce((s, r) => s + r.count, 0), [weekSummary]);
  const weekTotal_paid   = useMemo(
    () => weekSummary.reduce((s, r) => s + paidShownVersusWeekContext(r.paidAmount, r.amount, r.commission, r.carryOverAmount), 0),
    [weekSummary],
  );
  const weekTotal_reste  = useMemo(() => weekSummary.reduce((s, r) => s + (r.totalToPay ?? r.remainingAmount ?? 0), 0), [weekSummary]);
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
              Suivi des ventes par vendeur
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
                  onChange={(e) => {
                    const v = e.target.value;
                    setDate(v);
                    setApplied(v);
                    setSearch("");
                  }}
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
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!data || grandCount === 0} onClick={() => data && openPrintWindow(data, search, arrearsDataEffective)}>
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
            <div className="py-6 space-y-2">
              <Skeleton className="h-6 w-44 mx-auto" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-10/12" />
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
                    const allArrears = arrearsDataEffective?.arrears[String(s.vendorId)] ?? [];
                    const currentWeekStart = mondayOfDateUtc(applied);
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
                        {/* Arriérés : semaines passées repliées ; semaine du jour consulté : cumul en Collapse si ≥4 jours + 2 derniers visibles */}
                        <div className="space-y-2 p-2 bg-white/60">
                            {prevTotal > 0 &&
                              groupArrearsByCalendarWeek(prevArrears).map((grp) => {
                                const weekRows = grp.__underlying ?? [grp];
                                const weekRem = grp.remaining;
                                return (
                                  <Collapsible key={grp.__weekMonday} defaultOpen={false} className="group">
                                    <CollapsibleTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex w-full items-center justify-between gap-2 rounded-lg border-2 border-red-300 bg-red-50/95 px-3 py-2.5 text-left shadow-sm hover:bg-red-100/80"
                                      >
                                        <div className="flex min-w-0 flex-1 items-start gap-1.5">
                                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                                          <div className="min-w-0">
                                            <span className="text-xs font-semibold text-red-800 break-words">
                                              {weekArrearLabelWithFmt(grp.__weekMonday, fmtDateFr)}
                                            </span>
                                            <span className="text-[10px] text-red-600">
                                              {" "}
                                              ({weekRows.length} jour{weekRows.length > 1 ? "s" : ""})
                                            </span>
                                          </div>
                                        </div>
                                        <div className="flex flex-shrink-0 items-center gap-2">
                                          <span className="text-xs font-bold tabular-nums text-red-800">{fmtAmount(weekRem)} FCFA</span>
                                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-red-700/70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                                        </div>
                                      </button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                                      <div className="space-y-2 border-t border-red-200/80 bg-red-50/80 px-3 py-2">
                                        <ul className="space-y-1.5">
                                          {[...weekRows]
                                            .sort((a, b) => a.date.localeCompare(b.date))
                                            .map((day) => (
                                              <li
                                                key={day.date}
                                                className="flex items-start justify-between gap-2 rounded-md border border-red-100/90 bg-white/90 px-2.5 py-1.5 text-[11px]"
                                              >
                                                <div className="min-w-0 flex-1">
                                                  <span className="font-medium text-red-900">Arriéré du {fmtDateFr(day.date)}</span>
                                                  {day.paidAmount > 0 && (
                                                    <span className="mt-0.5 block text-[10px] text-gray-600">
                                                      Ventes: {fmtAmount(day.salesAmount)} · Versé:{" "}
                                                      {fmtAmount(
                                                        paidShownVersusWeekContext(day.paidAmount, day.salesAmount, 0, 0),
                                                      )}
                                                    </span>
                                                  )}
                                                </div>
                                                <span className="flex-shrink-0 font-bold tabular-nums text-red-800">
                                                  {fmtAmount(day.remaining)} FCFA
                                                </span>
                                              </li>
                                            ))}
                                        </ul>
                                        <div className="border-t border-red-200/70 pt-2">
                                          <button
                                            type="button"
                                            className="text-[10px] rounded bg-red-600 px-2 py-0.5 text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                                            disabled={payLoading}
                                            onClick={() => void solderPrevArrears(s.vendorId, weekRows)}
                                          >
                                            {payLoading ? "…" : "Solder tout"}
                                          </button>
                                        </div>
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })}
                            {(() => {
                              const ascCur = [...currentArrears].sort((a, b) => a.date.localeCompare(b.date));
                              const { merged: mergedHead, recent: recentTail } = splitArrearsMergedAndRecentTail(ascCur, 4);
                              const mergedEntry = mergedHead && mergedHead.length > 0 ? mergeDailyArrearEntries(mergedHead) : null;
                              const cumulPKey = `${s.vendorId}|cumul-${currentWeekStart}`;
                              const isPayingCumul = payingKey === cumulPKey;
                              return (
                                <>
                                  {mergedEntry && (
                                    <Collapsible defaultOpen={false} className="group">
                                      <CollapsibleTrigger asChild>
                                        <button
                                          type="button"
                                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-orange-400 bg-orange-50/95 px-3 py-2.5 text-left shadow-sm hover:bg-orange-100/80"
                                        >
                                          <div className="flex min-w-0 flex-1 items-start gap-1 text-orange-900">
                                            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-orange-500" />
                                            <span className="text-xs font-medium break-words">
                                              Arriérés cumulés ({mergedHead!.length} jour{mergedHead!.length > 1 ? "s" : ""}, du{" "}
                                              {fmtDateFr(mergedHead![0]!.date)} au {fmtDateFr(mergedHead![mergedHead!.length - 1]!.date)})
                                            </span>
                                          </div>
                                          <div className="flex flex-shrink-0 items-center gap-2">
                                            <span className="text-xs font-bold tabular-nums text-orange-900">{fmtAmount(mergedEntry.remaining)} FCFA</span>
                                            <ChevronDown className="h-4 w-4 flex-shrink-0 text-orange-700/70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                                          </div>
                                        </button>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                                        <div className="space-y-2 border-t border-orange-200/80 bg-orange-50/90 px-3 py-2">
                                          <ul className="space-y-1.5">
                                            {[...mergedHead!]
                                              .sort((a, b) => a.date.localeCompare(b.date))
                                              .map((day) => (
                                                <li
                                                  key={day.date}
                                                  className="flex items-start justify-between gap-2 rounded-md border border-orange-200/90 bg-white/95 px-2.5 py-1.5 text-[11px]"
                                                >
                                                  <div className="min-w-0 flex-1">
                                                    <span className="font-medium text-orange-900">Arriéré du {fmtDateFr(day.date)}</span>
                                                    {day.paidAmount > 0 && (
                                                      <span className="mt-0.5 block text-[10px] text-gray-600">
                                                        Ventes: {fmtAmount(day.salesAmount)} · Versé:{" "}
                                                        {fmtAmount(
                                                          paidShownVersusWeekContext(day.paidAmount, day.salesAmount, 0, 0),
                                                        )}
                                                      </span>
                                                    )}
                                                  </div>
                                                  <span className="flex-shrink-0 font-bold tabular-nums text-orange-900">
                                                    {fmtAmount(day.remaining)} FCFA
                                                  </span>
                                                </li>
                                              ))}
                                          </ul>
                                          {!isPayingCumul && (
                                            <button
                                              type="button"
                                              className="text-[10px] rounded bg-orange-600 px-2 py-0.5 text-white hover:bg-orange-700"
                                              onClick={() => {
                                                setPayingKey(cumulPKey);
                                                setPayAmount(String(mergedEntry.remaining));
                                              }}
                                            >
                                              Verser
                                            </button>
                                          )}
                                          {isPayingCumul && (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <Input
                                                type="number"
                                                min={1}
                                                max={mergedEntry.remaining}
                                                className="h-7 w-28 text-xs"
                                                value={payAmount}
                                                onChange={(e) => setPayAmount(e.target.value)}
                                                placeholder="Montant"
                                              />
                                              <span className="text-[10px] text-gray-500">FCFA</span>
                                              <button
                                                type="button"
                                                className="text-[10px] rounded bg-green-600 px-2 py-0.5 text-white hover:bg-green-700 disabled:opacity-50"
                                                disabled={payLoading || !payAmount || Number(payAmount) <= 0}
                                                onClick={() =>
                                                  void submitDailyPayment(
                                                    s.vendorId,
                                                    mergedEntry.date,
                                                    Number(payAmount),
                                                    mergedEntry.__underlying,
                                                  )
                                                }
                                              >
                                                {payLoading ? "…" : "Confirmer"}
                                              </button>
                                              <button
                                                type="button"
                                                className="text-[10px] rounded bg-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-400"
                                                onClick={() => {
                                                  setPayingKey(null);
                                                  setPayAmount("");
                                                }}
                                              >
                                                Annuler
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  )}
                                  {recentTail.map((day) => {
                                    const pKey = `${s.vendorId}|${day.date}`;
                                    const isPaying = payingKey === pKey;
                                    return (
                                      <div key={day.date} className="rounded-lg border border-orange-300 bg-orange-50/95 px-3 py-2.5 shadow-sm">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <div className="flex items-start gap-1 text-orange-800">
                                              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-orange-500" />
                                              <span className="text-xs font-medium break-words">Arriéré du {fmtDateFr(day.date)}</span>
                                            </div>
                                            {day.paidAmount > 0 && (
                                              <span className="pl-4 text-[10px] text-gray-600 sm:pl-7">
                                                Ventes: {fmtAmount(day.salesAmount)} · Versé:{" "}
                                                {fmtAmount(paidShownVersusWeekContext(day.paidAmount, day.salesAmount, 0, 0))}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex flex-col items-stretch gap-1 sm:items-end sm:flex-shrink-0">
                                            <span className="text-xs font-bold tabular-nums text-orange-800 sm:text-right">{fmtAmount(day.remaining)} FCFA</span>
                                            {!isPaying && (
                                              <button
                                                type="button"
                                                className="self-start rounded bg-orange-600 px-2 py-0.5 text-[10px] text-white hover:bg-orange-700 sm:self-end"
                                                onClick={() => {
                                                  setPayingKey(pKey);
                                                  setPayAmount(String(day.remaining));
                                                }}
                                              >
                                                Verser
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        {isPaying && (
                                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-orange-200/80 pt-2 pl-1 sm:pl-4">
                                            <Input
                                              type="number"
                                              min={1}
                                              max={day.remaining}
                                              className="h-7 w-28 text-xs"
                                              value={payAmount}
                                              onChange={(e) => setPayAmount(e.target.value)}
                                              placeholder="Montant"
                                            />
                                            <span className="text-[10px] text-gray-500">FCFA</span>
                                            <button
                                              type="button"
                                              className="text-[10px] rounded bg-green-600 px-2 py-0.5 text-white hover:bg-green-700 disabled:opacity-50"
                                              disabled={payLoading || !payAmount || Number(payAmount) <= 0}
                                              onClick={() => void submitDailyPayment(s.vendorId, day.date, Number(payAmount), undefined)}
                                            >
                                              {payLoading ? "…" : "Confirmer"}
                                            </button>
                                            <button
                                              type="button"
                                              className="text-[10px] rounded bg-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-400"
                                              onClick={() => {
                                                setPayingKey(null);
                                                setPayAmount("");
                                              }}
                                            >
                                              Annuler
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </>
                              );
                            })()}
                            {hasArrears && (() => {
                              const allArrearsTotal = allArrears.reduce((sum, a) => sum + a.remaining, 0);
                              const totalDu = s.amount + allArrearsTotal;
                              return (
                                <div className="rounded-lg bg-blue-900 text-white flex items-center justify-between gap-2 px-3 py-2.5 shadow-sm">
                                  <span className="font-bold text-xs">Total à verser</span>
                                  <span className="font-bold text-sm tabular-nums">{fmtAmount(totalDu)} FCFA</span>
                                </div>
                              );
                            })()}
                        </div>
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
                    const bd = weekPaymentBreakdown(s);
                    const prevWeekMonday = data?.weekStart ? isoAddDaysUtc(data.weekStart, -7) : "";
                    const arrearSemaineLabel =
                      bd.co0 > 0 && prevWeekMonday
                        ? `${weekArrearLabelWithFmt(prevWeekMonday, fmtDateFr)}${(s.carryOverWeekCount ?? 1) > 1 ? ` (${s.carryOverWeekCount} semaines)` : ""}`
                        : bd.co0 > 0
                          ? carryOverWeekLabel(s.carryOverWeekCount ?? 1)
                          : "";
                    const arrearFormulaHint =
                      prevWeekMonday && bd.co0 > 0
                        ? `Arriéré (${fmtDateFr(prevWeekMonday)} – ${fmtDateFr(sundayFromMondayUtc(prevWeekMonday))}) + Montant à verser`
                        : "Arriéré semaine antérieure + Montant à verser";
                    const { daily: dailyShown, weekly: weeklyShown } = splitDailyWeeklyPaidShown(
                      s.dailyPaid,
                      s.weeklyPaid,
                      s.amount,
                      s.commission,
                      s.carryOverAmount,
                    );
                    const paidAggregateShown = paidShownVersusWeekContext(s.paidAmount, s.amount, s.commission, s.carryOverAmount);
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
                            {bd.co0 > 0 && (
                              <tr className="border-b border-gray-50 bg-amber-50/30">
                                <td className="px-3 py-1.5 text-gray-600 leading-snug">{arrearSemaineLabel}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-red-600 tabular-nums">
                                  {fmtAmount(bd.remainingCarry)} FCFA
                                </td>
                              </tr>
                            )}
                            {(s.dailyPaid ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-sky-50/40">
                                <td className="px-3 py-1.5 text-sky-700">Versé en journalier</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-sky-700 tabular-nums">{fmtAmount(dailyShown)} FCFA</td>
                  </tr>
                            )}
                            {(s.weeklyPaid ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-emerald-50/40">
                                <td className="px-3 py-1.5 text-emerald-700">Versé en hebdomadaire</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-emerald-700 tabular-nums">{fmtAmount(weeklyShown)} FCFA</td>
                              </tr>
                            )}
                            {s.dailyPaid === undefined && (s.paidAmount ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-gray-50/50">
                                <td className="px-3 py-1.5 text-gray-500">Versé</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtAmount(paidAggregateShown)} FCFA</td>
                              </tr>
                            )}
                            {(s.dailyPaid ?? 0) > 0 && (s.weeklyExpected ?? 0) > 0 && (
                              <tr className="border-b border-gray-50 bg-blue-50/40">
                                <td className="px-3 py-1.5 text-blue-700">Hebdo. à régler</td>
                                <td className="px-3 py-1.5 text-right font-bold text-blue-700 tabular-nums">{fmtAmount(s.weeklyExpected!)} FCFA</td>
                              </tr>
                            )}
                            <tr className="border-b border-gray-50">
                              <td className="px-3 py-1.5 text-gray-500">
                                {bd.co0 > 0 ? "Montant à verser" : "Total à verser"}
                              </td>
                              <td
                                className={`px-3 py-1.5 text-right font-bold tabular-nums ${
                                  (bd.co0 > 0 ? bd.montantAVerser : bd.totalToPay) > 0 ? "text-red-600" : "text-gray-400"
                                }`}
                              >
                                {fmtAmount(bd.co0 > 0 ? bd.montantAVerser : bd.totalToPay)} FCFA
                              </td>
                            </tr>
                            <tr className="border-b border-gray-50 bg-gray-50/50">
                              <td className="px-3 py-1.5 text-gray-500">Commission</td>
                              <td className="px-3 py-1.5 text-right font-medium text-gray-600 tabular-nums">
                                {commRate > 0 ? `${commRate}%` : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                            <tr className="border-b border-gray-50">
                              <td className="px-3 py-1.5 text-gray-500">Rémunération</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-gray-700 tabular-nums">
                                {(s.commission ?? 0) > 0 ? `${fmtAmount(s.commission!)} FCFA` : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                            {bd.co0 > 0 && (
                              <tr className="bg-indigo-50/40">
                                <td className="px-3 py-1.5 align-top">
                                  <div className="font-bold text-gray-800">Total à verser à ce jour</div>
                                  <div className="text-[9px] text-gray-500 font-normal leading-snug mt-0.5">
                                    = {arrearFormulaHint}
                                  </div>
                                </td>
                                <td
                                  className={`px-3 py-1.5 text-right font-bold tabular-nums align-top ${
                                    bd.totalVerseCeJour > 0 ? "text-red-600" : "text-gray-400"
                                  }`}
                                >
                                  {fmtAmount(bd.totalVerseCeJour)} FCFA
                                </td>
                              </tr>
                            )}
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
