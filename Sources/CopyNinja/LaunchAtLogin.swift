import AppKit
import Foundation
import ServiceManagement

/// Toggles macOS "Launch at Login" via `SMAppService.mainApp` — no helper
/// binaries. The system's Login Items state is the single source of truth.
@MainActor
final class LaunchAtLoginManager: ObservableObject {

    static let shared = LaunchAtLoginManager()

    @Published private(set) var isEnabled = false
    /// `true` when registration succeeded but macOS still waits for user
    /// approval in System Settings → General → Login Items.
    @Published private(set) var needsApproval = false

    private init() {
        refresh()
    }

    func refresh() {
        switch SMAppService.mainApp.status {
        case .enabled:
            isEnabled = true
            needsApproval = false
        case .requiresApproval:
            isEnabled = true
            needsApproval = true
        case .notRegistered, .notFound:
            isEnabled = false
            needsApproval = false
        @unknown default:
            isEnabled = false
            needsApproval = false
        }
    }

    func setEnabled(_ enabled: Bool) {
        do {
            switch (enabled, SMAppService.mainApp.status) {
            case (true, .enabled), (true, .requiresApproval),
                 (false, .notRegistered), (false, .notFound):
                break // already in the requested state
            case (true, _):
                try SMAppService.mainApp.register()
            case (false, _):
                try SMAppService.mainApp.unregister()
            }
        } catch {
            NSLog("CopyNinja: launch at login toggle failed — \(error.localizedDescription)")
        }
        refresh()
        if enabled && needsApproval {
            openLoginItemsSettings()
        }
    }

    private func openLoginItemsSettings() {
        if let url = URL(
            string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
        ) {
            NSWorkspace.shared.open(url)
        }
    }
}
