export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(amount) + '\u00a0FCFA';
}

export function formatBytes(megabytes: number | null | undefined): string {
  if (megabytes == null) return 'Illimité';
  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} Go`;
  }
  return `${megabytes} Mo`;
}

/** Converts stored minutes to MikHmon display format (e.g. "30m", "1d", "2w") */
export function formatDuration(minutes: number): string {
  if (minutes % 10080 === 0 && minutes >= 10080) return `${minutes / 10080}w`;
  if (minutes % 1440 === 0 && minutes >= 1440) return `${minutes / 1440}d`;
  return `${minutes}m`;
}

type DurationUnit = 'm' | 'd' | 'w';

/** Converts stored minutes to a {value, unit} pair for the form */
export function minutesToParts(minutes: number): { value: number; unit: DurationUnit } {
  if (minutes % 10080 === 0 && minutes >= 10080) return { value: minutes / 10080, unit: 'w' };
  if (minutes % 1440 === 0 && minutes >= 1440) return { value: minutes / 1440, unit: 'd' };
  return { value: minutes, unit: 'm' };
}

/** Converts form {value, unit} to stored minutes */
export function partsToMinutes(value: number, unit: DurationUnit): number {
  if (unit === 'w') return value * 10080;
  if (unit === 'd') return value * 1440;
  return value;
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}
