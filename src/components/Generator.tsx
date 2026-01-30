import { QRCodeSVG } from "qrcode.react";
import { Download, Palette, Image as ImageIcon } from "lucide-react";

interface GeneratorProps {
  url: string;
  setUrl: (val: string) => void;
}

const Generator = ({ url, setUrl }: GeneratorProps) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Input Field */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500 px-1">
          Destination URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full bg-slate-100 dark:bg-[#0f0f11] border border-slate-200 dark:border-white/5 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-inner dark:text-white"
          placeholder="https://example.com"
        />
      </div>

      {/* QR Preview Area */}
      <div className="relative group">
        <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-fit mx-auto border border-slate-100 transition-all duration-500 group-hover:scale-[1.03] group-hover:shadow-blue-500/10">
          {url ? (
            <QRCodeSVG
              value={url}
              size={200}
              level="H" // High error correction (allows for logos)
              includeMargin={false}
              className="transition-opacity duration-300"
            />
          ) : (
            <div className="w-[200px] h-[200px] flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs italic">
              Waiting for URL...
            </div>
          )}
        </div>

        {/* Subtle decorative glow for Dark Mode */}
        <div className="absolute -inset-4 bg-blue-500/5 blur-3xl rounded-full -z-10 opacity-0 dark:group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-[#1a1a1c] border border-slate-200 dark:border-white/5 rounded-2xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#212124] transition-all shadow-sm">
          <Palette size={14} className="text-blue-500" />
          Styles
        </button>
        <button className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-[#1a1a1c] border border-slate-200 dark:border-white/5 rounded-2xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#212124] transition-all shadow-sm">
          <ImageIcon size={14} className="text-purple-500" />
          Add Logo
        </button>
        <button className="flex items-center justify-center gap-2 p-4 bg-blue-600 text-white rounded-2xl text-xs font-bold shadow-lg shadow-blue-500/30 hover:bg-blue-500 hover:-translate-y-0.5 active:translate-y-0 transition-all col-span-2">
          <Download size={16} />
          Export High-Res PNG
        </button>
      </div>
    </div>
  );
};

export default Generator;
