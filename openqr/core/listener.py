# qr_listener.py
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
    Listens for QR code scans via Qt keyboard events and ensures
    thread-safe buffer manipulation and correct GUI-thread interactions.

    Notes:
    - This object should live in the GUI/main thread (create it there).
      If you call start_listening()/stop_listening() from background threads,
      they will schedule the event-filter install/remove on the object's (GUI) thread.
    - prefix and suffix are normalized so all newline variants are treated as '\r'.
    """

    # public signal consumers will connect to
    url_scanned = pyqtSignal(str)

    # internal signal used to ensure emission happens on this object's thread
    _dispatch_scanned = pyqtSignal(str)

    def __init__(self, timeout: float = 1.0, prefix: str = "", suffix: str = "\r"):
        """
        :param timeout: seconds of inactivity after which a partial buffer is cleared. 0 or None disables.
        :param prefix: optional prefix to expect at the start of a scan (normalized)
        :param suffix: suffix that denotes end-of-scan (normalized). defaults to '\r'
        """
        super().__init__()
        self.timeout = float(timeout) if timeout else 0.0
        self._scanner_keystroke_buffer = ""
        self._event_filter = None
        self.is_listening = False

        # normalize prefix/suffix to canonical representation
        def _norm_ending(s: str) -> str:
            if not s:
                return s
            return s.replace("\r\n", "\r").replace("\n", "\r")

        self.prefix = _norm_ending(prefix)
        self.suffix = _norm_ending(suffix)

        self._mutex = QMutex()

        # timer to clear partial buffers after inactivity
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._clear_buffer_on_timeout)

        # connect internal dispatcher so emissions execute in this object's thread
        # (AutoConnection becomes QueuedConnection if emitted from another thread).
        self._dispatch_scanned.connect(self._on_dispatch_scanned)

        log.info(
            f"QRListener initialized with prefix={repr(self.prefix)}, suffix={repr(self.suffix)}, timeout={self.timeout}"
        )

    # ---------------------
    # Public control methods
    # ---------------------
    def start_listening(self):
        """
        Starts global listening. Safe to call from other threads:
        installEventFilter will be scheduled on this object's thread.
        """
        app = QApplication.instance()
        if not app:
            log.error("QApplication must be running before starting QRListener.")
            return

        # set listening flag under mutex to avoid races with feed_data
        with QMutexLocker(self._mutex):
            self.is_listening = True

        # schedule event filter install to run on this object's thread (Queued)
        # this allows callers from other threads to safely request start
        QMetaObject.invokeMethod(
            self, "_install_event_filter", Qt.ConnectionType.QueuedConnection
        )

        log.info("QRListener requested start (install event filter scheduled).")

    def stop_listening(self):
        """
        Stops listening and cleans up. Safe to call from other threads:
        removeEventFilter will be scheduled on this object's thread.
        """
        # set listening flag under lock so feed_data sees the change
        with QMutexLocker(self._mutex):
            self.is_listening = False

        # schedule removal of event filter on this object's thread
        QMetaObject.invokeMethod(
            self, "_remove_event_filter", Qt.ConnectionType.QueuedConnection
        )

        # stop timer and clear buffer under mutex
        with QMutexLocker(self._mutex):
            self._timer.stop()
            self._scanner_keystroke_buffer = ""

        log.info("QRListener requested stop (remove event filter scheduled).")

    def set_prefix_suffix(self, prefix: str, suffix: str):
        """
        Set prefix and suffix (they are normalized).
        Prefer calling this from the GUI thread; if calling from another thread,
        be aware that feed_data may run concurrently.
        """
        # norm = lambda s: s.replace("\r\n", "\r").replace("\n", "\r") if s else s
        with QMutexLocker(self._mutex):
            self.prefix = functions.normalize_newlines(prefix)
            self.suffix = functions.normalize_newlines(suffix)
        log.info(
            f"Prefix set to: {repr(self.prefix)}, Suffix set to: {repr(self.suffix)}"
        )

    # ---------------------
    # Feeding and processing
    # ---------------------
    def feed_data(self, chunk: str):
        """
        Thread-safe append + process. Handles multiple complete messages in a single chunk.
        This method is safe to call from any thread.
        """

        if chunk in ("\r\n", "\n"):
            chunk = "\r"

        messages: List[str] = []

        with QMutexLocker(self._mutex):
            # check listening state under lock to avoid races with stop_listening
            if not self.is_listening:
                log.debug("feed_data called while not listening — ignoring chunk.")
                return

            # append chunk
            self._scanner_keystroke_buffer += chunk
            log.debug(f"Buffer updated: {repr(self._scanner_keystroke_buffer)}")

            # restart inactivity timer
            if self.timeout and self.timeout > 0:
                self._timer.start(int(self.timeout * 1000))

            # PREFIX handling:
            # If prefix is configured, try to find it. If not found, keep only
            # up to len(prefix)-1 trailing chars as possible partial-prefix.
            if self.prefix:
                idx = self._scanner_keystroke_buffer.find(self.prefix)
                if idx == -1:
                    # no full prefix in buffer — keep potential prefix tail
                    max_keep = max(0, len(self.prefix) - 1)
                    if len(self._scanner_keystroke_buffer) > max_keep:
                        self._scanner_keystroke_buffer = self._scanner_keystroke_buffer[
                            -max_keep:
                        ]
                elif idx > 0:
                    # drop garbage before prefix
                    self._scanner_keystroke_buffer = self._scanner_keystroke_buffer[
                        idx:
                    ]

            # EXTRACT all complete messages delimited by suffix
            if self.suffix:
                while True:
                    end_pos = self._scanner_keystroke_buffer.find(self.suffix)
                    if end_pos == -1:
                        break
                    # include suffix
                    raw = self._scanner_keystroke_buffer[: end_pos + len(self.suffix)]
                    messages.append(raw)
                    # remove extracted message from buffer
                    self._scanner_keystroke_buffer = self._scanner_keystroke_buffer[
                        end_pos + len(self.suffix) :
                    ]
            else:
                # no suffix configured; nothing to extract yet
                pass

        # Process messages outside of lock (emitting signals while unlocked)
        for raw in messages:
            try:
                self.process_scanned_data(raw)
            except Exception:
                log.exception("Error while processing scanned message (continuing)")

    def process_scanned_data(self, data: str):
        """
        Strips prefix/suffix and dispatches the clean URL via internal safe dispatch.
        Note: data is expected to be normalized (newlines canonicalized to '\r').
        """
        log.debug(f"Processing scanned data: {repr(data)}")

        # Guard again in case something slipped through
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

        log.info(f"Prefix and suffix stripped. Dispatching scanned URL: {url}")
        # Emit through internal dispatcher so emission executes on this object's thread.
        # If called from another thread, this signal will be queued and run on this object's thread.
        self._dispatch_scanned.emit(url)

    # ---------------------
    # Internal dispatch slot
    # ---------------------
    @pyqtSlot(str)
    def _on_dispatch_scanned(self, url: str):
        """
        Runs on the object's thread — performs the final emit to public signal.
        Keep this slot small; it's executed on the object's (GUI) thread.
        """
        try:
            log.info(f"Emitting url_scanned signal with URL: {url}")
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
                log.debug("Clearing scanner buffer due to timeout/inactivity.")
                self._scanner_keystroke_buffer = ""

    # ---------------------
    # Event filter install/remove (must run on object's thread)
    # ---------------------
    @pyqtSlot()
    def _install_event_filter(self):
        """
        Install the global event filter. This must be run on the GUI/object thread.
        It's marked as a slot and scheduled via QMetaObject.invokeMethod (Queued).
        """
        if self._event_filter:
            log.debug("Event filter already installed; skipping.")
            return

        app = QApplication.instance()
        if not app:
            log.error(
                "QApplication instance not available; cannot install event filter."
            )
            return

        # create filter with a reference to self (so it calls feed_data)
        self._event_filter = KeyboardScannerEventFilter(self)
        app.installEventFilter(self._event_filter)
        log.info("Scanner event filter installed globally (on object thread).")

    @pyqtSlot()
    def _remove_event_filter(self):
        """
        Remove the event filter. This must be run on the GUI/object thread.
        """
        if not self._event_filter:
            log.debug("No event filter installed; skipping removal.")
            return

        app = QApplication.instance()
        if not app:
            log.warning(
                "QApplication instance not available when removing event filter. "
                "Clearing local reference."
            )
            self._event_filter = None
            return

        try:
            app.removeEventFilter(self._event_filter)
            log.info("Scanner event filter removed (on object thread).")
        except Exception:
            log.exception("Error while removing scanner event filter (continuing).")
        finally:
            self._event_filter = None
