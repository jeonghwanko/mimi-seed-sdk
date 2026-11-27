#!/usr/bin/env bash
# Publish the package in the current directory if its version is new, verify that it
# installs from npm, then create a GitHub Release for it. Called by the `publish` job in ci.yml, once per
# package, from `packages/<package>` — mcp-server first, then cli.
#
# Usage: publish-if-new.sh <release-tag-prefix>     (e.g. `cli` → tag `cli-v1.2.3`)
#
# Exit code: 0 when the exact npm version installs and its executable starts.
# Any publish or verification failure stops the workflow before the next package.
#
# Requires GH_TOKEN (GitHub Release) and an OIDC-capable npm (trusted publishing +
# provenance; Node 24 / npm 11). No NPM_TOKEN is used.
set -euo pipefail

TAG_PREFIX="${1:?usage: publish-if-new.sh <release-tag-prefix>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
CHANNEL=$(node --input-type=module -e '
  import { pathToFileURL } from "node:url";
  const { releaseChannel } = await import(pathToFileURL(process.argv[1]));
  console.log(releaseChannel(process.argv[2]));
' "$ROOT/scripts/release-channel.mjs" "$VERSION")
TAG="$TAG_PREFIX-v$VERSION"
REGISTRY=https://registry.npmjs.org/
RELEASE_FLAGS=()
if [ "$CHANNEL" != "latest" ]; then RELEASE_FLAGS+=(--prerelease); fi
# A package that lists npm-shrinkwrap.json in `files` (mcp-server, built at prepack by scripts/shrinkwrap.mjs) must
# reach users with it — and without the devDependencies npm installs when a shrinkwrap still carries dev entries.
EXPECT_SHRINKWRAP=$(node -p "(require('./package.json').files || []).includes('npm-shrinkwrap.json')")

on_npm() {
  local published_version
  published_version=$(npm view "$NAME@$VERSION" version --registry="$REGISTRY" \
    --prefer-online --fetch-retries=0 2>/dev/null) && [ "$published_version" = "$VERSION" ]
}

verify_npm_install() (
  local scratch bin installed_version attempt
  scratch=$(mktemp -d) || exit 1
  trap 'rm -rf -- "$scratch"' EXIT
  cd "$scratch" || exit 1
  # Registry reads and the installed executable do not need publishing credentials.
  unset GH_TOKEN GITHUB_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL ACTIONS_ID_TOKEN_REQUEST_TOKEN

  # Scope the cache to this verification so a local tarball cannot hide a CDN failure.
  # The package's exact version may be visible in metadata before the tarball is served.
  for attempt in {1..15}; do
    echo "→ verifying npm install of $NAME@$VERSION (attempt $attempt/15)"
    if timeout 90s npm install "$NAME@$VERSION" --registry="$REGISTRY" \
      --cache "$scratch/cache" --prefer-online --fetch-retries=0 \
      --ignore-scripts --no-save --no-package-lock --no-audit --no-fund; then
      bin="./node_modules/.bin/${NAME##*/}"
      if ! installed_version=$(timeout 20s "$bin" --version); then
        echo "::error::$NAME@$VERSION installed but its executable failed" >&2
        exit 1
      fi
      if [ "$installed_version" != "$VERSION" ]; then
        echo "::error::$NAME@$VERSION executable reported '$installed_version'" >&2
        exit 1
      fi
      if [ "$EXPECT_SHRINKWRAP" = true ]; then
        if [ ! -f "node_modules/$NAME/npm-shrinkwrap.json" ]; then
          echo "::error::$NAME@$VERSION was published without npm-shrinkwrap.json — its dependency tree is not pinned" >&2
          exit 1
        fi
        if [ -e node_modules/typescript ] || [ -e "node_modules/$NAME/node_modules/typescript" ]; then
          echo "::error::$NAME@$VERSION installs devDependencies (typescript) — the shrinkwrap kept dev entries" >&2
          exit 1
        fi
        echo "✓ $NAME@$VERSION ships npm-shrinkwrap.json and installs no devDependencies"
      fi
      echo "✓ installed $NAME@$VERSION and verified --version"
      exit 0
    fi
    if [ "$attempt" -lt 15 ]; then sleep 30; fi
  done
  echo "::error::Could not install $NAME@$VERSION from $REGISTRY" >&2
  exit 1
)

finish_release() {
  verify_npm_install || return 1
  if gh release view "$TAG" >/dev/null 2>&1; then return 0; fi
  gh release create "$TAG" --target "$GITHUB_SHA" --title "$NAME $VERSION" --generate-notes ${RELEASE_FLAGS[@]+"${RELEASE_FLAGS[@]}"} \
    || echo "⚠ GitHub Release 생성 실패 ($TAG) — npm 설치 검증 완료"
}

if on_npm; then
  echo "• $NAME@$VERSION 이미 npm 에 존재 — 설치 검증"
  finish_release
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
    finish_release
    exit 0
  fi
  sleep 15
  if on_npm; then
    # 부분 성공(publish 는 됐는데 응답만 실패) 케이스에도 Release 는 남긴다.
    echo "• $NAME@$VERSION 레지스트리에 이미 존재 (경합/부분 성공) — publish no-op"
    finish_release
    exit 0
  fi
done

echo "❌ $NAME@$VERSION publish 3회 실패"
exit 1
