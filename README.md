# OpenQR

OpenQR is a high-performance desktop application built with Tauri and React. It bridges the gap between physical hardware scanners and digital workflows, providing a secure environment for processing and generating QR codes.

Features:
 - Hardware Integration: Optimized for "Keyboard Emulation" QR scanners.
 - Keystroke Buffering: Intelligent input handling in Rust to capture high-speed scanner data without UI lag.
 - Domain Verification: Real-time URL parsing and security checks against user-defined lists.
 - Interactive Toasts: One-click "Open Link" functionality for verified safe domains via Sonner.
 - High-Fidelity Rendering: Generate sharp QR codes with custom foreground colors.
 - Branding: Support for "Logo Excavation" so you can place your brand in the center of the code without breaking scannability.
 - Copy to Clipboard: Automatically adds a professional white "quiet zone" border for better pasting into documents.
 - Native Download: Export as PNG directly to your file system using native OS dialogs.
 - Domain Control: Integrated Allowlist and Blocklist management.
 - Tauri Store: All settings (security lists, app preferences) are persisted to a local JSON file in your OS application data folder.
 - Local History: Keep track of recent scans during your session with quick-copy actions.

Local Development:
  - Clone the repo: `git clone https://github.com/csp197/openqr.git && cd openqr`
  - Install dependencies: `bun install`
  - Run in development mode: `bun run tauri dev`
  - Build application: `bun tauri build --bundles app`

  ```
  To create a release, all changes must be merged to `main` and a tag must be applied to the commit.
  
  git tag v1.0.0
  git push origin v1.0.0
  ```

 <a target="_blank" href="https://icons8.com/icon/WDy6fnNnJEm0/qr-code">QR Code</a> icon by <a target="_blank" href="https://icons8.com">Icons8</a>
