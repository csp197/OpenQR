import { X, Trash2, FolderOpen, Database, FileJson } from "lucide-react";
import { useState, useEffect } from "react";
import { homeDir, join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Config } from "../App";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config;
  onSave: (newConfig: Config) => void;
}

const Settings = ({ isOpen, onClose, config, onSave }: SettingsProps) => {
  const [allowlist, setAllowlist] = useState(config.allowlist);
  const [blocklist, setBlocklist] = useState(config.blocklist);
  const [historyStorage, setHistoryStorage] = useState(
    config.history_storage_method,
  );
  const [newItem, setNewItem] = useState("");

  useEffect(() => {
    setAllowlist(config.allowlist);
    setBlocklist(config.blocklist);
    setHistoryStorage(config.history_storage_method);
  }, [config, isOpen]);

  if (!isOpen) return null;

  const addItem = (type: "allow" | "block") => {
    const domain = newItem.trim().toLowerCase();
    if (!domain) return;

    if (allowlist.includes(domain) || blocklist.includes(domain)) {
      toast.error(`"${domain}" is already listed`);
      return;
    }

    if (type === "allow") setAllowlist((prev) => [...prev, domain]);
    else setBlocklist((prev) => [...prev, domain]);
    setNewItem("");
  };

  const openSettingsFolder = async () => {
    try {
      const home = await homeDir();
      const folderPath = await join(home, ".openqr");
      await openPath(folderPath);
    } catch (err) {
      toast.error("Could not open settings folder.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-white/10">
        <div className="p-6 border-b dark:border-white/5 flex justify-between items-center">
          <h2 className="text-lg font-bold">App Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Storage Selection */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              How would you like to store your history?
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setHistoryStorage("sqlite")}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-2 transition-all ${
                  historyStorage === "sqlite"
                    ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "border-zinc-200 dark:border-white/5 text-zinc-500"
                }`}
              >
                <Database size={20} />
                <div className="text-center">
                  <p className="text-xs font-bold">SQLite 3</p>
                  <p className="text-[10px] opacity-70">
                    Stores every scan in a sqlite3 database
                  </p>
                </div>
              </button>

              <button
                onClick={() => setHistoryStorage("json")}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-2 transition-all ${
                  historyStorage === "json"
                    ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "border-zinc-200 dark:border-white/5 text-zinc-500"
                }`}
              >
                <FileJson size={20} />
                <div className="text-center">
                  <p className="text-xs font-bold">JSON</p>
                  <p className="text-[10px] opacity-70">
                    Stores only last 100 scans in a JSON file
                  </p>
                </div>
              </button>
            </div>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Lists Section */}
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Add domain..."
                className="flex-1 bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
              />
              <button
                onClick={() => addItem("allow")}
                className="px-3 py-2 bg-green-600 text-white rounded-xl text-xs font-bold"
              >
                Allow
              </button>
              <button
                onClick={() => addItem("block")}
                className="px-3 py-2 bg-red-600 text-white rounded-xl text-xs font-bold"
              >
                Block
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ListSection
                title="Allowlist"
                items={allowlist}
                setItems={setAllowlist}
                color="text-green-500"
              />
              <ListSection
                title="Blocklist"
                items={blocklist}
                setItems={setBlocklist}
                color="text-red-500"
              />
            </div>
          </div>
        </div>

        <div className="p-6 bg-zinc-50 dark:bg-black/20 space-y-3">
          <button
            onClick={() => {
              onSave({
                ...config,
                allowlist,
                blocklist,
                history_storage_method: historyStorage,
              });
              onClose();
            }}
            className="w-full py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-500 transition-colors"
          >
            Save Changes
          </button>

          <button
            onClick={openSettingsFolder}
            className="w-full py-2 flex items-center justify-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-xs transition-colors"
          >
            <FolderOpen size={14} />
            Open configuration folder
          </button>
        </div>
      </div>
    </div>
  );
};

const ListSection = ({ title, items, setItems, color }: any) => (
  <div className="space-y-2">
    <h3 className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>
      {title}
    </h3>
    <div className="space-y-1">
      {items.map((item: string, i: number) => (
        <div
          key={i}
          className="flex justify-between items-center p-2 bg-zinc-100 dark:bg-white/5 rounded-lg text-xs group"
        >
          <span className="truncate">{item}</span>
          <button
            onClick={() =>
              setItems(items.filter((_: any, idx: number) => idx !== i))
            }
            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  </div>
);

export default Settings;
