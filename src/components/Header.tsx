import { QrCode, Settings as SettingsIcon, Sun, Moon } from "lucide-react";

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

const Header = ({ activeTab, setActiveTab, isDark, onToggleTheme, onOpenSettings }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-6 py-3 bg-white dark:bg-[#252525] border-b border-zinc-200 dark:border-white/5">
      <div className="flex items-center gap-2">
        <QrCode className="w-5 h-5 text-blue-600" />
        <h1 className="text-sm font-bold tracking-tight dark:text-white uppercase text-zinc-900">
          OpenQR
        </h1>
      </div>

      <nav className="flex bg-zinc-200 dark:bg-black/20 p-1 rounded-lg" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "scanner"}
          onClick={() => setActiveTab("scanner")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
            activeTab === "scanner"
              ? "bg-white dark:bg-[#3a3a3a] shadow-sm text-blue-600 dark:text-white"
              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-700"
          }`}
        >
          Scanner
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "generator"}
          onClick={() => setActiveTab("generator")}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
            activeTab === "generator"
              ? "bg-white dark:bg-[#3a3a3a] shadow-sm text-blue-600 dark:text-white"
              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-700"
          }`}
        >
          Generator
        </button>
      </nav>

      <div className="flex items-center gap-1">
        <button
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
        >
          <SettingsIcon className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
        </button>
        <button
          onClick={onToggleTheme}
          aria-label="Switch to light/dark theme"
          className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-yellow-500" />
          ) : (
            <Moon className="w-4 h-4 text-blue-600" />
          )}
        </button>
      </div>
    </header>
  );
};

export default Header;
