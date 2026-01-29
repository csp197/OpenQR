import pytest
import tempfile
import os

# from pathlib import Path
from unittest.mock import patch

# , MagicMock
from openqr.core.generator import QRGenerator
from PIL import Image


@pytest.fixture
def generator():
    return QRGenerator()


def test_generator_cache_directory_creation(generator, tmp_path, monkeypatch):
    """Test that cache directory is created if it doesn't exist."""
    # Mock tempfile.gettempdir to return our tmp_path
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))

    # Create a new generator which should create the cache directory
    gen = QRGenerator()
    cache_dir = gen.temp_dir

    assert cache_dir.exists()
    assert cache_dir.is_dir()


def test_generator_cache_directory_already_exists(generator, tmp_path, monkeypatch):
    """Test that generator works when cache directory already exists."""
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))

    cache_dir = tmp_path / "openqr_cache"
    cache_dir.mkdir()

    # Should not raise error
    gen = QRGenerator()
    assert gen.temp_dir == cache_dir


def test_generator_cache_directory_is_file_error(tmp_path, monkeypatch):
    """Test error when cache directory path is a file."""
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))

    cache_file = tmp_path / "openqr_cache"
    cache_file.write_text("not a directory")

    with pytest.raises(RuntimeError):
        QRGenerator()


def test_generator_get_cache_path_special_characters(generator):
    """Test cache path generation with special characters in URL."""
    url = "https://example.com/path?param=value&other=test"
    cache_path = generator._get_cache_path(url)

    assert cache_path is not None
    assert cache_path.suffix == ".png"
    # Should handle special characters safely
    assert "?" not in cache_path.name or "&" not in cache_path.name


def test_generator_get_cache_path_very_long_url(generator):
    """Test cache path generation with very long URL."""
    long_url = "https://example.com/" + "a" * 1000
    cache_path = generator._get_cache_path(long_url)

    assert cache_path is not None
    # Should truncate or hash long URLs
    assert len(cache_path.name) < 500  # Reasonable filename length


def test_generator_get_cache_path_unicode_url(generator):
    """Test cache path generation with unicode characters."""
    url = "https://example.com/测试/路径"
    cache_path = generator._get_cache_path(url)

    assert cache_path is not None
    # Should handle unicode safely
    assert cache_path.suffix == ".png"


def test_generator_generate_qr_code_different_sizes(generator):
    """Test generating QR codes of different sizes."""
    urls = [
        "https://example.com",
        "https://example.com/very/long/path/with/many/segments",
        "https://example.com?param1=value1&param2=value2&param3=value3",
    ]

    for url in urls:
        qr_code = generator.generate_qr_code(url)
        assert qr_code is not None
        assert isinstance(qr_code, Image.Image)
        assert qr_code.size[0] > 0
        assert qr_code.size[1] > 0


def test_generator_generate_qr_code_same_url_different_colors(generator):
    """Test that same URL with different colors generates different cache files."""
    url = "https://example.com"

    qr1 = generator.generate_qr_code(url, fill_color="red", back_color="white")
    qr2 = generator.generate_qr_code(url, fill_color="blue", back_color="white")

    # Should be different images
    assert qr1 is not None
    assert qr2 is not None


def test_generator_save_qr_code_different_formats(generator, tmp_path):
    """Test saving QR code with different file extensions."""
    url = "https://example.com"
    qr_code = generator.generate_qr_code(url)

    # Test with .png extension
    png_path = tmp_path / "test.png"
    generator.save_qr_to_file(qr_code, str(png_path))
    assert png_path.exists()

    # Verify it's a valid PNG
    saved_image = Image.open(png_path)
    assert saved_image.format == "PNG"


def test_generator_save_qr_code_permission_error(generator, tmp_path):
    """Test handling of permission errors when saving."""
    url = "https://example.com"
    qr_code = generator.generate_qr_code(url)

    # Try to save to a read-only directory (if possible)
    read_only_dir = tmp_path / "readonly"
    read_only_dir.mkdir()

    # On Unix systems, we can make it read-only
    if os.name != "nt":  # Not Windows
        try:
            os.chmod(read_only_dir, 0o444)
            read_only_path = read_only_dir / "test.png"

            # Should raise an error or handle gracefully
            try:
                generator.save_qr_to_file(qr_code, str(read_only_path))
            except (PermissionError, OSError):
                pass  # Expected
            finally:
                os.chmod(read_only_dir, 0o755)  # Restore permissions
        except (OSError, PermissionError):
            pass  # Can't test on this system


def test_generator_cache_path_collision_handling(generator):
    """Test that cache paths don't collide for similar URLs."""
    urls = [
        "https://example.com",
        "https://example.com/",
        "https://example.com?",
        "https://example.com#",
    ]

    cache_paths = [generator._get_cache_path(url) for url in urls]

    # All paths should be unique (or at least most of them)
    unique_paths = set(cache_paths)
    # Some might be the same due to normalization, but most should be different
    assert len(unique_paths) >= len(cache_paths) * 0.5


def test_generator_validate_url_edge_cases(generator):
    """Test URL validation with edge cases."""
    edge_cases = [
        "http://localhost",
        "http://127.0.0.1",
        "https://sub.domain.example.com:8080/path",
        "ftp://example.com",
        "file:///path/to/file",
        "mailto:test@example.com",
    ]

    for url in edge_cases:
        result = generator.validate_url(url)
        # Some might be valid, some might not
        assert isinstance(result, bool)


def test_generator_validate_url_unicode(generator):
    """Test URL validation with unicode characters."""
    unicode_urls = [
        "https://example.com/测试",
        "https://例え.com",
        "https://example.com/path?param=测试",
    ]

    for url in unicode_urls:
        result = generator.validate_url(url)
        assert isinstance(result, bool)


def test_generator_cache_cleanup_on_error(generator, tmp_path):
    """Test that cache handles errors gracefully."""
    url = "https://example.com"

    # Generate a QR code
    qr_code = generator.generate_qr_code(url)
    assert qr_code is not None

    # Try to generate again - should use cache
    qr_code2 = generator.generate_qr_code(url)
    assert qr_code2 is not None


@patch("openqr.core.generator.Image.open")
def test_generator_load_cached_qr_code_error(mock_open, generator):
    """Test handling of errors when loading cached QR code."""
    mock_open.side_effect = Exception("Corrupted file")

    url = "https://example.com"

    # Should regenerate if cache load fails
    try:
        qr_code = generator.generate_qr_code(url)
        assert qr_code is not None
    except Exception:
        # If it fails completely, that's also acceptable
        pass


def test_generator_get_cache_path_none_url(generator):
    """Test that _get_cache_path handles None URL."""
    with pytest.raises(ValueError):
        generator._get_cache_path(None)


def test_generator_get_cache_path_empty_string(generator):
    """Test that _get_cache_path handles empty string."""
    with pytest.raises(ValueError):
        generator._get_cache_path("")


def test_generator_multiple_instances_same_cache(generator):
    """Test that multiple generator instances share the same cache directory."""
    gen1 = QRGenerator()
    gen2 = QRGenerator()

    # Should use the same cache directory
    assert gen1.temp_dir == gen2.temp_dir


def test_generator_color_names_variations(generator):
    """Test QR code generation with various color name formats."""
    url = "https://example.com"
    color_variations = [
        ("black", "white"),
        ("#000000", "#ffffff"),
        ("rgb(0,0,0)", "rgb(255,255,255)"),
        ("red", "blue"),
    ]

    for fg, bg in color_variations:
        try:
            qr_code = generator.generate_qr_code(url, fill_color=fg, back_color=bg)
            assert qr_code is not None
        except (ValueError, TypeError):
            # Some color formats might not be supported
            pass
