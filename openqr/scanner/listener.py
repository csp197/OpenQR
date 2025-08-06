from PyQt6.QtCore import QObject, pyqtSignal

from openqr.utils import logger

log = logger.setup_logger()


class QRCodeListener(QObject):
    url_scanned = pyqtSignal(str)  # Emitted when a QR code is successfully scanned (URL)
    url_opened = pyqtSignal(str, str)  # title, message

    def __init__(self, timeout=1.0, allowed_domains=None, prefix="", suffix="\r"):
        super().__init__()
        self.buffer = ""
        self.is_listening = False
        self.prefix = prefix
        self.suffix = suffix

        log.info(f"QRCodeListener initialized with prefix={repr(prefix)}, suffix={repr(suffix)}")

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix

        log.info(f"Prefix set to: {repr(prefix)}, Suffix set to: {repr(suffix)}")

    def feed_data(self, chunk: str):
        if not self.is_listening:
            return

        self.buffer += chunk
        log.debug(f"Buffer updated: {repr(self.buffer)}")

        # If prefix is set, ensure buffer starts with prefix; otherwise reset buffer
        if self.prefix and not self.buffer.startswith(self.prefix):
            log.debug("Buffer does not start with prefix. Clearing buffer.")
            self.buffer = ""
            return

        # If suffix is set and buffer ends with suffix, process the full data
        if self.suffix and self.buffer.endswith(self.suffix):
            self.process_scanned_data(self.buffer)
            self.buffer = ""

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
            url = url[len(self.prefix):]
        if self.suffix:
            url = url[:-len(self.suffix)]

        log.info(f"Prefix and suffix detected. Emitting scanned URL: {url}")
        self.emit_url_scanned(url)

    def start_listening(self):
        self.is_listening = True
        log.info("QRCodeListener started listening.")

    def stop_listening(self):
        self.is_listening = False
        self.buffer = ""
        log.info("QRCodeListener stopped listening.")

    def emit_url_scanned(self, url):
        log.info(f"Emitting url_scanned signal with URL: {url}")
        self.url_scanned.emit(url)
