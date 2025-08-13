from PyQt6.QtCore import QObject, pyqtSignal
from pathlib import Path
from pyzbar.pyzbar import decode
from PIL import Image

from openqr.utils import logger

log = logger.setup_logger()


class QRScanner(QObject):
    img_scanned = pyqtSignal(
        object
    )  # Emitted when a QR code is successfully scanned (QR code)

    img_decoded = pyqtSignal(
        object
    )  # Emitted when a QR code is successfully decoded (QR code)

    def __init__(self, timeout=1.0):
        super().__init__()
        self.timeout = timeout
        log.info("QRScanner initialized")

    def scan_from_image(self, image_path: Path, emit_signals=True):
        image = None
        decoded_objects = None

        try:
            image = Image.open(image_path)
            log.info(
                f"QR Code Image loaded with format: {image.format}, size: {image.size} from path: {image_path}"
            )
            if emit_signals:
                self.emit_image_scanned(image)
        except Exception as e:
            log.error(f"QR Code Image failed to load: {e}")
        if not image:
            log.error(f"QR Code Image at {image_path} is not recognized as an image")
            return None

        try:
            decoded_objects = decode(image)
            if emit_signals:
                self.emit_image_decoded(decoded_objects)
        except Exception as e:
            log.error(f"Loaded QR Code Image failed to decode: {e}")
        if not decoded_objects:
            log.error(
                f"QR Code Image at {image_path} does not contain any recognizable QR code or barcode"
            )
            return None

        decoded_texts = [obj.data.encode("utf-8") for obj in decoded_objects]
        decoded_value = decoded_objects[0].data.decode("utf-8") if decoded_texts else ""
        log.info(f"Decoded value = {decoded_value} from QR Code Image at {image_path}.")

        return decoded_value

    def emit_image_scanned(self, img):
        log.info(f"Emitting img_scanned signal with img: {img}")
        self.img_scanned.emit(img)

    def emit_image_decoded(self, emit_value):
        log.info(
            f"Emitting img_decoded signal with the first decoded value in the object array: {emit_value}"
        )
        self.img_decoded.emit(emit_value)
