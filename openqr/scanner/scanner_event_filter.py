import sys
from PyQt6.QtCore import QObject, QEvent
from openqr.utils import logger

log = logger.setup_logger()


import keyboard  # Global keyboard hook for Windows


class ScannerEventFilter(QObject):
    def __init__(self, outer):
        super().__init__()
        self.outer = outer
        self._global_hook_enabled = False

        if sys.platform.startswith("win"):
            self.start_global_keyboard_hook()

    def start_global_keyboard_hook(self):
        if not self._global_hook_enabled:
            log.info("Starting global keyboard hook on Windows")
            keyboard.hook(self._on_global_key_event)
            self._global_hook_enabled = True

    def stop_global_keyboard_hook(self):
        if self._global_hook_enabled:
            log.info("Stopping global keyboard hook on Windows")
            keyboard.unhook_all()
            self._global_hook_enabled = False

    def _on_global_key_event(self, event):
        # Only handle key down events
        if event.event_type == "down":
            key = event.name
            if key is None:
                return

            # Normalize Enter keys and whitespace keys to a suffix marker
            suffix_keys = {"enter", "return", "tab", "space"}

            # Append key text or suffix character
            if key in suffix_keys:
                suffix = self.outer.scanner_suffix or "\n"
                self.outer._scanner_keystroke_buffer += suffix
                if self.outer._scanner_keystroke_buffer.endswith(suffix):
                    data = self.outer._scanner_keystroke_buffer
                    self.outer._scanner_keystroke_buffer = ""
                    self.outer.qr_code_listener.process_scanned_data(data)
            else:
                # Append normal key character (handle single char keys only)
                if len(key) == 1:
                    self.outer._scanner_keystroke_buffer += key

    def eventFilter(self, obj, event):
        # Qt event filter for macOS and focused app
        if event.type() == QEvent.Type.KeyPress:
            key = event.text()
            if key:
                self.outer._scanner_keystroke_buffer += key
                # Check for suffix
                suffix = self.outer.scanner_suffix
                if suffix and self.outer._scanner_keystroke_buffer.endswith(suffix):
                    data = self.outer._scanner_keystroke_buffer
                    self.outer._scanner_keystroke_buffer = ""
                    self.outer.qr_code_listener.process_scanned_data(data)
        return False  # Continue normal event processing
