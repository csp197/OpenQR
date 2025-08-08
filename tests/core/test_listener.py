import pytest
from pytestqt.exceptions import TimeoutError
from openqr.scanner.listener import QRCodeListener


@pytest.fixture
def listener():
    return QRCodeListener(prefix="qr_", suffix="\n")


def test_prefix_suffix_extraction(listener, qtbot):
    # Should emit for correct prefix/suffix
    with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
        listener.process_scanned_data("qr_https://example.com\n")
    assert blocker.args == ["https://example.com"]

    # Should not emit for missing prefix
    with pytest.raises(TimeoutError):
        with qtbot.waitSignal(listener.url_scanned, timeout=200):
            listener.process_scanned_data("bad_https://example.com\n")

    # Should not emit for missing suffix
    with pytest.raises(TimeoutError):
        with qtbot.waitSignal(listener.url_scanned, timeout=200):
            listener.process_scanned_data("qr_https://example.com")

    # Should emit for empty prefix
    listener.set_prefix_suffix("", "\n")
    with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
        listener.process_scanned_data("https://no-prefix.com\n")
    assert blocker.args == ["https://no-prefix.com"]

    # Should emit for empty suffix
    listener.set_prefix_suffix("qr_", "")
    with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
        listener.process_scanned_data("qr_https://no-suffix.com")
    assert blocker.args == ["https://no-suffix.com"]

    # Should emit for both empty
    listener.set_prefix_suffix("", "")
    with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
        listener.process_scanned_data("https://bare.com")
    assert blocker.args == ["https://bare.com"]


def test_initial_state(listener):
    assert len(listener.buffer) == 0
    assert listener.is_listening == False


def test_final_state(listener):
    assert listener.is_listening == False


def test_start_listening(listener):
    listener.start_listening()

    assert listener.is_listening == True


def test_stop_listening(listener):
    listener.stop_listening()

    assert listener.is_listening == False


def test_single_full_cycle(listener):
    assert len(listener.buffer) == 0
    assert listener.is_listening == False

    listener.start_listening()
    assert listener.is_listening == True

    listener.stop_listening()
    assert listener.is_listening == False


def test_multiple_full_cycles(listener):
    assert len(listener.buffer) == 0
    assert listener.is_listening == False

    listener.start_listening()
    assert listener.is_listening == True

    listener.stop_listening()
    assert listener.is_listening == False

    listener.start_listening()
    assert listener.is_listening == True

    listener.stop_listening()
    assert listener.is_listening == False


def test_start_when_already_started(listener):
    listener.start_listening()
    assert listener.is_listening == True
    listener.start_listening()
    assert listener.is_listening == True
