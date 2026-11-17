#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

case "${1:-install}" in
    install)
        make install
        ;;
    uninstall)
        make uninstall
        ;;
    pack)
        make pack
        ;;
    reload)
        make reload
        ;;
    check)
        make check
        ;;
    *)
        echo "Usage: $0 [install|uninstall|pack|reload|check]" >&2
        exit 2
        ;;
esac
