import pytest
from io import StringIO
from unittest.mock import patch
from openqr.utils.printer import print_help, print_version


def test_print_help(capsys):
    """Test print_help function."""
    print_help()
    captured = capsys.readouterr()
    
    assert "OpenQR Usage" in captured.out
    assert "--help" in captured.out or "-h" in captured.out
    assert "--version" in captured.out or "-v" in captured.out


def test_print_help_content():
    """Test that print_help contains expected content."""
    with patch('sys.stdout', new=StringIO()) as fake_out:
        print_help()
        output = fake_out.getvalue()
        
        assert "OpenQR Usage" in output
        assert "help" in output.lower()
        assert "version" in output.lower()


def test_print_version(capsys):
    """Test print_version function."""
    print_version()
    captured = capsys.readouterr()
    
    assert "OpenQR" in captured.out
    assert "version" in captured.out.lower()


def test_print_version_content():
    """Test that print_version contains version information."""
    with patch('sys.stdout', new=StringIO()) as fake_out:
        print_version()
        output = fake_out.getvalue()
        
        assert "OpenQR" in output
        assert "version" in output.lower()
        # Should contain some version number
        assert any(char.isdigit() for char in output)


def test_print_help_formatting():
    """Test that print_help output is properly formatted."""
    with patch('sys.stdout', new=StringIO()) as fake_out:
        print_help()
        output = fake_out.getvalue()
        
        # Should contain newlines for formatting
        assert "\n" in output
        # Should not be empty
        assert len(output.strip()) > 0


def test_print_version_formatting():
    """Test that print_version output is properly formatted."""
    with patch('sys.stdout', new=StringIO()) as fake_out:
        print_version()
        output = fake_out.getvalue()
        
        # Should contain newlines for formatting
        assert "\n" in output
        # Should not be empty
        assert len(output.strip()) > 0


def test_print_help_multiple_calls(capsys):
    """Test that print_help can be called multiple times."""
    print_help()
    captured1 = capsys.readouterr()
    
    print_help()
    captured2 = capsys.readouterr()
    
    # Should produce same output
    assert captured1.out == captured2.out


def test_print_version_multiple_calls(capsys):
    """Test that print_version can be called multiple times."""
    print_version()
    captured1 = capsys.readouterr()
    
    print_version()
    captured2 = capsys.readouterr()
    
    # Should produce same output
    assert captured1.out == captured2.out


def test_print_help_does_not_raise():
    """Test that print_help doesn't raise exceptions."""
    try:
        print_help()
        assert True
    except Exception:
        pytest.fail("print_help raised an exception")


def test_print_version_does_not_raise():
    """Test that print_version doesn't raise exceptions."""
    try:
        print_version()
        assert True
    except Exception:
        pytest.fail("print_version raised an exception")
