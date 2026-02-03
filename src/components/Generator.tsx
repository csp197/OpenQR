import { useState, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Image as ImageIcon, Copy, Download } from "lucide-react";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

interface GeneratorProps {
  url: string;
  setUrl: (val: string) => void;
  setStatus: (msg: string) => void;
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

  const copyToClipboard = async () => {
    const borderedCanvas = getBorderedCanvas();
    if (!borderedCanvas) return;

    try {
      setStatus("Encoding...");
      const blob = await new Promise<Blob | null>((resolve) =>
        borderedCanvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Blob failed");

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const tauriImage = await Image.fromBytes(bytes);
      await writeImage(tauriImage);

      setStatus("Copied to clipboard!");
    } catch (err) {
      setStatus("Copy failed");
    }
  };

  const getBorderedCanvas = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return null;

    const padding = 48;
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = canvas.width + padding;
    offscreenCanvas.height = canvas.height + padding;

    const ctx = offscreenCanvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
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

      setStatus("Saving...");

      // 2. Convert canvas to bytes
      const blob = await new Promise<Blob | null>((resolve) =>
        borderedCanvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Blob creation failed");

      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // 3. Write file to disk using Tauri FS
      await writeFile(filePath, bytes);

      setStatus(`Downloaded to ${filePath}!`);
    } catch (err) {
      console.error("Download failed:", err);
      setStatus("Download failed");
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
          className="bg-white p-6 rounded-4xl shadow-xl border border-slate-100"
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
