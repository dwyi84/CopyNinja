import AppKit
import Foundation

struct ReleaseInfo: Equatable {
    let version: String
    let htmlURL: URL
    let assetURL: URL?
}

/// GitHub Releases updater modeled after LookHere's: check → confirmation
/// popup → download the release zip → swap the running .app via a detached
/// helper script → relaunch. No page redirect, no Sparkle dependency.
@MainActor
final class UpdateChecker: ObservableObject {

    enum UpdateState: Equatable {
        case idle
        case checking
        case downloading
        case upToDate
        case available(release: ReleaseInfo)
        case failed
    }

    static let repoOwner = "dwyi84"
    static let repoName = "CopyNinja"
    static let currentVersion =
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.3.1"

    @Published private(set) var updateState: UpdateState = .idle

    private static let apiURL = URL(
        string: "https://api.github.com/repos/\(repoOwner)/\(repoName)/releases/latest"
    )!

    var isBusy: Bool { updateState == .checking || updateState == .downloading }

    // MARK: - Check

    /// Silent inline check (launch auto-check + popover header button).
    func checkForUpdates() {
        guard !isBusy else { return }
        updateState = .checking
        Task { [weak self] in
            guard let self else { return }
            if let release = await Self.fetchLatestRelease() {
                if Self.isNewer(release.version) {
                    updateState = .available(release: release)
                } else {
                    updateState = .upToDate
                    scheduleIdleReset()
                }
            } else {
                updateState = .failed
                scheduleIdleReset()
            }
        }
    }

    /// Menu action: runs a fresh check and presents the outcome — an update
    /// prompt (Update Now / Later), an up-to-date note, or an error.
    func checkForUpdatesPresentingAlert() {
        guard !isBusy else { return }
        updateState = .checking
        Task { [weak self] in
            guard let self else { return }
            if let release = await Self.fetchLatestRelease() {
                if Self.isNewer(release.version) {
                    updateState = .available(release: release)
                    presentUpdateConfirmation()
                } else {
                    updateState = .upToDate
                    scheduleIdleReset()
                    Self.presentUpToDateAlert()
                }
            } else {
                updateState = .failed
                scheduleIdleReset()
                Self.presentFailedAlert()
            }
        }
    }

    /// "Update to vX?" prompt. Also used by the popover's Update Available
    /// button. Confirming downloads and installs without leaving the app.
    func presentUpdateConfirmation() {
        guard case .available(let release) = updateState else { return }
        let alert = NSAlert()
        alert.messageText = "Update to v\(release.version)?"
        alert.informativeText =
            "A new version (v\(release.version)) is available — you're on v\(Self.currentVersion). "
            + "It will download and install automatically, then CopyNinja relaunches."
        alert.addButton(withTitle: "Update Now")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            downloadAndInstall()
        }
    }

    private func downloadAndInstall() {
        guard case .available(let release) = updateState, let assetURL = release.assetURL else {
            updateState = .failed
            scheduleIdleReset()
            return
        }
        updateState = .downloading
        Task { [weak self] in
            guard let self else { return }
            do {
                let zipURL = try await Self.downloadAsset(from: assetURL)
                Self.installAndRelaunch(zipURL: zipURL)
            } catch {
                NSLog("CopyNinja: update download failed — \(error.localizedDescription)")
                updateState = .failed
                scheduleIdleReset()
            }
        }
    }

    private func scheduleIdleReset() {
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard let self else { return }
            if updateState == .upToDate || updateState == .failed {
                updateState = .idle
            }
        }
    }

    // MARK: - GitHub Releases plumbing (mirrors LookHere)

    private static func fetchLatestRelease() async -> ReleaseInfo? {
        var request = URLRequest(url: apiURL)
        request.setValue("CopyNinja/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 8

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let rawTag = json?["tag_name"] as? String,
                  let html = json?["html_url"] as? String,
                  let url = URL(string: html) else {
                return nil
            }
            // Prefer the .zip release asset for the in-app update flow.
            let assetURL = (json?["assets"] as? [[String: Any]])?
                .compactMap { $0["browser_download_url"] as? String }
                .compactMap(URL.init(string:))
                .first { $0.pathExtension == "zip" }
            // Store the version without the "v" tag prefix — the UI adds it.
            let version = rawTag.hasPrefix("v") ? String(rawTag.dropFirst()) : rawTag
            return ReleaseInfo(version: version, htmlURL: url, assetURL: assetURL)
        } catch {
            return nil
        }
    }

    static func isNewer(_ version: String) -> Bool {
        let cleaned = version.hasPrefix("v") ? String(version.dropFirst()) : version
        return cleaned.compare(currentVersion, options: .numeric) == .orderedDescending
    }

    /// Downloads the release asset zip to a temporary location.
    private static func downloadAsset(from url: URL) async throws -> URL {
        var request = URLRequest(url: url)
        request.setValue("CopyNinja/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 120
        let (tempURL, response) = try await URLSession.shared.download(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw URLError(.badServerResponse)
        }
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("zip")
        try FileManager.default.moveItem(at: tempURL, to: destination)
        return destination
    }

    /// Replaces the running .app with the downloaded one and relaunches.
    /// A detached helper script does the swap after this process exits.
    private static func installAndRelaunch(zipURL: URL) {
        let bundleURL = Bundle.main.bundleURL
        let appPath = bundleURL.path
        let appDir = bundleURL.deletingLastPathComponent().path
        let scriptPath = (NSTemporaryDirectory() as NSString)
            .appendingPathComponent("copyninja-update.sh")

        let script = """
        #!/bin/bash
        sleep 1
        pkill -x CopyNinja 2>/dev/null || true
        sleep 0.5
        rm -rf "\(appPath)"
        ditto -x -k "\(zipURL.path)" "\(appDir)"
        chmod +x "\(appPath)/Contents/MacOS/CopyNinja" 2>/dev/null || true
        open "\(appPath)"
        rm -f "\(zipURL.path)" "\(scriptPath)"
        exit 0
        """

        try? script.write(toFile: scriptPath, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: scriptPath
        )

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptPath]
        try? process.run()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            NSApp.terminate(nil)
        }
    }

    // MARK: - Result alerts

    private static func presentUpToDateAlert() {
        let alert = NSAlert()
        alert.messageText = "You're Up to Date"
        alert.informativeText = "CopyNinja v\(currentVersion) is the latest version."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private static func presentFailedAlert() {
        let alert = NSAlert()
        alert.messageText = "Update Check Failed"
        alert.informativeText =
            "Could not reach GitHub Releases. Check your connection and try again."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
