// import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LazyStore } from "@tauri-apps/plugin-store";
import Database from "@tauri-apps/plugin-sql";

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
};

function App() {
  const [mode, setMode] = useState<AppState>({ status: "IDLE" });
  const [isDark, setIsDark] = useState(true);
  const [url, setUrl] = useState("https://www.google.com");
  const [history, setHistory] = useState<ScanObject[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Config>({
    allowlist: ["good.com"],
    blocklist: ["evil.com"],
    history_storage_method: "json",
    scan_mode: "single",
    notification_type: "toast",
    max_history_items: 100,
    prefix: { mode: "none" },
    suffix: { mode: "enter" },
  });
  const [_, setDb] = useState<Database | null>(null);

  const buffer = useRef("");
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeToastId = useRef<string | number | null>(null);
  const storeRef = useRef<LazyStore | null>(null);

  const getStatusColor = (
    isGenerating: boolean,
    isPending: boolean,
    isProcessing: boolean,
    isListening: boolean,
  ) => {
    // Priority: Generating > Pending > Processing > Listening
    if (isGenerating) return "bg-blue-500 animate-pulse";
    if (isPending) return "bg-blue-400 animate-pulse"; // Slightly lighter blue for redirect
    if (isProcessing) return "bg-yellow-500 animate-pulse";
    if (isListening) return "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]";
    return "bg-zinc-400";
  };

  useEffect(() => {
    const initApp = async () => {
      // 1. Setup Paths & Store
      const home = await homeDir();
      const folderPath = await join(home, ".openqr");
      const filePath = await join(folderPath, "settings.json");

      const folderExists = await exists(folderPath);
      if (!folderExists) {
        await mkdir(folderPath, { recursive: true });
      }

      storeRef.current = new LazyStore(filePath);

      // 2. Load Theme
      const savedTheme = await storeRef.current.get<boolean>("dark-mode");
      if (savedTheme !== null && savedTheme !== undefined) {
        setIsDark(savedTheme);
      }

      // 3. Load Config FIRST to determine storage method
      // We use a local variable 'activeConfig' because state updates (setConfig) are async
      // and won't be ready for the lines below immediately.
      let activeConfig = config;

      const savedConfig =
        await storeRef.current.get<typeof config>("security-config");
      if (savedConfig) {
        setConfig(savedConfig);
        activeConfig = savedConfig;
      }

      if (activeConfig.history_storage_method === "sqlite") {
        // SQL
        console.log("Initializing SQLite Storage...");

        const dbPath = await join(folderPath, "history.db");
        const connector = await Database.load(`sqlite:${dbPath}`);

        await connector.execute(`
          CREATE TABLE IF NOT EXISTS scan_history (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        setDb(connector);

        // Load initial history from DB
        const result = await connector.select<ScanObject[]>(
          "SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT 100",
        );
        setHistory(result);
      } else {
        // JSON
        console.log("Initializing JSON Storage...");
        setDb(null); // setting DB to null just in case

        const savedHistory =
          await storeRef.current.get<ScanObject[]>("scan-history");
        if (savedHistory) {
          setHistory(savedHistory);
        }
      }
    };

    initApp();
  }, []);

  const saveConfig = async (newConfig: typeof config) => {
    if (!storeRef.current) return;
    setConfig(newConfig);
    await storeRef.current.set("security-config", newConfig);
    await storeRef.current.save();
    toast.success("Security settings updated", {
      position: "bottom-left",
      duration: 4000,
    });
  };

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

  useEffect(() => {
    if (mode.status !== "LISTENING") return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const finalCode = buffer.current;
        buffer.current = ""; // Reset buffer

        if (finalCode.length > 0) {
          handleProcessScan(finalCode);
        }
      } else {
        if (e.key.length === 1) {
          buffer.current += e.key;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode.status]);

  const handleProcessScan = async (scannedUrl: string) => {
    setMode({ status: "PROCESSING", url: scannedUrl });

    try {
      const hostName = await invoke("check_url", {
        url: scannedUrl,
        allowList: config.allowlist,
        blockList: config.blocklist,
      });

      const newScan: ScanObject = {
        id: crypto.randomUUID(),
        url: scannedUrl,
        timestamp: new Date().toLocaleString(),
      };
      if (config.history_storage_method == "sqlite") {
        const db = await Database.load("sqlite:history.db");
        await db.execute(
          "INSERT INTO scan_history (id, url, timestamp) VALUES ($1, $2, $3)",
          [newScan.id, newScan.url, newScan.timestamp],
        );
      }

      setHistory((prev) => {
        const updated = [newScan, ...prev].slice(0, 100); // Limit to 100 for performance

        // Save the last 100 scans to settings.json
        if (config.history_storage_method === "json" && storeRef.current) {
          storeRef.current
            .set("scan-history", updated)
            .then(() => storeRef.current?.save());
        }
        return updated;
      });

      setMode({ status: "PENDING_REDIRECT", url: scannedUrl });

      const toastId = toast.success(`Verified: ${hostName}`, {
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
        await openUrl(scannedUrl);
        toast.dismiss(toastId);
        setMode({ status: "IDLE" });
        activeToastId.current = null;
      }, 3000);
    } catch (err: any) {
      toast.error("Blocked", {
        description: err.toString(),
        position: "bottom-left",
        duration: 4000,
      });
      setMode({ status: "IDLE" });
    }
  };

  const stopRedirect = () => {
    if (redirectTimer.current) {
      clearTimeout(redirectTimer.current);
      redirectTimer.current = null;

      if (activeToastId.current) {
        toast.dismiss(activeToastId.current);
        activeToastId.current = null;
      }

      setMode({ status: "IDLE" });
      toast.info("Redirect stopped", {
        position: "bottom-left",
        duration: 4000,
      });
    }
  };

  const clearHistory = async () => {
    setHistory([]);
    if (config.history_storage_method === "json" && storeRef.current) {
      storeRef.current
        .set("scan-history", [])
        .then(() => storeRef.current?.save());
    }
  };

  // const isListening = mode.status === "LISTENING";
  // const activeTab = mode.status === "GENERATING" ? "generator" : "scanner";

  const getFooterText = () => {
    switch (mode.status) {
      case "IDLE":
        return "NOT Listening";
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

  // Handler for Header tab switching
  const handleTabChange = (tab: string) => {
    if (tab === "generator") setMode({ status: "GENERATING" });
    else setMode({ status: "IDLE" });
  };

  // Handler for Scanner component to toggle listening
  const handleScannerToggle = (
    shouldListen: boolean | ((prev: boolean) => boolean),
  ) => {
    const nextState =
      typeof shouldListen === "function"
        ? shouldListen(mode.status === "LISTENING")
        : shouldListen;
    setMode(nextState ? { status: "LISTENING" } : { status: "IDLE" });
  };

  // Handler for Generator to show temporary status messages
  // const triggerGenStatus = (msg: string) => {
  //   setMode({ status: "GENERATING", feedback: msg });
  //   setTimeout(() => {
  //     setMode((current) => {
  //       if (current.status === "GENERATING")
  //         return { status: "GENERATING", feedback: undefined };
  //       return current;
  //     });
  //   }, 4000);
  // };

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
              isListening={mode.status === "LISTENING"}
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
          isListening={mode.status === "LISTENING"}
          mode={mode}
          getStatusColor={getStatusColor}
        />
      </div>
    </div>
  );
}

export default App;
