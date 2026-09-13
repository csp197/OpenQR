import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock sonner so components/lib code can call toast.* without a real DOM toaster.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

// happy-dom doesn't implement matchMedia; components use it to detect the
// OS color scheme preference when no theme has been saved yet.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// happy-dom doesn't implement the Clipboard API.
if (!navigator.clipboard) {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
}

// Mock Tauri core APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => Promise.resolve("/mock/home")),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => {
  // A real class, not `vi.fn().mockImplementation(...)`: Bun's vi.fn mocks
  // aren't constructable (`new` on one throws "is not a constructor"), but
  // App.tsx does `new LazyStore(filePath)`.
  class MockLazyStore {
    get = vi.fn(() => Promise.resolve(null));
    set = vi.fn(() => Promise.resolve());
    save = vi.fn(() => Promise.resolve());
  }
  return { LazyStore: MockLazyStore };
});

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeImage: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(() => Promise.resolve(true)),
  mkdir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/image", () => ({
  Image: {
    fromBytes: vi.fn(),
  },
}));

// happy-dom doesn't implement the Canvas 2D API. `qrcode.react` renders QR
// codes via `canvas.getContext("2d")` (silently no-oping when it gets
// `null`, which is happy-dom's default), and Generator's copy/save handlers
// read the rendered QR code back out via `canvas.toBlob()`. Stub both so the
// hidden 1024px export canvas actually has content for those handlers to
// export.
if (typeof HTMLCanvasElement !== "undefined") {
  const mockContext = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "",
    globalAlpha: 1,
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => mockContext,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.toBlob = vi.fn(function (callback: BlobCallback) {
    callback(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }));
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
}
