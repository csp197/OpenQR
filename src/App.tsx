import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Sun,
  Moon,
  QrCode,
  Laptop,
  Copy,
  Trash2,
  HelpCircle,
} from "lucide-react";

function App() {
  const [url, setUrl] = useState("https://www.github.com");
  const [isListening, setIsListening] = useState(true);
  const [activeTab, setActiveTab] = useState("scanner");
  const [isDark, setIsDark] = useState(true);
  const [toast, setToast] = useState({ message: "", visible: false });

  // Handle Theme Toggle
  useEffect(() => {
    const root = window.document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [isDark]);

  // Toast logic
  const showToast = (msg: string) => {
    setToast({ message: msg, visible: true });
    setTimeout(() => setToast({ message: "", visible: false }), 3000);
  };

  // Listen for Rust events
  useEffect(() => {
    const unlisten = listen("qr-scanned", (event) => {
      const scannedUrl = event.payload as string;
      showToast(`Scanned: ${scannedUrl}`);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-[#1a1a1a] text-zinc-900 dark:text-zinc-200 font-sans transition-colors duration-300">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-white dark:bg-[#252525] border-b border-zinc-200 dark:border-white/5">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-blue-600" />
          <h1 className="text-sm font-bold tracking-tight dark:text-white uppercase">
            OpenQR
          </h1>
        </div>

        <nav className="flex bg-zinc-200 dark:bg-black/20 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab("scanner")}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === "scanner" ? "bg-white dark:bg-[#3a3a3a] shadow-sm text-blue-600 dark:text-white" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            Scanner
          </button>
          <button
            onClick={() => setActiveTab("generator")}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === "generator" ? "bg-white dark:bg-[#3a3a3a] shadow-sm text-blue-600 dark:text-white" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            Generator
          </button>
        </nav>

        {/* Theme Switcher */}
        <button
          onClick={() => setIsDark(!isDark)}
          className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-yellow-500" />
          ) : (
            <Moon className="w-4 h-4 text-blue-600" />
          )}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
        {activeTab === "scanner" ? (
          <div className="space-y-8">
            <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-2xl p-8 flex flex-col items-center shadow-lg">
              <div
                className={`w-3 h-3 rounded-full mb-4 ${isListening ? "bg-green-500 animate-pulse" : "bg-zinc-400"}`}
              />
              <h2 className="text-4xl font-black tracking-tight mb-2 dark:text-white">
                {isListening ? "Listening..." : "Paused"}
              </h2>
              <button
                onClick={() => setIsListening(!isListening)}
                className={`mt-4 px-8 py-2 rounded-full text-sm font-semibold transition-all ${isListening ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white" : "bg-blue-600 text-white"}`}
              >
                {isListening ? "Stop Service" : "Resume Service"}
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <h3 className="text-xs font-bold uppercase text-zinc-400">
                  Recent Scans
                </h3>
                <div className="flex gap-4">
                  <button className="text-xs text-blue-500 flex items-center gap-1">
                    <Copy size={12} /> Copy
                  </button>
                  <button className="text-xs text-red-500 flex items-center gap-1">
                    <Trash2 size={12} /> Clear
                  </button>
                </div>
              </div>
              <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-xl divide-y dark:divide-white/5">
                <div className="p-4 text-sm font-mono text-zinc-500">
                  No scans detected yet...
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/10 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
              placeholder="Enter URL..."
            />
            <div className="bg-white p-6 rounded-2xl shadow-xl w-fit mx-auto border border-zinc-100">
              <div className="w-48 h-48 bg-zinc-100 rounded flex items-center justify-center text-zinc-400 italic">
                QR View
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="p-3 bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-xl text-xs font-medium shadow-sm">
                Logo & Colors
              </button>
              <button className="p-3 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/20">
                Download PNG
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Blurred Toast Container */}
      <div
        className={`fixed bottom-12 left-1/2 -translate-x-1/2 transition-all duration-500 z-50 ${
          toast.visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        <div className="bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md border border-zinc-200 dark:border-green-500/30 text-zinc-900 dark:text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      </div>

      <footer className="px-6 py-2 bg-green-600 text-white text-[10px] font-bold uppercase tracking-widest text-center">
        Ready to Scan
      </footer>
    </div>
  );
}

export default App;
