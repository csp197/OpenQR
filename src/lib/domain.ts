/**
 * Normalize a user-entered allowlist/blocklist domain the same way the Rust
 * backend normalizes list entries (`normalize_entry`): lowercase, trim,
 * strip a leading scheme, a leading "*.", and any path/query/fragment/port,
 * and strip trailing dots (e.g. "example.com."). Returns null when the
 * result isn't a plausible host (no dot, not an IPv4 address, not
 * "localhost"). Bracketed or bare IPv6 literals — and anything else with
 * more than one remaining ":" — are rejected outright (same as the Rust
 * side, and for the same reason: cutting at just the first colon would
 * silently truncate a rejected entry like "1.2.3.4:5:6" into an accepted
 * one, "1.2.3.4").
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // Strip a leading scheme, e.g. "https://".
  const schemeMatch = s.match(/^[a-z][a-z0-9+.-]*:\/\//);
  if (schemeMatch) s = s.slice(schemeMatch[0].length);

  // Strip a leading wildcard label.
  if (s.startsWith("*.")) s = s.slice(2);

  // Strip path / query / fragment.
  const cutIndex = s.search(/[/?#]/);
  if (cutIndex !== -1) s = s.slice(0, cutIndex);

  // Reject bracketed/bare IPv6 literals and anything else with more than
  // one remaining ":" — must happen before port-stripping below, or a
  // rejected entry would get truncated into an accepted fragment instead.
  if (s.startsWith("[") || s.split(":").length - 1 > 1) return null;

  // Strip a trailing port.
  const colonIndex = s.indexOf(":");
  if (colonIndex !== -1) s = s.slice(0, colonIndex);

  // Strip trailing dots (e.g. "example.com."), a valid DNS root-label form
  // browsers treat the same as "example.com".
  s = s.replace(/\.+$/, "");

  s = s.trim();
  if (!s) return null;

  // Userinfo-shaped garbage (e.g. "user@example.com", or
  // "user:pass@example.com" — port-stripping above already reduces that
  // one to "user") must never be accepted as a plausible entry just
  // because a leftover fragment happens to contain a dot. Mirrors the
  // Rust side's `normalize_entry`.
  if (s.includes("@")) return null;

  if (s === "localhost") return s;

  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
  if (isIpv4) return s;

  if (!s.includes(".")) return null;

  return s;
}
