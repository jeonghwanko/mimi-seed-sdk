#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/package"
export PATH="$scratch/bin:$PATH" TRACE="$scratch/trace" GITHUB_SHA=test-sha
export GH_TOKEN=test-token ACTIONS_ID_TOKEN_REQUEST_TOKEN=test-oidc

cat > "$scratch/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "$TRACE"
case "$1" in
  view)
    if [ "$SCENARIO" = new ] || [ "$SCENARIO" = missing-new ]; then exit 1; fi
    if [ "$SCENARIO" = partial ] && ! grep -q '^npm publish ' "$TRACE"; then exit 1; fi
    echo "$TEST_VERSION"
    ;;
  publish)
    # In the partial case npm recorded the publication but reported a conflict.
    [ "$SCENARIO" != partial ]
    ;;
  install)
    [ "$2" = "@example/mimi-seed-mcp@$TEST_VERSION" ]
    [ "$3" = "--registry=https://registry.npmjs.org/" ]
    [ "$4" = "--cache" ]
    [ "$5" = "$PWD/cache" ]
    [ "$PWD" != "$PACKAGE_DIR" ]
    [ "${8}" = "--ignore-scripts" ]
    [ -z "${GH_TOKEN+x}${ACTIONS_ID_TOKEN_REQUEST_TOKEN+x}" ]
    if [ "$SCENARIO" = missing ] || [ "$SCENARIO" = missing-new ]; then exit 1; fi
    if [ "$SCENARIO" = partial ] && [ "$(grep -c '^npm install ' "$TRACE")" -eq 1 ]; then exit 1; fi
    mkdir -p node_modules/.bin
    cat > node_modules/.bin/mimi-seed-mcp <<'BIN'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "--version" ]
[ -z "${GH_TOKEN+x}${ACTIONS_ID_TOKEN_REQUEST_TOKEN+x}" ]
echo "bin $1" >> "$TRACE"
if [ "$SCENARIO" = wrong-version ]; then echo 0.0.0; else echo "$TEST_VERSION"; fi
BIN
    chmod +x node_modules/.bin/mimi-seed-mcp
    if [ "$SCENARIO" != shrinkwrap-missing ]; then
      mkdir -p node_modules/@example/mimi-seed-mcp && echo '{}' > node_modules/@example/mimi-seed-mcp/npm-shrinkwrap.json
    fi
    if [ "$SCENARIO" = shrinkwrap-dev ]; then mkdir -p node_modules/typescript; fi
    ;;
  *) exit 2 ;;
esac
MOCK
cat > "$scratch/bin/gh" <<'MOCK'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$TRACE"
[ "$2" = create ] && [ "${GH_TOKEN:-}" = test-token ]
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$scratch/bin/sleep"
# macOS has no coreutils `timeout`; the test does not exercise timeouts, so a pass-through stands in everywhere.
printf '#!/usr/bin/env bash\nshift\nexec "$@"\n' > "$scratch/bin/timeout"
chmod +x "$scratch/bin/npm" "$scratch/bin/gh" "$scratch/bin/sleep" "$scratch/bin/timeout"

run_release() (
  export SCENARIO="$1" TEST_VERSION="$2" PACKAGE_DIR="$scratch/package"
  cd "$PACKAGE_DIR"
  printf '{"name":"@example/mimi-seed-mcp","version":"%s","files":["dist","npm-shrinkwrap.json"]}\n' "$TEST_VERSION" > package.json
  : > "$TRACE"
  bash "$ROOT/.github/scripts/publish-if-new.sh" mcp-server
)

run_release existing 1.2.3
[ "$(grep -c '^npm install ' "$TRACE")" -eq 1 ]
if grep -q '^npm publish ' "$TRACE"; then exit 1; fi
grep -q '^bin --version$' "$TRACE"
grep -q '^gh release create mcp-server-v1.2.3 ' "$TRACE"

run_release new 1.2.4
[ "$(grep -c '^npm publish .*--tag latest$' "$TRACE")" -eq 1 ]
[ "$(grep -c '^npm install ' "$TRACE")" -eq 1 ]
grep -q '^gh release create mcp-server-v1.2.4 ' "$TRACE"

if run_release missing 1.2.3 > "$scratch/missing.log" 2>&1; then exit 1; fi
[ "$(grep -c '^npm install ' "$TRACE")" -eq 15 ]
if grep -Eq '^(gh|bin|npm publish) ' "$TRACE"; then exit 1; fi

if run_release missing-new 1.2.4 > "$scratch/missing-new.log" 2>&1; then exit 1; fi
[ "$(grep -c '^npm publish ' "$TRACE")" -eq 1 ]
[ "$(grep -c '^npm install ' "$TRACE")" -eq 15 ]
if grep -Eq '^(gh|bin) ' "$TRACE"; then exit 1; fi

run_release partial 1.2.4-next.1
[ "$(grep -c '^npm publish .*--tag next$' "$TRACE")" -eq 1 ]
[ "$(grep -c '^npm install ' "$TRACE")" -eq 2 ]
grep -q '^gh release create mcp-server-v1.2.4-next.1 .*--prerelease$' "$TRACE"

if run_release wrong-version 1.2.3 > "$scratch/wrong-version.log" 2>&1; then exit 1; fi
grep -q '^bin --version$' "$TRACE"
if grep -q '^gh ' "$TRACE"; then exit 1; fi

for scenario in shrinkwrap-missing shrinkwrap-dev; do
  if run_release "$scenario" 1.2.3 > "$scratch/$scenario.log" 2>&1; then exit 1; fi
  grep -q 'npm-shrinkwrap\|devDependencies' "$scratch/$scenario.log"
  if grep -q '^gh ' "$TRACE"; then exit 1; fi
done

echo 'npm publication verification tests passed'
