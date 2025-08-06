# Makefile for building and managing OpenQR

# Project Settings
APP_NAME = OpenQR
APP_NAME_LOWERCASE = $(shell echo $(APP_NAME) | tr A-Z a-z)
ENTRY_POINT = main.py
ICON = assets/openqr_icon.png
VENV = venv

# Detect platform-specific paths
ifeq ($(OS),Windows_NT)
    PYTHON = $(VENV)/Scripts/python.exe
    PIP = $(VENV)/Scripts/pip.exe
    PYINSTALLER = $(VENV)/Scripts/pyinstaller.exe
    RUFF = $(VENV)/Scripts/ruff.exe
    PYTEST = $(VENV)/Scripts/pytest.exe
    ADD_DATA = $(ICON);assets
else
    PYTHON = $(VENV)/bin/python3
    PIP = $(VENV)/bin/pip
    PYINSTALLER = $(VENV)/bin/pyinstaller
    RUFF = $(VENV)/bin/ruff
    PYTEST = $(VENV)/bin/pytest
    ADD_DATA = $(ICON):assets
endif

# Default target
.PHONY: all
all: build

# Display help
.PHONY: help
help:
	@echo "Usage:"
	@echo "  make setup      - Create virtual environment and install dependencies"
	@echo "  make run        - Run the application"
	@echo "  make lint       - Lint code using ruff"
	@echo "  make format     - Format code using ruff"
	@echo "  make test       - Run unit tests"
	@echo "  make build      - Create a standalone executable with PyInstaller"
	@echo "  make dist       - Build and show dist location"
	@echo "  make clean      - Remove temp files, caches, and build artifacts"
	@echo "  make freeze     - Export requirements.txt"
	@echo "  make rebuild    - Clean and rebuild"

# Create virtual environment and install dependencies
.PHONY: setup
setup:
	python -m venv $(VENV)
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements.txt

# Run the app using the virtual environment
.PHONY: run
run:
	$(PYTHON) $(ENTRY_POINT)

# Lint source code
.PHONY: lint
lint:
	$(RUFF) check .

# Format source code
.PHONY: format
format:
	$(RUFF) format .

# Run tests
.PHONY: test
test:
	$(PYTEST) tests/

# Platform-specific build targets
.PHONY: build build-windows build-macos

build: build-windows build-macos

# Windows build
.PHONY: build-windows
build-windows: icon version
ifeq ($(OS),Windows_NT)
	$(PYINSTALLER) --noconfirm --onefile --windowed $(ENTRY_POINT) \
		--name $(APP_NAME) \
		--icon=assets/openqr_icon.ico \
		--add-data "$(ADD_DATA)" \
		--version-file version.txt
else
	@echo "Skipping Windows build: Not running on Windows."
endif



# macOS build
.PHONY: build-macos
build-macos: icon
ifeq ($(shell uname),Darwin)
	$(PYINSTALLER) OpenQR.spec
else
	@echo "Skipping macOS build: Not running on macOS."
endif


# Show build result
.PHONY: dist
dist: build
	@echo "✅ Windows Executable: ./dist/$(APP_NAME).exe"
	@echo "✅ macOS Executable:   ./dist/$(APP_NAME)"


# Clean all temp files and caches
.PHONY: clean
clean:
	@echo "🧹 Cleaning up..."
	@find . -type f -name '*.pyc' -delete || del /s *.pyc 2>nul
	@find . -type d -name '__pycache__' -exec rm -r {} + || rmdir /s /q __pycache__ 2>nul
	@rm -rf .pytest_cache .mypy_cache build dist *.spec || \
		del /s /q .pytest_cache .mypy_cache build dist *.spec 2>nul

# Freeze dependencies
.PHONY: freeze
freeze:
	$(PYTHON) -m pip freeze > requirements.txt

# Clean and rebuild
.PHONY: rebuild
rebuild: clean build

.PHONY: version
version:
	$(PYTHON) tools/generate_version_file.py

# Icon conversion (PNG to ICNS for MacOS; PNG to ICO for Windows)
.PHONY: icon
icon:
ifeq ($(shell uname),Darwin)
	@echo "Creating macOS .icns icon from $(ICON)..."
	@rm -rf assets/openqr_icon.iconset
	@mkdir -p assets/openqr_icon.iconset
	@# Generate all required icon sizes (must be PNG files)
	@sips -z 16 16     $(ICON) --out assets/openqr_icon.iconset/icon_16x16.png
	@sips -z 32 32     $(ICON) --out assets/openqr_icon.iconset/icon_16x16@2x.png
	@sips -z 32 32     $(ICON) --out assets/openqr_icon.iconset/icon_32x32.png
	@sips -z 64 64     $(ICON) --out assets/openqr_icon.iconset/icon_32x32@2x.png
	@sips -z 128 128   $(ICON) --out assets/openqr_icon.iconset/icon_128x128.png
	@sips -z 256 256   $(ICON) --out assets/openqr_icon.iconset/icon_128x128@2x.png
	@sips -z 256 256   $(ICON) --out assets/openqr_icon.iconset/icon_256x256.png
	@sips -z 512 512   $(ICON) --out assets/openqr_icon.iconset/icon_256x256@2x.png
	@sips -z 512 512   $(ICON) --out assets/openqr_icon.iconset/icon_512x512.png
	@sips -z 1024 1024 $(ICON) --out assets/openqr_icon.iconset/icon_512x512@2x.png
	@iconutil -c icns assets/openqr_icon.iconset -o assets/openqr_icon.icns
	@rm -rf assets/openqr_icon.iconset
else
	$(PYTHON) tools/convert_icon.py
endif
