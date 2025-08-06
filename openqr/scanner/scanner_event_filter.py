from PyQt6.QtCore import Qt, QObject, QEvent
from openqr.utils import logger
from typing import Optional

log = logger.setup_logger()

class ScannerEventFilter(QObject):
    def __init__(self, outer_app):
        super().__init__()
        self.outer = outer_app
        self.prefix = outer_app.scanner_prefix
        self.suffix = outer_app.scanner_suffix
        self.buffer = ""

    def eventFilter(self, a0: Optional[QObject], a1: Optional[QEvent]):

        if not a0 or not a1:
            return False

        obj = a0
        event = a1
        if event.type() == QEvent.Type.KeyPress:
            key_text = event.text()
            key_code = event.key()
            if key_text:
                self.buffer += key_text
            elif key_code == Qt.Key.Key_Return or key_code == Qt.Key.Key_Enter:
                self.buffer += '\r'

            # Debug logging
            log.debug(f"[KEY] Pressed: {repr(key_text)}, Buffer: {repr(self.buffer)}")

            # Check prefix
            if self.prefix and not self.buffer.startswith(self.prefix):
                return False  # Wait until prefix is matched

            # Check suffix
            if self.suffix and self.buffer.endswith(self.suffix):
                full_data = self.buffer
                self.buffer = ""  # Reset for next scan
                log.info(f"[SCAN] Full data detected: {repr(full_data)}")
                self.outer.process_scanned_data(full_data)

            return False  # Let other handlers run
        return False
