default:
  @just --list --unsorted

### Development

[group('Development')]
install: && (_prep-dependencies "node")
  pnpm i --frozen-lockfile
  @# after: trigger rebuild of better-sqlite3 to update the sqlite marker file

alias i := install

_electron-vite command:
  pnpm exec electron-vite --config src/gui/electron/electron.vite.config.ts {{ command }}

# Run dev build
[group('Development')]
dev: (_prep-dependencies "electron") (_electron-vite "dev")

# Run dev CLI
[group('Development')]
[positional-arguments]
dev-cli *args:
  pnpm cli $@

alias cli := dev-cli

# Run preview production build
[group('Development')]
preview: (_prep-dependencies "electron") (_electron-vite "preview")

### Tests

[group('Tests')]
test: (_prep-dependencies "node")
  pnpm test

[group('Tests')]
ci-test:
  @CI=true just test

### Linting

# Run typechecking, and autofix lints and formatting
[group('Linting')]
quality: typecheck lint format

# Run typechecking and linting for CI
[group('Linting')]
ci-quality: typecheck ci-lint

[group('Linting')]
typecheck:
  pnpm typecheck

# Run lint with autofix
[group('Linting')]
lint:
  pnpm lint --fix

# Run lint without autofix (for CI)
[group('Linting')]
ci-lint:
  pnpm lint

[group('Linting')]
format:
  pnpm run format

### Building

_prebuild:
  pnpm exec electron-vite --config src/gui/electron/electron.vite.config.ts build

_electron-build params:
  pnpm exec electron-builder --config src/gui/electron/electron-builder.yml --publish never {{params}}

# Build for targeted platforms (win, mac, linux, default: all)
[group('Building')]
build platform="all": typecheck (_prep-dependencies-electron) _prebuild
  {{ if platform == "all" {  "just _electron-build --win && just _electron-build --mac && just _electron-build --linux"  } \
  else if platform =='win' { "just _electron-build --win" } \
  else if platform =='mac' { "just _electron-build --mac" } \
  else if platform =='linux' { "just _electron-build --linux" } \
  else { error("Invalid platform: " + platform) } }}

[group('Building')]
unpack: typecheck (_prep-dependencies-electron) _prebuild
  just _electron-build "--dir"

# Versions for native binary downloads
better-sqlite3-version := "12.2.0"
node-abi-version := "127"  # Node 22.x

# Download prebuilt native binaries for CLI distribution
[group('Building')]
download-cli-native-binaries:
  ./scripts/download-sqlite-native-binaries.sh {{better-sqlite3-version}} {{node-abi-version}}

[group('Building')]
build-cli: typecheck download-cli-native-binaries
  pnpm build:cli

### CI

[group('CI')]
publish-cli: build-cli
  #!/usr/bin/env bash
  set -euo pipefail

  # Guard: only allow in CI
  if [ "$CI" != "true" ]; then
    echo "❌ publish-cli should only run in CI"
    echo "   Use the release workflow instead: just prepare-patch && just tag-release"
    exit 1
  fi

  # Guard: ensure HEAD is tagged with current version
  VERSION=$(jq -r '.version' package.json)
  if ! git describe --exact-match --tags HEAD 2>/dev/null | grep -q "^v${VERSION}$"; then
    echo "❌ HEAD is not tagged v${VERSION}"
    echo "   Ensure the release workflow triggered correctly"
    exit 1
  fi

  pnpm publish --access public --no-git-checks

### Release

# Show current version and last git tag
[group('Release')]
version:
  @echo "Current version: $(jq -r '.version' package.json)"
  @echo "Last tag: $(git describe --tags --abbrev=0 2>/dev/null || echo 'none')"

# Step 1: Prepare release PR with version bump
[group('Release')]
prepare-release type="patch": typecheck ci-test
  #!/usr/bin/env bash
  set -euo pipefail

  # Ensure clean working directory
  if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: Uncommitted changes detected"
    echo "   Commit or stash changes before preparing release"
    exit 1
  fi

  # Ensure on main branch
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != "main" ]; then
    echo "❌ Error: Must be on main branch"
    echo "   Currently on: $BRANCH"
    exit 1
  fi

  # Ensure up to date with remote
  git fetch origin
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "❌ Error: Local main is not in sync with origin/main"
    echo "   Run: git pull"
    exit 1
  fi

  # Bump version in package.json (no git operations)
  echo "📦 Bumping {{type}} version..."
  pnpm version {{type}} --no-git-tag-version
  VERSION=$(jq -r '.version' package.json)

  # Create release branch
  BRANCH_NAME="release/v${VERSION}"
  git checkout -b "$BRANCH_NAME"
  git add package.json
  git commit -m "chore: bump version to ${VERSION}"
  git push -u origin "$BRANCH_NAME"

  echo ""
  echo "✅ Release branch created: $BRANCH_NAME"
  echo "   Version: ${VERSION}"
  echo ""
  echo "📝 Next steps:"
  echo "   1. Create PR: gh pr create --title \"Release v${VERSION}\" --body \"Release v${VERSION}\""
  echo "   2. Merge PR via GitHub UI (squash or rebase)"
  echo "   3. Run: git checkout main && git pull && just tag-release"

# Step 2: Tag the release after PR is merged (run on main)
[group('Release')]
tag-release:
  #!/usr/bin/env bash
  set -euo pipefail

  # Ensure on main branch
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != "main" ]; then
    echo "❌ Error: Must be on main branch"
    echo "   Currently on: $BRANCH"
    echo "   Run: git checkout main && git pull"
    exit 1
  fi

  # Ensure up to date with remote
  git fetch origin
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "❌ Error: Local main is not in sync with origin/main"
    echo "   Run: git pull"
    exit 1
  fi

  VERSION=$(jq -r '.version' package.json)
  TAG_NAME="v${VERSION}"

  # Check if tag already exists
  if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
    echo "❌ Error: Tag $TAG_NAME already exists"
    exit 1
  fi

  # Create annotated tag
  echo "🏷️  Creating tag: $TAG_NAME"
  git tag -a "$TAG_NAME" -m "Release $TAG_NAME"

  # Push tag
  echo "🚢 Pushing tag to origin..."
  git push origin "$TAG_NAME"

  echo ""
  echo "✅ Successfully tagged and pushed $TAG_NAME"
  echo "   Commit: $(git rev-parse --short HEAD)"
  echo "   View builds: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"

# Alias for prepare-relase "patch"
[group('Release')]
prepare-patch: (prepare-release "patch")

# Alias for prepare-relase "minor"
[group('Release')]
prepare-minor: (prepare-release "minor")

# Alias for prepare-relase "major"
[group('Release')]
prepare-major: (prepare-release "major")

### Utils

[group('Utils')]
lang-diagram:
  pnpm generate:syntax-diagram


### Internal Shared

sqlite-watcher := '.sqlite-watcher-file'

# Read the sqlite marker file
_check-sqlite-state:
  #!/usr/bin/env bash
  if [ -f {{sqlite-watcher}} ]; then
    cat {{sqlite-watcher}}
  else
    echo "unknown"
  fi

# Update the sqlite marker file
_update-marker-file value:
  @echo "{{value}}" > {{sqlite-watcher}}

_prep-dependencies-electron: && (_update-marker-file "electron")
  PREBUILD_INSTALL_DISABLE=1 \
  npm_config_runtime=electron \
  npm_config_target=$(node -p 'require("electron/package.json").version') \
  npm_config_disturl=https://electronjs.org/headers \
  pnpm exec electron-rebuild -f -v $(node -p 'require("electron/package.json").version')

_prep-dependencies-node: && (_update-marker-file "node")
  pnpm rebuild better-sqlite3

_prep-dependencies expected:
  @if [ "$(just _check-sqlite-state)" != {{ expected }} ]; then \
    just {{ if expected == "electron" { "_prep-dependencies-electron" } else { "_prep-dependencies-node" } }}; \
  fi
