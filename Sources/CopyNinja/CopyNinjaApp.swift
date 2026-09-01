import AppKit
import SwiftUI

@main
struct CopyNinjaApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // The app is a pure LSUIElement menu bar agent — no windows.
        // The scene is only here to satisfy the SwiftUI lifecycle.
        Settings {
            EmptyView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = ClipboardStore()
    let updateChecker = UpdateChecker()

    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var rightClickMenu: NSMenu!
    private var keyDownMonitor: Any?
    private var clipboardMonitor: ClipboardMonitor!

    private let popoverWidth: CGFloat = 360
    private let popoverHeight: CGFloat = 520

    /// ANSI key codes for the top-row digits, mapped to quick slot numbers.
    private static let quickSlotKeyCodes: [UInt16: Int] = [
        18: 1, 19: 2, 20: 3, 21: 4, 23: 5, 22: 6, 26: 7, 28: 8, 25: 9, 29: 0
    ]

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = Self.makeMinimalMainMenu()

        setupStatusItem()
        setupPopover()
        setupClipboardMonitor()
        setupGlobalHotKey()
        installKeyDownMonitor()

        store.onDismiss = { [weak self] in self?.closePopover() }
        updateChecker.checkForUpdates()
    }

    // MARK: - Global hot key (⌘⇧V)

    private func setupGlobalHotKey() {
        HotKeyManager.shared.registerToggleHotKey { [weak self] in
            self?.togglePopover()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let keyDownMonitor {
            NSEvent.removeMonitor(keyDownMonitor)
        }
        clipboardMonitor?.stop()
    }

    // MARK: - Clipboard monitoring

    private func setupClipboardMonitor() {
        clipboardMonitor = ClipboardMonitor { [store] capture in
            store.add(capture)
        }
        store.willWriteToClipboard = { [weak self] in
            self?.clipboardMonitor.suppressNextChange()
        }
        clipboardMonitor.start()
    }

    // MARK: - Status item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem.button else { return }

        button.image = ShurikenMenuBarIcon.image()
        button.target = self
        button.action = #selector(statusItemClicked(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])

        rightClickMenu = NSMenu()
        rightClickMenu.addItem(
            withTitle: "Show CopyNinja",
            action: #selector(showPopoverFromMenu),
            keyEquivalent: ""
        )
        rightClickMenu.addItem(.separator())
        rightClickMenu.addItem(
            withTitle: "Check for Updates",
            action: #selector(checkForUpdatesFromMenu),
            keyEquivalent: ""
        )
        rightClickMenu.addItem(.separator())
        rightClickMenu.addItem(
            withTitle: "Clear All History",
            action: #selector(clearAllFromMenu),
            keyEquivalent: ""
        )
        rightClickMenu.addItem(.separator())
        rightClickMenu.addItem(
            withTitle: "Quit CopyNinja",
            action: #selector(quitApp),
            keyEquivalent: "q"
        )
    }

    // MARK: - Popover

    private func setupPopover() {
        popover = NSPopover()
        popover.behavior = .transient
        let hosting = NSHostingController(
            rootView: MainPopoverView(
                store: store,
                updater: updateChecker,
                onClose: { [weak self] in self?.closePopover() }
            )
        )
        popover.contentViewController = hosting
        popover.contentSize = NSSize(width: popoverWidth, height: popoverHeight)
    }

    @objc private func statusItemClicked(_ sender: Any?) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            statusItem.menu = rightClickMenu
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
        } else {
            togglePopover()
        }
    }

    @objc private func showPopoverFromMenu() {
        showPopover()
    }

    @objc private func clearAllFromMenu() {
        store.clearAll()
    }

    @objc private func checkForUpdatesFromMenu() {
        updateChecker.openReleasePageIfAvailable()
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    func togglePopover() {
        if popover.isShown {
            closePopover()
        } else {
            showPopover()
        }
    }

    private func showPopover() {
        guard let button = statusItem.button else { return }
        store.prepareForPresentation()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    private func closePopover() {
        popover.performClose(nil)
    }

    // MARK: - Keyboard navigation

    private func installKeyDownMonitor() {
        keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.popover.isShown else { return event }
            return self.handleKeyDown(event)
        }
    }

    private func handleKeyDown(_ event: NSEvent) -> NSEvent? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let keyCode = event.keyCode

        if keyCode == 53 { // Esc — dismiss Quick Look first, then the popover
            if store.quickLookItem != nil {
                store.dismissQuickLook()
            } else {
                closePopover()
            }
            return nil
        }

        if flags.contains(.command) {
            if event.charactersIgnoringModifiers == "k" { // Cmd+K
                store.clearAll()
                return nil
            }
            if keyCode == 117 && flags.contains(.shift) { // Cmd+Shift+ForwardDelete
                store.clearAll()
                return nil
            }
            if let slot = Self.quickSlotKeyCodes[keyCode] { // ⌘1~0 / ⌘⇧1~0
                if let item = store.quickSlotItem(slot) {
                    if flags.contains(.shift) {
                        store.performOCRCopy(for: item)
                    } else {
                        store.copyToClipboard(item)
                        closePopover()
                    }
                }
                return nil
            }
            return event
        }
        if flags.contains(.option) || flags.contains(.control) {
            return event
        }

        switch keyCode {
        case 126: // ↑
            store.moveSelection(-1)
            return nil
        case 125: // ↓
            store.moveSelection(1)
            return nil
        case 36: // Return
            if flags.contains(.shift) {
                if let item = store.selectedItem ?? store.filteredItems.first {
                    store.performOCRCopy(for: item)
                }
            } else {
                copySelectedAndClose()
            }
            return nil
        case 49: // Space — Quick Look while nothing is being typed
            if store.searchText.isEmpty, store.selectedItem != nil {
                store.toggleQuickLook()
                return nil
            }
            return event
        default:
            return event
        }
    }

    private func copySelectedAndClose() {
        guard let item = store.selectedItem ?? store.filteredItems.first else { return }
        store.copyToClipboard(item)
        closePopover()
    }

    // MARK: - Minimal main menu (enables ⌘X/⌘C/⌘V/⌘A in the search field)

    private static func makeMinimalMainMenu() -> NSMenu {
        let mainMenu = NSMenu()
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        mainMenu.addItem(editItem)
        return mainMenu
    }
}
