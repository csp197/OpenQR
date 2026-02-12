import { useState, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Image as ImageIcon, Copy, Download } from "lucide-react";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";

interface GeneratorProps {
  url: string;
  setUrl: (val: string) => void;
}

const Generator = ({ url, setUrl }: GeneratorProps) => {
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const qrRef = useRef<HTMLDivElement>(null);
  const fgColorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValidUrl = (string: string) => {
    try {
      const parsed = new URL(string);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  };

  const copyToClipboard = async () => {
    const borderedCanvas = getBorderedCanvas();
    if (!borderedCanvas) return;

    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        borderedCanvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Blob failed");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const tauriImage = await Image.fromBytes(bytes);
      await writeImage(tauriImage);
      toast.success("Copied to clipboard!", {
        position: "bottom-left",
        duration: 4000,
      });
    } catch (err) {
      toast.error("Copy failed", { position: "bottom-left", duration: 4000 });
    }
  };

  const getBorderedCanvas = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return null;

    const padding = canvas.width * 0.08;
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = canvas.width + padding;
    offscreenCanvas.height = canvas.height + padding;

    const ctx = offscreenCanvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    ctx.drawImage(canvas, padding / 2, padding / 2);

    return offscreenCanvas;
  };

  const downloadImage = async () => {
    const borderedCanvas = getBorderedCanvas();
    if (!borderedCanvas) return;

    try {
      const filePath = await save({
        filters: [{ name: "Image", extensions: ["png"] }],
        defaultPath: `${new URL(url).host}_qrcode.png`,
      });

      if (!filePath) return; // User cancelled
      const blob = await new Promise<Blob | null>((resolve) =>
        borderedCanvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Blob creation failed");

      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      await writeFile(filePath, bytes);
      toast.success(`Downloaded to ${filePath}!`);
    } catch (err) {
      console.error("Download failed:", err);
      toast.error("Download failed", {
        position: "bottom-left",
        duration: 4000,
      });
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
          className="bg-white p-5 rounded-4xl shadow-xl border border-slate-100"
        >
          {url ? (
            <QRCodeCanvas
              value={url}
              size={180}
              fgColor={fgColor}
              bgColor={bgColor}
              level="H"
              imageSettings={
                logo
                  ? { src: logo, height: 40, width: 40, excavate: true }
                  : undefined
              }
            />
          ) : (
            <div className="w-45 h-45 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-xs">
              Ready...
            </div>
          )}
        </div>

        {url && (
          <div className="absolute bottom-6 flex gap-2 translate-x-1/2 right-1/2 ml-28">
            <button
              onClick={copyToClipboard}
              title="Copy to Clipboard"
              className="p-2 bg-white rounded-full shadow-md hover:bg-slate-50 border border-slate-100 transition-transform active:scale-95"
            >
              <Copy size={16} className="text-slate-600" />
            </button>
            <button
              onClick={downloadImage}
              title="Download PNG"
              className="p-2 bg-white rounded-full shadow-md hover:bg-slate-50 border border-slate-100 transition-transform active:scale-95"
            >
              <Download size={16} className="text-blue-600" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Style/Color Button */}
        <div className="relative">
          <button
            onClick={() => fgColorInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border rounded-2xl text-xs font-semibold"
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: fgColor }}
            />
            Foreground
          </button>
          <input
            type="color"
            ref={fgColorInputRef}
            value={fgColor}
            onChange={(e) => setFgColor(e.target.value)}
            className="absolute inset-0 opacity-0 pointer-events-none"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => bgColorInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border rounded-2xl text-xs font-semibold"
          >
            <div
              className="w-3 h-3 rounded-full border"
              style={{ backgroundColor: bgColor }}
            />
            Background
          </button>
          <input
            type="color"
            ref={bgColorInputRef}
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="absolute inset-0 opacity-0 pointer-events-none"
          />
        </div>

        <button
          onClick={() => {
            fileInputRef.current?.click();
          }}
          className="w-full flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border rounded-2xl text-xs font-semibold"
        >
          <ImageIcon size={14} className="text-purple-500" />
          Upload Logo
        </button>

        <button
          onClick={() => {
            setLogo(undefined);
            toast.success("Logo removed", {
              position: "bottom-left",
              duration: 4000,
            });
          }}
          className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border border-red-200 text-red-600 rounded-2xl text-xs font-semibold"
        >
          Remove Logo
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
              toast.success("Logo added!", {
                position: "bottom-left",
                duration: 4000,
              });
            }
          }}
        />
      </div>
    </div>
  );
};

export default Generator;
