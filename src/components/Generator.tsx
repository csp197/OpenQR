import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Image as ImageIcon, Copy, Download } from "lucide-react";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { notify } from "../lib/notify";
import { qrColorWarning } from "../lib/contrast";

interface GeneratorProps {
  url: string;
  setUrl: (val: string) => void;
}

type Encoded = { encoded: string; valid: boolean; usedHint: boolean };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOOKS_LIKE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i;
const LOOKS_LIKE_LOCALHOST_RE = /^localhost(:\d+)?(\/.*)?$/i;

/** Turn any invoke()/plugin rejection into a readable string, whether it's a string, an Error, or an object with a message. */
function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function computeEncoded(input: string): Encoded {
  const trimmed = input.trim();
  if (!trimmed) return { encoded: "", valid: false, usedHint: false };

  if (SCHEME_RE.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const valid = parsed.protocol === "http:" || parsed.protocol === "https:";
      return { encoded: trimmed, valid, usedHint: false };
    } catch {
      return { encoded: trimmed, valid: false, usedHint: false };
    }
  }

  const looksLikeDomain = LOOKS_LIKE_DOMAIN_RE.test(trimmed) || LOOKS_LIKE_LOCALHOST_RE.test(trimmed);
  if (!looksLikeDomain) {
    return { encoded: trimmed, valid: false, usedHint: false };
  }

  const candidate = `https://${trimmed}`;
  try {
    new URL(candidate);
    return { encoded: candidate, valid: true, usedHint: true };
  } catch {
    return { encoded: trimmed, valid: false, usedHint: false };
  }
}

const Generator = ({ url, setUrl }: GeneratorProps) => {
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const exportRef = useRef<HTMLDivElement>(null);
  const fgColorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { encoded, valid, usedHint } = useMemo(() => computeEncoded(url), [url]);
  const colorWarning = useMemo(() => qrColorWarning(fgColor, bgColor), [fgColor, bgColor]);

  const getBorderedCanvas = () => {
    const canvas = exportRef.current?.querySelector("canvas");
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

  const filename = () => {
    let host = "qrcode";
    try {
      host = new URL(encoded).hostname || "qrcode";
    } catch {
      host = "qrcode";
    }
    return `${host}_qrcode.png`;
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
      // Pass the raw PNG bytes straight to `writeImage` instead of wrapping
      // them via `Image.fromBytes` from `@tauri-apps/api/image`. The
      // clipboard plugin bundles its own nested copy of `@tauri-apps/api`
      // (different version than our top-level one), and its `transformImage`
      // helper does an `instanceof Image` check against ITS OWN `Image`
      // class. An `Image` instance created from our top-level package fails
      // that check, so the class instance (which serializes to `{}`, since
      // its `rid` lives in a private WeakMap) gets sent as-is instead of the
      // resource id — and the Rust side fails to deserialize it, rejecting
      // the call. `writeImage` also accepts raw bytes directly, which avoids
      // the cross-package type mismatch entirely.
      await writeImage(bytes);
      notify("success", "Copied to clipboard!");
    } catch (err) {
      console.error("Copy failed:", err);
      notify("error", "Copy failed", { description: describeError(err) });
    }
  };

  const downloadImage = async () => {
    const borderedCanvas = getBorderedCanvas();
    if (!borderedCanvas) return;

    try {
      const filePath = await save({
        filters: [{ name: "Image", extensions: ["png"] }],
        defaultPath: filename(),
      });

      if (!filePath) return; // User cancelled
      const blob = await new Promise<Blob | null>((resolve) =>
        borderedCanvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Blob creation failed");

      const bytes = new Uint8Array(await blob.arrayBuffer());
      await writeFile(filePath, bytes);
      notify("success", `Downloaded to ${filePath}!`);
    } catch {
      notify("error", "Download failed");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400 px-1">
          URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={`w-full bg-slate-100 dark:bg-zinc-900 border rounded-2xl p-4 text-sm outline-none transition-all ${
            url && !valid
              ? "border-red-500"
              : "border-transparent focus:ring-2 focus:ring-blue-500"
          }`}
          placeholder="https://example.com"
        />
        {url && !valid && (
          <p className="text-xs text-red-500 px-1">
            Enter a web address like example.com
          </p>
        )}
        {url && valid && usedHint && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 px-1">
            Will be encoded as {encoded}
          </p>
        )}
      </div>

      <div className="relative flex justify-center py-4">
        <div className="bg-white p-5 rounded-4xl shadow-xl border border-slate-100">
          {url && valid ? (
            <QRCodeCanvas
              value={encoded}
              size={180}
              fgColor={fgColor}
              bgColor={bgColor}
              level="H"
              imageSettings={
                logo ? { src: logo, height: 40, width: 40, excavate: true } : undefined
              }
            />
          ) : (
            <div className="w-45 h-45 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 text-xs">
              Ready...
            </div>
          )}
        </div>
      </div>

      {/* Hidden high-resolution canvas used for copy/save so exports are always sharp. */}
      <div style={{ display: "none" }}>
        <div ref={exportRef}>
          {url && valid && (
            <QRCodeCanvas
              value={encoded}
              size={1024}
              fgColor={fgColor}
              bgColor={bgColor}
              level="H"
              imageSettings={
                logo ? { src: logo, height: 224, width: 224, excavate: true } : undefined
              }
            />
          )}
        </div>
      </div>

      <div className="flex gap-3 justify-center">
        <button
          onClick={() => void copyToClipboard()}
          disabled={!valid}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 border rounded-full text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Copy size={14} className="text-slate-600 dark:text-zinc-300" /> Copy image
        </button>
        <button
          onClick={() => void downloadImage()}
          disabled={!valid}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 border rounded-full text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={14} className="text-blue-600" /> Save PNG
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
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
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border rounded-2xl text-xs font-semibold"
        >
          <ImageIcon size={14} className="text-purple-500" />
          Upload Logo
        </button>

        {logo && (
          <button
            onClick={() => {
              setLogo(undefined);
              notify("success", "Logo removed");
            }}
            className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-zinc-800 border border-red-200 text-red-600 rounded-2xl text-xs font-semibold"
          >
            Remove Logo
          </button>
        )}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            // `onloadend` also fires after a failed read - use `onload` so
            // a read error doesn't also show the success toast.
            reader.onload = () => {
              setLogo(reader.result as string);
              notify("success", "Logo added!");
            };
            reader.onerror = () => {
              notify("error", "Could not read that image");
            };
            reader.readAsDataURL(file);
            e.target.value = "";
          }}
        />
      </div>

      {colorWarning && (
        <p className="text-xs text-amber-600 dark:text-amber-400 text-center -mt-2">
          {colorWarning}
        </p>
      )}
    </div>
  );
};

export default Generator;
