from PyQt6.QtCore import QObject, QEvent, Qt
from openqr.utils import logger

log = logger.setup_logger()

# from PyQt6.QtCore import QObject, QEvent, Qt

class KeyboardScannerEventFilter(QObject):
    """
    Filters keyboard events on a specific Qt widget.

    This filter captures key presses, converts them to text, and passes
    the data to the parent listener. It is designed to work without
    global hooks, relying entirely on Qt's event system.
    """
    def __init__(self, listener):
        super().__init__(listener)
        self.listener = listener

    def eventFilter(self, a0: QObject|None, a1: QEvent|None) -> bool:
        """
        Intercepts and processes keyboard events.
        """

        watched_obj = a0
        event = a1
        if event is not None:
            if (not self.listener.is_listening) or (event.type() != QEvent.Type.KeyPress):
                # If not listening or not a key press, ignore the event
                return super().eventFilter(watched_obj, event)

            key_text = None
            # Check for special keys that might be used as a suffix
            if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
                key_text = "\r"
            elif event.key() == Qt.Key.Key_Tab:
                key_text = "\t"
            else:
                # For all other keys, use the text they produce
                key_text = event.text()

            if key_text:
                # Pass the captured character to the listener's thread-safe method
                self.listener.feed_data(key_text)
                # Return True to indicate the event was handled and should not be
                # processed further by the watched widget.
                return True

        return super().eventFilter(watched_obj, event)
