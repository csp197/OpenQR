import { Copy, Trash2, Loader2, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";

interface ScannerProps {
  isListening: boolean;
  setIsListening: (val: boolean) => void;
  status: string;
  history: { id: string; url: string; timestamp: string }[];
  onClear: () => void;
  mode: { status: string; url?: string };
  onStop: () => void;
  getStatusColor: (
    isGenerating: boolean,
    isPending: boolean,
    isProcessing: boolean,
    isListening: boolean,
  ) => string;
}

const Scanner = ({
  isListening,
  setIsListening,
  status,
  history,
  onClear,
  mode,
  onStop,
}: ScannerProps) => {
  const isProcessing = mode.status === "PROCESSING";
  const isPending = mode.status === "PENDING_REDIRECT";
  const isGenerating = mode.status === "GENERATING";

  const getIndicatorClasses = () => {
    if (isGenerating)
      return "bg-blue-500 animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.5)]";
    if (isPending) return "bg-blue-400 animate-pulse";
    if (isProcessing) return "bg-yellow-500 animate-pulse";
    if (isListening)
      return "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]";
    return "bg-zinc-400";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard", {
      position: "bottom-left",
      duration: 4000,
    });
  };

  const copyAll = () => {
    const allUrls = history.map((h) => h.url).join("\n");
    copyToClipboard(allUrls);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div
        className={`bg-white dark:bg-[#252525] border transition-all duration-500 rounded-2xl p-8 flex flex-col items-center shadow-lg
            ${isPending ? "border-blue-500/50 shadow-blue-500/10" : "border-zinc-200 dark:border-white/5"}`}
      >
        <div
          className={`w-4 h-4 rounded-full mb-4 transition-all duration-500 flex items-center justify-center ${getIndicatorClasses()}`}
        >
          {isPending && (
            <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
          )}
        </div>

        <h2 className="text-4xl font-black tracking-tight mb-2 dark:text-white text-center transition-all">
          {isPending
            ? "Opening..."
            : isProcessing
              ? "Checking..."
              : isListening
                ? "Listening..."
                : "Ready"}
        </h2>

        {/* Subtext / URL Display */}
        <p
          className={`text-sm mb-8 text-center max-w-xs transition-colors font-mono
          ${
            isPending
              ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-full truncate w-full"
              : "text-zinc-500"
          }`}
        >
          {isPending ? mode.url : status}
        </p>

        {/* Action Buttons Area */}
        <div className="flex gap-3 w-full justify-center">
          {isPending ? (
            <>
              {/* Cancel Button */}
              <button
                onClick={onStop}
                className="px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-full text-sm font-bold flex items-center gap-2 transition-all"
              >
                <X size={16} /> Cancel
              </button>

              {/* Copy Pending URL Button */}
              <button
                onClick={() => mode.url && copyToClipboard(mode.url)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20"
              >
                <Copy size={16} /> Copy Link
              </button>
            </>
          ) : (
            /* Normal Listening Toggle */
            <button
              disabled={isProcessing}
              onClick={() => setIsListening(!isListening)}
              className={`px-8 py-2.5 rounded-full text-sm font-bold transition-all flex items-center gap-2 shadow-sm ${
                isListening
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  : "bg-zinc-900 dark:bg-white text-white dark:text-black hover:scale-105"
              } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isProcessing && <Loader2 size={16} className="animate-spin" />}
              {isListening ? "Stop Listening" : "Start Listening"}
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            Recent Scans
          </h3>
          {history.length > 0 && (
            <div className="flex gap-4">
              <button
                onClick={copyAll}
                className="text-xs text-blue-500 flex items-center gap-1 hover:underline"
              >
                <Copy size={12} /> Copy All
              </button>
              <button
                onClick={onClear}
                className="text-xs text-red-500 flex items-center gap-1 hover:underline"
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-xl divide-y dark:divide-white/5 overflow-hidden">
          {history.length === 0 ? (
            <div className="p-4 text-sm font-mono text-zinc-500 italic text-center">
              No scans detected in this session...
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="p-4 flex justify-between items-center group hover:bg-zinc-50 dark:hover:bg-white/2 transition-colors"
              >
                <div className="flex flex-col min-w-0 pr-4">
                  <span className="text-sm font-mono text-zinc-900 dark:text-zinc-100 truncate">
                    {item.url}
                  </span>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-tight">
                    {item.timestamp}
                  </span>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyToClipboard(item.url)}
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md text-zinc-500"
                    title="Copy URL"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => openUrl(item.url)}
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md text-zinc-500"
                    title="Open in Browser"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Scanner;
