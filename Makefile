APP_NAME = OpenQR
ENTRY_POINT = main.py
ICON = assets/openqr_icon.png

VENV = .venv
PYTHON_VERSION = 3.13
UV_CMD = uv

HAVE_UV := $(shell command -v $(UV_CMD) 2> /dev/null)

ifeq ($(OS),Windows_NT)
    PYTHON = $(VENV)/Scripts/python.exe
    UV = $(VENV)/Scripts/uv.exe
    PYINSTALLER = $(VENV)/Scripts/pyinstaller.exe
    RUFF = $(VENV)/Scripts/ruff.exe
    PYTEST = $(VENV)/Scripts/pytest.exe
    ADD_DATA = $(ICON);assets
    CLEAN_CMD = if exist build rmdir /s /q build && \
                if exist dist rmdir /s /q dist && \
                if exist $(VENV) rmdir /s /q $(VENV) && \
                if exist .uv_cache rmdir /s /q .uv_cache && \
                for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d"
else
    PYTHON = $(VENV)/bin/python3
    UV = $(VENV)/bin/uv
    PYINSTALLER = $(VENV)/bin/pyinstaller
    RUFF = $(VENV)/bin/ruff
    PYTEST = $(VENV)/bin/pytest
    ADD_DATA = $(ICON):assets
    CLEAN_CMD = rm -rf .pytest_cache .mypy_cache .uv_cache build dist *.spec $(VENV) version.txt && \
                find . -type d -name "__pycache__" -exec rm -rf {} + && \
                find . -type f -name "*.py[co]" -delete
endif

.PHONY: all
all: build


# --------------------
# Setup & Maintenance
# --------------------
.PHONY: install-uv
install-uv:
ifndef HAVE_UV
	@echo "uv not found. Installing..."
ifeq ($(OS),Windows_NT)
	@powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
else
	@curl -LsSf https://astral.sh/uv/install.sh | sh
endif
else
	@echo "uv already installed"
endif

.PHONY: setup
setup: install-uv
	@$(UV_CMD) python install $(PYTHON_VERSION)
	@test -d $(VENV) || $(UV_CMD) venv --python $(PYTHON_VERSION) $(VENV)
	$(UV_CMD) sync --frozen

.PHONY: doctor
doctor:
	@$(UV_CMD) --version
	@$(PYTHON) --version
	@test -f pyproject.toml || (echo "pyproject.toml missing" && exit 1)
	@echo "Environment looks good."

# --------------------
# Development
# --------------------
.PHONY: run
run: setup
	$(PYTHON) $(ENTRY_POINT)

.PHONY: lint
lint: setup
	$(RUFF) check .

.PHONY: format
format: setup
	$(RUFF) format .

.PHONY: test
test: setup
	$(PYTEST) tests/

# --------------------
# Build
# --------------------
.PHONY: build
build: setup version-file
ifeq ($(OS),Windows_NT)
	$(PYINSTALLER) --noconfirm --onefile --windowed $(ENTRY_POINT) \
		--name $(APP_NAME) \
		--icon=$(ICON) \
		--add-data "$(ADD_DATA)" \
		--version-file version.txt
else
	$(PYINSTALLER) --noconfirm --onefile --windowed $(ENTRY_POINT) \
		--name $(APP_NAME) \
		--icon=$(ICON) \
		--add-data "$(ADD_DATA)"
endif

.PHONY: clean
clean:
	@echo "cleaning..."
	@$(CLEAN_CMD)

.PHONY: freeze
freeze: setup
	$(UV_CMD) export --format requirements > requirements.txt

# Ensure version is clean (e.g., 1.2.3 instead of v1.2.3)
CLEAN_VERSION := $(shell echo $(VERSION) | sed 's/^v//')
# Create comma version for Windows FixedFileInfo (e.g., 1,2,3,0)
# VERSION_COMMA := $(shell echo $(CLEAN_VERSION) | sed 's/\./,/g'),0

.PHONY: version-file
version-file:
	@echo "Interpolating version $(CLEAN_VERSION) into version.txt"
ifeq ($(OS),Windows_NT)
	@sed -e "s/\$${VERSION}/$(CLEAN_VERSION)/g" \
	     -e "s/\$${VERSION}/$(VERSION)/g" \
	     version.txt.template > version.txt
else
	@sed -e "s/\$${VERSION}/$(CLEAN_VERSION)/g" \
	     -e "s/\$${VERSION}/$(VERSION)/g" \
	     version.txt.template > version.txt
endif