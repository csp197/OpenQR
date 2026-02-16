import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Settings from "../Settings";
import type { Config } from "../../App";

const defaultConfig: Config = {
  allowlist: [],
  blocklist: [],
  history_storage_method: "json",
  scan_mode: "single",
  notification_type: "toast",
  max_history_items: 100,
  prefix: { mode: "none" },
  suffix: { mode: "enter" },
  close_to_tray: false,
  show_debug_toasts: false,
};

describe("Settings", () => {
  it("does not render when closed", () => {
    render(
      <Settings
        isOpen={false}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText("App Settings")).not.toBeInTheDocument();
  });

  it("renders when open", () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("App Settings")).toBeInTheDocument();
  });

  it("shows scan mode toggle", () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Single")).toBeInTheDocument();
    expect(screen.getByText("Continuous")).toBeInTheDocument();
  });

  it("shows notification type toggle", () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Toast Popups")).toBeInTheDocument();
    expect(screen.getByText("Status Bar Only")).toBeInTheDocument();
  });

  it("shows prefix options", () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Scanner Prefix")).toBeInTheDocument();
  });

  it("shows suffix options", () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Scanner Suffix")).toBeInTheDocument();
  });

  it("shows close to tray toggle", () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Minimize to Tray")).toBeInTheDocument();
  });

  it("calls onSave with updated config on Save", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <Settings
        isOpen={true}
        onClose={onClose}
        config={defaultConfig}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText("Save Changes"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when X is clicked", () => {
    const onClose = vi.fn();
    render(
      <Settings
        isOpen={true}
        onClose={onClose}
        config={defaultConfig}
        onSave={vi.fn()}
      />,
    );
    // The X button is the only button in the header area
    const closeButtons = screen.getAllByRole("button");
    // First button after the header text should be close
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
