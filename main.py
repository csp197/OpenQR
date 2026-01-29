import sys
from PyQt6.QtWidgets import QApplication
from openqr.qt.app import OpenQRApp
from openqr.utils import printer
from openqr.utils import logger
from traceback import format_exception

# Set up logging
log = logger.setup_logger()


def global_exception_hook(exctype, value, tb):
    """
    Catch all unhandled exceptions, log them, and prevent silent crashes.
    """
    # Format the traceback into a string
    traceback_details = "".join(format_exception(exctype, value, tb))

    # Log the critical error
    log.critical(f"Unhandled exception caught by hook:\n{traceback_details}")

    # Also print to stderr
    sys.stderr.write(f"Unhandled exception:\n{traceback_details}")

    # We can add a popup message here if we have a GUI running
    # from PyQt6.QtWidgets import QMessageBox
    # QMessageBox.critical(None, "Critical Error", f"An unhandled exception occurred:\n\n{traceback_details}\nPlease see crash_report.log for details.")

    sys.exit(1)  # Ensure the application exits with an error code


if __name__ == "__main__":
    # --- Set the hook ---
    sys.excepthook = global_exception_hook

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
