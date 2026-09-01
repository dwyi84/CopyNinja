import AppKit
import Foundation

/// Lightweight GitHub Releases update check, modeled after NightOwl's
/// updater: queries the Releases API, compares versions numerically, and
/// exposes the release page URL. No download/install flow.
@MainActor
final class UpdateChecker: ObservableObject {

    enum UpdateState: Equatable {
        case idle
        case checking
        case upToDate
        case available(version: String, url: URL)
        case failed
    }

    static let repoOwner = "dwyi84"
    static let repoName = "CopyNinja"
    static let currentVersion =
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.1.0"

    @Published private(set) var updateState: UpdateState = .idle

    private static let apiURL = URL(
        string: "https://api.github.com/repos/\(repoOwner)/\(repoName)/releases/latest"
    )!

    var isBusy: Bool { updateState == .checking }

    // MARK: - Check

    func checkForUpdates() {
        guard !isBusy else { return }
        updateState = .checking
        Task { [weak self] in
            guard let self else { return }
            if let release = await Self.fetchLatestRelease() {
                if Self.isNewer(release.version) {
                    updateState = .available(version: release.version, url: release.htmlURL)
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

    /// Menu action: opens the release page when an update is already known to
    /// exist, otherwise runs a fresh check.
    func openReleasePageIfAvailable() {
        if case .available(_, let url) = updateState {
            NSWorkspace.shared.open(url)
        } else {
            checkForUpdates()
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

    // MARK: - GitHub Releases plumbing (mirrors NightOwl)

    private struct ReleaseInfo {
        let version: String
        let htmlURL: URL
    }

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
            // Store the version without the "v" tag prefix — the UI adds it.
            let tag = rawTag.hasPrefix("v") ? String(rawTag.dropFirst()) : rawTag
            return ReleaseInfo(version: tag, htmlURL: url)
        } catch {
            return nil
        }
    }

    private static func isNewer(_ version: String) -> Bool {
        let cleaned = version.hasPrefix("v") ? String(version.dropFirst()) : version
        return cleaned.compare(currentVersion, options: .numeric) == .orderedDescending
    }
}
