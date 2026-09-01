import AppKit
import Foundation

/// NSCache-backed store for decoded thumbnails and full-size images so list
/// scrolling stays smooth and originals are only decoded on demand (Quick Look).
final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()

    private let thumbnails = NSCache<NSString, NSImage>()
    private let originals = NSCache<NSString, NSImage>()

    private init() {
        thumbnails.countLimit = 300
        originals.countLimit = 20
    }

    /// Decoded thumbnail for an original image file name (`UUID.png`).
    func thumbnail(for originalFileName: String) -> NSImage? {
        let key = originalFileName as NSString
        if let cached = thumbnails.object(forKey: key) { return cached }
        guard let data = PersistenceManager.shared.imageData(Self.thumbName(for: originalFileName)),
              let image = NSImage(data: data) else { return nil }
        thumbnails.setObject(image, forKey: key)
        return image
    }

    /// Full-resolution image, decoded only for Quick Look.
    func original(for fileName: String) -> NSImage? {
        let key = fileName as NSString
        if let cached = originals.object(forKey: key) { return cached }
        guard let data = PersistenceManager.shared.imageData(fileName),
              let image = NSImage(data: data) else { return nil }
        originals.setObject(image, forKey: key)
        return image
    }

    /// `UUID.png` → `UUID.thumb.png`
    static func thumbName(for originalFileName: String) -> String {
        guard originalFileName.hasSuffix(".png") else {
            return originalFileName + ".thumb.png"
        }
        return String(originalFileName.dropLast(4)) + ".thumb.png"
    }
}
