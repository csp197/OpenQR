from PyQt6.QtCore import QObject, QEvent
from PyQt6.QtGui import QKeyEvent
import keyboard  # pip install keyboard
from openqr.utils import logger

log = logger.setup_logger()

class KeyboardScannerEventFilter(QObject):
    def __init__(self, outer):
        super().__init__()
        self.outer = outer
        self._listening = False
        log.info("Keyboard Scanner Event Filter intialized")

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
        if not self.outer.is_listening or not self._listening:
            return False
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

            suffix = self.outer.suffix
            if suffix and self.outer._scanner_keystroke_buffer.endswith(suffix):
                data = self.outer._scanner_keystroke_buffer
                self.outer._scanner_keystroke_buffer = ""
                log.info(f"Suffix detected, processing data: {data}")
                self.outer.process_scanned_data(data)

    def eventFilter(self, a0: QObject|None, a1: QEvent|None):
        if not self.outer.is_listening or not self._listening:
            return False
        # watched = a0
        event = a1 # <- to appease static type checking
        # Also keep GUI eventFilter if you want local keyboard capture
        if event is not None and event.type() == QEvent.Type.KeyPress and isinstance(event, QKeyEvent):
            key = event.text()
            if key:
                self.outer._scanner_keystroke_buffer += key
                suffix = self.outer.suffix
                if suffix and self.outer._scanner_keystroke_buffer.endswith(suffix):
                    data = self.outer._scanner_keystroke_buffer
                    self.outer._scanner_keystroke_buffer = ""
                    self.outer.process_scanned_data(data)
        return False  # Continue normal event processing
