#!/usr/bin/env bash
set -euo pipefail

# Download better-sqlite3 prebuilt binaries for all platforms
# These are bundled with the CLI for npm distribution
#
# Usage: ./scripts/download-native-binaries.sh <better-sqlite3-version> <node-abi-version>
# Example: ./scripts/download-native-binaries.sh 12.5.0 137

if [ $# -lt 2 ]; then
  echo "Usage: $0 <better-sqlite3-version> <node-abi-version>"
  echo "Example: $0 12.5.0 137"
  exit 1
fi

BETTER_SQLITE3_VERSION="$1"
NODE_ABI_VERSION="$2"  # e.g., 137 for Node 24.x

VENDOR_DIR="vendor/better-sqlite3"
BASE_URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}"

# Platforms to download (platform-arch as used by Node.js)
PLATFORMS=(
  "darwin-arm64"
  "darwin-x64"
  "linux-arm64"
  "linux-x64"
  "win32-x64"
)

echo "Downloading better-sqlite3 v${BETTER_SQLITE3_VERSION} prebuilds..."

mkdir -p "$VENDOR_DIR"

for platform in "${PLATFORMS[@]}"; do
  echo "  Downloading ${platform}..."

  # Construct filename (better-sqlite3 uses different naming for some platforms)
  filename="better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${NODE_ABI_VERSION}-${platform}.tar.gz"
  url="${BASE_URL}/${filename}"

  # Create platform directory
  mkdir -p "${VENDOR_DIR}/${platform}"

  # Download and extract
  if curl -sL --fail "$url" | tar -xzf - -C "${VENDOR_DIR}/${platform}" --strip-components=2 2>/dev/null; then
    echo "    ✓ ${platform}"
  else
    echo "    ✗ ${platform} (failed to download)"
    exit 1
  fi
done

echo ""
echo "Downloaded binaries:"
find "$VENDOR_DIR" -name "*.node" -exec ls -lh {} \;
