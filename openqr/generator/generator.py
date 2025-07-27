import validators
import qrcode
from PIL import Image
from pathlib import Path
import tempfile
from functools import lru_cache
from urllib.parse import quote

class QRCodeGenerator:

    def __init__(self):
        # Create a subdirectory in the temporary directory in the system
        self.temp_dir = Path(tempfile.gettempdir()) / "openqr_cache"
        self.temp_dir.mkdir(exist_ok=True)

    def _get_cache_path(self, url):
        """Convert URL to a safe filename for the generated QR code and return full path"""
        if not self.validate_url(url):
            raise ValueError("URL is not valid")

        encoded_url = 'qr_' + quote(url, safe='') + '.png'
        return self.temp_dir / encoded_url

    @staticmethod
    @lru_cache(maxsize=1000) # Cache last 1000 URL validations
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

        qr_image = qr_code.make_image(fill_color="black", back_color="white")

        # Save newly generated QR image to the temp directory
        with cached_qr_path.open('wb') as f:
            qr_image.save(f, 'PNG')

        return qr_image


    def save_qr_to_file(self, qr_code, filepath):
        """Save QR code to a specified file path"""
        pass

    def copy_qr_code_to_clipboard(self, qr_code):
        """Copy QR code to clipboard"""
        pass

    def clear_cache(self):
        """Clear cached QR codes"""
        for file in self.temp_dir.glob("qr_*.png"):
            file.unlink() # removes the file
        self.validate_url.cache_clear() # clears the url validation cache
        return
