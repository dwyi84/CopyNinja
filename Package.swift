// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CopyNinja",
    platforms: [
        .macOS("14.0")
    ],
    targets: [
        .executableTarget(
            name: "CopyNinja",
            path: "Sources/CopyNinja",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Vision"),
                .linkedFramework("Carbon"),
                .linkedFramework("CryptoKit")
            ]
        )
    ]
)
