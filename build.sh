#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APP_NAME="CopyNinja"
DIST="$ROOT/dist"
APP="$DIST/$APP_NAME.app"

# Apple Silicon only.
if [ "$(uname -m)" != "arm64" ]; then
    echo "CopyNinja requires Apple Silicon (arm64)."
    exit 1
fi

echo "==> Building ($APP_NAME, release)..."
swift build -c release
BIN_PATH="$(swift build -c release --show-bin-path)/$APP_NAME"

echo "==> Assembling $APP_NAME.app..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_PATH" "$APP/Contents/MacOS/$APP_NAME"
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"

echo "==> Code signing (ad-hoc)..."
codesign --force --sign - "$APP"

echo "==> Verifying signature..."
codesign --verify --strict "$APP" && echo "    signature OK"

echo "==> Launching $APP_NAME..."
open "$APP"

echo ""
echo "CopyNinja is running in the menu bar."
echo "Click the ninja to open your clipboard history."
