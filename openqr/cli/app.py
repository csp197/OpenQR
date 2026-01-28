import typer
from pathlib import Path

from openqr.core.generator import QRGenerator
from openqr.core.listener import QRListener

# Try to import QRScanner, but handle case where zbar is not available
try:
    from openqr.core.scanner import QRScanner
    SCANNER_AVAILABLE = True
except ImportError:
    SCANNER_AVAILABLE = False
    QRScanner = None


class OpenQRCliTool:
    def __init__(self):
        self.qr_code_generator = QRGenerator()
        if SCANNER_AVAILABLE:
            self.qr_code_scanner = QRScanner()
        else:
            self.qr_code_scanner = None
        self.qr_code_listener = QRListener()


cli = OpenQRCliTool()
app = typer.Typer(help="OpenQR CLI tool")


@app.command()
def make(url: str = typer.Argument(..., help="")):
    """"""
    cli.qr_code_generator.generate_qr_code(url)
    pass


@app.command()
def listen():
    """"""
    # cli.qr_code_listener.
    pass


@app.command()
def scan(file: Path = typer.Argument(..., help="")):
    """"""
    if not SCANNER_AVAILABLE or cli.qr_code_scanner is None:
        typer.echo("Error: QR scanner functionality requires zbar library. Please install zbar.", err=True)
        raise typer.Exit(1)
    cli.qr_code_scanner.scan_from_image(file)
    return
