from PyQt6.QtCore import QObject, pyqtSignal, QMutex
from PyQt6.QtWidgets import QWidget

from openqr.core.keyboard_scanner_event_filter import KeyboardScannerEventFilter
from openqr.utils import logger

log = logger.setup_logger()

class QRListener(QObject):
    """
    Listens for QR code scans via Qt keyboard events and ensures
    thread-safe buffer manipulation.
    """
    url_scanned = pyqtSignal(str)

    def __init__(self, timeout=1.0, prefix="", suffix="\r"):
        super().__init__()
        self.timeout = timeout
        self._scanner_keystroke_buffer = ""
        self._event_filter = None
        self._target_widget = None
        self.is_listening = False
        self.prefix = prefix
        self.suffix = suffix

        # Mutex for thread-safe access to the buffer
        self._mutex = QMutex()

        log.info(
            f"QRListener initialized with prefix={repr(prefix)}, suffix={repr(suffix)}"
        )

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix
        log.info(f"Prefix set to: {repr(prefix)}, Suffix set to: {repr(suffix)}")

    def feed_data(self, chunk: str):
        """
        Thread-safely appends a character to the buffer and processes it.
        """
        if not self.is_listening:
            return

        self._mutex.lock()
        try:
            self._scanner_keystroke_buffer += chunk
            log.debug(f"Buffer updated: {repr(self._scanner_keystroke_buffer)}")

            # Ensure buffer starts with prefix (if one is set)
            if self.prefix and not self._scanner_keystroke_buffer.startswith(self.prefix):
                log.debug("Buffer does not match prefix. Clearing buffer.")
                self._scanner_keystroke_buffer = ""
                return

            # Process the buffer if the suffix is detected
            if self.suffix and self._scanner_keystroke_buffer.endswith(self.suffix):
                # Process data immediately, then clear buffer
                self.process_scanned_data(self._scanner_keystroke_buffer)
                self._scanner_keystroke_buffer = ""
        finally:
            self._mutex.unlock()

    def process_scanned_data(self, data: str):
        """
        Strips prefix/suffix and emits the clean URL.
        Assumes mutex is already locked when called from feed_data.
        """
        log.debug(f"Processing scanned data: {repr(data)}")

        # This check is technically redundant if called from feed_data but adds safety
        if (self.prefix and not data.startswith(self.prefix)) or \
           (self.suffix and not data.endswith(self.suffix)):
            log.debug("Prefix or suffix mismatch during processing.")
            return

        # Strip prefix and suffix to get the payload
        url = data
        if self.prefix:
            url = url[len(self.prefix):]
        if self.suffix:
            url = url[:-len(self.suffix)]

        log.info(f"Prefix and suffix stripped. Emitting scanned URL: {url}")
        self.emit_url_scanned(url)

    def start_listening(self, target_widget: QWidget):
        """
        Starts listening for events on a specific target widget.
        """
        if not isinstance(target_widget, QWidget):
            log.error("start_listening requires a valid QWidget to install the event filter on.")
            return

        self._target_widget = target_widget
        self.is_listening = True
        self._install_event_filter()
        log.info(f"QRListener started listening on widget: {target_widget.objectName()}")

    def stop_listening(self):
        """
        Stops listening and cleans up the event filter and buffer.
        """
        self.is_listening = False
        self._remove_event_filter()

        self._mutex.lock()
        try:
            self._scanner_keystroke_buffer = ""
        finally:
            self._mutex.unlock()

        log.info("QRListener stopped listening.")

    def emit_url_scanned(self, url: str):
        log.info(f"Emitting url_scanned signal with URL: {url}")
        self.url_scanned.emit(url)

    def _install_event_filter(self):
        if not self._event_filter and self._target_widget:
            self._event_filter = KeyboardScannerEventFilter(self)
            self._target_widget.installEventFilter(self._event_filter)
            log.info("Scanner event filter installed.")

    def _remove_event_filter(self):
        if self._event_filter and self._target_widget:
            self._target_widget.removeEventFilter(self._event_filter)
            self._event_filter = None
            log.info("Scanner event filter removed.")
