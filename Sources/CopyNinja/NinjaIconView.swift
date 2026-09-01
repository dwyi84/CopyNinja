import AppKit
import SwiftUI

// MARK: - Vector shuriken (no image assets, pure SwiftUI Shape/Path)

/// A four-bladed shuriken (throwing star) with a circular hole punched
/// through the center via an even-odd fill. Design space: 100 × 100.
struct ShurikenShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()

        // Four blades: sharp tips at N/E/S/W, edges sweeping concavely
        // toward the hub.
        p.move(to: pt(50, 4, rect))                                      // top tip
        p.addQuadCurve(to: pt(96, 50, rect), control: pt(61, 39, rect))  // to right tip
        p.addQuadCurve(to: pt(50, 96, rect), control: pt(61, 61, rect))  // to bottom tip
        p.addQuadCurve(to: pt(4, 50, rect), control: pt(39, 61, rect))   // to left tip
        p.addQuadCurve(to: pt(50, 4, rect), control: pt(39, 39, rect))   // back to top tip
        p.closeSubpath()

        // Central hole, punched out with the even-odd fill rule.
        p.addEllipse(in: rectFor(41, 41, 18, 18, rect))

        return p
    }
}

/// Composite shuriken. Shapes carry no color, so the environment foreground
/// style applies (`.black` for menu bar templates, accent colors in-app).
struct ShurikenIconView: View {
    var body: some View {
        ShurikenShape()
            .fill(style: FillStyle(eoFill: true, antialiased: true))
    }
}

// MARK: - Menu bar template image

@MainActor
enum ShurikenMenuBarIcon {
    /// Point size of the menu bar glyph (matches NSStatusItem.squareLength look).
    static let length: CGFloat = 18

    /// Renders the shuriken into an `NSImage` flagged as a template, so it
    /// follows the menu bar tint automatically (dark/light/vibrancy).
    static func image() -> NSImage {
        let view = ShurikenIconView()
            .frame(width: length, height: length)
            .foregroundStyle(Color.black)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 4
        let image = renderer.nsImage ?? NSImage()
        image.size = NSSize(width: length, height: length)
        image.isTemplate = true
        image.accessibilityDescription = "CopyNinja"
        return image
    }
}

// MARK: - Geometry helpers (design space: 100 × 100)

private func pt(_ x: CGFloat, _ y: CGFloat, _ rect: CGRect) -> CGPoint {
    let s = min(rect.width, rect.height) / 100
    return CGPoint(x: rect.midX + (x - 50) * s, y: rect.midY + (y - 50) * s)
}

private func rectFor(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ rect: CGRect) -> CGRect {
    let s = min(rect.width, rect.height) / 100
    return CGRect(
        x: rect.midX + (x - 50) * s,
        y: rect.midY + (y - 50) * s,
        width: w * s,
        height: h * s
    )
}
