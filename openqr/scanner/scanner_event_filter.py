from PyQt6.QtCore import QObject, QEvent
from openqr.utils import logger

log = logger.setup_logger()

class ScannerEventFilter(QObject):
    def __init__(self, outer):
        super().__init__()
        self.outer = outer
    def eventFilter(self, obj, event):
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
