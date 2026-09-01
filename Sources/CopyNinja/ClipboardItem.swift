import Foundation

enum ClipboardKind: String, Codable, Sendable {
    case text
    case image
}

/// A single captured clipboard entry. Text lives inline; images are stored
/// as files on disk and referenced by file name (see PersistenceManager).
struct ClipboardItem: Identifiable, Equatable, Codable, Sendable {
    let id: UUID
    let kind: ClipboardKind
    var text: String?
    var imageFileName: String?
    var ocrText: String?
    var date: Date
    /// Content fingerprint (SHA-256 hex) used for deduplication.
    let hash: String

    var previewText: String {
        switch kind {
        case .text:
            return text ?? ""
        case .image:
            return ocrText ?? "Image"
        }
    }
}
