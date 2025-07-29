import validators
import qrcode
from PIL import Image
import hashlib
from pathlib import Path
import tempfile
from functools import lru_cache
from pathvalidate import sanitize_filename
import random
import string

from PyQt5.QtGui import QImage, QPixmap
from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt


class QRCodeGenerator:

    def __init__(self):
        # Create a subdirectory in the temporary directory in the system
        self.temp_dir = Path(tempfile.gettempdir()) / "openqr_cache"
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def _get_cache_path(self, url):
        """Convert URL to a safe filename for the generated QR code and return full path"""
        if not self.validate_url(url):
            raise ValueError("URL is not valid")

        safe_url = sanitize_filename(url)
        truncated_url_part = safe_url[:30]
        url_hash = hashlib.sha256(safe_url.encode('utf-8')).hexdigest()[:16]
        encoded_url = f'qr_{truncated_url_part}_{url_hash}.png'
        full_path = self.temp_dir / encoded_url
        return full_path

    @staticmethod
    @lru_cache(maxsize=1000)  # Cache last 1000 URL validations
    def validate_url(url):
        """Validate if the given string is a proper URL"""
        try:
            return validators.url(url)
        except Exception:
            return False

    def generate_qr_code(self, url):
        """Generate QR code for a valid url. Raises ValueError if url is invalid"""
        if not self.validate_url(url):
            raise ValueError("URL is not valid")

        # Check if QR code exists in the cache
        cached_qr_path = self._get_cache_path(url)
        if cached_qr_path.exists():
            return Image.open(cached_qr_path)

        qr_code = qrcode.QRCode(
            version=1,
            error_correction=qrcode.ERROR_CORRECT_H,
            box_size=10,
            border=4
        )
        qr_code.add_data(url)
        qr_code.make(fit=True)

        qr_image = qr_code.make_image(fill_color="black", back_color="white").get_image()

        # Save newly generated QR image to the temp directory
        with cached_qr_path.open('wb') as f:
            qr_image.save(f, 'PNG')

        return qr_image

    def save_qr_to_file(self, qr_code: Image.Image, filepath: str) -> None:
        """Save QR code PIL Image to a specified file path"""
        qr_code.save(filepath, format="PNG")

    def copy_qr_code_to_clipboard(self, qr_code: Image.Image) -> None:
        """Copy QR code PIL Image to the system clipboard using PyQt5"""
        qr_rgb = qr_code.convert("RGB")
        data = qr_rgb.tobytes("raw", "RGB")
        qimage = QImage(data, qr_rgb.width, qr_rgb.height, QImage.Format_RGB888)

        clipboard = QApplication.clipboard()
        if clipboard is None:
            raise RuntimeError("Clipboard not available. Make sure QApplication is initialized.")

        # Just call setImage without the mode argument
        clipboard.setImage(qimage)
