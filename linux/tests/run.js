import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    ClipboardItem,
    hashText,
    isImageMime,
    isSensitiveHint,
    isTextMime,
    previewText,
} from '../extension/copyninja@melissasoft/model.js';
import {HistoryStore} from '../extension/copyninja@melissasoft/store.js';
import {
    formatBytes,
    formatTimestamp,
    quickSlotLabel,
} from '../extension/copyninja@melissasoft/format.js';
import {HistoryStorage} from '../extension/copyninja@melissasoft/storage.js';
import {
    isNewerVersion,
    parseLinuxTagVersion,
    parseMetadataVersion,
    pickLatestLinuxRelease,
} from '../extension/copyninja@melissasoft/version.js';

let failures = 0;

function assert(condition, message) {
    if (!condition)
        throw new Error(message ?? 'assertion failed');
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok   ${name}`);
    } catch (error) {
        failures++;
        console.error(`FAIL ${name}: ${error.message}`);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`ok   ${name}`);
    } catch (error) {
        failures++;
        console.error(`FAIL ${name}: ${error.message}`);
    }
}

function modeOf(path) {
    const info = Gio.File.new_for_path(path)
        .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    return info.get_attribute_uint32('unix::mode') & 0o777;
}

function removeTree(path) {
    const file = Gio.File.new_for_path(path);
    try {
        const enumerator = file.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        for (;;) {
            const info = enumerator.next_file(null);
            if (!info)
                break;
            const child = file.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                removeTree(child.get_path());
            else
                child.delete(null);
        }
        enumerator.close(null);
    } catch {
        // Directory may not exist.
    }
    try {
        file.delete(null);
    } catch {
        // Already gone.
    }
}

function textItem(text, ageMinutes = 0) {
    return new ClipboardItem({
        kind: 'text',
        text,
        hash: hashText(text),
        createdAt: new Date(Date.now() - ageMinutes * 60_000),
    });
}

async function runAsyncTests() {
    const baseDir = GLib.build_filenamev([
        GLib.get_tmp_dir(),
        `copyninja-test-${Date.now()}`,
    ]);
    const storage = new HistoryStorage(baseDir);

    await testAsync('storage: missing history is empty', async () => {
        const items = await storage.load();
        assert(items.length === 0, 'expected empty history');
    });

    const item = textItem('hello world');
    await testAsync('storage: save and load text', async () => {
        await storage.save([item]);
        const loaded = await storage.load();
        assert(loaded.length === 1, 'expected one item');
        assert(loaded[0].text === 'hello world', 'text mismatch');
        assert(loaded[0].hash === item.hash, 'hash mismatch');
        assert(modeOf(storage.historyPath) === 0o600,
            `history mode ${modeOf(storage.historyPath).toString(8)}`);
        assert(modeOf(baseDir) === 0o700,
            `dir mode ${modeOf(baseDir).toString(8)}`);
    });

    await testAsync('storage: save/read image and thumb', async () => {
        const id = 'test-image';
        const files = await storage.saveImage(
            id, 'image/png', new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7]));
        assert(files?.image === 'test-image.png', 'image filename');
        assert(files?.thumb === 'test-image.thumb.png', 'thumb filename');
        const bytes = await storage.readImage(files.image);
        assert(bytes.length === 4, 'image bytes');
        assert(modeOf(storage.imagePath(files.image)) === 0o600, 'image mode');
        assert(modeOf(storage.thumbPath(files.thumb)) === 0o600, 'thumb mode');
    });

    await testAsync('storage: clear removes files', async () => {
        await storage.clear();
        const loaded = await storage.load();
        assert(loaded.length === 0, 'expected empty after clear');
    });

    removeTree(baseDir);
}

test('hashText is deterministic', () => {
    assert(hashText('abc') === hashText('abc'), 'same input should hash the same');
    assert(hashText('abc') !== hashText('abd'), 'different input should differ');
});

test('previewText collapses newlines and whitespace', () => {
    assert(previewText('a\nb\r\nc') === 'a ⏎ b ⏎ c', previewText('a\nb\r\nc'));
    assert(previewText('  hello   world  ') === 'hello world', 'whitespace');
    assert(previewText('x'.repeat(20), 10).endsWith('…'), 'truncation');
});

test('sensitive hints are detected', () => {
    assert(isSensitiveHint('secret'), 'secret');
    assert(isSensitiveHint('password'), 'password');
    assert(!isSensitiveHint('plain text'), 'plain text');
});

test('MIME classification excludes SVG images', () => {
    assert(isTextMime('text/plain'), 'text/plain');
    assert(isTextMime('UTF8_STRING'), 'UTF8_STRING');
    assert(isImageMime('image/png'), 'png');
    assert(!isImageMime('image/svg+xml'), 'svg must be excluded');
});

test('ClipboardItem JSON round-trip', () => {
    const original = textItem('round trip');
    const decoded = ClipboardItem.fromJSON(original.toJSON());
    assert(decoded.text === original.text, 'text');
    assert(decoded.hash === original.hash, 'hash');
    assert(decoded.createdAt.toISOString() === original.createdAt.toISOString(), 'date');
});

test('ClipboardItem rejects unsafe image names', () => {
    assert(ClipboardItem.fromJSON({
        kind: 'image',
        image: '../secret.png',
        hash: 'abc',
        createdAt: new Date().toISOString(),
    }) === null, 'path traversal must be rejected');
});

test('HistoryStore deduplicates and promotes', () => {
    const store = new HistoryStore({limit: 5});
    const first = textItem('one', 2);
    const second = textItem('two', 1);
    store.add(first);
    store.add(second);

    const result = store.add(textItem('one', 0));
    assert(result.item.hash === first.hash, 'existing item should be reused');
    assert(store.items[0].hash === first.hash, 'duplicate should move to top');
    assert(store.items.length === 2, 'no duplicate should be stored');
});

test('HistoryStore enforces the limit', () => {
    const store = new HistoryStore({limit: 3});
    for (let i = 0; i < 5; i++)
        store.add(textItem(`item ${i}`, 5 - i));
    assert(store.items.length === 3, 'limit should be enforced');
    assert(store.items[0].text === 'item 4', 'newest should be first');
});

test('HistoryStore search and quick slots', () => {
    const store = new HistoryStore({limit: 20});
    store.add(textItem('alpha', 3));
    store.add(textItem('beta', 2));
    store.add(textItem('alphabet', 1));

    assert(store.filtered('alpha').length === 2, 'search');
    assert(store.quickSlot('', 1)?.text === 'alphabet', 'slot 1');
    assert(store.quickSlot('', 0) === null, 'empty slot 0');
});

test('format helpers', () => {
    const date = new Date(2026, 10, 17, 15, 4, 5);
    assert(formatTimestamp(date) === '11-17 15:04:05', formatTimestamp(date));
    assert(formatBytes(0) === '0 B', 'zero bytes');
    assert(formatBytes(1536) === '1.5 KB', formatBytes(1536));
    assert(quickSlotLabel(0) === '1', 'slot label 0');
    assert(quickSlotLabel(9) === '0', 'slot label 9');
    assert(quickSlotLabel(10) === null, 'slot label 10');
});

test('version: isNewerVersion compares semver cleanly', () => {
    assert(isNewerVersion('0.4.2', '0.4.1'), 'patch bump');
    assert(isNewerVersion('0.5.0', '0.4.9'), 'minor bump');
    assert(isNewerVersion('1.0.0', '0.9.9'), 'major bump');
    assert(isNewerVersion('v0.4.2', '0.4.1'), 'v prefix');
    assert(isNewerVersion('0.4.1', '0.4'), '3-segment vs 2-segment');
    assert(!isNewerVersion('0.4.1', '0.4.1'), 'equal versions');
    assert(!isNewerVersion('0.4', '0.4.0'), 'equal 2-segment vs 3-segment');
    assert(!isNewerVersion('0.3.2', '0.4.1'), 'downgrade');
    assert(!isNewerVersion('', '0.4.1'), 'empty remote');
});

test('version: parseLinuxTagVersion accepts only linux/ubuntu tags', () => {
    assert(parseLinuxTagVersion('linux-v0.4.2') === '0.4.2', 'linux-v tag');
    assert(parseLinuxTagVersion('ubuntu-v0.5.0') === '0.5.0', 'ubuntu-v tag');
    assert(parseLinuxTagVersion('linux-0.4.2') === '0.4.2', 'linux numeric tag');
    assert(parseLinuxTagVersion('LINUX-V1.2.3') === '1.2.3', 'uppercase tag');
    assert(parseLinuxTagVersion('v0.3.2') === null, 'macOS v tag must be ignored');
    assert(parseLinuxTagVersion('v0.9.0') === null, 'higher macOS v tag must be ignored');
    assert(parseLinuxTagVersion('0.5.0') === null, 'unprefixed tag must be ignored');
    assert(parseLinuxTagVersion('macos-v0.5.0') === null, 'macOS prefix must be ignored');
    assert(parseLinuxTagVersion('linux-beta') === null, 'non-numeric tag must be ignored');
});

test('version: parseMetadataVersion validates metadata.json version-name', () => {
    assert(parseMetadataVersion({'version-name': '0.4.1'}) === '0.4.1', 'valid version');
    assert(parseMetadataVersion({'version-name': 'v0.4.2'}) === '0.4.2', 'prefixed version');
    assert(parseMetadataVersion({'version-name': ''}) === null, 'empty version');
    assert(parseMetadataVersion({'version-name': 'dev'}) === null, 'non-numeric version');
    assert(parseMetadataVersion(null) === null, 'null metadata');
});

test('version: pickLatestLinuxRelease skips drafts, prereleases, and macOS releases', () => {
    const macOnly = [
        {tag_name: 'v0.3.2', html_url: 'https://example.com/mac-0.3.2'},
        {tag_name: 'v0.9.0', html_url: 'https://example.com/mac-0.9.0'},
        {tag_name: 'macos-v1.0.0', html_url: 'https://example.com/mac-1.0.0'},
    ];
    assert(pickLatestLinuxRelease(macOnly) === null, 'macOS-only releases return null');

    const mixed = [
        {tag_name: 'v0.9.9', html_url: 'https://example.com/mac'},
        {tag_name: 'linux-v0.4.2', html_url: 'https://example.com/l1'},
        {tag_name: 'linux-v0.9.0', draft: true, html_url: 'https://example.com/draft'},
        {tag_name: 'ubuntu-v0.8.0', prerelease: true, html_url: 'https://example.com/pre'},
        {tag_name: 'ubuntu-v0.4.5', html_url: 'https://example.com/l2'},
    ];
    const picked = pickLatestLinuxRelease(mixed);
    assert(picked?.version === '0.4.5', 'highest stable linux/ubuntu release picked');
    assert(picked?.ref === 'ubuntu-v0.4.5', 'keeps original release tag ref');
});

const loop = new GLib.MainLoop(null, false);
runAsyncTests()
    .catch(error => {
        failures++;
        console.error(`FAIL async suite: ${error.message}`);
    })
    .finally(() => loop.quit());
loop.run();

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    imports.system.exit(1);
}

console.log('\nAll tests passed');
