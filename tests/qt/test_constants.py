import pytest
from openqr.qt.constants import HELP_MESSAGE


def test_help_message_exists():
    """Test that HELP_MESSAGE constant exists."""
    assert HELP_MESSAGE is not None
    assert isinstance(HELP_MESSAGE, str)


def test_help_message_not_empty():
    """Test that HELP_MESSAGE is not empty."""
    assert len(HELP_MESSAGE) > 0


def test_help_message_contains_keywords():
    """Test that HELP_MESSAGE contains expected keywords."""
    assert "OpenQR" in HELP_MESSAGE or "Help" in HELP_MESSAGE
    assert "Listening" in HELP_MESSAGE or "listening" in HELP_MESSAGE
    assert "QR" in HELP_MESSAGE or "qr" in HELP_MESSAGE


def test_help_message_is_html():
    """Test that HELP_MESSAGE contains HTML formatting."""
    assert "<b>" in HELP_MESSAGE or "<br>" in HELP_MESSAGE


def test_help_message_contains_features():
    """Test that HELP_MESSAGE mentions key features."""
    help_lower = HELP_MESSAGE.lower()
    # Check for mentions of key features
    assert any(
        keyword in help_lower
        for keyword in ["prefix", "suffix", "domain", "logo", "history"]
    )
