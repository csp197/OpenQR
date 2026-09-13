/** Parse a "YYYY-MM-DD HH:MM:SS" timestamp (as produced by the Rust backend) as local time. */
function parseTimestamp(timestamp: string): Date {
  const [datePart, timePart] = timestamp.split(" ");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  const [hours, minutes, seconds] = (timePart ?? "0:0:0").split(":").map(Number);
  return new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hours ?? 0,
    minutes ?? 0,
    seconds ?? 0,
  );
}

/**
 * Format a "YYYY-MM-DD HH:MM:SS" timestamp for display: "just now", "5 min
 * ago", "3 hr ago" for anything under 24h old, otherwise a locale short date
 * and time. `now` defaults to the current time and exists so tests are
 * deterministic.
 */
export function formatTimestamp(timestamp: string, now: Date = new Date()): string {
  const then = parseTimestamp(timestamp);
  const diffSec = Math.floor((now.getTime() - then.getTime()) / 1000);

  // A timestamp in the future (clock skew, bad data) isn't "just now" -
  // show the absolute date/time instead of a misleading relative one.
  if (diffSec < 0) {
    return then.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  }

  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  return then.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
