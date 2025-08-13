from PyQt6.QtCore import QObject, QEvent, Qt
from openqr.utils import logger

log = logger.setup_logger()


class KeyboardScannerEventFilter(QObject):
    """
    Cross-platform keyboard event filter for barcode/QR scanners.
    - Works even if Qt can't map the keycode (Qt.Key.Unknown).
    - Normalizes CRLF endings to CR for suffix detection.
    - Can be installed on QApplication for global listening.
    """

    def __init__(self, listener):
        super().__init__(listener)
        self.listener = listener

    def eventFilter(self, watched_obj: QObject | None, event: QEvent | None) -> bool:
        if event is None or not self.listener.is_listening:
            return super().eventFilter(watched_obj, event)

        if event.type() != QEvent.Type.KeyPress:
            return super().eventFilter(watched_obj, event)

        key_text = None

        # Handle Enter/Return explicitly
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            key_text = "\r"
        elif event.key() == Qt.Key.Key_Tab:
            key_text = "\t"
        else:
            # On Windows, scanners often send Qt.Key.Unknown but still have event.text()
            key_text = event.text()

        if key_text:
            # Normalize CRLF and LF to CR
            key_text = key_text.replace("\r\n", "\r").replace("\n", "\r")

            log.debug(f"Scanner keystroke captured: {repr(key_text)}")
            self.listener.feed_data(key_text)
            return True  # Consume event

        return super().eventFilter(watched_obj, event)
