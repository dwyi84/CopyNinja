import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ClipboardItem, isSafeFileName} from './model.js';

const HISTORY_VERSION = 1;

function isNotFound(error) {
    if (!error)
        return false;
    if (error.code === Gio.IOErrorEnum.NOT_FOUND)
        return true;
    try {
        return error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
    } catch {
        return false;
    }
}

function extensionForMime(mime) {
    const subtype = String(mime ?? '').split('/')[1]?.split(';')[0]?.toLowerCase();
    const known = {
        jpeg: 'jpg',
        jpg: 'jpg',
        png: 'png',
        webp: 'webp',
        gif: 'gif',
        bmp: 'bmp',
        tiff: 'tiff',
    };
    return known[subtype] ?? 'img';
}

/**
 * Owns everything under `~/.local/share/copyninja/`:
 *
 *   history.json
 *   images/<uuid>.<ext>
 *   images/<uuid>.thumb.png
 *
 * Files are user-private (0600) because clipboard history may contain
 * sensitive text. Writes are coalesced and atomically replace the index.
 */
export class HistoryStorage {
    constructor(baseDir = null) {
        this.baseDir = baseDir ?? GLib.build_filenamev([GLib.get_user_data_dir(), 'copyninja']);
        this.imagesDir = GLib.build_filenamev([this.baseDir, 'images']);
        this.historyPath = GLib.build_filenamev([this.baseDir, 'history.json']);

        this._pending = null;
        this._writing = false;
        this._waiters = [];
    }

    _ensureDirs() {
        for (const dir of [this.baseDir, this.imagesDir]) {
            if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
                GLib.mkdir_with_parents(dir, 0o700);
            try {
                Gio.File.new_for_path(dir).set_attribute_uint32(
                    'unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
            } catch {
                // Best effort; the directory mode is still constrained by umask.
            }
        }
    }

    async load() {
        this._ensureDirs();
        const file = Gio.File.new_for_path(this.historyPath);

        let contents;
        try {
            contents = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, result) => {
                    try {
                        const [ok, bytes] = source.load_contents_finish(result);
                        if (!ok)
                            reject(new Error('Could not read history'));
                        else
                            resolve(bytes);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            if (isNotFound(error))
                return [];
            console.warn(`CopyNinja: could not read history — ${error.message}`);
            return [];
        }

        let parsed;
        try {
            parsed = JSON.parse(new TextDecoder().decode(contents));
        } catch (error) {
            console.warn(`CopyNinja: history is not valid JSON — ${error.message}`);
            try {
                file.move(Gio.File.new_for_path(`${this.historyPath}.bak`),
                    Gio.FileCopyFlags.OVERWRITE, null, null);
            } catch {
                // Ignore backup failures.
            }
            return [];
        }

        const values = Array.isArray(parsed) ? parsed : parsed?.items;
        if (!Array.isArray(values))
            return [];

        const items = [];
        for (const value of values) {
            const item = ClipboardItem.fromJSON(value);
            if (!item)
                continue;

            if (item.kind === 'image') {
                const path = this.imagePath(item.image);
                if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS))
                    continue;
                if (item.thumb && !GLib.file_test(this.thumbPath(item.thumb), GLib.FileTest.EXISTS))
                    item.thumb = null;
            }
            items.push(item);
        }
        return items;
    }

    /** Coalesced, atomic save. The returned promise settles after the write. */
    save(items) {
        this._ensureDirs();
        this._pending = JSON.stringify({
            version: HISTORY_VERSION,
            items: items.map(item => item.toJSON()),
        });

        const promise = new Promise(resolve => this._waiters.push(resolve));
        if (!this._writing)
            this._flush();
        return promise;
    }

    flushSync(items) {
        if (this._writing || this._pending !== null)
            return;

        this._ensureDirs();
        const text = JSON.stringify({
            version: HISTORY_VERSION,
            items: items.map(item => item.toJSON()),
        });
        try {
            Gio.File.new_for_path(this.historyPath).replace_contents(
                new TextEncoder().encode(text), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                null);
        } catch (error) {
            console.warn(`CopyNinja: could not flush history — ${error.message}`);
        }
    }

    _flush() {
        const text = this._pending;
        this._pending = null;
        this._writing = true;

        const file = Gio.File.new_for_path(this.historyPath);
        file.replace_contents_bytes_async(
            new GLib.Bytes(new TextEncoder().encode(text)),
            null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
            null,
            (source, result) => {
                try {
                    source.replace_contents_finish(result);
                } catch (error) {
                    console.warn(`CopyNinja: could not save history — ${error.message}`);
                }

                this._writing = false;
                if (this._pending !== null) {
                    // A newer save arrived while this one was in flight. Keep
                    // every waiter pending for the next write.
                    this._flush();
                } else {
                    const waiters = this._waiters;
                    this._waiters = [];
                    for (const resolve of waiters)
                        resolve();
                }
            });
    }

    async saveImage(id, mime, bytes, thumbBytes = null) {
        this._ensureDirs();
        if (!isSafeFileName(id))
            return null;

        const image = `${id}.${extensionForMime(mime)}`;
        const thumb = thumbBytes ? `${id}.thumb.png` : null;

        try {
            await this._writeFile(this.imagePath(image), bytes);
            if (thumb)
                await this._writeFile(this.thumbPath(thumb), thumbBytes);
            return {image, thumb};
        } catch (error) {
            console.warn(`CopyNinja: could not save image — ${error.message}`);
            try {
                await this._deleteFile(this.imagePath(image));
                if (thumb)
                    await this._deleteFile(this.thumbPath(thumb));
            } catch {
                // Ignore cleanup failures.
            }
            return null;
        }
    }

    async readImage(filename) {
        if (!isSafeFileName(filename))
            return null;
        const path = this.imagePath(filename);
        if (!path)
            return null;

        try {
            const file = Gio.File.new_for_path(path);
            const contents = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, result) => {
                    try {
                        const [ok, bytes] = source.load_contents_finish(result);
                        if (ok)
                            resolve(bytes);
                        else
                            reject(new Error('Could not read image'));
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            return contents;
        } catch (error) {
            console.warn(`CopyNinja: could not read image — ${error.message}`);
            return null;
        }
    }

    async deleteImages(filenames) {
        for (const filename of filenames ?? []) {
            if (!isSafeFileName(filename))
                continue;
            const path = GLib.build_filenamev([this.imagesDir, filename]);
            await this._deleteFile(path);
        }
    }

    /** Removes image files that are no longer referenced by any history item. */
    pruneOrphans(referenced) {
        const keep = new Set(referenced);
        let enumerator;
        try {
            enumerator = Gio.File.new_for_path(this.imagesDir)
                .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            return;
        }

        for (;;) {
            const info = enumerator.next_file(null);
            if (!info)
                break;
            const name = info.get_name();
            if (keep.has(name))
                continue;
            try {
                Gio.File.new_for_path(GLib.build_filenamev([this.imagesDir, name]))
                    .delete(null);
            } catch {
                // Ignore files that disappeared or cannot be removed.
            }
        }
        enumerator.close(null);
    }

    async clear() {
        try {
            Gio.File.new_for_path(this.historyPath).delete(null);
        } catch (error) {
            if (!isNotFound(error))
                console.warn(`CopyNinja: could not delete history — ${error.message}`);
        }

        try {
            const enumerator = Gio.File.new_for_path(this.imagesDir)
                .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            for (;;) {
                const info = enumerator.next_file(null);
                if (!info)
                    break;
                try {
                    Gio.File.new_for_path(GLib.build_filenamev([this.imagesDir, info.get_name()]))
                        .delete(null);
                } catch {
                    // Ignore individual deletion failures.
                }
            }
            enumerator.close(null);
        } catch {
            // The images directory may not exist yet.
        }
    }

    imagePath(filename) {
        if (!isSafeFileName(filename))
            return null;
        return GLib.build_filenamev([this.imagesDir, filename]);
    }

    thumbPath(filename) {
        if (!isSafeFileName(filename))
            return null;
        return GLib.build_filenamev([this.imagesDir, filename]);
    }

    async _writeFile(path, data) {
        if (!path)
            throw new Error('Invalid path');

        const bytes = data instanceof GLib.Bytes ? data : new GLib.Bytes(data);
        const file = Gio.File.new_for_path(path);
        await new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                null,
                (source, result) => {
                    try {
                        source.replace_contents_finish(result);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
        });

        try {
            file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            // PRIVATE should already have created it 0600.
        }
    }

    async _deleteFile(path) {
        if (!path)
            return;
        await new Promise(resolve => {
            Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    source.delete_finish(result);
                } catch (error) {
                    if (!isNotFound(error))
                        console.warn(`CopyNinja: could not delete file — ${error.message}`);
                }
                resolve();
            });
        });
    }
}
