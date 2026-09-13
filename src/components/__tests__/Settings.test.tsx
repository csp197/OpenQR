import { render, screen, fireEvent, act, within } from "@testing-library/react";
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
  require_scanner_speed: true,
  show_debug_toasts: false,
};

describe("Settings", () => {
  it("does not render when closed", () => {
    render(
      <Settings isOpen={false} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.queryByText("App Settings")).not.toBeInTheDocument();
  });

  it("renders when open", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("App Settings")).toBeInTheDocument();
  });

  it("shows scan mode toggle", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Single")).toBeInTheDocument();
    expect(screen.getByText("Continuous")).toBeInTheDocument();
  });

  it("shows relabeled notification options", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Pop-up messages")).toBeInTheDocument();
    expect(screen.getByText("Status bar only")).toBeInTheDocument();
  });

  it("shows the Advanced section collapsed by default", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.queryByText("Scanner Prefix")).not.toBeInTheDocument();
    expect(screen.queryByText("History Storage")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByText("Scanner Prefix")).toBeInTheDocument();
    expect(screen.getByText("History Storage")).toBeInTheDocument();
  });

  it("shows close to tray toggle", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Minimize to Tray")).toBeInTheDocument();
  });

  it("awaits onSave and closes only when it resolves true", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} config={defaultConfig} onSave={onSave} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when onSave resolves false", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} config={defaultConfig} onSave={onSave} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked with no unsaved changes", () => {
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} config={defaultConfig} onSave={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a discard-changes confirm instead of closing when dirty", () => {
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} config={defaultConfig} onSave={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Continuous"));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps editing when Keep editing is clicked", () => {
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} config={defaultConfig} onSave={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Continuous"));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByText("Keep editing"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
  });

  it("becomes dirty after adding a blocked site, then pristine again once it's removed", () => {
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} config={defaultConfig} onSave={vi.fn()} />,
    );

    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep editing"));

    // Removing the entry brings the list back to the original (empty)
    // state, so the dialog should be pristine again.
    fireEvent.click(screen.getByRole("button", { name: "Remove example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is pristine when opened with lists already in newest-first order", () => {
    const onClose = vi.fn();
    const config: Config = { ...defaultConfig, blocklist: ["b.com", "a.com"] };
    render(<Settings isOpen={true} onClose={onClose} config={config} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds a normalized domain to the allowlist on Enter", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    const input = screen.getByLabelText("Add an allowed site");
    fireEvent.change(input, { target: { value: "HTTPS://Example.COM/path" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("shows an inline error for an invalid domain", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a site like example.com");
  });

  it("renders both the blocked and allowlist cards", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Blocked sites")).toBeInTheDocument();
    expect(screen.getByText("Only allow these sites")).toBeInTheDocument();
    expect(screen.getByText("No blocked sites yet.")).toBeInTheDocument();
    expect(screen.getByText("No sites yet — all sites can open.")).toBeInTheDocument();
  });

  it("shows an 'Off' badge on the allowlist card when empty, and 'On' with a note once an entry is added", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Off")).toBeInTheDocument();

    const input = screen.getByLabelText("Add an allowed site");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Only 1 site can open. Everything else is blocked.")).toBeInTheDocument();
  });

  it("disables the Add button while the input is empty", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    const addButtons = screen.getAllByRole("button", { name: "Add" });
    addButtons.forEach((button) => expect(button).toBeDisabled());

    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "example.com" } });
    expect(screen.getAllByRole("button", { name: "Add" })[0]).not.toBeDisabled();
  });

  it("shows a duplicate message when adding a site already present in the other list", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    const blockInput = screen.getByLabelText("Add a blocked site");
    fireEvent.change(blockInput, { target: { value: "example.com" } });
    fireEvent.keyDown(blockInput, { key: "Enter" });

    const allowInput = screen.getByLabelText("Add an allowed site");
    fireEvent.change(allowInput, { target: { value: "example.com" } });
    fireEvent.keyDown(allowInput, { key: "Enter" });

    expect(screen.getByText("example.com is already in Blocked sites.")).toBeInTheDocument();
  });

  it("removes an entry by its accessible remove button, and shows newest entries first", () => {
    render(
      <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
    );
    const input = screen.getByLabelText("Add a blocked site");

    fireEvent.change(input, { target: { value: "first.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "second.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const list = screen.getByRole("list", { name: "Blocked sites" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("second.com");
    expect(items[1]).toHaveTextContent("first.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove second.com" }));
    expect(screen.queryByText("second.com")).not.toBeInTheDocument();
    expect(screen.getByText("first.com")).toBeInTheDocument();
  });

  describe("Only accept scanner-speed input", () => {
    const openAdvanced = () => fireEvent.click(screen.getByText("Advanced"));

    it("is on by default and shows the recommended description", () => {
      render(
        <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} />,
      );
      openAdvanced();

      const toggle = screen.getByRole("switch", { name: "Only accept scanner-speed input" });
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByText(/Ignores normal typing so pressing Enter in other apps never opens a link/),
      ).toBeInTheDocument();
    });

    it("shows an amber warning and turns Save's payload off when toggled off", async () => {
      const onSave = vi.fn().mockResolvedValue(true);
      render(
        <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={onSave} />,
      );
      openAdvanced();

      fireEvent.click(screen.getByRole("switch", { name: "Only accept scanner-speed input" }));

      expect(
        screen.getByText(
          /Anything typed while OpenQR is listening, followed by Enter, will be treated as a scan\. Typed text is never shown on screen\./,
        ),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText("Save Changes"));
      });
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ require_scanner_speed: false }),
      );
    });

    it("treats a config missing the field as on and pristine", () => {
      // Simulates an on-disk config saved before this setting existed.
      const { require_scanner_speed: _omit, ...legacyConfig } = defaultConfig;
      const onClose = vi.fn();

      render(
        <Settings isOpen={true} onClose={onClose} config={legacyConfig as Config} onSave={vi.fn()} />,
      );
      openAdvanced();

      expect(
        screen.getByRole("switch", { name: "Only accept scanner-speed input" }),
      ).toHaveAttribute("aria-checked", "true");

      fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
    });
  });

  describe("Test a scan", () => {
    const openAdvanced = () => fireEvent.click(screen.getByText("Advanced"));

    it("is hidden when debug messages are off", () => {
      render(
        <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} onTestScan={vi.fn()} />,
      );
      openAdvanced();
      expect(screen.queryByText("Test a scan")).not.toBeInTheDocument();
    });

    it("is hidden when onTestScan is not provided, even with debug on", () => {
      render(
        <Settings
          isOpen={true}
          onClose={vi.fn()}
          config={{ ...defaultConfig, show_debug_toasts: true }}
          onSave={vi.fn()}
        />,
      );
      openAdvanced();
      expect(screen.queryByText("Test a scan")).not.toBeInTheDocument();
    });

    it("appears but stays disabled with a 'Save your changes first.' hint after toggling debug on (now dirty)", () => {
      render(
        <Settings isOpen={true} onClose={vi.fn()} config={defaultConfig} onSave={vi.fn()} onTestScan={vi.fn()} />,
      );
      openAdvanced();
      fireEvent.click(screen.getByRole("switch", { name: "Debug messages" }));

      expect(screen.getByText("Test a scan")).toBeInTheDocument();
      expect(screen.getByText("Save your changes first.")).toBeInTheDocument();

      const input = screen.getByLabelText("Link to test");
      fireEvent.change(input, { target: { value: "https://example.com" } });
      expect(screen.getByRole("button", { name: /Run test scan/ })).toBeDisabled();
    });

    it("is disabled while the input is empty, and enabled once non-empty when already saved with debug on", () => {
      render(
        <Settings
          isOpen={true}
          onClose={vi.fn()}
          config={{ ...defaultConfig, show_debug_toasts: true }}
          onSave={vi.fn()}
          onTestScan={vi.fn()}
        />,
      );
      openAdvanced();

      expect(screen.queryByText("Save your changes first.")).not.toBeInTheDocument();
      const button = screen.getByRole("button", { name: /Run test scan/ });
      expect(button).toBeDisabled();

      const input = screen.getByLabelText("Link to test");
      fireEvent.change(input, { target: { value: "https://example.com" } });
      expect(button).not.toBeDisabled();
    });

    it("clicking Run test scan calls onTestScan with the value, clears the input, and closes", () => {
      const onTestScan = vi.fn();
      const onClose = vi.fn();
      render(
        <Settings
          isOpen={true}
          onClose={onClose}
          config={{ ...defaultConfig, show_debug_toasts: true }}
          onSave={vi.fn()}
          onTestScan={onTestScan}
        />,
      );
      openAdvanced();

      const input = screen.getByLabelText("Link to test");
      fireEvent.change(input, { target: { value: "https://example.com" } });
      fireEvent.click(screen.getByRole("button", { name: /Run test scan/ }));

      expect(onTestScan).toHaveBeenCalledTimes(1);
      expect(onTestScan).toHaveBeenCalledWith("https://example.com");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(input).toHaveValue("");
    });

    it("pressing Enter in the input runs the test scan", () => {
      const onTestScan = vi.fn();
      const onClose = vi.fn();
      render(
        <Settings
          isOpen={true}
          onClose={onClose}
          config={{ ...defaultConfig, show_debug_toasts: true }}
          onSave={vi.fn()}
          onTestScan={onTestScan}
        />,
      );
      openAdvanced();

      const input = screen.getByLabelText("Link to test");
      fireEvent.change(input, { target: { value: "https://example.com" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onTestScan).toHaveBeenCalledWith("https://example.com");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
