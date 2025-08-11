from openqr.utils import logger
from wsgiref.types import StartResponse

log = logger.setup_logger()

class QRCliListener:
    """
    Listens for QR code scans via the command line.
    """
    def __init__(self, prefix="", suffix=""):
        self.keystroke_buffer = ""
        self.is_listening = False
        self.prefix = prefix
        self.suffix = suffix
        log.info(
            f"QRCliListener initialized with prefix={repr(prefix)}, suffix={repr(suffix)}"
        )

    def start_listening(self):
        self.is_listening = True

    def stop_listening(self):
        self.is_listening = False

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix
