import logging
import os

# try:
#     from appdirs import user_config_dir
# except ImportError:
#     user_config_dir = None


def setup_logger():
    logger = logging.getLogger("OpenQR")
    logger.setLevel(logging.DEBUG)

    # Determine log file path
    # if user_config_dir:
    #     config_dir = user_config_dir("openqr", "openqr")
    # else:
    config_dir = os.path.expanduser("~/.openqr")
    os.makedirs(config_dir, exist_ok=True)
    log_path = os.path.join(config_dir, "openqr.log")

    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    # File handler
    fh = logging.FileHandler(log_path)
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(formatter)

    # Stream (stdout) handler
    sh = logging.StreamHandler()
    sh.setLevel(logging.INFO)
    sh.setFormatter(formatter)

    # Avoid duplicate handlers
    if not any(
        isinstance(h, logging.FileHandler)
        and getattr(h, "baseFilename", None) == fh.baseFilename
        for h in logger.handlers
    ):
        logger.addHandler(fh)
    if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
        logger.addHandler(sh)

    return logger
