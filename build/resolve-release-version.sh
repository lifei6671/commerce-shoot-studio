#!/usr/bin/env bash

set -euo pipefail

release_tag="${1:-${GITHUB_REF_NAME:-}}"
semver_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

if [[ ! "${release_tag}" =~ ${semver_pattern} ]]; then
  printf '错误：发布标签必须符合 vMAJOR.MINOR.PATCH 格式：%s\n' \
    "${release_tag:-<空>}" >&2
  exit 1
fi

printf '%s\n' "${release_tag#v}"
