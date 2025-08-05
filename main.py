import sys
from PyQt6.QtWidgets import QApplication
from openqr.app import OpenQRApp


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = OpenQRApp()
    window.show()
    sys.exit(app.exec())
