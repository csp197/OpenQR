import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LazyStore } from "@tauri-apps/plugin-store";
import { homeDir, join } from "@tauri-apps/api/path";

import { useEffect, useState, useRef } from "react";
import { toast, Toaster } from "sonner";
import { Settings as SettingsIcon } from "lucide-react";

import Footer from "./components/Footer";
import Generator from "./components/Generator";
import Header from "./components/Header";
import Scanner from "./components/Scanner";
import Settings from "./components/Settings";

import "./App.css";

type AppState =
  | { status: "IDLE" }
  | { status: "LISTENING" }
  | { status: "PROCESSING"; url: string }
  | { status: "PENDING_REDIRECT"; url: string }
  | { status: "GENERATING"; feedback?: string }
  | { status: "ERROR"; message: string };

type ScanObject = {
  id: string;
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
};

function App() {
  const [mode, setMode] = useState<AppState>({ status: "IDLE" });
  const [isDark, setIsDark] = useState(true);
  const [url, setUrl] = useState("https://www.google.com");
  const [history, setHistory] = useState<ScanObject[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [listenerActive, setListenerActive] = useState(false);

  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeToastId = useRef<string | number | null>(null);
  const storeRef = useRef<LazyStore | null>(null);

  const notify = (
    type: "success" | "error" | "info",
    message: string,
    opts?: {
      description?: string;
      icon?: string;
      duration?: number;
      action?: { label: string; onClick: () => void };
    },
  ) => {
    if (config?.notification_type === "status") return;
    toast[type](message, {
      position: "bottom-left",
      duration: opts?.duration ?? 4000,
      ...opts,
    });
  };

  const getStatusColor = (
    isGenerating: boolean,
    isPending: boolean,
    isProcessing: boolean,
    isListening: boolean,
  ) => {
    if (isGenerating) return "bg-blue-500 animate-pulse";
    if (isPending) return "bg-blue-400 animate-pulse";
    if (isProcessing) return "bg-yellow-500 animate-pulse";
    if (isListening) return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]";
    return "bg-zinc-400";
  };

  // Initialize: load config and history from Rust, theme from store
  useEffect(() => {
    const init = async () => {
      // Load theme from LazyStore (stays in frontend)
      const home = await homeDir();
      const folderPath = await join(home, ".openqr");
      const filePath = await join(folderPath, "settings.json");
      storeRef.current = new LazyStore(filePath);

      const savedTheme = await storeRef.current.get<boolean>("dark-mode");
      if (savedTheme !== null && savedTheme !== undefined) {
        setIsDark(savedTheme);
      }

      // Load config and history from Rust backend
      const cfg = await invoke<Config>("get_config");
      setConfig(cfg);

      const hist = await invoke<ScanObject[]>("get_history");
      setHistory(hist);
    };
    init();
  }, []);

  // Listen for scan events from rdev global listener
  useEffect(() => {
    const unlisten = listen<string>("scan-input", async (event) => {
      const rawInput = event.payload;
      setMode({ status: "PROCESSING", url: rawInput });

      try {
        const hostname = await invoke<string>("process_scan", { rawInput });

        // Refresh history from Rust
        const hist = await invoke<ScanObject[]>("get_history");
        setHistory(hist);

        setMode({ status: "PENDING_REDIRECT", url: rawInput });

        const toastId = toast.success(`Verified: ${hostname}`, {
          position: "bottom-left",
          description: "Opening browser shortly...",
          duration: 4000,
          icon: "🌐",
          action: {
            label: "Cancel",
            onClick: () => stopRedirect(),
          },
        });
        activeToastId.current = toastId;

        redirectTimer.current = setTimeout(async () => {
          await openUrl(rawInput);
          toast.dismiss(toastId);
          activeToastId.current = null;

          if (config?.scan_mode === "single") {
            await invoke("stop_global_listener");
            setListenerActive(false);
            setMode({ status: "IDLE" });
          } else {
            setMode({ status: "LISTENING" });
          }
        }, 3000);
      } catch (err: any) {
        notify("error", "Blocked", { description: err.toString() });
        // Keep listener running on error — user can try another scan.
        // Only a successful scan in single mode stops the listener.
        setMode({ status: "LISTENING" });
      }
    });

    // Debug: show what the buffer actually captured
    const unlistenDebug = listen<string>("scan-debug", (event) => {
      console.log("[scan-debug]", event.payload);
      toast.info("Debug", {
        description: event.payload,
        position: "bottom-left",
        duration: 10000,
      });
    });

    // Listen for scan errors (e.g. rdev permission issues)
    const unlistenErr = listen<string>("scan-error", (event) => {
      notify("error", "Listener Error", {
        description: event.payload,
        duration: 10000,
      });
      setListenerActive(false);
      setMode({ status: "IDLE" });
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenDebug.then((fn) => fn());
      unlistenErr.then((fn) => fn());
    };
  }, [config]);

  // Theme persistence
  useEffect(() => {
    if (isDark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");

    const saveTheme = async () => {
      if (storeRef.current) {
        await storeRef.current.set("dark-mode", isDark);
        await storeRef.current.save();
      }
    };
    saveTheme();
  }, [isDark]);

  // Sync tray icon state with app mode
  useEffect(() => {
    let trayState: string;
    if (mode.status === "GENERATING") {
      trayState = "generating";
    } else if (listenerActive) {
      trayState = "listening";
    } else {
      trayState = "idle";
    }
    invoke("set_tray_state", { trayState }).catch(() => {});
  }, [mode.status, listenerActive]);

  const toggleListening = async (shouldListen: boolean) => {
    try {
      if (shouldListen) {
        await invoke("start_global_listener");
        setListenerActive(true);
        setMode({ status: "LISTENING" });
      } else {
        await invoke("stop_global_listener");
        setListenerActive(false);
        setMode({ status: "IDLE" });
      }
    } catch (err: any) {
      notify("error", "Listener error", { description: err.toString() });
    }
  };

  const handleScannerToggle = (
    shouldListen: boolean | ((prev: boolean) => boolean),
  ) => {
    const nextState =
      typeof shouldListen === "function"
        ? shouldListen(listenerActive)
        : shouldListen;
    toggleListening(nextState);
  };

  const saveConfig = async (newConfig: Config) => {
    try {
      await invoke("save_config", { config: newConfig });
      setConfig(newConfig);
      notify("success", "Settings updated");
    } catch (err: any) {
      notify("error", "Failed to save settings", {
        description: err.toString(),
      });
    }
  };

  const clearHistory = async () => {
    try {
      await invoke("clear_history");
      setHistory([]);
    } catch (err: any) {
      notify("error", "Failed to clear history", {
        description: err.toString(),
      });
    }
  };

  const stopRedirect = async () => {
    if (redirectTimer.current) {
      clearTimeout(redirectTimer.current);
      redirectTimer.current = null;

      if (activeToastId.current) {
        toast.dismiss(activeToastId.current);
        activeToastId.current = null;
      }

      if (config?.scan_mode === "continuous") {
        setMode({ status: "LISTENING" });
      } else {
        await invoke("stop_global_listener");
        setListenerActive(false);
        setMode({ status: "IDLE" });
      }
      notify("info", "Redirect stopped");
    }
  };

  const getFooterText = () => {
    switch (mode.status) {
      case "IDLE":
        return listenerActive ? "Listening for QR code..." : "NOT Listening";
      case "LISTENING":
        return "Listening for QR code...";
      case "PROCESSING":
        return "Processing QR code...";
      case "PENDING_REDIRECT":
        return "Verifying URL...";
      case "ERROR":
        return `Error - ${mode.message}`;
      case "GENERATING":
        return mode.feedback || "Generating QR Code...";
      default:
        return "";
    }
  };

  const handleTabChange = async (tab: string) => {
    if (tab === "generator") {
      if (listenerActive) {
        await invoke("stop_global_listener");
        setListenerActive(false);
      }
      setMode({ status: "GENERATING" });
    } else {
      setMode({ status: "IDLE" });
    }
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-[#09090b]">
        <p className="text-zinc-500 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 font-sans transition-colors duration-300">
        <Toaster
          theme={isDark ? "dark" : "light"}
          position="bottom-right"
          richColors
        />

        <Header
          activeTab={mode.status === "GENERATING" ? "generator" : "scanner"}
          setActiveTab={handleTabChange}
          isDark={isDark}
          setIsDark={setIsDark}
        />

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="fixed bottom-20 right-6 p-3 bg-white dark:bg-zinc-800 rounded-full shadow-lg border border-zinc-200 dark:border-white/10 hover:scale-110 transition-transform z-50"
        >
          <SettingsIcon size={20} />
        </button>

        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={config}
          onSave={saveConfig}
        />

        <main className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
          {mode.status !== "GENERATING" ? (
            <Scanner
              isListening={listenerActive}
              setIsListening={handleScannerToggle}
              status={getFooterText()}
              history={history}
              onClear={clearHistory}
              mode={mode}
              onStop={stopRedirect}
              getStatusColor={getStatusColor}
            />
          ) : (
            <Generator url={url} setUrl={setUrl} />
          )}
        </main>

        <Footer
          status={getFooterText()}
          isListening={listenerActive}
          mode={mode}
          getStatusColor={getStatusColor}
        />
      </div>
    </div>
  );
}

export default App;
