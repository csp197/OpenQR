import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Header from "../Header";

const defaultProps = {
  activeTab: "scanner",
  setActiveTab: vi.fn(),
  isDark: false,
  onToggleTheme: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe("Header", () => {
  it("renders the app name", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText("OpenQR")).toBeInTheDocument();
  });

  it("renders scanner and generator tabs", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText("Scanner")).toBeInTheDocument();
    expect(screen.getByText("Generator")).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected", () => {
    render(<Header {...defaultProps} activeTab="generator" />);
    expect(screen.getByRole("tab", { name: "Scanner" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Generator" })).toHaveAttribute("aria-selected", "true");
  });

  it("calls setActiveTab when a tab is clicked", () => {
    const setActiveTab = vi.fn();
    render(<Header {...defaultProps} setActiveTab={setActiveTab} />);
    fireEvent.click(screen.getByRole("tab", { name: "Generator" }));
    expect(setActiveTab).toHaveBeenCalledWith("generator");
  });

  it("calls onToggleTheme when the theme button is clicked", () => {
    const onToggleTheme = vi.fn();
    render(<Header {...defaultProps} onToggleTheme={onToggleTheme} />);
    fireEvent.click(screen.getByLabelText("Switch to light/dark theme"));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenSettings when the settings button is clicked", () => {
    const onOpenSettings = vi.fn();
    render(<Header {...defaultProps} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByLabelText("Open settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
