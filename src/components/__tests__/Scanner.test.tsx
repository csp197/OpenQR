import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Scanner from "../Scanner";
import type { AppState } from "../../App";

const defaultProps = {
  isListening: false,
  setIsListening: vi.fn(),
  status: "Not listening. Click Start Listening to scan.",
  history: [] as { id: number; url: string; timestamp: string }[],
  onClear: vi.fn(),
  mode: { status: "IDLE" } as AppState,
  onStop: vi.fn(),
  onOpenAnyway: vi.fn(),
  permissionProblem: false,
  onCheckPermissionAgain: vi.fn(),
  onOpenPermissionSettings: vi.fn(),
};

describe("Scanner", () => {
  it("shows Ready when idle", () => {
    render(<Scanner {...defaultProps} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows Listening when active", () => {
    render(
      <Scanner {...defaultProps} isListening={true} mode={{ status: "LISTENING" }} />,
    );
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });

  it("shows 'No scans yet' for empty history", () => {
    render(<Scanner {...defaultProps} />);
    expect(screen.getByText("No scans yet")).toBeInTheDocument();
  });

  it("renders history items", () => {
    const history = [{ id: 1, url: "https://example.com", timestamp: "2024-01-01 12:00:00" }];
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
      <Scanner {...defaultProps} isListening={true} mode={{ status: "LISTENING" }} />,
    );
    expect(screen.getByText("Stop Listening")).toBeInTheDocument();
  });

  it("shows the countdown when pending with no warnings", () => {
    render(
      <Scanner
        {...defaultProps}
        mode={{
          status: "PENDING_REDIRECT",
          url: "https://test.com",
          host: "test.com",
          warnings: [],
          secondsLeft: 2,
        }}
      />,
    );
    expect(screen.getByText("Opening in 2…")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.queryByText("Open anyway")).not.toBeInTheDocument();
  });

  it("shows warnings and an Open anyway option when the scan has warnings", () => {
    render(
      <Scanner
        {...defaultProps}
        mode={{
          status: "PENDING_REDIRECT",
          url: "http://test.com",
          host: "test.com",
          warnings: ["not_https"],
          secondsLeft: 3,
        }}
      />,
    );
    expect(screen.getByText("Check this link before opening")).toBeInTheDocument();
    expect(screen.getByText(/isn't secure/)).toBeInTheDocument();
    expect(screen.getByText("Open anyway")).toBeInTheDocument();
  });

  it("calls onOpenAnyway when Open anyway is clicked", () => {
    const onOpenAnyway = vi.fn();
    render(
      <Scanner
        {...defaultProps}
        onOpenAnyway={onOpenAnyway}
        mode={{
          status: "PENDING_REDIRECT",
          url: "http://test2.com",
          host: "test2.com",
          warnings: ["not_https"],
          secondsLeft: 3,
        }}
      />,
    );
    fireEvent.click(screen.getByText("Open anyway"));
    expect(onOpenAnyway).toHaveBeenCalledTimes(1);
  });

  it("shows Copy All and Clear when history exists", () => {
    const history = [{ id: 1, url: "https://example.com", timestamp: "2024-01-01 12:00:00" }];
    render(<Scanner {...defaultProps} history={history} />);
    expect(screen.getByText("Copy All")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("shows an inline confirm before clearing history", () => {
    const onClear = vi.fn();
    const history = [
      { id: 1, url: "https://example.com", timestamp: "2024-01-01 12:00:00" },
      { id: 2, url: "https://example.org", timestamp: "2024-01-01 12:00:00" },
    ];
    render(<Scanner {...defaultProps} history={history} onClear={onClear} />);

    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText(/Delete all 2 scans\?/)).toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Delete"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("cancels the clear confirm without clearing", () => {
    const onClear = vi.fn();
    const history = [{ id: 1, url: "https://example.com", timestamp: "2024-01-01 12:00:00" }];
    render(<Scanner {...defaultProps} history={history} onClear={onClear} />);

    fireEvent.click(screen.getByText("Clear"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("shows the permission banner with working buttons", () => {
    const onCheckPermissionAgain = vi.fn();
    const onOpenPermissionSettings = vi.fn();
    render(
      <Scanner
        {...defaultProps}
        permissionProblem={true}
        onCheckPermissionAgain={onCheckPermissionAgain}
        onOpenPermissionSettings={onOpenPermissionSettings}
      />,
    );

    expect(screen.getByText(/Input Monitoring/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open System Settings"));
    expect(onOpenPermissionSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Check again"));
    expect(onCheckPermissionAgain).toHaveBeenCalledTimes(1);
  });

  it("does not show the permission banner by default", () => {
    render(<Scanner {...defaultProps} />);
    expect(screen.queryByText(/Input Monitoring/)).not.toBeInTheDocument();
  });
});
