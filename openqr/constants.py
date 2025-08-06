# constants
START_LISTENING_MSG = "Start listening"
STOP_LISTENING_MSG = "Stop listening"
ACTIVE_LISTENER_MSG = (
    "This program is currently listening to your keyboard for a QR Code."
)
INACTIVE_LISTENER_MSG = (
    "NOTE: This program is not currently listening to your keyboard for a QR Code."
)
HELP_MESSAGE = """
<b>🆘 OpenQR Help</b><br><br>

<b>🎧 Listening Mode:</b><br>
Click the <i>'Start Listening'</i> button to begin capturing QR scans from your hardware scanner.
Make sure your scanner is configured as an HID (keyboard emulation) device. When listening, scanned URLs
will be automatically processed and displayed.<br><br>

<b>🧩 Prefix/Suffix Handling:</b><br>
Some scanners add extra characters before or after a scanned code (like ENTER or custom text).
Use Scanner Settings to define a prefix and/or suffix to trim from incoming scan data, ensuring cleaner URL detection.<br><br>

<b>🌐 Domain Management:</b><br>
Whitelist or blacklist domains based on your preferences. You can control which scanned URLs are considered valid,
and even block unwanted domains for safety. Accessible under <i>Settings > Domain Management</i>.<br><br>

<b>🔐 URL Safety Settings:</b><br>
Define which URL protocols are considered safe (e.g., <code>https</code>, <code>mailto</code>).
This helps filter out suspicious or insecure links during scanning.<br><br>

<b>🖼️ Upload Logo:</b><br>
Add a personal or brand logo to your generated QR codes. This can be done from the QR generator section.
Ensure your logo is high-contrast to maintain QR code readability.<br><br>

<b>🧪 QR Generator:</b><br>
Enter a URL to generate a QR code. You can customize its foreground and background colors.
Once generated, you can save it or copy it directly to your clipboard.<br><br>

<b>📜 Scan History:</b><br>
Every scanned URL is stored locally in your scan history. Access the history from the sidebar to view,
copy, or clear previous scans.<br><br>

<b>ℹ️ Status Bar:</b><br>
Keep an eye on the status bar for real-time messages like scanning state, success confirmations, or warnings.<br><br>

<b>💡 Tips:</b><br>
• Use high-resolution screens for best QR readability.<br>
• If scans aren’t detected, ensure your scanner outputs plain text and no conflicting key mappings.<br>
"""
