import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import App from "../App";
import type { Config, ScanError, ScanResult } from "../types";

const baseConfig: Config = {
  allowlist: [],
  blocklist: [],
  history_storage_method: "json",
  scan_mode: "continuous",
  notification_type: "toast",
  max_history_items: 100,
  prefix: { mode: "none" },
  suffix: { mode: "enter" },
  close_to_tray: false,
  require_scanner_speed: true,
  show_debug_toasts: false,
};

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;

/** Capture the handlers App registers via `listen(...)` so tests can fire events directly. */
function mockListen() {
  const handlers = new Map<string, EventHandler>();
  vi.mocked(listen).mockImplementation(((eventName: string, handler: EventHandler) => {
    handlers.set(eventName, handler);
    return Promise.resolve(() => {
      // Only remove this exact handler, not just "whatever's registered
      // for this event name". Under React.StrictMode, React double-invokes
      // effects on mount (setup → cleanup → setup) to surface missing
      // cleanup; the throwaway first setup's `listen()` call resolves and
      // runs its cleanup *after* the real second setup has already
      // re-registered, and a same-event-name-only cleanup would delete
      // that newer handler out from under it. Real Tauri listeners are
      // independent per `listen()` call and unlisten() only ever removes
      // the one it came from — this mirrors that.
      if (handlers.get(eventName) === handler) {
        handlers.delete(eventName);
      }
    });
  }) as unknown as typeof listen);
  return handlers;
}

/** Stub `invoke` with sane defaults for startup, overridable per command for the behavior under test. */
function mockInvoke(overrides: Record<string, (args: unknown) => unknown> = {}) {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
    if (cmd in overrides) return Promise.resolve(overrides[cmd](args));
    switch (cmd) {
      case "get_config":
        return Promise.resolve(baseConfig);
      case "get_history":
        return Promise.resolve([]);
      case "check_input_permission":
        return Promise.resolve(true);
      default:
        return Promise.resolve(undefined);
    }
  }) as unknown as typeof invoke);
}

async function renderAppReady() {
  render(<App />);
  await screen.findByRole("tablist");
}

async function renderAppReadyStrict() {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("tablist");
}

describe("App: scan-input / tab switching / settings-save races", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("only opens the second URL when two scans arrive back-to-back (bug: dueling countdowns)", async () => {
    mockInvoke({
      process_scan: (args) => {
        const { rawInput } = args as { rawInput: string };
        return { url: rawInput, host: "example.com", warnings: [] } satisfies ScanResult;
      },
    });

    const handlers = mockListen();
    await renderAppReady();
    const scanInput = handlers.get("scan-input");
    if (!scanInput) throw new Error("scan-input handler was not registered");

    vi.useFakeTimers();

    await act(async () => {
      await scanInput({ payload: "https://a.com" });
    });
    await act(async () => {
      await scanInput({ payload: "https://b.com" });
    });

    // Only one countdown should be running; let it fully elapse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://b.com");
  });

  it("opens the URL exactly once after the countdown under React.StrictMode (regression: double-invoked setState updater)", async () => {
    // React.StrictMode double-invokes functions passed to setState in dev,
    // to surface impure updaters. The redirect countdown used to run its
    // side effects (clearInterval + finishRedirect/openUrl) from inside
    // such an updater, so under StrictMode a single completed countdown
    // opened the URL twice. See App.tsx's startPendingRedirect.
    mockInvoke({
      process_scan: (args) => {
        const { rawInput } = args as { rawInput: string };
        return { url: rawInput, host: "example.com", warnings: [] } satisfies ScanResult;
      },
    });

    const handlers = mockListen();
    await renderAppReadyStrict();
    const scanInput = handlers.get("scan-input");
    if (!scanInput) throw new Error("scan-input handler was not registered");

    vi.useFakeTimers();

    await act(async () => {
      await scanInput({ payload: "https://strict.com" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://strict.com");
  });

  it("stops the real listener after a real scan-input scan when scan_mode is single", async () => {
    const singleConfig: Config = { ...baseConfig, scan_mode: "single" };
    const startListener = vi.fn();
    const stopListener = vi.fn();
    mockInvoke({
      get_config: () => singleConfig,
      start_global_listener: startListener,
      stop_global_listener: stopListener,
      process_scan: (args) => {
        const { rawInput } = args as { rawInput: string };
        return { url: rawInput, host: "example.com", warnings: [] } satisfies ScanResult;
      },
    });

    const handlers = mockListen();
    await renderAppReady();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Listening" }));
      await Promise.resolve();
    });
    expect(startListener).toHaveBeenCalledTimes(1);

    const scanInput = handlers.get("scan-input");
    if (!scanInput) throw new Error("scan-input handler was not registered");

    vi.useFakeTimers();

    await act(async () => {
      await scanInput({ payload: "https://real.com" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://real.com");
    expect(stopListener).toHaveBeenCalledTimes(1);
  });

  it("does not redirect or yank the UI back to Scanner when the user switches to Generator mid-scan", async () => {
    let resolveScan: ((result: ScanResult) => void) | undefined;
    mockInvoke({
      process_scan: () =>
        new Promise<ScanResult>((resolve) => {
          resolveScan = resolve;
        }),
    });
    const handlers = mockListen();
    await renderAppReady();
    const scanInput = handlers.get("scan-input");
    if (!scanInput) throw new Error("scan-input handler was not registered");

    // Kick off a scan and leave process_scan pending.
    await act(async () => {
      void scanInput({ payload: "https://slow.com" });
      await Promise.resolve();
    });

    // Switch to Generator before process_scan resolves.
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Generator" }));
      await Promise.resolve();
    });
    expect(screen.getByPlaceholderText("https://example.com")).toBeInTheDocument();

    // Now let the scan resolve — it must not pull the user back to Scanner.
    await act(async () => {
      resolveScan?.({ url: "https://slow.com", host: "slow.com", warnings: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openUrl).not.toHaveBeenCalled();
    // Mode must not have flipped to PENDING_REDIRECT behind the Generator
    // tab either — that's what the footer would show.
    expect(screen.queryByText(/Opening in/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://example.com")).toBeInTheDocument();
  });

  it("never calls save_config and keeps Settings open when migrate_history rejects", async () => {
    mockListen();
    const migrateHistory = vi.fn().mockRejectedValue(new Error("migration failed"));
    const saveConfigSpy = vi.fn();
    mockInvoke({
      migrate_history: migrateHistory,
      save_config: saveConfigSpy,
    });

    await renderAppReady();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open settings"));
    });
    expect(screen.getByText("App Settings")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Advanced"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "SQLite Database" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(migrateHistory).toHaveBeenCalled();
    expect(saveConfigSpy).not.toHaveBeenCalled();
    expect(screen.getByText("App Settings")).toBeInTheDocument();
  });

  it("passes the new max_history_items as maxItems to migrate_history", async () => {
    mockListen();
    const migrateHistory = vi.fn().mockResolvedValue(0);
    mockInvoke({ migrate_history: migrateHistory });

    await renderAppReady();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open settings"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Advanced"));
    });

    const maxHistoryInput = screen.getByDisplayValue(String(baseConfig.max_history_items));
    await act(async () => {
      fireEvent.change(maxHistoryInput, { target: { value: "250" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "SQLite Database" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(migrateHistory).toHaveBeenCalledWith({
      maxItems: 250,
      from: "json",
      to: "sqlite",
    });
  });
});

describe("App: Test a scan", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const debugConfig: Config = { ...baseConfig, show_debug_toasts: true };

  async function openTestScanPanel() {
    mockListen();
    await renderAppReady();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open settings"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Advanced"));
    });
  }

  it("runs a test scan: invokes process_scan, shows the countdown, and opens the URL exactly once without touching the listener", async () => {
    const processScan = vi.fn(
      (args: unknown) =>
        ({ url: (args as { rawInput: string }).rawInput + "/", host: "example.com", warnings: [] }) satisfies ScanResult,
    );
    const startListener = vi.fn();
    const stopListener = vi.fn();
    mockInvoke({
      get_config: () => debugConfig,
      process_scan: processScan,
      start_global_listener: startListener,
      stop_global_listener: stopListener,
    });

    await openTestScanPanel();

    // Enable fake timers before triggering the scan so the redirect
    // countdown's setInterval is created on the fake clock (matching the
    // pattern used by the other scan-input tests above).
    vi.useFakeTimers();

    const input = screen.getByLabelText("Link to test");
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://example.com" } });
      fireEvent.click(screen.getByRole("button", { name: /Run test scan/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(processScan).toHaveBeenCalledWith({ rawInput: "https://example.com" });
    // Running the test scan closes Settings and returns to the Scanner tab.
    expect(screen.queryByText("App Settings")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Opening in/).length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/");
    expect(startListener).not.toHaveBeenCalled();
    expect(stopListener).not.toHaveBeenCalled();
  });

  it("switches from the Generator tab to Scanner before running a test scan", async () => {
    mockInvoke({
      get_config: () => debugConfig,
      process_scan: (args) => {
        const { rawInput } = args as { rawInput: string };
        return { url: rawInput, host: "example.com", warnings: [] } satisfies ScanResult;
      },
    });

    await openTestScanPanel();

    // Close settings, switch to Generator, then reopen settings.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Generator" }));
    });
    expect(screen.getByPlaceholderText("https://example.com")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open settings"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Advanced"));
    });

    vi.useFakeTimers(); // countdown starts on submit; keep it off the real clock

    const input = screen.getByLabelText("Link to test");
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://switched.com" } });
      fireEvent.click(screen.getByRole("button", { name: /Run test scan/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("tab", { name: "Scanner" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByPlaceholderText("https://example.com")).not.toBeInTheDocument();
  });

  it("does not stop the real listener when a test scan runs while scan_mode is single (bug: test scan silently disabled real scanning)", async () => {
    const singleDebugConfig: Config = { ...debugConfig, scan_mode: "single" };
    const startListener = vi.fn();
    const stopListener = vi.fn();
    mockInvoke({
      get_config: () => singleDebugConfig,
      start_global_listener: startListener,
      stop_global_listener: stopListener,
      process_scan: (args) => {
        const { rawInput } = args as { rawInput: string };
        return { url: rawInput, host: "example.com", warnings: [] } satisfies ScanResult;
      },
    });

    mockListen();
    await renderAppReady();

    // Start the real listener first.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start Listening" }));
      await Promise.resolve();
    });
    expect(startListener).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop Listening" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Open settings"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Advanced"));
    });

    vi.useFakeTimers();

    const input = screen.getByLabelText("Link to test");
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://example.com" } });
      fireEvent.click(screen.getByRole("button", { name: /Run test scan/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    // The real listener must still be running: no stop_global_listener call,
    // and the Scanner tab still shows "Stop Listening" / a listening status.
    expect(stopListener).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop Listening" })).toBeInTheDocument();
    expect(screen.getAllByText("Ready to scan").length).toBeGreaterThan(0);
  });
});

describe("App: privacy — not_a_link with the scanner-speed filter off", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it("shows a generic message with no raw text and no Copy action when raw is empty", async () => {
    const rejection: ScanError = {
      kind: "not_a_link",
      message: "This QR code isn't a web link",
      raw: "",
    };
    mockInvoke({
      process_scan: () => Promise.reject(rejection),
    });
    const handlers = mockListen();
    await renderAppReady();
    const scanInput = handlers.get("scan-input");
    if (!scanInput) throw new Error("scan-input handler was not registered");

    await act(async () => {
      await scanInput({ payload: "hunter2" });
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = vi.mocked(toast.error).mock.calls[0] as [string, Record<string, unknown>];
    expect(title).toBe("This QR code isn't a web link");
    expect(opts.description).toBe("The scanned text isn't a link, so it wasn't opened.");
    expect(opts.action).toBeUndefined();
  });

  it("still shows the raw text and Copy action when raw is non-empty (scanner-speed filter on)", async () => {
    const rejection: ScanError = {
      kind: "not_a_link",
      message: "This QR code isn't a web link",
      raw: "not-a-url",
    };
    mockInvoke({
      process_scan: () => Promise.reject(rejection),
    });
    const handlers = mockListen();
    await renderAppReady();
    const scanInput = handlers.get("scan-input");
    if (!scanInput) throw new Error("scan-input handler was not registered");

    await act(async () => {
      await scanInput({ payload: "not-a-url" });
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = vi.mocked(toast.error).mock.calls[0] as [string, Record<string, unknown>];
    expect(title).toBe("This QR code isn't a web link");
    expect(opts.description).toBe("not-a-url");
    expect(opts.action).toBeDefined();
  });
});
