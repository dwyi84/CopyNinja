#!/bin/sh
# Install or manage the CopyNinja GNOME Shell extension for the current user.
set -eu

UUID="copyninja@melissasoft"
SRC=$(dirname "$(readlink -f "$0")")
EXT_SRC="$SRC/extension/$UUID"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"

do_install() {
    if ! command -v glib-compile-schemas >/dev/null 2>&1; then
        echo "glib-compile-schemas is required (install libglib2.0-bin)" >&2
        exit 1
    fi

    echo "==> Installing $UUID to $EXT_DIR"
    rm -rf "$EXT_DIR"
    mkdir -p "$EXT_DIR"
    cp -r "$EXT_SRC/." "$EXT_DIR/"
    if [ -f "$SRC/remote-install.sh" ]; then
        install -m 0755 "$SRC/remote-install.sh" "$EXT_DIR/remote-install.sh"
    fi
    glib-compile-schemas "$EXT_DIR/schemas"

    echo "==> Enabling $UUID"
    if command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions enable "$UUID" 2>/dev/null; then
        echo "    enabled"
    else
        echo "    The shell has not loaded the new extension yet."
        echo "    Reload the shell (X11: Alt+F2, type 'r', Enter; Wayland: log out and back in) and run:"
        echo "      gnome-extensions enable $UUID"
    fi

    echo ""
    echo "CopyNinja installed."
    echo "  X11:      Alt+F2, type r, press Enter"
    echo "  Wayland:  log out and back in"
    echo "  Shortcut: Super+Shift+V"
}

do_uninstall() {
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
    fi
    rm -rf "$EXT_DIR"
    echo "CopyNinja uninstalled. History was kept in $DATA_HOME/copyninja."
}

do_reload() {
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
        sleep 0.3
        gnome-extensions enable "$UUID" 2>/dev/null || true
    fi
}

case "${1:-install}" in
    install)
        do_install
        ;;
    uninstall)
        do_uninstall
        ;;
    reload)
        do_reload
        ;;
    pack)
        make -C "$SRC" pack
        ;;
    check)
        make -C "$SRC" check
        ;;
    *)
        echo "Usage: $0 [install|uninstall|pack|reload|check]" >&2
        exit 2
        ;;
esac
