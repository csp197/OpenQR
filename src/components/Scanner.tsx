import { Copy, Trash2, Loader2, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notify } from "../lib/notify";
import { formatTimestamp } from "../lib/time";
import type { AppState } from "../App";
import type { ScanObject, ScanWarning } from "../types";

const WARNING_TEXT: Record<ScanWarning, string> = {
  not_https: "This link isn't secure (no HTTPS).",
  ip_address: "This points to a raw IP address instead of a normal website.",
  punycode: "This domain uses look-alike characters (punycode).",
  shortener: "This is a link shortener — the real destination is hidden.",
  userinfo: "This link hides its real destination.",
};

interface ScannerProps {
  isListening: boolean;
  setIsListening: (val: boolean) => void;
  status: string;
  history: ScanObject[];
  onClear: () => void;
  mode: AppState;
  onStop: () => void;
  onOpenAnyway: () => void;
  permissionProblem: boolean;
  onCheckPermissionAgain: () => void;
  onOpenPermissionSettings: () => void;
}

/** Renders `url` with the `host` portion bolded, wrapping instead of truncating. */
const HostBoldUrl = ({ url, host }: { url: string; host: string }) => {
  const hostIndex = url.indexOf(host);
  if (hostIndex === -1) {
    return (
      <p className="text-sm break-all text-center text-zinc-700 dark:text-zinc-300">
        <strong className="font-bold">{host}</strong>
      </p>
    );
  }
  const before = url.slice(0, hostIndex);
  const after = url.slice(hostIndex + host.length);
  return (
    <p className="text-sm break-all text-center text-zinc-700 dark:text-zinc-300">
      {before}
      <strong className="font-bold">{host}</strong>
      {after}
    </p>
  );
};

const Scanner = ({
  isListening,
  setIsListening,
  status,
  history,
  onClear,
  mode,
  onStop,
  onOpenAnyway,
  permissionProblem,
  onCheckPermissionAgain,
  onOpenPermissionSettings,
}: ScannerProps) => {
  const [confirmingClear, setConfirmingClear] = useState(false);

  const isProcessing = mode.status === "PROCESSING";
  const isPending = mode.status === "PENDING_REDIRECT";
  const hasWarnings = isPending && mode.warnings.length > 0;

  const getIndicatorClasses = () => {
    if (isPending) return "bg-blue-400 animate-pulse";
    if (isProcessing) return "bg-yellow-500 animate-pulse";
    if (isListening)
      return "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]";
    return "bg-zinc-400";
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("success", "Copied to clipboard");
    } catch {
      notify("error", "Could not copy to clipboard");
    }
  };

  const copyAll = () => {
    const allUrls = history.map((h) => h.url).join("\n");
    void copyToClipboard(allUrls);
  };

  const confirmClear = () => {
    setConfirmingClear(false);
    onClear();
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {permissionProblem && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/30 rounded-2xl p-4 space-y-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            OpenQR needs permission to read your scanner. Open System Settings
            → Privacy &amp; Security → Input Monitoring and turn on OpenQR.
            You may need to quit and reopen OpenQR afterwards.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onOpenPermissionSettings}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-full text-xs font-bold transition-colors"
            >
              Open System Settings
            </button>
            <button
              onClick={onCheckPermissionAgain}
              className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-500/30 rounded-full text-xs font-bold transition-colors"
            >
              Check again
            </button>
          </div>
        </div>
      )}

      <div
        className={`bg-white dark:bg-[#252525] border transition-all duration-500 rounded-2xl p-8 flex flex-col items-center shadow-lg
            ${isPending ? "border-blue-500/50 shadow-blue-500/10" : "border-zinc-200 dark:border-white/5"}`}
      >
        <div
          className={`w-4 h-4 rounded-full mb-4 transition-all duration-500 flex items-center justify-center ${getIndicatorClasses()}`}
        >
          {isPending && (
            <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
          )}
        </div>

        <h2 className="text-4xl font-black tracking-tight mb-2 dark:text-white text-center transition-all">
          {isPending
            ? hasWarnings
              ? "Check this link before opening"
              : `Opening in ${mode.secondsLeft}…`
            : isProcessing
              ? "Checking..."
              : isListening
                ? "Listening..."
                : "Ready"}
        </h2>

        {isPending ? (
          <div className="w-full max-w-sm space-y-3 mb-6">
            <HostBoldUrl url={mode.url} host={mode.host} />
            {hasWarnings && (
              <ul className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/30 rounded-xl p-3 space-y-1">
                {mode.warnings.map((w) => (
                  <li
                    key={w}
                    className="text-xs text-amber-800 dark:text-amber-300"
                  >
                    {WARNING_TEXT[w]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm mb-8 text-center max-w-xs transition-colors font-mono text-zinc-600 dark:text-zinc-400">
            {status}
          </p>
        )}

        <div className="flex gap-3 w-full justify-center flex-wrap">
          {isPending ? (
            <>
              <button
                onClick={onStop}
                className="px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-full text-sm font-bold flex items-center gap-2 transition-all"
              >
                <X size={16} /> Cancel
              </button>

              <button
                onClick={() => void copyToClipboard(mode.url)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20"
              >
                <Copy size={16} /> Copy Link
              </button>

              {hasWarnings && (
                <button
                  onClick={onOpenAnyway}
                  className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-full text-sm font-bold flex items-center gap-2 transition-all"
                >
                  <ExternalLink size={16} /> Open anyway
                </button>
              )}
            </>
          ) : (
            <button
              disabled={isProcessing}
              onClick={() => setIsListening(!isListening)}
              className={`px-8 py-2.5 rounded-full text-sm font-bold transition-all flex items-center gap-2 shadow-sm ${
                isListening
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  : "bg-zinc-900 dark:bg-white text-white dark:text-black hover:scale-105"
              } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isProcessing && <Loader2 size={16} className="animate-spin" />}
              {isListening ? "Stop Listening" : "Start Listening"}
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
            Recent Scans
          </h3>
          {history.length > 0 && (
            <div className="flex gap-4 items-center">
              {confirmingClear ? (
                <span className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
                  Delete all {history.length} scans?
                  <button
                    onClick={confirmClear}
                    className="text-red-500 font-bold hover:underline"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmingClear(false)}
                    className="hover:underline"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button
                    onClick={copyAll}
                    className="text-xs text-blue-500 flex items-center gap-1 hover:underline"
                  >
                    <Copy size={12} /> Copy All
                  </button>
                  <button
                    onClick={() => setConfirmingClear(true)}
                    className="text-xs text-red-500 flex items-center gap-1 hover:underline"
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-xl divide-y dark:divide-white/5 overflow-hidden">
          {history.length === 0 ? (
            <div className="p-4 text-sm font-mono text-zinc-600 dark:text-zinc-400 italic text-center">
              No scans yet
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="p-4 flex justify-between items-center hover:bg-zinc-50 dark:hover:bg-white/2 transition-colors"
              >
                <div className="flex flex-col min-w-0 pr-4">
                  <span className="text-sm font-mono text-zinc-900 dark:text-zinc-100 truncate">
                    {item.url}
                  </span>
                  <span
                    className="text-xs text-zinc-600 dark:text-zinc-400 uppercase tracking-tight"
                    title={item.timestamp}
                  >
                    {formatTimestamp(item.timestamp)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void copyToClipboard(item.url)}
                    aria-label={`Copy ${item.url}`}
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => openUrl(item.url)}
                    aria-label={`Open ${item.url} in browser`}
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Scanner;
