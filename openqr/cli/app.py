import typer
from pathlib import Path

from openqr.core.generator import QRGenerator
from openqr.core.listener import QRListener
from openqr.core.scanner import QRScanner


class OpenQRCliTool:
    def __init__(self):
        self.qr_code_generator = QRGenerator()
        self.qr_code_scanner = QRScanner()
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
    cli.qr_code_scanner.scan_from_image(file)
    return
