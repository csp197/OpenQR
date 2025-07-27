from openqr.scanner.listener import QRCodeListener
import pytest

@pytest.fixture
def listener():
    return QRCodeListener()

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
