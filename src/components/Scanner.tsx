import { Copy, Trash2 } from "lucide-react";

interface ScannerProps {
  isListening: boolean;
  setIsListening: (val: boolean) => void;
  status: string; // Pass the status here for the large text
}

const Scanner = ({ isListening, setIsListening }: ScannerProps) => {
  const isProcessing = status === "PROCESSING";
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-2xl p-8 flex flex-col items-center shadow-lg">
        <div
          className={`w-3 h-3 rounded-full mb-4 ${isListening ? "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]" : "bg-zinc-400"}`}
        />
        <h2 className="text-4xl font-black tracking-tight mb-2 dark:text-white">
          {isProcessing
            ? "Checking..."
            : isListening
              ? "Listening..."
              : "Paused"}
        </h2>
        <p className="text-zinc-500 text-sm mb-6 text-center max-w-xs">
          Ready to capture input from your hardware QR scanner.
        </p>
        <button
          disabled={isProcessing}
          onClick={() => setIsListening(!isListening)}
          className={`px-8 py-2 rounded-full text-sm font-semibold transition-all ${
            isListening
              ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200"
              : "bg-blue-600 text-white hover:bg-blue-500"
          } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {isListening ? "Stop Listening" : "Start Listening"}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            Recent Scans
          </h3>
          <div className="flex gap-4">
            <button className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
              <Copy size={12} /> Copy All
            </button>
            <button className="text-xs text-red-500 flex items-center gap-1 hover:underline">
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-[#252525] border border-zinc-200 dark:border-white/5 rounded-xl divide-y dark:divide-white/5 overflow-hidden">
          <div className="p-4 text-sm font-mono text-zinc-500 italic">
            No scans detected in this session...
          </div>
        </div>
      </div>
    </div>
  );
};

export default Scanner;
