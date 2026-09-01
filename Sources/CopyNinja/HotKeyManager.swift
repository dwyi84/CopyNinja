import Carbon.HIToolbox
import Foundation

/// Global hot key registration via Carbon's RegisterEventHotKey — no
/// third-party dependencies. The callback fires on the main thread.
final class HotKeyManager: @unchecked Sendable {
    static let shared = HotKeyManager()

    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private var onFire: (@MainActor () -> Void)?

    /// Registers Cmd+Shift+V as the show/hide hot key. `onFire` is invoked
    /// on the main thread.
    func registerToggleHotKey(onFire: @escaping @MainActor () -> Void) {
        self.onFire = onFire

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            hotKeyEventHandler,
            1,
            &eventType,
            nil,
            &handlerRef
        )
        guard installStatus == noErr else {
            NSLog("CopyNinja: failed to install hot key handler — \(installStatus)")
            return
        }

        let hotKeyID = EventHotKeyID(signature: OSType(0x434E_4A4E) /* 'CNJN' */, id: 1)
        let registerStatus = RegisterEventHotKey(
            UInt32(kVK_ANSI_V),
            UInt32(cmdKey | shiftKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        guard registerStatus == noErr else {
            NSLog("CopyNinja: failed to register ⌘⇧V — \(registerStatus)")
            return
        }
    }

    @MainActor
    fileprivate func fire() {
        onFire?()
    }
}

/// C-function-pointer entry point. Carbon delivers hot key events on the
/// main thread, so it is safe to hop onto the main actor.
private func hotKeyEventHandler(
    _ callRef: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard event != nil else { return noErr }
    MainActor.assumeIsolated {
        HotKeyManager.shared.fire()
    }
    return noErr
}
