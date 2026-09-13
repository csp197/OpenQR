// Shared TS types for the Rust <-> frontend contract.
// See the "Shared contract" section of the bugfix/UX plan.

/** A scan that was checked and is safe to proceed with (though it may carry warnings). */
export type ScanWarning =
  | "not_https"
  | "ip_address"
  | "punycode"
  | "shortener"
  | "userinfo";

export type ScanResult = {
  /** Normalized URL that was checked; this is what gets opened and stored in history. */
  url: string;
  host: string;
  warnings: ScanWarning[];
};

export type ScanErrorKind = "not_a_link" | "blocked" | "not_allowed" | "internal";

/** Rejection value of `process_scan` — a serialized struct, never a plain string. */
export type ScanError = {
  kind: ScanErrorKind;
  /** Human-readable message. */
  message: string;
  /** Cleaned input, so the user can copy non-link text. */
  raw: string;
  host?: string;
};

export type ListenerErrorKind = "permission" | "other";

/** Payload of the `scan-error` event (global listener failures). */
export type ListenerError = {
  kind: ListenerErrorKind;
  message: string;
};

export type ScanObject = {
  id: number;
  url: string;
  timestamp: string;
};

export type Config = {
  allowlist: string[];
  blocklist: string[];
  history_storage_method: "sqlite" | "json";
  scan_mode: "single" | "continuous";
  notification_type: "toast" | "status";
  max_history_items: number;
  prefix: {
    mode: "none" | "default" | "custom";
    value?: string;
  };
  suffix: {
    mode: "none" | "newline" | "tab" | "enter" | "custom";
    value?: string;
  };
  close_to_tray: boolean;
  show_debug_toasts: boolean;
  /**
   * Rust field defaults to `true` via serde; an older on-disk config saved
   * before this setting existed loads without the key, which JSON.parse
   * surfaces here as `undefined` — always treat that as `true` (see
   * Settings.tsx's draft-state init and `buildConfig()`).
   */
  require_scanner_speed: boolean;
};
