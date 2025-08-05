# logger.py
import logging
import sys


def setup_logger(name: str = "openqr") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)  # Set to DEBUG for detailed logs

    # Prevent adding handlers multiple times in dev environment
    if not logger.handlers:
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )

        # File handler
        file_handler = logging.FileHandler("openqr.log")
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)

        # Stream handler (console)
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setLevel(logging.DEBUG)
        stream_handler.setFormatter(formatter)

        # Add handlers to logger
        logger.addHandler(file_handler)
        logger.addHandler(stream_handler)

    return logger
