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

# Build the app using PyInstaller
.PHONY: build
build:
ifeq ($(OS),Windows_NT)
	$(PYINSTALLER) --noconfirm --onefile --windowed $(ENTRY_POINT) \
		--name $(APP_NAME) \
		--icon=assets/openqr_icon.png \
		--add-data "$(ADD_DATA)" \
		--version-file version.txt
else
	$(PYINSTALLER) --noconfirm --onefile --windowed $(ENTRY_POINT) \
		--name $(APP_NAME) \
		--icon=$(ICON) \
		--add-data "$(ADD_DATA)"
endif

# Show build result
.PHONY: dist
dist: build
	@echo "✅ Executable available at: ./dist/$(APP_NAME)"

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
