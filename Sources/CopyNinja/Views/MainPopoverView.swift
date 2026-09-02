import AppKit
import SwiftUI

/// 360pt menu bar popover — follows the NightOwl layout spec:
/// header / Divider / search / Divider / scrollable history / Divider / footer.
struct MainPopoverView: View {
    @ObservedObject var store: ClipboardStore
    @ObservedObject var updater: UpdateChecker
    @ObservedObject var launchAtLogin: LaunchAtLoginManager
    var onClose: () -> Void

    @FocusState private var searchFocused: Bool

    private let coffeeURL = URL(string: "https://buymeacoffee.com/dwyi84d")!

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            searchBar
            Divider()
            content
            Divider()
            footer
        }
        .frame(width: 360, height: 520)
        .onAppear {
            searchFocused = true
            launchAtLogin.refresh()
        }
        .onChange(of: store.focusSearchToken) { _, _ in
            searchFocused = true
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            ShurikenIconView()
                .frame(width: 18, height: 18)
                .foregroundStyle(Color.accentColor)
            Text("CopyNinja")
                .font(.headline)
            Text("v\(UpdateChecker.currentVersion)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            updateIndicator
            if store.isOCRing {
                ProgressView()
                    .controlSize(.small)
                    .help("Recognizing text…")
            }
            Button {
                store.clearAll()
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(store.items.isEmpty)
            .help("Clear all history (⌘K)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var updateIndicator: some View {
        switch updater.updateState {
        case .idle:
            Button("Check for Updates") {
                updater.checkForUpdates()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Check for updates")
        case .checking:
            ProgressView()
                .controlSize(.mini)
                .help("Checking for updates…")
        case .downloading:
            ProgressView()
                .controlSize(.mini)
                .help("Downloading update…")
        case .upToDate:
            HStack(spacing: 3) {
                Image(systemName: "checkmark.circle")
                Text("Up to date")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        case .available(let release):
            Button("Update Available") {
                updater.presentUpdateConfirmation()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Update to v\(release.version)")
        case .failed:
            Button("Check Again") {
                updater.checkForUpdates()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Check for updates again")
        }
    }

    // MARK: - Search

    private var searchBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            TextField("Search history", text: $store.searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .focused($searchFocused)
            if !store.searchText.isEmpty {
                Button {
                    store.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .help("Clear search")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.gray.opacity(0.12))
        )
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Content

    private var content: some View {
        ZStack {
            mainContent
            if let quickLookItem = store.quickLookItem {
                QuickLookOverlay(
                    item: quickLookItem,
                    onClose: { store.dismissQuickLook() }
                )
                .zIndex(1)
            }
        }
    }

    @ViewBuilder
    private var mainContent: some View {
        if store.filteredItems.isEmpty {
            emptyState
        } else {
            historyList
        }
    }

    private var historyList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(Array(store.filteredItems.enumerated()), id: \.element.id) { index, item in
                        HistoryRowView(
                            item: item,
                            isSelected: store.selectedItem?.id == item.id,
                            quickSlotLabel: Self.quickSlotLabel(for: index),
                            onCopy: {
                                store.copyToClipboard(item)
                                onClose()
                            },
                            onOCR: {
                                store.performOCRCopy(for: item)
                            }
                        )
                        .id(item.id)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
            .onChange(of: store.selectedIndex) { _, newIndex in
                guard let index = newIndex,
                      store.filteredItems.indices.contains(index) else { return }
                withAnimation(.easeOut(duration: 0.12)) {
                    proxy.scrollTo(store.filteredItems[index].id, anchor: .center)
                }
            }
        }
    }

    /// 1–9 → "1"…"9", 10th → "0".
    private static func quickSlotLabel(for index: Int) -> String? {
        guard index < 10 else { return nil }
        return index == 9 ? "0" : "\(index + 1)"
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            ShurikenIconView()
                .frame(width: 44, height: 44)
                .foregroundStyle(Color.gray.opacity(0.35))
            Text(store.searchText.isEmpty ? "No history yet" : "No results")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
            Text(store.searchText.isEmpty
                 ? "Copied text and images will appear here."
                 : "Try a different search term.")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 6) {
            Text(verbatim: "↑↓ Move · ⌘1~0 Copy · ⇧Click/⌘⇧1~0 OCR · Space Preview · ⌘K Clear")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(verbatim: "⌘⇧V Toggle · Esc Close")
                .font(.caption2)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Link(destination: coffeeURL) {
                    HStack(spacing: 4) {
                        Text("☕")
                        Text("Buy me a coffee")
                            .font(.caption.weight(.semibold))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(red: 1.0, green: 0.87, blue: 0.0))
                    )
                    .foregroundStyle(.black)
                }
                .buttonStyle(.plain)

                Spacer()

                Toggle("Launch at Login", isOn: Binding(
                    get: { launchAtLogin.isEnabled },
                    set: { launchAtLogin.setEnabled($0) }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                .help("Start CopyNinja automatically when you log in")

                Button("Quit") {
                    NSApp.terminate(nil)
                }
                .controlSize(.small)
                .help("Quit CopyNinja (⌘Q)")
            }

            Text("Crafted by MelissaSoft")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
