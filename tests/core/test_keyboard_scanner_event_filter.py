import pytest
from unittest.mock import MagicMock
from PyQt6.QtCore import QEvent, Qt, QObject
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QKeyEvent
from openqr.core.keyboard_scanner_event_filter import KeyboardScannerEventFilter
from openqr.core.listener import QRListener


# QRListener doesn't need QApplication at initialization, only when start_listening() is called
@pytest.fixture
def listener():
    """Create a QRListener instance."""
    return QRListener(prefix="qr_", suffix="\r")


@pytest.fixture
def event_filter(listener):
    """Create a KeyboardScannerEventFilter instance."""
    return KeyboardScannerEventFilter(listener)


def test_event_filter_initialization(event_filter, listener):
    """Test event filter initialization."""
    assert event_filter.listener == listener
    assert event_filter is not None


def test_event_filter_ignores_non_keypress_events(event_filter):
    """Test that event filter ignores non-keypress events."""
    # QApplication not needed for QEvent
    watched_obj = QObject()
    mouse_event = QEvent(QEvent.Type.MouseButtonPress)

    result = event_filter.eventFilter(watched_obj, mouse_event)
    # Should return False (not consumed) for non-keypress events
    assert result is False


def test_event_filter_ignores_when_not_listening(event_filter, qapp):
    """Test that event filter ignores events when not listening."""
    # QApplication needed for QKeyEvent
    event_filter.listener.is_listening = False

    watched_obj = QObject()
    key_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_A, Qt.KeyboardModifier.NoModifier, "a"
    )

    result = event_filter.eventFilter(watched_obj, key_event)
    # Should not process when not listening
    assert result is False


def test_event_filter_processes_keypress_when_listening(event_filter, qapp):
    """Test that event filter processes keypress when listening."""
    # QApplication is needed for QKeyEvent to work properly
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()
    key_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_A, Qt.KeyboardModifier.NoModifier, "a"
    )

    result = event_filter.eventFilter(watched_obj, key_event)
    # Should consume the event
    assert result is True
    # Should call feed_data
    event_filter.listener.feed_data.assert_called_once_with("a")


def test_event_filter_handles_return_key(event_filter, qapp):
    """Test that event filter handles Return/Enter key."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()
    return_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_Return, Qt.KeyboardModifier.NoModifier, ""
    )

    result = event_filter.eventFilter(watched_obj, return_event)
    assert result is True
    event_filter.listener.feed_data.assert_called_once_with("\r")


def test_event_filter_handles_enter_key(event_filter, qapp):
    """Test that event filter handles Enter key."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()
    enter_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_Enter, Qt.KeyboardModifier.NoModifier, ""
    )

    result = event_filter.eventFilter(watched_obj, enter_event)
    assert result is True
    event_filter.listener.feed_data.assert_called_once_with("\r")


def test_event_filter_handles_tab_key(event_filter, qapp):
    """Test that event filter handles Tab key."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()
    tab_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_Tab, Qt.KeyboardModifier.NoModifier, ""
    )

    result = event_filter.eventFilter(watched_obj, tab_event)
    assert result is True
    event_filter.listener.feed_data.assert_called_once_with("\t")


def test_event_filter_normalizes_line_endings(event_filter, qapp):
    """Test that event filter normalizes line endings."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()

    # Test with \n
    newline_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_unknown, Qt.KeyboardModifier.NoModifier, "\n"
    )

    result = event_filter.eventFilter(watched_obj, newline_event)
    assert result is True
    event_filter.listener.feed_data.assert_called_with("\r")

    # Test with \r\n
    crlf_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_unknown, Qt.KeyboardModifier.NoModifier, "\r\n"
    )

    event_filter.listener.feed_data.reset_mock()
    result = event_filter.eventFilter(watched_obj, crlf_event)
    assert result is True
    event_filter.listener.feed_data.assert_called_with("\r")


def test_event_filter_handles_unknown_key_with_text(event_filter, qapp):
    """Test that event filter handles unknown keys with text."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()
    unknown_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_unknown, Qt.KeyboardModifier.NoModifier, "x"
    )

    result = event_filter.eventFilter(watched_obj, unknown_event)
    assert result is True
    event_filter.listener.feed_data.assert_called_once_with("x")


def test_event_filter_ignores_empty_key_text(event_filter, qapp):
    """Test that event filter ignores events with no key text."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    watched_obj = QObject()
    empty_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_Shift, Qt.KeyboardModifier.NoModifier, ""
    )

    result = event_filter.eventFilter(watched_obj, empty_event)
    # Should not consume if no text and not a special key
    assert result is False
    event_filter.listener.feed_data.assert_not_called()


def test_event_filter_handles_none_event(event_filter):
    """Test that event filter handles None event gracefully."""
    # QApplication not needed for None event
    event_filter.listener.is_listening = True

    watched_obj = QObject()
    result = event_filter.eventFilter(watched_obj, None)
    # Should return False for None event
    assert result is False


def test_event_filter_handles_none_watched_obj(event_filter, qapp):
    """Test that event filter handles None watched object gracefully."""
    event_filter.listener.is_listening = True
    event_filter.listener.feed_data = MagicMock()

    key_event = QKeyEvent(
        QEvent.Type.KeyPress, Qt.Key.Key_A, Qt.KeyboardModifier.NoModifier, "a"
    )

    result = event_filter.eventFilter(None, key_event)
    # Should still process the event
    assert result is True
    event_filter.listener.feed_data.assert_called_once_with("a")
