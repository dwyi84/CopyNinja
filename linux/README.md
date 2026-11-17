# CopyNinja for Ubuntu

A featherweight clipboard history for the **GNOME 46 top bar**. It captures
text and images, deduplicates them, and keeps everything on this device.

This is the Ubuntu companion to the macOS menu bar app. It is a native GNOME
Shell extension, not an AppIndicator or a background daemon.

## Features

- **Top bar shuriken** — vector icon drawn with Cairo, follows the panel tint.
- **Popover** — search, two-line previews, timestamps, image thumbnails.
- **Keyboard first** — `↑↓`, `Enter`, `Space`, `Esc`, `Ctrl+1~0`.
- **Text + images** — PNG/JPEG/WebP/GIF/BMP/TIFF; SVG is skipped on purpose.
- **Deduplication** — re-copied content is promoted to the top.
- **Privacy** — skips password-manager hints, supports excluded apps and a
  private mode. History files are `0600` in a `0700` directory.
- **Persistent** — 500 entries by default (configurable 50–2000), stored under
  `~/.local/share/copyninja/`.
- **No network** — no telemetry, no cloud, no OCR. Everything is local.

## Requirements

- Ubuntu 24.04 (or another distribution with GNOME Shell 46)
- X11 or Wayland
- No extra runtime packages. The extension uses the Python-free GJS runtime,
  `St.Clipboard`, `Meta.Selection`, and Gio/GdkPixbuf already present in GNOME.

Tested on Ubuntu 24.04 / GNOME Shell 46 / X11. The capture path uses
`Meta.Selection` and `St.Clipboard`, the supported APIs on Wayland as well;
reloading the extension on Wayland requires a logout/login.

## Install

```bash
cd linux
./install.sh
```

or:

```bash
make install
```

Then:

- **X11:** `Alt+F2`, type `r`, press Enter.
- **Wayland:** log out and back in.

Enable the extension if needed:

```bash
gnome-extensions enable copyninja@melissasoft
```

Default shortcut: **`Super+Shift+V`**. Change it in the extension preferences.

## Usage

| Action | Result |
| --- | --- |
| Click the shuriken | Open history |
| `Super+Shift+V` | Toggle history from anywhere |
| `↑` / `↓` | Move selection |
| `Enter` | Copy selected item and close |
| `Space` | Preview selected item |
| `Esc` | Close preview, then the popup |
| `Ctrl+1` … `Ctrl+9`, `Ctrl+0` | Copy the first ten filtered items |
| `Ctrl+Shift+Delete` | Clear all history |
| Type in the search field | Filter text and image entries |
| Private mode switch | Pause capture without deleting history |

Click the trash icon (or use `Ctrl+Shift+Delete`) to clear the history and the
system clipboard.

## Privacy and limitations

- Clipboard history is stored in `~/.local/share/copyninja/` with user-only
  permissions. It is not uploaded anywhere.
- CopyNinja asks the clipboard for the `x-kde-passwordManagerHint` marker and
  ignores `secret`/`password` content. It also ignores common password-manager
  `WM_CLASS` values (KeePassXC, Bitwarden, 1Password, Seahorse) and anything
  while **Private mode** is enabled.
- On Wayland, a background app cannot inspect every MIME type offered by the
  clipboard owner. Sensitive-content filtering is therefore best-effort. Use
  Private mode when copying secrets.
- OCR is intentionally not included. The macOS app uses Apple Vision; there is
  no dependency-free equivalent on Linux. Tesseract integration may be added
  later as an optional feature.
- The popup is a GNOME Shell menu. The macOS translucent “glass” background is
  replaced with the native Shell popup styling.

## Development

```bash
make check     # gjs unit tests + schema validation
make pack      # build/copyninja@melissasoft.shell-extension.zip
make install   # install into ~/.local/share/gnome-shell/extensions
make reload    # disable/enable the extension (X11)
```

Tests run with `gjs -m`; no Node, npm, pytest, or pip is required.

Layout:

```text
linux/
├── extension/copyninja@melissasoft/
│   ├── extension.js        # Extension entry point, global shortcut
│   ├── indicator.js        # Panel icon, popup, preview, actions
│   ├── capture.js          # Meta.Selection + St.Clipboard capture
│   ├── model.js            # ClipboardItem, MIME/hash helpers
│   ├── store.js            # Dedupe, search, quick slots, limit
│   ├── storage.js          # history.json + images, atomic/private writes
│   ├── image.js            # GdkPixbuf thumbnail generation
│   ├── format.js           # Timestamps, byte sizes, quick-slot labels
│   ├── i18n.js             # Korean/English JS catalog
│   ├── prefs.js            # Adw preferences
│   ├── stylesheet.css
│   └── schemas/
├── tests/run.js
├── Makefile
└── install.sh
```

## Uninstall

```bash
./install.sh uninstall
rm -rf ~/.local/share/copyninja   # optional: delete history
```

## License

MIT. See [LICENSE](../LICENSE).

Crafted by MelissaSoft.
