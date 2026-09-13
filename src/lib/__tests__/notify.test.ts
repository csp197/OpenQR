import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { notify, setNotifyMode, setStatusSink } from "../notify";

describe("notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNotifyMode("toast");
    setStatusSink(null);
  });

  it("calls sonner at bottom-left with a 4000ms default duration in toast mode", () => {
    notify("success", "Saved");
    expect(toast.success).toHaveBeenCalledWith(
      "Saved",
      expect.objectContaining({ position: "bottom-left", duration: 4000 }),
    );
  });

  it("passes through custom options", () => {
    notify("error", "Oops", { description: "details", duration: 10000 });
    expect(toast.error).toHaveBeenCalledWith(
      "Oops",
      expect.objectContaining({ description: "details", duration: 10000 }),
    );
  });

  it("sends the message to the status sink instead of toasting in status mode", () => {
    setNotifyMode("status");
    const sink = vi.fn();
    setStatusSink(sink);

    notify("info", "Hello");

    expect(sink).toHaveBeenCalledWith("Hello");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("does nothing if status mode has no sink registered", () => {
    setNotifyMode("status");
    expect(() => notify("info", "Hello")).not.toThrow();
  });
});
