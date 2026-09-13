import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import Generator from "../Generator";

describe("Generator", () => {
  it("renders URL input with placeholder", () => {
    render(<Generator url="" setUrl={vi.fn()} />);
    expect(screen.getByPlaceholderText("https://example.com")).toBeInTheDocument();
  });

  it("shows ready placeholder when URL is empty", () => {
    render(<Generator url="" setUrl={vi.fn()} />);
    expect(screen.getByText("Ready...")).toBeInTheDocument();
  });

  it("renders QR code area when URL is provided", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    expect(screen.queryByText("Ready...")).not.toBeInTheDocument();
  });

  it("shows red border and an inline error for an invalid URL", () => {
    render(<Generator url="not-a-url" setUrl={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://example.com");
    expect(input).toHaveClass("border-red-500");
    expect(screen.getByText("Enter a web address like example.com")).toBeInTheDocument();
  });

  it("shows no red border for a valid URL", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://example.com");
    expect(input).not.toHaveClass("border-red-500");
  });

  it("encodes a bare domain as https:// and shows a hint", () => {
    render(<Generator url="example.com" setUrl={vi.fn()} />);
    expect(screen.queryByText("Ready...")).not.toBeInTheDocument();
    expect(screen.getByText(/Will be encoded as https:\/\/example\.com/)).toBeInTheDocument();
  });

  it("renders color buttons", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    expect(screen.getByText("Foreground")).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
  });

  it("hides Remove Logo when no logo is set", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    expect(screen.getByText("Upload Logo")).toBeInTheDocument();
    expect(screen.queryByText("Remove Logo")).not.toBeInTheDocument();
  });

  it("shows a contrast warning for light-on-dark colors", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    const colorInputs = document.querySelectorAll('input[type="color"]');
    const fgInput = colorInputs[0] as HTMLInputElement;
    const bgInput = colorInputs[1] as HTMLInputElement;
    fireEvent.change(fgInput, { target: { value: "#ffffff" } });
    fireEvent.change(bgInput, { target: { value: "#000000" } });
    expect(screen.getByText(/light-on-dark/i)).toBeInTheDocument();
  });

  it("disables Copy image and Save PNG while the URL is invalid", () => {
    render(<Generator url="not-a-url" setUrl={vi.fn()} />);
    expect(screen.getByText("Copy image").closest("button")).toBeDisabled();
    expect(screen.getByText("Save PNG").closest("button")).toBeDisabled();
  });

  describe("Copy image", () => {
    it("copies the QR export as raw PNG bytes, not a wrapped Image object", async () => {
      vi.mocked(writeImage).mockClear().mockResolvedValueOnce(undefined);

      render(<Generator url="https://example.com" setUrl={vi.fn()} />);
      fireEvent.click(screen.getByText("Copy image"));

      await waitFor(() => expect(writeImage).toHaveBeenCalledTimes(1));

      // Regression guard: `writeImage` must receive the raw PNG bytes
      // directly (a Uint8Array), not an `Image` instance built via
      // `Image.fromBytes` from the top-level `@tauri-apps/api` package.
      // The clipboard plugin's *nested* copy of `@tauri-apps/api` does an
      // `instanceof Image` check against its OWN `Image` class, which such
      // an instance fails, causing the write to be rejected by the Rust
      // side. Raw bytes sidestep that cross-package type mismatch.
      const [arg] = vi.mocked(writeImage).mock.calls[0];
      expect(arg).toBeInstanceOf(Uint8Array);

      expect(toast.success).toHaveBeenCalledWith(
        "Copied to clipboard!",
        expect.objectContaining({ position: "bottom-left" }),
      );
    });

    it("shows a diagnosable error toast when the clipboard write fails", async () => {
      vi.mocked(writeImage).mockClear().mockRejectedValueOnce(new Error("clipboard denied"));

      render(<Generator url="https://example.com" setUrl={vi.fn()} />);
      fireEvent.click(screen.getByText("Copy image"));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Copy failed",
          expect.objectContaining({ description: "clipboard denied" }),
        ),
      );
    });
  });
});
