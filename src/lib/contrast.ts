type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const num = parseInt(full, 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two hex colors, from 1 (identical) to 21 (black/white). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Warn about a QR code foreground/background pairing that may not scan
 * well: colors too close in contrast, or a light-on-dark scheme (some phone
 * cameras struggle with inverted QR codes). Returns null when the pairing
 * looks fine.
 */
export function qrColorWarning(fg: string, bg: string): string | null {
  const ratio = contrastRatio(fg, bg);
  if (ratio < 3) {
    return "These colors are too similar and may not scan.";
  }

  const fgLum = relativeLuminance(hexToRgb(fg));
  const bgLum = relativeLuminance(hexToRgb(bg));
  if (fgLum > bgLum) {
    return "Light-on-dark codes don't scan on some phones.";
  }

  return null;
}
