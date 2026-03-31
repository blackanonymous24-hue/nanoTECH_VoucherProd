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

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
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
