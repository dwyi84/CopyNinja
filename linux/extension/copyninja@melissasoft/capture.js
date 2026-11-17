import GLib from 'gi://GLib';
import St from 'gi://St';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    IMAGE_MIMES,
    TEXT_MIMES,
    hashBytes,
    hashText,
    isImageMime,
    isSensitiveHint,
    normalizeText,
} from './model.js';

const TEXT_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;

function isExcluded(settings, wmClass) {
    if (!wmClass)
        return false;
    const needle = wmClass.toLowerCase();
    return settings.get_strv('excluded-apps')
        .some(entry => entry && needle.includes(entry.toLowerCase()));
}

/**
 * Watches the GNOME clipboard via Meta.Selection, so it works on both X11 and
 * Wayland. Only the Shell can observe clipboard ownership changes in the
 * background; a standalone GTK app cannot do this reliably under Wayland.
 */
export class ClipboardCapture {
    constructor({settings, onCapture, onError = null}) {
        this._settings = settings;
        this._onCapture = onCapture;
        this._onError = onError;

        this._clipboard = St.Clipboard.get_default();
        this._selection = null;
        this._selectionId = 0;

        this._busy = false;
        this._pending = false;
        this._queueId = 0;
        this._suppress = false;
        this._suppressId = 0;

        this._started = false;
    }

    start() {
        if (this._started)
            return;

        this._selection = global.display.get_selection();
        this._selectionId = this._selection.connect('owner-changed',
            (selection, selectionType) => {
                if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD)
                    return;

                if (this._suppress) {
                    this._suppress = false;
                    return;
                }

                if (this._settings.get_boolean('private-mode'))
                    return;
                if (Main.sessionMode?.isLocked)
                    return;

                this._schedule();
            });

        this._started = true;
    }

    stop() {
        if (!this._started)
            return;

        if (this._selectionId)
            this._selection.disconnect(this._selectionId);
        this._selectionId = 0;
        this._selection = null;

        if (this._queueId) {
            GLib.source_remove(this._queueId);
            this._queueId = 0;
        }
        if (this._suppressId) {
            GLib.source_remove(this._suppressId);
            this._suppressId = 0;
        }

        this._started = false;
    }

    /**
     * Called immediately before CopyNinja writes to the clipboard, so its own
     * write is not collected again. The flag expires if GNOME does not emit an
     * ownership change.
     */
    suppressNextChange() {
        this._suppress = true;
        if (this._suppressId)
            GLib.source_remove(this._suppressId);
        this._suppressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
            this._suppressId = 0;
            this._suppress = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    _schedule() {
        if (this._busy) {
            this._pending = true;
            return;
        }
        if (this._queueId)
            return;

        this._queueId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._queueId = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _read() {
        if (this._busy)
            return;

        this._busy = true;
        try {
            const wmClass = this._focusWmClass();
            if (isExcluded(this._settings, wmClass))
                return;

            const capture = await this._readClipboard(wmClass);
            if (capture)
                await this._onCapture(capture);
        } catch (error) {
            console.warn(`CopyNinja: clipboard capture failed — ${error.message}`);
            this._onError?.(error);
        } finally {
            this._busy = false;
            if (this._pending) {
                this._pending = false;
                this._schedule();
            }
        }
    }

    _focusWmClass() {
        const window = global.display.focus_window;
        if (!window)
            return null;
        return window.get_wm_class?.() ?? window.get_wm_class_instance?.() ?? null;
    }

    async _readClipboard(sourceApp) {
        for (const marker of ['x-kde-passwordManagerHint', 'org.nspasteboard.ConcealedType']) {
            const data = await this._getContent(marker);
            if (data && isSensitiveHint(new TextDecoder().decode(data)))
                return null;
        }

        for (const mime of TEXT_MIMES) {
            const data = await this._getContent(mime);
            if (!data)
                continue;
            if (data.length > TEXT_MAX_BYTES)
                return null;

            const text = normalizeText(new TextDecoder().decode(data));
            if (!text.trim())
                continue;

            const storedMime = mime === 'UTF8_STRING' ? 'text/plain;charset=utf-8' : mime;
            return {
                kind: 'text',
                text,
                mime: storedMime,
                size: data.length,
                hash: hashText(text),
                sourceApp,
            };
        }

        if (!this._settings.get_boolean('capture-images'))
            return null;

        for (const mime of IMAGE_MIMES) {
            const data = await this._getContent(mime);
            if (!data)
                continue;
            if (!isImageMime(mime))
                continue;
            if (data.length > IMAGE_MAX_BYTES)
                return null;

            return {
                kind: 'image',
                mime,
                bytes: data,
                size: data.length,
                hash: hashBytes(data),
                sourceApp,
            };
        }

        return null;
    }

    /**
     * Copies the clipboard bytes before the callback returns. The GLib.Bytes
     * handed to the callback is owned by the clipboard; retaining it in a
     * promise can free the underlying memory twice and crash the Shell.
     */
    _getContent(mime) {
        return new Promise(resolve => {
            this._clipboard.get_content(
                St.ClipboardType.CLIPBOARD, mime,
                (clipboard, bytes) => {
                    if (!bytes || bytes.get_size() === 0) {
                        resolve(null);
                        return;
                    }
                    resolve(Uint8Array.from(bytes.get_data()));
                });
        });
    }
}
