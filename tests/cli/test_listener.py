import pytest

# from unittest.mock import MagicMock, patch
from openqr.cli.listener import QRCliListener


@pytest.fixture
def cli_listener():
    """Create a QRCliListener instance."""
    return QRCliListener(prefix="qr_", suffix="\r")


def test_cli_listener_initialization(cli_listener):
    """Test CLI listener initialization."""
    assert cli_listener.prefix == "qr_"
    assert cli_listener.suffix == "\r"
    assert cli_listener.is_listening is False
    assert cli_listener.keystroke_buffer == ""


def test_cli_listener_initialization_defaults():
    """Test CLI listener with default prefix/suffix."""
    listener = QRCliListener()
    assert listener.prefix == ""
    assert listener.suffix == ""
    assert listener.is_listening is False


def test_cli_listener_start_listening(cli_listener):
    """Test starting the CLI listener."""
    assert cli_listener.is_listening is False
    cli_listener.start_listening()
    assert cli_listener.is_listening is True


def test_cli_listener_stop_listening(cli_listener):
    """Test stopping the CLI listener."""
    cli_listener.start_listening()
    assert cli_listener.is_listening is True
    cli_listener.stop_listening()
    assert cli_listener.is_listening is False


def test_cli_listener_set_prefix_suffix(cli_listener):
    """Test setting prefix and suffix."""
    assert cli_listener.prefix == "qr_"
    assert cli_listener.suffix == "\r"

    cli_listener.set_prefix_suffix("prefix_", "suffix")
    assert cli_listener.prefix == "prefix_"
    assert cli_listener.suffix == "suffix"


def test_cli_listener_listen_when_not_listening(cli_listener):
    """Test listen method when not listening."""
    cli_listener.is_listening = False
    result = cli_listener.listen()
    assert result is None


def test_cli_listener_listen_when_listening(cli_listener):
    """Test listen method when listening."""
    cli_listener.is_listening = True
    result = cli_listener.listen()
    # Should return None (method doesn't do anything yet)
    assert result is None


def test_cli_listener_multiple_start_stop_cycles(cli_listener):
    """Test multiple start/stop cycles."""
    cli_listener.start_listening()
    assert cli_listener.is_listening is True

    cli_listener.stop_listening()
    assert cli_listener.is_listening is False

    cli_listener.start_listening()
    assert cli_listener.is_listening is True

    cli_listener.stop_listening()
    assert cli_listener.is_listening is False


def test_cli_listener_start_when_already_started(cli_listener):
    """Test starting when already started."""
    cli_listener.start_listening()
    assert cli_listener.is_listening is True

    # Should not crash when starting twice
    cli_listener.start_listening()
    assert cli_listener.is_listening is True


def test_cli_listener_stop_when_not_started(cli_listener):
    """Test stopping when not started."""
    assert cli_listener.is_listening is False
    cli_listener.stop_listening()
    assert cli_listener.is_listening is False
