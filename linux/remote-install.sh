#!/bin/sh
# One-liner remote installer/uninstaller for CopyNinja (Ubuntu / GNOME Shell).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dwyi84/CopyNinja/ubuntu/linux/remote-install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/dwyi84/CopyNinja/ubuntu/linux/remote-install.sh | sh -s -- --uninstall
set -eu

REPO="${COPYNINJA_REPO:-dwyi84/CopyNinja}"
REF="${COPYNINJA_REF:-ubuntu}"
UUID="copyninja@melissasoft"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"

if [ "${1:-}" = "--uninstall" ]; then
    echo "==> Uninstalling $UUID"
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
    fi
    rm -rf "$EXT_DIR"
    echo "CopyNinja uninstalled. History was kept in $DATA_HOME/copyninja."
    echo "Reload GNOME Shell if the top-bar icon is still visible."
    exit 0
fi

for cmd in tar mktemp glib-compile-schemas; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Missing required command: $cmd" >&2
        exit 1
    fi
done

fetch_archive() {
    url="$1"
    dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$url"
    else
        echo "curl or wget is required to download CopyNinja" >&2
        exit 1
    fi
}

TMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

download_and_extract() {
    url="$1"
    subdir="$2"
    archive="$TMP_DIR/$subdir.tar.gz"
    extract_dir="$TMP_DIR/$subdir"
    mkdir -p "$extract_dir"
    fetch_archive "$url" "$archive"
    tar -xzf "$archive" -C "$extract_dir"
    find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1
}

TARBALL_URL="${COPYNINJA_ARCHIVE_URL:-https://github.com/$REPO/archive/$REF.tar.gz}"
echo "==> Downloading CopyNinja ($REPO@$REF)"
SRC_DIR=$(download_and_extract "$TARBALL_URL" "primary")

if [ -z "${COPYNINJA_ARCHIVE_URL:-}" ] && { [ -z "$SRC_DIR" ] || [ ! -f "$SRC_DIR/linux/install.sh" ]; }; then
    echo "==> linux/install.sh not found in $REF, falling back to ubuntu"
    FALLBACK_URL="https://github.com/$REPO/archive/refs/heads/ubuntu.tar.gz"
    SRC_DIR=$(download_and_extract "$FALLBACK_URL" "fallback")
fi

if [ -z "$SRC_DIR" ] || [ ! -f "$SRC_DIR/linux/install.sh" ]; then
    echo "Could not find linux/install.sh in downloaded archive" >&2
    exit 1
fi

case "$REF" in
    linux-[vV][0-9]*|linux-[0-9]*|ubuntu-[vV][0-9]*|ubuntu-[0-9]*|[vV][0-9]*|[0-9]*)
        CLEAN_VER="$REF"
        CLEAN_VER="${CLEAN_VER#linux-}"
        CLEAN_VER="${CLEAN_VER#ubuntu-}"
        CLEAN_VER="${CLEAN_VER#v}"
        CLEAN_VER="${CLEAN_VER#V}"
        META_FILE="$SRC_DIR/linux/extension/$UUID/metadata.json"
        if [ -f "$META_FILE" ] && command -v python3 >/dev/null 2>&1; then
            python3 - "$META_FILE" "$CLEAN_VER" <<'PYEOF'
import json, sys
path, ver = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
data['version-name'] = ver
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
PYEOF
        fi
        ;;
esac

sh "$SRC_DIR/linux/install.sh" install
