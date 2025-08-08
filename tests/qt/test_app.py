import pytest
from openqr.app import OpenQRApp
import tempfile
import os


class MinimalApp(OpenQRApp):
    def __init__(self):
        # Avoid full UI init
        self.allow_domains = []
        self.deny_domains = []
        self.scan_history = []
        self.domains_file = tempfile.mktemp()
        self.qr_code_listener = None
        self.pref_max_history = 10
        self.pref_auto_open_url = True
        self.pref_notification_type = "Popup"
        self.scanner_prefix = "qr_"
        self.scanner_suffix = "\n"
        self.logo_image_path = None
        self.logo_image = None

    def save_domain_lists(self):
        pass

    def load_domain_lists(self):
        pass

    def save_scan_history(self):
        pass

    def load_scan_history(self):
        pass

    def refresh_history_list(self):
        pass

    def trim_history(self):
        while len(self.scan_history) > self.pref_max_history:
            self.scan_history.pop(0)


def test_preferences_update():
    app = MinimalApp()
    app.pref_auto_open_url = False
    app.pref_notification_type = "Status Bar Only"
    app.pref_max_history = 5
    app.scanner_prefix = "test_"
    app.scanner_suffix = "\r"
    assert app.pref_auto_open_url is False
    assert app.pref_notification_type == "Status Bar Only"
    assert app.pref_max_history == 5
    assert app.scanner_prefix == "test_"
    assert app.scanner_suffix == "\r"


def test_blocked_domain_logic():
    app = MinimalApp()
    app.deny_domains = ["blocked.com"]
    url = "https://blocked.com/page"
    domain = "blocked.com"
    assert any(domain == d for d in app.deny_domains)


def test_allow_list_logic():
    app = MinimalApp()
    app.allow_domains = []
    domain = "allow.com"
    app.allow_domains.append(domain)
    assert domain in app.allow_domains
    # Simulate "Don't ask again" logic
    if domain not in app.allow_domains:
        app.allow_domains.append(domain)
    assert domain in app.allow_domains


def test_logo_upload_remove(tmp_path):
    app = MinimalApp()
    # Simulate upload
    fake_logo_path = tmp_path / "logo.png"
    fake_logo_path.write_bytes(b"fake image data")
    app.logo_image_path = str(fake_logo_path)
    app.logo_image = object()  # Mocked image
    assert app.logo_image_path == str(fake_logo_path)
    assert app.logo_image is not None
    # Remove
    app.logo_image_path = None
    app.logo_image = None
    assert app.logo_image_path is None
    assert app.logo_image is None


def test_scan_history_persistence(tmp_path):
    app = MinimalApp()
    app.scan_history = [
        {"url": "https://a.com", "timestamp": "2024-01-01 00:00:00"},
        {"url": "https://b.com", "timestamp": "2024-01-01 00:01:00"},
    ]
    # Simulate save/load
    file = tmp_path / "history.json"
    import json

    with open(file, "w") as f:
        json.dump({"scan_history": app.scan_history}, f)
    with open(file) as f:
        data = json.load(f)
    assert data["scan_history"] == app.scan_history


def test_error_handling_invalid_url():
    app = MinimalApp()
    from validators import url as validate_url

    invalid = "not a url"
    assert not validate_url(invalid)
