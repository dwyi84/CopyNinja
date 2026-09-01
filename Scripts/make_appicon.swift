import AppKit
import SwiftUI

// Generates Resources/AppIcon.icns from the shuriken brand mark.
// Usage: swift Scripts/make_appicon.swift <output-iconset-dir>
//
// Mirrors ShurikenShape from Sources/CopyNinja/NinjaIconView.swift
// (design space: 100 × 100) — keep the two in sync.

struct ShurikenShape: Shape {
    func path(in rect: CGRect) -> Path {
        func pt(_ x: CGFloat, _ y: CGFloat, _ rect: CGRect) -> CGPoint {
            let s = min(rect.width, rect.height) / 100
            return CGPoint(x: rect.midX + (x - 50) * s, y: rect.midY + (y - 50) * s)
        }
        func rectFor(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ rect: CGRect) -> CGRect {
            let s = min(rect.width, rect.height) / 100
            return CGRect(
                x: rect.midX + (x - 50) * s,
                y: rect.midY + (y - 50) * s,
                width: w * s,
                height: h * s
            )
        }
        var p = Path()
        p.move(to: pt(50, 4, rect))
        p.addQuadCurve(to: pt(96, 50, rect), control: pt(61, 39, rect))
        p.addQuadCurve(to: pt(50, 96, rect), control: pt(61, 61, rect))
        p.addQuadCurve(to: pt(4, 50, rect), control: pt(39, 61, rect))
        p.addQuadCurve(to: pt(50, 4, rect), control: pt(39, 39, rect))
        p.closeSubpath()
        p.addEllipse(in: rectFor(41, 41, 18, 18, rect))
        return p
    }
}

/// macOS (Big Sur style) app icon: squircle night-sky plate with a silver
/// shuriken. Everything is proportional to the canvas size `S`.
struct AppIconView: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.181, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.15, green: 0.17, blue: 0.23),
                            Color(red: 0.03, green: 0.04, blue: 0.06)
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.181, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: max(1, size * 0.004))
                )
                .frame(width: size * 0.805, height: size * 0.805)

            ShurikenShape()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.98, green: 0.98, blue: 1.0),
                            Color(red: 0.72, green: 0.75, blue: 0.82)
                        ],
                        startPoint: .top, endPoint: .bottom
                    ),
                    style: FillStyle(eoFill: true, antialiased: true)
                )
                .frame(width: size * 0.46, height: size * 0.46)
                .shadow(color: .black.opacity(0.35), radius: size * 0.018, y: size * 0.012)
        }
        .frame(width: size, height: size)
    }
}

_ = NSApplication.shared

let arguments = CommandLine.arguments
let outputDir = arguments.count > 1
    ? arguments[1]
    : "AppIcon.iconset"

MainActor.assumeIsolated {
    let fileManager = FileManager.default
    try? fileManager.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

    // iconset slots: pixel size → file name (duplicates are copied after render).
    let slots: [(pixels: Int, name: String)] = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png")
    ]

    for slot in slots {
        let view = AppIconView(size: CGFloat(slot.pixels))
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            print("render FAILED at \(slot.pixels)px")
            exit(1)
        }
        let url = URL(fileURLWithPath: outputDir).appendingPathComponent(slot.name)
        do {
            try png.write(to: url)
            print("rendered \(slot.name) (\(slot.pixels)px)")
        } catch {
            print("write FAILED for \(slot.name): \(error)")
            exit(1)
        }
    }
    print("iconset written to \(outputDir)")
}
