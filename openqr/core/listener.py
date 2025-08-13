from PyQt6.QtCore import QObject, pyqtSignal, QMutex
from PyQt6.QtWidgets import QApplication
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
        self.is_listening = False
        self.prefix = prefix
        self.suffix = suffix
        self._mutex = QMutex()

        log.info(f"QRListener initialized with prefix={repr(prefix)}, suffix={repr(suffix)}")

    def start_listening(self):
        """
        Starts listening globally for scanner input.
        """
        app = QApplication.instance()
        if not app:
            log.error("QApplication must be running before starting QRListener.")
            return

        self.is_listening = True
        self._install_event_filter()
        log.info("QRListener started listening globally for scanner input.")

    def stop_listening(self):
        """
        Stops listening and cleans up.
        """
        self.is_listening = False
        self._remove_event_filter()

        self._mutex.lock()
        try:
            self._scanner_keystroke_buffer = ""
        finally:
            self._mutex.unlock()

        log.info("QRListener stopped listening.")

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix
        log.info(f"Prefix set to: {repr(prefix)}, Suffix set to: {repr(suffix)}")

    def feed_data(self, chunk: str):
        """
        Thread-safely appends a character to the buffer and processes it.
        Normalizes endings for cross-platform suffix detection.
        """
        if not self.is_listening:
            return

        # Normalize endings here too, just in case
        if chunk in ("\r\n", "\n"):
            chunk = "\r"

        self._mutex.lock()
        try:
            self._scanner_keystroke_buffer += chunk
            log.debug(f"Buffer updated: {repr(self._scanner_keystroke_buffer)}")

            # Ensure buffer starts with prefix
            if self.prefix and not self._scanner_keystroke_buffer.startswith(self.prefix):
                log.debug("Buffer does not match prefix. Clearing buffer.")
                self._scanner_keystroke_buffer = ""
                return

            # Normalize buffer for suffix detection
            normalized_buffer = (
                self._scanner_keystroke_buffer
                .replace("\r\n", "\r")
                .replace("\n", "\r")
            )

            if self.suffix and normalized_buffer.endswith(self.suffix):
                self.process_scanned_data(normalized_buffer)
                self._scanner_keystroke_buffer = ""
        finally:
            self._mutex.unlock()

    def process_scanned_data(self, data: str):
        """
        Strips prefix/suffix and emits the clean URL.
        """
        log.debug(f"Processing scanned data: {repr(data)}")

        if (self.prefix and not data.startswith(self.prefix)) or (
            self.suffix and not data.endswith(self.suffix)
        ):
            log.debug("Prefix or suffix mismatch during processing.")
            return

        url = data
        if self.prefix:
            url = url[len(self.prefix):]
        if self.suffix:
            url = url[:-len(self.suffix)]

        log.info(f"Prefix and suffix stripped. Emitting scanned URL: {url}")
        self.emit_url_scanned(url)

    def emit_url_scanned(self, url: str):
        log.info(f"Emitting url_scanned signal with URL: {url}")
        self.url_scanned.emit(url)

    def _install_event_filter(self):
        if not self._event_filter:
            self._event_filter = KeyboardScannerEventFilter(self)
            app = QApplication.instance()
            app.installEventFilter(self._event_filter)
            log.info("Scanner event filter installed globally.")

    def _remove_event_filter(self):
        if self._event_filter:
            app = QApplication.instance()
            app.removeEventFilter(self._event_filter)
            self._event_filter = None
            log.info("Scanner event filter removed.")
