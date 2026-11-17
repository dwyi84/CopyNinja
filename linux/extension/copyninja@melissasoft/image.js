import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

export const THUMBNAIL_SIZE = 220;

/**
 * Decodes a clipboard image off the main loop and returns a small PNG preview.
 * Returns null for formats GdkPixbuf cannot decode.
 */
export async function makeThumbnail(bytes, maxSize = THUMBNAIL_SIZE) {
    try {
        const data = bytes instanceof GLib.Bytes ? bytes : new GLib.Bytes(bytes);
        const stream = Gio.MemoryInputStream.new_from_bytes(data);
        const pixbuf = await new Promise((resolve, reject) => {
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, maxSize, maxSize, true, null,
                (source, result) => {
                    try {
                        resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });

        const [ok, buffer] = pixbuf.save_to_bufferv('png', [], []);
        if (!ok || !buffer || buffer.length === 0)
            return null;

        return {
            bytes: buffer,
            width: pixbuf.get_width(),
            height: pixbuf.get_height(),
        };
    } catch (error) {
        console.warn(`CopyNinja: could not decode image — ${error.message}`);
        return null;
    }
}
