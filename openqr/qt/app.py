import io
import os
import json
from urllib.parse import urlparse
import datetime
import webbrowser
from PIL import Image
from PyQt6.QtWidgets import (
    QMainWindow,
    QPushButton,
    QStatusBar,
    QApplication,
    QVBoxLayout,
    QWidget,
    QLabel,
    QLineEdit,
    QHBoxLayout,
    QFileDialog,
    QMessageBox,
    QGroupBox,
    QColorDialog,
    QListWidget,
    QDialog,
    QCheckBox,
    QComboBox,
    QSpinBox,
    QFormLayout,
    QInputDialog,
    QTextBrowser,
)
from PyQt6.QtGui import QPixmap, QImage, QIcon
from PyQt6.QtCore import Qt

from openqr.core.generator import QRGenerator
from openqr.core.listener import QRListener
from openqr.qt.constants import HELP_MESSAGE
from openqr.utils import logger

log = logger.setup_logger()


class OpenQRApp(QMainWindow):
    def __init__(self):
        super().__init__()
        log.info("OpenQRApp initializing...")

        # Scanner settings
        self.scanner_prefix = ""
        self.scanner_suffix = "\r"
        self.qr_code_listener = QRListener(
            timeout=1.0, prefix=self.scanner_prefix, suffix=self.scanner_suffix
        )
        self.qr_code_generator = QRGenerator()
        self.qr_image = None

        # Preferences
        self.pref_auto_open_url = True
        self.pref_notification_type = "Popup"
        self.pref_max_history = 20
        self.allow_domains = []
        self.deny_domains = []
        self.logo_image_path = None
        self.logo_image = None
        self.config_file = self.get_config_file_path()

        self.load_config()
        log.info("Loaded config.")

        self._init_ui()
        log.info("UI initialized.")

        self.load_scan_history()
        log.info("Scan history loaded.")

        self.qr_code_listener.url_scanned.connect(self._on_url_scanned)
        log.info("Signal connections established.")

        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setFocus()
        log.info("Set focus policy for keystroke listening.")

    def get_config_file_path(self):
        config_dir = os.path.expanduser("~/.openqr")
        os.makedirs(config_dir, exist_ok=True)
        log.debug(f"Config file path: {config_dir}")
        return os.path.join(config_dir, "openqr_config.json")

    def load_config(self):
        try:
            with open(self.config_file, "r") as f:
                data = json.load(f)
                self.scanner_prefix = data.get("prefix", "")
                self.scanner_suffix = data.get("suffix", "\r")
                self.allow_domains = data.get("allow", [])
                self.deny_domains = data.get("deny", [])
                self.logo_image_path = data.get("logo_image_path", None)
                if self.logo_image_path and os.path.exists(self.logo_image_path):
                    self.logo_image = Image.open(self.logo_image_path)
                else:
                    self.logo_image = None
            log.info("Config loaded from file.")
        except Exception as e:
            log.error(f"Failed to load config: {e}")
            # Reset config
            self.scanner_prefix = ""
            self.scanner_suffix = "\r"
            self.allow_domains = []
            self.deny_domains = []
            self.logo_image_path = None
            self.logo_image = None

    def save_config(self):
        data = {
            "prefix": self.scanner_prefix,
            "suffix": self.scanner_suffix,
            "allow": self.allow_domains,
            "deny": self.deny_domains,
            "logo_image_path": self.logo_image_path,
            "scan_history": self.scan_history,
        }
        try:
            with open(self.config_file, "w") as f:
                json.dump(data, f, indent=2)
            log.info("Config saved.")
        except Exception as e:
            log.error(f"Failed to save config: {e}")

    def upload_logo_image(self):
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Select Logo/Image", "", "Image Files (*.png *.jpg *.jpeg *.bmp)"
        )
        if file_path:
            self.logo_image_path = file_path
            self.logo_image = Image.open(file_path)
            self.save_config()
            log.info(f"Logo image uploaded: {file_path}")
            log.info("Regenerating QR Code.")
            self.generate_qr_code()  # Update preview

    def remove_logo_image(self):
        log.info("Logo image removed.")
        self.logo_image_path = None
        self.logo_image = None
        self.save_config()
        log.info("Regenerating QR Code.")
        self.generate_qr_code()  # Update preview

    def open_domain_settings_dialog(self):
        log.info("Opening domain management dialog.")
        dialog = QDialog(self)
        dialog.setWindowTitle("Domain Management")
        layout = QHBoxLayout(dialog)

        # Allow list
        allow_layout = QVBoxLayout()
        allow_label = QLabel("Allow List (Whitelist)")
        allow_list = QListWidget()
        allow_list.addItems(self.allow_domains)
        add_allow_btn = QPushButton("Add")
        remove_allow_btn = QPushButton("Remove")
        allow_layout.addWidget(allow_label)
        allow_layout.addWidget(allow_list)
        allow_layout.addWidget(add_allow_btn)
        allow_layout.addWidget(remove_allow_btn)

        # Deny list
        deny_layout = QVBoxLayout()
        deny_label = QLabel("Not Allow List (Blacklist)")
        deny_list = QListWidget()
        deny_list.addItems(self.deny_domains)
        add_deny_btn = QPushButton("Add")
        remove_deny_btn = QPushButton("Remove")
        deny_layout.addWidget(deny_label)
        deny_layout.addWidget(deny_list)
        deny_layout.addWidget(add_deny_btn)
        deny_layout.addWidget(remove_deny_btn)

        # Add to main layout
        layout.addLayout(allow_layout)
        layout.addLayout(deny_layout)

        # OK/Cancel
        btn_row = QHBoxLayout()
        ok_btn = QPushButton("OK")
        cancel_btn = QPushButton("Cancel")
        btn_row.addWidget(ok_btn)
        btn_row.addWidget(cancel_btn)
        layout.addLayout(btn_row)
        dialog.setLayout(layout)

        # Button logic
        def add_domain(list_widget):
            text, ok = QInputDialog.getText(dialog, "Add Domain", "Domain:")
            if ok and text:
                list_widget.addItem(text.strip())

        def remove_domain(list_widget):
            for item in list_widget.selectedItems():
                list_widget.takeItem(list_widget.row(item))

        add_allow_btn.clicked.connect(lambda: add_domain(allow_list))
        remove_allow_btn.clicked.connect(lambda: remove_domain(allow_list))
        add_deny_btn.clicked.connect(lambda: add_domain(deny_list))
        remove_deny_btn.clicked.connect(lambda: remove_domain(deny_list))
        ok_btn.clicked.connect(dialog.accept)
        cancel_btn.clicked.connect(dialog.reject)
        if dialog.exec():
            self.allow_domains = [
                allow_list.item(i).text() for i in range(allow_list.count())
            ]
            self.deny_domains = [
                deny_list.item(i).text() for i in range(deny_list.count())
            ]
            self.save_config()
            log.info("Domain lists updated via dialog.")

    def open_preferences_dialog(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("App Preferences")
        layout = QFormLayout(dialog)

        # Auto-open URLs
        auto_open_checkbox = QCheckBox("Automatically open scanned URLs")
        auto_open_checkbox.setChecked(self.pref_auto_open_url)
        layout.addRow(auto_open_checkbox)

        # Notification type
        notif_combo = QComboBox()
        notif_combo.addItems(["Popup", "Status Bar Only"])
        notif_combo.setCurrentText(self.pref_notification_type)
        layout.addRow(QLabel("Notification Type:"), notif_combo)

        # Max history
        max_history_spin = QSpinBox()
        max_history_spin.setMinimum(1)
        max_history_spin.setMaximum(100)
        max_history_spin.setValue(self.pref_max_history)
        layout.addRow(QLabel("Max History Items:"), max_history_spin)

        # Prefix
        prefix_input = QLineEdit()
        prefix_input.setText(self.scanner_prefix)
        layout.addRow(QLabel("Prefix (e.g. qr_):"), prefix_input)

        # Suffix
        suffix_input = QLineEdit()
        suffix_input.setText(self.scanner_suffix.encode("unicode_escape").decode())
        layout.addRow(QLabel("Suffix (e.g. \\r, \\n, \\t):"), suffix_input)

        # OK/Cancel
        ok_btn = QPushButton("OK")
        cancel_btn = QPushButton("Cancel")
        ok_btn.clicked.connect(dialog.accept)
        cancel_btn.clicked.connect(dialog.reject)
        btn_row = QHBoxLayout()
        btn_row.addWidget(ok_btn)
        btn_row.addWidget(cancel_btn)
        layout.addRow(btn_row)
        dialog.setLayout(layout)
        if dialog.exec():
            self.pref_auto_open_url = auto_open_checkbox.isChecked()
            self.pref_notification_type = notif_combo.currentText()
            self.pref_max_history = max_history_spin.value()
            self.scanner_prefix = prefix_input.text()
            self.scanner_suffix = bytes(suffix_input.text(), "utf-8").decode(
                "unicode_escape"
            )
            self.qr_code_listener.set_prefix_suffix(
                self.scanner_prefix, self.scanner_suffix
            )
            self.save_config()
            self.trim_history()
            log.info("Preferences updated via App Preferences dialog.")

    def _init_ui(self):
        log.debug("Initializing UI components...")
        self.setWindowTitle("OpenQR - QR Code Scanner & Generator")
        self.setMinimumSize(900, 600)

        icon_path = os.path.join(os.path.dirname(__file__), "../assets/openqr_icon.png")
        self.setWindowIcon(QIcon(icon_path))
        main_widget = QWidget()

        # Outer vertical layout for the whole window
        outer_layout = QVBoxLayout()
        main_widget.setLayout(outer_layout)
        self.setCentralWidget(main_widget)

        # Main horizontal layout for content
        main_layout = QHBoxLayout()
        main_layout.setContentsMargins(15, 15, 15, 15)
        main_layout.setSpacing(20)
        outer_layout.addLayout(main_layout)

        # Sidebar: Scanner controls, status, scan history, help
        sidebar_group = QGroupBox("Scanner Controls")
        sidebar_layout = QVBoxLayout()

        # Start/Stop Listening buttons (side by side)
        listen_btn_row = QHBoxLayout()
        self.start_btn = QPushButton("Start Listening")
        self.start_btn.setMinimumHeight(40)
        self.start_btn.setFixedWidth(150)
        self.start_btn.clicked.connect(self.start_listening)
        self.stop_btn = QPushButton("Stop Listening")
        self.stop_btn.setMinimumHeight(40)
        self.stop_btn.setFixedWidth(150)
        self.stop_btn.clicked.connect(self.stop_listening)
        listen_btn_row.addWidget(self.start_btn)
        listen_btn_row.addWidget(self.stop_btn)
        sidebar_layout.addLayout(listen_btn_row)

        # Status indicator
        self.status_indicator = QLabel()
        self.status_indicator.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_indicator.setStyleSheet(
            "font-size: 24px; font-weight: bold; padding: 10px;"
        )
        sidebar_layout.addWidget(self.status_indicator)

        # Prefix/suffix/URL feedback
        self.prefix_feedback = QLabel()
        self.prefix_feedback.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.prefix_feedback.setStyleSheet(
            "font-size: 16px; color: #1976d2; padding: 5px;"
        )
        sidebar_layout.addWidget(self.prefix_feedback)

        # Scan history
        history_label = QLabel("Scan History:")
        sidebar_layout.addWidget(history_label)
        self.history_list = QListWidget()
        sidebar_layout.addWidget(self.history_list)
        self.copy_url_button = QPushButton("Copy Selected URL")
        self.copy_url_button.clicked.connect(self.copy_selected_url)
        sidebar_layout.addWidget(self.copy_url_button)
        self.clear_history_button = QPushButton("Clear History")
        self.clear_history_button.clicked.connect(self.clear_history)
        sidebar_layout.addWidget(self.clear_history_button)

        # Help button
        help_btn = QPushButton("Help")
        help_btn.clicked.connect(self.show_help_dialog)
        sidebar_layout.addWidget(help_btn)
        sidebar_layout.addStretch()
        sidebar_group.setLayout(sidebar_layout)
        main_layout.addWidget(sidebar_group, 1)

        # Generator Section (main area)
        generator_group = QGroupBox("Generate QR Code")
        generator_layout = QVBoxLayout()

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
        generator_layout.addSpacing(10)
        self.qr_label = QLabel()
        self.qr_label.setFixedSize(200, 200)
        self.qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.qr_label.setStyleSheet("border: 1px solid #888; background: #222;")
        generator_layout.addWidget(
            self.qr_label, alignment=Qt.AlignmentFlag.AlignCenter
        )
        generator_layout.addSpacing(15)
        color_btn_row = QHBoxLayout()
        self.fg_color_button = QPushButton("Set QR Foreground Color")
        self.bg_color_button = QPushButton("Set QR Background Color")
        self.fg_color_button.clicked.connect(lambda: self._set_color("fg"))
        self.bg_color_button.clicked.connect(lambda: self._set_color("bg"))
        color_btn_row.addWidget(self.fg_color_button)
        color_btn_row.addWidget(self.bg_color_button)
        generator_layout.addLayout(color_btn_row)
        generator_layout.addSpacing(10)
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
        self.upload_logo_button = QPushButton("Upload Logo")
        self.upload_logo_button.clicked.connect(self.upload_logo_image)
        self.remove_logo_button = QPushButton("Remove Logo")
        self.remove_logo_button.clicked.connect(self.remove_logo_image)
        logo_btn_row = QHBoxLayout()
        logo_btn_row.addWidget(self.upload_logo_button)
        logo_btn_row.addWidget(self.remove_logo_button)
        generator_layout.addLayout(logo_btn_row)
        generator_group.setLayout(generator_layout)
        main_layout.addWidget(generator_group, 2)

        self.qr_fg_color = "black"
        self.qr_bg_color = "white"

        # Last scanned label at the bottom
        self.last_scanned_label = QLabel("")
        self.last_scanned_label.setOpenExternalLinks(True)
        self.last_scanned_label.setStyleSheet("font-weight: bold; color: #1a237e;")
        outer_layout.addWidget(self.last_scanned_label)

        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.statusBar().setSizeGripEnabled(False)
        self.status_bar.showMessage("Ready")
        self.update_listen_buttons()
        self.status_indicator()
        log.debug("UI components created.")

        menu_bar = self.menuBar()
        file_menu = menu_bar.addMenu("Settings")
        file_menu.addAction("App Preferences", self.open_preferences_dialog)
        file_menu.addAction("Domain Management", self.open_domain_settings_dialog)
        file_menu.addAction("Help", self.show_help_dialog)

    def status_indicator(self, prefix_detected=False, url=None):
        if self.qr_code_listener.is_listening:
            self.status_indicator.setText("Listening")
            self.status_indicator.setStyleSheet(
                "font-size: 24px; font-weight: bold; color: #388e3c; padding: 10px;"
            )
        else:
            self.status_indicator.setText("Not Listening")
            self.status_indicator.setStyleSheet(
                "font-size: 24px; font-weight: bold; color: #b71c1c; padding: 10px;"
            )
        if url:
            self.prefix_feedback.setText(f"URL detected: <a href='{url}'>{url}</a>")
            self.prefix_feedback.setOpenExternalLinks(True)
        elif prefix_detected:
            self.prefix_feedback.setText("Prefix detected… waiting for suffix…")
            self.prefix_feedback.setOpenExternalLinks(False)
        else:
            self.prefix_feedback.setText("")
            self.prefix_feedback.setOpenExternalLinks(False)

    def show_help_dialog(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("Help")
        dialog.resize(800, 400)  # Landscape mode
        layout = QVBoxLayout(dialog)
        text_browser = QTextBrowser()
        text_browser.setHtml(HELP_MESSAGE)
        text_browser.setOpenExternalLinks(True)
        layout.addWidget(text_browser)
        ok_btn = QPushButton("OK")
        ok_btn.clicked.connect(dialog.accept)
        btn_row = QHBoxLayout()
        btn_row.addStretch()
        btn_row.addWidget(ok_btn)
        layout.addLayout(btn_row)
        dialog.setLayout(layout)
        dialog.setSizeGripEnabled(True)
        dialog.exec()

    def start_listening(self):
        if not self.qr_code_listener.is_listening:
            log.info("Start listening pressed.")
            self.qr_code_listener.start_listening()
            self.status_bar("Listening for QR codes...", "#388e3c")
            self.update_listen_buttons()
            self.status_indicator()

    def stop_listening(self):
        if self.qr_code_listener.is_listening:
            log.info("Stop listening pressed.")
            self.qr_code_listener.stop_listening()
            self.status_bar("Ready", "")  # old value => #b71c1c
            self.update_listen_buttons()
            self.status_indicator()

    def update_listen_buttons(self):
        if self.qr_code_listener.is_listening:
            self.start_btn.setEnabled(False)
            self.stop_btn.setEnabled(True)
        else:
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)

    def validate_url(self):
        url = self.url_input.text().strip()
        if self.qr_code_generator.validate_url(url):
            self.validation_label.setText("\u2713 Valid URL")
            self.validation_label.setStyleSheet("color: green; font-weight: bold;")
            self.generate_button.setEnabled(True)
        else:
            self.validation_label.setText("\u2717 Invalid URL")
            self.validation_label.setStyleSheet("color: red; font-weight: bold;")
            self.generate_button.setEnabled(False)

    def generate_qr_code(self):
        url = self.url_input.text().strip()
        log.info(f"Generating QR code for URL: {url}")
        if not self.qr_code_generator.validate_url(url):
            log.warning(f"Invalid URL entered: {url}")
            QMessageBox.warning(self, "Invalid URL", "Please enter a valid URL.")
            return
        # Generate QR as PIL Image with correct colors
        self.qr_image = self.qr_code_generator.generate_qr_code(
            url, fill_color=self.qr_fg_color, back_color=self.qr_bg_color
        )
        # Overlay logo if present
        if self.logo_image:
            log.info("Overlaying logo image on QR code.")
            qr_img = self.qr_image.convert("RGBA")
            logo = self.logo_image.convert("RGBA")
            # Resize logo to fit (15% of QR code size)
            qr_w, qr_h = qr_img.size
            factor = 0.15
            logo_size = int(qr_w * factor), int(qr_h * factor)
            logo = logo.resize(logo_size, Image.LANCZOS)
            # Add white border around logo
            border_size = int(logo_size[0] * 0.25)  # 25% of logo size as border
            bordered_logo_size = (
                logo_size[0] + 2 * border_size,
                logo_size[1] + 2 * border_size,
            )
            bordered_logo = Image.new("RGBA", bordered_logo_size, (255, 255, 255, 255))
            bordered_logo.paste(logo, (border_size, border_size), mask=logo)
            # Center logo
            pos = (
                (qr_w - bordered_logo_size[0]) // 2,
                (qr_h - bordered_logo_size[1]) // 2,
            )
            qr_img.paste(bordered_logo, pos, mask=bordered_logo)
            self.qr_image = qr_img
        # Convert PIL image to RGBA bytes
        qr_rgba = self.qr_image.convert("RGBA")
        w, h = qr_rgba.size
        data = qr_rgba.tobytes("raw", "RGBA")
        # Convert RGBA bytes to QPixmap
        buf = io.BytesIO()
        self.qr_image.save(buf, format="PNG")
        qimage = QImage()
        qimage.loadFromData(buf.getvalue(), "PNG")  # Qt now owns the pixels
        pixmap = QPixmap.fromImage(qimage)
        scaled_pixmap = pixmap.scaled(
            self.qr_label.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.qr_label.setPixmap(scaled_pixmap)
        self.save_button.setEnabled(True)
        self.copy_button.setEnabled(True)
        self.status_bar.showMessage("QR code generated.")
        log.info("QR code generated and displayed.")

    def pil_image_to_qpixmap(self, image: Image.Image) -> QPixmap:
        """Converts a PIL Image to a QPixmap."""
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)
        qimage = QImage()
        qimage.loadFromData(buffer.read(), "PNG")
        return QPixmap.fromImage(qimage)

    def save_qr_code(self):
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
        if self.qr_image:
            self.qr_code_generator.copy_qr_code_to_clipboard(self.qr_image)
            QMessageBox.information(self, "Copied", "QR Code copied to clipboard.")

    def _set_color(self, target):
        color = QColorDialog.getColor()
        if color.isValid():
            if target == "fg":
                self.qr_fg_color = color.name()
            elif target == "bg":
                self.qr_bg_color = color.name()
            url = self.url_input.text().strip()
            if url and self.qr_code_generator.validate_url(url):
                self.generate_qr_code()

    def _on_url_scanned(self, url):
        """
        Called when a URL is scanned by the QR code listener.

        Args:
            url (str): The scanned URL.

        The method will:
            - Validate the URL
            - Check if the URL's domain is in the deny list
            - If the URL is valid and not blocked by the deny list,
                show a dialog asking to open the URL in the default web browser.
            - If the dialog is accepted, add the URL's domain to the allow list and open the URL.
            - If the dialog is rejected, simply add the URL to the history.
        """
        log.info(f"Scanned URL: {url}")
        parsed = urlparse(url)
        log.debug(
            f"Parsed URL: scheme={parsed.scheme}, netloc={parsed.netloc}, path={parsed.path}"
        )
        # Only validate URL
        if not self.qr_code_generator.validate_url(url):
            log.warning(f"Blocked by invalid URL: {url}")
            QMessageBox.warning(
                self, "Invalid URL", f"The scanned data is not a valid URL:\n{url}"
            )
            return
        domain = parsed.netloc.lower()
        if domain in self.deny_domains:
            log.warning(f"Blocked by deny list: {domain}")
            QMessageBox.warning(
                self,
                "Blocked Domain",
                f"This domain is on your Not Allow List (Blacklist):\n{domain}\nURL will not be opened.",
            )
            return
        if domain in self.allow_domains:
            log.info(f"Domain on allow list, not asking again: {domain}")
            self.add_to_history(url)
            self.status_bar("Last scanned URL", "#1976d2")
            self.last_scanned_label.setText(f'<a href="{url}">Last scanned: {url}</a>')
            log.info(f"Opening URL in default web browser: {url}")
            webbrowser.open(url)
        else:
            self.add_to_history(url)
            self.status_bar("Last scanned URL", "#1976d2")
            self.last_scanned_label.setText(f'<a href="{url}">Last scanned: {url}</a>')
            dialog = QDialog(self)
            dialog.setWindowTitle("Open URL?")
            layout = QVBoxLayout(dialog)
            label = QLabel(f"Do you want to open this link?\n\n{url}")
            layout.addWidget(label)
            skip_checkbox = QCheckBox(f"Don't ask again for this domain ({domain})")
            layout.addWidget(skip_checkbox)
            btn_row = QHBoxLayout()
            yes_btn = QPushButton("Yes")
            no_btn = QPushButton("No")
            btn_row.addWidget(yes_btn)
            btn_row.addWidget(no_btn)
            layout.addLayout(btn_row)
            dialog.setLayout(layout)
            result = None

            def accept():
                nonlocal result
                result = True
                dialog.accept()

            def reject():
                nonlocal result
                result = False
                dialog.reject()

            yes_btn.clicked.connect(accept)
            no_btn.clicked.connect(reject)
            dialog.exec()
            if result:
                if skip_checkbox.isChecked():
                    log.info(f"Domain will not be asked again: {domain}")
                    if domain not in self.allow_domains:
                        self.allow_domains.append(domain)
                        self.save_config()
                        log.info(f"Domain added to allow list: {domain}")

                log.info(f"Opening URL in default web browser: {url}")
                webbrowser.open(url)

    def load_scan_history(self):
        try:
            with open(self.config_file, "r") as f:
                data = json.load(f)
                self.scan_history = data.get("scan_history", [])
        except Exception:
            self.scan_history = []
        # Only refresh if history_list exists
        if hasattr(self, "history_list"):
            self.refresh_history_list()

    def save_scan_history(self):
        try:
            with open(self.config_file, "r") as f:
                data = json.load(f)
        except Exception:
            data = {}
        data["scan_history"] = self.scan_history
        with open(self.config_file, "w") as f:
            json.dump(data, f, indent=2)

    def refresh_history_list(self):
        self.history_list.clear()
        for entry in self.scan_history:
            ts = entry.get("timestamp", "")
            url = entry.get("url", "")
            self.history_list.addItem(f"{ts} - {url}")

    def add_to_history(self, url):
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.scan_history.append({"url": url, "timestamp": ts})
        self.save_scan_history()
        self.refresh_history_list()
        log.info(f"Added to scan history: {url} at {ts}")

    def copy_selected_url(self):
        """TODO: refactor"""
        selected_items = self.history_list.selectedItems()
        if selected_items:
            text = selected_items[0].text()
            # Extract URL after the first ' - '
            url = text.split(" - ", 1)[-1]
            clipboard = (
                self.clipboard()
                if hasattr(self, "clipboard")
                else QApplication.instance().clipboard()
            )
            clipboard.setText(url)
            log.info(f"Copied URL to clipboard: {url}")
            QMessageBox.information(self, "Copied", f"Copied to clipboard:\n{url}")

    def clear_history(self):
        log.info("Scan history cleared.")
        self.scan_history.clear()
        self.save_scan_history()
        self.refresh_history_list()

    def open_settings_dialog(self):
        log.info("Opening preferences dialog.")
        dialog = QDialog(self)
        dialog.setWindowTitle("Preferences")
        layout = QFormLayout(dialog)
        # Auto-open URLs
        auto_open_checkbox = QCheckBox("Automatically open scanned URLs")
        auto_open_checkbox.setChecked(self.pref_auto_open_url)
        layout.addRow(auto_open_checkbox)
        # Notification type
        notif_combo = QComboBox()
        notif_combo.addItems(["Popup", "Status Bar Only"])
        notif_combo.setCurrentText(self.pref_notification_type)
        layout.addRow(QLabel("Notification Type:"), notif_combo)
        # Max history
        max_history_spin = QSpinBox()
        max_history_spin.setMinimum(1)
        max_history_spin.setMaximum(100)
        max_history_spin.setValue(self.pref_max_history)
        layout.addRow(QLabel("Max History Items:"), max_history_spin)
        # OK/Cancel
        ok_btn = QPushButton("OK")
        cancel_btn = QPushButton("Cancel")
        ok_btn.clicked.connect(dialog.accept)
        cancel_btn.clicked.connect(dialog.reject)
        btn_row = QHBoxLayout()
        btn_row.addWidget(ok_btn)
        btn_row.addWidget(cancel_btn)
        layout.addRow(btn_row)
        dialog.setLayout(layout)
        if dialog.exec():
            self.pref_auto_open_url = auto_open_checkbox.isChecked()
            self.pref_notification_type = notif_combo.currentText()
            self.pref_max_history = max_history_spin.value()
            self.trim_history()
            log.info("Preferences updated via dialog.")

    def trim_history(self):
        # Keep only the most recent N items in history
        while len(self.scan_history) > self.pref_max_history:
            self.scan_history.pop(0)
            self.history_list.takeItem(0)

    def open_scanner_settings_dialog(self):
        log.info("Opening scanner settings dialog.")
        dialog = QDialog(self)
        dialog.setWindowTitle("Scanner Settings")
        layout = QFormLayout(dialog)
        # Prefix
        prefix_input = QLineEdit()
        prefix_input.setText(self.scanner_prefix)
        layout.addRow(QLabel("Prefix (e.g. qr_):"), prefix_input)
        # Suffix
        suffix_input = QLineEdit()
        suffix_input.setText(self.scanner_suffix.encode("unicode_escape").decode())
        layout.addRow(QLabel("Suffix (e.g. \\r, \\n, \\t):"), suffix_input)
        # OK/Cancel
        ok_btn = QPushButton("OK")
        cancel_btn = QPushButton("Cancel")
        ok_btn.clicked.connect(dialog.accept)
        cancel_btn.clicked.connect(dialog.reject)
        btn_row = QHBoxLayout()
        btn_row.addWidget(ok_btn)
        btn_row.addWidget(cancel_btn)
        layout.addRow(btn_row)
        dialog.setLayout(layout)
        if dialog.exec():
            self.scanner_prefix = prefix_input.text()
            self.scanner_suffix = bytes(suffix_input.text(), "utf-8").decode(
                "unicode_escape"
            )
            self.qr_code_listener.set_prefix_suffix(
                self.scanner_prefix, self.scanner_suffix
            )
            log.info(
                f"Scanner prefix set to: {self.scanner_prefix}, suffix set to: {repr(self.scanner_suffix)}"
            )
            self.save_config()

    def status_bar(self, message, color):
        self.status_bar.setStyleSheet(f"background-color: {color}; color: white;")
        self.status_bar.showMessage(message)
