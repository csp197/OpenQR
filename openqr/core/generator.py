import sys
from io import BytesIO
import validators  # Library for validating URLs
import qrcode  # Library to generate QR codes
from PIL import Image  # Library for handling image operations
import hashlib  # Library for generating unique hashes
from pathlib import Path  # Library for handling file paths
import tempfile  # Library to access the operating system's temporary directory
from functools import lru_cache  # Library to cache expensive function calls
from pathvalidate import (
    sanitize_filename,
)  # Library to make sure filenames are safe for file systems

from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QBuffer, QIODevice, QMimeData
# from PIL.ImageQt import ImageQt

from openqr.utils import logger

log = logger.setup_logger()


class QRGenerator:
    """
    This class is for generating, caching, saving, and copying QR codes
    for valid URLs. QR codes are generated using the `qrcode` library and
    stored as PNG images in a temporary cache directory.
    """

    def __init__(self):
        """
        Initialize the QRCodeGenerator class.
        Creates a dedicated cache directory in the system's temporary folder.
        """
        temp_dir_str = str(tempfile.gettempdir())
        if not temp_dir_str:
            raise RuntimeError("Could not determine temporary directory.")

        self.temp_dir = Path(temp_dir_str) / "openqr_cache"
        if not self.temp_dir.exists():
            log.debug(f"Creating cache directory: {self.temp_dir}")
            self.temp_dir.mkdir(parents=True, exist_ok=True)
        elif not self.temp_dir.is_dir():
            raise RuntimeError(f"Cache directory is not a directory: {self.temp_dir}")

        log.info("QRCodeGenerator initialized.")

    def _get_cache_path(self, url, fill_color="black", back_color="white"):
        """
        Generate a unique and filesystem-safe cache file path for a given URL and color combination.
        """
        log.debug(
            f"Generating cache path for URL: {url}, fill_color: {fill_color}, back_color: {back_color}"
        )

        if not url:
            log.error("URL is None or empty.")
            raise ValueError("URL cannot be None or empty")

        if not self.validate_url(url):
            log.warning("Invalid URL provided.")
            raise ValueError("URL is not valid")

        try:
            safe_url = sanitize_filename(url)
            truncated_url_part = safe_url[:30]
            color_part = f"_{sanitize_filename(str(fill_color))}_{sanitize_filename(str(back_color))}"
            url_hash = hashlib.sha256(
                (safe_url + color_part).encode("utf-8")
            ).hexdigest()[:16]
            encoded_url = f"qr_{truncated_url_part}{color_part}_{url_hash}.png"
            full_path = self.temp_dir / encoded_url
        except Exception as e:
            log.error(f"Error generating cache path: {e}")
            raise

        return full_path

    @staticmethod
    @lru_cache(
        maxsize=1000
    )  # Cache up to 1000 results to speed up repeated validations
    def validate_url(url):
        """
        Validate whether a given string is a properly formatted URL.

        Parameters:
            url (str): The URL to validate.

        Returns:
            bool: True if the URL is valid, False otherwise.
        """
        if url is None:
            raise ValueError("URL is None")
        try:
            result = validators.url(url)
            log.debug(f"Validating URL: {url} -> {result}")
            # validators.url returns True for valid URLs, ValidationError for invalid ones
            if result is True:
                return True
            else:
                # result is a ValidationError object for invalid URLs
                return False
        except Exception as e:
            log.error(f"Exception during URL validation: {e}")
            return False

    def generate_qr_code(self, url, fill_color="black", back_color="white"):
        """
        Generate a QR code from a valid URL. Uses a cached image if it already exists.

        Parameters:
            url (str): The URL to encode.
            fill_color (str): Foreground color of the QR code (default: "black").
            back_color (str): Background color of the QR code (default: "white").

        Returns:
            Image.Image: A PIL Image object of the generated QR code.

        Raises:
            ValueError: If the URL is invalid.
        """
        log.info(
            f"Generating QR code for URL: {url}, fill_color: {fill_color}, back_color: {back_color}"
        )
        if not self.validate_url(url):
            log.warning(f"Invalid URL for QR code generation: {url}")
            raise ValueError("URL is not valid")

        cached_qr_path = self._get_cache_path(url, fill_color, back_color)
        if cached_qr_path.exists():
            log.info(f"Loading QR code from cache: {cached_qr_path}")
            try:
                return Image.open(cached_qr_path)  # If already exists, load from disk
            except Exception as e:
                log.error(f"Loading cached QR code failed: {e}")
                raise

        # Create and configure the QR code generator
        qr_code = qrcode.QRCode(
            version=1,  # Controls the size (1 is smallest)
            error_correction=qrcode.ERROR_CORRECT_H,  # High error correction
            box_size=10,  # Size of each box in the grid
            border=4,  # Border size (standard is 4)
        )
        try:
            qr_code.add_data(url)  # Add URL data to the QR code
            qr_code.make(fit=True)  # Fit the QR code size automatically
        except Exception as e:
            log.error(f"Generating QR code failed: {e}")
            raise

        # Generate the actual QR image with color settings
        try:
            qr_image = qr_code.make_image(
                fill_color=fill_color, back_color=back_color
            ).get_image()
        except Exception as e:
            log.error(f"Generating QR image failed: {e}")
            raise

        # Save the generated image to disk (for caching)
        log.info(f"Saving generated QR code to cache: {cached_qr_path}")
        try:
            with cached_qr_path.open("wb") as f:
                qr_image.save(f, "PNG")
        except Exception as e:
            log.error(f"Saving generated QR code failed: {e}")
            raise

        return qr_image

    def save_qr_to_file(self, qr_code: Image.Image, filepath: str) -> None:
        """
        Save a QR code image to a file.

        Parameters:
            qr_code (Image.Image): The PIL Image of the QR code.
            filepath (str): The destination file path.
        """
        log.info(f"Saving QR code to file: {filepath}")
        qr_code.save(filepath, format="PNG")

    def copy_qr_code_to_clipboard(self, qr_code: Image.Image) -> None:
        """
        Copy the QR code image to the system clipboard robustly across platforms.

        This function converts the PIL Image to an RGBA QImage, then creates a
        QPixmap. It serializes the pixmap to the PNG format and places it on the
        clipboard using the 'image/png' MIME type for maximum compatibility
        with other applications on Windows, macOS, and Linux.

        Args:
            qr_code (Image.Image): The PIL image to copy to the clipboard.

        Raises:
            RuntimeError: If the QApplication instance is not available.
            TypeError: If the input is not a PIL Image.
            ValueError: If the input image is empty or invalid.
        """
        log.info("Copying QR code to clipboard.")

        app = QApplication.instance()
        if not app:
            raise RuntimeError("QApplication must be initialized for clipboard access.")

        if not isinstance(qr_code, Image.Image):
            raise TypeError(f"Expected a PIL Image, got {type(qr_code)}.")

        if qr_code.mode != "RGBA":
            qr_code = qr_code.convert("RGBA")

        w, h = qr_code.size
        if w == 0 or h == 0:
            raise ValueError("Cannot copy an empty image.")

        # Keep a reference so memory isn't freed prematurely
        img_bytes = qr_code.tobytes()

        # PyQt6 requires bytesPerLine
        qimage = QImage(img_bytes, w, h, w * 4, QImage.Format.Format_RGBA8888)
        pixmap = QPixmap.fromImage(qimage)

        # Also store as PNG in a MIME container for apps expecting it
        mime_data = QMimeData()
        buffer = QBuffer()
        buffer.open(QIODevice.OpenModeFlag.WriteOnly)
        pixmap.save(buffer, "PNG")
        mime_data.setData("image/png", buffer.data())

        clipboard = app.clipboard()
        clipboard.setMimeData(mime_data)
        clipboard.setPixmap(pixmap)  # improves compatibility

        log.info("Successfully copied QR code to clipboard.")
