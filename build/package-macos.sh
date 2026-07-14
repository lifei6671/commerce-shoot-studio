#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${REPO_ROOT}/desktop"

ARCH=""
BUNDLE="all"
SKIP_INSTALL=false

usage() {
  cat <<'EOF'
用法：build/package-macos.sh [选项]

为 macOS 指定架构构建未签名的 Tauri 安装产物。

选项：
  --arch <arm64|x64|all>  目标架构；默认使用当前 Mac 架构
  --bundle <app|dmg|all>  产物类型；默认 all（app 和 dmg）
  --skip-install          跳过 npm ci --prefix desktop
  --help                  显示帮助

示例：
  build/package-macos.sh
  build/package-macos.sh --arch all --bundle dmg
  build/package-macos.sh --arch x64 --skip-install
EOF
}

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "${value}" && "${value}" != --* ]] || fail "${option} 缺少参数。"
}

while (($# > 0)); do
  case "$1" in
    --arch)
      require_value "$1" "${2:-}"
      ARCH="$2"
      shift 2
      ;;
    --bundle)
      require_value "$1" "${2:-}"
      BUNDLE="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "未知参数：$1。使用 --help 查看支持的选项。"
      ;;
  esac
done

if [[ -z "${ARCH}" ]]; then
  case "$(uname -m)" in
    arm64|aarch64)
      ARCH="arm64"
      ;;
    x86_64|amd64)
      ARCH="x64"
      ;;
    *)
      fail "无法识别当前 Mac 架构：$(uname -m)。请显式传入 --arch arm64、x64 或 all。"
      ;;
  esac
fi

case "${ARCH}" in
  arm64)
    TARGETS=("aarch64-apple-darwin")
    ;;
  x64)
    TARGETS=("x86_64-apple-darwin")
    ;;
  all)
    TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin")
    ;;
  *)
    fail "不支持的架构：${ARCH}。可选值为 arm64、x64、all。"
    ;;
esac

case "${BUNDLE}" in
  app)
    BUNDLES="${BUNDLE}"
    BUNDLE_DIR_NAMES=("macos")
    ;;
  dmg)
    BUNDLES="${BUNDLE}"
    BUNDLE_DIR_NAMES=("dmg")
    ;;
  all)
    BUNDLES="app,dmg"
    BUNDLE_DIR_NAMES=("macos" "dmg")
    ;;
  *)
    fail "不支持的 bundle：${BUNDLE}。可选值为 app、dmg、all。"
    ;;
esac

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS 打包脚本只能在 Darwin 主机上运行。"

for command in node npm cargo rustup xcrun hdiutil; do
  command -v "${command}" >/dev/null 2>&1 || fail "缺少必需命令：${command}。"
done

xcrun --find clang >/dev/null 2>&1 || fail "Xcode Command Line Tools 不可用。请先执行 xcode-select --install 并确认开发者目录有效。"
xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1 || fail "无法读取 macOS SDK。请检查 Xcode Command Line Tools 和 xcode-select 配置。"

[[ -f "${DESKTOP_DIR}/package.json" ]] || fail "未找到 desktop/package.json，请从有效仓库副本运行脚本。"
[[ -f "${DESKTOP_DIR}/src-tauri/Cargo.toml" ]] || fail "未找到 desktop/src-tauri/Cargo.toml。"

INSTALLED_TARGETS="$(rustup target list --installed)"
for target in "${TARGETS[@]}"; do
  if ! grep -Fxq "${target}" <<<"${INSTALLED_TARGETS}"; then
    fail "Rust target ${target} 未安装。请先手动执行：rustup target add ${target}"
  fi
done

if [[ "${SKIP_INSTALL}" == false ]]; then
  printf '安装 desktop 前端依赖：npm ci --prefix desktop\n'
  npm ci --prefix "${DESKTOP_DIR}"
fi

for target in "${TARGETS[@]}"; do
  bundle_dir="${DESKTOP_DIR}/src-tauri/target/${target}/release/bundle"
  for bundle_dir_name in "${BUNDLE_DIR_NAMES[@]}"; do
    rm -rf -- "${bundle_dir:?}/${bundle_dir_name}"
  done

  printf '\n开始构建 macOS target：%s（bundle: %s）\n' "${target}" "${BUNDLES}"
  npm --prefix "${DESKTOP_DIR}" run tauri -- build \
    --target "${target}" \
    --bundles "${BUNDLES}" \
    --ci \
    --no-sign

  [[ -d "${bundle_dir}" ]] || fail "构建已结束，但未找到 bundle 目录：${bundle_dir}"

  printf '已生成 %s bundle：\n' "${target}"
  for bundle_dir_name in "${BUNDLE_DIR_NAMES[@]}"; do
    bundle_found=false
    if [[ "${bundle_dir_name}" == "macos" ]]; then
      while IFS= read -r bundle_path; do
        bundle_found=true
        printf '  %s\n' "${bundle_path#"${REPO_ROOT}/"}"
      done < <(find "${bundle_dir}/macos" -mindepth 1 -maxdepth 1 -type d -name '*.app' -print 2>/dev/null | sort)
    else
      while IFS= read -r bundle_path; do
        bundle_found=true
        printf '  %s\n' "${bundle_path#"${REPO_ROOT}/"}"
      done < <(find "${bundle_dir}/dmg" -mindepth 1 -maxdepth 1 -type f -name '*.dmg' -print 2>/dev/null | sort)
    fi

    [[ "${bundle_found}" == true ]] || fail "未找到本轮生成的 ${bundle_dir_name} 产物：${bundle_dir}/${bundle_dir_name}"
  done
done

printf '\nmacOS 打包完成。\n'
