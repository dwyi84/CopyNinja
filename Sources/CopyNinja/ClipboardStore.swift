import AppKit
import Combine
import Foundation

@MainActor
final class ClipboardStore: ObservableObject {
    static let maxItems = 500

    @Published private(set) var items: [ClipboardItem] = []
    @Published var searchText = "" {
        didSet { selectTop() }
    }
    @Published private(set) var selectedIndex: Int?
    /// Bumped whenever the popover wants the search field (re)focused.
    @Published private(set) var focusSearchToken = 0
    /// Quick Look (Space) is showing when non-nil; the preview follows the
    /// current selection.
    @Published private(set) var quickLookItemID: UUID?
    /// True while Vision OCR is running for an image item.
    @Published var isOCRing = false

    /// Set by the AppDelegate so that CopyNinja's own clipboard writes are
    /// not re-collected by the monitor.
    var willWriteToClipboard: (() -> Void)?

    /// Called when a flow inside the store decides the popover should close
    /// (copy/OCR completion). Set by the AppDelegate.
    var onDismiss: (() -> Void)?

    private let persistence = PersistenceManager.shared

    init() {
        let loaded = persistence.loadHistory()
        items = Array(loaded.prefix(Self.maxItems))
    }

    var filteredItems: [ClipboardItem] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return items }
        return items.filter { item in
            [item.text, item.ocrText].compactMap { $0 }
                .contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    var selectedItem: ClipboardItem? {
        guard let index = selectedIndex, filteredItems.indices.contains(index) else { return nil }
        return filteredItems[index]
    }

    /// The item shown in the Quick Look overlay (follows the selection).
    var quickLookItem: ClipboardItem? {
        guard quickLookItemID != nil else { return nil }
        return selectedItem
    }

    func toggleQuickLook() {
        quickLookItemID = quickLookItemID == nil ? selectedItem?.id : nil
    }

    func dismissQuickLook() {
        quickLookItemID = nil
    }

    // MARK: - Quick slots (⌘1~⌘9, ⌘0)

    /// Maps quick slot 1–9 to the first 9 entries and 0 to the 10th entry of
    /// the filtered list.
    func quickSlotItem(_ slot: Int) -> ClipboardItem? {
        let index = slot == 0 ? 9 : slot - 1
        guard filteredItems.indices.contains(index) else { return nil }
        return filteredItems[index]
    }

    // MARK: - Presentation

    /// Called every time the popover is about to be shown.
    func prepareForPresentation() {
        searchText = ""
        quickLookItemID = nil
        selectTop()
        focusSearchToken += 1
    }

    func selectTop() {
        selectedIndex = filteredItems.isEmpty ? nil : 0
    }

    func moveSelection(_ delta: Int) {
        let count = filteredItems.count
        guard count > 0 else { return }
        let current = selectedIndex ?? 0
        selectedIndex = min(max(current + delta, 0), count - 1)
    }

    // MARK: - Capture (from ClipboardMonitor)

    /// Inserts a freshly captured clipboard snapshot. Re-captured content is
    /// deduplicated: the existing entry is removed and the new one is placed
    /// at the top.
    func add(_ capture: ClipboardCapture) {
        switch capture.content {
        case .text(let string):
            let item = ClipboardItem(
                id: UUID(),
                kind: .text,
                text: string,
                imageFileName: nil,
                ocrText: nil,
                date: Date(),
                hash: ClipboardHash.sha256Hex(Data(string.utf8))
            )
            insertDeduplicated(item)
        case .image(let originalPNG, let thumbnailPNG):
            guard let fileName = persistence.saveImagePair(
                originalPNG: originalPNG, thumbnailPNG: thumbnailPNG
            ) else { return }
            let item = ClipboardItem(
                id: UUID(),
                kind: .image,
                text: nil,
                imageFileName: fileName,
                ocrText: nil,
                date: Date(),
                hash: ClipboardHash.sha256Hex(originalPNG)
            )
            insertDeduplicated(item)
        case .imageRaw:
            break // handled by ImageProcessor before reaching the store
        }
    }

    // MARK: - Copy

    /// Writes the item back to the system clipboard (selection = reuse) and
    /// deduplicates by promoting the existing entry to the top of the list.
    func copyToClipboard(_ item: ClipboardItem) {
        willWriteToClipboard?()
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        switch item.kind {
        case .text:
            pasteboard.setString(item.text ?? "", forType: .string)
        case .image:
            if let fileName = item.imageFileName,
               let image = ImageCache.shared.original(for: fileName) {
                pasteboard.writeObjects([image])
            }
        }
        promoteToTop(item)
    }

    // MARK: - OCR (Shift+Enter, Shift+click, row button, ⌘⇧1~0)

    /// Copy + dismiss for text; OCR-extract → copy → dismiss for images.
    /// Text extracted from an image is registered as a brand-new top entry.
    func performOCRCopy(for item: ClipboardItem) {
        guard !isOCRing else { return }
        switch item.kind {
        case .text:
            copyToClipboard(item)
            onDismiss?()
        case .image:
            isOCRing = true
            Task { @MainActor in
                let text = await runOCR(for: item)
                isOCRing = false
                if let text {
                    registerOCRResult(text)
                    onDismiss?()
                }
                // No text found: keep the popover open so the user can retry.
            }
        }
    }

    /// Runs Vision OCR for an image item, caches the result on the item, and
    /// returns the recognized text (or the cached value on repeat calls).
    func runOCR(for item: ClipboardItem) async -> String? {
        if let cached = item.ocrText { return cached }
        guard let fileName = item.imageFileName,
              let data = persistence.imageData(fileName) else { return nil }
        let text = await OCRService.recognizeText(pngData: data)
        if let text, let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index].ocrText = text
            persist()
        }
        return text
    }

    /// Writes recognized text to the system clipboard and registers it as a
    /// brand-new top history entry (Shift+Enter on an image).
    func registerOCRResult(_ text: String) {
        willWriteToClipboard?()
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        let item = ClipboardItem(
            id: UUID(),
            kind: .text,
            text: text,
            imageFileName: nil,
            ocrText: nil,
            date: Date(),
            hash: ClipboardHash.sha256Hex(Data(text.utf8))
        )
        insertDeduplicated(item)
    }

    // MARK: - Clear All

    /// Wipes in-memory history, on-disk history/images, and the system
    /// clipboard — leaving no trace of the cleared content.
    func clearAll() {
        items.removeAll()
        selectedIndex = nil
        searchText = ""
        NSPasteboard.general.clearContents()
        persistence.wipeAll()
    }

    // MARK: - Deduplication

    /// Re-captured content that already exists is removed first, then the new
    /// entry is inserted at the top. The list is capped at `maxItems` and
    /// every mutation is persisted.
    private func insertDeduplicated(_ item: ClipboardItem) {
        let previousSelectedID = selectedItem?.id
        if let index = items.firstIndex(where: { $0.hash == item.hash }) {
            items.remove(at: index)
        }
        items.insert(item, at: 0)
        if items.count > Self.maxItems {
            items.removeLast(items.count - Self.maxItems)
        }
        restoreSelection(previousSelectedID)
        persist()
    }

    /// Deletes the existing entry for `item` and re-inserts it at the top
    /// with a refreshed timestamp.
    private func promoteToTop(_ item: ClipboardItem) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        var promoted = items.remove(at: index)
        promoted.date = Date()
        items.insert(promoted, at: 0)
        restoreSelection(item.id)
        persist()
    }

    /// Keeps the keyboard selection anchored to the same content when the
    /// list order changes underneath it (new capture, reuse promotion).
    private func restoreSelection(_ previousSelectedID: UUID?) {
        guard let previousSelectedID else { return }
        selectedIndex = filteredItems.firstIndex(where: { $0.id == previousSelectedID })
    }

    private func persist() {
        persistence.saveHistory(items)
    }
}
