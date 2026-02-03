// import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

import { useEffect, useState, useRef } from "react";
import { toast, Toaster } from "sonner";
import { Settings as SettingsIcon } from "lucide-react";

import Footer from "./components/Footer";
import Generator from "./components/Generator";
import Header from "./components/Header";
import Scanner from "./components/Scanner";
import Settings from "./components/Settings";

import "./App.css";

const store = new LazyStore("settings.json");

function App() {
  // The Single Source of Truth
  const [mode, setMode] = useState<AppState>({ status: "IDLE" });
  const [isDark, setIsDark] = useState(true);
  const [url, setUrl] = useState("https://google.com");
  // const [qrCode, setQrCode] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanObject[]>([]);
  const buffer = useRef("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState({
    whitelist: ["google.com", "github.com", "tauri.app"],
    blacklist: ["malicious.site"],
  });

  useEffect(() => {
    const loadSettings = async () => {
      const saved = await store.get<{
        whitelist: string[];
        blacklist: string[];
      }>("security-config");
      if (saved) {
        setConfig(saved);
      }
    };
    loadSettings();
  }, []);

  const saveConfig = async (newConfig: {
    whitelist: string[];
    blacklist: string[];
  }) => {
    setConfig(newConfig);
    await store.set("security-config", newConfig);
    await store.save(); // This writes the JSON to the user's localdisk
  };

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
        // Hardware scanners typically "type" very fast
        // We ignore modifier keys (Shift, Alt, etc)
        if (e.key.length === 1) {
          buffer.current += e.key;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode.status]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const handleProcessScan = async (code: string) => {
    setMode({ status: "PROCESSING", code });
    try {
      // Pass the current config to the Rust command
      await invoke("check_domain", {
        url: code,
        whitelist: config.whitelist,
        blacklist: config.blacklist,
      });

      // Success toast...
    } catch (err: any) {
      toast.error(err.toString()); // Show the specific reason (Blacklisted vs Not Whitelisted)
    } finally {
      setMode({ status: "IDLE" });
    }
  };

  const clearHistory = () => setHistory([]);

  // The UI should never contradict the state
  const isListening = mode.status === "LISTENING";

  // Map our modes to the tabs the Header expects
  const activeTab = mode.status === "GENERATING" ? "generator" : "scanner";

  // Calculate Footer Text
  const getFooterText = () => {
    switch (mode.status) {
      case "IDLE":
        return "Ready to scan";
      case "LISTENING":
        return "Listening for QR code...";
      case "PROCESSING":
        return "Processing QR code...";
      case "ERROR":
        return `Error - ${mode.message}`;
      case "GENERATING":
        return mode.feedback || "Generator Mode";
      default:
        return "No idea lol";
    }
  };

  // Handler for Header tab switching
  const handleTabChange = (tab: string) => {
    if (tab === "generator") {
      setMode({ status: "GENERATING" });
    } else {
      setMode({ status: "IDLE" });
    }
  };

  // Handler for Scanner component to toggle listening
  const handleScannerToggle = (
    shouldListen: boolean | ((prev: boolean) => boolean),
  ) => {
    // Handle both direct boolean and function updates (React pattern)
    const nextState =
      typeof shouldListen === "function"
        ? shouldListen(mode.status === "LISTENING")
        : shouldListen;

    setMode(nextState ? { status: "LISTENING" } : { status: "IDLE" });
  };

  // Handler for Generator to show temporary status messages
  const triggerGenStatus = (msg: string) => {
    setMode({ status: "GENERATING", feedback: msg });

    // Clear the feedback message after 4 seconds, but only if we are still generating
    setTimeout(() => {
      setMode((current) => {
        if (current.status === "GENERATING") {
          return { status: "GENERATING", feedback: undefined };
        }
        return current;
      });
    }, 4000);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 font-sans transition-colors duration-300">
      <Toaster
        theme={isDark ? "dark" : "light"}
        position="bottom-right"
        richColors
      />
      <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 font-sans transition-colors duration-300">
        <Header
          activeTab={activeTab}
          setActiveTab={handleTabChange} // Pass our wrapper handler
          isDark={isDark}
          setIsDark={setIsDark}
        />
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="fixed bottom-20 right-6 p-3 bg-white dark:bg-zinc-800 rounded-full shadow-lg border border-zinc-200 dark:border-white/10 hover:scale-110 transition-transform"
        >
          <SettingsIcon size={20} />
        </button>
        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={config}
          onSave={saveConfig} // Pass the new saving function
        />

        <main className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
          {mode.status !== "GENERATING" ? (
            <Scanner
              isListening={isListening}
              setIsListening={handleScannerToggle}
              status={getFooterText()}
              history={history}
              onClear={clearHistory}
            />
          ) : (
            <Generator url={url} setUrl={setUrl} setStatus={triggerGenStatus} />
          )}
        </main>

        <Footer status={getFooterText()} />
      </div>
    </div>
  );
}

export default App;
