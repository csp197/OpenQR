// import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import Header from "./components/Header";
import Scanner from "./components/Scanner";
import Generator from "./components/Generator";
import Footer from "./components/Footer";
import "./App.css";

function App() {
  // The Single Source of Truth
  const [mode, setMode] = useState<State>({ status: "IDLE" });
  const [isDark, setIsDark] = useState(true);
  const [url, setUrl] = useState("https://google.com");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const buffer = useRef("");

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

  const handleProcessScan = async (code: string) => {
    setMode({ status: "PROCESSING", code });

    try {
      // 1. Validate the domain via Rust
      await invoke("check_domain", { url: code });

      // 2. Success Toast with Action
      toast.success("Safe Link Detected", {
        description: code,
        action: {
          label: "Open Link",
          onClick: () => window.open(code, "_blank"),
        },
      });
    } catch (err) {
      // 3. Error Toast for Blocked Domains
      toast.error("Blocked Untrusted Domain", {
        description: `The URL ${code} is not on the whitelist.`,
        duration: 5000,
      });
    } finally {
      setMode({ status: "IDLE" });
    }
  };

  // The UI should never contradict the state
  const isListening = mode.status === "LISTENING";

  // Map our modes to the tabs the Header expects
  const activeTab = mode.status === "GENERATING" ? "generator" : "scanner";

  // Calculate Footer Text
  const getFooterText = () => {
    switch (mode.status) {
      case "IDLE":
        return "Status: Ready to scan";
      case "LISTENING":
        return "Status: Listening for QR code...";
      case "PROCESSING":
        return "Status: Processing QR code...";
      case "ERROR":
        return `Status: Error - ${mode.message}`;
      case "GENERATING":
        return mode.feedback || "Status: Generator Mode";
      default:
        return "Status: Unknown";
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
    <div
      className={`flex flex-col h-screen transition-colors duration-300 ${isDark ? "dark" : ""}`}
    >
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

        <main className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
          {mode.status !== "GENERATING" ? (
            <Scanner
              isListening={isListening}
              setIsListening={handleScannerToggle}
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
