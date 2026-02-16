# OpenQR

![screenshot](public/screenshot.png)

A free, open-source desktop app for scanning and creating QR codes. OpenQR works with hardware barcode/QR scanners (the kind that plug into your computer via USB) and gives you a safe, controlled environment to verify URLs before opening them.

Available for **Windows**, **macOS**, and **Linux**.

---

## What It Does

### Scanner Mode

Plug in a USB QR/barcode scanner, click **Start Listening**, and scan away. OpenQR captures the scanner's input and:

1. Checks the URL against your **allowlist** and **blocklist**
2. Strips any configured prefix or suffix your scanner may add
3. Shows you the verified domain before opening it
4. Gives you 3 seconds to cancel before it opens in your browser
5. Saves every scan to your local history

This keeps you safe from malicious QR codes that redirect to phishing sites or other bad places.

### Generator Mode

Type or paste any URL and OpenQR generates a QR code on the spot. You can:

- Pick custom foreground and background colors
- Add your own logo in the center (it automatically carves out space so the code stays scannable)
- Copy to clipboard with a clean white border
- Download as a PNG file

### Settings

Everything is configurable:

| Setting | What it does |
|---|---|
| **Scan Mode** | *Single* stops listening after one scan. *Continuous* keeps going. |
| **Notifications** | Choose between toast popups or quiet status-bar-only updates. |
| **Max History** | How many scans to keep (default 100). |
| **Prefix / Suffix** | Strip characters your scanner adds before or after the URL. |
| **Allowlist / Blocklist** | Control which domains are allowed or blocked. |
| **Minimize to Tray** | Keep OpenQR running in the background when you close the window. |

Settings are saved to `~/.openqr/config.json`. Scan history is stored in the `history` table in a local SQLite database at `~/.openqr/history.db`.

---

## Download

Head to the [Releases](https://github.com/csp197/openqr/releases) page and grab the latest version for your platform:

| Platform | File |
|---|---|
| Windows | `.exe` installer |
| macOS | `.dmg` disk image |
| Linux | `.deb` package or `.AppImage` |

### macOS Note

OpenQR uses global keyboard listening to capture scanner input even when the window is in the background.

- **macOS:** Grant **Accessibility** permission the first time you start listening: **System Settings > Privacy & Security > Accessibility > OpenQR**
- **Windows:** No extra permissions needed. The app installs a low-level keyboard hook that works without administrator privileges.

---

## Building From Source

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Bun](https://bun.sh/) (JavaScript runtime & package manager)
- **Linux only:** system libraries for Tauri v2:
  ```
  sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```

### Setup

```bash
git clone https://github.com/csp197/openqr.git
cd openqr
bun install
```

### Development

```bash
bun run tauri dev
```

This starts the Vite dev server with hot reload and launches the Tauri window.

### Production Build

```bash
bun run tauri build
```

Outputs platform-specific installers to `src-tauri/target/release/bundle/`.

### Running Tests

```bash
# Rust tests (URL validation, config, history, prefix/suffix handling)
cd src-tauri && cargo test

# Frontend tests (component rendering, user interactions)
bun run test
```

### Creating a Release

Releases are built automatically by GitHub Actions when you push to `main`. The CI runs tests on all three platforms, then builds and uploads artifacts as a **draft release** tagged with the version from `tauri.conf.json`.

To publish a new version:

1. Bump the `version` in `src-tauri/tauri.conf.json`
2. Merge to `main`
3. Go to the [Releases](https://github.com/csp197/openqr/releases) page and publish the draft

A pre-push hook warns you if the version tag already exists so you don't forget to bump it.

---

## Project Structure

```
openqr/
  src/                     # React frontend (TypeScript)
    components/
      Scanner.tsx          # QR scanning UI and history
      Generator.tsx        # QR code creation with customization
      Settings.tsx         # All app configuration
      Header.tsx           # Navigation and theme toggle
      Footer.tsx           # Status bar
  src-tauri/               # Rust backend
    src/
      lib.rs               # App setup, plugin registration, window management
      tray.rs              # System tray icon with status dot overlay
      state.rs             # Shared application state
      commands/
        url.rs             # URL validation against allow/blocklists
        config.rs          # Load and save settings
        history.rs         # SQLite scan history
        scan.rs            # Global keyboard listener (per-platform), input processing
      models/
        config.rs          # Config data structure
        scan.rs            # Scan record data structure
```

The keyboard listener has platform-specific implementations:
- **macOS** — `CGEventTap` with `CGEventKeyboardGetUnicodeString` (thread-safe, avoids rdev's `UCKeyTranslate` crash)
- **Windows** — `SetWindowsHookExW(WH_KEYBOARD_LL)` with a `GetMessageW` pump; stoppable via `PostThreadMessageW(WM_QUIT)`
- **Linux** — `rdev` crate (fallback)

---

## Contributing

Contributions are welcome. Fork the repo, create a branch, and open a pull request.

The codebase uses:
- **Tauri v2** for the desktop shell
- **React 19** with TypeScript for the UI
- **Tailwind CSS v4** for styling
- **Rust** for URL validation, scan processing, history storage, config management, global keyboard capture, and system tray
- **Vitest** + **Testing Library** for frontend tests
- **Cargo test** for Rust unit tests

---

<a target="_blank" href="https://icons8.com/icon/WDy6fnNnJEm0/qr-code">QR Code</a> icon by <a target="_blank" href="https://icons8.com">Icons8</a>
