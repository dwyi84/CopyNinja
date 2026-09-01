import AppKit
import Foundation

/// Owns all on-disk state under `~/Library/Application Support/CopyNinja/`:
///
///     CopyNinja/
///     ├── history.json   ← ordered index of ClipboardItem entries
///     └── images/        ← UUID.png originals (+ UUID.thumb.png thumbnails)
///
/// All heavy disk I/O funnels through a serial utility queue; the main thread
/// only ever encodes the (small) history JSON.
final class PersistenceManager: @unchecked Sendable {
    static let shared = PersistenceManager()

    let baseURL: URL
    let imagesURL: URL
    private let historyFileURL: URL
    private let queue = DispatchQueue(
        label: "com.melissasoft.copyninja.persistence",
        qos: .utility
    )

    private init() {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        ).first ?? URL(fileURLWithPath: NSHomeDirectory() + "/Library/Application Support")
        baseURL = appSupport.appendingPathComponent("CopyNinja", isDirectory: true)
        imagesURL = baseURL.appendingPathComponent("images", isDirectory: true)
        historyFileURL = baseURL.appendingPathComponent("history.json")
        try? FileManager.default.createDirectory(at: imagesURL, withIntermediateDirectories: true)
    }

    // MARK: - History index

    func loadHistory() -> [ClipboardItem] {
        guard let data = try? Data(contentsOf: historyFileURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([ClipboardItem].self, from: data)) ?? []
    }

    /// Atomically writes the history index and prunes image files that are
    /// no longer referenced by any entry.
    func saveHistory(_ items: [ClipboardItem]) {
        queue.async { [self] in
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            guard let data = try? encoder.encode(items) else { return }
            do {
                try data.write(to: historyFileURL, options: .atomic)
            } catch {
                NSLog("CopyNinja: failed to save history — \(error.localizedDescription)")
            }
            pruneImages(referencing: Set(items.compactMap(\.imageFileName)))
        }
    }

    // MARK: - Clear All

    /// Deletes the history index and every cached image file.
    func wipeAll() {
        queue.async { [self] in
            try? FileManager.default.removeItem(at: historyFileURL)
            if let files = try? FileManager.default.contentsOfDirectory(
                at: imagesURL, includingPropertiesForKeys: nil
            ) {
                for file in files {
                    try? FileManager.default.removeItem(at: file)
                }
            }
        }
    }

    // MARK: - Images

    /// Writes an original PNG and its thumbnail under `images/`
    /// (`UUID.png` + `UUID.thumb.png`). Thread-safe and synchronous.
    /// Returns the original file name, or `nil` on failure.
    func saveImagePair(originalPNG: Data, thumbnailPNG: Data) -> String? {
        queue.sync { [self] in
            let baseID = UUID().uuidString
            let originalName = baseID + ".png"
            let thumbnailName = baseID + ".thumb.png"
            do {
                try originalPNG.write(
                    to: imagesURL.appendingPathComponent(originalName), options: .atomic
                )
                try thumbnailPNG.write(
                    to: imagesURL.appendingPathComponent(thumbnailName), options: .atomic
                )
                return originalName
            } catch {
                NSLog("CopyNinja: failed to save image — \(error.localizedDescription)")
                try? FileManager.default.removeItem(
                    at: imagesURL.appendingPathComponent(originalName)
                )
                try? FileManager.default.removeItem(
                    at: imagesURL.appendingPathComponent(thumbnailName)
                )
                return nil
            }
        }
    }

    func imageFileURL(_ fileName: String) -> URL {
        imagesURL.appendingPathComponent(fileName)
    }

    func imageData(_ fileName: String) -> Data? {
        try? Data(contentsOf: imageFileURL(fileName))
    }

    // MARK: - Pruning

    /// Removes image files (originals + thumbnails) that no history entry
    /// references anymore. Runs on the persistence queue.
    private func pruneImages(referencing referenced: Set<String>) {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: imagesURL, includingPropertiesForKeys: nil
        ) else { return }
        for file in files {
            let name = file.lastPathComponent
            let baseName: String
            if name.hasSuffix(".thumb.png") {
                baseName = String(name.dropLast(".thumb.png".count)) + ".png"
            } else {
                baseName = name
            }
            if !referenced.contains(baseName) {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
}
