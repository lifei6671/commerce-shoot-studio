SHELL := /bin/bash

DESKTOP_DIR := desktop
TAURI_DIR := $(DESKTOP_DIR)/src-tauri
NPM ?= npm
CARGO ?= $(HOME)/.cargo/bin/cargo

.PHONY: help install dev build tauri-build tauri-dmg desktop-build cargo-check check clean

help:
	@echo "Commerce Shoot Studio"
	@echo ""
	@echo "Targets:"
	@echo "  make install        Install desktop npm dependencies"
	@echo "  make dev            Start Tauri desktop app in development mode"
	@echo "  make build          Build Tauri desktop app bundle"
	@echo "  make tauri-build    Build Tauri desktop app bundle"
	@echo "  make tauri-dmg      Build Tauri desktop app and DMG"
	@echo "  make desktop-build  Build React frontend only"
	@echo "  make cargo-check    Run Rust cargo check for Tauri app"
	@echo "  make check          Run frontend build and Rust cargo check"
	@echo "  make clean          Remove generated desktop build outputs"

install:
	$(NPM) --prefix $(DESKTOP_DIR) install

dev:
	$(NPM) --prefix $(DESKTOP_DIR) run tauri -- dev

build: tauri-build

tauri-build:
	$(NPM) --prefix $(DESKTOP_DIR) run tauri -- build --bundles app

tauri-dmg:
	$(NPM) --prefix $(DESKTOP_DIR) run tauri -- build

desktop-build:
	$(NPM) --prefix $(DESKTOP_DIR) run build

cargo-check:
	cd $(TAURI_DIR) && $(CARGO) check

check: desktop-build cargo-check

clean:
	rm -rf $(DESKTOP_DIR)/dist $(TAURI_DIR)/target
