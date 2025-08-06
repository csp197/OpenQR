from PyQt6.QtCore import QObject, QEvent
import keyboard  # pip install keyboard
from openqr.utils import logger

log = logger.setup_logger()

class ScannerEventFilter(QObject):
    def __init__(self, outer):
        super().__init__()
        self.outer = outer
        self._listening = False

    def start_global_keyboard_hook(self):
        if not self._listening:
            log.info("Starting global keyboard hook.")
            # Hook keyboard globally, call self._on_key_event on each key press
            keyboard.hook(self._on_key_event)
            self._listening = True

    def stop_global_keyboard_hook(self):
        if self._listening:
            log.info("Stopping global keyboard hook.")
            keyboard.unhook_all()
            self._listening = False

    def _on_key_event(self, event):
        # We only want key down events (not key up)
        if event.event_type == "down":
            key = event.name
            # Handle special keys that might be used as suffixes
            # For regular character keys, just append them
            if len(key) == 1:
                self.outer._scanner_keystroke_buffer += key
            else:
                # Map special keys like 'enter', 'tab', 'space' to characters if needed
                if key == "enter":
                    self.outer._scanner_keystroke_buffer += "\n"
                elif key == "tab":
                    self.outer._scanner_keystroke_buffer += "\t"
                elif key == "space":
                    self.outer._scanner_keystroke_buffer += " "
                else:
                    # Ignore other special keys
                    return

            suffix = self.outer.scanner_suffix
            if suffix and self.outer._scanner_keystroke_buffer.endswith(suffix):
                data = self.outer._scanner_keystroke_buffer
                self.outer._scanner_keystroke_buffer = ""
                log.info(f"Suffix detected, processing data: {data}")
                self.outer.qr_code_listener.process_scanned_data(data)

    def eventFilter(self, obj, event):
        # Also keep GUI eventFilter if you want local keyboard capture
        if event.type() == QEvent.Type.KeyPress:
            key = event.text()
            if key:
                self.outer._scanner_keystroke_buffer += key
                suffix = self.outer.scanner_suffix
                if suffix and self.outer._scanner_keystroke_buffer.endswith(suffix):
                    data = self.outer._scanner_keystroke_buffer
                    self.outer._scanner_keystroke_buffer = ""
                    self.outer.qr_code_listener.process_scanned_data(data)
        return False  # Continue normal event processing
