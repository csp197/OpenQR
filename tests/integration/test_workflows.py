import pytest

# import tempfile
# import json
# from pathlib import Path
# from unittest.mock import patch, MagicMock
from openqr.core.generator import QRGenerator
from openqr.core.listener import QRListener
from openqr.qt.app import OpenQRApp
from PIL import Image


@pytest.fixture
def qt_app():
    """Create a QApplication instance for tests."""
    from PyQt6.QtWidgets import QApplication

    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_complete_qr_generation_workflow(tmp_path):
    """Test complete workflow: validate URL -> generate QR -> save to file."""
    generator = QRGenerator()

    url = "https://example.com"

    # Validate URL
    assert generator.validate_url(url) is True

    # Generate QR code
    qr_code = generator.generate_qr_code(url)
    assert qr_code is not None
    assert isinstance(qr_code, Image.Image)

    # Save to file
    file_path = tmp_path / "test_qr.png"
    generator.save_qr_to_file(qr_code, str(file_path))
    assert file_path.exists()

    # Verify saved file
    saved_image = Image.open(file_path)
    assert saved_image is not None


def test_complete_listener_workflow(qapp):
    """Test complete workflow: start listening -> feed data -> process -> stop."""
    listener = QRListener(prefix="qr_", suffix="\r")

    # Start listening
    listener.start_listening()
    assert listener.is_listening is True

    # Feed data character by character
    url = "qr_https://example.com\r"
    for char in url:
        listener.feed_data(char)

    # Stop listening
    listener.stop_listening()
    assert listener.is_listening is False
    assert len(listener._scanner_keystroke_buffer) == 0


def test_config_save_and_load_workflow(tmp_path, qapp, monkeypatch):
    """Test complete workflow: save config -> load config."""
    # Mock config directory
    monkeypatch.setattr("os.path.expanduser", lambda x: str(tmp_path))

    class MinimalApp(OpenQRApp):
        def _init_ui(self):
            pass  # Skip UI initialization

    app = MinimalApp()

    # Set some values
    app.scanner_prefix = "test_"
    app.scanner_suffix = "\n"
    app.allow_domains = ["example.com"]
    app.deny_domains = ["blocked.com"]

    # Save config
    app.save_config()

    # Create new app and load config
    app2 = MinimalApp()
    app2.load_config()

    # Verify values were loaded
    assert app2.scanner_prefix == "test_"
    assert app2.scanner_suffix == "\n"
    assert app2.allow_domains == ["example.com"]
    assert app2.deny_domains == ["blocked.com"]


def test_scan_history_workflow(tmp_path, qapp, monkeypatch):
    """Test complete workflow: add to history -> save -> load -> refresh."""
    monkeypatch.setattr("os.path.expanduser", lambda x: str(tmp_path))

    class MinimalApp(OpenQRApp):
        def _init_ui(self):
            pass

        def refresh_history_list(self):
            pass  # Skip UI refresh

    app = MinimalApp()

    # Add URLs to history
    app.add_to_history("https://example.com")
    app.add_to_history("https://test.com")

    assert len(app.scan_history) == 2

    # Save history
    app.save_scan_history()

    # Load history in new app
    app2 = MinimalApp()
    app2.load_scan_history()

    # Verify history was loaded
    assert len(app2.scan_history) == 2
    assert app2.scan_history[0]["url"] == "https://example.com"
    assert app2.scan_history[1]["url"] == "https://test.com"


def test_qr_generation_with_logo_workflow(tmp_path, qapp, monkeypatch):
    """Test complete workflow: generate QR -> add logo -> save."""
    generator = QRGenerator()

    # Create a logo image
    logo = Image.new("RGB", (50, 50), color="red")
    logo_path = tmp_path / "logo.png"
    logo.save(logo_path)

    # Generate QR code
    url = "https://example.com"
    qr_code = generator.generate_qr_code(url)

    # Overlay logo (simulating what the app does)
    qr_img = qr_code.convert("RGBA")
    logo_img = logo.convert("RGBA")

    # Resize logo
    qr_w, qr_h = qr_img.size
    factor = 0.15
    logo_size = int(qr_w * factor), int(qr_h * factor)
    logo_resized = logo_img.resize(logo_size, Image.LANCZOS)

    # Add border and center
    border_size = int(logo_size[0] * 0.25)
    bordered_size = (logo_size[0] + 2 * border_size, logo_size[1] + 2 * border_size)
    bordered_logo = Image.new("RGBA", bordered_size, (255, 255, 255, 255))
    bordered_logo.paste(logo_resized, (border_size, border_size), mask=logo_resized)

    pos = ((qr_w - bordered_size[0]) // 2, (qr_h - bordered_size[1]) // 2)
    qr_img.paste(bordered_logo, pos, mask=bordered_logo)

    # Save final QR code
    final_path = tmp_path / "qr_with_logo.png"
    qr_img.save(final_path)

    assert final_path.exists()
    final_image = Image.open(final_path)
    assert final_image is not None


def test_domain_management_workflow(tmp_path, qapp, monkeypatch):
    """Test complete workflow: add domains -> save -> load -> check."""
    monkeypatch.setattr("os.path.expanduser", lambda x: str(tmp_path))

    class MinimalApp(OpenQRApp):
        def _init_ui(self):
            pass

    app = MinimalApp()

    # Add domains
    app.allow_domains = ["example.com", "test.com"]
    app.deny_domains = ["blocked.com"]

    # Save config
    app.save_config()

    # Load in new app
    app2 = MinimalApp()
    app2.load_config()

    # Verify domains
    assert "example.com" in app2.allow_domains
    assert "test.com" in app2.allow_domains
    assert "blocked.com" in app2.deny_domains


def test_listener_prefix_suffix_change_workflow(qapp):
    """Test workflow: change prefix/suffix -> feed data -> process."""
    listener = QRListener(prefix="qr_", suffix="\r")
    listener.start_listening()

    # Change prefix/suffix
    listener.set_prefix_suffix("prefix_", "suffix")

    # Feed data with new prefix/suffix
    data = "prefix_https://example.comsuffix"
    listener.process_scanned_data(data)

    # Verify prefix/suffix were updated
    assert listener.prefix == "prefix_"
    assert listener.suffix == "suffix"

    listener.stop_listening()


def test_qr_code_caching_workflow():
    """Test workflow: generate QR -> generate again -> use cache."""
    generator = QRGenerator()
    url = "https://example.com"

    # Generate first time
    qr1 = generator.generate_qr_code(url)
    assert qr1 is not None

    # Generate second time (should use cache)
    qr2 = generator.generate_qr_code(url)
    assert qr2 is not None

    # Both should be valid images
    assert isinstance(qr1, Image.Image)
    assert isinstance(qr2, Image.Image)


def test_multiple_qr_codes_different_colors():
    """Test generating multiple QR codes with different colors."""
    generator = QRGenerator()
    url = "https://example.com"

    colors = [
        ("black", "white"),
        ("red", "white"),
        ("blue", "yellow"),
        ("green", "white"),
    ]

    qr_codes = []
    for fg, bg in colors:
        qr = generator.generate_qr_code(url, fill_color=fg, back_color=bg)
        qr_codes.append(qr)
        assert qr is not None

    # All should be valid
    assert len(qr_codes) == len(colors)
    assert all(isinstance(qr, Image.Image) for qr in qr_codes)
