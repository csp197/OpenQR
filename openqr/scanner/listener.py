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
        
        return

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix
        
        log.info(f"Prefix set to: {repr(prefix)}, Suffix set to: {repr(suffix)}")
        
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
        return

    def start_listening(self):
        self.is_listening = True
        log.info("QRCodeListener started listening.")
        return

    def stop_listening(self):
        self.is_listening = False
        log.info("QRCodeListener stopped listening.")
        return

    def emit_url_scanned(self, url):
        log.info(f"Emitting url_scanned signal with URL: {url}")
        self.url_scanned.emit(url)
        return
