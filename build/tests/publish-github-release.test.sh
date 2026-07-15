#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
PUBLISH_SCRIPT="${REPO_ROOT}/build/publish-github-release.sh"
VERSION_SCRIPT="${REPO_ROOT}/build/resolve-release-version.sh"
WORKFLOW_FILE="${REPO_ROOT}/.github/workflows/package-desktop.yml"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
  printf '测试失败：%s\n' "$*" >&2
  exit 1
}

ARTIFACTS_DIR="${TMP_DIR}/release artifacts"
FAKE_BIN_DIR="${TMP_DIR}/bin"
FAKE_GH_STATE="${TMP_DIR}/gh-state"
FAKE_GH_LOG="${TMP_DIR}/gh.log"
CONFIG_VERSION="$(jq -r '.version' "${REPO_ROOT}/desktop/src-tauri/tauri.conf.json")"
APP_VERSION="9.8.7-beta.1+build.5"
RELEASE_TAG="v${APP_VERSION}"
RELEASE_ASSET_VERSION="${APP_VERSION//+/_}"
EXPECTED_RELEASE_ASSETS=(
  "commerce-shoot-studio_${RELEASE_ASSET_VERSION}_macos_arm64.dmg"
  "commerce-shoot-studio_${RELEASE_ASSET_VERSION}_macos_x64.dmg"
  "commerce-shoot-studio_${RELEASE_ASSET_VERSION}_windows_arm64-setup.exe"
  "commerce-shoot-studio_${RELEASE_ASSET_VERSION}_windows_x64-setup.exe"
)
mkdir -p "${ARTIFACTS_DIR}" "${FAKE_BIN_DIR}" "${FAKE_GH_STATE}"
touch \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_aarch64.dmg" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64.dmg" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_arm64-setup.exe" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64-setup.exe"

cat >"${FAKE_BIN_DIR}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%q ' "$@" >>"${FAKE_GH_LOG}"
printf '\n' >>"${FAKE_GH_LOG}"

case "${1:-} ${2:-}" in
  "release view")
    [[ -f "${FAKE_GH_STATE}/status" ]] || exit 1
    is_draft=false
    [[ "$(<"${FAKE_GH_STATE}/status")" == "draft" ]] && is_draft=true
    jq -Rn --argjson isDraft "${is_draft}" \
      '[inputs | select(length > 0) | {name: .}] as $assets | {isDraft: $isDraft, assets: $assets}' \
      <"${FAKE_GH_STATE}/assets"
    ;;
  "release create")
    printf 'draft' >"${FAKE_GH_STATE}/status"
    : >"${FAKE_GH_STATE}/assets"
    ;;
  "release upload")
    shift 3
    while (($# > 0)); do
      case "$1" in
        --repo)
          shift 2
          ;;
        --clobber)
          shift
          ;;
        *)
          asset_name="$(basename "$1")"
          awk -v name="${asset_name}" '$0 != name' \
            "${FAKE_GH_STATE}/assets" >"${FAKE_GH_STATE}/assets.next"
          mv "${FAKE_GH_STATE}/assets.next" "${FAKE_GH_STATE}/assets"
          printf '%s\n' "${asset_name}" >>"${FAKE_GH_STATE}/assets"
          shift
          ;;
      esac
    done
    ;;
  "release edit")
    printf 'published' >"${FAKE_GH_STATE}/status"
    ;;
  *)
    printf '不支持的 gh 调用：%s %s\n' "${1:-}" "${2:-}" >&2
    exit 1
    ;;
esac
EOF
chmod +x "${FAKE_BIN_DIR}/gh"

[[ "$(bash "${VERSION_SCRIPT}" "${RELEASE_TAG}")" == "${APP_VERSION}" ]] \
  || fail "无法从稳定版标签解析应用版本。"
[[ "$(bash "${VERSION_SCRIPT}" 'v2.0.0-beta.1+build.5')" == "2.0.0-beta.1+build.5" ]] \
  || fail "无法从预发布标签解析应用版本。"
if bash "${VERSION_SCRIPT}" "release-${APP_VERSION}" >/dev/null 2>&1; then
  fail "非法发布标签仍然被解析为应用版本。"
fi

grep -q 'resolve-release-version.sh' "${WORKFLOW_FILE}" \
  || fail "构建 workflow 未从标签解析应用版本。"
grep -q -- '--config ../build/tauri-ci-version.json' "${WORKFLOW_FILE}" \
  || fail "构建 workflow 未向 Tauri 传递标签版本覆盖配置。"

run_publish() {
  PATH="${FAKE_BIN_DIR}:${PATH}" \
    GH_BIN=gh \
    FAKE_GH_STATE="${FAKE_GH_STATE}" \
    FAKE_GH_LOG="${FAKE_GH_LOG}" \
    GITHUB_REF_NAME="${RELEASE_TAG}" \
    GITHUB_REPOSITORY=lifei6671/commerce-shoot-studio \
    "${PUBLISH_SCRIPT}" "${ARTIFACTS_DIR}"
}

run_publish
[[ "$(<"${FAKE_GH_STATE}/status")" == "published" ]] || fail "新 Release 未发布。"
[[ "$(wc -l <"${FAKE_GH_STATE}/assets" | tr -d ' ')" == "4" ]] \
  || fail "新 Release 未上传四个安装包。"
for expected_asset in "${EXPECTED_RELEASE_ASSETS[@]}"; do
  grep -Fxq "${expected_asset}" "${FAKE_GH_STATE}/assets" \
    || fail "Release 缺少规范化后的构建物：${expected_asset}。"
done
if grep -q '商拍工坊' "${FAKE_GH_STATE}/assets"; then
  fail "Release 仍然使用会被 GitHub 改写的中文构建物名称。"
fi
if grep -q '+' "${FAKE_GH_STATE}/assets"; then
  fail "Release 仍然使用会被 GitHub 改写的构建元数据分隔符。"
fi
grep -q 'release create' "${FAKE_GH_LOG}" || fail "未创建 Draft Release。"
grep -q 'release upload' "${FAKE_GH_LOG}" || fail "未上传构建物。"
grep -q 'release edit' "${FAKE_GH_LOG}" || fail "未发布 Draft Release。"
release_create_log="$(grep 'release create' "${FAKE_GH_LOG}" | head -n 1)"
[[ "${release_create_log}" == *"${APP_VERSION}"* ]] \
  || fail "Release 标题未使用标签版本。"
[[ "${release_create_log}" != *"${CONFIG_VERSION}"* ]] \
  || fail "Release 标题仍然使用 Tauri 配置版本。"

log_lines_before="$(wc -l <"${FAKE_GH_LOG}" | tr -d ' ')"
run_publish
log_lines_after="$(wc -l <"${FAKE_GH_LOG}" | tr -d ' ')"
[[ "$((log_lines_after - log_lines_before))" -eq 1 ]] \
  || fail "重跑已发布 Release 时执行了多余写操作。"

cp "${FAKE_GH_STATE}/assets" "${FAKE_GH_STATE}/assets.complete"
printf 'legacy-installer.msi\n' >>"${FAKE_GH_STATE}/assets"
if run_publish >/dev/null 2>&1; then
  fail "已发布 Release 包含额外构建物时仍然报告成功。"
fi
cp "${FAKE_GH_STATE}/assets.complete" "${FAKE_GH_STATE}/assets"

sed '$d' "${FAKE_GH_STATE}/assets.complete" >"${FAKE_GH_STATE}/assets"
if run_publish >/dev/null 2>&1; then
  fail "已发布 Release 缺少构建物时仍然报告成功。"
fi
cp "${FAKE_GH_STATE}/assets.complete" "${FAKE_GH_STATE}/assets"

printf 'draft' >"${FAKE_GH_STATE}/status"
printf 'legacy-installer.msi\n' >>"${FAKE_GH_STATE}/assets"
if run_publish >/dev/null 2>&1; then
  fail "Draft 包含额外构建物时仍然被公开。"
fi
[[ "$(<"${FAKE_GH_STATE}/status")" == "draft" ]] \
  || fail "包含额外构建物的 Draft 状态被修改。"
printf 'published' >"${FAKE_GH_STATE}/status"
mv "${FAKE_GH_STATE}/assets.complete" "${FAKE_GH_STATE}/assets"

if PATH="${FAKE_BIN_DIR}:${PATH}" \
  GH_BIN=gh \
  FAKE_GH_STATE="${FAKE_GH_STATE}" \
  FAKE_GH_LOG="${FAKE_GH_LOG}" \
  GITHUB_REF_NAME="release-${APP_VERSION}" \
  GITHUB_REPOSITORY=lifei6671/commerce-shoot-studio \
  "${PUBLISH_SCRIPT}" "${ARTIFACTS_DIR}" >/dev/null 2>&1; then
  fail "非法发布标签仍然继续发布。"
fi

mv \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64.dmg" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_arm64.dmg"
mv \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64-setup.exe" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_aarch64-setup.exe"
if PATH="${FAKE_BIN_DIR}:${PATH}" \
  GH_BIN=gh \
  FAKE_GH_STATE="${FAKE_GH_STATE}" \
  FAKE_GH_LOG="${FAKE_GH_LOG}" \
  GITHUB_REF_NAME="v${APP_VERSION}" \
  GITHUB_REPOSITORY=lifei6671/commerce-shoot-studio \
  "${PUBLISH_SCRIPT}" "${ARTIFACTS_DIR}" >/dev/null 2>&1; then
  fail "缺少 x64 架构安装包时仍然继续发布。"
fi
mv \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_arm64.dmg" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64.dmg"
mv \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_aarch64-setup.exe" \
  "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64-setup.exe"

rm "${ARTIFACTS_DIR}/商拍工坊_${APP_VERSION}_x64.dmg"
if PATH="${FAKE_BIN_DIR}:${PATH}" \
  GH_BIN=gh \
  FAKE_GH_STATE="${FAKE_GH_STATE}" \
  FAKE_GH_LOG="${FAKE_GH_LOG}" \
  GITHUB_REF_NAME="v${APP_VERSION}" \
  GITHUB_REPOSITORY=lifei6671/commerce-shoot-studio \
  "${PUBLISH_SCRIPT}" "${ARTIFACTS_DIR}" >/dev/null 2>&1; then
  fail "缺少安装包时仍然继续发布。"
fi

printf 'GitHub Release 发布脚本测试通过。\n'
