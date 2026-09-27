#!/usr/bin/env bash
# Publish the package in the current directory to npm if its version is not there yet,
# then create a GitHub Release for it. Called by the `publish` job in ci.yml, once per
# package, from `packages/<package>` — mcp-server first, then cli.
#
# Usage: publish-if-new.sh <release-tag-prefix>     (e.g. `cli` → tag `cli-v1.2.3`)
#
# Exit code: 0 when the version is on npm afterwards (published now, or already there);
# non-zero when publishing failed — the workflow then stops before the next package.
#
# Requires GH_TOKEN (GitHub Release) and an OIDC-capable npm (trusted publishing +
# provenance; Node 24 / npm 11). No NPM_TOKEN is used.
set -euo pipefail

TAG_PREFIX="${1:?usage: publish-if-new.sh <release-tag-prefix>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
CHANNEL=$(node --input-type=module -e "import { releaseChannel } from '$ROOT/scripts/release-channel.mjs'; console.log(releaseChannel(process.argv[1]))" "$VERSION")
TAG="$TAG_PREFIX-v$VERSION"
RELEASE_FLAGS=()
if [ "$CHANNEL" != "latest" ]; then RELEASE_FLAGS+=(--prerelease); fi

on_npm() {
  # --prefer-online 으로 캐시를 우회한다 — 방금 올린 버전도 바로 보이게.
  npm view "$NAME@$VERSION" version --prefer-online >/dev/null 2>&1
}

github_release() {
  # 실패해도 publish 는 이미 끝났으므로 비치명적 처리. 이미 존재하면 gh 가 실패하고 || 가 삼킨다.
  gh release create "$TAG" --target "$GITHUB_SHA" --title "$NAME $VERSION" --generate-notes "${RELEASE_FLAGS[@]}" \
    || echo "⚠ GitHub Release 생성 실패/이미 존재 ($TAG) — 무시 (publish 는 성공)"
}

# 빠른 경로: 이미 있으면 publish 시도 자체를 생략 (idempotent — 버전 안 바꾼 푸시는 no-op).
if on_npm; then
  echo "• $NAME@$VERSION 이미 npm 에 존재 — skip"
  exit 0
fi

# publish 는 최대 3회 시도. 실패 판정은 에러 메시지 문자열 grep 이 아니라
# "레지스트리에 실제로 올라갔는가"(npm view 재확인)로 한다 — 409 packument
# 경합("Failed to save packument"), OIDC 일시 오류(IDENTITY_TOKEN_READ_ERROR),
# 어느 쪽이든 메시지 포맷과 무관하게 안전. (둘 다 2026-07 실사고.)
for attempt in 1 2 3; do
  echo "→ publishing $NAME@$VERSION (attempt $attempt, dist-tag $CHANNEL)"
  if npm publish --access public --provenance --tag "$CHANNEL"; then
    echo "✓ published $NAME@$VERSION (provenance 서명됨)"
    github_release
    exit 0
  fi
  sleep 15
  if on_npm; then
    # 부분 성공(publish 는 됐는데 응답만 실패) 케이스에도 Release 는 남긴다.
    echo "• $NAME@$VERSION 레지스트리에 이미 존재 (경합/부분 성공) — publish no-op"
    github_release
    exit 0
  fi
done

echo "❌ $NAME@$VERSION publish 3회 실패"
exit 1
