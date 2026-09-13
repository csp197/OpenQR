import { getVersion } from "@tauri-apps/api/app";
import { ChevronDown, X, FolderOpen, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { homeDir, join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { notify } from "../lib/notify";
import type { Config } from "../types";
import ListSection from "./ListSection";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config;
  onSave: (newConfig: Config) => Promise<boolean>;
  /** Runs a scan through the normal pipeline for the given input, without a physical scanner. */
  onTestScan?: (rawInput: string) => void;
}

type ToggleOption<T extends string> = { value: T; label: string };

// Module scope so it isn't recreated (and remounted) on every render.
function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ToggleOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      className="flex bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 gap-1"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            value === opt.value
              ? "bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm"
              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type SuffixDisplayMode = "enter" | "tab" | "custom";

/** The Advanced panel only exposes Enter/Tab/Custom; legacy values collapse to Enter. */
function toSuffixDisplay(mode: Config["suffix"]["mode"]): SuffixDisplayMode {
  return mode === "tab" || mode === "custom" ? mode : "enter";
}

const clampMaxHistory = (raw: string, fallback: number): number => {
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(10000, Math.max(1, parsed));
};

const Settings = ({ isOpen, onClose, config, onSave, onTestScan }: SettingsProps) => {
  const [allowlist, setAllowlist] = useState(config.allowlist);
  const [blocklist, setBlocklist] = useState(config.blocklist);
  const [scanMode, setScanMode] = useState(config.scan_mode);
  const [notificationType, setNotificationType] = useState(config.notification_type);
  const [maxHistoryInput, setMaxHistoryInput] = useState(String(config.max_history_items));
  const [prefixMode, setPrefixMode] = useState(config.prefix.mode);
  const [prefixValue, setPrefixValue] = useState(config.prefix.value || "");
  const [suffixMode, setSuffixMode] = useState<SuffixDisplayMode>(toSuffixDisplay(config.suffix.mode));
  const [suffixValue, setSuffixValue] = useState(config.suffix.value || "");
  const [closeToTray, setCloseToTray] = useState(config.close_to_tray);
  const [requireScannerSpeed, setRequireScannerSpeed] = useState(config.require_scanner_speed ?? true);
  const [showDebugToasts, setShowDebugToasts] = useState(config.show_debug_toasts);
  const [historyStorage, setHistoryStorage] = useState(config.history_storage_method);
  const [testScanInput, setTestScanInput] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    setAllowlist(config.allowlist);
    setBlocklist(config.blocklist);
    setScanMode(config.scan_mode);
    setNotificationType(config.notification_type);
    setMaxHistoryInput(String(config.max_history_items));
    setPrefixMode(config.prefix.mode);
    setPrefixValue(config.prefix.value || "");
    setSuffixMode(toSuffixDisplay(config.suffix.mode));
    setSuffixValue(config.suffix.value || "");
    setCloseToTray(config.close_to_tray);
    setRequireScannerSpeed(config.require_scanner_speed ?? true);
    setShowDebugToasts(config.show_debug_toasts);
    setHistoryStorage(config.history_storage_method);
    setTestScanInput("");
    setAdvancedOpen(false);
    setShowDiscardConfirm(false);
  }, [config, isOpen]);

  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen]);

  const buildConfig = (): Config => ({
    ...config,
    allowlist,
    blocklist,
    scan_mode: scanMode,
    notification_type: notificationType,
    max_history_items: clampMaxHistory(maxHistoryInput, config.max_history_items),
    prefix: {
      mode: prefixMode,
      value: prefixMode === "custom" ? prefixValue : undefined,
    },
    suffix: {
      mode: suffixMode,
      value: suffixMode === "custom" ? suffixValue : undefined,
    },
    close_to_tray: closeToTray,
    require_scanner_speed: requireScannerSpeed,
    show_debug_toasts: showDebugToasts,
    history_storage_method: historyStorage,
  });

  const isDirty = (): boolean => {
    const normalizedOriginal: Config = {
      ...config,
      suffix: {
        mode: toSuffixDisplay(config.suffix.mode),
        value: config.suffix.mode === "custom" ? config.suffix.value : undefined,
      },
      // An older on-disk config may not have this key yet (undefined) —
      // treat that the same as `true`, matching the draft state's
      // initializer, so a pristine legacy config isn't flagged dirty.
      require_scanner_speed: config.require_scanner_speed ?? true,
    };
    return JSON.stringify(buildConfig()) !== JSON.stringify(normalizedOriginal);
  };

  const requestClose = () => {
    if (isDirty()) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  if (!isOpen) return null;

  const openSettingsFolder = async () => {
    try {
      const home = await homeDir();
      const folderPath = await join(home, ".openqr");
      await openPath(folderPath);
    } catch {
      notify("error", "Could not open settings folder.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave(buildConfig());
    setSaving(false);
    if (ok) onClose();
  };

  const handleRunTestScan = () => {
    const trimmed = testScanInput.trim();
    if (!trimmed || isDirty()) return;
    onTestScan?.(trimmed);
    setTestScanInput("");
    requestClose(); // not dirty here, so this just closes — no discard prompt
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-white/10 outline-none"
      >
        <div className="p-6 border-b dark:border-white/5 flex justify-between items-center">
          <h2 id="settings-title" className="text-lg font-bold">
            App Settings
          </h2>
          <button
            onClick={requestClose}
            aria-label="Close settings"
            className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        {showDiscardConfirm && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/30 rounded-xl flex items-center justify-between gap-3">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              You have unsaved changes.
            </p>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
                className="text-xs font-bold text-red-600 hover:underline"
              >
                Discard
              </button>
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className="text-xs font-bold hover:underline"
              >
                Keep editing
              </button>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Scan Mode */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              Scan Mode
            </h3>
            <ToggleGroup
              label="Scan Mode"
              options={[
                { value: "single" as const, label: "Single" },
                { value: "continuous" as const, label: "Continuous" },
              ]}
              value={scanMode}
              onChange={setScanMode}
            />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {scanMode === "single"
                ? "Stops listening after one scan"
                : "Keeps listening for more scans"}
            </p>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Notification Type */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              Notifications
            </h3>
            <ToggleGroup
              label="Notifications"
              options={[
                { value: "toast" as const, label: "Pop-up messages" },
                { value: "status" as const, label: "Status bar only" },
              ]}
              value={notificationType}
              onChange={setNotificationType}
            />
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Max History */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              Max History Items
            </h3>
            <input
              type="text"
              inputMode="numeric"
              value={maxHistoryInput}
              onChange={(e) => setMaxHistoryInput(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() =>
                setMaxHistoryInput(String(clampMaxHistory(maxHistoryInput, config.max_history_items)))
              }
              className="w-full bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
            />
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Minimize to Tray */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                Minimize to Tray
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                OpenQR keeps running in your menu bar / system tray when you
                close the window. Click its icon to reopen, or choose Quit.
              </p>
            </div>
            <button
              onClick={() => setCloseToTray(!closeToTray)}
              role="switch"
              aria-checked={closeToTray}
              aria-label="Minimize to tray"
              className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
                closeToTray ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                  closeToTray ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Blocked / allowed sites */}
          <div className="space-y-3">
            <ListSection
              variant="block"
              items={blocklist}
              onChange={setBlocklist}
              otherListItems={allowlist}
              otherListName="Only allow these sites"
            />
            <ListSection
              variant="allow"
              items={allowlist}
              onChange={setAllowlist}
              otherListItems={blocklist}
              otherListName="Blocked sites"
            />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Subdomains are included — blocking example.com also blocks
              mail.example.com.
            </p>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Advanced */}
          <div>
            <button
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400 py-1"
            >
              Advanced
              <ChevronDown
                className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>

            {advancedOpen && (
              <div className="space-y-6 pt-4">
                {/* History Storage */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                    History Storage
                  </h3>
                  <ToggleGroup
                    label="History Storage"
                    options={[
                      { value: "json" as const, label: "JSON File" },
                      { value: "sqlite" as const, label: "SQLite Database" },
                    ]}
                    value={historyStorage}
                    onChange={setHistoryStorage}
                  />
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {historyStorage === "json"
                      ? "Simple file-based storage (recommended)"
                      : "Database storage for large history"}
                  </p>
                </div>

                <hr className="border-zinc-200 dark:border-white/5" />

                {/* Prefix */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                    Scanner Prefix
                  </h3>
                  <ToggleGroup
                    label="Scanner Prefix"
                    options={[
                      { value: "none" as const, label: "None" },
                      { value: "default" as const, label: "Default" },
                      { value: "custom" as const, label: "Custom" },
                    ]}
                    value={prefixMode}
                    onChange={setPrefixMode}
                  />
                  {prefixMode === "custom" && (
                    <input
                      value={prefixValue}
                      onChange={(e) => setPrefixValue(e.target.value)}
                      placeholder="Enter custom prefix..."
                      className="w-full bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
                    />
                  )}
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {prefixMode === "none"
                      ? "No prefix stripping"
                      : prefixMode === "default"
                        ? 'Strips common prefixes like "QR:"'
                        : "Strips your custom prefix from scanned input"}
                  </p>
                </div>

                <hr className="border-zinc-200 dark:border-white/5" />

                {/* Suffix */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                    Scan Ends With
                  </h3>
                  <ToggleGroup
                    label="Scan Ends With"
                    options={[
                      { value: "enter" as const, label: "Enter" },
                      { value: "tab" as const, label: "Tab" },
                      { value: "custom" as const, label: "Custom" },
                    ]}
                    value={suffixMode}
                    onChange={setSuffixMode}
                  />
                  {suffixMode === "custom" && (
                    <input
                      value={suffixValue}
                      onChange={(e) => setSuffixValue(e.target.value)}
                      placeholder="Enter custom suffix..."
                      className="w-full bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
                    />
                  )}
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {suffixMode === "custom"
                      ? "The scan still ends on Enter. Your custom text is removed from the end."
                      : "The scanner sends this key when it finishes typing a code."}
                  </p>
                </div>

                <hr className="border-zinc-200 dark:border-white/5" />

                {/* Only accept scanner-speed input */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                      Only accept scanner-speed input
                    </h3>
                    {requireScannerSpeed ? (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                        Recommended. Ignores normal typing so pressing Enter
                        in other apps never opens a link. Only a scanner's
                        fast input counts as a scan.
                      </p>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        Anything typed while OpenQR is listening, followed by
                        Enter, will be treated as a scan. Typed text is never
                        shown on screen. Use this only for testing or slow
                        scanners.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setRequireScannerSpeed(!requireScannerSpeed)}
                    role="switch"
                    aria-checked={requireScannerSpeed}
                    aria-label="Only accept scanner-speed input"
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
                      requireScannerSpeed ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                        requireScannerSpeed ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </div>

                <hr className="border-zinc-200 dark:border-white/5" />

                {/* Debug Messages */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                      Debug Messages
                    </h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                      Show what the scanner actually captured
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDebugToasts(!showDebugToasts)}
                    role="switch"
                    aria-checked={showDebugToasts}
                    aria-label="Debug messages"
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
                      showDebugToasts ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                        showDebugToasts ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </div>

                {showDebugToasts && onTestScan && (
                  <>
                    <hr className="border-zinc-200 dark:border-white/5" />

                    {/* Test a scan */}
                    <div className="space-y-2">
                      <div>
                        <h3 className="text-sm font-semibold">Test a scan</h3>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                          Check a link without a scanner. It goes through the
                          same safety checks, countdown and history as a real
                          scan.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={testScanInput}
                          onChange={(e) => setTestScanInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleRunTestScan();
                            }
                          }}
                          placeholder="https://example.com"
                          aria-label="Link to test"
                          className="flex-1 min-w-0 bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleRunTestScan}
                          disabled={!testScanInput.trim() || isDirty()}
                          className="flex items-center gap-1 border border-zinc-300 dark:border-white/15 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl px-3 py-2 text-sm font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          <ScanLine size={14} />
                          Run test scan
                        </button>
                      </div>
                      {isDirty() && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Save your changes first.
                        </p>
                      )}
                    </div>
                  </>
                )}

                <button
                  onClick={() => void openSettingsFolder()}
                  className="w-full py-2 flex items-center justify-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-xs transition-colors"
                >
                  <FolderOpen size={14} />
                  Open config folder
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 bg-zinc-50 dark:bg-black/20 space-y-3">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-500 transition-colors disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          {version && (
            <p className="text-center text-xs text-zinc-600 dark:text-zinc-400">
              v{version}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
