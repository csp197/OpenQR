# import pytest
# from pytestqt.exceptions import TimeoutError
# from openqr.core.listener import QRListener
# from unittest.mock import MagicMock, patch
# from PyQt6.QtWidgets import QWidget


# @pytest.fixture
# def listener():
#     return QRListener(prefix="qr_", suffix="\n")


# def test_prefix_suffix_extraction(listener, qtbot):
#     # Should emit for correct prefix/suffix
#     with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
#         listener.process_scanned_data("qr_https://example.com\n")
#     assert blocker.args == ["https://example.com"]

#     # Should not emit for missing prefix
#     with pytest.raises(TimeoutError):
#         with qtbot.waitSignal(listener.url_scanned, timeout=200):
#             listener.process_scanned_data("bad_https://example.com\n")

#     # Should not emit for missing suffix
#     with pytest.raises(TimeoutError):
#         with qtbot.waitSignal(listener.url_scanned, timeout=200):
#             listener.process_scanned_data("qr_https://example.com")

#     # Should emit for empty prefix
#     listener.set_prefix_suffix("", "\n")
#     with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
#         listener.process_scanned_data("https://no-prefix.com\n")
#     assert blocker.args == ["https://no-prefix.com"]

#     # Should emit for empty suffix
#     listener.set_prefix_suffix("qr_", "")
#     with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
#         listener.process_scanned_data("qr_https://no-suffix.com")
#     assert blocker.args == ["https://no-suffix.com"]

#     # Should emit for both empty
#     listener.set_prefix_suffix("", "")
#     with qtbot.waitSignal(listener.url_scanned, timeout=1000) as blocker:
#         listener.process_scanned_data("https://bare.com")
#     assert blocker.args == ["https://bare.com"]


# def test_initial_state(listener):
#     assert len(listener._scanner_keystroke_buffer) == 0
#     assert listener.is_listening == False


# def test_final_state(listener):
#     assert listener.is_listening == False


# def test_start_listening(listener):
#     assert listener.is_listening == False
#     try:
#         listener.start_listening(listener)
#     except RuntimeError as e:
#         pytest.fail(f"Exception raised: {e}")
#     assert listener.is_listening == True

# def test_stop_listening(listener):
#     listener.stop_listening()

#     assert listener.is_listening == False


# def test_single_full_cycle(listener):
#     assert len(listener.buffer) == 0
#     assert listener.is_listening == False

#     listener.start_listening(listener)
#     assert listener.is_listening == True

#     listener.stop_listening()
#     assert listener.is_listening == False


# def test_multiple_full_cycles(listener):
#     assert len(listener.buffer) == 0
#     assert listener.is_listening == False

#     listener.start_listening(listener)
#     assert listener.is_listening == True

#     listener.stop_listening(listener)
#     assert listener.is_listening == False

#     listener.start_listening(listener)
#     assert listener.is_listening == True

#     listener.stop_listening(listener)
#     assert listener.is_listening == False


# def test_start_when_already_started(listener):
#     listener.start_listening(listener)
#     assert listener.is_listening == True

#     # Test that no crash occurs when starting twice
#     try:
#         listener.start_listening(listener)
#     except RuntimeError as e:
#         pytest.fail(f"Exception raised: {e}")

#     assert listener.is_listening == True


# def test_requires_valid_qwidget(listener):
#     invalid_widget = MagicMock()
#     invalid_widget.__class__ = object
#     with patch.object(listener, '_install_event_filter') as mock_install:
#         listener.start_listening(invalid_widget)
#         assert not mock_install.called
#         assert not listener.is_listening

# def test_sets_is_listening_to_true(listener):
#     valid_widget = QWidget()
#     listener.start_listening(valid_widget)
#     assert listener.is_listening

# def test_installs_event_filter(listener):
#     valid_widget = QWidget()
#     with patch.object(listener, '_install_event_filter') as mock_install:
#         listener.start_listening(valid_widget)
#         mock_install.assert_called_once()

# def test_logs_error_on_invalid_widget(listener, caplog):
#     invalid_widget = MagicMock()
#     invalid_widget.__class__ = object
#     listener.start_listening(invalid_widget)
#     assert "start_listening requires a valid QWidget" in caplog.text