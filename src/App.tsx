// import { listen } from "@tauri-apps/api/event";
// import { invoke } from "@tauri-apps/api/core";

import { useState } from "react";
import Header from "./components/Header";
import Scanner from "./components/Scanner";
import Generator from "./components/Generator";
import Footer from "./components/Footer";

function App() {
  const [activeTab, setActiveTab] = useState("scanner");
  const [isDark, setIsDark] = useState(true);
  const [url, setUrl] = useState("https://github.com");
  const [isListening, setIsListening] = useState(true);

  return (
    <div
      className={`flex flex-col h-screen transition-colors duration-300 ${isDark ? "dark" : ""}`}
    >
      <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 font-sans transition-colors duration-300">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isDark={isDark}
          setIsDark={setIsDark}
        />

        <main className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
          {activeTab === "scanner" ? (
            <Scanner
              isListening={isListening}
              setIsListening={setIsListening}
              qrCode={null}
              setQrCode={() => {}}
            />
          ) : (
            <Generator url={url} setUrl={setUrl} />
          )}
        </main>

        <Footer />
      </div>
    </div>
  );
}

export default App;
