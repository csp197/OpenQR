import { Copy, Trash2, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
interface ScannerProps {
  isListening: boolean;
  setIsListening: (val: boolean) => void;
  status: string;
  history: { id: string; url: string; timestamp: string }[];
  onClear: () => void;
}

const Scanner = ({
  isListening,
  setIsListening,
  status,
  history,
  onClear,
}: ScannerProps) => {
  const isProcessing = status.includes("Processing");

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const copyAll = () => {
    const allUrls = history.map((h) => h.url).join("\n");
    copyToClipboard(allUrls);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-2xl p-8 flex flex-col items-center shadow-lg">
        <div
          className={`w-3 h-3 rounded-full mb-4 transition-colors ${
            isProcessing
              ? "bg-yellow-500 animate-pulse"
              : isListening
                ? "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]"
                : "bg-zinc-400"
          }`}
        />
        <h2 className="text-4xl font-black tracking-tight mb-2 dark:text-white text-center">
          {isProcessing
            ? "Checking..."
            : isListening
              ? "Listening..."
              : "Paused"}
        </h2>
        <p className="text-zinc-500 text-sm mb-6 text-center max-w-xs">
          {status}
        </p>
        <button
          disabled={isProcessing}
          onClick={() => setIsListening(!isListening)}
          className={`px-8 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
            isListening
              ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200"
              : "bg-blue-600 text-white hover:bg-blue-500"
          } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {isProcessing && <Loader2 size={16} className="animate-spin" />}
          {isListening ? "Stop Listening" : "Start Listening"}
        </button>
      </div>
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
                    onClick={() => window.open(item.url, "_blank")}
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
