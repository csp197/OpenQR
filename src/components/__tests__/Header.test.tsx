import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Header from "../Header";

describe("Header", () => {
  it("renders the app name", () => {
    render(
      <Header
        activeTab="scanner"
        setActiveTab={vi.fn()}
        isDark={false}
        setIsDark={vi.fn()}
      />,
    );
    expect(screen.getByText("OpenQR")).toBeInTheDocument();
  });

  it("renders scanner and generator tabs", () => {
    render(
      <Header
        activeTab="scanner"
        setActiveTab={vi.fn()}
        isDark={false}
        setIsDark={vi.fn()}
      />,
    );
    expect(screen.getByText("Scanner")).toBeInTheDocument();
    expect(screen.getByText("Generator")).toBeInTheDocument();
  });

  it("calls setActiveTab when tab is clicked", () => {
    const setActiveTab = vi.fn();
    render(
      <Header
        activeTab="scanner"
        setActiveTab={setActiveTab}
        isDark={false}
        setIsDark={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Generator"));
    expect(setActiveTab).toHaveBeenCalledWith("generator");
  });

  it("toggles dark mode", () => {
    const setIsDark = vi.fn();
    render(
      <Header
        activeTab="scanner"
        setActiveTab={vi.fn()}
        isDark={false}
        setIsDark={setIsDark}
      />,
    );
    // Click the theme toggle button (last button in header)
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(setIsDark).toHaveBeenCalledWith(true);
  });
});
