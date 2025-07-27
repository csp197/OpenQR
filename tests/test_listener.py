from openqr.app import QRCodeListener
import pytest

listener = QRCodeListener()

def test_initial_state():
    assert listener.is_listening == False
