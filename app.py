import sys

from PyQt5.QtCore import QObject, QSize, Qt, pyqtSignal
from PyQt5.QtWidgets import QApplication, QMainWindow, QPushButton

class QRCodeListener(QObject):
    url_opened = pyqtSignal(str, str) # title, message

    def __init__(self, timeout=1.0, allowed_domains=None):
        super().__init__()
        self.buffer = ""


class OpenQRApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("OpenQR - QR Code URL Listener")
        self.setMinimumSize(400, 400)

        self.listener = QRCodeListener(timeout=1.0)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = OpenQRApp()
    window.show()
    sys.exit(app.exec())
