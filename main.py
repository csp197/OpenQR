import sys
from PyQt6.QtWidgets import QApplication
from openqr.app import OpenQRApp
from openqr.utils import printer

if __name__ == "__main__":

    if any(value in sys.argv for value in ("--help", "-h")):
        printer.print_help()
        sys.exit(0)
    elif any(value in sys.argv for value in ("--version", "-v")):
        printer.print_version()
        sys.exit(0)

    app = QApplication(sys.argv)
    window = OpenQRApp()
    window.show()
    sys.exit(app.exec())
