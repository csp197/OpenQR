import {
  // React,
  useState,
  useRef,
} from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  // Download,
  // Palette,
  Image as ImageIcon,
  Copy,
  // Check,
} from "lucide-react";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";

interface GeneratorProps {
  url: string;
  setUrl: (val: string) => void;
  setStatus: (msg: string) => void; // New prop for the footer
}

const Generator = ({ url, setUrl, setStatus }: GeneratorProps) => {
  const [fgColor, setFgColor] = useState("#000000");
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const qrRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValidUrl = (string: string) => {
    try {
      const parsed = new URL(string);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  };

  // 1. Color Fix: Programmatically trigger the color picker
  const handleColorClick = () => {
    if (colorInputRef.current) {
      colorInputRef.current.focus();
      colorInputRef.current.click();
    }
  };

  // 2. Copy Fix: Enhanced for Tauri/Webview
  const copyToClipboard = async () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;

    try {
      setStatus("Encoding...");

      // 1. Convert canvas to a Blob (PNG format)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );

      if (!blob) throw new Error("Failed to create blob");

      // 2. Convert Blob to Uint8Array (this now contains PNG headers)
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // 3. Use Image.fromBytes instead of fromRgbaBytes
      // This method allows Rust to see the PNG headers and identify the format
      const tauriImage = await Image.fromBytes(bytes);

      // 4. Write to clipboard
      await writeImage(tauriImage);

      setStatus("✓ Copied to clipboard!");
    } catch (err) {
      console.error("Native copy failed:", err);
      setStatus("Copy failed: Format error");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
          URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={`w-full bg-slate-100 dark:bg-zinc-900 border rounded-2xl p-4 text-sm outline-none transition-all ${
            url && !isValidUrl(url)
              ? "border-red-500"
              : "border-transparent focus:ring-2 focus:ring-blue-500"
          }`}
          placeholder="https://..."
        />
      </div>

      <div className="relative flex justify-center py-4">
        <div
          ref={qrRef}
          className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100"
        >
          {url ? (
            <QRCodeCanvas
              value={url}
              size={180}
              fgColor={fgColor}
              level="H"
              imageSettings={
                logo
                  ? { src: logo, height: 40, width: 40, excavate: true }
                  : undefined
              }
            />
          ) : (
            <div className="w-[180px] h-[180px] border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-xs">
              Ready...
            </div>
          )}
        </div>

        {url && (
          <button
            onClick={copyToClipboard}
            className="absolute bottom-6 right-1/2 translate-x-28 p-2 bg-white rounded-full shadow-md hover:bg-slate-50 border border-slate-100"
          >
            <Copy size={16} className="text-slate-600" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Style/Color Button */}
        <div className="relative">
          <button
            onClick={handleColorClick}
            className="w-full flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl text-xs font-semibold"
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: fgColor }}
            />
            Styles
          </button>
          <input
            type="color"
            ref={colorInputRef}
            value={fgColor}
            onChange={(e) => setFgColor(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
          />
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl text-xs font-semibold"
        >
          <ImageIcon size={14} className="text-purple-500" />
          Logo
        </button>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onloadend = () => setLogo(reader.result as string);
              reader.readAsDataURL(file);
              setStatus("Logo added!");
            }
          }}
        />
      </div>
    </div>
  );
};

export default Generator;
