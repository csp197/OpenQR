# from pyzbar.zbar_library import sys
from openqr.utils import logger

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
            f"OpenQR CLI Listener initialized with prefix={repr(prefix)}, suffix={repr(suffix)}"
        )

    def start_listening(self):
        self.is_listening = True
        log.info(
            "OpenQR CLI Listener started listening. Waiting for scanner input. (Press Ctrl+C to exit)"
        )

    def stop_listening(self):
        self.is_listening = False
        log.info("OpenQR CLI Listener stopped listening.")

    def listen(self):
        if not self.is_listening:
            return

    def set_prefix_suffix(self, prefix, suffix):
        self.prefix = prefix
        self.suffix = suffix
