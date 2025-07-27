import sys
from PyQt5.QtWidgets import QApplication, QMainWindow, QPushButton, QStatusBar, QVBoxLayout, QWidget

from scanner.listener import QRCodeListener
from constants import START_LISTENING_MSG, STOP_LISTENING_MSG, INACTIVE_LISTENER_MSG, ACTIVE_LISTENER_MSG

class OpenQRApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("OpenQR")
        self.setMinimumSize(800, 800)

        # instantiate QR code listener
        self.qr_code_listener = QRCodeListener(timeout=1.0)

        # creating main widget and layout
        main_widget = QWidget()
        layout = QVBoxLayout()
        # setting layout and central widget
        main_widget.setLayout(layout)
        self.setCentralWidget(main_widget)

        # creating toggle button
        self.toggle_btn = QPushButton(START_LISTENING_MSG)
        self.toggle_btn.pressed.connect(self.toggle_listener)
        layout.addWidget(self.toggle_btn)

        # creating status bar
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage(INACTIVE_LISTENER_MSG)

    def toggle_listener(self):
        if self.qr_code_listener.is_listening:
            self.qr_code_listener.stop_listening()
            self.toggle_btn.setText(STOP_LISTENING_MSG)
            self.status_bar.showMessage(ACTIVE_LISTENER_MSG)
        else:
            self.qr_code_listener.start_listening()
            self.toggle_btn.setText(START_LISTENING_MSG)
            self.status_bar.showMessage(INACTIVE_LISTENER_MSG)



if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = OpenQRApp()
    window.show()
    sys.exit(app.exec())
