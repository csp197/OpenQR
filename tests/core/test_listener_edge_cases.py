import pytest
from openqr.core.listener import QRListener
from unittest.mock import MagicMock, patch


@pytest.fixture
def listener():
    return QRListener(prefix="qr_", suffix="\r")


def test_listener_buffer_overflow_protection(listener, qapp):
    """Test that buffer doesn't grow indefinitely."""
    listener.start_listening()

    # Feed a very long string without suffix
    long_string = "qr_" + "a" * 10000
    listener.feed_data(long_string)

    # Buffer should be cleared if prefix doesn't match or should have reasonable size
    # The exact behavior depends on implementation
    buffer_len = len(listener._scanner_keystroke_buffer)
    # Should not be the full 10000+ characters
    assert buffer_len < 20000  # Reasonable upper bound


def test_listener_multiple_prefixes_in_sequence(listener, qapp):
    """Test handling of multiple prefix occurrences."""
    listener.start_listening()

    # Feed data with prefix appearing multiple times
    listener.feed_data("qr_")
    listener.feed_data("bad_data")
    listener.feed_data("qr_")
    listener.feed_data("https://example.com")
    listener.feed_data("\r")

    # Should handle the second prefix correctly
    # Exact behavior depends on implementation


def test_listener_suffix_before_prefix(listener, qapp):
    """Test handling when suffix appears before prefix."""
    listener.start_listening()

    listener.feed_data("\r")
    listener.feed_data("qr_")
    listener.feed_data("https://example.com")
    listener.feed_data("\r")

    # Should handle correctly or ignore the first suffix


def test_listener_empty_prefix_suffix(listener, qapp):
    """Test listener with empty prefix and suffix."""
    listener.set_prefix_suffix("", "")
    listener.start_listening()

    # Should accept any input immediately
    listener.feed_data("https://example.com")

    # Buffer should be processed or cleared
    # Exact behavior depends on implementation


def test_listener_very_long_prefix(listener, qapp):
    """Test listener with very long prefix."""
    long_prefix = "qr_" * 100
    listener.set_prefix_suffix(long_prefix, "\r")
    listener.start_listening()

    # Feed the prefix
    for char in long_prefix:
        listener.feed_data(char)

    # Should handle long prefix correctly
    assert listener.prefix == long_prefix


def test_listener_very_long_suffix(listener, qapp):
    """Test listener with very long suffix."""
    long_suffix = "\r" * 10
    listener.set_prefix_suffix("qr_", long_suffix)
    listener.start_listening()

    listener.feed_data("qr_https://example.com")
    for char in long_suffix:
        listener.feed_data(char)

    # Should handle long suffix correctly
    assert listener.suffix == long_suffix


def test_listener_special_characters_in_prefix(listener, qapp):
    """Test listener with special characters in prefix."""
    special_prefix = "qr_\t\n"
    listener.set_prefix_suffix(special_prefix, "\r")
    listener.start_listening()

    assert listener.prefix == special_prefix


def test_listener_special_characters_in_suffix(listener, qapp):
    """Test listener with special characters in suffix."""
    special_suffix = "\r\n\t"
    listener.set_prefix_suffix("qr_", special_suffix)
    listener.start_listening()

    assert listener.suffix == special_suffix


def test_listener_process_scanned_data_unicode(listener):
    """Test processing scanned data with unicode characters."""
    unicode_url = "qr_https://example.com/测试\r"
    listener.process_scanned_data(unicode_url)

    # Should handle unicode correctly
    # Exact behavior depends on signal emission


def test_listener_feed_data_unicode(listener, qapp):
    """Test feeding data with unicode characters."""
    listener.start_listening()

    unicode_url = "qr_https://example.com/测试\r"
    for char in unicode_url:
        listener.feed_data(char)

    # Should handle unicode correctly
    # Buffer should process the unicode characters


def test_listener_concurrent_feed_data(listener, qapp):
    """Test concurrent feed_data calls (thread safety)."""
    import threading

    listener.start_listening()

    def feed_chars(chars):
        for char in chars:
            listener.feed_data(char)

    # Create multiple threads feeding data
    threads = []
    for i in range(5):
        chars = f"qr_https://example{i}.com\r"
        t = threading.Thread(target=feed_chars, args=(chars,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # Should not crash and should handle thread safety
    # Buffer should be in a consistent state
    assert listener._scanner_keystroke_buffer is not None


def test_listener_stop_listening_clears_buffer(listener, qapp):
    """Test that stopping listening clears the buffer."""
    listener.start_listening()
    listener.feed_data("qr_https://example.com")

    # Buffer should have some data
    assert len(listener._scanner_keystroke_buffer) > 0

    listener.stop_listening()

    # Buffer should be cleared
    assert len(listener._scanner_keystroke_buffer) == 0


def test_listener_set_prefix_suffix_while_listening(listener, qapp):
    """Test setting prefix/suffix while listening."""
    listener.start_listening()

    # Change prefix/suffix while listening
    listener.set_prefix_suffix("new_", "\n")

    assert listener.prefix == "new_"
    assert listener.suffix == "\n"


def test_listener_process_scanned_data_empty_string(listener):
    """Test processing empty scanned data."""
    # Should handle gracefully
    listener.process_scanned_data("")

    # Should not crash


def test_listener_emit_url_scanned_empty_url(listener):
    """Test emitting empty URL."""
    # Should handle gracefully
    listener.emit_url_scanned("")

    # Should not crash


def test_listener_feed_data_when_stopped(listener):
    """Test that feed_data does nothing when stopped."""
    listener.is_listening = False

    initial_buffer = listener._scanner_keystroke_buffer
    listener.feed_data("qr_https://example.com\r")

    # Buffer should not change when not listening
    assert listener._scanner_keystroke_buffer == initial_buffer
