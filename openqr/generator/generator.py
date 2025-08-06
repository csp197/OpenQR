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

from PyQt6.QtGui import QImage
from PyQt6.QtWidgets import QApplication
# from PIL.ImageQt import ImageQt

from openqr.utils import logger

log = logger.setup_logger()


class QRCodeGenerator:
    """
    A utility class for generating, caching, saving, and copying QR codes
    for valid URLs. QR codes are generated using the `qrcode` library and
    stored as PNG images in a temporary cache directory.
    """

    def __init__(self):
        """
        Initialize the QRCodeGenerator class.
        Creates a dedicated cache directory in the system's temporary folder.
        """
        self.temp_dir = (
            Path(tempfile.gettempdir()) / "openqr_cache"
        )  # Define a path inside the system's temp directory to store cached QR codes
        self.temp_dir.mkdir(
            parents=True, exist_ok=True
        )  # Create the directory if it doesn't exist
        log.info("QRCodeGenerator initialized.")

    def _get_cache_path(self, url, fill_color="black", back_color="white"):
        """
        Generate a unique and filesystem-safe cache file path for a given URL and color combination.
        """
        log.debug(
            f"Generating cache path for URL: {url}, fill_color: {fill_color}, back_color: {back_color}"
        )
        if not self.validate_url(url):
            raise ValueError("URL is not valid")
        safe_url = sanitize_filename(url)
        truncated_url_part = safe_url[:30]
        color_part = f"_{sanitize_filename(str(fill_color))}_{sanitize_filename(str(back_color))}"
        url_hash = hashlib.sha256((safe_url + color_part).encode("utf-8")).hexdigest()[
            :16
        ]
        encoded_url = f"qr_{truncated_url_part}{color_part}_{url_hash}.png"
        full_path = self.temp_dir / encoded_url
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
        try:
            result = validators.url(url)
            log.debug(f"Validating URL: {url} -> {result}")
            return result
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
            return Image.open(cached_qr_path)  # If already exists, load from disk

        # Create and configure the QR code generator
        qr_code = qrcode.QRCode(
            version=1,  # Controls the size (1 is smallest)
            error_correction=qrcode.ERROR_CORRECT_H,  # High error correction
            box_size=10,  # Size of each box in the grid
            border=4,  # Border size (standard is 4)
        )
        qr_code.add_data(url)  # Add URL data to the QR code
        qr_code.make(fit=True)  # Fit the QR code size automatically

        # Generate the actual QR image with color settings
        qr_image = qr_code.make_image(
            fill_color=fill_color, back_color=back_color
        ).get_image()

        # Save the generated image to disk (for caching)
        log.info(f"Saving generated QR code to cache: {cached_qr_path}")
        with cached_qr_path.open("wb") as f:
            qr_image.save(f, "PNG")

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
        Copy the QR code image to the system clipboard using PyQt5.

        Parameters:
            qr_code (Image.Image): The QR code image to copy.

        Raises:
            RuntimeError: If the QApplication instance is not properly initialized.
        """
        log.info("Copying QR code to clipboard.")
        # Convert PIL Image to RGB format
        qr_rgb = qr_code.convert("RGB")
        w, h = qr_rgb.size
        data = qr_rgb.tobytes("raw", "RGB")
        bytes_per_line = 3 * w

        # Create QImage from raw data
        qimage = QImage(data, w, h, bytes_per_line, QImage.Format.Format_RGB888)

        # Get clipboard and set image
        clipboard = QApplication.clipboard()
        if clipboard is None:
            log.error("QApplication must be initialized before using clipboard.")
            raise RuntimeError(
                "QApplication must be initialized before using clipboard."
            )
        clipboard.setImage(qimage)
