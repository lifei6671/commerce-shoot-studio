#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
VERSION_SCRIPT="${REPO_ROOT}/build/resolve-release-version.sh"

fail() {
  printf '测试失败：%s\n' "$*" >&2
  exit 1
}

[[ "$(bash "${VERSION_SCRIPT}" 'v1.2.3')" == "1.2.3" ]] \
  || fail "无法解析稳定版标签。"
[[ "$(bash "${VERSION_SCRIPT}" 'v2.0.0-beta.1+build.5')" == "2.0.0-beta.1+build.5" ]] \
  || fail "无法解析预发布标签。"

for invalid_tag in '' '1.2.3' 'release-v1.2.3' 'v1.2' 'v01.2.3'; do
  if bash "${VERSION_SCRIPT}" "${invalid_tag}" >/dev/null 2>&1; then
    fail "非法标签仍被接受：${invalid_tag:-<空>}"
  fi
done

printf '发布标签版本解析测试通过。\n'
