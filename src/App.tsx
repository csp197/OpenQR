import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LazyStore } from "@tauri-apps/plugin-store";
import { homeDir, join } from "@tauri-apps/api/path";

import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";

import Footer from "./components/Footer";
import Generator from "./components/Generator";
import Header from "./components/Header";
import Scanner from "./components/Scanner";
import Settings from "./components/Settings";
import { notify, setNotifyMode, setStatusSink } from "./lib/notify";
import type {
  ListenerError,
  ScanError,
  ScanObject,
  ScanResult,
} from "./types";

import "./App.css";

// Re-exported so existing imports of `Config` from "../App" keep working.
export type { Config } from "./types";
import type { Config } from "./types";

export type AppState =
  | { status: "IDLE" }
  | { status: "LISTENING" }
  | { status: "PROCESSING"; url: string }
  | {
      status: "PENDING_REDIRECT";
      url: string;
      host: string;
      warnings: ScanResult["warnings"];
      secondsLeft: number;
    }
  | { status: "GENERATING"; feedback?: string }
  | { status: "ERROR"; message: string };

/** Turn any invoke() rejection into a readable string, whether it's a String, an Error, or an object with a message. */
function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

/** `process_scan` rejects with a ScanError object, not a string — but handle both defensively. */
function toScanError(err: unknown): ScanError {
  if (err && typeof err === "object" && "kind" in err && "message" in err) {
    return err as ScanError;
  }
  return { kind: "internal", message: describeError(err), raw: typeof err === "string" ? err : "" };
}

type Tab = "scanner" | "generator";

function App() {
  const [mode, setModeState] = useState<AppState>({ status: "IDLE" });
  const [isDark, setIsDark] = useState(true);
  const [url, setUrl] = useState("");
  const [history, setHistory] = useState<ScanObject[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfigState] = useState<Config | null>(null);
  const [listenerActive, setListenerActiveState] = useState(false);
  const [permissionProblem, setPermissionProblem] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTabState] = useState<Tab>("scanner");

  // Refs so the scan-input/scan-error/scan-debug listeners (registered once
  // below) always see the latest config/mode/tab/listener state instead of a
  // stale closure.
  const configRef = useRef<Config | null>(null);
  const modeRef = useRef<AppState>({ status: "IDLE" });
  const activeTabRef = useRef<Tab>("scanner");
  const listenerActiveRef = useRef(false);
  const redirectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Countdown state lives in refs, not just in `mode`, so the interval tick
  // can decide "are we done?" and fire side effects (stopping the interval,
  // calling finishRedirect/openUrl) directly in the setInterval callback —
  // never inside a setState updater. React (in StrictMode, in dev) invokes
  // updater functions passed to setState twice to flush out impure
  // updaters; doing the side effects there meant `openUrl` (and the
  // single-scan-mode listener stop) fired twice per countdown.
  const redirectSecondsRef = useRef(3);
  const redirectUrlRef = useRef<string | null>(null);
  // Which pipeline started the in-flight redirect: "scanner" for a real
  // scan-input event, "test" for Settings' "Test a scan". A test-originated
  // redirect must never stop the real global listener (or leave it stopped)
  // regardless of scan_mode — see finishRedirect.
  const redirectSourceRef = useRef<"scanner" | "test">("scanner");
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef<LazyStore | null>(null);

  const updateConfig = (next: Config | null) => {
    configRef.current = next;
    setConfigState(next);
  };

  const updateMode = (next: AppState | ((prev: AppState) => AppState)) => {
    setModeState((prev) => {
      const resolved = typeof next === "function" ? (next as (p: AppState) => AppState)(prev) : next;
      modeRef.current = resolved;
      return resolved;
    });
  };

  const setActiveTab = (next: Tab) => {
    activeTabRef.current = next;
    setActiveTabState(next);
  };

  // A function (rather than inlining `activeTabRef.current === "generator"`
  // at each call site) so TS doesn't narrow the ref's type across repeated
  // checks separated by `await` in the same async function.
  const isGeneratorTab = () => activeTabRef.current === "generator";

  const setListenerActive = (next: boolean) => {
    listenerActiveRef.current = next;
    setListenerActiveState(next);
  };

  const clearRedirectInterval = () => {
    if (redirectIntervalRef.current) {
      clearInterval(redirectIntervalRef.current);
      redirectIntervalRef.current = null;
    }
  };

  /**
   * Stop the global listener. Only clears `listenerActive` when the invoke
   * actually succeeds. No-op (and never calls `stop_global_listener`) when
   * the listener isn't active — e.g. a test scan run while it's off.
   */
  const stopListener = async (): Promise<boolean> => {
    if (!listenerActiveRef.current) return true;
    try {
      await invoke("stop_global_listener");
      setListenerActive(false);
      return true;
    } catch (err) {
      notify("error", "Listener error", { description: describeError(err) });
      return false;
    }
  };

  const finishRedirect = async (targetUrl: string) => {
    // Captured before the `openUrl` await: a test scan run while the
    // listener isn't active must never call stop_global_listener and must
    // always land back on IDLE, regardless of scan_mode.
    const wasListening = listenerActiveRef.current;
    // A "Test a scan" redirect (Settings) must never touch the real
    // listener, even in single-scan mode — otherwise testing a link while
    // the listener is running silently turns real scanning off. Captured
    // now, not read again after the awaits below: `startPendingRedirect`
    // never changes it mid-flight (no redirect can start while another is
    // already pending), but reading a ref post-await for a decision this
    // consequential should never depend on nothing else having moved it.
    const isTest = redirectSourceRef.current === "test";

    await openUrl(targetUrl);

    if (!isTest && wasListening && configRef.current?.scan_mode === "single") {
      await stopListener();
    }

    // The user may have switched to the Generator tab while we were
    // awaiting the open/stop above — don't yank the UI back to Scanner.
    if (isGeneratorTab()) return;

    if (isTest) {
      // Restore whatever the real listener's state actually is — never
      // force IDLE just because this redirect came from a test scan.
      updateMode(listenerActiveRef.current ? { status: "LISTENING" } : { status: "IDLE" });
      return;
    }

    if (!wasListening || configRef.current?.scan_mode === "single") {
      updateMode({ status: "IDLE" });
    } else {
      updateMode(listenerActiveRef.current ? { status: "LISTENING" } : { status: "IDLE" });
    }
  };

  const startPendingRedirect = (result: ScanResult, source: "scanner" | "test" = "scanner") => {
    clearRedirectInterval(); // bug #6: never let two countdowns race
    redirectSourceRef.current = source;

    const hasWarnings = result.warnings.length > 0;
    updateMode({
      status: "PENDING_REDIRECT",
      url: result.url,
      host: result.host,
      warnings: result.warnings,
      secondsLeft: 3,
    });

    if (hasWarnings) return; // no auto-open — user must click "Open anyway"

    redirectSecondsRef.current = 3;
    redirectUrlRef.current = result.url;

    redirectIntervalRef.current = setInterval(() => {
      redirectSecondsRef.current -= 1;

      if (redirectSecondsRef.current <= 0) {
        clearRedirectInterval();
        const targetUrl = redirectUrlRef.current;
        if (targetUrl) void finishRedirect(targetUrl);
        return;
      }

      // Pure: only computes next state from prev, no side effects — safe
      // for React to invoke this updater more than once.
      const secondsLeft = redirectSecondsRef.current;
      updateMode((prev) =>
        prev.status === "PENDING_REDIRECT" ? { ...prev, secondsLeft } : prev,
      );
    }, 1000);
  };

  const handleScanError = (err: unknown) => {
    const scanErr = toScanError(err);
    let title: string;
    let opts: Parameters<typeof notify>[2] | undefined;

    switch (scanErr.kind) {
      case "not_a_link":
        title = "This QR code isn't a web link";
        // `raw` arrives empty when `require_scanner_speed` is off (see
        // Rust's `scrub_not_a_link_raw`): with the speed filter disabled,
        // anything typed anywhere followed by Enter reaches here, so the
        // typed text (which could be a password) must never be echoed
        // back on screen or offered up via a "Copy" button.
        opts = scanErr.raw
          ? {
              description: scanErr.raw,
              action: {
                label: "Copy",
                onClick: () => {
                  navigator.clipboard?.writeText(scanErr.raw).catch(() => {});
                },
              },
            }
          : { description: "The scanned text isn't a link, so it wasn't opened." };
        break;
      case "blocked":
        title = `Blocked: ${scanErr.host ?? "this site"} is on your blocklist`;
        break;
      case "not_allowed":
        title = `${scanErr.host ?? "This site"} isn't on your allowlist`;
        break;
      case "internal":
      default:
        title = "Something went wrong";
        break;
    }

    notify("error", title, opts);
    updateMode({ status: "ERROR", message: title });

    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      updateMode((prev) => {
        if (prev.status !== "ERROR") return prev;
        // Mode is only ERROR while the Scanner tab is active (switching to
        // Generator sets GENERATING), so no explicit tab check is needed
        // here — but don't relight LISTENING if the listener was stopped
        // in the meantime.
        return listenerActiveRef.current ? { status: "LISTENING" } : { status: "IDLE" };
      });
      errorTimerRef.current = null;
    }, 5000);
  };

  /**
   * Shared body of the real scan-input listener and the Settings "Test a
   * scan" feature: PROCESSING -> process_scan -> refresh history ->
   * startPendingRedirect/handleScanError, bailing out at every await if the
   * user has switched to the Generator tab in the meantime.
   */
  const handleScanInput = async (rawInput: string, source: "scanner" | "test" = "scanner") => {
    if (isGeneratorTab()) return;

    updateMode({ status: "PROCESSING", url: rawInput });

    try {
      const result = await invoke<ScanResult>("process_scan", { rawInput });
      if (isGeneratorTab()) return; // switched away while awaiting

      try {
        const hist = await invoke<ScanObject[]>("get_history");
        setHistory(hist);
      } catch {
        // best-effort history refresh
      }
      if (isGeneratorTab()) return; // switched away while awaiting

      startPendingRedirect(result, source);
    } catch (err) {
      if (isGeneratorTab()) return; // switched away while awaiting
      handleScanError(err);
    }
  };

  const runInit = async () => {
    setInitError(null);
    try {
      const home = await homeDir();
      const folderPath = await join(home, ".openqr");
      const filePath = await join(folderPath, "settings.json");
      storeRef.current = new LazyStore(filePath);

      const savedTheme = await storeRef.current.get<boolean>("dark-mode");
      if (savedTheme !== null && savedTheme !== undefined) {
        setIsDark(savedTheme);
      } else if (typeof window !== "undefined" && window.matchMedia) {
        setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      }

      const cfg = await invoke<Config>("get_config");
      updateConfig(cfg);
      setNotifyMode(cfg.notification_type);

      const hist = await invoke<ScanObject[]>("get_history");
      setHistory(hist);

      try {
        const permitted = await invoke<boolean>("check_input_permission");
        setPermissionProblem(!permitted);
      } catch {
        // Command unavailable — don't block startup on it.
      }
    } catch (err) {
      setInitError(describeError(err));
    }
  };

  // Initialize once on mount.
  useEffect(() => {
    runInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once
  }, []);

  // Register the global-listener event handlers exactly once. They only
  // ever read config/mode through refs, so they never go stale.
  useEffect(() => {
    const unlistenScan = listen<string>("scan-input", (event) => {
      // Generator tab is active — a scan-input event may still arrive while
      // stop_global_listener is in flight. Ignore it rather than pulling
      // the user back to Scanner. (handleScanInput re-checks this too, but
      // checking here avoids the async gap before its first await.)
      if (isGeneratorTab()) return;
      void handleScanInput(event.payload);
    });

    const unlistenDebug = listen<string>("scan-debug", (event) => {
      if (configRef.current?.show_debug_toasts) {
        notify("info", "Debug", { description: event.payload, duration: 10000 });
      }
    });

    const unlistenErr = listen<ListenerError>("scan-error", (event) => {
      const { kind, message } = event.payload;
      if (kind === "permission") {
        setPermissionProblem(true);
      } else {
        notify("error", "Listener error", { description: message, duration: 10000 });
      }
      setListenerActive(false);
      updateMode({ status: "IDLE" });
    });

    return () => {
      unlistenScan.then((fn) => fn());
      unlistenDebug.then((fn) => fn());
      unlistenErr.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registered once, uses refs
  }, []);

  // Reflect theme on the document; persistence happens only on explicit toggle.
  useEffect(() => {
    if (isDark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [isDark]);

  // Route "status" mode notifications into the footer for a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    setStatusSink((message) => {
      setStatusMessage(message);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setStatusMessage(null), 4000);
    });
    return () => {
      setStatusSink(null);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Sync tray icon state with which tab is active / whether we're listening.
  useEffect(() => {
    let trayState: string;
    if (activeTab === "generator") {
      trayState = "generating";
    } else if (listenerActive) {
      trayState = "listening";
    } else {
      trayState = "idle";
    }
    invoke("set_tray_state", { trayState }).catch(() => {});
  }, [activeTab, listenerActive]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    void storeRef.current?.set("dark-mode", next).then(() => storeRef.current?.save());
  };

  const toggleListening = async (shouldListen: boolean) => {
    if (shouldListen) {
      try {
        await invoke("start_global_listener");
        setListenerActive(true);
        updateMode({ status: "LISTENING" });
      } catch (err) {
        notify("error", "Listener error", { description: describeError(err) });
      }
    } else {
      const stopped = await stopListener();
      if (stopped) updateMode({ status: "IDLE" });
    }
  };

  const handleScannerToggle = (shouldListen: boolean | ((prev: boolean) => boolean)) => {
    const nextState = typeof shouldListen === "function" ? shouldListen(listenerActive) : shouldListen;
    toggleListening(nextState);
  };

  const saveConfig = async (newConfig: Config): Promise<boolean> => {
    if (config && newConfig.history_storage_method !== config.history_storage_method) {
      try {
        await invoke<number>("migrate_history", {
          maxItems: newConfig.max_history_items,
          from: config.history_storage_method,
          to: newConfig.history_storage_method,
        });
      } catch (err) {
        notify("error", "Migration failed", { description: describeError(err) });
        return false;
      }
    }

    try {
      await invoke("save_config", { config: newConfig });
      updateConfig(newConfig);
      setNotifyMode(newConfig.notification_type);
      notify("success", "Settings updated");

      try {
        const hist = await invoke<ScanObject[]>("get_history");
        setHistory(hist);
      } catch {
        // best-effort history refresh
      }

      return true;
    } catch (err) {
      notify("error", "Failed to save settings", { description: describeError(err) });
      return false;
    }
  };

  const clearHistory = async () => {
    try {
      await invoke("clear_history");
      setHistory([]);
    } catch (err) {
      notify("error", "Failed to clear history", { description: describeError(err) });
    }
  };

  const stopRedirect = () => {
    clearRedirectInterval();
    if (configRef.current?.scan_mode === "continuous") {
      updateMode({ status: "LISTENING" });
    } else {
      invoke("stop_global_listener").catch(() => {});
      setListenerActive(false);
      updateMode({ status: "IDLE" });
    }
    notify("info", "Redirect stopped");
  };

  const openAnyway = () => {
    if (modeRef.current.status !== "PENDING_REDIRECT") return;
    const targetUrl = modeRef.current.url;
    clearRedirectInterval();
    void finishRedirect(targetUrl);
  };

  const checkPermissionAgain = async () => {
    try {
      const ok = await invoke<boolean>("check_input_permission");
      if (ok) setPermissionProblem(false);
    } catch {
      // ignore — banner just stays up
    }
  };

  const openPermissionSettings = async () => {
    try {
      await invoke("open_input_permission_settings");
    } catch (err) {
      notify("error", "Could not open System Settings", { description: describeError(err) });
    }
  };

  const getFooterText = (): string => {
    switch (mode.status) {
      case "IDLE":
        return listenerActive ? "Ready to scan" : "Not listening. Click Start Listening to scan.";
      case "LISTENING":
        return "Ready to scan";
      case "PROCESSING":
        return "Checking QR code...";
      case "PENDING_REDIRECT":
        return mode.warnings.length > 0
          ? "Check this link before opening"
          : `Opening in ${mode.secondsLeft}...`;
      case "ERROR":
        return mode.message;
      case "GENERATING":
        return mode.feedback || "To generate a QR Code, please type in the website URL above.";
      default:
        return "";
    }
  };

  const getStatusColor = (
    isGenerating: boolean,
    isPending: boolean,
    isProcessing: boolean,
    isListening: boolean,
    isError: boolean,
  ) => {
    if (isError) return "bg-red-500";
    if (isGenerating) return "bg-blue-500 animate-pulse";
    if (isPending) return "bg-blue-400 animate-pulse";
    if (isProcessing) return "bg-yellow-500 animate-pulse";
    if (isListening) return "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]";
    return "bg-zinc-400";
  };

  const handleTabChange = async (tab: string) => {
    const next: Tab = tab === "generator" ? "generator" : "scanner";
    // Set synchronously, before any await, so a scan-input event that
    // arrives mid-switch (bug #6/#7) already sees the new tab.
    setActiveTab(next);

    if (next === "generator") {
      clearRedirectInterval(); // bug #7: cancel silently, no toast
      if (listenerActiveRef.current) {
        await stopListener();
      }
      updateMode({ status: "GENERATING" });
    } else {
      updateMode({ status: "IDLE" });
    }
  };

  /**
   * "Test a scan" from Settings — exercises the exact same pipeline as a
   * real scan (handleScanInput -> process_scan -> history -> countdown),
   * without needing a physical scanner or the global listener to be
   * running. Switches off the Generator tab first if needed, since scans
   * are ignored while it's active.
   */
  const runTestScan = async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return;

    if (isGeneratorTab()) {
      await handleTabChange("scanner");
    }

    if (configRef.current?.show_debug_toasts) {
      notify("info", "Debug", { description: `test scan: ${trimmed}` });
    }

    await handleScanInput(trimmed, "test");
  };

  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-[#09090b] p-8">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            OpenQR couldn't load its settings
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 break-all">{initError}</p>
          <button
            onClick={() => void runInit()}
            className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-full text-xs font-bold"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-[#09090b]">
        <p className="text-zinc-600 dark:text-zinc-400 text-sm">Loading...</p>
      </div>
    );
  }

  const footerText = statusMessage ?? getFooterText();

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 font-sans transition-colors duration-300">
        <Toaster theme={isDark ? "dark" : "light"} position="bottom-left" richColors />

        <Header
          activeTab={activeTab}
          setActiveTab={handleTabChange}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={config}
          onSave={saveConfig}
          onTestScan={runTestScan}
        />

        <main className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
          {activeTab !== "generator" ? (
            <Scanner
              isListening={listenerActive}
              setIsListening={handleScannerToggle}
              status={footerText}
              history={history}
              onClear={clearHistory}
              mode={mode}
              onStop={stopRedirect}
              onOpenAnyway={openAnyway}
              permissionProblem={permissionProblem}
              onCheckPermissionAgain={checkPermissionAgain}
              onOpenPermissionSettings={openPermissionSettings}
            />
          ) : (
            <Generator url={url} setUrl={setUrl} />
          )}
        </main>

        <Footer status={footerText} isListening={listenerActive} mode={mode} getStatusColor={getStatusColor} />
      </div>
    </div>
  );
}

export default App;
