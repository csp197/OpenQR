from PyQt6.QtCore import QObject, pyqtSignal

from openqr.core.keyboard_scanner_event_filter import KeyboardScannerEventFilter
from openqr.utils import logger

log = logger.setup_logger()

class QRListener(QObject):
    url_scanned = pyqtSignal(
        str
    )  # Emitted when a QR code is successfully scanned (URL)

    def __init__(self, timeout=1.0, prefix="", suffix="\r"):
        super().__init__()
        self.timeout = timeout
        self._scanner_keystroke_buffer = ""
        self._scanner_event_filter = None
        self.is_listening = False
        self.prefix = prefix
        self.suffix = suffix

        log.info(
            f"QRCodeListener initialized with prefix={repr(prefix)}, suffix={repr(suffix)}"
        )

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix

        log.info(f"Prefix set to: {repr(prefix)}, Suffix set to: {repr(suffix)}")

    def feed_data(self, chunk: str):
        if not self.is_listening:
            return

        self._scanner_keystroke_buffer += chunk
        log.debug(f"Buffer updated: {repr(self._scanner_keystroke_buffer)}")

        # If prefix is set, ensure buffer starts with prefix; otherwise reset buffer
        if self.prefix and not self._scanner_keystroke_buffer.startswith(self.prefix):
            log.debug("Buffer does not start with prefix. Clearing buffer.")
            self._scanner_keystroke_buffer = ""
            return

        # If suffix is set and buffer ends with suffix, process the full data
        if self.suffix and self._scanner_keystroke_buffer.endswith(self.suffix):
            self.process_scanned_data(self._scanner_keystroke_buffer)
            self._scanner_keystroke_buffer = ""

    def process_scanned_data(self, data):
        log.debug(f"Processing scanned data: {repr(data)}")
        if self.prefix and not data.startswith(self.prefix):
            log.debug(f"Prefix not detected in: {repr(data)}")
            return
        if self.suffix and not data.endswith(self.suffix):
            log.debug(f"Suffix not detected in: {repr(data)}")
            return
        # Strip prefix and suffix
        url = data
        if self.prefix:
            url = url[len(self.prefix) :]
        if self.suffix:
            url = url[: -len(self.suffix)]

        log.info(f"Prefix and suffix detected. Emitting scanned URL: {url}")
        self.emit_url_scanned(url)

    def start_listening(self):
        self.is_listening = True
        log.info("QRCodeListener started listening.")
        self._install_scanner_event_filter()

    def stop_listening(self):
        self.is_listening = False
        log.info("QRCodeListener stopped listening.")
        self._scanner_keystroke_buffer = ""


    def emit_url_scanned(self, url):
        log.info(f"Emitting url_scanned signal with URL: {url}")
        self.url_scanned.emit(url)

    def _install_scanner_event_filter(self):
        if not self._scanner_event_filter and self.is_listening:
            self._scanner_event_filter = KeyboardScannerEventFilter(self)
            self.installEventFilter(self._scanner_event_filter)
            self._scanner_event_filter.start_global_keyboard_hook()
            log.info("Scanner event filter installed and global hook added.")

    def _remove_scanner_event_filter(self):
        if self._scanner_event_filter:
            self.removeEventFilter(self._scanner_event_filter)
            self._scanner_event_filter.stop_global_keyboard_hook()
            self._scanner_event_filter = None
            self._scanner_keystroke_buffer = ""
            log.info("Scanner event filter removed and global hook stopped.")
