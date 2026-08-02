/** Display helpers shared by the dashboard pages. Presentation only. */

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Elapsed time. An unfinished build measures against now, so it ticks. */
export function fmtDuration(start: Date | null, end: Date | null): string {
  if (!start) return "—";
  const seconds = Math.floor(((end ? end.getTime() : Date.now()) - start.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "12 min ago" — closer to how anyone reads a build list than a timestamp. */
export function fmtAgo(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const STATUSES = new Set(["queued", "running", "success", "failed", "canceled"]);

/** Class for a build-status pill. Unknown statuses render neutral, not broken. */
export function statusClass(status: string): string {
  return `pill ${STATUSES.has(status) ? `pill-${status}` : "pill-muted"}`;
}
