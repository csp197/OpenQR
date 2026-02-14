import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Scanner from "../Scanner";

const defaultProps = {
  isListening: false,
  setIsListening: vi.fn(),
  status: "NOT Listening",
  history: [] as { id: string; url: string; timestamp: string }[],
  onClear: vi.fn(),
  mode: { status: "IDLE" },
  onStop: vi.fn(),
  getStatusColor: vi.fn(() => "bg-zinc-400"),
};

describe("Scanner", () => {
  it("shows Ready when idle", () => {
    render(<Scanner {...defaultProps} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows Listening when active", () => {
    render(
      <Scanner
        {...defaultProps}
        isListening={true}
        mode={{ status: "LISTENING" }}
      />,
    );
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });

  it("shows empty history message", () => {
    render(<Scanner {...defaultProps} />);
    expect(screen.getByText(/No scans detected/)).toBeInTheDocument();
  });

  it("renders history items", () => {
    const history = [
      { id: "1", url: "https://example.com", timestamp: "2024-01-01" },
    ];
    render(<Scanner {...defaultProps} history={history} />);
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
  });

  it("calls setIsListening on button click", () => {
    const setIsListening = vi.fn();
    render(<Scanner {...defaultProps} setIsListening={setIsListening} />);
    fireEvent.click(screen.getByText("Start Listening"));
    expect(setIsListening).toHaveBeenCalledWith(true);
  });

  it("shows Stop Listening when listening", () => {
    render(
      <Scanner
        {...defaultProps}
        isListening={true}
        mode={{ status: "LISTENING" }}
      />,
    );
    expect(screen.getByText("Stop Listening")).toBeInTheDocument();
  });

  it("shows Cancel button when pending redirect", () => {
    render(
      <Scanner
        {...defaultProps}
        mode={{ status: "PENDING_REDIRECT", url: "https://test.com" }}
      />,
    );
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("shows Copy All and Clear when history exists", () => {
    const history = [
      { id: "1", url: "https://example.com", timestamp: "2024-01-01" },
    ];
    render(<Scanner {...defaultProps} history={history} />);
    expect(screen.getByText("Copy All")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });
});
