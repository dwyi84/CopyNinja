import AppKit
import Foundation

/// Heavy image work (PNG canonicalization + thumbnail generation) that runs
/// on the clipboard polling queue — never on the main thread.
enum ImageProcessor {
    static let thumbnailMaxDimension: CGFloat = 220

    /// Passes text through untouched; for images, canonicalizes the raw
    /// pasteboard bytes to PNG and renders a small thumbnail. Returns `nil`
    /// when the image cannot be processed.
    static func prepare(_ capture: ClipboardCapture) -> ClipboardCapture? {
        switch capture.content {
        case .text:
            return capture
        case .imageRaw(let raw):
            guard let representation = NSBitmapImageRep(data: raw),
                  let originalPNG = representation.representation(using: .png, properties: [:]),
                  let thumbnailPNG = makeThumbnail(from: representation) else {
                return nil
            }
            return ClipboardCapture(
                content: .image(originalPNG: originalPNG, thumbnailPNG: thumbnailPNG)
            )
        case .image:
            return capture
        }
    }

    /// High-quality downscale to `thumbnailMaxDimension`, encoded as PNG.
    private static func makeThumbnail(from representation: NSBitmapImageRep) -> Data? {
        guard let cgImage = representation.cgImage else { return nil }
        let width = cgImage.width
        let height = cgImage.height
        let scale = min(1, thumbnailMaxDimension / CGFloat(max(width, height)))
        let thumbWidth = max(1, Int((CGFloat(width) * scale).rounded()))
        let thumbHeight = max(1, Int((CGFloat(height) * scale).rounded()))

        guard let context = CGContext(
            data: nil,
            width: thumbWidth,
            height: thumbHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: thumbWidth, height: thumbHeight))

        guard let thumbnail = context.makeImage() else { return nil }
        let thumbnailRep = NSBitmapImageRep(cgImage: thumbnail)
        guard let data = thumbnailRep.representation(using: .png, properties: [:]) else {
            return nil
        }
        return data
    }
}
