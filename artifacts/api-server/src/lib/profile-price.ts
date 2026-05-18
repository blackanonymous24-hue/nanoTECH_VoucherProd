/** Tarif affiché sur les tickets — aligné sur le front (`mikhmonProfilePriceLabel`). */
export function effectiveProfilePrice(
  p: { price?: string | null; sellingPrice?: string | null } | null | undefined,
): string {
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
