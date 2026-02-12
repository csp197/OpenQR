import { X, FolderOpen } from "lucide-react";
import { useState, useEffect } from "react";
import { homeDir, join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Config } from "../App";
import ListSection from "./ListSection";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config;
  onSave: (newConfig: Config) => void;
}

const Settings = ({ isOpen, onClose, config, onSave }: SettingsProps) => {
  const [allowlist, setAllowlist] = useState(config.allowlist);
  const [blocklist, setBlocklist] = useState(config.blocklist);
  const [scanMode, setScanMode] = useState(config.scan_mode);
  const [notificationType, setNotificationType] = useState(
    config.notification_type,
  );
  const [maxHistory, setMaxHistory] = useState(config.max_history_items);
  const [prefixMode, setPrefixMode] = useState(config.prefix.mode);
  const [prefixValue, setPrefixValue] = useState(config.prefix.value || "");
  const [suffixMode, setSuffixMode] = useState(config.suffix.mode);
  const [suffixValue, setSuffixValue] = useState(config.suffix.value || "");
  const [closeToTray, setCloseToTray] = useState(config.close_to_tray);
  const [newItem, setNewItem] = useState("");

  useEffect(() => {
    setAllowlist(config.allowlist);
    setBlocklist(config.blocklist);
    setScanMode(config.scan_mode);
    setNotificationType(config.notification_type);
    setMaxHistory(config.max_history_items);
    setPrefixMode(config.prefix.mode);
    setPrefixValue(config.prefix.value || "");
    setSuffixMode(config.suffix.mode);
    setSuffixValue(config.suffix.value || "");
    setCloseToTray(config.close_to_tray);
  }, [config, isOpen]);

  if (!isOpen) return null;

  const addItem = (type: "allow" | "block") => {
    const domain = newItem.trim().toLowerCase();
    if (!domain) return;

    if (allowlist.includes(domain) || blocklist.includes(domain)) {
      toast.error(`"${domain}" is already listed`, {
        position: "bottom-left",
        duration: 4000,
      });
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
      toast.error("Could not open settings folder.", {
        position: "bottom-left",
        duration: 4000,
      });
    }
  };

  const handleSave = () => {
    onSave({
      ...config,
      allowlist,
      blocklist,
      scan_mode: scanMode,
      notification_type: notificationType,
      max_history_items: maxHistory,
      prefix: {
        mode: prefixMode,
        value: prefixMode === "custom" ? prefixValue : undefined,
      },
      suffix: {
        mode: suffixMode,
        value: suffixMode === "custom" ? suffixValue : undefined,
      },
      close_to_tray: closeToTray,
    });
    onClose();
  };

  type ToggleOption<T extends string> = { value: T; label: string };

  const ToggleGroup = <T extends string>({
    options,
    value,
    onChange,
  }: {
    options: ToggleOption<T>[];
    value: T;
    onChange: (v: T) => void;
  }) => (
    <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
            value === opt.value
              ? "bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

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
          {/* Scan Mode */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Scan Mode
            </h3>
            <ToggleGroup
              options={[
                { value: "single" as const, label: "Single" },
                { value: "continuous" as const, label: "Continuous" },
              ]}
              value={scanMode}
              onChange={setScanMode}
            />
            <p className="text-[10px] text-zinc-400">
              {scanMode === "single"
                ? "Stops listening after one scan"
                : "Keeps listening for more scans"}
            </p>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Notification Type */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Notifications
            </h3>
            <ToggleGroup
              options={[
                { value: "toast" as const, label: "Toast Popups" },
                { value: "status" as const, label: "Status Bar Only" },
              ]}
              value={notificationType}
              onChange={setNotificationType}
            />
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Max History */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Max History Items
            </h3>
            <input
              type="number"
              value={maxHistory}
              onChange={(e) =>
                setMaxHistory(Math.max(1, parseInt(e.target.value) || 1))
              }
              min={1}
              max={10000}
              className="w-full bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
            />
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Prefix */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Scanner Prefix
            </h3>
            <ToggleGroup
              options={[
                { value: "none" as const, label: "None" },
                { value: "default" as const, label: "Default" },
                { value: "custom" as const, label: "Custom" },
              ]}
              value={prefixMode}
              onChange={setPrefixMode}
            />
            {prefixMode === "custom" && (
              <input
                value={prefixValue}
                onChange={(e) => setPrefixValue(e.target.value)}
                placeholder="Enter custom prefix..."
                className="w-full bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
              />
            )}
            <p className="text-[10px] text-zinc-400">
              {prefixMode === "none"
                ? "No prefix stripping"
                : prefixMode === "default"
                  ? 'Strips common prefixes like "QR:"'
                  : "Strips your custom prefix from scanned input"}
            </p>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Suffix */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Scanner Suffix
            </h3>
            <ToggleGroup
              options={[
                { value: "none" as const, label: "None" },
                { value: "enter" as const, label: "Enter" },
                { value: "tab" as const, label: "Tab" },
                { value: "custom" as const, label: "Custom" },
              ]}
              value={suffixMode}
              onChange={setSuffixMode}
            />
            {suffixMode === "custom" && (
              <input
                value={suffixValue}
                onChange={(e) => setSuffixValue(e.target.value)}
                placeholder="Enter custom suffix..."
                className="w-full bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl text-sm outline-none border border-transparent focus:border-blue-500"
              />
            )}
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Close to Tray */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                Minimize to Tray
              </h3>
              <p className="text-[10px] text-zinc-400 mt-1">
                Keep running in background when window is closed
              </p>
            </div>
            <button
              onClick={() => setCloseToTray(!closeToTray)}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                closeToTray ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                  closeToTray ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>

          <hr className="border-zinc-200 dark:border-white/5" />

          {/* Allowlist / Blocklist */}
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
                placeholder="All URLs are allowed by default"
              />
              <ListSection
                title="Blocklist"
                items={blocklist}
                setItems={setBlocklist}
                color="text-red-500"
                placeholder="No URLs are currently blocked"
              />
            </div>
          </div>
        </div>

        <div className="p-6 bg-zinc-50 dark:bg-black/20 space-y-3">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-500 transition-colors"
          >
            Save Changes
          </button>

          <button
            onClick={openSettingsFolder}
            className="w-full py-2 flex items-center justify-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 text-xs transition-colors"
          >
            <FolderOpen size={14} />
            Open config folder
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
