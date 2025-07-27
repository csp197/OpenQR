# OpenQR - QR Code Listener & URL Opener

A PyQt5 application for listening to QR code scans and automatically opening URLs.

## Features

- Toggle QR code listening on/off
- Automatically open scanned URLs in default browser
- Support for Netum NSA5 QR code scanner
- Simple and clean PyQt5 interface
- Real-time status display

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/openqr.git
cd openqr
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

Run the application:
```bash
python openqr/app.py
```

Click the "Start Listening" button to begin detecting QR codes. When a URL is scanned, it will automatically open in your default browser.

## Development

This project uses Test-Driven Development (TDD) with pytest.

Run tests:
```bash
pytest
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
