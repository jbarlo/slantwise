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
