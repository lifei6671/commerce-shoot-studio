SHELL := /bin/bash

DESKTOP_DIR := desktop
NPM := npm --prefix $(DESKTOP_DIR)
CARGO_MANIFEST := $(DESKTOP_DIR)/src-tauri/Cargo.toml

.PHONY: help install dev build package check test frontend-build cargo-check audit clean

help:
	@echo "商拍工坊常用命令"
	@echo ""
	@echo "  make install        安装 desktop 前端依赖"
	@echo "  make dev            一键启动 Tauri 桌面开发环境"
	@echo "  make build          一键编译桌面端可执行文件（不打包安装包）"
	@echo "  make package        一键打包桌面端安装产物"
	@echo "  make check          运行测试、前端构建、Rust 检查和 npm audit"
	@echo "  make test           运行前端测试"
	@echo "  make frontend-build 只构建前端产物"
	@echo "  make cargo-check    只检查 Tauri Rust 工程"
	@echo "  make audit          检查 npm 高危依赖漏洞"
	@echo "  make clean          清理前端和 Tauri 构建产物"

install:
	$(NPM) install

dev:
	COMMERCE_SHOOT_STUDIO_DEBUG_PROMPTS=1 AppleLanguages='(zh-Hans, en)' LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 $(NPM) run tauri -- dev -- -- -AppleLanguages '(zh-Hans, en)'

build:
	$(NPM) run tauri -- build --no-bundle

package:
	$(NPM) run tauri -- build

check: test frontend-build cargo-check audit

test:
	$(NPM) run test

frontend-build:
	$(NPM) run build

cargo-check:
	cargo check --manifest-path $(CARGO_MANIFEST)

audit:
	cd $(DESKTOP_DIR) && npm audit --audit-level=high

clean:
	rm -rf $(DESKTOP_DIR)/dist
	rm -rf $(DESKTOP_DIR)/src-tauri/target
