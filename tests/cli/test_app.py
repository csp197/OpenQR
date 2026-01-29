import pytest
from unittest.mock import patch
# MagicMock, call
from pathlib import Path
from typer.testing import CliRunner

# Import may fail if zbar is not available
try:
    from openqr.cli.app import app, cli, SCANNER_AVAILABLE
except ImportError:
    SCANNER_AVAILABLE = False
    app = None
    cli = None


@pytest.fixture
def runner():
    """Create a CliRunner for testing."""
    return CliRunner()


@pytest.mark.skipif(app is None, reason="CLI app not available")
def test_cli_initialization():
    """Test that CLI is properly initialized."""
    assert cli is not None
    assert cli.qr_code_generator is not None
    if SCANNER_AVAILABLE:
        assert cli.qr_code_scanner is not None
    assert cli.qr_code_listener is not None


@pytest.mark.skipif(app is None, reason="CLI app not available")
@patch("openqr.cli.app.cli.qr_code_generator.generate_qr_code")
def test_make_command(mock_generate, runner):
    """Test the make command."""
    url = "https://www.example.com"

    result = runner.invoke(app, ["make", url])

    # Should call generate_qr_code
    mock_generate.assert_called_once_with(url)
    # Command should complete successfully
    assert result.exit_code == 0


@pytest.mark.skipif(app is None, reason="CLI app not available")
@patch("openqr.cli.app.cli.qr_code_generator.generate_qr_code")
def test_make_command_invalid_url(mock_generate, runner):
    """Test the make command with invalid URL."""
    url = "not a url"

    # The command might raise an error or handle it gracefully
    _ = runner.invoke(app, ["make", url])

    # generate_qr_code should still be called (it will raise ValueError)
    mock_generate.assert_called_once_with(url)


@pytest.mark.skipif(app is None, reason="CLI app not available")
def test_listen_command(runner):
    """Test the listen command."""
    # The listen command is currently not implemented (just passes)
    result = runner.invoke(app, ["listen"])

    # Should complete without error
    assert result.exit_code == 0


@pytest.mark.skipif(
    app is None or not SCANNER_AVAILABLE, reason="CLI app or scanner not available"
)
@patch("openqr.cli.app.cli.qr_code_scanner.scan_from_image")
def test_scan_command(mock_scan, runner, tmp_path):
    """Test the scan command."""
    # Create a test image file
    test_file = tmp_path / "test_qr.png"
    test_file.write_bytes(b"fake image data")

    result = runner.invoke(app, ["scan", str(test_file)])

    # Should call scan_from_image
    mock_scan.assert_called_once_with(Path(str(test_file)))
    # Command should complete successfully
    assert result.exit_code == 0


@pytest.mark.skipif(
    app is None or not SCANNER_AVAILABLE, reason="CLI app or scanner not available"
)
@patch("openqr.cli.app.cli.qr_code_scanner.scan_from_image")
def test_scan_command_nonexistent_file(mock_scan, runner):
    """Test the scan command with non-existent file."""
    nonexistent_file = Path("/nonexistent/file.png")

    result = runner.invoke(app, ["scan", str(nonexistent_file)])

    # scan_from_image should still be called (it will handle the error)
    mock_scan.assert_called_once_with(nonexistent_file)
    # Command should complete (may have error, but shouldn't crash)
    assert result.exit_code in [0, 1, 2]  # May exit with error code


@pytest.mark.skipif(app is None, reason="CLI app not available")
def test_scan_command_missing_argument(runner):
    """Test the scan command without file argument."""
    result = runner.invoke(app, ["scan"])

    # Should show error about missing argument
    assert result.exit_code != 0
    assert (
        "Missing argument" in result.stdout
        or "Error" in result.stdout
        or result.exit_code == 2
    )


@pytest.mark.skipif(app is None, reason="CLI app not available")
def test_make_command_missing_argument(runner):
    """Test the make command without URL argument."""
    result = runner.invoke(app, ["make"])

    # Should show error about missing argument
    assert result.exit_code != 0
    assert (
        "Missing argument" in result.stdout
        or "Error" in result.stdout
        or result.exit_code == 2
    )


@pytest.mark.skipif(app is None, reason="CLI app not available")
def test_cli_help(runner):
    """Test that CLI shows help."""
    result = runner.invoke(app, ["--help"])

    assert result.exit_code == 0
    assert "OpenQR CLI tool" in result.stdout or "make" in result.stdout


@pytest.mark.skipif(app is None, reason="CLI app not available")
def test_cli_unknown_command(runner):
    """Test that CLI handles unknown commands."""
    result = runner.invoke(app, ["unknown-command"])

    # Should show error about unknown command
    assert result.exit_code != 0


@pytest.mark.skipif(app is None, reason="CLI app not available")
@patch("openqr.cli.app.cli.qr_code_generator.generate_qr_code")
def test_make_command_with_valid_urls(mock_generate, runner):
    """Test make command with various valid URLs."""
    urls = [
        "https://www.example.com",
        "http://example.com",
        "https://subdomain.example.com/path?param=value",
    ]

    for url in urls:
        result = runner.invoke(app, ["make", url])
        assert result.exit_code == 0

    # Should have been called for each URL
    assert mock_generate.call_count == len(urls)


@pytest.mark.skipif(
    app is None or not SCANNER_AVAILABLE, reason="CLI app or scanner not available"
)
@patch("openqr.cli.app.cli.qr_code_scanner.scan_from_image")
def test_scan_command_returns_decoded_value(mock_scan, runner, tmp_path):
    """Test that scan command processes the decoded value."""
    test_file = tmp_path / "test_qr.png"
    test_file.write_bytes(b"fake image data")

    # Mock scan_from_image to return a decoded value
    mock_scan.return_value = "https://example.com"

    result = runner.invoke(app, ["scan", str(test_file)])

    mock_scan.assert_called_once_with(Path(str(test_file)))
    assert result.exit_code == 0
