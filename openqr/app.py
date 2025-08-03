import os  # Standard library import for accessing the system path
import sys  # Standard library import for accessing command-line arguments
import validators  # Library for validating URLs
from PyQt5.QtWidgets import (
    QApplication,
    QMainWindow,
    QPushButton,
    QStatusBar,
    QVBoxLayout,
    QWidget,
    QLabel,
    QLineEdit,
    QHBoxLayout,
    QFileDialog,
    QMessageBox,
    QGroupBox,
    QColorDialog,
)  # Import specific classes from PyQt5 for GUI development
from PyQt5.QtGui import (
    QPixmap,
    QImage,
    QIcon,
)  # Import image handling and icon classes from PyQt5
from PyQt5.QtCore import Qt  # Import constants used for layout and logic control

from openqr.generator.generator import (
    QRCodeGenerator,
)  # Import class to handle QR code generation
from openqr.scanner.listener import (
    QRCodeListener,
)  # Import class to listen to QR Code reader
from openqr.constants import (
    START_LISTENING_MSG,
    STOP_LISTENING_MSG,
    INACTIVE_LISTENER_MSG,
    ACTIVE_LISTENER_MSG,
)  # Constants for UI button and label messages

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


# Define the main application class for the OpenQR app
class OpenQRApp(QMainWindow):
    """
    Main application window for OpenQR.

    This app allows users to:
      - Start/stop listening for QR codes via webcam
      - Generate QR codes from valid URLs
      - Copy QR codes to the clipboard or save them as PNGs
      - Customize QR foreground/background colors
      - Toggle dark mode
    """

    def __init__(self):
        """Default constructor for OpenQRApp class."""
        super().__init__()  # Initialize the base QMainWindow
        self.qr_code_listener = QRCodeListener(
            timeout=1.0
        )  # Initialize the QR listener with a 1-second timeout
        self.qr_code_generator = (
            QRCodeGenerator()
        )  # Create an instance of the QR code generator
        self.qr_image = (
            None  # Placeholder for the most recent generated QR code image (PIL.Image)
        )
        self._init_ui()  # Call the method to build and configure the user interface

    def _init_ui(self):
        """Initializes the UI layout, widgets, and styling."""
        self.setWindowTitle(
            "OpenQR - QR Code Scanner & Generator"
        )  # Set the main window title
        self.setWindowIcon(
            QIcon("assets/openqr_icon.png")
        )  # Set the application icon from a local SVG file
        self.setMinimumSize(900, 600)  # Define the minimum window size

        # Create the root widget and main layout
        main_widget = QWidget()  # Create the central widget
        main_layout = QHBoxLayout()  # Assign a horizontal layout
        main_layout.setContentsMargins(15, 15, 15, 15)  # Padding around layout
        main_layout.setSpacing(20)  # Spacing between child widgets
        main_widget.setLayout(main_layout)  # Set the layout to the main central widget
        self.setCentralWidget(main_widget)  # Set the layout to the window

        # ----- QR Scanner Section -----

        # Create a group box for scanner controls
        scanner_group = QGroupBox("Scanner Controls")
        scanner_layout = QVBoxLayout()
        scanner_layout.setSpacing(15)  # Vertical spacing in scanner group
        scanner_group.setLayout(scanner_layout)

        # Create the toggle button for starting/stopping the listener
        self.toggle_btn = QPushButton(START_LISTENING_MSG)
        self.toggle_btn.setIcon(QIcon.fromTheme("media-playback-start"))
        self.toggle_btn.setMinimumHeight(40)
        self.toggle_btn.setFixedWidth(150)
        self.toggle_btn.pressed.connect(
            self.toggle_listener
        )  # Connect to toggle_listener method
        scanner_layout.addWidget(self.toggle_btn)

        # Add vertical stretch to push widgets to the top
        scanner_layout.addStretch()

        # Add the scanner group to the main layout
        main_layout.addWidget(scanner_group, 1)  # 1 = stretch factor

        # ----- QR Code Generator Section -----

        # Group box to contain QR generator UI
        generator_group = QGroupBox("Generate QR Code")
        generator_layout = QVBoxLayout()
        generator_layout.setSpacing(10)
        generator_group.setLayout(generator_layout)

        # Input field for the URL to be encoded in QR
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Enter a URL to generate QR code")
        self.url_input.textChanged.connect(
            self.validate_url
        )  # Validate input on change
        generator_layout.addWidget(self.url_input)

        # Label that displays URL validation result
        self.validation_label = QLabel("")
        generator_layout.addWidget(self.validation_label)

        # Button to trigger QR code generation
        self.generate_button = QPushButton("Generate QR Code")
        self.generate_button.setEnabled(
            False
        )  # Initially disabled until valid URL is entered
        self.generate_button.clicked.connect(self.generate_qr_code)
        generator_layout.addWidget(self.generate_button)

        # Image display label for showing the generated QR code
        self.qr_label = QLabel()
        self.qr_label.setFixedSize(300, 300)
        self.qr_label.setAlignment(Qt.AlignCenter)
        self.qr_label.setStyleSheet("border: 1px solid gray;")
        generator_layout.addWidget(self.qr_label, alignment=Qt.AlignCenter)

        # Layout for Save and Copy buttons
        btn_row = QHBoxLayout()
        self.save_button = QPushButton("Save QR Code")
        self.save_button.setEnabled(False)  # Enabled after QR is generated
        self.save_button.clicked.connect(self.save_qr_code)

        self.copy_button = QPushButton("Copy to Clipboard")
        self.copy_button.setEnabled(False)
        self.copy_button.clicked.connect(self.copy_qr_to_clipboard)

        # Add buttons to the row
        btn_row.addWidget(self.save_button)
        btn_row.addWidget(self.copy_button)

        # Layout for QR color customization
        color_btn_row = QHBoxLayout()
        self.fg_color_button = QPushButton("Set QR Foreground Color")
        self.bg_color_button = QPushButton("Set QR Background Color")
        self.fg_color_button.clicked.connect(self.set_fg_color)
        self.bg_color_button.clicked.connect(self.set_bg_color)
        color_btn_row.addWidget(self.fg_color_button)
        color_btn_row.addWidget(self.bg_color_button)

        # Add color and control button layouts to the generator section
        generator_layout.addLayout(color_btn_row)
        generator_layout.addLayout(btn_row)

        # Set default QR colors
        self.qr_fg_color = "black"
        self.qr_bg_color = "white"

        # Add spacing at bottom
        generator_layout.addStretch()

        # Add generator group to the main layout
        main_layout.addWidget(generator_group, 2)

        # ----- Status Bar -----
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage("Ready")

        # ----- Dark Mode -----
        self.dark_mode_enabled = False
        self.theme_toggle = QPushButton("Enable Dark Mode")
        self.theme_toggle.clicked.connect(self.toggle_theme)
        generator_layout.addWidget(self.theme_toggle)

    def toggle_theme(self):
        # Toggles dark mode styling for the app
        if self.dark_mode_enabled:
            self.setStyleSheet("")
            self.theme_toggle.setText("Enable Dark Mode")
        else:
            # Apply dark color palette using style sheet
            self.setStyleSheet("""
                QWidget {
                    background-color: #2b2b2b;
                    color: white;
                }
                QLineEdit, QPushButton {
                    background-color: #3c3c3c;
                    color: white;
                    border: 1px solid #5a5a5a;
                }
                QGroupBox {
                    border: 1px solid gray;
                    margin-top: 10px;
                }
                QGroupBox:title {
                    subcontrol-origin: margin;
                    left: 10px;
                    padding: 0 3px 0 3px;
                }
            """)
            self.theme_toggle.setText("Disable Dark Mode")
        self.dark_mode_enabled = not self.dark_mode_enabled

    def set_fg_color(self):
        # Open a dialog for selecting foreground (QR) color
        color = QColorDialog.getColor()
        if color.isValid():
            self.qr_fg_color = color.name()

    def set_bg_color(self):
        # Open a dialog for selecting background (QR) color
        color = QColorDialog.getColor()
        if color.isValid():
            self.qr_bg_color = color.name()

    def toggle_listener(self):
        # Starts or stops the webcam QR listener and updates UI state
        if self.qr_code_listener.is_listening:
            self.qr_code_listener.stop_listening()
            self.toggle_btn.setText(START_LISTENING_MSG)
            self.toggle_btn.setIcon(QIcon.fromTheme("media-playback-start"))
            self.status_bar.showMessage(INACTIVE_LISTENER_MSG)
        else:
            self.qr_code_listener.start_listening()
            self.toggle_btn.setText(STOP_LISTENING_MSG)
            self.toggle_btn.setIcon(QIcon.fromTheme("media-playback-stop"))
            self.status_bar.showMessage(ACTIVE_LISTENER_MSG)

    def validate_url(self):
        # Check whether the URL input is valid and enable/disable the Generate button
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
        # Generate a QR code using the user input and display it in the UI
        url = self.url_input.text().strip()
        if not validators.url(url):
            QMessageBox.warning(self, "Invalid URL", "Please enter a valid URL.")
            return

        # Generate QR image with selected colors
        self.qr_image = self.qr_code_generator.generate_qr_code(
            url, fill_color=self.qr_fg_color, back_color=self.qr_bg_color
        )

        # Convert PIL image to Qt-compatible image for display
        qr_rgb = self.qr_image.convert("RGB")
        w, h = qr_rgb.size
        data = qr_rgb.tobytes("raw", "RGB")
        bytes_per_line = w * 3

        image = QImage(data, w, h, bytes_per_line, QImage.Format_RGB888)
        pixmap = QPixmap.fromImage(image).scaled(
            300, 300, Qt.KeepAspectRatio, Qt.SmoothTransformation
        )

        self.qr_label.setPixmap(pixmap)
        self.save_button.setEnabled(True)
        self.copy_button.setEnabled(True)
        self.status_bar.showMessage("QR code generated.")

    def save_qr_code(self):
        # Save the current QR code image to a file
        if self.qr_image:
            file_path, _ = QFileDialog.getSaveFileName(
                self, "Save QR Code", "", "PNG Files (*.png)"
            )
            if file_path:
                self.qr_code_generator.save_qr_to_file(self.qr_image, file_path)
                QMessageBox.information(
                    self, "Saved", f"QR Code saved to:\n{file_path}"
                )

    def copy_qr_to_clipboard(self):
        # Copy the QR code image to the system clipboard
        if self.qr_image:
            self.qr_code_generator.copy_qr_code_to_clipboard(self.qr_image)
            QMessageBox.information(self, "Copied", "QR Code copied to clipboard.")


# Main application execution
if __name__ == "__main__":
    app = QApplication(sys.argv)  # Create the Qt application
    window = OpenQRApp()  # Create the main window
    window.show()  # Show the main window
    sys.exit(app.exec())  # Run the app and exit cleanly
