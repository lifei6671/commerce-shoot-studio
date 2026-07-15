#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_CONFIG="${REPO_ROOT}/desktop/src-tauri/tauri.conf.json"
ARTIFACTS_DIR="${1:-}"
GH_BIN="${GH_BIN:-gh}"

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

[[ -n "${ARTIFACTS_DIR}" ]] || fail "缺少构建物目录。"
[[ -d "${ARTIFACTS_DIR}" ]] || fail "构建物目录不存在：${ARTIFACTS_DIR}"
[[ -f "${TAURI_CONFIG}" ]] || fail "未找到 Tauri 配置：${TAURI_CONFIG}"

for command in "${GH_BIN}" jq; do
  command -v "${command}" >/dev/null 2>&1 || fail "缺少必需命令：${command}。"
done

release_tag="${GITHUB_REF_NAME:-}"
repository="${GITHUB_REPOSITORY:-}"
[[ -n "${release_tag}" ]] || fail "GITHUB_REF_NAME 不能为空。"
[[ -n "${repository}" ]] || fail "GITHUB_REPOSITORY 不能为空。"

app_version="$(bash "${SCRIPT_DIR}/resolve-release-version.sh" "${release_tag}")"
product_name="$(jq -er '.productName | select(type == "string" and length > 0)' "${TAURI_CONFIG}")" \
  || fail "无法从 Tauri 配置读取产品名称。"

dmg_files=()
while IFS= read -r -d '' artifact; do
  dmg_files[${#dmg_files[@]}]="${artifact}"
done < <(find "${ARTIFACTS_DIR}" -type f -name '*.dmg' -print0)

exe_files=()
while IFS= read -r -d '' artifact; do
  exe_files[${#exe_files[@]}]="${artifact}"
done < <(find "${ARTIFACTS_DIR}" -type f -name '*-setup.exe' -print0)

[[ "${#dmg_files[@]}" -eq 2 ]] \
  || fail "Release 必须包含 2 个 macOS DMG，实际找到 ${#dmg_files[@]} 个。"
[[ "${#exe_files[@]}" -eq 2 ]] \
  || fail "Release 必须包含 2 个 Windows NSIS 安装包，实际找到 ${#exe_files[@]} 个。"

macos_arm64_count=0
macos_x64_count=0
for asset in "${dmg_files[@]}"; do
  case "$(basename "${asset}")" in
    *_aarch64.dmg|*_arm64.dmg)
      macos_arm64_count=$((macos_arm64_count + 1))
      ;;
    *_x64.dmg|*_x86_64.dmg|*_amd64.dmg)
      macos_x64_count=$((macos_x64_count + 1))
      ;;
    *)
      fail "无法从 DMG 文件名识别目标架构：$(basename "${asset}")。"
      ;;
  esac
done
[[ "${macos_arm64_count}" -eq 1 && "${macos_x64_count}" -eq 1 ]] \
  || fail "macOS Release 必须各包含 1 个 ARM64 与 x64 DMG。"

windows_arm64_count=0
windows_x64_count=0
for asset in "${exe_files[@]}"; do
  case "$(basename "${asset}")" in
    *_arm64-setup.exe|*_aarch64-setup.exe)
      windows_arm64_count=$((windows_arm64_count + 1))
      ;;
    *_x64-setup.exe|*_x86_64-setup.exe|*_amd64-setup.exe)
      windows_x64_count=$((windows_x64_count + 1))
      ;;
    *)
      fail "无法从 NSIS 文件名识别目标架构：$(basename "${asset}")。"
      ;;
  esac
done
[[ "${windows_arm64_count}" -eq 1 && "${windows_x64_count}" -eq 1 ]] \
  || fail "Windows Release 必须各包含 1 个 ARM64 与 x64 NSIS 安装包。"

release_assets=("${dmg_files[@]}" "${exe_files[@]}")
for ((asset_index = 0; asset_index < ${#release_assets[@]}; asset_index++)); do
  asset="${release_assets[${asset_index}]}"
  asset_name="$(basename "${asset}")"
  for ((other_index = asset_index + 1; other_index < ${#release_assets[@]}; other_index++)); do
    [[ "${asset_name}" != "$(basename "${release_assets[${other_index}]}")" ]] \
      || fail "构建物存在重复文件名：${asset_name}。"
  done
done

verify_release_assets() {
  local release_json="$1"
  local asset asset_name

  [[ "$(jq '.assets | length' <<<"${release_json}")" -eq "${#release_assets[@]}" ]] \
    || fail "Release ${release_tag} 的资产集合不是预期的 4 个安装包。"

  for asset in "${release_assets[@]}"; do
    asset_name="$(basename "${asset}")"
    jq -e --arg name "${asset_name}" 'any(.assets[]?; .name == $name)' \
      <<<"${release_json}" >/dev/null \
      || fail "Release ${release_tag} 缺少构建物：${asset_name}。"
  done
}

release_json=""
if release_json="$("${GH_BIN}" release view "${release_tag}" \
  --repo "${repository}" --json isDraft,assets 2>/dev/null)"; then
  if [[ "$(jq -r '.isDraft' <<<"${release_json}")" != "true" ]]; then
    verify_release_assets "${release_json}"
    printf 'Release %s 已发布且构建物完整，无需重复上传。\n' "${release_tag}"
    exit 0
  fi
else
  create_args=(
    release create "${release_tag}"
    --repo "${repository}"
    --verify-tag
    --draft
    --generate-notes
    --title "${product_name} ${app_version}"
    --notes "本版本提供未签名的 macOS 与 Windows 安装包。安装前请确认构建来源；macOS 产物尚未完成 Apple 公证，Windows 产物尚未使用 Authenticode 签名。"
  )
  if [[ "${app_version}" == *-* ]]; then
    create_args+=(--prerelease --latest=false)
  fi
  "${GH_BIN}" "${create_args[@]}"
fi

"${GH_BIN}" release upload "${release_tag}" "${release_assets[@]}" \
  --repo "${repository}" --clobber

release_json="$("${GH_BIN}" release view "${release_tag}" \
  --repo "${repository}" --json isDraft,assets)"
[[ "$(jq -r '.isDraft' <<<"${release_json}")" == "true" ]] \
  || fail "Release ${release_tag} 在上传期间已不再是 Draft，已停止自动发布。"
verify_release_assets "${release_json}"

"${GH_BIN}" release edit "${release_tag}" --repo "${repository}" --draft=false
printf 'Release %s 已创建并上传 %s 个安装包。\n' "${release_tag}" "${#release_assets[@]}"
