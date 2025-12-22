default:
  @just --list --unsorted

### Development

[group('Development')]
install:
  pnpm i --frozen-lockfile

alias i := install

_electron-vite command:
  pnpm exec electron-vite --config src/gui/electron/electron.vite.config.ts {{ command }}

# Run dev build
[group('Development')]
dev: (_electron-vite "dev")

# Run dev CLI
[group('Development')]
[positional-arguments]
dev-cli *args:
  pnpm cli $@

alias cli := dev-cli

# Run preview production build
[group('Development')]
preview: (_electron-vite "preview")

### Tests

[group('Tests')]
test:
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
build platform="all": typecheck _prebuild
  {{ if platform == "all" {  "just _electron-build --win && just _electron-build --mac && just _electron-build --linux"  } \
  else if platform =='win' { "just _electron-build --win" } \
  else if platform =='mac' { "just _electron-build --mac" } \
  else if platform =='linux' { "just _electron-build --linux" } \
  else { error("Invalid platform: " + platform) } }}

[group('Building')]
unpack: typecheck _prebuild
  just _electron-build "--dir"

[group('Building')]
build-cli: typecheck
  pnpm build:cli

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
