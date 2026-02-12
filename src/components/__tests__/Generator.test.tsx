import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Generator from "../Generator";

describe("Generator", () => {
  it("renders URL input with placeholder", () => {
    render(<Generator url="" setUrl={vi.fn()} />);
    expect(screen.getByPlaceholderText("https://...")).toBeInTheDocument();
  });

  it("shows ready placeholder when URL is empty", () => {
    render(<Generator url="" setUrl={vi.fn()} />);
    expect(screen.getByText("Ready...")).toBeInTheDocument();
  });

  it("renders QR code area when URL is provided", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    // QR code canvas should be present, no "Ready..." placeholder
    expect(screen.queryByText("Ready...")).not.toBeInTheDocument();
  });

  it("shows red border for invalid URL", () => {
    render(<Generator url="not-a-url" setUrl={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://...");
    expect(input).toHaveClass("border-red-500");
  });

  it("shows no red border for valid URL", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    const input = screen.getByPlaceholderText("https://...");
    expect(input).not.toHaveClass("border-red-500");
  });

  it("renders color buttons", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    expect(screen.getByText("Foreground")).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
  });

  it("renders logo buttons", () => {
    render(<Generator url="https://example.com" setUrl={vi.fn()} />);
    expect(screen.getByText("Upload Logo")).toBeInTheDocument();
    expect(screen.getByText("Remove Logo")).toBeInTheDocument();
  });
});
