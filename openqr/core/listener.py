from typing import List

from PyQt6.QtCore import (
    QMetaObject,
    QMutex,
    QMutexLocker,
    QObject,
    Qt,
    QTimer,
    pyqtSignal,
    pyqtSlot,
)
from PyQt6.QtWidgets import QApplication

from openqr.core.keyboard_scanner_event_filter import KeyboardScannerEventFilter
from openqr.utils import functions, logger

log = logger.setup_logger()


class QRListener(QObject):
    """
    Thread-safe QR Listener for keyboard-scanner input.

    Features:
    - canonicalizes prefix/suffix newlines
    - extracts multiple scans from a single chunk
    - preserves partial prefix tails
    - timeout to clear partial buffers
    - stop_after_first_scan support (safe GUI-thread stop)
    """

    url_scanned = pyqtSignal(str)
    _dispatch_scanned = pyqtSignal(str)

    def __init__(
        self,
        timeout: float = 1.0,
        prefix: str = "",
        suffix: str = "\r",
        stop_after_first_scan: bool = False,
    ):
        super().__init__()
        self.timeout = float(timeout) if timeout else 0.0
        self._scanner_keystroke_buffer = ""
        self._event_filter = None
        self.is_listening = False

        self.prefix = functions.normalize_newlines(prefix)
        self.suffix = functions.normalize_newlines(suffix)
        self.stop_after_first_scan = bool(stop_after_first_scan)

        self._mutex = QMutex()

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._clear_buffer_on_timeout)

        # Ensure emission happens on this object's thread
        self._dispatch_scanned.connect(self._on_dispatch_scanned)

        log.info(
            f"QRListener initialized with prefix={repr(self.prefix)}, "
            f"suffix={repr(self.suffix)}, timeout={self.timeout}, "
            f"stop_after_first_scan={self.stop_after_first_scan}"
        )

    # ---------------------
    # Public API
    # ---------------------
    def start_listening(self):
        app = QApplication.instance()
        if not app:
            log.error("QApplication must be running before starting QRListener.")
            return

        with QMutexLocker(self._mutex):
            self.is_listening = True

        # Install event filter on this object's thread via queued invocation
        QMetaObject.invokeMethod(
            self, "_install_event_filter", Qt.ConnectionType.QueuedConnection
        )

        log.info("QRListener requested start (install scheduled).")

    def stop_listening(self):
        # set flag under lock so feed_data sees it
        with QMutexLocker(self._mutex):
            self.is_listening = False

        # remove event filter on this object's thread via queued invocation
        QMetaObject.invokeMethod(
            self, "_remove_event_filter", Qt.ConnectionType.QueuedConnection
        )

        with QMutexLocker(self._mutex):
            self._timer.stop()
            self._scanner_keystroke_buffer = ""

        log.info("QRListener requested stop (remove scheduled).")

    def set_prefix_suffix(self, prefix: str, suffix: str):
        with QMutexLocker(self._mutex):
            self.prefix = functions.normalize_newlines(prefix)
            self.suffix = functions.normalize_newlines(suffix)
        log.info(
            f"Prefix set to: {repr(self.prefix)}, Suffix set to: {repr(self.suffix)}"
        )

    def set_stop_after_first_scan(self, enabled: bool):
        with QMutexLocker(self._mutex):
            self.stop_after_first_scan = bool(enabled)
        log.info(f"stop_after_first_scan set to: {self.stop_after_first_scan}")

    # ---------------------
    # Feeding and processing
    # ---------------------
    def feed_data(self, chunk: str):
        """
        Append incoming data (thread-safe). Processes multiple full scans in a single chunk.
        """
        if chunk in ("\r\n", "\n"):
            chunk = "\r"

        messages: List[str] = []

        with QMutexLocker(self._mutex):
            if not self.is_listening:
                log.debug("feed_data called while not listening — ignoring.")
                return

            self._scanner_keystroke_buffer += chunk
            log.debug(f"Buffer updated: {repr(self._scanner_keystroke_buffer)}")

            if self.timeout and self.timeout > 0:
                self._timer.start(int(self.timeout * 1000))

            # Prefix handling: keep possible prefix-suffix tails if not yet present
            if self.prefix:
                idx = self._scanner_keystroke_buffer.find(self.prefix)
                if idx == -1:
                    max_keep = max(0, len(self.prefix) - 1)
                    if len(self._scanner_keystroke_buffer) > max_keep:
                        self._scanner_keystroke_buffer = self._scanner_keystroke_buffer[
                            -max_keep:
                        ]
                elif idx > 0:
                    self._scanner_keystroke_buffer = self._scanner_keystroke_buffer[
                        idx:
                    ]

            # Extract complete messages by suffix
            if self.suffix:
                while True:
                    end_pos = self._scanner_keystroke_buffer.find(self.suffix)
                    if end_pos == -1:
                        break
                    raw = self._scanner_keystroke_buffer[: end_pos + len(self.suffix)]
                    messages.append(raw)
                    self._scanner_keystroke_buffer = self._scanner_keystroke_buffer[
                        end_pos + len(self.suffix) :
                    ]

        # Process outside lock
        for raw in messages:
            try:
                self.process_scanned_data(raw)
            except Exception:
                log.exception("Error processing scanned data")

    def process_scanned_data(self, data: str):
        """
        Validate prefix/suffix, strip them, and dispatch the URL.
        If stop_after_first_scan is enabled, schedule stopping.
        """
        log.debug(f"Processing scanned data: {repr(data)}")

        if (self.prefix and not data.startswith(self.prefix)) or (
            self.suffix and not data.endswith(self.suffix)
        ):
            log.debug("Prefix or suffix mismatch during processing.")
            return

        url = data
        if self.prefix:
            url = url[len(self.prefix) :]
        if self.suffix:
            url = url[: -len(self.suffix)]

        log.info(f"Dispatching scanned URL: {url}")
        # Ensure emission happens on the object's thread
        self._dispatch_scanned.emit(url)

        # Stop after first if enabled (schedule stop on GUI thread)
        with QMutexLocker(self._mutex):
            stop_flag = self.stop_after_first_scan

        if stop_flag:
            log.info("stop_after_first_scan enabled — scheduling stop.")
            QMetaObject.invokeMethod(
                self,
                "_stop_listening_in_gui_thread",
                Qt.ConnectionType.QueuedConnection,
            )

    # ---------------------
    # Internal signal slot for emission
    # ---------------------
    @pyqtSlot(str)
    def _on_dispatch_scanned(self, url: str):
        try:
            log.info(f"Emitting url_scanned with URL: {url}")
            self.url_scanned.emit(url)
        except Exception:
            log.exception("Exception while emitting url_scanned")

    # ---------------------
    # Timer helper
    # ---------------------
    @pyqtSlot()
    def _clear_buffer_on_timeout(self):
        with QMutexLocker(self._mutex):
            if self._scanner_keystroke_buffer:
                log.debug("Clearing scanner buffer due to timeout.")
                self._scanner_keystroke_buffer = ""

    # ---------------------
    # Event filter install/remove (must run on object's thread)
    # ---------------------
    @pyqtSlot()
    def _install_event_filter(self):
        if self._event_filter:
            log.debug("Event filter already installed; skipping.")
            return

        app = QApplication.instance()
        if not app:
            log.error(
                "QApplication instance not available; cannot install event filter."
            )
            return

        self._event_filter = KeyboardScannerEventFilter(self)
        app.installEventFilter(self._event_filter)
        log.info("Scanner event filter installed globally (on object thread).")

    @pyqtSlot()
    def _remove_event_filter(self):
        if not self._event_filter:
            log.debug("No event filter to remove.")
            return

        app = QApplication.instance()
        if not app:
            log.warning(
                "QApplication instance not available when removing event filter. Clearing local ref."
            )
            self._event_filter = None
            return

        try:
            app.removeEventFilter(self._event_filter)
            log.info("Scanner event filter removed (on object thread).")
        except Exception:
            log.exception("Error while removing scanner event filter.")
        finally:
            self._event_filter = None

    # ---------------------
    # Safe stop invoker that runs on GUI thread
    # ---------------------
    @pyqtSlot()
    def _stop_listening_in_gui_thread(self):
        # This runs on the listener's thread (should be GUI). Calls stop_listening to ensure proper cleanup.
        try:
            self.stop_listening()
        except Exception:
            log.exception("Exception while stopping listener in GUI thread.")
