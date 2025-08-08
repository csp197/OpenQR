from openqr.generator.generator import QRCodeGenerator
import pytest


@pytest.fixture
def generator():
    return QRCodeGenerator()


@pytest.mark.parametrize(
    "url",
    [
        "https://www.example.com",
        "http://www.example.com",
        "https://sub.domain.com/path",
        "https://domain.com/path?param1=value1&param2=value2",
    ],
)
def test_valid_urls(generator, url):
    assert generator.validate_url(url) is True


# @pytest.mark.parametrize(
#     "invalid_url",
#     ["", "totally not a url", "http:/www.example.com", "https://wwwexamplecom"],
# )
# def test_invalid_urls(generator, invalid_url):
#     assert generator.validate_url(invalid_url) is False


@pytest.mark.parametrize(
    "url,should_pass",
    [
        ("https://www.example.com", True),
        ("http://www.example.com", True),
        ("not even trying to be a url", False),
        ("", False),
    ],
)
def test_qr_code_creation(generator, url, should_pass):
    if should_pass:
        qr_code = generator.generate_qr_code(url)
        assert qr_code is not None

        from PIL import Image

        assert isinstance(qr_code, Image.Image)
    else:
        with pytest.raises(ValueError):
            generator.generate_qr_code(url)


@pytest.mark.parametrize("url", ["https://www.example.com", "http://www.example.com"])
def test_qr_code_format(generator, url):
    pass


def test_error_handling_invalid_input(generator):
    pass


def test_save_qr_code_as_file(generator):
    pass


def test_file_naming(generator):
    pass


def test_error_handling_file_operations(generator):
    pass


def test_qr_code_to_clipboard(generator):
    pass


def test_qr_code_clipboard_format(generator):
    pass
