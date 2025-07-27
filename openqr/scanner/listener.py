from PyQt5.QtCore import QObject, QSize, QState, Qt, pyqtSignal

class QRCodeListener(QObject):
    url_opened = pyqtSignal(str, str) # title, message

    def __init__(self, timeout=1.0, allowed_domains=None):
        super().__init__()
        self.buffer = ""
        self.is_listening = False
        return

    def start_listening(self):
        self.is_listening = True
        return

    def stop_listening(self):
        self.is_listening = False
        return
