from openqr.scanner.listener import QRCodeListener

import pytest


@pytest.fixture
def listener():
    return QRCodeListener()


def test_initial_state(listener):
    assert len(listener.buffer) == 0
    assert not listener.is_listening


def test_final_state(listener):
    assert not listener.is_listening


def test_start_listening(listener):
    listener.start_listening()

    assert listener.is_listening


def test_stop_listening(listener):
    listener.stop_listening()

    assert not listener.is_listening


def test_single_full_cycle(listener):
    assert len(listener.buffer) == 0
    assert not listener.is_listening

    listener.start_listening()
    assert listener.is_listening

    listener.stop_listening()
    assert not listener.is_listening


def test_multiple_full_cycles(listener):
    assert len(listener.buffer) == 0
    assert not listener.is_listening

    listener.start_listening()
    assert listener.is_listening

    listener.stop_listening()
    assert not listener.is_listening

    listener.start_listening()
    assert listener.is_listening

    listener.stop_listening()
    assert not listener.is_listening


def test_start_when_already_started(listener):
    listener.start_listening()
    assert listener.is_listening
    listener.start_listening()
    assert listener.is_listening
