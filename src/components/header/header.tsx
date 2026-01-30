import { QrCode, Sun, Moon } from "lucide-react";
import { useState } from "react";

const Header = () => {
  const [activeTab, setActiveTab] = useState("scanner");
  const [isDark, setIsDark] = useState(true);
  return (
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
  );
};

export default Header;
