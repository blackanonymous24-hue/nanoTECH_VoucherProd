const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
] as const;

/** Ex. 15 Mai 2026 */
export function fmtDateFr(iso: string): string {
  const [y, m, day] = iso.split("-");
  return `${parseInt(day, 10)} ${MONTH_NAMES_FR[parseInt(m, 10) - 1]} ${y}`;
}

/** En-tête carte résumé jour : « NOM (vendu le 15 Mai 2026) » */
export function vendorSoldDayTitle(vendorName: string, soldDateIso: string): string {
  return `${vendorName} (vendu le ${fmtDateFr(soldDateIso)})`;
}

export function yesterdayIsoLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
