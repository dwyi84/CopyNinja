import AppKit
import SwiftUI

/// Space-triggered Quick Look: a centered card over a dimmed backdrop,
/// shown inside the popover. Click anywhere to dismiss.
struct QuickLookOverlay: View {
    let item: ClipboardItem
    var onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.35)
                .contentShape(Rectangle())
                .onTapGesture { onClose() }
            card
                .padding(24)
        }
        .transition(.opacity)
    }

    @ViewBuilder
    private var card: some View {
        switch item.kind {
        case .text:
            VStack(spacing: 0) {
                ScrollView {
                    Text(item.previewText)
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
            }
            .frame(width: 320, height: 380)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.gray.opacity(0.3))
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .shadow(color: .black.opacity(0.25), radius: 12)

        case .image:
            if let fileName = item.imageFileName,
               let image = ImageCache.shared.original(for: fileName) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: 320, maxHeight: 380)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.gray.opacity(0.3))
                    )
                    .shadow(color: .black.opacity(0.25), radius: 12)
            } else {
                Label("Image unavailable", systemImage: "photo.badge.exclamationmark")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.regularMaterial)
                    )
            }
        }
    }
}
