import sys
import validators
import qrcode
import pyperclip
from io import BytesIO

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QPushButton, QStatusBar, QVBoxLayout,
    QWidget, QLabel, QLineEdit, QHBoxLayout, QFileDialog, QMessageBox,
    QGroupBox
)
from PyQt5.QtGui import QPixmap, QImage, QIcon
from PyQt5.QtCore import Qt

from generator.generator import QRCodeGenerator
from scanner.listener import QRCodeListener
from constants import START_LISTENING_MSG, STOP_LISTENING_MSG, INACTIVE_LISTENER_MSG, ACTIVE_LISTENER_MSG


class OpenQRApp(QMainWindow):
    def __init__(self):
        super().__init__()

        # Instantiate listener and generator
        self.qr_code_listener = QRCodeListener(timeout=1.0)
        self.qr_code_generator = QRCodeGenerator()
        self.qr_image = None

        self._init_ui()

    def _init_ui(self):
        self.setWindowTitle("OpenQR - QR Code Scanner & Generator")
        self.setMinimumSize(900, 600)

        # Main widget and layout
        main_widget = QWidget()
        main_layout = QHBoxLayout()
        main_layout.setContentsMargins(15, 15, 15, 15)
        main_layout.setSpacing(20)
        main_widget.setLayout(main_layout)
        self.setCentralWidget(main_widget)

        # Scanner Controls Group
        scanner_group = QGroupBox("Scanner Controls")
        scanner_layout = QVBoxLayout()
        scanner_layout.setSpacing(15)
        scanner_group.setLayout(scanner_layout)

        self.toggle_btn = QPushButton(START_LISTENING_MSG)
        self.toggle_btn.setIcon(QIcon.fromTheme("media-playback-start"))
        self.toggle_btn.setMinimumHeight(40)
        self.toggle_btn.setFixedWidth(150)
        self.toggle_btn.pressed.connect(self.toggle_listener)
        scanner_layout.addWidget(self.toggle_btn)

        # self.status_label = QLabel(INACTIVE_LISTENER_MSG)
        # self.status_label.setAlignment(Qt.AlignCenter)
        # scanner_layout.addWidget(self.status_label)

        scanner_layout.addStretch()
        main_layout.addWidget(scanner_group, 1)

        # QR Code Generator Group
        generator_group = QGroupBox("Generate QR Code")
        generator_layout = QVBoxLayout()
        generator_layout.setSpacing(10)
        generator_group.setLayout(generator_layout)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Enter a URL to generate QR code")
        self.url_input.textChanged.connect(self.validate_url)
        generator_layout.addWidget(self.url_input)

        self.validation_label = QLabel("")
        generator_layout.addWidget(self.validation_label)

        self.generate_button = QPushButton("Generate QR Code")
        self.generate_button.setEnabled(False)
        self.generate_button.clicked.connect(self.generate_qr_code)
        generator_layout.addWidget(self.generate_button)

        self.qr_label = QLabel()
        self.qr_label.setFixedSize(300, 300)
        self.qr_label.setAlignment(Qt.AlignCenter)
        self.qr_label.setStyleSheet("border: 1px solid gray;")
        generator_layout.addWidget(self.qr_label, alignment=Qt.AlignCenter)

        btn_row = QHBoxLayout()
        self.save_button = QPushButton("Save QR Code")
        self.save_button.setEnabled(False)
        self.save_button.clicked.connect(self.save_qr_code)

        self.copy_button = QPushButton("Copy to Clipboard")
        self.copy_button.setEnabled(False)
        self.copy_button.clicked.connect(self.copy_qr_to_clipboard)

        btn_row.addWidget(self.save_button)
        btn_row.addWidget(self.copy_button)
        generator_layout.addLayout(btn_row)

        generator_layout.addStretch()
        main_layout.addWidget(generator_group, 2)

        # Status Bar
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage("Ready")

    def toggle_listener(self):
        if self.qr_code_listener.is_listening:
            self.qr_code_listener.stop_listening()
            self.toggle_btn.setText(START_LISTENING_MSG)
            self.toggle_btn.setIcon(QIcon.fromTheme("media-playback-start"))
            # self.status_label.setText(INACTIVE_LISTENER_MSG)
            self.status_bar.showMessage(INACTIVE_LISTENER_MSG)
        else:
            self.qr_code_listener.start_listening()
            self.toggle_btn.setText(STOP_LISTENING_MSG)
            self.toggle_btn.setIcon(QIcon.fromTheme("media-playback-stop"))
            # self.status_label.setText(ACTIVE_LISTENER_MSG)
            self.status_bar.showMessage(ACTIVE_LISTENER_MSG)

    def validate_url(self):
        url = self.url_input.text().strip()
        if validators.url(url):
            self.validation_label.setText("✓ Valid URL")
            self.validation_label.setStyleSheet("color: green; font-weight: bold;")
            self.generate_button.setEnabled(True)
        else:
            self.validation_label.setText("✗ Invalid URL")
            self.validation_label.setStyleSheet("color: red; font-weight: bold;")
            self.generate_button.setEnabled(False)

    def generate_qr_code(self):
        url = self.url_input.text().strip()
        if not validators.url(url):
            QMessageBox.warning(self, "Invalid URL", "Please enter a valid URL.")
            return

        qr = self.qr_code_generator.generate_qr_code(url)
        self.qr_image = qr

        # Convert PIL Image to QPixmap
        qr_rgb = self.qr_image.convert("RGB")
        data = qr_rgb.tobytes("raw", "RGB")

        # Use correct method calls for width and height
        image = QImage(data, qr_rgb.width, qr_rgb.height, QImage.Format_RGB888)

        pixmap = QPixmap.fromImage(image)

        # Scale the pixmap with keeping aspect ratio and smooth transformation
        pixmap = pixmap.scaled(300, 300)

        self.qr_label.setPixmap(pixmap)

        self.qr_label.setPixmap(pixmap)
        self.save_button.setEnabled(True)
        self.copy_button.setEnabled(True)
        self.status_bar.showMessage("QR code generated.")

    def save_qr_code(self):
        if self.qr_image:
            file_path, _ = QFileDialog.getSaveFileName(self, "Save QR Code", "", "PNG Files (*.png)")
            if file_path:
                self.qr_code_generator.save_qr_to_file(self.qr_image, file_path)
                QMessageBox.information(self, "Saved", f"QR Code saved to:\n{file_path}")

    def copy_qr_to_clipboard(self):
        if self.qr_image:
            self.qr_code_generator.copy_qr_code_to_clipboard(self.qr_image)
            QMessageBox.information(self, "Copied", "QR Code copied to clipboard.")



if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = OpenQRApp()
    window.show()
    sys.exit(app.exec())
